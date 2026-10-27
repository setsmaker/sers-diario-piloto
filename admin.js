/* Administración de obras SERS mediante la API oficial de GitHub.
   El token se mantiene SOLO en la memoria de esta pestaña durante la sesión.
   Jamás se almacena en localStorage, sessionStorage, IndexedDB o archivos. */
'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const api='https://api.github.com';
  const repo='setsmaker/sers-diario-piloto';
  const fileUrl=api+'/repos/'+repo+'/contents/obras.json';
  let token='', catalog=null, sha='',busy=false,adminUser='';
  const fields=['adminProjectSelect','adminName','adminCode','adminPromoter','adminContractor','adminZones','adminUnits','adminActive','adminPublicConfirm'];
  const notify=(message,error=false)=>{
    const status=$('adminStatus');
    status.textContent=message;
    status.classList.toggle('admin-error',error);
  };
  function setBusy(value){
    busy=value;
    for(const id of ['adminUnlock','adminSave','adminReload'])$(id).disabled=value;
  }
  function lock(){
    token='';sha='';catalog=null;adminUser='';
    $('adminToken').value='';
    $('adminPublicConfirm').checked=false;
    $('adminLogin').classList.remove('hidden');
    $('adminEditor').classList.add('hidden');
  }
  function headers(){
    if(!token)throw new Error('Inicia sesión para continuar');
    return {'Accept':'application/vnd.github+json',
      'Authorization':'Bearer '+token,
      'X-GitHub-Api-Version':'2022-11-28'};
  }
  async function request(path,options={}){
    const response=await fetch(path,{
      ...options,
      headers:{...headers(),...(options.headers||{})},
      cache:'no-store'
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      const code=response.status;
      if(code===401)throw new Error('Token no válido o caducado.');
      if(code===403)throw new Error('GitHub ha rechazado el acceso. Comprueba el permiso Contents: Read and write y que el token tenga acceso a este repositorio.');
      if(code===409||code===422)throw new Error('Otro cambio ha modificado el catálogo. Recarga el catálogo antes de volver a guardar.');
      throw new Error('Error de GitHub (HTTP '+code+'). Comprueba tu conexión e inténtalo de nuevo.');
    }
    return body;
  }
  function decodeBase64(encoded){
    const raw=atob(encoded.replace(/\s/g,''));
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function encodeBase64(text){
    const bytes=new TextEncoder().encode(text);
    let binary='';
    for(let i=0;i<bytes.length;i+=8192){
      binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    }
    return btoa(binary);
  }
  function safeCatalog(data){
    if(!data||!Array.isArray(data.obras)||!Number.isInteger(data.schemaVersion)){
      throw new Error('El catálogo de GitHub no tiene un formato válido.');
    }
    if(!data.obras.every(p=>p&&typeof p.id==='string'&&typeof p.nombre==='string'&&
      Array.isArray(p.zonas)&&Array.isArray(p.unidades)))throw new Error('El catálogo contiene una obra con formato incorrecto.');
    const ids=new Set(data.obras.map(p=>p.id));
    if(ids.size!==data.obras.length)throw new Error('El catálogo tiene identificadores repetidos.');
    return data;
  }
  function lines(value){
    const used=new Set();
    return value.split(/\r?\n/).map(x=>x.trim()).filter(x=>{
      if(!x)return false;
      const key=x.toLocaleLowerCase('es');
      if(used.has(key))return false;
      used.add(key);
      return true;
    });
  }
  function slug(value){
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,58)||'obra';
  }
  function fillSelect(selected){
    const select=$('adminProjectSelect');
    select.replaceChildren();
    const option=document.createElement('option');
    option.value='__new__';option.textContent='+ Crear nueva obra';
    select.append(option);
    for(const p of catalog.obras){
      const opt=document.createElement('option');
      opt.value=p.id;
      opt.textContent=p.nombre+(p.activa===false?' (archivada)':'');
      select.append(opt);
    }
    select.value=selected&&catalog.obras.some(p=>p.id===selected)?selected:'__new__';
    fillEditor();
  }
  function fillEditor(){
    if(!catalog)return;
    const p=catalog.obras.find(p=>p.id===$('adminProjectSelect').value);
    $('adminName').value=p?.nombre||'';
    $('adminCode').value=p?.codigo||'';
    $('adminPromoter').value=p?.promotor||'';
    $('adminContractor').value=p?.contratista||'';
    $('adminZones').value=(p?.zonas||[]).join('\n');
    $('adminUnits').value=(p?.unidades||[]).join('\n');
    $('adminActive').checked=p?.activa!==false;
    $('adminPublicConfirm').checked=false;
  }
  async function loadCatalog(preferred){
    const raw=await request(fileUrl+'?ref=main');
    if(!raw.sha||raw.encoding!=='base64')throw new Error('GitHub no ha devuelto el contenido del catálogo.');
    const parsed=safeCatalog(JSON.parse(decodeBase64(raw.content)));
    sha=raw.sha;catalog=parsed;
    fillSelect(preferred);
    notify('Catálogo cargado de GitHub. Puedes editarlo.');
  }
  async function connect(){
    if(busy)return;
    const proposed=$('adminToken').value.trim();
    if(!proposed){notify('Introduce un token de GitHub con acceso al repositorio.',true);return;}
    token=proposed;
    $('adminToken').value='';
    setBusy(true);
    notify('Comprobando permisos de GitHub…');
    try{
      const user=await request(api+'/user');
      if(user.login!=='setsmaker')throw new Error('Esta administración está reservada a la cuenta GitHub setsmaker.');
      const repository=await request(api+'/repos/'+repo);
      if(repository.permissions?.push!==true)throw new Error('Esta cuenta no tiene permiso para escribir en el repositorio.');
      adminUser=user.login;
      await loadCatalog();
      $('adminIdentity').textContent='Conectado: '+adminUser;
      $('adminLogin').classList.add('hidden');
      $('adminEditor').classList.remove('hidden');
    }catch(e){
      lock();notify(e.message||'No se ha podido conectar con GitHub.',true);
    }finally{setBusy(false);}
  }
  function buildProject(){
    const name=$('adminName').value.trim();
    if(!name)throw new Error('Escribe el nombre de la obra.');
    const p0=catalog.obras.find(p=>p.id===$('adminProjectSelect').value);
    if(catalog.obras.some(p=>p.id!==p0?.id&&p.nombre.trim().toLocaleLowerCase('es')===name.toLocaleLowerCase('es'))){
      throw new Error('Ya hay una obra con ese nombre.');
    }
    const zones=lines($('adminZones').value),works=lines($('adminUnits').value);
    if(zones.length>250||works.length>250)throw new Error('Demasiadas opciones; máximo 250 por catálogo de zonas o unidades.');
    if([...zones,...works].some(v=>v.length>140))throw new Error('Cada zona y unidad debe tener 140 caracteres como máximo.');
    let id=p0?.id;
    if(!id){
      const base=slug(name);
      id=base;
      let n=2;
      while(catalog.obras.some(p=>p.id===id)){id=base+'-'+n;n++;}
    }
    return {...(p0||{}),id,nombre:name,codigo:$('adminCode').value.trim(),
      promotor:$('adminPromoter').value.trim(),contratista:$('adminContractor').value.trim(),
      zonas:zones,unidades:works,activa:$('adminActive').checked};
  }
  async function publish(){
    if(busy||!token||!catalog)return;
    if(!$('adminPublicConfirm').checked){notify('Confirma que los datos pueden publicarse abiertamente en GitHub Pages.',true);return;}
    let newProject;
    try{newProject=buildProject();}
    catch(e){notify(e.message,true);return;}
    const records=catalog.obras.slice();
    const index=records.findIndex(p=>p.id===newProject.id);
    if(index<0)records.push(newProject);else records[index]=newProject;
    if(!records.some(p=>p.activa!==false)){
      notify('Tiene que quedar al menos una obra activa.',true);return;
    }
    const wasNew=index<0;
    const next={...catalog,updatedAt:new Date().toISOString().slice(0,10),
      revision:new Date().toISOString(),obras:records};
    setBusy(true);
    notify('Guardando cambios en GitHub…');
    try{
      const result=await request(fileUrl,{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          message:(wasNew?'Crear obra: ':'Actualizar obra: ')+newProject.nombre,
          content:encodeBase64(JSON.stringify(next,null,2)+'\n'),
          sha,branch:'main'
        })
      });
      if(!result.content?.sha)throw new Error('GitHub no ha confirmado el archivo actualizado.');
      sha=result.content.sha;
      catalog=next;
      fillSelect(newProject.id);
      window.dispatchEvent(new CustomEvent('sers:catalog-published',{
        detail:{catalog:next,projectId:newProject.activa?newProject.id:null}
      }));
      notify('Guardado en GitHub. La obra ya está actualizada en este móvil; otros teléfonos recibirán el cambio al actualizar el catálogo.');
    }catch(e){
      notify(e.message||'No se pudo publicar la configuración.',true);
    }finally{setBusy(false);}
  }
  $('adminUnlock').addEventListener('click',connect);
  $('adminToken').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();connect();}
  });
  $('adminProjectSelect').addEventListener('change',fillEditor);
  $('adminSave').addEventListener('click',publish);
  $('adminReload').addEventListener('click',async()=>{
    if(!token||busy)return;
    setBusy(true);
    try{await loadCatalog($('adminProjectSelect').value);}
    catch(e){notify(e.message,true);}
    finally{setBusy(false);}
  });
  $('adminLogout').addEventListener('click',()=>{lock();notify('Administración cerrada.');});
})();
