/* Escribe ZIP sin librerías, red ni compresión: fotos y audios se preservan íntegros.
   Al exportar, los archivos se almacenan en el ZIP sin recodificarse. */
'use strict';
const SersZip = (() => {
  const encoder = new TextEncoder();
  const table = new Uint32Array(256);
  for (let i=0;i<256;i++) { let c=i; for(let j=0;j<8;j++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1); table[i]=c>>>0; }
  function crc32(bytes) { let c=0xffffffff; for (let i=0;i<bytes.length;i++) c=table[(c^bytes[i])&255]^(c>>>8); return (c^0xffffffff)>>>0; }
  function appendU16(a, v) { a.push(v&255,(v>>>8)&255); }
  function appendU32(a, v) { appendU16(a,v&65535);appendU16(a,(v>>>16)&65535); }
  function dosDate(t) {
    const d = new Date(t || Date.now());
    return {time:((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31), date:(((Math.max(1980,d.getFullYear())-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31)};
  }
  async function create(entries) {
    const chunks=[];const centers=[];let offset=0;
    for (const entry of entries) {
      const name=encoder.encode(entry.name.replace(/\\/g,'/'));
      const bytes=entry.data instanceof Blob ? new Uint8Array(await entry.data.arrayBuffer()) : (typeof entry.data==='string'?encoder.encode(entry.data):entry.data);
      if(name.length>65535||bytes.length>0xffffffff) throw new Error('Un archivo es demasiado grande para este ZIP');
      const crc=crc32(bytes), dt=dosDate(entry.date), local=[];
      appendU32(local,0x04034b50);appendU16(local,20);appendU16(local,0x0800);appendU16(local,0);appendU16(local,dt.time);appendU16(local,dt.date);
      appendU32(local,crc);appendU32(local,bytes.length);appendU32(local,bytes.length);appendU16(local,name.length);appendU16(local,0);
      chunks.push(new Uint8Array(local),name,bytes);
      const central=[];appendU32(central,0x02014b50);appendU16(central,20);appendU16(central,20);appendU16(central,0x0800);appendU16(central,0);
      appendU16(central,dt.time);appendU16(central,dt.date);appendU32(central,crc);appendU32(central,bytes.length);appendU32(central,bytes.length);
      appendU16(central,name.length);appendU16(central,0);appendU16(central,0);appendU16(central,0);appendU16(central,0);appendU32(central,0);appendU32(central,offset);
      centers.push(new Uint8Array(central),name);
      offset+=local.length+name.length+bytes.length;
      if (offset>0xffffffff) throw new Error('El conjunto de archivos supera el límite del ZIP (4 GB)');
    }
    if(entries.length>65535) throw new Error('Demasiados archivos para un ZIP');
    const centralLength=centers.reduce((s,v)=>s+v.length,0);
    const end=[];appendU32(end,0x06054b50);appendU16(end,0);appendU16(end,0);appendU16(end,entries.length);appendU16(end,entries.length);
    appendU32(end,centralLength);appendU32(end,offset);appendU16(end,0);
    return new Blob([...chunks,...centers,new Uint8Array(end)],{type:'application/zip'});
  }
  return { create };
})();
