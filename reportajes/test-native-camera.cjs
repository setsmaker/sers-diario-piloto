/* Regresión: recepción de foto nativa sin WebView file chooser. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {File}=require('node:buffer');
class El {
  constructor(tag='div'){
    this.tag=tag;this.className='';this.value='';this.textContent='';this.children=[];
    this.disabled=false;this.listeners={};this.style={};this.dataset={};this.open=false;
    const classes=new Set();
    this.classList={
      toggle:(n,v)=>{const b=v===undefined?!classes.has(n):v;b?classes.add(n):classes.delete(n);return b},
      contains:n=>classes.has(n),add:n=>classes.add(n),remove:n=>classes.delete(n)
    };
  }
  addEventListener(type,fn){this.listeners[type]=fn;}
  async click(){return await this.listeners.click?.({target:this,preventDefault(){}});}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  removeAttribute(){}setAttribute(n,v){this[n]=v;}
  focus(){}scrollIntoView(){}querySelector(){return new El();}
  querySelectorAll(){return [];}remove(){}showModal(){this.open=true;}close(){this.open=false;}
}
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const ids=[...new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))];
const els=Object.fromEntries(ids.map(id=>[id,new El()]));
const listeners={};
const win={
  addEventListener(type,fn){listeners[type]=fn;},
  dispatchEvent(e){return listeners[e.type]?.(e);},
  scrollTo(){},SersAndroid:{
    beginShareZip:()=>true,startVoiceInput:()=>{},
    startPhotoCamera:(reportId,reportName,photoId)=>{nativeStarts.push({reportId,reportName,photoId});return true;}
  }
};
const nativeStarts=[];
const seen={readPhoto:0,archiveFile:0,writePhoto:0};
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe1,0x00,0x14,0xff,0xd9]);
const vault={
 available:()=>true,
 writeReport:async()=> 'REPORT.json',
 writePhoto:async()=>{seen.writePhoto++;return 'PHOTO.json';},
 archiveFile:async(_file,_report,id)=>{seen.archiveFile++;return 'SERS_'+id+'.jpg';},
 readPhoto:async meta=>{
   seen.readPhoto++;
   assert.equal(meta.archivedName,'SERS_'+nativeStarts.at(-1).photoId+'.jpg');
   return new File([jpeg],meta.archivedName,{type:'image/jpeg'});
 },
 readCapturedPhoto:async meta=>{
   seen.readPhoto++;
   assert.equal(meta.photoId,nativeStarts.at(-1).photoId);
   return new File([jpeg],'SERS_'+meta.photoId+'.jpg',{type:'image/jpeg'});
 },
 index:()=>({reports:[],photos:[]}),
 restore:async()=>({recoveredReports:0,recoveredPhotos:0,errors:[]})
};
let reports=[],photos=[],draft=null;
const db={
 listReports:async()=>reports,
 getReport:async id=>reports.find(r=>r.id===id)||null,
 saveReport:async r=>{reports=reports.filter(x=>x.id!==r.id).concat(r)},
 photosByReport:async id=>photos.filter(p=>p.reportId===id),
 allPhotos:async()=>photos,
 getPhoto:async id=>photos.find(p=>p.id===id)||null,
 savePhoto:async p=>{photos=photos.filter(x=>x.id!==p.id).concat(p)},
 getDraft:async()=>draft,
 saveDraft:async d=>{draft=d},
 clearDraft:async()=>{draft=null}
};
const storage=new Map();
const doc={
 getElementById:id=>els[id]||(els[id]=new El()),
 createElement:tag=>new El(tag),
 querySelector:()=>null,body:new El(),head:new El(),hidden:false,addEventListener(){}
};
const ctx={
 window:win,document:doc,
 ReportDB:db,SersVault:vault,
 navigator:{onLine:false},
 localStorage:{
  getItem:k=>storage.get(k)||null,
  setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)
 },
 URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
 CustomEvent:class{constructor(type,args){this.type=type;this.detail=args?.detail}},
 console,setTimeout,clearTimeout,setInterval:()=>0,
 requestAnimationFrame:fn=>fn(),confirm:()=>true,File,Uint8Array,
 globalThis:{crypto:{randomUUID:()=> 'f' + Math.random().toString(36).slice(2,13)}}
};
(async()=>{
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),ctx,{timeout:2500});
 await new Promise(res=>setTimeout(res,30));
 // Crear reportaje.
 els.reportName.value='Prueba captura segura';
 await els.createReport.click();
 assert.equal(reports.length,1);
 // La cámara nativa es la única vía de captura; no usar el input WebView.
 assert.ok(els.cameraButton.listeners.click);
 await els.cameraButton.click();
 assert.equal(nativeStarts.length,1);
 assert.ok(listeners['sers-native-photo']);
 // Android entrega el identificador de fotografía almacenada en Galería.
 const id=nativeStarts[0].photoId;
 await listeners['sers-native-photo']({detail:{photoId:id,archivedName:'SERS_'+id+'.jpg'}});
 assert.equal(seen.readPhoto,1,'la app debe leer la galería');
 assert.equal(seen.archiveFile,0,'no debe duplicar la imagen en la galería');
 assert.ok(draft?.file,'la foto debe aparecer pendiente para descripción');
 assert.equal(draft.photoId,id);
 assert.equal(draft.archivedName,'SERS_'+id+'.jpg');
 assert.ok(els.captureEmpty.classList.contains('hidden'),
  'el botón Hacer fotografía debe ocultarse al recibir la imagen');
 assert.ok(!els.captureFilled.classList.contains('hidden'),
  'debe mostrarse la foto y la descripción');
 els.photoDescription.value='Descripción dictada de ejemplo';
 els.photoDescription.listeners.input();
 await new Promise(res=>setTimeout(res,600));
 await els.saveAndNext.click();
 assert.equal(photos.length,1);
 assert.equal(photos[0].description,'Descripción dictada de ejemplo');
 assert.equal(photos[0].archivedName,'SERS_'+id+'.jpg');
 assert.ok(seen.writePhoto>=2,'los datos deben archivarse al capturar y guardar');
 // Simular que el original existe pero Android rechaza la copia en Galería.
 await els.cameraButton.click();
 assert.equal(nativeStarts.length,2);
 const fallbackId=nativeStarts.at(-1).photoId;
 await listeners['sers-native-photo']({detail:{
  photoId:fallbackId,archivedName:null,galleryError:'MediaStore no disponible'
 }});
 assert.equal(seen.readPhoto,2,'debe leer el original aunque Galería falle');
 assert.ok(draft?.file,'debe mostrar la captura para poder describirla');
 assert.ok(!els.captureFilled.classList.contains('hidden'),'vista previa tras fallo de Galería');
 assert.equal(seen.archiveFile,1,'debe reintentar salvar en Galería');
 assert.equal(draft.archivedName,'SERS_'+fallbackId+'.jpg');
 // Regresión del fallo real: el reportaje mostrado y el ID activo pueden
 // diferir durante una recarga asíncrona. Debe ganar el ID de la fotografía.
 const origin=draft.reportId;
 const other={id:'otro-reportaje',name:'Otro reportaje',type:'reportaje',
   createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
   closedAt:null,photoCount:0};
 await db.saveReport(other);
 // Simular selección de otro reportaje por la interfaz, sin perder el borrador.
 await els.navHome.click();
 const original=reports.find(x=>x.id===origin);
 assert.ok(original);
 // Forzar una recarga que incorpore el otro reportaje a la lista.
 await els.actionToggleClosed.click();
 const otherRow=els.reportsList.children.find(row=>
  row.children?.[1]?.children?.[0]?.textContent==='Otro reportaje');
 assert.ok(otherRow,'el otro reportaje debe estar visible en la lista');
 await otherRow.click();
 assert.equal(els.selectedReportName.textContent,'Otro reportaje');
 // El usuario cambió el reportaje activo mientras la fotografía anterior
 // seguía pendiente. Se debe guardar en el reportaje de la toma.

 els.photoDescription.value='Quinto elemento fotografiado';
 els.photoDescription.listeners.input();
 await new Promise(res=>setTimeout(res,600));
 await els.saveAndNext.click();
 const restored=photos.find(x=>x.id===fallbackId);
 assert.ok(restored,'la foto pendiente debe guardarse sin descartarse');
 assert.equal(restored.reportId,origin,'no se debe cambiar la obra asociada a la foto');
 assert.equal(restored.description,'Quinto elemento fotografiado');
 assert.equal(reports.find(x=>x.id===other.id).photoCount,0,'otro reportaje no debe recibirla');
 console.log('OK: captura, dictado y guardado por ID de reportaje sin confundir reportajes');
})().catch(error=>{console.error(error);process.exitCode=1;});
