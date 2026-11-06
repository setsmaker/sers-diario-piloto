/* SERS Photo · Copias nativas independientes de IndexedDB.
 * Galería: Pictures/SERS Photo/<reportaje>/SERS_<id>.jpg.
 * Fichas versionadas: Descargas/SERS_Photo/<id>/PHOTO...json y REPORT...json.
 * Sólo se informa de copia protegida si Android confirma los dos destinos. */
'use strict';
const SersVault=(()=>{
 const bridge=()=>window.SersAndroid?.archiveBegin?window.SersAndroid:null;
 const check=result=>{
  if(typeof result!=='string'||!result||result.startsWith('ERROR:')){
   throw new Error(String(result||'Android no confirmó el archivo.').replace(/^ERROR:/,''));
  }
  return result;
 };
 const json=x=>JSON.stringify(x);
 const reportRecord=r=>({kind:'report',backupTime:Date.now(),reportId:r.id,
   ...r,photoCount:r.photoCount||0});
 const photoRecord=(p,report)=>({
  kind:'photo',backupTime:Date.now(),id:p.id,reportId:p.reportId,
  reportName:report?.name||'',sequence:p.sequence,archivedName:p.archivedName,
  originalName:p.originalName,mime:p.mime,size:p.size,source:p.source,
  capturedAt:p.capturedAt,addedAt:p.addedAt,updatedAt:p.updatedAt,
  description:p.description||'',position:p.position||null,
  orientation:p.orientation||null,recordState:p.recordState||'saved'
 });
 async function writeReport(report){
  const b=bridge();if(!b)return null;
  return check(b.archiveSaveReport(json(reportRecord(report))));
 }
 async function writePhoto(p,report){
  const b=bridge();if(!b)return null;
  if(!p.archivedName)throw new Error('Falta una copia de la foto en la galería.');
  return check(b.archiveSavePhoto(json(photoRecord(p,report))));
 }
 const hex=(n)=>n.toString(16).padStart(2,'0');
 const ext=file=>{
  const type=(file.type||'').toLowerCase();
  if(type.includes('png'))return 'png';
  if(type.includes('webp'))return 'webp';
  if(type.includes('heic'))return 'heic';
  return 'jpg';
 };
 async function archiveFile(file,report,photoId){
  const b=bridge();if(!b)return null;
  if(!file?.size||!report?.id||!photoId)throw new Error('Foto o reportaje incorrecto.');
  let state=check(b.archiveBegin(report.id,report.name,photoId,ext(file),file.size));
  if(state==='EXISTS')return 'SERS_'+photoId+'.'+ext(file);
  if(state!=='READY')throw new Error('No se pudo iniciar la copia en Galería.');
  const size=96*1024;
  for(let off=0;off<file.size;off+=size){
   const bytes=new Uint8Array(await file.slice(off,off+size).arrayBuffer());
   // Evitar el límite del call stack al convertir Uint8Array a cadena.
   let raw='';
   for(let i=0;i<bytes.length;i+=8192)
    raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
   if(!b.archiveChunk(btoa(raw)))throw new Error(b.archiveError()||'No se pudo copiar la imagen.');
   // Ceder el control al navegador para que no se congele la pantalla.
   if(off%(size*8)===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return check(b.archiveFinish());
 }
 const available=()=>!!bridge();
 function index(){
  const b=bridge();if(!b)return {reports:[],photos:[]};
  const reply=check(b.archiveReadIndex());
  const data=JSON.parse(reply);
  return {
   reports:Array.isArray(data.reports)?data.reports:[],
   photos:Array.isArray(data.photos)?data.photos:[]
  };
 }
 async function readPhoto(meta){
  const b=bridge();
  const name=meta.archivedName;
  if(!/^SERS_[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|heic)$/i.test(name||''))
   throw new Error('Nombre de copia no válido: '+name);
  const size=b.archiveImageSize(name);
  if(size<1)throw new Error('No existe la fotografía en la galería: '+name);
  const chunks=[],partSize=96*1024;
  for(let offset=0;offset<size;offset+=partSize){
   const encoded=check(b.archiveReadImage(name,offset,Math.min(partSize,size-offset)));
   const raw=atob(encoded),bytes=new Uint8Array(raw.length);
   for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
   chunks.push(bytes);
   if(offset%(partSize*8)===0)await new Promise(res=>setTimeout(res,0));
  }
  const file=new File(chunks,meta.originalName||name,{
   type:meta.mime||'image/jpeg',lastModified:Date.parse(meta.capturedAt)||Date.now()
  });
  if(file.size!==size)throw new Error('La foto recuperada tiene un tamaño distinto.');
  return file;
 }
 async function readCapturedPhoto(meta) {
  const b=bridge(),id=meta?.photoId;
  if(!b?.nativeCaptureSize||!b?.nativeCaptureChunk)throw new Error('No hay lector de fotos de cámara.');
  if(!/^[A-Za-z0-9_-]{1,150}$/.test(id||''))
   throw new Error('Identificador de cámara incorrecto.');
  const size=b.nativeCaptureSize(id);
  if(size<1024)throw new Error('La fotografía no se guardó o está incompleta.');
  const chunks=[],partSize=96*1024;
  for(let offset=0;offset<size;offset+=partSize){
   const encoded=check(b.nativeCaptureChunk(id,offset,Math.min(partSize,size-offset)));
   if(!encoded)throw new Error('El archivo de cámara no se ha leído por completo.');
   const raw=atob(encoded),bytes=new Uint8Array(raw.length);
   for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
   chunks.push(bytes);
   if(offset%(partSize*8)===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const file=new File(chunks,meta.originalName||('SERS_'+id+'.jpg'),{
   type:'image/jpeg',lastModified:Date.parse(meta.capturedAt)||Date.now()
  });
  if(file.size!==size)throw new Error('La fotografía de cámara está incompleta.');
  return file;
 }
 const plainPhoto=m=>({
  id:m.id,reportId:m.reportId,sequence:m.sequence,originalName:m.originalName,
  mime:m.mime,size:m.size,source:m.source,
  capturedAt:m.capturedAt,addedAt:m.addedAt,
  updatedAt:m.updatedAt,description:m.description,
  position:m.position,orientation:m.orientation,archivedName:m.archivedName
 });
 async function restore(onProgress=()=>{}){
  const archive=index();
  const currentReports=await ReportDB.listReports(),knownReports=new Set(currentReports.map(x=>x.id));
  const currentPhotos=await ReportDB.allPhotos(),knownPhotos=new Set(currentPhotos.map(x=>x.id));
  let recoveredReports=0,recoveredPhotos=0,errors=[];
  const byReport=new Map();
  for(const m of archive.photos){
   const arr=byReport.get(m.reportId)||[];arr.push(m);byReport.set(m.reportId,arr);
  }
  for(const meta of archive.reports){
   if(!meta.id||knownReports.has(meta.id))continue;
   const report={id:meta.id,name:meta.name||'Reportaje recuperado',type:'reportaje',
    createdAt:meta.createdAt||new Date().toISOString(),
    updatedAt:meta.updatedAt||new Date().toISOString(),
    closedAt:meta.closedAt||null,photoCount:0};
   await ReportDB.saveReport(report);
   recoveredReports++;
   knownReports.add(meta.id);
  }
  // Aunque se haya perdido la ficha REPORT, una foto incluye nombre de
  // reportaje e ID, suficientes para recuperar la relación.
  for(const m of archive.photos){
   if(!m.id||!m.reportId||knownPhotos.has(m.id))continue;
   try{
    let parent=await ReportDB.getReport(m.reportId);
    if(!parent){
     parent={id:m.reportId,name:m.reportName||'Reportaje recuperado',
      type:'reportaje',createdAt:m.capturedAt||new Date().toISOString(),
      updatedAt:m.updatedAt||new Date().toISOString(),closedAt:null,photoCount:0};
     await ReportDB.saveReport(parent);
     recoveredReports++;knownReports.add(m.reportId);
    }
    onProgress('Recuperando foto '+(recoveredPhotos+1)+' de '+archive.photos.length);
    const file=await readPhoto(m);
    await ReportDB.savePhoto({...plainPhoto(m),file});
    knownPhotos.add(m.id);recoveredPhotos++;
   }catch(e){errors.push(m.id+': '+e.message);}
  }
  // Actualizar contadores desde fotos reales. No fiarse de índices previos.
  for(const r of await ReportDB.listReports()){
   const images=await ReportDB.photosByReport(r.id);
   if(r.photoCount!==images.length)
    await ReportDB.saveReport({...r,photoCount:images.length});
  }
  return {recoveredReports,recoveredPhotos,errors,totalArchivePhotos:archive.photos.length};
 }
 return {available,writeReport,writePhoto,archiveFile,readPhoto,readCapturedPhoto,index,restore};
})();
