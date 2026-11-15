import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ROOM_PLAYWRIGHT_PACKAGE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],key='overman.sleep-tower.v1';
try{
 const fixture=JSON.parse(await readFile(resolve('../docs/product-evidence/01.09-accepted/01.09-legacy-fixture.json'),'utf8'));
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Moscow',reducedMotion:'reduce'});
 await context.addInitScript(({fixture,key})=>{
  localStorage.setItem(key,JSON.stringify(fixture));
  const qa=window.__pollRace={status:{native:true,exact:true,notifications:true,microphone:false,ringing:false,protocolVersion:2,sessionId:'',revision:1},calls:[],holdPoll:false,heldPoll:null,heldStart:null};
  window.OvermanAndroid={invoke(method,body,id){
   const payload=JSON.parse(body);qa.calls.push({method,body:payload});
   if(method==='status'&&qa.holdPoll){qa.holdPoll=false;qa.heldPoll=id;return;}
   if(method==='start'){
    qa.status={...qa.status,sessionId:payload.active.id,activeNight:payload.active,revision:2,tracking:true};
    if(!qa.heldStart){qa.heldStart=id;return;}
   }
   setTimeout(()=>window.overmanNativeReply(id,{...qa.status}),0);
  }};
 },{fixture,key});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-11-02T20:00Z')});
 await page.goto('http://127.0.0.1:3000/');await page.getByRole('button',{name:'Ложусь спать',exact:true}).waitFor();await page.waitForTimeout(300);
 await page.evaluate(()=>{window.__pollRace.holdPoll=true;});await page.clock.fastForward(15000);
 await page.waitForFunction(()=>!!window.__pollRace.heldPoll);
 await page.getByRole('button',{name:'Ложусь спать',exact:true}).click();await page.waitForFunction(()=>!!window.__pollRace.heldStart);
 await page.evaluate(()=>window.overmanNativeReply(window.__pollRace.heldPoll,{...window.__pollRace.status}));
 await page.clock.fastForward(16000);await page.waitForFunction(()=>!document.querySelector('main').hasAttribute('data-operation'));
 const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
 assert.equal((await stored()).active,null);assert.equal(await page.locator('main').getAttribute('data-night-phase'),'idle');
 assert.ok((await page.locator('main').innerText()).includes('Android не ответил'));
 checks.push('Periodic status requested before start, delivered during withheld start, cannot implicitly commit native-only start after the command times out');
 const calls=await page.evaluate(()=>window.__pollRace.calls.filter(x=>x.method==='status').length);
 await page.clock.fastForward(16000);assert.equal((await stored()).active,null);
 assert.equal(await page.evaluate(()=>window.__pollRace.calls.filter(x=>x.method==='status').length),calls);
 checks.push('After timeout a further visible poll interval sends no competing status request and preserves explicit retry/error');
 await page.getByRole('button',{name:'Ложусь спать',exact:true}).click();await page.locator('main[data-night-phase=sleeping]').waitFor();
 const starts=await page.evaluate(()=>window.__pollRace.calls.filter(x=>x.method==='start'));
 assert.equal(starts.length,2);assert.equal(starts[0].body.active.id,starts[1].body.active.id);assert.equal((await stored()).active.id,starts[0].body.active.id);
 checks.push('Deliberate retry succeeds with the identical UUID; one archive active night is committed');
 const afterRetry=await page.evaluate(()=>window.__pollRace.calls.filter(x=>x.method==='status').length);
 await page.clock.fastForward(16000);await page.waitForFunction(n=>window.__pollRace.calls.filter(x=>x.method==='status').length>n,afterRetry);
 assert.deepEqual(errors,[]);checks.push('Periodic refresh resumes after acknowledged retry; no page errors');
 await writeFile(resolve('../docs/product-evidence/01.07-poll-browser.json'),JSON.stringify({checks,errors,fixture:'Isolated mobile browser; controlled clock and intentionally withheld simulated Android replies. Actual native lost reply, wall-clock timeout, process death and ACK tested separately in installed QA.'},null,2));
 console.log(JSON.stringify({checks,errors}));await context.close();
}finally{await browser.close();}
