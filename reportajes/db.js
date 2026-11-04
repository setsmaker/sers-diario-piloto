/* SERS Reportajes · IndexedDB local. Fotos originales almacenadas sin modificar. */
'use strict';
const ReportDB=(()=>{
 const DB_NAME='sers-reportajes-v1',VERSION=1;
 function open(){
  return new Promise((resolve,reject)=>{
   const r=indexedDB.open(DB_NAME,VERSION);
   r.onupgradeneeded=()=>{
    const db=r.result;
    if(!db.objectStoreNames.contains('reports'))db.createObjectStore('reports',{keyPath:'id'});
    if(!db.objectStoreNames.contains('photos')){
      const photos=db.createObjectStore('photos',{keyPath:'id'});
      photos.createIndex('reportId','reportId',{unique:false});
    }
    if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts',{keyPath:'id'});
   };
   r.onsuccess=()=>resolve(r.result);
   r.onerror=()=>reject(r.error);
   r.onblocked=()=>reject(new Error('La base de datos está bloqueada por otra pestaña.'));
  });
 }
 async function one(store,id){
  const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(id);
   let value;
   r.onsuccess=()=>{value=r.result||null;};
   tx.oncomplete=()=>{db.close();resolve(value);};
   tx.onerror=()=>{db.close();reject(tx.error);};
  });
 }
 async function all(store){
  const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();
   let value=[];
   r.onsuccess=()=>{value=r.result||[];};
   tx.oncomplete=()=>{db.close();resolve(value);};
   tx.onerror=()=>{db.close();reject(tx.error);};
  });
 }
 async function write(store,action,value){
  const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,'readwrite');
   const request=action==='put'?tx.objectStore(store).put(value):tx.objectStore(store).delete(value);
   tx.oncomplete=()=>{db.close();resolve(action==='put'?value:undefined);};
   tx.onerror=()=>{db.close();reject(tx.error||request.error);};
   tx.onabort=()=>{db.close();reject(tx.error||new Error('Escritura cancelada'));};
  });
 }
 async function byReport(id){
  const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('photos','readonly'),r=tx.objectStore('photos').index('reportId').getAll(id);
   let value=[];
   r.onsuccess=()=>{value=r.result||[];};
   tx.oncomplete=()=>{db.close();resolve(value.sort((a,b)=>a.sequence-b.sequence));};
   tx.onerror=()=>{db.close();reject(tx.error);};
  });
 }
 async function deleteReport(id){
  // Transacción única: elimina el reportaje y todas sus fotos de forma atómica.
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(['reports','photos','drafts'],'readwrite');
   const index=tx.objectStore('photos').index('reportId');
   const cursor=index.openCursor(IDBKeyRange.only(id));
   cursor.onsuccess=()=>{if(cursor.result){cursor.result.delete();cursor.result.continue();}};
   tx.objectStore('reports').delete(id);
   const draftRequest=tx.objectStore('drafts').get('capture');
   draftRequest.onsuccess=()=>{
    if(draftRequest.result?.reportId===id)tx.objectStore('drafts').delete('capture');
   };
   tx.oncomplete=()=>{db.close();resolve();};
   tx.onerror=()=>{db.close();reject(tx.error);};
   tx.onabort=()=>{db.close();reject(tx.error||new Error('No se pudo eliminar el reportaje'));};
  });
 }
 return {
  listReports:()=>all('reports'),
  getReport:id=>one('reports',id),
  saveReport:r=>write('reports','put',r),
  deleteReport,
  allPhotos:()=>all('photos'),
  photosByReport:byReport,
  getPhoto:id=>one('photos',id),
  savePhoto:p=>write('photos','put',p),
  deletePhoto:id=>write('photos','delete',id),
  getDraft:()=>one('drafts','capture'),
  saveDraft:data=>write('drafts','put',{...data,id:'capture'}),
  clearDraft:()=>write('drafts','delete','capture')
 };
})();
