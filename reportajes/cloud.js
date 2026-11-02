/* SERS Reportajes · OneDrive MS Graph con OAuth SPA (MSAL, sin Client Secret).
   Foto original y JSON individual por fotografía, más un índice GeoJSON por reportaje. */
'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const KEY='sers-reportajes-ms-client-v1',TENANT='sers-reportajes-ms-tenant-v1',
  AUTO='sers-reportajes-autosync-v1',LEDGER='sers-reportajes-sync-ledger-v1';
 const GRAPH='https://graph.microsoft.com/v1.0';
 const REDIRECT='https://setsmaker.github.io/sers-diario-piloto/reportajes/';
 const SCOPES=['User.Read','Files.ReadWrite'];
 let clientId=localStorage.getItem(KEY)||'',tenantId=localStorage.getItem(TENANT)||'';
 let client=null,account=null,driveId='',busy=false,folderCache=new Map(),ledger={},timer=null;
 try{ledger=JSON.parse(localStorage.getItem(LEDGER)||'{}')||{};}catch{}
 $('clientId').value=clientId;$('tenantId').value=tenantId;
 $('redirectUri').value=REDIRECT;
 $('autoSync').checked=localStorage.getItem(AUTO)==='yes';
 const display=(s,error=false)=>{
  $('cloudStatus').textContent=s;
  $('cloudStatus').style.color=error?'#a33138':'';
 };
 const progress=s=>$('syncProgress').textContent=s;
 function ui(){
  $('cloudConnect').classList.toggle('hidden',!!account);
  $('cloudDisconnect').classList.toggle('hidden',!account);
  display(account?'Conectado: '+(account.username||account.name||'cuenta Microsoft'):
   clientId?'Configurado. Pulsa «Conectar Microsoft».':'Sin configurar. Abre «Configurar cuenta Microsoft».');
 }
 function saveConfig(){
  const app=$('clientId').value.trim(),tenant=$('tenantId').value.trim();
  const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!guid.test(app)){display('Introduce un Client ID válido de Microsoft.',true);return;}
  if(tenant&&!guid.test(tenant)){display('El Tenant ID no tiene el formato correcto.',true);return;}
  if(app!==clientId||tenant!==tenantId){
   clientId=app;tenantId=tenant;client=null;account=null;driveId='';folderCache.clear();
   localStorage.setItem(KEY,clientId);localStorage.setItem(TENANT,tenantId);
  }
  $('cloudSetup').open=false;ui();progress('Configuración guardada. Conecta la cuenta Microsoft.');
 }
 function msalClient(){
  if(client)return client;
  if(!clientId)throw new Error('Falta configurar la aplicación en Microsoft Entra.');
  if(!window.msal?.PublicClientApplication)throw new Error('No se pudo cargar la biblioteca Microsoft MSAL. Conecta el móvil a Internet y actualiza.');
  client=new msal.PublicClientApplication({
   auth:{clientId,authority:'https://login.microsoftonline.com/'+(tenantId||'common'),
    redirectUri:REDIRECT,navigateToLoginRequestUrl:false},
   cache:{cacheLocation:'sessionStorage',storeAuthStateInCookie:false}
  });
  return client;
 }
 async function init(){
  if(!clientId){ui();return;}
  try{
   const c=msalClient(),response=await c.handleRedirectPromise();
   account=response?.account||c.getAllAccounts()[0]||null;
   if(account)c.setActiveAccount(account);
   ui();if(account)queueAuto();
  }catch(e){display('Microsoft no pudo restaurar la sesión: '+errorText(e),true);}
 }
 const errorText=e=>{
  const m=String(e?.message||e?.errorCode||e||'Error desconocido');
  if(m.includes('AADSTS'))return 'Microsoft ha rechazado la autorización. Comprueba Client ID, Tenant, URL SPA y permisos.';
  if(m.includes('Failed to fetch'))return 'No se puede acceder a Microsoft. Revisa la conexión.';
  return m.slice(0,190);
 };
 async function connect(){
  try{
   const c=msalClient();
   await c.handleRedirectPromise();
   await c.loginRedirect({scopes:SCOPES,redirectUri:REDIRECT});
  }catch(e){display('No se pudo conectar: '+errorText(e),true);}
 }
 async function disconnect(){
  if(!client||!account||busy)return;
  const old=account;account=null;folderCache.clear();driveId='';ui();
  try{await client.logoutRedirect({account:old,postLogoutRedirectUri:REDIRECT});}
  catch(e){display('Error al desconectar: '+errorText(e),true);}
 }
 async function getToken(){
  if(!client||!account)throw new Error('Primero debes conectar OneDrive.');
  try{return (await client.acquireTokenSilent({scopes:SCOPES,account})).accessToken;}
  catch(e){
   if(e instanceof msal.InteractionRequiredAuthError)throw new Error('Microsoft necesita volver a autorizar. Pulsa «Conectar Microsoft».');
   throw e;
  }
 }
 async function graph(path,options={}){
  const accessToken=await getToken(),url=path.startsWith('https://')?path:GRAPH+path;
  const r=await fetch(url,{...options,cache:'no-store',headers:{
   Authorization:'Bearer '+accessToken,Accept:'application/json',...(options.headers||{})
  }});
  if(r.status===404&&options.allow404)return null;
  if(!r.ok){
   let body={};try{body=await r.json();}catch{}
   const e=new Error(body.error?.message||'Error Microsoft Graph HTTP '+r.status);
   e.status=r.status;throw e;
  }
  if(r.status===204)return null;
  return r.json();
 }
 const name=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[\/\\:*?"<>|#%]+/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'').slice(0,88)||'sin_nombre';
 const safeId=s=>String(s||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100);
 const digit=n=>String(n).padStart(3,'0');
 const encode=s=>encodeURIComponent(s);
 const photoStem=p=>'FOTO_'+digit(p.sequence)+'_'+safeId(p.id);
 const extension=p=>{
  const x=p.originalName?.match(/\.([a-z0-9]{2,5})$/i);
  if(x)return x[1].toLowerCase();
  return p.mime?.includes('png')?'png':p.mime?.includes('webp')?'webp':'jpg';
 };
 function localKey(){
  return (account?.homeAccountId||account?.username||'none')+'|'+driveId+'|';
 }
 const ledgerSave=()=>localStorage.setItem(LEDGER,JSON.stringify(ledger));
 async function driveRoot(){
  const d=await graph('/me/drive?$select=id,driveType');
  if(!d?.id)throw new Error('Esta cuenta no dispone de una unidad OneDrive accesible.');
  if(d.id!==driveId){driveId=d.id;folderCache.clear();}
  const root=await graph('/me/drive/root?$select=id');
  return root.id;
 }
 const pathAt=(parent,filename)=>'/me/drive/items/'+encode(parent)+':/'+encode(filename);
 async function getRemote(parent,filename){
  return graph(pathAt(parent,filename)+'?$select=id,name,file,folder,size',{allow404:true});
 }
 async function folder(parent,filename){
  const key=parent+'/'+filename;
  if(folderCache.has(key))return folderCache.get(key);
  let item=await getRemote(parent,filename);
  if(item&&!item.folder)throw new Error('Existe un archivo donde debería haber la carpeta '+filename);
  if(!item){
   try{
    item=await graph('/me/drive/items/'+encode(parent)+'/children',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({name:filename,folder:{},'@microsoft.graph.conflictBehavior':'fail'})
    });
   }catch(e){
    if(e.status===409)item=await getRemote(parent,filename);
    else throw e;
   }
  }
  if(!item?.folder||!item.id)throw new Error('No se pudo crear la carpeta '+filename);
  folderCache.set(key,item.id);
  return item.id;
 }
 async function put(parent,filename,blob){
  // Subida sencilla hasta 10 MiB; sesión fragmentada para fotos mayores.
  const path=pathAt(parent,filename);
  if(blob.size<=10*1024*1024){
   return graph(path+':/content',{method:'PUT',
    headers:{'Content-Type':'application/octet-stream'},body:blob});
  }
  const sess=await graph(path+':/createUploadSession',{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({item:{name:filename,'@microsoft.graph.conflictBehavior':'replace'}})});
  if(!sess?.uploadUrl)throw new Error('No se ha creado la sesión de subida.');
  let response=null;
  const chunk=20*327680; // Múltiplo de 320 KiB.
  for(let i=0;i<blob.size;i+=chunk){
   const end=Math.min(i+chunk,blob.size);
   const part=blob.slice(i,end);
   const r=await fetch(sess.uploadUrl,{method:'PUT',
    headers:{'Content-Range':'bytes '+i+'-'+(end-1)+'/'+blob.size},body:part});
   if(!r.ok)throw new Error('Error al enviar la foto: HTTP '+r.status);
   response=await r.json();
  }
  return response;
 }
 async function syncReport(report){
  const images=await ReportDB.photosByReport(report.id);
  const root=await driveRoot();
  let parent=await folder(root,'SERS REPORTAJES');
  parent=await folder(parent,name(report.name)+'__'+safeId(report.id).slice(0,32));
  const imageFolder=await folder(parent,'FOTOGRAFIAS');
  const dataFolder=await folder(parent,'DATOS');
  let sent=0,untouched=0,failed=0;
  const owned=localKey();
  for(const [i,p] of images.entries()){
   progress('«'+report.name+'»: comprobando foto '+(i+1)+' de '+images.length+'…');
   try{
    const stem=photoStem(p),filename=stem+'.'+extension(p),metaName=stem+'.json';
    const photoKey=owned+'f:'+p.id;
    const photoRemote=await getRemote(imageFolder,filename);
    if(!photoRemote||!photoRemote.file||photoRemote.size!==p.file.size||ledger[photoKey]!==filename){
     // Si ya existe y tamaño coincide, lo reconocemos sin subirlo de nuevo.
     if(!photoRemote||!photoRemote.file||photoRemote.size!==p.file.size){
      const uploaded=await put(imageFolder,filename,p.file);
      if(!uploaded?.id)throw new Error('OneDrive no ha confirmado la fotografía.');
      sent++;
     }else untouched++;
     ledger[photoKey]=filename;ledgerSave();
    }else untouched++;
    const metaKey=owned+'m:'+p.id,remoteMeta=await getRemote(dataFolder,metaName);
    const version=p.updatedAt||p.addedAt;
    if(!remoteMeta||ledger[metaKey]!==version){
     const metadata=window.SersReportajes?.photoMeta?.(p);
     if(!metadata)throw new Error('Metadatos no disponibles.');
     const saved=await put(dataFolder,metaName,new Blob([JSON.stringify(metadata,null,2)],{type:'application/json'}));
     if(!saved?.id)throw new Error('OneDrive no ha confirmado los datos de la foto.');
     ledger[metaKey]=version;ledgerSave();
    }
   }catch(e){failed++;console.error('No se pudo sincronizar la foto '+p.id,e);}
  }
  if(failed)return {sent,untouched,failed};
  const reportKey=owned+'r:'+report.id,rev=String(report.updatedAt)+'|'+images.length+'|'+images.map(p=>p.updatedAt).join(';');
  let oldIndex=await getRemote(parent,'reportaje.json');
  if(!oldIndex||ledger[reportKey]!==rev){
   const reportData={id:report.id,nombre:report.name,tipo:report.type,
    creado:report.createdAt,actualizado:report.updatedAt,cerrado:report.closedAt,
    numero_fotos:images.length,fotografias:images.map(p=>window.SersReportajes.photoMeta(p))};
   const geo=window.SersReportajes.geojson(report,images);
   const a=await put(parent,'reportaje.json',new Blob([JSON.stringify(reportData,null,2)],{type:'application/json'}));
   const b=await put(dataFolder,'localizaciones.geojson',new Blob([JSON.stringify(geo,null,2)],{type:'application/geo+json'}));
   if(!a?.id||!b?.id)throw new Error('OneDrive no confirmó el índice del reportaje.');
   ledger[reportKey]=rev;ledgerSave();
  }
  return {sent,untouched,failed};
 }
 async function sync(){
  if(busy)return;
  if(!navigator.onLine){progress('Sin conexión. Todo continúa guardado en el móvil.');return;}
  if(!account){progress('Primero conecta OneDrive desde «Configurar cuenta Microsoft».');return;}
  busy=true;$('cloudSync').disabled=true;
  $('cloudSync').textContent='Sincronizando…';
  let sent=0,untouched=0,failed=0;
  try{
   const reports=await ReportDB.listReports();
   if(!reports.length){progress('No hay reportajes que sincronizar.');return;}
   for(const r of reports){
    try{
     const result=await syncReport(r);
     sent+=result.sent;untouched+=result.untouched;failed+=result.failed;
    }catch(e){failed++;console.error('Error sincronizando reportaje '+r.id,e);}
   }
   progress(sent+' fotos enviadas · '+untouched+' ya presentes · '+failed+' errores.');
   if(failed)display('Sincronización incompleta. Revisa tu conexión y vuelve a pulsar.',true);
   else ui();
  }catch(e){display('Error OneDrive: '+errorText(e),true);progress(errorText(e));}
  finally{busy=false;$('cloudSync').disabled=false;$('cloudSync').textContent='Sincronizar pendientes';}
 }
 function queueAuto(){
  if(!account||!$('autoSync').checked||!navigator.onLine||busy)return;
  clearTimeout(timer);timer=setTimeout(sync,2100);
 }
 $('cloudSaveConfig').addEventListener('click',saveConfig);
 $('cloudConnect').addEventListener('click',connect);
 $('cloudDisconnect').addEventListener('click',disconnect);
 $('cloudSync').addEventListener('click',sync);
 $('autoSync').addEventListener('change',()=>{
  localStorage.setItem(AUTO,$('autoSync').checked?'yes':'no');
  if($('autoSync').checked)queueAuto();else clearTimeout(timer);
 });
 window.addEventListener('online',queueAuto);
 window.addEventListener('sers-reportajes:saved',queueAuto);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueAuto();});
 ui();init();
})();
