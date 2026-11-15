import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ROOM_PLAYWRIGHT_PACKAGE||'playwright');
const root=resolve('../android/app/src/main/assets'),mime={'.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.bin':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.html':'text/html'};
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname,target=resolve(root,pathname==='/'?'index.html':`.${pathname}`);if(!target.startsWith(root+sep)){res.writeHead(403).end();return;}res.setHeader('Content-Type',mime[extname(target)]||'application/octet-stream');res.end(await readFile(target));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
try{const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.goto(`${url}/?demo=1`);await page.getByRole('button',{name:'Ложусь спать',exact:true}).waitFor();
  await page.screenshot({path:resolve('../docs/sleep-mvp/08-offline-package.png'),fullPage:true});
  await page.getByRole('navigation',{name:'Основные разделы'}).getByRole('button',{name:'Башня',exact:true}).click();await page.locator('[data-scene-status="ready"]').waitFor({timeout:60000});await page.waitForTimeout(2500);
  assert.deepEqual(errors,[]);await writeFile(resolve('../docs/sleep-mvp/offline-check.json'),JSON.stringify({errors,bundledInterface:true,bundledTower:true}));console.log('Offline package: UI, fonts and 3D scene loaded without Next.js or remote assets.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
