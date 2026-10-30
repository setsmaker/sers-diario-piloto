/* SERS Diario · sincronización de registros con Microsoft OneDrive.
   OAuth gestionado por MSAL; solo los archivos del usuario autenticado.
   No se insertan secretos en GitHub ni se da acceso público al OneDrive. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const CLIENT_KEY='sers-diario-onedrive-client-id-v1';
  const TENANT_KEY='sers-diario-onedrive-tenant-v1';
  const AUTO_KEY='sers-diario-onedrive-auto-v1';
  const LEDGER_KEY='sers-diario-onedrive-ledger-v1';
  const GRAPH='https://graph.microsoft.com/v1.0';
  const REDIRECT='https://setsmaker.github.io/sers-diario-piloto/';
  const SCOPES=['User.Read','Files.ReadWrite'];
  let clientId='',tenantId='',client=null,account=null,driveId='',busy=false,folderCache=new Map(),ledger={};
  try{clientId=localStorage.getItem(CLIENT_KEY)||'';tenantId=localStorage.getItem(TENANT_KEY)||'';}catch{}
  try{ledger=JSON.parse(localStorage.getItem(LEDGER_KEY)||'{}')||{};}catch{}
  $('onedriveClientId').value=clientId;
  $('onedriveTenantId').value=tenantId;
  $('onedriveRedirect').value=REDIRECT;
  $('onedriveAuto').checked=localStorage.getItem(AUTO_KEY)==='yes';
  const status=(message,error=false)=>{
    $('onedriveStatus').textContent=message;
    $('onedriveStatus').classList.toggle('admin-error',error);
  };
  const progress=text=>$('onedriveProgress').textContent=text;
  const busyUI=value=>{
    busy=value;
    $('onedriveSync').disabled=value;
    $('onedriveConnect').disabled=value;
    $('onedriveSaveSettings').disabled=value;
    $('onedriveSync').textContent=value?'Sincronizando…':'☁ Sincronizar registros pendientes';
  };
  const savedLedger=()=>localStorage.setItem(LEDGER_KEY,JSON.stringify(ledger));
  function syncUI(){
    $('onedriveConnect').classList.toggle('hidden',!!account);
    $('onedriveDisconnect').classList.toggle('hidden',!account);
    if(account)status('Conectado a OneDrive: '+(account.username||account.name||'cuenta Microsoft'));
    else status(clientId?'Conexión pendiente. Pulsa «Conectar OneDrive».':'Falta configurar el ID de aplicación de Microsoft.');
  }
  function errorText(error){
    const code=String(error?.errorCode||error?.code||'');
    if(code==='interaction_required'||code==='login_required'||code==='consent_required')return 'Necesitas volver a conectar tu cuenta Microsoft.';
    const message=String(error?.message||error||'Error desconocido');
    if(message.includes('AADSTS'))return 'Microsoft rechazó la autenticación. Revisa el registro de aplicación, la URI SPA y los permisos.';
    if(message.includes('Failed to fetch'))return 'No hay conexión o Microsoft ha bloqueado la petición.';
    return message.slice(0,260);
  }
  function saveConfig(){
    const input=$('onedriveClientId').value.trim();
    const newTenant=$('onedriveTenantId').value.trim();
    if(input&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)){
      status('El ID de aplicación debe tener el formato de un GUID de Microsoft.',true);
      return;
    }
    if(!input){status('Introduce el ID de aplicación que te facilite Microsoft Entra.',true);return;}
    if(newTenant&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newTenant)){
      status('El Tenant ID debe tener el formato de un identificador GUID de Microsoft.',true);return;
    }
    if(input!==clientId||newTenant!==tenantId){
      clientId=input;tenantId=newTenant;
      localStorage.setItem(CLIENT_KEY,clientId);
      localStorage.setItem(TENANT_KEY,tenantId);
      client=null;account=null;driveId='';folderCache.clear();
      status('ID guardado. Pulsa «Conectar OneDrive».');
    }else status('Configuración guardada. Ya puedes conectar OneDrive.');
    syncUI();
    $('onedriveSetupDetails').open=false;
  }
  function loadClient(){
    if(client)return client;
    if(!clientId)throw new Error('Falta el ID de aplicación de Microsoft. Abre «Configuración de Microsoft».');
    if(!window.msal?.PublicClientApplication)throw new Error('No se pudo cargar la biblioteca oficial MSAL de Microsoft. Comprueba la conexión.');
    client=new window.msal.PublicClientApplication({
      auth:{clientId,authority:'https://login.microsoftonline.com/'+(tenantId||'common'),
        redirectUri:REDIRECT,navigateToLoginRequestUrl:false},
      cache:{cacheLocation:'localStorage',storeAuthStateInCookie:false}
    });
    return client;
  }
  async function initAuth(){
    if(!clientId){syncUI();return;}
    try{
      loadClient();
      const redirected=await client.handleRedirectPromise();
      account=redirected?.account||client.getAllAccounts()[0]||null;
      if(account)client.setActiveAccount(account);
      syncUI();
      if(account&&$('onedriveAuto').checked)queueAutoSync();
    }catch(error){
      account=null;syncUI();
      status('No se pudo recuperar la sesión de Microsoft: '+errorText(error),true);
    }
  }
  async function connect(){
    if(busy)return;
    try{
      loadClient();
      await client.handleRedirectPromise();
      await client.loginRedirect({scopes:SCOPES,redirectUri:REDIRECT});
    }catch(error){status('No se pudo conectar: '+errorText(error),true);}
  }
  async function disconnect(){
    if(busy)return;
    if(!client||!account){account=null;syncUI();return;}
    const old=account;
    account=null;driveId='';folderCache.clear();syncUI();
    try{await client.logoutRedirect({account:old,postLogoutRedirectUri:REDIRECT});}
    catch(error){status('No se pudo cerrar sesión: '+errorText(error),true);}
  }
  async function token(){
    if(!account||!client)throw new Error('Conecta OneDrive antes de sincronizar.');
    try{return (await client.acquireTokenSilent({scopes:SCOPES,account})).accessToken;}
    catch(error){
      if(error instanceof window.msal.InteractionRequiredAuthError){
        throw new Error('La autorización ha caducado. Pulsa «Conectar OneDrive» para renovarla.');
      }
      throw error;
    }
  }
  async function graph(path,options={}){
    const accessToken=await token();
    const url=path.startsWith('https://')?path:GRAPH+path;
    const response=await fetch(url,{...options,
      headers:{'Authorization':'Bearer '+accessToken,'Accept':'application/json',...(options.headers||{})},
      cache:'no-store'
    });
    if(response.status===404&&options.allow404)return null;
    if(!response.ok){
      let json=null;try{json=await response.json();}catch{}
      const err=new Error(json?.error?.message||('Microsoft Graph: HTTP '+response.status));
      err.status=response.status;err.code=json?.error?.code;
      throw err;
    }
    if(response.status===204)return null;
    return response.json();
  }
  const encodeName=name=>encodeURIComponent(name).replace(/%2F/ig,'-');
  const safeName=(value,max=90)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\/\\:*?"<>|#%]+/g,'_').replace(/\s+/g,' ').trim().replace(/[.\s]+$/g,'')
    .slice(0,max)||'sin_nombre';
  const datePart=date=>{
    const d=new Date(date);
    if(!Number.isFinite(d.getTime()))return 'fecha_desconocida';
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  };
  function allProjects(){
    const cached=JSON.parse(localStorage.getItem('sers-diario-catalogo-publico-v1')||'null');
    if(Array.isArray(cached?.obras)&&cached.obras.length)return cached.obras;
    return [];
  }
  function projectOf(record,projects){
    const shared=projects.find(p=>p.id===record.projectId)||projects.find(p=>p.nombre===record.project);
    // Registros antiguos pueden pertenecer a obras locales archivadas; no perderlos.
    return shared||{id:record.projectId||'obra_antigua',nombre:record.project||'Obra sin nombre'};
  }
  async function rootFolder(){
    const root=await graph('/me/drive/root?$select=id');
    if(!root?.id)throw new Error('No se puede acceder a tu OneDrive.');
    const info=await graph('/me/drive?$select=id,driveType');
    if(!info?.id)throw new Error('No se pudo identificar la unidad de OneDrive.');
    if(info.id!==driveId){driveId=info.id;folderCache.clear();}
    return root.id;
  }
  async function ensureFolder(parentId,name){
    const key=parentId+'/'+name;
    if(folderCache.has(key))return folderCache.get(key);
    const path='/me/drive/items/'+encodeURIComponent(parentId)+':/'+encodeName(name);
    let existing=await graph(path+'?$select=id,name,folder',{allow404:true});
    if(existing&&!existing.folder)throw new Error('Ya existe un archivo llamado «'+name+'» donde debe haber una carpeta.');
    if(!existing){
      try{
        existing=await graph('/me/drive/items/'+encodeURIComponent(parentId)+'/children',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name,folder:{},'@microsoft.graph.conflictBehavior':'fail'})
        });
      }catch(error){
        if(error.status===409){
          existing=await graph(path+'?$select=id,name,folder');
        }else throw error;
      }
    }
    if(!existing?.id||!existing.folder)throw new Error('No se pudo crear o localizar la carpeta «'+name+'».');
    folderCache.set(key,existing.id);
    return existing.id;
  }
  async function remoteFile(folderId,name){
    const path='/me/drive/items/'+encodeURIComponent(folderId)+':/'+encodeName(name)+'?$select=id,name,file,size';
    return graph(path,{allow404:true});
  }
  async function uploadFile(folderId,name,zip){
    const base='/me/drive/items/'+encodeURIComponent(folderId)+':/'+encodeName(name)+':';
    if(zip.size<=10*1024*1024){
      return graph(base+'/content',{method:'PUT',headers:{'Content-Type':'application/zip'},body:zip});
    }
    const uploadSession=await graph(base+'/createUploadSession',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'replace',name}})
    });
    if(!uploadSession?.uploadUrl)throw new Error('OneDrive no ha creado la sesión de subida.');
    const step=20*327680; // 6,25 MiB; múltiplo de 320 KiB (Graph).
    let response=null;
    for(let offset=0;offset<zip.size;offset+=step){
      const end=Math.min(offset+step,zip.size);
      const part=zip.slice(offset,end);
      const r=await fetch(uploadSession.uploadUrl,{
        method:'PUT',headers:{
          'Content-Range':'bytes '+offset+'-'+(end-1)+'/'+zip.size
        },body:part
      });
      if(!r.ok)throw new Error('Error al enviar un fragmento del ZIP: HTTP '+r.status);
      response=await r.json();
    }
    return response;
  }
  async function buildZip(record,visit){
    const photoItems=Array.isArray(record.photos)&&record.photos.length?record.photos:
      (record.photo?[{id:record.id+'-original',blob:record.photo,
        originalName:record.originalName||'foto.jpg',caption:''}]:[]);
    const files=[],references=[];
    for(let i=0;i<photoItems.length;i++){
      const photo=photoItems[i];
      if(!photo.blob)continue;
      const mime=photo.blob.type||'';
      const suffix=mime.includes('png')?'png':mime.includes('webp')?'webp':mime.includes('heic')?'heic':'jpg';
      const name='fotografias/foto_'+String(i+1).padStart(2,'0')+'.'+suffix;
      files.push({name,data:photo.blob,date:record.createdAt});
      references.push({archivo:name,nombre_original:photo.originalName||'',descripcion_original:photo.caption||''});
    }
    let audioName='';
    if(record.audio){
      const mime=record.audio.type||'';
      audioName='audios/nota_de_voz.'+(mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':mime.includes('mpeg')?'mp3':'webm');
      files.push({name:audioName,data:record.audio,date:record.createdAt});
    }
    const data={
      version:1,tipo:'registro_original_sers',id:record.id,obra_id:record.projectId,
      obra:record.project,tecnico:record.technician||'',
      fecha_hora:record.createdAt,ultima_modificacion:record.updatedAt||record.createdAt,
      visita_id:record.visitId||null,visita:visit?{
        id:visit.id,inicio:visit.startedAt,fin:visit.finishedAt||null,tecnico:visit.technician
      }:null,
      descripcion_original:record.description||'',
      zonas:record.zones?.length?record.zones:(record.zone?[record.zone]:[]),
      unidades:record.works?.length?record.works:(record.work?[record.work]:[]),
      gps:record.latitude!=null?{
        latitud:record.latitude,longitud:record.longitude,precision_m:record.accuracy,
        hora:record.gpsCapturedAt||null
      }:null,
      fotografias:references,audio:audioName
    };
    files.push({name:'registro.json',data:JSON.stringify(data,null,2)});
    files.push({name:'LEEME.txt',data:'SERS Diario de obra. Información original del registro.\r\nNo contiene redacción generada mediante IA.\r\n'});
    return SersZip.create(files);
  }
  function versionOf(record,visit){
    return (record.updatedAt||record.createdAt||'sin_fecha')+'|'+
      (visit?.finishedAt||'visita_abierta');
  }
  function ledgerKey(record){
    const owner=account?.homeAccountId||account?.username||'desconocido';
    return owner+'|'+driveId+'|'+record.id;
  }
  async function syncOne(record,visits,projects,parentId){
    const project=projectOf(record,projects);
    if(!project)return {skipped:true,reason:'Obra fuera del catálogo; no se sincroniza.'};
    const date=datePart(record.createdAt);
    const projectFolder=safeName(project.id,45)+' - '+safeName(project.nombre,65);
    const visit=visits.find(v=>v.id===record.visitId)||null;
    const label=record.visitId?'VISITA_'+safeName(record.visitId,80):'REGISTROS_SIN_VISITA';
    let folder=await ensureFolder(parentId,projectFolder);
    folder=await ensureFolder(folder,date);
    folder=await ensureFolder(folder,label);
    const name='REGISTRO_'+safeName(record.id,110)+'.zip';
    const current=ledger[ledgerKey(record)];
    const remote=await remoteFile(folder,name);
    const version=versionOf(record,visit);
    const sameVersion=current?.version===version&&current?.name===name;
    if(remote&&(sameVersion||!current)){
      // Si ya existe, por defecto no duplicar ni sobrescribir sin constancia
      // de un cambio posterior hecho en este móvil.
      if(!current){
        ledger[ledgerKey(record)]={version,name,
          syncedAt:new Date().toISOString(),remoteId:remote.id,discovered:true};
        savedLedger();
      }
      return {skipped:true};
    }
    const blob=await buildZip(record,visit);
    const sent=await uploadFile(folder,name,blob);
    if(!sent?.id)throw new Error('OneDrive no confirmó el archivo «'+name+'».');
    ledger[ledgerKey(record)]={version,name,
      syncedAt:new Date().toISOString(),remoteId:sent.id};
    savedLedger();
    return {uploaded:true};
  }
  async function runSync(manual=false){
    if(busy||!account||!navigator.onLine)return;
    busyUI(true);
    let uploaded=0,unchanged=0,failed=0,ignored=0;
    try{
      const projects=allProjects(),records=await SersDB.getAll(),visits=await SersDB.getVisits();
      if(!records.length){progress('No hay registros para sincronizar.');return;}
      const parentRoot=await rootFolder();
      const base=await ensureFolder(parentRoot,'DIARIOS DE OBRA');
      const sorted=records.slice().sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
      for(let i=0;i<sorted.length;i++){
        const r=sorted[i];
        progress('Comprobando '+(i+1)+' de '+sorted.length+' registros…');
        try{
          const result=await syncOne(r,visits,projects,base);
          if(result.uploaded)uploaded++;
          else if(result.reason)ignored++;
          else unchanged++;
        }catch(error){
          failed++;console.error('Error en registro '+r.id,error);
        }
      }
      progress(uploaded+' enviados · '+unchanged+' sin cambios · '+failed+' pendientes por error'+(ignored?' · '+ignored+' sin obra compartida':'')+'.');
      if(failed)status('Sincronización incompleta; pulsa de nuevo para reintentar.',true);
      else syncUI();
    }catch(error){
      progress('No se pudo sincronizar: '+errorText(error));
      status('No se pudo conectar a OneDrive. '+errorText(error),true);
    }finally{busyUI(false);}
  }
  let autoTimer=null;
  function queueAutoSync(){
    if(!account||!$('onedriveAuto').checked||!navigator.onLine||busy)return;
    clearTimeout(autoTimer);
    autoTimer=setTimeout(()=>runSync(false),1900);
  }
  $('onedriveSaveSettings').addEventListener('click',saveConfig);
  $('onedriveConnect').addEventListener('click',connect);
  $('onedriveDisconnect').addEventListener('click',disconnect);
  $('onedriveSync').addEventListener('click',async()=>{
    if(!account){
      progress('Primero debes conectar OneDrive. Si aún no tienes un ID de aplicación, abre Configuración de Microsoft.');
      return;
    }
    if(!navigator.onLine){progress('Sin conexión. Los registros permanecen guardados en el móvil.');return;}
    await runSync(true);
  });
  $('onedriveAuto').addEventListener('change',()=>{
    localStorage.setItem(AUTO_KEY,$('onedriveAuto').checked?'yes':'no');
    if($('onedriveAuto').checked)queueAutoSync();
    else clearTimeout(autoTimer);
  });
  window.addEventListener('online',queueAutoSync);
  window.addEventListener('sers:record-saved',queueAutoSync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueAutoSync();});
  syncUI();
  initAuth();
})();
