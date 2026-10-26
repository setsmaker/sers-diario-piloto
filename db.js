/* Base de datos local para fotos y audio: sin servicios externos. */
'use strict';
const SersDB = (() => {
  const DB_NAME = 'sers-diario-piloto';
  const STORE = 'registros';
  function open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Base de datos bloqueada por otra pestaña'));
    });
  }
  async function operation(mode, cb) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let value;
      try { value = cb(store); } catch (err) { db.close(); reject(err); return; }
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Operación cancelada')); };
    });
  }
  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => { const val = request.result; db.close(); resolve(val); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
  function put(item) { return operation('readwrite', store => {store.put(item);}); }
  function remove(id) {return operation('readwrite', store => {store.delete(id);});}
  return { getAll, put, remove };
})();
