'use strict';
/* SERS Reportajes · toda la captura funciona sin conexión y sin cuentas. */
(() => {
 const $=id=>document.getElementById(id), now=()=>new Date().toISOString();
 const uid=()=>globalThis.crypto?.randomUUID?.()||
  ('r'+Date.now().toString(36)+Math.random().toString(36).slice(2,11));
 const KEY='sers-reportajes-active-v1';
 let reports=[],activeId=localStorage.getItem(KEY)||'',photos=[],draft=null;
 let selectedReportId=activeId,reportStats=new Map(),galleryOnlyMissing=false,lastPhotoUrl=null,pendingMapPhotoId=null;
 let currentView='home',gps=null,gpsError='',heading=null,watchId=null,dictation=null,dictating=false,cameraStart=null;
 let draftQueue=Promise.resolve(),draftTimer=null,toastTimer=null,captureUrl=null,dialogUrl=null,dialogPhotoId=null,cardUrls=[],leafletMap=null,leafletLayers=null;
 let mapBaseLayer=null,mapPhotoMarkers=new Map(),mapPhotoUrls=[],mapFocusBounds=null,mapLocated=[];
 let mapMarkerLayer=null,mapSpiderLayer=null,mapPhotoGroups=new Map(),mapAccuracyLayer=null;
 const MAP_SOURCE_KEY='sers-reportajes-map-source-v1';
 let mapSource=localStorage.getItem(MAP_SOURCE_KEY)||'pnoa';
 let leafletLoadPromise=null;
 let archivePromise=Promise.resolve(),archiveError=null,archiveProbeDone=false;
 let captureOpenEpoch=0;
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
  reportStats=new Map();
  for(const p of await ReportDB.allPhotos()){
   const st=reportStats.get(p.reportId)||{count:0,missing:0};
   st.count++;
   if(!String(p.description||'').trim())st.missing++;
   reportStats.set(p.reportId,st);
  }
  if(!reports.some(r=>r.id===selectedReportId))selectedReportId=reports[0]?.id||'';
 }
 async function saveReport(report){
  report.updatedAt=now();
  if(SersVault.available())await SersVault.writeReport(report);
  await ReportDB.saveReport(report);
  await reload();
 }
 const reportStat=id=>reportStats.get(id)||{count:0,missing:0};
 async function setReportSelection(id){
  if(!reports.some(r=>r.id===id))return;
  selectedReportId=id;
  activeId=id;
  localStorage.setItem(KEY,id);
  photos=await ReportDB.photosByReport(id);
  renderHome();
 }
 function selectedReport(){return reports.find(r=>r.id===selectedReportId)||null;}
 function selectedStatsText(r){
  const st=reportStat(r.id);
  return st.count+' fotos · '+(st.count-st.missing)+' descritas'+
   (st.missing?' · '+st.missing+' pendientes':'')+
   ' · '+dateNice(r.updatedAt)+(r.closedAt?' · Finalizado':' · En curso');
 }
 function renderHome(){
  const last=reports[0],recent=$('recentBox');
  recent.classList.toggle('hidden',!last);
  $('allCount').textContent=reports.length+' reportajes';
  if(last){
   $('recentName').textContent=last.name;
   $('recentInfo').textContent=last.closedAt?'Finalizado':'En curso';
   $('recentCount').textContent=reportStat(last.id).count+' fotos';
  }
  if(!reports.length)$('newReportForm').classList.remove('hidden');
  const holder=$('reportsList'),search=$('reportSearch').value.trim().toLocaleLowerCase('es');
  holder.replaceChildren();
  const matched=reports.filter(r=>r.name.toLocaleLowerCase('es').includes(search));
  if(!matched.length)holder.append(doc('p','muted empty',
    reports.length?'No hay reportajes con ese nombre.':'Crea tu primer reportaje.'));
  for(const r of matched){
   const selected=r.id===selectedReportId;
   const row=doc('button','report-select'+(selected?' selected':''));
   row.type='button';row.role='option';row.setAttribute('aria-selected',String(selected));
   const radio=doc('span','report-radio',selected?'●':'○');
   const text=doc('span','report-select-info');
   text.append(doc('strong','',r.name),doc('small','',selectedStatsText(r)));
   const indicator=doc('span','report-chevron',selected?'✓':'›');
   row.append(radio,text,indicator);
   row.addEventListener('click',()=>setReportSelection(r.id));
   holder.append(row);
  }
  const sel=selectedReport();
  $('selectedReportActions').classList.toggle('hidden',!sel);
  if(!sel)return;
  $('selectedReportName').textContent=sel.name;
  $('selectedReportMeta').textContent=selectedStatsText(sel);
  const st=reportStat(sel.id);
  $('actionCapture').textContent=sel.closedAt?'↻ Reabrir':'📷 Seguir fotografiando';
  $('actionToggleClosed').textContent=sel.closedAt?'Reabrir reportaje':'Finalizar reportaje';
  $('actionShare').classList.toggle('hidden',!window.SersAndroid?.beginShareZip);
  const pending=$('actionPending');
  pending.classList.toggle('hidden',st.missing===0);
  pending.textContent='⚠ '+st.missing+' foto'+(st.missing!==1?'s':'')+
   ' sin descripción · Revisar';
 }
 async function toggleSelectedClosed(){
  const r=selectedReport();if(!r)return;
  if(!r.closedAt&&!confirm('¿Finalizar «'+r.name+'»? Después podrás reabrirlo.'))return;
  const fresh=await ReportDB.getReport(r.id);
  if(!fresh)return;
  fresh.closedAt=fresh.closedAt?null:now();
  await saveReport(fresh);renderHome();
 }
 async function deleteSelectedReport(){
  const r=selectedReport();if(!r)return;
  const st=reportStat(r.id);
  const label='«'+r.name+'» ('+st.count+' fotografías)';
  if(!confirm('¿Quitar '+label+' de la aplicación?\n\nLas fotografías y sus fichas JSON permanecerán en la galería y en Descargas como copia de seguridad.'))return;
  try{
   if(draft?.reportId===r.id){await saveDraftNow();draft=null;setCaptureUrl(null);}
   await ReportDB.deleteReport(r.id);
   if(activeId===r.id){activeId='';localStorage.removeItem(KEY);}
   selectedReportId='';
   galleryOnlyMissing=false;
   await reload();
   renderHome();
   message('Reportaje eliminado del móvil. Las copias de OneDrive no se borran.');
  }catch(error){console.error(error);message('No se pudo eliminar: '+String(error.message||error).slice(0,90));}
 }
 async function createReport(){
  const name=$('reportName').value.trim();
  if(name.length<3){message('Escribe un nombre de reportaje de al menos 3 caracteres.');return;}
  const r={id:uid(),name,type:'reportaje',createdAt:now(),updatedAt:now(),closedAt:null,photoCount:0};
  try{
   if(SersVault.available())await SersVault.writeReport(r);
   await ReportDB.saveReport(r);
   $('reportName').value='';
   await reload();
   selectedReportId=r.id;
   $('newReportForm').classList.add('hidden');
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
  activeId=id;selectedReportId=id;localStorage.setItem(KEY,id);
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
  const epoch=++captureOpenEpoch;
  const reportId=r.id;
  $('capTitle').textContent=r.name;
  $('capCounter').textContent='Fotografía '+labelNum((r.photoCount||0)+1);
  startGPS();enableCompass();updateSensors();
  try{
   const saved=await ReportDB.getDraft();
   // Una lectura anterior no puede borrar el borrador de una foto que
   // llegó de la cámara mientras IndexedDB estaba respondiendo.
   if(epoch!==captureOpenEpoch||currentView!=='capture'||activeId!==reportId)return;
   if(draft?.file){
    renderDraft();
    return;
   }
   draft=saved?.file&&saved.reportId===reportId?saved:null;
   renderDraft();
   if(draft?.file&&SersVault.available()&&!draft.archivedName){
    archivePromise=copyDraftToGallery(draft).catch(e=>{
     archiveStatus('⚠ No se pudo recuperar la copia: '+e.message,'error');
    });
   }
   if(saved?.file&&saved.reportId!==reportId)
    message('Hay una fotografía pendiente en otro reportaje.');
  }catch(e){
   console.error('No se pudo cargar el borrador',e);
   // No eliminar la fotografía actual si IndexedDB falla.
   if(!draft?.file)message('No se pudo consultar el borrador; no se borrarán fotografías.');
  }
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
 function renderLastPhoto(){
  const last=photos.at(-1),button=$('captureLast');
  button.classList.toggle('hidden',!last);
  if(last){
   if(lastPhotoUrl)URL.revokeObjectURL(lastPhotoUrl);
   lastPhotoUrl=URL.createObjectURL(last.file);
   $('captureLastImg').src=lastPhotoUrl;
   $('captureLastTitle').textContent='Última: foto '+labelNum(last.sequence);
  }else if(lastPhotoUrl){URL.revokeObjectURL(lastPhotoUrl);lastPhotoUrl=null;}
 }
 function renderDraft(){
  const hasFile=Boolean(draft?.file);
  renderLastPhoto();
  $('captureEmpty').classList.toggle('hidden',hasFile);
  $('captureFilled').classList.toggle('hidden',!hasFile);
  setCaptureUrl(hasFile?draft.file:null);
  updatePhotoLocationInfo();
  $('photoDescription').value=draft?.description||'';
  $('dictateStatus').textContent='';
  if(hasFile){
   archiveStatus(draft.archivedName?'✓ Fotografía copiada a la galería':
    'Preparando copia de seguridad…',draft.archivedName?'success':'checking');
  }
 }
 function archiveStatus(text,level='checking'){
  const el=$('archiveStatus');if(!el)return;
  el.textContent=text;el.className='archive-status '+level;
 }
 function scheduleDraft(){
  if(!draft?.file)return;
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>saveDraftNow(),550);
 }
 function saveDraftNow(){
  clearTimeout(draftTimer);
  if(!draft?.file)return draftQueue;
  const copy={...draft};
  draftQueue=draftQueue.catch(()=>{}).then(async()=>{
   // Guardar primero la ficha externa; si falla IndexedDB la descripción,
   // GPS y brújula siguen disponibles en Descargas.
   if(SersVault.available()&&copy.archivedName){
    const parent=await ReportDB.getReport(copy.reportId);
    if(parent)await SersVault.writePhoto({
     id:copy.photoId,reportId:copy.reportId,sequence:copy.sequence,
     archivedName:copy.archivedName,originalName:copy.originalName,
     mime:copy.file.type,size:copy.file.size,source:copy.source,
     capturedAt:copy.capturedAt,addedAt:copy.selectedAt,updatedAt:now(),
     description:copy.description,position:copy.position,
     orientation:copy.orientation,recordState:'draft'
    },parent);
   }
   await ReportDB.saveDraft(copy);
  });
  draftQueue.catch(e=>{
   console.error('Error guardando borrador o ficha',e);
   archiveStatus('⚠ No se ha confirmado la ficha externa. Conserva la foto y reintenta.', 'error');
  });
  return draftQueue;
 }
 async function copyDraftToGallery(target=draft){
  if(!SersVault.available()||!target?.file)return;
  const parent=await ReportDB.getReport(target.reportId);
  if(!parent)throw new Error('No existe el reportaje para archivar la foto.');
  archiveStatus('Guardando fotografía original en la galería…','checking');
  // La cámara nativa ya ha escrito el original directamente en Galería.
  // Sólo copiar bytes cuando procede del selector de imágenes.
  const name=target.archivedName||
   await SersVault.archiveFile(target.file,parent,target.photoId);
  // No sustituir el borrador de otra fotografía.
  if(!draft||draft.photoId!==target.photoId)return;
  draft.archivedName=name;
  archiveStatus('Guardando descripción, GPS y orientación en Descargas…','checking');
  await saveDraftNow();
  archiveStatus('✓ Copia guardada en Galería y ficha JSON en Descargas','success');
 }
 async function photoSelected(event,source,native=null){
  const file=native?.file||event?.target?.files?.[0];
  if(event?.target)event.target.value='';
  if(!file)return;
  if(!file.type.startsWith('image/')){message('Selecciona un archivo de imagen.');return;}
  stopDictation();
  if(draft?.file&&!confirm('¿Sustituir la foto pendiente? La fotografía anterior se conserva si ya está en la galería.'))return;
  const captureTime=source==='camera'?now():new Date(file.lastModified||Date.now()).toISOString();
  let position=source==='camera'?gpsSnapshot():null;
  let orientationValue=source==='camera'?headingSnapshot():null;
  if(source==='camera'&&cameraStart&&Date.now()-Date.parse(cameraStart.at)<120000){
   if(!position&&cameraStart.position)position={...cameraStart.position,context:'antes_de_camara'};
   if(!orientationValue&&cameraStart.orientation)orientationValue={...cameraStart.orientation,
     method:cameraStart.orientation.method+'-antes-de-camara'};
  }
  const reportId=source==='camera'&&cameraStart?.reportId?
   cameraStart.reportId:activeId;
  const seq=(await ReportDB.photosByReport(reportId)).reduce((m,p)=>
   Math.max(m,p.sequence||0),0)+1;
  const photoId=native?.photoId||(source==='camera'&&cameraStart?.photoId?
   cameraStart.photoId:uid());
  draft={id:'capture',reportId,photoId,sequence:seq,
   file,originalName:file.name,description:'',source,
   archivedName:native?.archivedName||null,
   capturedAt:captureTime,selectedAt:now(),position,orientation:orientationValue};
  cameraStart=null;
  renderDraft();
  archiveStatus('Preparando copias de seguridad…','checking');
  try{
   archiveError=null;
   // Copia externa primero: aunque falle IndexedDB, la foto y su ficha
   // quedan independientes de la memoria interna de WebView.
   archivePromise=copyDraftToGallery(draft);
   await archivePromise;
  }catch(e){
   archiveError=e;
   console.error('No se pudo proteger fotografía',e);
   archiveStatus('⚠ ERROR AL GUARDAR COPIA: '+e.message,'error');
   message('La imagen sigue pendiente. No continúes hasta resolver el error.');
  }
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
 async function getDraftReportOrRestore(target){
  // El identificador del reportaje se fijó al hacer la foto. No utilizar
  // activeId después de operaciones asíncronas, porque puede cambiar con
  // la selección, navegación, recarga o recuperación de reportajes.
  const id=target?.reportId;
  if(!id||!target?.photoId)throw new Error('La fotografía no tiene un reportaje identificado.');
  let report=await ReportDB.getReport(id);
  if(report)return report;
  // Si el índice interno falla pero conservamos una ficha REPORT externa
  // con este mismo ID, restaurar únicamente el padre, sin modificar fotos.
  if(SersVault.available()){
   const snapshot=SersVault.index().reports.find(x=>x.id===id);
   if(snapshot){
    report={
     id:snapshot.id,
     name:snapshot.name||'Reportaje recuperado',
     type:'reportaje',
     createdAt:snapshot.createdAt||target.capturedAt||now(),
     updatedAt:snapshot.updatedAt||now(),
     closedAt:snapshot.closedAt||null,
     photoCount:0
    };
    await ReportDB.saveReport(report);
    // Actualizar lista, pero sin sustituir el objeto draft actual.
    reports=(await ReportDB.listReports()).sort((a,b)=>
     String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return report;
   }
  }
  throw new Error('No encuentro el identificador original del reportaje ('+
    String(id).slice(0,12)+'). La foto queda pendiente; no se borra.');
 }
 async function savePhoto(){
  if(!draft?.file){message('Haz una fotografía primero.');return;}
  if($('saveAndNext').disabled)return;
  $('saveAndNext').disabled=true;
  const task={...draft}; // ID e imagen inmutables durante el guardado.
  try{
   // Iniciar resolución por ID propio de la foto, no por activeId global.
   // El reportaje puede recuperarse por su ficha externa si IndexedDB perdió
   // únicamente el índice del reportaje.
   const report=await getDraftReportOrRestore(task);
   await stopDictation();
   task.description=$('photoDescription').value;
   if(draft?.photoId!==task.photoId)
    throw new Error('Ha cambiado la fotografía pendiente. No se guardará otra por error.');
   draft.description=task.description;
   await archivePromise.catch(()=>{});
   if(SersVault.available()&&!draft.archivedName){
    archiveError=null;
    await copyDraftToGallery(draft);
   }
   if(SersVault.available()&&!draft.archivedName)
    throw new Error('La fotografía todavía no está copiada en Galería.');
   // Fijar versión final del borrador antes de escribir. El dictado no debe
   // renombrar ni cambiar el reportaje asociado mientras se almacena.
   task.archivedName=draft.archivedName;
   task.position=draft.position;
   task.orientation=draft.orientation;
   task.description=$('photoDescription').value;
   draft.description=task.description;
   await saveDraftNow();
   await draftQueue;
   const parent=await getDraftReportOrRestore(task);
   const existing=await ReportDB.getPhoto(task.photoId);
   const seq=existing?.sequence||task.sequence||
     (await ReportDB.photosByReport(task.reportId)).reduce((n,p)=>
       Math.max(n,p.sequence||0),0)+1;
   const item={
    id:task.photoId,reportId:task.reportId,sequence:seq,
    file:task.file,originalName:task.originalName,
    archivedName:task.archivedName||null,mime:task.file.type,
    size:task.file.size,source:task.source,
    capturedAt:task.capturedAt,
    addedAt:task.selectedAt||now(),updatedAt:now(),
    description:task.description||'',
    position:task.position,orientation:task.orientation
   };
   // Nunca confirmar foto por la sola existencia del JPG; también debe
   // quedar la ficha JSON del dictado y sensores.
   if(SersVault.available())await SersVault.writePhoto(item,parent);
   await ReportDB.savePhoto(item);
   parent.photoCount=(await ReportDB.photosByReport(task.reportId)).length;
   parent.closedAt=null;parent.updatedAt=now();
   if(SersVault.available())await SersVault.writeReport(parent);
   await ReportDB.saveReport(parent);
   // Solo descartar el borrador cuando foto, JSON y reportaje estén escritos.
   await ReportDB.clearDraft();
   if(draft?.photoId===task.photoId)draft=null;
   if(activeId!==task.reportId){
    activeId=task.reportId;selectedReportId=task.reportId;
    localStorage.setItem(KEY,task.reportId);
   }
   await reload();
   $('capCounter').textContent='Fotografía '+labelNum(parent.photoCount+1);
   renderDraft();
   window.dispatchEvent(new CustomEvent('sers-reportajes:saved',{
    detail:{id:item.id,reportId:task.reportId}}));
   message('✓ Foto '+labelNum(seq)+' guardada con descripción, GPS y orientación.');
  }catch(e){
   console.error('Error guardando foto ID',task.photoId,
    'reportaje de la foto',task.reportId,'reportaje activo',activeId,e);
   archiveStatus('⚠ NO GUARDADA COMPLETAMENTE: '+String(e.message||e),'error');
   message('El guardado no ha terminado. La fotografía pendiente sigue disponible.');
  }finally{$('saveAndNext').disabled=false;}
 }
 function clearCardUrls(){
  for(const u of cardUrls)URL.revokeObjectURL(u);
  cardUrls=[];
 }
 function renderGallery(){
  const report=active();if(!report)return;
  $('gallerySubtitle').textContent=report.name+' · '+photos.length+' fotografías';
  const missingCount=photos.filter(p=>!String(p.description||'').trim()).length;
  $('galleryMissingCount').textContent=missingCount?'('+missingCount+')':'';
  $('galleryShowAll').classList.toggle('active',!galleryOnlyMissing);
  $('galleryMissing').classList.toggle('active',galleryOnlyMissing);
  $('galleryShowAll').setAttribute('aria-pressed',String(!galleryOnlyMissing));
  $('galleryMissing').setAttribute('aria-pressed',String(galleryOnlyMissing));
  const visible=galleryOnlyMissing?photos.filter(p=>!String(p.description||'').trim()):photos;
  $('galleryEmpty').classList.toggle('hidden',visible.length>0);
  $('galleryEmpty').textContent=galleryOnlyMissing?'No quedan fotografías sin descripción.':
   'Este reportaje todavía no tiene fotografías.';
  clearCardUrls();const holder=$('galleryList');holder.replaceChildren();
  for(const p of visible){
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
  const i=photos.findIndex(x=>x.id===p.id);
  $('dialogPrev').disabled=i<=0;
  $('dialogNext').disabled=i>=photos.length-1;
  $('dialogLocate').disabled=!p.position;
  if(!$('photoDialog').open)$('photoDialog').showModal();
 }
 function closePhoto(){
  $('photoDialog').close();
  dialogPhotoId=null;
  if(dialogUrl)URL.revokeObjectURL(dialogUrl);
  dialogUrl=null;
 }
 async function saveOpenPhotoChanges(){
  if(!dialogPhotoId)return false;
  const p=photos.find(x=>x.id===dialogPhotoId);
  if(!p)return false;
  const newText=$('dialogDescription').value;
  if(p.description===newText)return true;
  const changed={...p,description:newText,updatedAt:now()};
  const report=await ReportDB.getReport(p.reportId);
  if(SersVault.available()){
   if(!changed.archivedName)changed.archivedName=await SersVault.archiveFile(changed.file,report,changed.id);
   await SersVault.writePhoto(changed,report);
  }
  await ReportDB.savePhoto(changed);
  if(report)await ReportDB.saveReport({...report,updatedAt:now()});
  await reload();
  window.dispatchEvent(new CustomEvent('sers-reportajes:saved',{detail:{id:p.id,reportId:p.reportId}}));
  return true;
 }
 async function editPhoto(){
  try{
   await saveOpenPhotoChanges();closePhoto();renderGallery();
   message('Descripción guardada.');
  }catch(e){console.error(e);message('Error al guardar descripción.');}
 }
 async function stepPhoto(direction){
  if(!dialogPhotoId)return;
  const i=photos.findIndex(p=>p.id===dialogPhotoId);
  const target=photos[i+direction];if(!target)return;
  try{await saveOpenPhotoChanges();showPhoto(target.id);}
  catch(e){message('No se pudieron guardar los cambios.');}
 }
 async function locateOpenPhoto(){
  const id=dialogPhotoId,p=photos.find(x=>x.id===id);
  if(!p?.position)return;
  try{await saveOpenPhotoChanges();}
  catch(e){message('No se pudo guardar la descripción.');return;}
  closePhoto();
  pendingMapPhotoId=id;
  chooseView('map');
 }
 async function deletePhoto(){
  const p=photos.find(x=>x.id===dialogPhotoId);
  if(!p||!confirm('¿Quitar esta fotografía de la aplicación? La copia en Galería y su ficha JSON permanecerán para poder recuperarla.'))return;
  try{
   // Las copias de seguridad de Galería y Descargas se conservan.
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
  mapBaseLayer=null;leafletLayers=null;mapMarkerLayer=null;mapSpiderLayer=null;mapAccuracyLayer=null;
  mapPhotoMarkers.clear();mapPhotoGroups.clear();mapFocusBounds=null;
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
 function highlightMapRow(id){
  const list=$('mapList');
  const target=list.querySelector('[data-photo-id="'+id+'"]');
  for(const el of list.querySelectorAll('.selected'))el.classList.remove('selected');
  if(target)target.classList.add('selected');
 }
 function makePhotoMapIcon(p){
  const deg=Number(p.orientation?.degrees),hasCompass=p.orientation&&Number.isFinite(deg);
  return L.divIcon({
   className:'sers-photo-marker',
   html:'<span class="photo-marker-body"><b>'+labelNum(p.sequence)+'</b>'+
    (hasCompass?'<span class="photo-marker-heading" style="transform:rotate('+
     (((deg%360)+360)%360)+'deg)">▲</span>':'')+'</span>',
   iconSize:[44,46],iconAnchor:[22,23],popupAnchor:[0,-25]
  });
 }
 function makePhotoPopup(p){
  const content=doc('div','map-popup'),photo=doc('img');
  const url=URL.createObjectURL(p.file);mapPhotoUrls.push(url);
  photo.src=url;photo.alt='Foto '+labelNum(p.sequence);photo.loading='lazy';
  const accuracy=Math.round(Number(p.position?.accuracy)||0);
  const heading=Number(p.orientation?.degrees);
  const btn=doc('button','map-popup-open','Ver fotografía en grande');
  btn.type='button';btn.addEventListener('click',()=>showPhoto(p.id));
  content.append(doc('strong','', 'FOTO '+labelNum(p.sequence)),
   photo,doc('p','',p.description||'Sin descripción'),
   doc('small','', 'GPS ±'+accuracy+' m'+(p.orientation&&Number.isFinite(heading)?
    ' · 🧭 ≈'+Math.round(heading)+'°':'')),btn);
  return content;
 }
 function makePhotoMapMarker(p,position){
  const marker=L.marker(position||[p.position.latitude,p.position.longitude],{
   icon:makePhotoMapIcon(p),riseOnHover:true,keyboard:true,
   title:'Foto '+labelNum(p.sequence)
  });
  marker.bindPopup(makePhotoPopup(p),{maxWidth:250,minWidth:168});
  marker.on('click',()=>highlightMapRow(p.id));
  return marker;
 }
 function spiderfyGroup(group,openId=null){
  if(!leafletMap||!mapSpiderLayer)return;
  mapSpiderLayer.clearLayers();
  const center=leafletMap.latLngToContainerPoint([group.center[0],group.center[1]]);
  const n=group.photos.length;
  const radius=Math.max(52,Math.min(115,34+9*n));
  for(let i=0;i<n;i++){
   const angle=2*Math.PI*i/n-Math.PI/2;
   const point=L.point(center.x+Math.cos(angle)*radius,center.y+Math.sin(angle)*radius);
   const placed=leafletMap.containerPointToLatLng(point);
   const p=group.photos[i];
   L.polyline([group.center,placed],{color:'#25593d',weight:2,opacity:.85,interactive:false})
    .addTo(mapSpiderLayer);
   const marker=makePhotoMapMarker(p,placed).addTo(mapSpiderLayer);
   mapPhotoMarkers.set(p.id,marker);
   if(openId===p.id)marker.openPopup();
  }
 }
 function drawMapMarkers(){
  if(!leafletMap||!mapMarkerLayer)return;
  mapMarkerLayer.clearLayers();
  mapSpiderLayer?.clearLayers();
  for(const u of mapPhotoUrls)URL.revokeObjectURL(u);
  mapPhotoUrls=[];
  mapPhotoMarkers.clear();mapPhotoGroups.clear();
  // Agrupación en píxeles, no en coordenadas. Las coordenadas originales
  // se mantienen; al pulsar el grupo se separan solo los marcadores visuales.
  const groups=[];
  for(const p of mapLocated){
   const point=leafletMap.latLngToContainerPoint([p.position.latitude,p.position.longitude]);
   let group=groups.find(g=>g.anchor.distanceTo(point)<49);
   if(!group){group={anchor:point,photos:[],center:[p.position.latitude,p.position.longitude]};groups.push(group);}
   group.photos.push(p);
  }
  for(const group of groups){
   if(group.photos.length===1){
    const p=group.photos[0],marker=makePhotoMapMarker(p).addTo(mapMarkerLayer);
    mapPhotoMarkers.set(p.id,marker);
   }else{
    const count=group.photos.length;
    const icon=L.divIcon({
     className:'sers-cluster-marker',
     html:'<span class="sers-cluster-number">'+count+'<small> fotos</small></span>',
     iconSize:[61,49],iconAnchor:[30,24]
    });
    const cluster=L.marker(group.center,{icon,title:count+' fotos realizadas aquí'}).addTo(mapMarkerLayer);
    cluster.on('click',()=>spiderfyGroup(group));
    for(const p of group.photos)mapPhotoGroups.set(p.id,group);
   }
  }
 }
 function focusMapPhoto(id){
  const record=photos.find(p=>p.id===id);
  if(!leafletMap||!record?.position)return;
  leafletMap.invalidateSize({pan:false});
  leafletMap.setView([record.position.latitude,record.position.longitude],
   Math.max(17,leafletMap.getZoom()),{animate:false});
  drawMapMarkers();
  const group=mapPhotoGroups.get(id);
  if(group)spiderfyGroup(group,id);
  else mapPhotoMarkers.get(id)?.openPopup();
  highlightMapRow(id);
 }
 /**
  * La versión web carga Leaflet por CDN; en la APK está incluida la librería.
  * Si un service worker antiguo ha interceptado ./leaflet.js y devuelve 404,
  * probar otro origen antes de descartar el mapa.
  */
 async function ensureLeaflet(){
  if(window.L)return true;
  if(!navigator.onLine)return false;
  if(leafletLoadPromise)return leafletLoadPromise;
  const sources=[
   'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
   'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  ];
  leafletLoadPromise=(async()=>{
   for(const src of sources){
    if(window.L)return true;
    mapStatus('Cargando visor del mapa…');
    try{
     await new Promise((resolve,reject)=>{
      const script=doc('script');
      const timer=setTimeout(()=>{script.remove();reject(new Error('Tiempo de espera agotado'));},11000);
      script.src=src;
      script.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin='anonymous';
      script.onload=()=>{clearTimeout(timer);resolve();};
      script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Carga bloqueada'));};
      document.head.append(script);
     });
     if(window.L)return true;
    }catch(e){console.warn('No se pudo cargar Leaflet',src,String(e));}
   }
   return Boolean(window.L);
  })();
  const loaded=await leafletLoadPromise;
  if(!loaded)leafletLoadPromise=null;
  return loaded;
 }
 async function disableNativeServiceWorker(){
  if(!window.SersAndroid?.beginShareZip||!('serviceWorker'in navigator))return;
  try{
   const registrations=await navigator.serviceWorker.getRegistrations();
   const removed=await Promise.all(registrations.filter(r=>r.scope.includes('/sers-diario-piloto/reportajes/')).map(r=>r.unregister()));
   if(removed.some(Boolean)&&navigator.serviceWorker.controller&&
      sessionStorage.getItem('sers-reportajes-sw-reload-v5')!=='yes'){
    sessionStorage.setItem('sers-reportajes-sw-reload-v5','yes');
    window.location.reload();
   }
  }catch(error){console.warn('No se pudo limpiar el antiguo service worker',error);}
 }
 async function renderMap(){
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
  if(navigator.onLine&&!window.L){
   mapStatus('Preparando visor Leaflet…');
   const loaded=await ensureLeaflet();
   if(!loaded)console.warn('Leaflet no se ha podido inicializar. Se mantienen los enlaces GPS.');
   if(currentView!=='map')return;
  }
  if(!window.L||!navigator.onLine){
   box.replaceChildren(doc('p','empty muted',navigator.onLine?
    'No se ha podido cargar Leaflet. Revisa la conexión. Las coordenadas y Google Maps siguen disponibles.':
    'Sin conexión. Las coordenadas de cada fotografía siguen guardadas.'));
   mapStatus(mapLocated.length+' de '+photos.length+' fotos con ubicación GPS · visor no cargado.');
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
   mapAccuracyLayer=L.layerGroup().addTo(leafletMap);
   mapMarkerLayer=L.layerGroup().addTo(leafletMap);
   mapSpiderLayer=L.layerGroup().addTo(leafletMap);
   for(const p of mapLocated){
    const latlng=[p.position.latitude,p.position.longitude];
    bounds.push(latlng);
    const accuracy=Math.max(0,Number(p.position.accuracy)||0);
    L.circle(latlng,{
     radius:accuracy,
     color:accuracy<=10?'#2b9655':accuracy<=25?'#e6a426':'#e05e3f',
     weight:2,fillOpacity:.12,interactive:false
    }).addTo(mapAccuracyLayer);
   }
   leafletMap.on('zoomend moveend',drawMapMarkers);
   mapFocusBounds=bounds.length?L.latLngBounds(bounds):null;
   // Primero el mapa, luego el ajuste sobre las fotos. InvalidateSize es
   // imprescindible en WebView al cambiar de una pestaña oculta al mapa.
   leafletMap.setView(bounds[0]||[41.65,-0.88],bounds.length?17:12,{animate:false});
   activateMapSource(mapSource,false);
   requestAnimationFrame(()=>{
    if(!leafletMap)return;
    focusAllMapPhotos();
    drawMapMarkers();
    setTimeout(()=>{
     if(leafletMap){
      leafletMap.invalidateSize({pan:false});focusAllMapPhotos();drawMapMarkers();
      if(pendingMapPhotoId){const id=pendingMapPhotoId;pendingMapPhotoId=null;focusMapPhoto(id);}
     }
    },350);
   });
   mapStatus(mapLocated.length+' de '+photos.length+' fotos con ubicación GPS.');
  }catch(e){
   console.error('Error al iniciar visor',e);
   closeMap();
   box.replaceChildren(doc('p','empty muted','No se pudo mostrar el mapa. Puedes abrir cada foto en Google Maps.'));
   mapStatus('Coordenadas disponibles: '+mapLocated.length+' de '+photos.length+'.');
  }
 }
 async function checkRecoverable(){
  if(!SersVault.available())return;
  try{
   const external=SersVault.index();
   const inDb=new Set((await ReportDB.allPhotos()).map(p=>p.id));
   const existingReports=new Set((await ReportDB.listReports()).map(r=>r.id));
   const missing=external.photos.filter(p=>!inDb.has(p.id));
   const missingReports=external.reports.filter(r=>!existingReports.has(r.id));
   const panel=$('rescuePanel');
   panel.classList.toggle('hidden',missing.length===0&&missingReports.length===0);
   $('rescueSummary').textContent=missing.length+' fotografías y '+missingReports.length+
    ' reportajes con copia en la galería o Descargas que no aparecen aquí.';
  }catch(e){
   console.error('Error consultando el archivo de recuperación',e);
   const panel=$('rescuePanel');panel.classList.remove('hidden');
   $('rescueSummary').textContent='No se ha podido comprobar el archivo externo: '+e.message;
   $('rescueButton').disabled=true;
  }
 }
 async function recoverFromGallery(){
  const button=$('rescueButton');
  button.disabled=true;
  button.textContent='Recuperando…';
  const status=$('rescueProgress');
  status.textContent='Leyendo archivos de respaldo…';
  try{
   const result=await SersVault.restore(text=>status.textContent=text);
   await reload();renderHome();
   status.textContent=result.recoveredPhotos+' fotos recuperadas, '+result.recoveredReports+
    ' reportajes reconstruidos'+(result.errors.length?' · '+result.errors.length+' errores':'')+'.';
   if(result.errors.length)message('Algunas fotos no se recuperaron. Comprueba el archivo en Galería.');
   await checkRecoverable();
  }catch(e){
   console.error('Error recuperando archivo',e);
   status.textContent='Error: '+e.message;
  }finally{
   button.disabled=false;
   button.textContent='Recuperar reportajes y fotografías';
  }
 }
 async function boot(){
  network();
  disableNativeServiceWorker();
  // El envío nativo a OneDrive no requiere Microsoft Entra.
  // En la APK ocultamos el panel OAuth de la versión web, todavía experimental.
  if(window.SersAndroid?.beginShareZip){
   document.querySelector('.sync-panel')?.classList.add('hidden');
  }
  try{
   await reload();
   const saved=await ReportDB.getDraft();
   if(saved?.file){
    const report=reports.find(r=>r.id===saved.reportId);
    if(report){activeId=report.id;selectedReportId=report.id;localStorage.setItem(KEY,activeId);photos=await ReportDB.photosByReport(activeId);}
   }
   renderHome();
   await checkRecoverable();
  }catch(e){
   console.error('Error abriendo base de datos del móvil',e);
   $('rescuePanel').classList.remove('hidden');
   $('rescueSummary').textContent='No se puede abrir la base de datos. Las copias de Galería y Descargas podrían seguir disponibles.';
   message('Error al abrir el almacenamiento. No crees reportajes hasta recuperar las copias.');
  }
 }
 $('createReport').addEventListener('click',createReport);
 $('rescueButton').addEventListener('click',recoverFromGallery);
 $('importReportBtn').addEventListener('click',()=>$('importZipInput').click());
 $('importZipInput').addEventListener('change',importReport);
 $('newReportToggle').addEventListener('click',()=>{
  const form=$('newReportForm');
  form.classList.toggle('hidden');
  if(!form.classList.contains('hidden')){$('reportName').focus();form.scrollIntoView({block:'nearest',behavior:'smooth'});}
 });
 $('reportSearch').addEventListener('input',renderHome);
 $('resumeRecent').addEventListener('click',()=>reports[0]&&selectReport(reports[0].id,
  reports[0].closedAt?'gallery':'capture'));
 $('actionView').addEventListener('click',()=>{
  const r=selectedReport();if(!r)return;
  galleryOnlyMissing=false;selectReport(r.id,'gallery');
 });
 $('actionCapture').addEventListener('click',async()=>{
  const r=selectedReport();if(!r)return;
  if(r.closedAt){const fresh=await ReportDB.getReport(r.id);
   if(fresh){fresh.closedAt=null;await saveReport(fresh);}}
  await selectReport(r.id,'capture');
 });
 $('actionShare').addEventListener('click',()=>{
  const r=selectedReport();if(r)exportReport(r.id,$('actionShare'),true);
 });
 $('actionExport').addEventListener('click',()=>{
  const r=selectedReport();if(r)exportReport(r.id,$('actionExport'),false);
 });
 $('actionPending').addEventListener('click',()=>{
  const r=selectedReport();if(!r)return;
  galleryOnlyMissing=true;selectReport(r.id,'gallery');
 });
 $('actionToggleClosed').addEventListener('click',toggleSelectedClosed);
 $('actionDelete').addEventListener('click',deleteSelectedReport);
 for(const name of ['home','capture','gallery','map']){
  $('nav'+name[0].toUpperCase()+name.slice(1)).addEventListener('click',()=>chooseView(name));
 }
 $('captureBack').addEventListener('click',()=>chooseView('home'));
 $('gpsRefresh').addEventListener('click',refreshGPS);
 $('compassEnable').addEventListener('click',requestCompass);
 function launchCamera(){
  const r=active();
  if(!r){message('Selecciona primero un reportaje.');return;}
  if(draft?.file&&!confirm('¿Repetir foto? La toma anterior seguirá en Galería si ya se ha guardado.'))return;
  cameraStart={position:gpsSnapshot(),orientation:headingSnapshot(),at:now(),
   reportId:r.id,photoId:uid()};
  if(window.SersAndroid?.startPhotoCamera){
   if(!window.SersAndroid.startPhotoCamera(r.id,r.name,cameraStart.photoId)){
    message('No se puede iniciar la cámara.');return;
   }
   return;
  }
  // Sólo la versión web utiliza el selector HTML.
  if(window.SersAndroid?.prepareCameraArchive){
   if(!window.SersAndroid.prepareCameraArchive(r.id,r.name,cameraStart.photoId)){
    message('No se puede preparar la fotografía en la galería.');return;
   }
  }
  $('cameraInput').click();
 }
 // En Android, la cámara devuelve su identificador nativo, no un
 // resultado del input HTML (algunos modelos Xiaomi no lo entregan).
 window.addEventListener('sers-native-photo',async event=>{
  const data=event.detail||{};
  if(!data.photoId){
   message('La cámara no ha devuelto un identificador de fotografía.');return;
  }
  if(cameraStart?.photoId!==data.photoId){
   message('Fotografía guardada en Galería; vuelve al reportaje para recuperarla.');
   return;
  }
  archiveStatus('Leyendo fotografía de la Galería…','checking');
  try{
   const metadata={
    photoId:data.photoId,
    archivedName:data.archivedName||null,
    originalName:'SERS_'+data.photoId+'.jpg',
    mime:'image/jpeg',capturedAt:cameraStart.at
   };
   let file;
   // La captura FileProvider es la fuente original, independiente
   // de que Xiaomi tarde en indexar la imagen en MediaStore.
   try{file=await SersVault.readCapturedPhoto(metadata);}
   catch(localError){
    if(!metadata.archivedName)throw localError;
    file=await SersVault.readPhoto(metadata);
   }
   await photoSelected(null,'camera',{
    file,photoId:data.photoId,archivedName:data.archivedName||null
   });
   if(data.galleryError && !draft?.archivedName){
    archiveStatus('⚠ Foto conservada localmente; error al copiar a Galería: '+
      data.galleryError,'error');
   }
  }catch(error){
   console.error('No se pudo abrir la foto nativa',error);
   message('La foto puede estar en Galería, pero no se pudo abrir: '+error.message);
   archiveStatus('⚠ Revisar Galería: '+error.message,'error');
  }
 });
 window.addEventListener('sers-native-photo-error',event=>{
  const error=event.detail?.error||'No se pudo recibir la fotografía de Android.';
  console.error('Error cámara nativa',error);
  message(error);
 });
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
 $('dialogPrev').addEventListener('click',()=>stepPhoto(-1));
 $('dialogNext').addEventListener('click',()=>stepPhoto(1));
 $('dialogLocate').addEventListener('click',locateOpenPhoto);
 $('captureLast').addEventListener('click',()=>photos.length&&showPhoto(photos.at(-1).id));
 $('galleryShowAll').addEventListener('click',()=>{galleryOnlyMissing=false;renderGallery();});
 $('galleryMissing').addEventListener('click',()=>{galleryOnlyMissing=true;renderGallery();});
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
 if(!window.SersAndroid?.beginShareZip && 'serviceWorker'in navigator){
  navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(console.warn);
 }
 boot();
 window.SersReportajes={photoMeta,geojson,reportPhotos:()=>ReportDB.allPhotos(),reportList:()=>ReportDB.listReports()};
})();
