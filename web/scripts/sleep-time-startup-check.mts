import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {freshSleep} from '../components/sleep/sleep-state';

// Run against either next dev or a completed next build/start. Every context is disposable.
const [baseUrl,output]=process.argv.slice(2);
assert(baseUrl&&output,'Provide the local Next URL and a new evidence directory.');
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const out=resolve(output);await mkdir(out,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROOM_PLAYWRIGHT_PACKAGE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[];
const fixture={...freshSleep(),configured:true};
try{
 for(const route of ['/','/app'])for(const [width,zone,date] of [[320,'America/New_York','2026-12-31'],[1280,'Asia/Tokyo','2027-01-01']] as const){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:zone});
  try{
   const page=await context.newPage(),errors:string[]=[],consoleErrors:string[]=[];
   page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
   await context.addInitScript({content:`if(localStorage.getItem('overman.sleep-tower.v1')===null)localStorage.setItem('overman.sleep-tower.v1',${JSON.stringify(JSON.stringify(fixture))});`});
   await page.clock.install({time:'2026-12-31T23:50:00Z'});await page.goto(new URL(route,baseUrl).href);
   await page.getByRole('navigation').getByRole('button',{name:'Статистика',exact:true}).click();
   await page.getByRole('button',{name:'Журнал',exact:true}).click();
   assert.equal(await page.getByLabel('Выбрать дату',{exact:true}).inputValue(),date);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
   await page.screenshot({path:resolve(out,`${route==='/'?'root':'app'}-${width}.png`)});
   checks.push({name:`${route}, ${zone}, ${width}px: browser-local ${date} at the same UTC instant; ordinary navigation without runtime/hydration errors or overflow`,status:'passed'});
  }finally{await context.close();}
 }
}finally{await browser.close();}
await writeFile(resolve(out,'startup.json'),JSON.stringify({requirementId:'01.08',result:'passed',verifiedAt:new Date().toISOString(),baseUrl,checks,fixture:'Isolated synthetic browser archive and controlled browser calendar/timezone; actual Android system time is tested separately.'},null,2));
console.log(JSON.stringify({result:'passed',checks:checks.length}));
