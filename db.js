/* Datos locales SERS: registros, visitas y borrador, con IndexedDB. */
'use strict';
const SersDB = (() => {
  const DB_NAME='sers-diario-piloto';
  const STORE='registros', DRAFTS='borradores', VISITS='visitas';
  function open(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,2);
      request.onupgradeneeded=()=>{
        const db=request.result;
        for(const name of [STORE,DRAFTS,VISITS]){
          if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Base de datos bloqueada por otra pestaña'));
    });
  }
  async function run(storeName,mode,action){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let result;
      const tx=db.transaction(storeName,mode);
      try{result=action(tx.objectStore(storeName));}
      catch(e){db.close();reject(e);return;}
      tx.oncomplete=()=>{db.close();resolve(result);};
      tx.onerror=()=>{db.close();reject(tx.error);};
      tx.onabort=()=>{db.close();reject(tx.error||new Error('Operación cancelada'));};
    });
  }
  async function read(name,id){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(name,'readonly'),request=tx.objectStore(name).get(id);
      request.onsuccess=()=>{resolve(request.result||null);};
      request.onerror=()=>reject(request.error);
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>{db.close();reject(tx.error);};
    });
  }
  async function readAll(name){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(name,'readonly'),request=tx.objectStore(name).getAll();
      request.onsuccess=()=>resolve(request.result||[]);
      request.onerror=()=>reject(request.error);
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>{db.close();reject(tx.error);};
    });
  }
  return {
    getAll:()=>readAll(STORE),
    put:item=>run(STORE,'readwrite',store=>store.put(item)),
    remove:id=>run(STORE,'readwrite',store=>store.delete(id)),
    saveDraft:draft=>run(DRAFTS,'readwrite',store=>store.put({...draft,id:'active'})),
    getDraft:()=>read(DRAFTS,'active'),
    clearDraft:()=>run(DRAFTS,'readwrite',store=>store.delete('active')),
    putVisit:visit=>run(VISITS,'readwrite',store=>store.put(visit)),
    getVisits:()=>readAll(VISITS),
    getVisit:id=>read(VISITS,id)
  };
})();
