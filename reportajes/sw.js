'use strict';
const CACHE='sers-reportajes-v5';
const ASSETS=['./','./index.html','./styles.css','./db.js','./app.js',
 './cloud.js','./import.js','./leaflet.css','./manifest.webmanifest','../zip.js',
 '../icons/icon-192.png','../icons/icon-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(k=>k.startsWith('sers-reportajes-')&&k!==CACHE).map(k=>caches.delete(k))
 )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok){
   const copy=response.clone();
   event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));
  }
  return response;
 }).catch(()=>caches.match(event.request,{ignoreSearch:true})));
});
