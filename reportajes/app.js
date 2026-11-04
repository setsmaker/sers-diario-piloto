'use strict';
/* SERS Reportajes · toda la captura funciona sin conexión y sin cuentas. */
(() => {
 const $=id=>document.getElementById(id), now=()=>new Date().toISOString();
 const uid=()=>globalThis.crypto?.randomUUID?.()||
  ('r'+Date.now().toString(36)+Math.random().toString(36).slice(2,11));
 const KEY='sers-reportajes-active-v1';
 let reports=[],activeId=localStorage.getItem(KEY)||'',photos=[],draft=null;
 let currentView='home',gps=null,gpsError='',heading=null,watchId=null,dictation=null,dictating=false,cameraStart=null;
 let draftQueue=Promise.resolve(),draftTimer=null,toastTimer=null,captureUrl=null,dialogUrl=null,dialogPhotoId=null,cardUrls=[],leafletMap=null,leafletLayers=null;
 let mapBaseLayer=null,mapPhotoMarkers=new Map(),mapPhotoUrls=[],mapFocusBounds=null,mapLocated=[];
 const MAP_SOURCE_KEY='sers-reportajes-map-source-v1';
 let mapSource=localStorage.getItem(MAP_SOURCE_KEY)||'pnoa';
 const doc=(tag,cls,text)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!==undefined)el.textContent=text;
  return el;
 };
 const dateNice=s=>{const d=new Date(s);return Number.isNaN(d.getTime())?'Fecha desconocida':
   d.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'});};
 const timeNice=s=>{const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});};
 const labelNum=n=>String(n).padStart(3,'0');
 const today=()=>new Date().toISOString().slice(0,10);
 const active=()=>reports.find(r=>r.id===activeId)||null;
 const numPhotos=()=>photos.length;
 function message(text){
  const e=$('toast');e.textContent=text;e.classList.remove('hidden');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.add('hidden'),3500);
 }
 function network(){
  const badge=$('netBadge');badge.textContent=navigator.onLine?'● Con conexión':'○ Sin cobertura';
  badge.classList.toggle('offline',!navigator.onLine);
 }
 function chooseView(name){
  const report=active();
  if(name!=='home'&&!report){name='home';message('Selecciona primero un reportaje.');}
  if(currentView==='map'&&name!=='map')closeMap();
  currentView=name;
  document.body.classList.toggle('capture-mode',name==='capture');
  for(const page of ['home','capture','gallery','map']){
   $(page+'View').classList.toggle('hidden',page!==name);
   $('nav'+page[0].toUpperCase()+page.slice(1)).classList.toggle('active',page===name);
  }
  if(name==='home')renderHome();
  if(name==='capture'){openCapture();}
  if(name==='gallery')renderGallery();
  if(name==='map')renderMap();
  window.scrollTo({top:0,behavior:'instant'});
 }
 async function reload(){
  reports=(await ReportDB.listReports()).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if(!reports.some(r=>r.id===activeId))activeId=reports[0]?.id||'';
  if(activeId)localStorage.setItem(KEY,activeId);
  photos=activeId?await ReportDB.photosByReport(activeId):[];
 }
 async function saveReport(report){
  report.updatedAt=now();await ReportDB.saveReport(report);
  await reload();
 }
 function renderHome(){
  const box=$('recentBox'),last=reports[0];
  box.classList.toggle('hidden',!last);
  $('allCount').textContent=reports.length+' en total';
  if(last){
   $('recentName').textContent=last.name;
   $('recentInfo').textContent=dateNice(last.updatedAt)+(last.closedAt?' · Finalizado':' · En curso');
   $('recentCount').textContent=(last.photoCount||0)+' fotos';
  }
  const holder=$('reportsList');holder.replaceChildren();
  if(!reports.length){holder.append(doc('p','muted','Todavía no hay reportajes.'));return;}
  for(const r of reports){
   const line=doc('div','report-row');
   const left=doc('div',''),name=doc('div','name',r.name),
    desc=doc('p','',dateNice(r.updatedAt)+' · '+(r.photoCount||0)+' fotografías'+(r.closedAt?' · Finalizado':''));
   left.append(name,desc);
   const right=doc('div','report-actions'),open=doc('button','',r.closedAt?'Ver fotos':'Continuar');
   open.addEventListener('click',()=>selectReport(r.id,r.closedAt?'gallery':'capture'));
   const more=doc('button','text-report-action',r.closedAt?'Reabrir':'Finalizar');
   more.addEventListener('click',async()=>{
    if(!r.closedAt&&!confirm('¿Dar por finalizado este reportaje? Podrás reabrirlo.'))return;
    const latest=await ReportDB.getReport(r.id);
    if(!latest)return;
    latest.closedAt=latest.closedAt?null:now();
    await saveReport(latest);renderHome();
   });
   const shareB=doc('button','share-report-button','☁ Enviar a OneDrive');
   shareB.addEventListener('click',()=>exportReport(r.id,shareB,true));
   // El envío necesita el puente Android de la APK; la PWA conserva Exportar ZIP.
   shareB.classList.toggle('hidden',!window.SersAndroid?.beginShareZip);
   const exportB=doc('button','text-report-action','Exportar ZIP');
   exportB.addEventListener('click',()=>exportReport(r.id,exportB,false));
   right.append(open,more,shareB,exportB);line.append(left,right);holder.append(line);
  }
 }
 async function createReport(){
  const name=$('reportName').value.trim();
  if(name.length<3){message('Escribe un nombre de reportaje de al menos 3 caracteres.');return;}
  const r={id:uid(),name,type:'reportaje',createdAt:now(),updatedAt:now(),closedAt:null,photoCount:0};
  try{
   await ReportDB.saveReport(r);
   $('reportName').value='';
   await reload();
   await selectReport(r.id,'capture');
   message('Reportaje creado. Ya puedes hacer fotografías.');
  }catch(error){console.error(error);message('No se pudo crear el reportaje en este móvil.');}
 }
 async function importReport(event){
  const zip=event.target.files?.[0];event.target.value='';
  if(!zip)return;
  if(typeof SersImport==='undefined'){
   message('No se ha cargado la recuperación de copias ZIP.');return;
  }
  const button=$('importReportBtn');button.disabled=true;button.textContent='Recuperando…';
  try{
   const imported=await SersImport.load(zip);
   const existing=await ReportDB.getReport(imported.report.id);
   if(existing&&!confirm('Ya existe este reportaje. ¿Recuperar solo las fotografías que falten?'))return;
   const old=existing?await ReportDB.photosByReport(imported.report.id):[];
   const known=new Set(old.map(p=>p.id));
   let count=0;
   for(const p of imported.photos){
    if(known.has(p.id))continue;
    await ReportDB.savePhoto(p);count++;
   }
   const report=existing||imported.report;
   report.photoCount=(await ReportDB.photosByReport(report.id)).length;
   if(!existing||count)report.updatedAt=now();
   await ReportDB.saveReport(report);
   await reload();renderHome();
   message('Recuperadas '+count+' fotografías.');
  }catch(error){
   console.error('Error recuperando copia',error);
   message('Error al importar: '+String(error.message||error).slice(0,100));
  }finally{button.disabled=false;button.textContent='Importar copia ZIP';}
 }
 async function selectReport(id,page='capture'){
  if(draft?.file&&draft.reportId!==id){
   await saveDraftNow();
  }
  activeId=id;localStorage.setItem(KEY,id);
  photos=await ReportDB.photosByReport(id);
  chooseView(page);
 }
 function setCaptureUrl(file){
  if(captureUrl){URL.revokeObjectURL(captureUrl);captureUrl=null;}
  if(file){captureUrl=URL.createObjectURL(file);$('capturePreview').src=captureUrl;}
  else $('capturePreview').removeAttribute('src');
 }
 const gpsClass=accuracy=>accuracy==null?'waiting':accuracy<=10?'good':accuracy<=25?'warning':'bad';
 const gpsText=accuracy=>accuracy==null?'Sin posición':accuracy<=10?'Buena · ±'+Math.round(accuracy)+' m':
  accuracy<=25?'Aceptable · ±'+Math.round(accuracy)+' m':'Baja · ±'+Math.round(accuracy)+' m';
 function updateSensors(){
  const age=gps?Math.round((Date.now()-gps.timestamp)/1000):null;
  const fresh=age!=null&&age<=30;
  const accuracy=fresh?gps.accuracy:null;
  const g=$('gpsRefresh');
  g.className='sensor gps '+gpsClass(accuracy);
  $('gpsStatus').textContent=accuracy==null?(gps?'GPS antiguo':gpsError||'Buscando…'):gpsText(accuracy);
  const freshHeading=heading&&Date.now()-Date.parse(heading.time)<=10000;
  $('compassStatus').textContent=freshHeading?'≈ '+Math.round(heading.degrees)+'° '+cardinal(heading.degrees):'Sin datos';
 }
 const cardinal=degrees=>['N','NE','E','SE','S','SO','O','NO'][Math.round(((degrees%360)+360)%360/45)%8];
 function gpsSnapshot(){
  if(!gps||Date.now()-gps.timestamp>30000)return null;
  return {latitude:gps.latitude,longitude:gps.longitude,accuracy:gps.accuracy,
   altitude:gps.altitude,altitudeAccuracy:gps.altitudeAccuracy,
   sampledAt:new Date(gps.timestamp).toISOString(),source:'navegador-geolocation'};
 }
 function headingSnapshot(){
  if(!heading||Date.now()-new Date(heading.time).getTime()>15000)return null;
  return {...heading};
 }
 function gpsUpdate(pos){
  gpsError='';
  const c=pos.coords;
  const measurement={latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,
   altitude:c.altitude,altitudeAccuracy:c.altitudeAccuracy,timestamp:pos.timestamp};
  if(!gps||measurement.timestamp>=gps.timestamp)gps=measurement;
  updateSensors();
  if(draft?.file){
   const elapsed=Date.now()-new Date(draft.capturedAt).getTime();
   const before=draft.position;
   if(elapsed<=20000&&(!before||measurement.accuracy<before.accuracy)&&
     (!before||distanceMeters(before.latitude,before.longitude,measurement.latitude,measurement.longitude)<Math.max(before.accuracy+measurement.accuracy,20))){
     draft.position=gpsSnapshot();scheduleDraft();updatePhotoLocationInfo();
   }
  }
 }
 function distanceMeters(a,b,c,d){
  const R=6371000,p=Math.PI/180,dlat=(c-a)*p,dlon=(d-b)*p;
  return 2*R*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dlon/2)**2));
 }
 function startGPS(){
  if(watchId!=null||!navigator.geolocation)return;
  try{
   watchId=navigator.geolocation.watchPosition(gpsUpdate,error=>{
    gpsError=error.code===1?'Sin permiso GPS':'Sin ubicación';
    updateSensors();
   },{enableHighAccuracy:true,maximumAge:1000,timeout:25000});
  }catch(e){$('gpsStatus').textContent='GPS no disponible';}
 }
 function refreshGPS(){
  updateSensors();
  if(!navigator.geolocation){message('Este teléfono no facilita ubicación.');return;}
  navigator.geolocation.getCurrentPosition(gpsUpdate,()=>{
   message('No se pudo actualizar el GPS. Revisa los permisos de ubicación.');
  },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 }
 const orientation=event=>{
  let degrees=null,method='';
  if(Number.isFinite(event.webkitCompassHeading)){
   degrees=event.webkitCompassHeading;method='webkitCompassHeading';
  }else if(event.absolute===true&&Number.isFinite(event.alpha)){
   // Android: alpha absoluto orientativo. No equivale a azimut topográfico
   // ni tiene compensación certificada por inclinación de la cámara.
   degrees=(360-event.alpha)%360;method='deviceorientation-absoluta-aproximada';
  }
  if(degrees!=null){
   heading={degrees:((degrees%360)+360)%360,method,time:now(),estimated:true};
   updateSensors();
  }
 };
 let sensorListening=false;
 function enableCompass(){
  if(sensorListening)return;
  sensorListening=true;
  window.addEventListener('deviceorientationabsolute',orientation,true);
  window.addEventListener('deviceorientation',orientation,true);
  updateSensors();
 }
 async function requestCompass(){
  try{
   if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    const permission=await DeviceOrientationEvent.requestPermission();
    if(permission!=='granted'){message('Permiso de brújula no concedido.');return;}
   }
   enableCompass();
   message('Brújula activada si el navegador ofrece rumbo absoluto.');
  }catch(e){message('El navegador no permite activar la brújula.');}
 }
 async function openCapture(){
  const r=active();if(!r)return;
  $('capTitle').textContent=r.name;
  $('capCounter').textContent='Fotografía '+labelNum((r.photoCount||0)+1);
  startGPS();enableCompass();updateSensors();
  try{
   const saved=await ReportDB.getDraft();
   draft=saved?.file&&saved.reportId===r.id?saved:null;
   renderDraft();
   if(saved?.file&&saved.reportId!==r.id)message('Hay una fotografía pendiente en otro reportaje.');
  }catch(e){console.error(e);draft=null;renderDraft();}
 }
 function updatePhotoLocationInfo(){
  const note=$('photoLocationInfo');if(!note)return;
  note.replaceChildren();
  const p=draft?.position,b=draft?.orientation,file=draft?.file;
  if(!file)return;
  const t=new Date(draft.capturedAt);
  const dateValid=Number.isFinite(t.getTime());
  const metaLine=doc('div','photo-overlay-line',
    (dateValid?t.toLocaleDateString('es-ES')+' · '+timeNice(draft.capturedAt):'Sin fecha')+
    ' · '+(draft.originalName||'Foto')+' · '+Math.max(0,Math.round(file.size/1024))+' KB');
  const geoLine=doc('div','photo-overlay-line',
    p?'📍 '+p.latitude.toFixed(6)+', '+p.longitude.toFixed(6)+' · ±'+Math.round(p.accuracy)+' m':
    '📍 Sin coordenadas');
  const dirLine=doc('div','photo-overlay-line',b?'🧭 ≈'+Math.round(b.degrees)+'° '+cardinal(b.degrees):'🧭 Sin orientación');
  note.append(metaLine,geoLine,dirLine);
  note.className='photo-overlay '+gpsClass(p?.accuracy);
 }
 function renderDraft(){
  const hasFile=Boolean(draft?.file);
  $('captureEmpty').classList.toggle('hidden',hasFile);
  $('captureFilled').classList.toggle('hidden',!hasFile);
  setCaptureUrl(hasFile?draft.file:null);
  updatePhotoLocationInfo();
  $('photoDescription').value=draft?.description||'';
  $('dictateStatus').textContent='';
 }
 function scheduleDraft(){
  if(!draft?.file)return;
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>saveDraftNow(),450);
 }
 function saveDraftNow(){
  clearTimeout(draftTimer);
  if(!draft?.file)return draftQueue;
  const copy={...draft};
  draftQueue=draftQueue.catch(()=>{}).then(()=>ReportDB.saveDraft(copy));
  draftQueue.catch(e=>{console.error(e);message('No se pudo guardar el borrador. Revisa el espacio libre.');});
  return draftQueue;
 }
 async function photoSelected(event,source){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(!file.type.startsWith('image/')){message('Selecciona un archivo de imagen.');return;}
  stopDictation();
  if(draft?.file&&!confirm('Sustituir la fotografía actual? Se perderá la imagen del borrador.'))return;
  const captureTime=source==='camera'?now():new Date(file.lastModified||Date.now()).toISOString();
  let position=source==='camera'?gpsSnapshot():null;
  let orientationValue=source==='camera'?headingSnapshot():null;
  if(source==='camera'&&cameraStart&&Date.now()-Date.parse(cameraStart.at)<120000){
   if(!position&&cameraStart.position)position={...cameraStart.position,context:'antes_de_camara'};
   if(!orientationValue&&cameraStart.orientation)orientationValue={...cameraStart.orientation,
     method:cameraStart.orientation.method+'-antes-de-camara'};
  }
  cameraStart=null;
  draft={id:'capture',reportId:activeId,file,originalName:file.name,
   description:'',source,capturedAt:captureTime,selectedAt:now(),
   position,orientation:orientationValue};
  renderDraft();
  try{await saveDraftNow();}catch{}
 }
 function startDictation(){
  if(!draft?.file){message('Haz primero una fotografía.');return;}
  if(window.SersAndroid?.startVoiceInput){
   window.SersAndroid.startVoiceInput();
   $('dictateStatus').textContent='Dictado de Android abierto…';
   return;
  }
  if(dictation){dictation.stop();return;}
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){message('El dictado no está disponible. Usa el micrófono del teclado.');return;}
  try{
   const recognition=new SpeechRecognition();
   recognition.lang='es-ES';recognition.continuous=false;recognition.interimResults=false;
   const before=$('photoDescription').value;
   recognition.onresult=e=>{
    let words='';
    for(let i=e.resultIndex;i<e.results.length;i++){
     if(e.results[i].isFinal)words+=e.results[i][0].transcript+' ';
    }
    words=words.trim();
    if(!words)return;
    const box=$('photoDescription');
    box.value=(before.trim()?before.trim()+' ':'')+words;
    draft.description=box.value;scheduleDraft();
   };
   recognition.onerror=e=>{$('dictateStatus').textContent='Dictado: '+(e.error==='not-allowed'?'permiso de micrófono denegado':e.error);};
   recognition.onend=()=>{
    if(dictation===recognition)dictation=null;
    $('dictate').classList.remove('listening');
    $('dictate').querySelector('span').textContent='Dictar';
   };
   dictation=recognition;recognition.start();
   $('dictate').classList.add('listening');
   $('dictate').querySelector('span').textContent='Detener';
   $('dictateStatus').textContent='Escuchando…';
  }catch(e){message('No se pudo iniciar el dictado.');}
 }
 window.addEventListener('sers-native-dictation',event=>{
  if(!draft?.file||!event.detail?.text)return;
  const box=$('photoDescription');
  box.value=(box.value.trim()?box.value.trim()+' ':'')+event.detail.text.trim();
  draft.description=box.value;scheduleDraft();
  $('dictateStatus').textContent='Dictado incorporado. Puedes corregirlo antes de guardar.';
 });
 window.addEventListener('sers-native-heading',event=>{
  const degrees=Number(event.detail?.degrees);
  if(!Number.isFinite(degrees))return;
  heading={degrees:((degrees%360)+360)%360,method:'android-rotation-vector-camara-trasera-aproximada',
   time:now(),estimated:true};
  if(currentView==='capture')updateSensors();
 });
 function stopDictation(){
  if(!dictation)return Promise.resolve();
  const current=dictation;
  return new Promise(resolve=>{
   const prev=current.onend;
   current.onend=()=>{try{prev?.();}finally{resolve();}};
   try{current.stop();}catch{resolve();}
   setTimeout(resolve,1800);
  });
 }
 async function savePhoto(){
  if(!draft?.file||!active()){message('Haz una fotografía primero.');return;}
  $('saveAndNext').disabled=true;
  try{
   await stopDictation();
   draft.description=$('photoDescription').value;
   await saveDraftNow();await draftQueue;
   const r=await ReportDB.getReport(activeId);
   if(!r)throw new Error('El reportaje ya no existe');
   const sequence=(await ReportDB.photosByReport(activeId)).reduce((max,p)=>Math.max(max,p.sequence||0),0)+1;
   const item={
    id:uid(),reportId:activeId,sequence,file:draft.file,originalName:draft.originalName,
    mime:draft.file.type,size:draft.file.size,source:draft.source,
    capturedAt:draft.capturedAt,addedAt:now(),updatedAt:now(),
    description:draft.description||'',position:draft.position,orientation:draft.orientation
   };
   await ReportDB.savePhoto(item);
   r.photoCount=(r.photoCount||0)+1;r.closedAt=null;
   await ReportDB.saveReport({...r,updatedAt:now()});
   await ReportDB.clearDraft();
   draft=null;photos=await ReportDB.photosByReport(activeId);
   await reload();
   $('capCounter').textContent='Fotografía '+labelNum((r.photoCount||0)+1);
   renderDraft();
   window.dispatchEvent(new CustomEvent('sers-reportajes:saved',{detail:{id:item.id,reportId:activeId}}));
   message('Foto '+labelNum(sequence)+' guardada. Puedes hacer la siguiente.');
  }catch(e){
   console.error(e);message('No se pudo guardar la foto. No cierres el borrador.');
  }finally{$('saveAndNext').disabled=false;}
 }
 function clearCardUrls(){
  for(const u of cardUrls)URL.revokeObjectURL(u);
  cardUrls=[];
 }
 function renderGallery(){
  const report=active();if(!report)return;
  $('gallerySubtitle').textContent=report.name+' · '+photos.length+' fotografías';
  $('galleryEmpty').classList.toggle('hidden',photos.length>0);
  clearCardUrls();const holder=$('galleryList');holder.replaceChildren();
  for(const p of photos){
   const card=doc('button','photo-card');
   const url=URL.createObjectURL(p.file);cardUrls.push(url);
   const img=doc('img');img.src=url;img.loading='lazy';img.alt='Foto '+labelNum(p.sequence);
   const info=doc('div','photo-card-info');
   info.append(doc('b','', 'FOTO '+labelNum(p.sequence)),
    doc('span','',p.description||'Sin descripción'),
    doc('small','',p.position?'📍 ±'+Math.round(p.position.accuracy)+' m':'Sin GPS'));
   card.append(img,info);
   card.addEventListener('click',()=>showPhoto(p.id));
   holder.append(card);
  }
 }
 function showPhoto(id){
  const p=photos.find(x=>x.id===id);if(!p)return;
  if(dialogUrl)URL.revokeObjectURL(dialogUrl);
  dialogUrl=URL.createObjectURL(p.file);dialogPhotoId=id;
  $('dialogPhoto').src=dialogUrl;
  $('dialogTitle').textContent='FOTO '+labelNum(p.sequence);
  $('dialogDescription').value=p.description||'';
  $('dialogMeta').textContent=dateNice(p.capturedAt)+' · '+timeNice(p.capturedAt)+
   (p.position?' · GPS ±'+Math.round(p.position.accuracy)+' m':' · Sin GPS')+
   (p.orientation?' · 🧭 ≈'+Math.round(p.orientation.degrees)+'°':' · Sin rumbo');
  $('photoDialog').showModal();
 }
 function closePhoto(){
  $('photoDialog').close();
  dialogPhotoId=null;
  if(dialogUrl)URL.revokeObjectURL(dialogUrl);
  dialogUrl=null;
 }
 async function editPhoto(){
  if(!dialogPhotoId)return;
  const p=photos.find(x=>x.id===dialogPhotoId);
  if(!p)return;
  const newText=$('dialogDescription').value;
  if(p.description===newText){closePhoto();return;}
  try{
   await ReportDB.savePhoto({...p,description:newText,updatedAt:now()});
   const report=await ReportDB.getReport(p.reportId);
   if(report)await ReportDB.saveReport({...report,updatedAt:now()});
   closePhoto();await reload();renderGallery();
   window.dispatchEvent(new CustomEvent('sers-reportajes:saved',{detail:{id:p.id,reportId:p.reportId}}));
   message('Descripción actualizada.');
  }catch(e){message('Error al guardar descripción.');}
 }
 async function deletePhoto(){
  const p=photos.find(x=>x.id===dialogPhotoId);
  if(!p||!confirm('¿Eliminar definitivamente esta fotografía y su descripción de este móvil?'))return;
  try{
   await ReportDB.deletePhoto(p.id);
   const report=await ReportDB.getReport(p.reportId);
   if(report)await ReportDB.saveReport({...report,photoCount:Math.max(0,(report.photoCount||1)-1),updatedAt:now()});
   closePhoto();await reload();renderGallery();
   // La eliminación local no borra copias previas ya subidas a OneDrive.
   message('Fotografía eliminada del móvil.');
  }catch(e){message('No se pudo eliminar la fotografía.');}
 }
 function geojson(report,images){
  return {type:'FeatureCollection',name:report.name,features:images.filter(p=>p.position).map(p=>({
   type:'Feature',geometry:{type:'Point',coordinates:[p.position.longitude,p.position.latitude]},
   properties:{id:p.id,numero:p.sequence,descripcion:p.description||'',
    precision_m:p.position.accuracy,orientacion_grados:p.orientation?.degrees??null,
    orientacion_fuente:p.orientation?.method??null,fecha:p.capturedAt}
  }))};
 }
 function photoMeta(p){
  return {id:p.id,numero:p.sequence,archivo_original:p.originalName,
   nombre_archivo:'FOTO_'+labelNum(p.sequence)+'_'+p.id,
   descripcion_original:p.description,fecha_foto:p.capturedAt,
   fecha_incorporacion:p.addedAt,ultima_modificacion:p.updatedAt,
   fuente:p.source,mime:p.mime,tamano_bytes:p.size,
   gps:p.position||null,brujula:p.orientation||null};
 }
 const ext=p=>{const match=p.originalName?.match(/\.([a-zA-Z0-9]{2,5})$/);
  if(match)return match[1].toLowerCase();
  return p.mime?.includes('png')?'png':p.mime?.includes('webp')?'webp':'jpg';};
 const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,50)||'reportaje';
 async function exportReport(id,button,share=false){
  if(typeof SersZip==='undefined'){message('No se ha cargado el generador ZIP.');return;}
  button.disabled=true;
  const oldText=button.textContent;
  button.textContent=share?'Preparando para OneDrive…':'Creando ZIP…';
  try{
   const report=await ReportDB.getReport(id),images=await ReportDB.photosByReport(id);
   if(!report)throw new Error('Reportaje no encontrado');
   const files=[];
   for(const p of images){
    files.push({name:'FOTOGRAFIAS/FOTO_'+labelNum(p.sequence)+'_'+p.id+'.'+ext(p),
     data:p.file,date:p.capturedAt});
   }
   files.push({name:'DATOS/fotografias.json',data:JSON.stringify(images.map(photoMeta),null,2)});
   files.push({name:'DATOS/localizaciones.geojson',data:JSON.stringify(geojson(report,images),null,2)});
   files.push({name:'reportaje.json',data:JSON.stringify({id:report.id,nombre:report.name,
    tipo:report.type,creado:report.createdAt,actualizado:report.updatedAt,
    cerrado:report.closedAt,numero_fotos:images.length},null,2)});
   const blob=await SersZip.create(files);
   const filename='SERS_REPORTAJE_'+clean(report.name)+'_'+today()+'.zip';
   if(share&&!window.SersAndroid?.beginShareZip){
    throw new Error('Esta versión de la APK no permite compartir. Actualiza SERS Reportajes.');
   }
   if(window.SersAndroid?.beginZip){
    const started=share?window.SersAndroid.beginShareZip(filename):window.SersAndroid.beginZip(filename);
    if(!started)throw new Error('Android no pudo preparar el archivo ZIP.');
    for(let offset=0;offset<blob.size;offset+=128*1024){
     const part=new Uint8Array(await blob.slice(offset,offset+128*1024).arrayBuffer());
     let binary='';
     for(let k=0;k<part.length;k+=8192)binary+=String.fromCharCode(...part.subarray(k,k+8192));
     if(!window.SersAndroid.appendZipChunk(btoa(binary)))throw new Error('Error al escribir el ZIP en Android.');
    }
    const finished=share?window.SersAndroid.finishShareZip():window.SersAndroid.finishZip();
    if(!finished)throw new Error('Android no pudo finalizar el ZIP.');
    message(share?'Se está abriendo OneDrive para elegir la carpeta.':
      'ZIP guardado en Descargas / SERS_Reportajes.');
   }else{
    const u=URL.createObjectURL(blob),link=doc('a');
    link.href=u;link.download=filename;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);
    message('ZIP preparado. Revisa Descargas.');
   }
  }catch(e){console.error(e);message('No se pudo preparar el reportaje: '+String(e.message||e).slice(0,110));}
  finally{button.disabled=false;button.textContent=oldText;}
 }
 const mapSourceNames={pnoa:'Ortofoto PNOA',ign:'Mapa IGN',osm:'Calles'};
 const mapSources={
  pnoa:{
   url:'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg',
   attribution:'Ortofoto PNOA · © IGN/CNIG, CC BY 4.0',maxZoom:19,maxNativeZoom:19
  },
  ign:{
   url:'https://tms-ign-base.idee.es/1.0.0/IGNBaseTodo/{z}/{x}/{-y}.jpeg',
   attribution:'Mapa IGN · © IGN/CNIG, CC BY 4.0',maxZoom:19,maxNativeZoom:19
  },
  osm:{
   url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
   attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
   maxZoom:19,maxNativeZoom:19
  }
 };
 function mapToolbar(){
  for(const key of ['pnoa','ign','osm']){
   const id=key==='pnoa'?'mapAerial':key==='ign'?'mapIgn':'mapOsm';
   const selected=mapSource===key;
   $(id).classList.toggle('active',selected);
   $(id).setAttribute('aria-pressed',String(selected));
  }
 }
 function closeMap(){
  if(leafletMap){
   leafletMap.off();
   leafletMap.remove();
   leafletMap=null;
  }
  mapBaseLayer=null;leafletLayers=null;
  mapPhotoMarkers.clear();mapFocusBounds=null;
  for(const u of mapPhotoUrls)URL.revokeObjectURL(u);
  mapPhotoUrls=[];
 }
 function mapStatus(text){
  $('mapMessage').textContent=text;
 }
 function activateMapSource(which,userChosen=false){
  if(!mapSources[which])which='pnoa';
  mapSource=which;
  if(userChosen)localStorage.setItem(MAP_SOURCE_KEY,which);
  mapToolbar();
  if(!leafletMap)return;
  if(mapBaseLayer){
   leafletMap.removeLayer(mapBaseLayer);
   mapBaseLayer=null;
  }
  const cfg=mapSources[which],layer=L.tileLayer(cfg.url,{
   attribution:cfg.attribution,
   maxZoom:cfg.maxZoom,maxNativeZoom:cfg.maxNativeZoom,
   updateWhenIdle:true,keepBuffer:1,
   // El servicio IGN utiliza el índice TMS invertido {-y}.
   errorTileUrl:undefined
  });
  mapBaseLayer=layer;
  let errors=0,loads=0,fallbackStarted=false;
  layer.on('tileload',()=>{
   if(mapBaseLayer!==layer)return;
   loads++;
   if(loads===1)mapStatus(mapLocated.length+' de '+photos.length+
    ' fotos con ubicación · '+mapSourceNames[which]+'. Pulsa los números para ver cada foto.');
  });
  layer.on('tileerror',()=>{
   if(mapBaseLayer!==layer)return;
   errors++;
   if(errors>=3&&loads===0&&!fallbackStarted){
    fallbackStarted=true;
    const next=which==='pnoa'?'ign':which==='ign'?'osm':null;
    if(next){
     mapStatus(mapSourceNames[which]+' no responde. Probando '+mapSourceNames[next]+'…');
     activateMapSource(next,false);
    }else{
     mapStatus('No se han podido descargar las teselas. Los números GPS siguen visibles; comprueba la conexión.');
    }
   }
  });
  layer.addTo(leafletMap);
  // La cartografía se dibuja debajo de las fotografías numeradas.
  layer.bringToBack();
  mapStatus('Cargando '+mapSourceNames[which]+'… '+mapLocated.length+' fotos con GPS.');
 }
 function focusAllMapPhotos(){
  if(!leafletMap)return;
  leafletMap.invalidateSize({pan:false});
  if(!mapLocated.length){
   leafletMap.setView([41.65,-0.88],12,{animate:false});
  }else if(mapLocated.length===1){
   const p=mapLocated[0];
   leafletMap.setView([p.position.latitude,p.position.longitude],18,{animate:false});
  }else{
   leafletMap.fitBounds(mapFocusBounds,{padding:[35,35],maxZoom:18,animate:false});
  }
 }
 function focusMapPhoto(id){
  const item=mapPhotoMarkers.get(id),record=photos.find(p=>p.id===id);
  if(!item||!leafletMap||!record?.position)return;
  leafletMap.invalidateSize({pan:false});
  leafletMap.setView([record.position.latitude,record.position.longitude],
   Math.max(17,leafletMap.getZoom()),{animate:false});
  item.openPopup();
  const selected=$('mapList').querySelector('[data-photo-id="'+id+'"]');
  if(selected){
   for(const el of $('mapList').querySelectorAll('.selected'))el.classList.remove('selected');
   selected.classList.add('selected');
  }
 }
 function renderMap(){
  const report=active();if(!report)return;
  mapLocated=photos.filter(p=>p.position&&Number.isFinite(p.position.latitude)&&
   Number.isFinite(p.position.longitude)&&Math.abs(p.position.latitude)<=85);
  const list=$('mapList');
  list.replaceChildren();
  for(const p of photos){
   const row=doc('div','map-entry');
   const button=doc('button','map-photo-button');
   button.type='button';
   button.dataset.photoId=p.id;
   const num=doc('span','index','Nº '+labelNum(p.sequence));
   const info=doc('span','map-meta');
   info.append(doc('strong','',p.description||'Sin descripción'),doc('span','',
    p.position?'GPS ±'+Math.round(p.position.accuracy)+' m'+
      (p.orientation?' · 🧭 ≈'+Math.round(p.orientation.degrees)+'°':''):
     'Sin posición'));
   button.append(num,info);
   button.addEventListener('click',()=>{
    if(!p.position){message('Esta foto no tiene ubicación GPS.');return;}
    if(leafletMap)focusMapPhoto(p.id);
    else window.open('https://www.google.com/maps/search/?api=1&query='+
       p.position.latitude+','+p.position.longitude,'_blank','noopener');
   });
   row.append(button);
   if(p.position){
    const google=doc('a','map-external','↗');
    google.title='Abrir ubicación en Google Maps';
    google.href='https://www.google.com/maps/search/?api=1&query='+
      p.position.latitude+','+p.position.longitude;
    google.target='_blank';google.rel='noopener noreferrer';
    row.append(google);
   }
   list.append(row);
  }
  closeMap();
  const box=$('mapCanvas');
  mapToolbar();
  if(!window.L||!navigator.onLine){
   box.replaceChildren(doc('p','empty muted',navigator.onLine?
    'El visor de mapas no está disponible. Puedes abrir cada posición en Google Maps.':
    'Sin conexión. Las coordenadas de cada fotografía siguen guardadas.'));
   mapStatus(mapLocated.length+' de '+photos.length+' fotos con ubicación GPS.');
   return;
  }
  box.replaceChildren();
  try{
   leafletMap=L.map(box,{
    zoomControl:true,attributionControl:true,
    preferCanvas:false,zoomAnimation:false,markerZoomAnimation:false,
    fadeAnimation:false,worldCopyJump:false
   });
   const bounds=[];
   leafletLayers=L.layerGroup().addTo(leafletMap);
   for(const p of mapLocated){
    const latlng=[p.position.latitude,p.position.longitude];
    bounds.push(latlng);
    const accuracy=Math.max(0,Number(p.position.accuracy)||0);
    L.circle(latlng,{
     radius:accuracy,
     color:accuracy<=10?'#2b9655':accuracy<=25?'#e6a426':'#e05e3f',
     weight:2,fillOpacity:.12,interactive:false
    }).addTo(leafletLayers);
    const heading=Number(p.orientation?.degrees);
    const validHeading=p.orientation&&Number.isFinite(heading);
    // DivIcon con el número, sin depender de imágenes PNG remotas de Leaflet.
    const icon=L.divIcon({
     className:'sers-photo-marker',
     html:'<span class="photo-marker-body"><b>'+labelNum(p.sequence)+'</b>'+
       (validHeading?'<span class="photo-marker-heading" style="transform:rotate('+
        (((heading%360)+360)%360)+'deg)">▲</span>':'')+'</span>',
     iconSize:[44,46],iconAnchor:[22,23],popupAnchor:[0,-25]
    });
    const marker=L.marker(latlng,{icon,riseOnHover:true,keyboard:true,title:'Foto '+labelNum(p.sequence)})
      .addTo(leafletLayers);
    const content=doc('div','map-popup');
    const photo=doc('img');
    const url=URL.createObjectURL(p.file);mapPhotoUrls.push(url);
    photo.src=url;photo.alt='Fotografía '+labelNum(p.sequence);
    photo.loading='lazy';
    content.append(doc('strong','', 'FOTO '+labelNum(p.sequence)),photo,
     doc('p','',p.description||'Sin descripción'),
     doc('small','', 'GPS ±'+Math.round(accuracy)+' m'+
      (validHeading?' · Dirección ≈'+Math.round(heading)+'°':'')));
    marker.bindPopup(content,{maxWidth:245,minWidth:160});
    marker.on('click',()=>{
     const row=list.querySelector('[data-photo-id="'+p.id+'"]');
     if(row){
      for(const el of list.querySelectorAll('.selected'))el.classList.remove('selected');
      row.classList.add('selected');
     }
    });
    mapPhotoMarkers.set(p.id,marker);
   }
   mapFocusBounds=bounds.length?L.latLngBounds(bounds):null;
   // Primero el mapa, luego el ajuste sobre las fotos. InvalidateSize es
   // imprescindible en WebView al cambiar de una pestaña oculta al mapa.
   leafletMap.setView(bounds[0]||[41.65,-0.88],bounds.length?17:12,{animate:false});
   activateMapSource(mapSource,false);
   requestAnimationFrame(()=>{
    if(!leafletMap)return;
    focusAllMapPhotos();
    setTimeout(()=>{if(leafletMap){leafletMap.invalidateSize({pan:false});focusAllMapPhotos();}},350);
   });
   mapStatus(mapLocated.length+' de '+photos.length+' fotos con ubicación GPS.');
  }catch(e){
   console.error('Error al iniciar visor',e);
   closeMap();
   box.replaceChildren(doc('p','empty muted','No se pudo mostrar el mapa. Puedes abrir cada foto en Google Maps.'));
   mapStatus('Coordenadas disponibles: '+mapLocated.length+' de '+photos.length+'.');
  }
 }
 async function boot(){
  network();
  // El envío nativo a OneDrive no requiere Microsoft Entra.
  // En la APK ocultamos el panel OAuth de la versión web, todavía experimental.
  if(window.SersAndroid?.beginShareZip){
   document.querySelector('.sync-panel')?.classList.add('hidden');
  }
  try{
   await reload();
   renderHome();
   const saved=await ReportDB.getDraft();
   if(saved?.file){
    const report=reports.find(r=>r.id===saved.reportId);
    if(report){activeId=report.id;localStorage.setItem(KEY,activeId);}
   }
  }catch(e){console.error(e);message('No se pudo abrir el almacenamiento del móvil.');}
 }
 $('createReport').addEventListener('click',createReport);
 $('importReportBtn').addEventListener('click',()=>$('importZipInput').click());
 $('importZipInput').addEventListener('change',importReport);
 $('resumeRecent').addEventListener('click',()=>reports[0]&&selectReport(reports[0].id,reports[0].closedAt?'gallery':'capture'));
 for(const name of ['home','capture','gallery','map']){
  $('nav'+name[0].toUpperCase()+name.slice(1)).addEventListener('click',()=>chooseView(name));
 }
 $('captureBack').addEventListener('click',()=>chooseView('home'));
 $('gpsRefresh').addEventListener('click',refreshGPS);
 $('compassEnable').addEventListener('click',requestCompass);
 function launchCamera(){
  cameraStart={position:gpsSnapshot(),orientation:headingSnapshot(),at:now()};
  $('cameraInput').click();
 }
 $('cameraButton').addEventListener('click',launchCamera);
 $('replacePhoto').addEventListener('click',launchCamera);
 $('galleryPick').addEventListener('click',()=>$('galleryInput').click());
 $('cameraInput').addEventListener('change',e=>photoSelected(e,'camera'));
 $('galleryInput').addEventListener('change',e=>photoSelected(e,'gallery'));
 $('photoDescription').addEventListener('input',()=>{
  if(draft?.file){draft.description=$('photoDescription').value;scheduleDraft();}
 });
 $('dictate').addEventListener('click',startDictation);
 $('saveAndNext').addEventListener('click',savePhoto);
 $('dialogClose').addEventListener('click',closePhoto);
 $('dialogSave').addEventListener('click',editPhoto);
 $('dialogDelete').addEventListener('click',deletePhoto);
 for(const [id,source] of [['mapAerial','pnoa'],['mapIgn','ign'],['mapOsm','osm']]){
  $(id).addEventListener('click',()=>activateMapSource(source,true));
 }
 $('mapFit').addEventListener('click',focusAllMapPhotos);
 $('photoDialog').addEventListener('close',()=>{
  dialogPhotoId=null;if(dialogUrl)URL.revokeObjectURL(dialogUrl);dialogUrl=null;
 });
 window.addEventListener('online',network);
 window.addEventListener('offline',network);
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&currentView==='capture'){startGPS();updateSensors();}
 });
 setInterval(()=>{if(currentView==='capture')updateSensors();},1000);
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(console.warn);
 boot();
 window.SersReportajes={photoMeta,geojson,reportPhotos:()=>ReportDB.allPhotos(),reportList:()=>ReportDB.listReports()};
})();
