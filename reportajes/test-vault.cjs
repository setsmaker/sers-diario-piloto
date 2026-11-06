/* Comprobación automatizada SersVault: guardar y reconstruir tras pérdida IndexedDB. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {Blob}=require('node:buffer');
const gallery=new Map(),records=new Map(),reports=new Map();
const savedReports=[],savedPhotos=[];
let staged=null,readIndexBroken=false;
const bridge={
 archiveBegin(reportId,reportName,id,extension,size){
  const name='SERS_'+id+'.'+extension;
  if(gallery.has(name)&&gallery.get(name).length===size)return 'EXISTS';
  if(staged)throw Error('Transferencia anterior no terminada');
  staged={name,size,parts:[]};return 'READY';
 },
 archiveChunk(data){staged.parts.push(Buffer.from(data,'base64'));return true;},
 archiveFinish(){const data=Buffer.concat(staged.parts);if(data.length!==staged.size)throw Error('Tamaño distinto');
  gallery.set(staged.name,data);const n=staged.name;staged=null;return n;},
 archiveSaveReport(raw){savedReports.push(JSON.parse(raw));return 'REPORT_JSON_'+savedReports.length;},
 archiveSavePhoto(raw){savedPhotos.push(JSON.parse(raw));return 'PHOTO_JSON_'+savedPhotos.length;},
 archiveReadIndex(){
  const r=[...new Map(savedReports.map(x=>[x.id,x])).values()];
  const p=[...new Map(savedPhotos.map(x=>[x.id,x])).values()];
  return JSON.stringify({reports:r,photos:p});
 },
 archiveImageSize(name){return gallery.has(name)?gallery.get(name).length:-1;},
 archiveReadImage(name,offset,chunk){const bytes=gallery.get(name);return bytes.slice(offset,offset+chunk).toString('base64');},
 archiveError(){return 'Fallo simulado';}
};
const db={
 listReports:async()=>[...reports.values()],allPhotos:async()=>[...records.values()],
 saveReport:async r=>{reports.set(r.id,r);},
 savePhoto:async p=>{records.set(p.id,p);},
 getReport:async id=>reports.get(id),
 photosByReport:async id=>[...records.values()].filter(p=>p.reportId===id)
};
const ctx={window:{SersAndroid:bridge},ReportDB:db,Blob,File,Buffer,
 btoa:s=>Buffer.from(s,'latin1').toString('base64'),
 atob:s=>Buffer.from(s,'base64').toString('latin1'),
 Uint8Array,setTimeout,console,Date,Map,Set,JSON,Error,Promise};
const src=fs.readFileSync(path.join(__dirname,'vault.js'),'utf8');
const vault=vm.runInNewContext(src+'; SersVault;',ctx);
(async()=>{
 const report={id:'rep-001',name:'Paseo de la Constitución',type:'reportaje',createdAt:'2026-11-06T10:00:00Z',
  updatedAt:'2026-11-06T11:00:00Z',closedAt:null,photoCount:1};
 const bytes=Buffer.from('JPEG-FOTO-ORIGINAL-DATOS-BINARIOS-ABCDEF','utf8');
 const file=new File([bytes],'captura.jpg',{type:'image/jpeg'});
 await vault.writeReport(report);
 const archivedName=await vault.archiveFile(file,report,'foto-001');
 assert.equal(archivedName,'SERS_foto-001.jpg');
 const photo={id:'foto-001',reportId:report.id,sequence:1,archivedName,file,
  originalName:'captura.jpg',mime:'image/jpeg',size:file.size,source:'camera',
  capturedAt:'2026-11-06T10:30:00Z',addedAt:'2026-11-06T10:30:00Z',
  updatedAt:'2026-11-06T10:31:00Z',description:'Árbol singular junto a la acera',
  position:{latitude:41.651,longitude:-0.879,accuracy:6},
  orientation:{degrees:140,method:'sensor',estimated:true}};
 await vault.writePhoto(photo,report);
 const savedSize=gallery.size;
 await vault.archiveFile(file,report,'foto-001');
 assert.equal(gallery.size,savedSize,'Repetir guardado no debe duplicar imágenes');
 // Simular pérdida total de la base de datos interna.
 reports.clear();records.clear();
 const result=await vault.restore();
 assert.equal(result.recoveredPhotos,1);
 assert.equal(result.recoveredReports,1);
 assert.equal(result.errors.length,0);
 assert.equal(records.get('foto-001').description,photo.description);
 assert.equal(records.get('foto-001').position.accuracy,6);
 assert.equal(records.get('foto-001').orientation.degrees,140);
 assert.deepEqual(Buffer.from(await records.get('foto-001').file.arrayBuffer()),bytes);
 console.log('OK: foto original, descripción, GPS, brújula y reportaje restaurados');
})().catch(e=>{console.error(e);process.exitCode=1;});
