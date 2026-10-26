'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const settingsKey = 'sers-diario-settings-v1';
  const DEFAULTS = { project: 'Portillo · Urbanización E-19', technician: '' };
  let settings = readSettings();
  let draft = null, photoQueue = [], editing = false, modeAll = false;
  let recorder=null, audioChunks=[], mediaStream=null, recognition=null, speechState=null, recordingFinalizing=false, recordingStarting=false;
  let photoUrl=null, audioUrl=null, listUrls=[];
  let statusTimer;
  let currentView='home';
  const ui={
    home:$('view-home'),records:$('view-records'),settings:$('view-settings'),editor:$('view-editor'),
    navHome:$('navHome'),navRecords:$('navRecords'),navSettings:$('navSettings')
  };

  function readSettings(){try{return {...DEFAULTS,...JSON.parse(localStorage.getItem(settingsKey)||'{}')};}catch{return {...DEFAULTS};}}
  function localDay(date){const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function niceDate(t){return new Date(t).toLocaleString('es-ES',{dateStyle:'medium',timeStyle:'short'});}
  function hours(t){return new Date(t).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});}
  function toast(message,error=false){const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.classList.remove('hidden');clearTimeout(statusTimer);statusTimer=setTimeout(()=>el.classList.add('hidden'),4200);}
  function view(name){
    currentView=name;
    for(const k of ['home','records','settings','editor'])ui[k].classList.toggle('hidden',name!==k);
    for(const k of ['Home','Records','Settings'])ui['nav'+k].classList.toggle('selected',k.toLowerCase()===name);
    window.scrollTo(0,0);
    if(name==='home') refreshHome();
    if(name==='records') refreshRecords();
    if(name==='settings') refreshSettings();
  }
  function initConnection(){
    const el=$('networkStatus');
    el.textContent=navigator.onLine?'● Con conexión':'○ Sin conexión';
    el.classList.toggle('offline',!navigator.onLine);
  }
  function updateGpsDisplay(){
    if(!draft)return;
    const el=$('gpsStatus');
    if(draft.latitude!=null){el.textContent=`✓ ${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)} · precisión aprox. ${Math.round(draft.accuracy||0)} m`;
    }else{el.textContent=draft.gpsMessage||'Sin ubicación todavía';}
  }
  function acquireGPS(){
    if(!draft)return;
    const target=draft;
    if(!('geolocation' in navigator)){target.gpsMessage='GPS no disponible en este navegador';updateGpsDisplay();return;}
    target.gpsMessage='Buscando señal GPS…';updateGpsDisplay();
    navigator.geolocation.getCurrentPosition(pos=>{
      if(draft!==target)return;
      target.latitude=pos.coords.latitude;target.longitude=pos.coords.longitude;target.accuracy=pos.coords.accuracy;
      target.gpsCapturedAt=new Date(pos.timestamp).toISOString();target.gpsMessage='';updateGpsDisplay();
    },err=>{
      if(draft!==target)return;
      target.gpsMessage=err.code===1?'Ubicación denegada. Activa el permiso si la necesitas.':
        err.code===3?'El GPS ha tardado demasiado. Puedes reintentarlo.':'No se ha podido obtener la posición.';
      updateGpsDisplay();
    },{enableHighAccuracy:true,maximumAge:15000,timeout:14000});
  }
  function setPhotoPreview(){
    if(photoUrl){URL.revokeObjectURL(photoUrl);photoUrl=null;}
    const visible=Boolean(draft?.photo);
    $('photoArea').classList.toggle('hidden',!visible);
    if(visible){photoUrl=URL.createObjectURL(draft.photo);$('photoPreview').src=photoUrl;$('photoFilename').textContent=draft.originalName||'Fotografía';}
    else $('photoPreview').removeAttribute('src');
  }
  function setAudioPreview(){
    if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;}
    const has=Boolean(draft?.audio);
    $('audioPreview').classList.toggle('hidden',!has);
    $('removeAudio').classList.toggle('hidden',!has);
    if(has){audioUrl=URL.createObjectURL(draft.audio);$('audioPreview').src=audioUrl;}
    else{$('audioPreview').pause();$('audioPreview').removeAttribute('src');$('audioPreview').load();}
  }
  function freshId(){return (typeof crypto!=='undefined' && crypto.randomUUID)?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;}
  function newDraft(type,file){
    return {id:freshId(),type,project:settings.project,technician:settings.technician,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),zone:'',work:'',description:'',
      photo:file||null,originalName:file?.name||'',audio:null,audioMime:'',latitude:null,longitude:null,accuracy:null,gpsCapturedAt:null,gpsMessage:'Sin ubicación todavía'};
  }
  function loadEditor(record,isEdit=false,autoGPS=true){
    haltSpeech();if(recorder?.state==='recording'){stopRecording();}
    draft=record;editing=isEdit;
    $('editorTitle').textContent=isEdit?'Revisar registro':(record.type==='photo'?'Nueva fotografía':'Nueva nota');
    $('editorTime').textContent=`${niceDate(record.createdAt)} · ${record.technician||'Técnico sin indicar'}`;
    $('zoneInput').value=record.zone||'';$('workInput').value=record.work||'';$('descriptionInput').value=record.description||'';
    $('deleteRecord').classList.toggle('hidden',!isEdit);
    $('queueInfo').textContent=!isEdit&&photoQueue.length?`${photoQueue.length} foto(s) pendientes`:'';
    $('dictationStatus').textContent='';$('recordingStatus').textContent='';$('recordBtn').textContent='⏺ Grabar audio';
    setPhotoPreview();setAudioPreview();updateGpsDisplay();view('editor');
    if(autoGPS)acquireGPS();
  }
  function createNote(){photoQueue=[];loadEditor(newDraft('note'),false,true);}
  function addPhotos(files,isCamera){
    const accepted=Array.from(files).filter(file=>file.type.startsWith('image/'));
    if(!accepted.length){toast('No se han seleccionado imágenes válidas',true);return;}
    photoQueue=accepted.slice(1);
    const d=newDraft('photo',accepted[0]);
    // La posición del móvil no es necesariamente la de una fotografía antigua importada.
    if(!isCamera)d.gpsMessage='Imagen importada: pulsa «Obtener ubicación» solo si estás en el lugar de la foto.';
    loadEditor(d,false,isCamera);
  }
  function abortDraft(){
    haltSpeech();
    if(recordingStarting||recordingFinalizing||recorder?.state==='recording'){toast('Termina la grabación antes de salir');return;}
    const hasQueue=photoQueue.length>0;
    if(hasQueue&&!confirm('Hay fotos pendientes de registrar. ¿Descartarlas?'))return;
    photoQueue=[];draft=null;editing=false;
    view('records');
  }
  function mediaError(error){return error?.name==='NotAllowedError'?'Permiso de micrófono denegado':(error?.message||'No se pudo acceder al micrófono');}
  function startRecording(){
    if(!draft||recordingStarting||recordingFinalizing)return;
    if(recognition){haltSpeech();}
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){toast('Grabación no compatible con este navegador',true);return;}
    (async()=>{
      recordingStarting=true;
      try{
        mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});
        const options=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?{mimeType:'audio/webm;codecs=opus'}:
          (MediaRecorder.isTypeSupported('audio/mp4')?{mimeType:'audio/mp4'}:undefined);
        recorder=new MediaRecorder(mediaStream,options);
        audioChunks=[];
        const target=draft;
        recorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data);};
        recorder.onerror=()=>{ $('recordingStatus').textContent='Error durante la grabación.'; };
        recorder.onstop=()=>{
          recordingFinalizing=false;
          if(draft===target && audioChunks.length){target.audio=new Blob(audioChunks,{type:recorder?.mimeType||'audio/webm'});target.audioMime=target.audio.type;setAudioPreview();$('recordingStatus').textContent='Audio grabado. Escúchalo antes de guardar.';}
          if(mediaStream){mediaStream.getTracks().forEach(track=>track.stop());mediaStream=null;}
          $('recordBtn').textContent='⏺ Volver a grabar';audioChunks=[];
        };
        recorder.start();$('recordBtn').textContent='■ Terminar grabación';$('recordingStatus').textContent='Grabando… pulsa para terminar.';
      }catch(err){if(mediaStream){mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null;}toast(mediaError(err),true);}
      finally{recordingStarting=false;}
    })();
  }
  function stopRecording(){if(recorder?.state==='recording'){recordingFinalizing=true;recorder.stop();$('recordBtn').textContent='Preparando audio…';}}
  // Combina versiones sucesivas de una frase sin repetir el texto solapado.
  // Algunos motores de Android entregan una versión ampliada como otro resultado.
  function combineSpeechParts(parts){
    const words=[];
    const normalise=word=>word.toLocaleLowerCase('es-ES').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
    for(const piece of parts){
      const tokens=(piece||'').trim().split(/\s+/u).filter(Boolean);
      if(!tokens.length)continue;
      let overlap=0;
      for(let size=Math.min(words.length,tokens.length);size>0;size--){
        if(words.slice(-size).every((word,i)=>normalise(word)===normalise(tokens[i]))){overlap=size;break;}
      }
      words.push(...tokens.slice(overlap));
    }
    return words.join(' ');
  }
  function withSpeechBase(base,transcript){return [base.trimEnd(),transcript.trim()].filter(Boolean).join(' ');}
  function finishSpeech(r){
    if(recognition!==r)return; // Ignorar eventos tardíos de sesiones anteriores.
    const state=speechState;
    if(state&&draft===state.target){
      // Mantener el último resultado si Chrome finaliza sin emitir una versión definitiva.
      $('descriptionInput').value=withSpeechBase(state.base,state.preview||state.final);
    }
    recognition=null;speechState=null;
    $('dictateBtn').disabled=false;
    $('dictateBtn').textContent='🎤 Dictar texto';
    if(!$('dictationStatus').textContent.startsWith('No se ha podido')){
      $('dictationStatus').textContent=state?.preview?'Dictado terminado. Revisa el texto antes de guardarlo.':'Dictado terminado sin reconocer texto.';
    }
  }
  // Salida inmediata al guardar, cambiar de registro o editar a mano.
  function haltSpeech(preserveInput=false){
    if(recognition){
      const old=recognition, state=speechState;
      if(!preserveInput&&state&&draft===state.target){
        $('descriptionInput').value=withSpeechBase(state.base,state.preview||state.final);
      }
      recognition=null;speechState=null;
      try{old.abort();}catch{}
    }
    $('dictateBtn').disabled=false;
    $('dictateBtn').textContent='🎤 Dictar texto';
  }
  function dictate(){
    if(recorder?.state==='recording'||recordingStarting||recordingFinalizing){toast('Termina primero la grabación de audio');return;}
    if(recognition){
      // stop() permite recibir el último resultado confirmado antes de onend.
      const r=recognition;
      if(speechState?.stopping)return;
      speechState.stopping=true;
      $('dictateBtn').disabled=true;
      $('dictationStatus').textContent='Terminando dictado…';
      try{
        r.stop();
        // Recuperarse si Chrome no envía onend tras pulsar Terminar.
        setTimeout(()=>{if(recognition===r)finishSpeech(r);},3000);
      }catch{finishSpeech(r);}
      return;
    }
    const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Speech){toast('Usa el micrófono del teclado para dictar el texto');$('dictationStatus').textContent='Este navegador no ofrece dictado web. Pulsa el campo de descripción y usa el micrófono del teclado.';return;}
    const r=new Speech();
    recognition=r;
    // En Chrome de Android el modo continuo puede entregar varias veces una frase.
    // Una intervención por pulsación, con texto provisional que reemplaza al anterior.
    r.lang='es-ES';r.continuous=false;r.interimResults=true;
    speechState={target:draft,base:$('descriptionInput').value,final:'',preview:'',stopping:false};
    r.onresult=event=>{
      if(recognition!==r||!speechState||draft!==speechState.target)return;
      const finalParts=[],pendingParts=[];
      for(let i=0;i<event.results.length;i++){
        const result=event.results[i];
        if(!result?.[0]?.transcript)continue;
        (result.isFinal?finalParts:pendingParts).push(result[0].transcript);
      }
      speechState.final=combineSpeechParts(finalParts);
      speechState.preview=combineSpeechParts([...finalParts,...pendingParts]);
      $('descriptionInput').value=withSpeechBase(speechState.base,speechState.preview);
      $('dictationStatus').textContent=pendingParts.length?'Escuchando…':'Texto reconocido. Puedes corregirlo.';
    };
    r.onerror=e=>{
      if(recognition!==r)return;
      $('dictationStatus').textContent=`No se ha podido dictar (${e.error}). Prueba el micrófono del teclado.`;
    };
    r.onend=()=>finishSpeech(r);
    try{r.start();$('dictateBtn').textContent='■ Terminar dictado';$('dictationStatus').textContent='Escuchando… habla con normalidad.';}
    catch(e){finishSpeech(r);toast('No se ha podido iniciar el dictado',true);}
  }
    async function save(){
    if(!draft)return;
    if(recordingStarting||recordingFinalizing||recorder?.state==='recording'){toast('Termina la grabación antes de guardar',true);return;}
    haltSpeech();
    draft.zone=$('zoneInput').value.trim();draft.work=$('workInput').value.trim();draft.description=$('descriptionInput').value.trim();
    if(draft.type==='note'&&!draft.description&&!draft.audio){toast('Escribe, dicta o graba una nota antes de guardar',true);return;}
    draft.updatedAt=new Date().toISOString();
    $('saveRecord').disabled=true;
    try{
      // El estado GPS textual es solo de interfaz; no hace falta incluirlo en datos exportados.
      await SersDB.put({...draft,gpsMessage:undefined});
      if(!editing&&photoQueue.length){const next=photoQueue.shift();loadEditor(newDraft('photo',next),false,false);draft.gpsMessage='Foto importada: si necesitas el GPS, pulsa «Obtener ubicación».';updateGpsDisplay();toast('Foto guardada. Continúa con la siguiente.');}
      else{photoQueue=[];draft=null;view('records');toast('Registro guardado en el móvil');}
    }catch(error){toast('No se pudo guardar: comprueba el espacio libre del móvil',true);console.error(error);}
    finally{$('saveRecord').disabled=false;}
  }
  async function del(){
    if(!editing||!draft)return;
    if(!confirm('¿Eliminar definitivamente este registro del móvil?'))return;
    try{await SersDB.remove(draft.id);draft=null;view('records');toast('Registro eliminado');}catch(e){toast('No se pudo eliminar',true);}
  }
  function clearListURLs(){for(const url of listUrls)URL.revokeObjectURL(url);listUrls=[];}
  async function allRecords(){return (await SersDB.getAll()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async function refreshHome(){
    $('homeProject').textContent=settings.project;
    $('homeTechnician').textContent='Técnico: '+(settings.technician||'sin configurar');
    try{const rows=await allRecords();$('homeCount').textContent=`${rows.length} registro${rows.length===1?'':'s'} guardado${rows.length===1?'':'s'}`;
      $('homeLast').textContent=rows[0]?'Último: '+niceDate(rows[0].createdAt):'Sin capturas todavía';}catch(e){toast('No se puede abrir el almacenamiento del móvil',true);}
  }
  async function refreshRecords(){
    clearListURLs();const list=$('recordsList');list.replaceChildren();
    try{
      const rows=await allRecords();const date=$('dayFilter').value;
      const visible=modeAll?rows:rows.filter(r=>localDay(r.createdAt)===date);
      $('recordsSummary').textContent=modeAll?`${visible.length} registros en total`:`${visible.length} registro(s) del ${date.split('-').reverse().join('/')}`;
      if(!visible.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=modeAll?'Todavía no hay registros guardados.':'No hay fotos ni notas de ese día. Prueba «Ver todos».';list.append(empty);return;}
      for(const row of visible){
        const b=document.createElement('button');b.type='button';b.className='record-card';b.setAttribute('aria-label',`Abrir ${row.type==='photo'?'foto':'nota'} de ${hours(row.createdAt)}`);
        let preview;
        if(row.photo){preview=document.createElement('img');preview.className='thumbnail';const url=URL.createObjectURL(row.photo);listUrls.push(url);preview.src=url;preview.alt='Miniatura';preview.loading='lazy';}
        else{preview=document.createElement('div');preview.className='thumbnail thumb-note';preview.textContent='🎙';}
        const body=document.createElement('div');body.className='record-body';
        const meta=document.createElement('div');meta.className='record-meta';meta.textContent=`${localDay(row.createdAt).split('-').reverse().join('/')} · ${hours(row.createdAt)} · ${row.technician||'Sin autor'}`;
        const zone=document.createElement('div');zone.className='record-zone';zone.textContent=row.zone||row.work||(row.type==='photo'?'Fotografía':'Nota de obra');
        const description=document.createElement('div');description.className='record-desc';description.textContent=row.description||(row.work?'Trabajo: '+row.work:'Sin descripción');
        const tags=document.createElement('div');tags.className='record-tags';tags.textContent=[row.type==='photo'?'📷 Foto':'🗒 Nota',row.audio?'🎙 Audio':'',row.latitude!=null?'⌖ GPS':''].filter(Boolean).join(' · ');
        body.append(meta,zone,description,tags);b.append(preview,body);
        b.addEventListener('click',()=>{photoQueue=[];loadEditor({...row,gpsMessage:''},true,false);});
        list.append(b);
      }
    }catch(e){const box=document.createElement('div');box.className='empty';box.textContent='No se pudieron leer los registros. Comprueba que el navegador permite almacenamiento local.';list.append(box);console.error(e);}
  }
  function refreshSettings(){
    $('projectInput').value=settings.project;
    $('technicianInput').value=settings.technician;
    $('exportDateInfo').textContent=`Día elegido en «Registros»: ${$('dayFilter').value.split('-').reverse().join('/')}. Los ZIP se guardan en Descargas del teléfono.`;
  }
  function saveSettings(){
    const project=$('projectInput').value.trim(),tech=$('technicianInput').value.trim();
    if(!project){toast('Indica el nombre de la obra',true);return;}
    settings={project,technician:tech};localStorage.setItem(settingsKey,JSON.stringify(settings));toast('Configuración guardada');
  }
  const safeName=text=>(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,70)||'sin_nombre';
  const csvCell=v=>{
    let s=v==null?'':String(v);
    if(/^[\s]*[=+@\-]/.test(s)&&!/^\-\d+(?:[.,]\d+)?$/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  function extensionFromMime(blob,isAudio){
    const mime=(blob?.type||'').toLowerCase();
    if(isAudio)return mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':mime.includes('mpeg')?'mp3':'webm';
    return mime.includes('png')?'png':mime.includes('webp')?'webp':mime.includes('heic')?'heic':mime.includes('gif')?'gif':'jpg';
  }
  async function exportZip(which){
    const button=$(which==='all'?'exportAll':'exportDay');
    button.disabled=true;button.textContent='Preparando ZIP…';
    try{
      const rows=(await allRecords()).filter(r=>which==='all'||localDay(r.createdAt)===$('dayFilter').value);
      if(!rows.length){toast('No hay registros para exportar',true);return;}
      const zipFiles=[];const manifest=[];
      const cols=['id','obra','tecnico','tipo','fecha_hora','zona','unidad_trabajo','descripcion','latitud','longitud','precision_m','foto','audio'];
      for(const row of rows){
        const d=new Date(row.createdAt);
        const dateStamp=`${localDay(d)}_${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}-${String(d.getSeconds()).padStart(2,'0')}`;
        const coords=row.latitude!=null?`_${row.latitude.toFixed(5)}_${row.longitude.toFixed(5)}`:'';
        const shortId=row.id.replace(/[^a-zA-Z0-9]/g,'').slice(0,8);
        const stem=`${dateStamp}_${row.type}_${safeName(row.zone||row.work).slice(0,30)}${coords}_${shortId}`;
        const photoFile=row.photo?`fotografias/${stem}.${extensionFromMime(row.photo,false)}`:'';
        const audioFile=row.audio?`audios/${stem}.${extensionFromMime(row.audio,true)}`:'';
        if(row.photo)zipFiles.push({name:photoFile,data:row.photo,date:row.createdAt});
        if(row.audio)zipFiles.push({name:audioFile,data:row.audio,date:row.createdAt});
        manifest.push({id:row.id,obra:row.project,tecnico:row.technician,tipo:row.type,
          fecha_hora:row.createdAt,zona:row.zone,unidad_trabajo:row.work,descripcion:row.description,
          latitud:row.latitude,longitud:row.longitude,precision_m:row.accuracy,
          gps_hora:row.gpsCapturedAt,foto:photoFile,audio:audioFile,nombre_foto_original:row.originalName||''});
      }
      const csv='\ufeff'+[cols.join(';'),...manifest.map(item=>cols.map(key=>csvCell(item[key])).join(';'))].join('\r\n');
      zipFiles.push({name:'registros.json',data:JSON.stringify({version:1,generado:new Date().toISOString(),registros:manifest},null,2)});
      zipFiles.push({name:'registros_excel.csv',data:csv});
      zipFiles.push({name:'LEEME.txt',data:'SERS · Diario de obra (piloto)\r\n\r\nregistros.json: datos estructurados para la futura automatización.\r\nregistros_excel.csv: resumen para Excel (separador ;).\r\nfotografias/: fotografías sin recomprimir.\r\naudios/: notas de voz originales.\r\n\r\nFecha/hora: momento en que se añadió el registro a la aplicación.\r\nGPS: ubicación del móvil en el momento de solicitarla; si la foto se importó de la galería, no implica necesariamente la ubicación donde se tomó.\r\nLas notas de la planificación y la meteorología se incorporarán en una fase posterior.\r\nLos originales siguen guardados en este teléfono hasta que los elimines o se borren los datos del navegador.\r\n'});
      const zip=await SersZip.create(zipFiles);
      const dateInfo=which==='all'?'completo':$('dayFilter').value;
      const name=`SERS_${safeName(settings.project).slice(0,35)}_${dateInfo}_${localDay(new Date())}.zip`;
      const url=URL.createObjectURL(zip);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      toast(`${rows.length} registro(s) exportados. Busca el ZIP en Descargas.`);
    }catch(e){console.error(e);toast('No se pudo generar el ZIP: revisa el espacio libre y vuelve a intentarlo.',true);}
    finally{button.disabled=false;button.textContent=which==='all'?'Exportar todos los registros':'Exportar el día seleccionado';}
  }

  function navTo(name){
    if(currentView==='editor'&&draft){
      if(recordingStarting||recordingFinalizing||recorder?.state==='recording'){toast('Termina la grabación antes de salir');return;}
      if(!confirm('Tienes un registro abierto. ¿Salir sin guardar los cambios?'))return;
      haltSpeech();draft=null;photoQueue=[];editing=false;
    }
    view(name);
  }
  $('navHome').addEventListener('click',()=>navTo('home'));
  $('navRecords').addEventListener('click',()=>navTo('records'));
  $('navSettings').addEventListener('click',()=>navTo('settings'));
  $('takePhoto').addEventListener('click',()=>$('cameraInput').click());
  $('choosePhotos').addEventListener('click',()=>$('galleryInput').click());
  $('newNote').addEventListener('click',createNote);
  $('cameraInput').addEventListener('change',e=>{if(e.target.files?.length)addPhotos(e.target.files,true);e.target.value='';});
  $('galleryInput').addEventListener('change',e=>{if(e.target.files?.length)addPhotos(e.target.files,false);e.target.value='';});
  $('cancelEditor').addEventListener('click',abortDraft);
  $('retryGps').addEventListener('click',acquireGPS);
  $('recordBtn').addEventListener('click',()=>recorder?.state==='recording'?stopRecording():startRecording());
  $('removeAudio').addEventListener('click',()=>{if(!draft)return;draft.audio=null;draft.audioMime='';setAudioPreview();$('recordingStatus').textContent='Audio quitado de este registro.';});
  $('dictateBtn').addEventListener('click',dictate);
  $('descriptionInput').addEventListener('input',()=>{
    // Si el técnico modifica el texto, sus cambios tienen prioridad sobre el micrófono.
    if(recognition){haltSpeech(true);$('dictationStatus').textContent='Dictado interrumpido para editar el texto.';}
  });
  $('saveRecord').addEventListener('click',save);
  $('deleteRecord').addEventListener('click',del);
  $('saveSettings').addEventListener('click',saveSettings);
  $('exportDay').addEventListener('click',()=>exportZip('day'));
  $('exportAll').addEventListener('click',()=>exportZip('all'));
  $('dayFilter').value=localDay(new Date());
  $('dayFilter').addEventListener('change',()=>{modeAll=false;$('showAll').classList.remove('hidden');$('showToday').classList.add('hidden');refreshRecords();});
  $('showAll').addEventListener('click',()=>{modeAll=true;$('showAll').classList.add('hidden');$('showToday').classList.remove('hidden');refreshRecords();});
  $('showToday').addEventListener('click',()=>{modeAll=false;$('dayFilter').value=localDay(new Date());$('showAll').classList.remove('hidden');$('showToday').classList.add('hidden');refreshRecords();});
  window.addEventListener('online',initConnection);window.addEventListener('offline',initConnection);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && currentView==='home')refreshHome();});
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('El modo sin conexión requiere HTTPS o localhost:',err));
  }
  initConnection();view('home');
})();
