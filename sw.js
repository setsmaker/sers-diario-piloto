'use strict';
const CACHE='sers-diario-v7-obras-y-visitas';
const SHELL=['./','./index.html','./styles.css','./db.js','./zip.js','./app.js',
  './obras.json','./manifest.webmanifest','./manifest-sers.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(names=>Promise.all(names.filter(name=>name.startsWith('sers-diario-')&&name!==CACHE).map(name=>caches.delete(name))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  // El catálogo añade una marca temporal para evitar datos antiguos.
  // No guardamos una copia por cada actualización; el cliente conserva una copia local.
  if(url.pathname.endsWith('/obras.json')&&url.search)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&!url.search){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));
    }
    return response;
  }).catch(()=>caches.match(event.request,{ignoreSearch:true})));
});
