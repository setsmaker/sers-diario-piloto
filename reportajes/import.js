/* Importa exclusivamente ZIP sin compresión generados por SERS Reportajes.
 * Mantiene fotos originales, IDs, GPS, orientación y descripción.
 * Procesa con Blob.slice para no cargar todas las imágenes a la memoria. */
'use strict';
const SersImport=(()=>{
 const dec=new TextDecoder('utf-8');
 const MAX_ENTRIES=5000,MAX_JSON=10*1024*1024;
 async function u8(blob,start,length){
  return new Uint8Array(await blob.slice(start,start+length).arrayBuffer());
 }
 async function readZip(blob){
  const entries=new Map();
  let offset=0,n=0,head;
  if(!blob||blob.size<22)throw new Error('El archivo ZIP está vacío o es incorrecto.');
  while(offset+30<=blob.size){
   head=await u8(blob,offset,30);
   const view=new DataView(head.buffer,head.byteOffset,head.byteLength);
   const signature=view.getUint32(0,true);
   if(signature===0x02014b50||signature===0x06054b50)break;
   if(signature!==0x04034b50)throw new Error('No se reconoce la estructura del ZIP.');
   const flags=view.getUint16(6,true),method=view.getUint16(8,true);
   const size=view.getUint32(18,true),uncompressed=view.getUint32(22,true);
   const filenameLength=view.getUint16(26,true),extraLength=view.getUint16(28,true);
   if(method!==0||size!==uncompressed||flags&0x08)throw new Error(
    'Esta copia no utiliza el formato ZIP de SERS Reportajes.');
   if(!filenameLength||filenameLength>1024)throw new Error('Nombre de archivo incorrecto en el ZIP.');
   const start=offset+30+filenameLength+extraLength,end=start+size;
   if(end>blob.size)throw new Error('Hay un archivo incompleto dentro del ZIP.');
   const filename=dec.decode(await u8(blob,offset+30,filenameLength));
   if(filename.startsWith('/')||filename.includes('..')||filename.includes('\\')){
    throw new Error('El ZIP contiene nombres de archivo no permitidos.');
   }
   if(!entries.has(filename))entries.set(filename,{blob:blob.slice(start,end),size});
   offset=end;
   if(++n>MAX_ENTRIES)throw new Error('El ZIP contiene demasiados archivos.');
  }
  return entries;
 }
 async function json(entries,name){
  const item=entries.get(name);
  if(!item)throw new Error('Falta '+name+' en el ZIP. Comprueba que procede de SERS Reportajes.');
  if(item.size>MAX_JSON)throw new Error('Archivo '+name+' demasiado grande.');
  try{return JSON.parse(await item.blob.text());}
  catch{throw new Error('No se puede leer '+name+' del ZIP.');}
 }
 async function load(zipFile){
  const entries=await readZip(zipFile);
  const head=await json(entries,'reportaje.json'),metas=await json(entries,'DATOS/fotografias.json');
  if(!head||typeof head.id!=='string'||typeof head.nombre!=='string'||!Array.isArray(metas)){
   throw new Error('El archivo no es un reportaje SERS válido.');
  }
  if(metas.length>MAX_ENTRIES)throw new Error('Demasiadas fotografías.');
  const report={id:head.id,name:head.nombre,type:head.tipo==='inventario'?'inventario':'reportaje',
   createdAt:head.creado||new Date().toISOString(),
   updatedAt:head.actualizado||new Date().toISOString(),
   closedAt:head.cerrado||null,photoCount:metas.length};
  const images=[];
  for(const meta of metas){
   if(!meta||typeof meta.id!=='string'||typeof meta.numero!=='number'){
    throw new Error('Metadatos de fotografía incorrectos.');
   }
   const stem='FOTOGRAFIAS/'+String(meta.nombre_archivo||'');
   const match=[...entries.keys()].find(n=>n.startsWith(stem+'.')&&
    n.slice(stem.length+1).match(/^(jpe?g|png|webp|heic|gif)$/i));
   if(!match)throw new Error('Falta la fotografía '+meta.numero+' ('+meta.id+').');
   const bytes=entries.get(match);
   const originalName=meta.archivo_original||match.split('/').pop();
   const mime=meta.mime||(
    match.endsWith('.png')?'image/png':match.endsWith('.webp')?'image/webp':'image/jpeg');
   const captured=meta.fecha_foto||new Date().toISOString();
   const timestamp=Date.parse(captured);
   const photo=new File([bytes.blob],originalName,{type:mime,
    lastModified:Number.isFinite(timestamp)?timestamp:Date.now()});
   images.push({
    id:meta.id,reportId:report.id,sequence:meta.numero,
    file:photo,originalName,mime,size:photo.size,
    source:meta.fuente||'camera',capturedAt:captured,
    addedAt:meta.fecha_incorporacion||captured,
    updatedAt:meta.ultima_modificacion||captured,
    description:meta.descripcion_original||'',
    position:meta.gps||null,orientation:meta.brujula||null
   });
  }
  return {report,photos:images};
 }
 return {load};
})();
