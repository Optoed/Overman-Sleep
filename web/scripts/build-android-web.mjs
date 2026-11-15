import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out=resolve('../android/app/src/main/assets');await mkdir(out,{recursive:true});
await build({entryPoints:['mobile/entry.tsx'],outdir:out,bundle:true,splitting:true,format:'esm',platform:'browser',target:['chrome100'],minify:true,jsx:'automatic',entryNames:'app',chunkNames:'chunks/[name]-[hash]',assetNames:'assets/[name]-[hash]',loader:{'.css':'local-css','.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_OVERMAN_API_ORIGIN':JSON.stringify(process.env.NEXT_PUBLIC_OVERMAN_API_ORIGIN??'')}});
await cp('public/world',resolve(out,'world'),{recursive:true});
await cp('public/licenses',resolve(out,'licenses'),{recursive:true});
await writeFile(resolve(out,'index.html'),'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#10191b"><title>Overman · Сон</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
// Native alarms use the same original synthesized melodies as the web preview.
const raw=resolve('../android/app/src/main/res/raw');await mkdir(raw,{recursive:true});
for(const [name,notes] of Object.entries({dawn:[261,329,392,523],bell:[659,830,987],birds:[1046,1318,1174,1568]})){
  const rate=22050,length=rate*4,buffer=Buffer.alloc(44+length*2);buffer.write('RIFF');buffer.writeUInt32LE(36+length*2,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(length*2,40);
  for(let i=0;i<length;i++){let sample=0;const t=i/rate;notes.forEach((f,n)=>{const dt=t-n*.3;if(dt>=0&&dt<1)sample+=Math.sin(2*Math.PI*f*dt)*Math.min(1,dt/.08)*Math.exp(-dt*5)*.2;});buffer.writeInt16LE(Math.round(Math.max(-1,Math.min(1,sample))*32767),44+i*2);}await writeFile(resolve(raw,`${name}.wav`),buffer);
}
console.log('Offline Android assets and original alarm tones built.');
