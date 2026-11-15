import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ROOM_PLAYWRIGHT_PACKAGE||'playwright');
const output=resolve('../docs/product-evidence'),checks=[],errors=[];
await mkdir(output,{recursive:true});
// Disposable component host, using the production component and CSS unchanged.
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Hold from './components/sleep/hold-to-wake';window.events=[];window.setDisabled=null;function Test(){const[d,set]=React.useState(false);window.setDisabled=set;return <><Hold disabled={d} onWake={()=>{window.events.push(performance.now());}}/><button id="other">Other control</button></>;}createRoot(document.getElementById('root')).render(<Test/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'out',entryNames:'hold',jsx:'automatic'});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=createServer((req,res)=>{if(req.url==='/hold.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}else if(req.url==='/hold.css'){res.setHeader('Content-Type','text/css');res.end(css);}else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/hold.css"></head><body style="padding:24px;background:#101916"><div id="root"></div><script src="/hold.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2020-01-01')});await page.clock.pauseAt(new Date('2021-01-01'));
 const url=`http://127.0.0.1:${server.address().port}`;
 let b,center,started;
 const count=()=>page.evaluate(()=>window.events.length);
 async function reset(){await page.goto(url);b=page.getByRole('button',{name:'Удерживать «Проснуться» 3 секунды',exact:true});await b.waitFor();const box=await b.boundingBox();center={x:box.x+box.width/2,y:box.y+box.height/2};}
 const advance=ms=>page.clock.runFor(ms);
 async function press(key){await b.focus();started=await page.evaluate(()=>performance.now());await page.keyboard.down(key);}
 async function mouse(){await page.mouse.move(center.x,center.y);started=await page.evaluate(()=>performance.now());await page.mouse.down();}
 async function oneCompletion(){await advance(2999);assert.equal(await count(),0);await advance(33);assert.equal(await count(),1);assert.ok(await page.evaluate(t=>window.events[0]-t>=3000,started));await advance(4000);assert.equal(await count(),1);}
 for(const key of ['Space','Enter']){await reset();await press(key);await oneCompletion();await page.keyboard.up(key);checks.push(`${key}: no action at 2999 ms; exactly one action after >=3000 ms, even while held longer`);}
 await reset();await mouse();await oneCompletion();await page.mouse.up();checks.push('Mouse: minimum elapsed monotonic time and one completion');
 for(const reason of ['release','leave','button blur','window blur','disabled','capture lost']){
   await reset();await mouse();await advance(1400);
   if(reason==='release')await page.mouse.up();
   if(reason==='leave')await page.mouse.move(0,0);
   if(reason==='button blur')await page.locator('#other').focus();
   if(reason==='window blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   if(reason==='disabled')await page.evaluate(()=>window.setDisabled(true));
   if(reason==='capture lost')await b.evaluate(el=>el.releasePointerCapture(1));
   await advance(4000);assert.equal(await count(),0,reason);await page.mouse.up();
   await page.evaluate(()=>window.setDisabled(false));await mouse();await oneCompletion();await page.mouse.up();
   checks.push(`Mouse ${reason}: progress discarded and a fresh full hold required`);
 }
 await reset();await press('Space');await advance(1200);await page.keyboard.down('Enter');await page.keyboard.up('Enter');await advance(1799);assert.equal(await count(),0);await advance(33);assert.equal(await count(),1);await page.keyboard.up('Space');checks.push('Unrelated Enter release cannot cancel a Space gesture');
 await reset();await press('Enter');await advance(1200);await page.locator('#other').focus();await advance(4000);assert.equal(await count(),0);await page.keyboard.up('Enter');checks.push('Keyboard focus loss cancels the gesture');
 const cdp=await context.newCDPSession(page),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({id:p.id??1,x:p.x??center.x,y:p.y??center.y}))});
 await reset();started=await page.evaluate(()=>performance.now());await touch('touchStart',[{}]);await oneCompletion();await touch('touchEnd',[]);checks.push('Trusted touch: minimum 3000 ms, exactly one completion');
 for(const reason of ['release','cancel','leave','owning finger lifted']){
   await reset();await touch('touchStart',[{}]);await advance(1300);
   if(reason==='release')await touch('touchEnd',[]);
   if(reason==='cancel')await touch('touchCancel',[]);
   if(reason==='leave')await touch('touchMove',[{x:0,y:0}]);
   if(reason==='owning finger lifted'){await touch('touchStart',[{id:1},{id:2,x:center.x+10}]);await touch('touchEnd',[{id:1}]);}
   await advance(4000);assert.equal(await count(),0,reason);if(reason==='leave'||reason==='owning finger lifted')await touch('touchEnd',[]);
   checks.push(`Trusted touch ${reason}: no completion after interruption`);
 }
 await reset();await press('Space');await advance(1500);await page.clock.setSystemTime(new Date('2040-01-01'));assert.equal(await count(),0);await advance(1499);assert.equal(await count(),0);await advance(33);assert.equal(await count(),1);await page.keyboard.up('Space');checks.push('Wall-clock jump does not shorten the monotonic hold');
 // Headless tabs stay visible. Inject only this lifecycle signal; actual Android
 // backgrounding is checked separately in the installed WebView.
 await reset();await mouse();await advance(1300);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await advance(4000);assert.equal(await count(),0);await page.mouse.up();checks.push('Injected hidden-page lifecycle signal: visibility handler discards elapsed progress (headless browser does not background tabs)');
 // One real-time trial keeps the deterministic clock checks honest.
 const realContext=await browser.newContext({viewport:{width:390,height:844}}),real=await realContext.newPage();await real.goto(url);const rb=real.getByRole('button',{name:'Удерживать «Проснуться» 3 секунды'});await rb.waitFor();await rb.focus();
 const t=await real.evaluate(()=>performance.now());await real.keyboard.down('Enter');await real.waitForTimeout(2200);assert.equal(await real.evaluate(()=>window.events.length),0);await real.waitForFunction(()=>window.events.length===1);const elapsed=await real.evaluate(t=>window.events[0]-t,t);assert.ok(elapsed>=3000);await real.keyboard.up('Enter');
 await real.screenshot({path:resolve(output,'01.03-hold-browser.png')});checks.push(`Real-time Enter gesture: callback after ${elapsed.toFixed(1)} ms`);
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'01.03-hold-browser.json'),JSON.stringify({host:'isolated production component, actual Edge mouse/touch/keyboard; virtual monotonic time except real-time trial',checks,errors},null,2));console.log(JSON.stringify({checks,errors}));await realContext.close();await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
