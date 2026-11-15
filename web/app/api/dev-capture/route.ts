import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime='nodejs';
const directory=path.join(process.cwd(),'.captures');
const limit=12*1024*1024;
function enabled(request:Request){return process.env.NODE_ENV==='development'&&['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);}

// Local visual-review artifacts only. This endpoint is unavailable in production.
export async function POST(request:Request){
  if(!enabled(request))return new Response(null,{status:404});
  if(request.headers.get('origin')!==new URL(request.url).origin)return new Response(null,{status:403});
  if(request.headers.get('content-type')!=='image/png')return new Response(null,{status:415});
  const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
  const png=Buffer.concat(chunks);
  if(png.length<24||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return new Response(null,{status:400});
  const id=randomUUID();await mkdir(directory,{recursive:true});await writeFile(path.join(directory,`${id}.png`),png,{flag:'wx'});
  return Response.json({url:`/api/dev-capture?id=${id}`},{headers:{'Cache-Control':'no-store'}});
}
export async function GET(request:Request){
  if(!enabled(request))return new Response(null,{status:404});
  const id=new URL(request.url).searchParams.get('id')??'';
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))return new Response(null,{status:400});
  try{const bytes=await readFile(path.join(directory,`${id}.png`));return new Response(bytes,{headers:{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch{return new Response(null,{status:404});}
}
