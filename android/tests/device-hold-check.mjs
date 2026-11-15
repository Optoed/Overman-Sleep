import {archiveQaSource} from './device-test-session.mjs';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const adb=resolve('.tools/android-sdk/platform-tools/adb.exe'),serial=process.env.OVERMAN_TEST_DEVICE??'emulator-5554';
if(!serial.startsWith('emulator-'))throw Error('Dedicated emulator only');
const shell=(...args)=>execFileSync(adb,['-s',serial,'shell',...args],{encoding:'utf8'});
assert.equal(shell('getprop','ro.boot.qemu.avd_name').trim(),'overman-qa');
shell('pm','clear','app.overman.sleep');shell('pm','grant','app.overman.sleep','android.permission.POST_NOTIFICATIONS');shell('input','keyevent','224');shell('wm','dismiss-keyguard');shell('am','start','-n','app.overman.sleep/.MainActivity');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<120;i++){try{if(await fn())return;}catch{}await delay(100);}throw Error(label);};
let pid;await until(()=>{pid=shell('pidof','app.overman.sleep').trim();return !!pid;},'process starts');
execFileSync(adb,['-s',serial,'forward','tcp:9223',`localabstract:webview_devtools_remote_${pid}`]);
let target;await until(async()=>{target=(await(await fetch('http://127.0.0.1:9223/json/list')).json()).find(t=>t.url.includes('appassets'));return !!target;},'WebView starts');
const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);};
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression:archiveQaSource+';'+expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const state=()=>evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1'))`);
const label=name=>evaluate(`document.querySelector(${JSON.stringify(`button[aria-label=${JSON.stringify(name)}]`)}).click()`);
const checks=[];
try{
 await until(()=>evaluate(`!!document.querySelector('button[aria-label="Настройки сна"]')`),'offline app loads');await label('Настройки сна');
 await until(()=>evaluate(`!!document.querySelector('[role=dialog] form')`),'form opens');await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);
 await until(()=>state().then(s=>s?.configured),'configured');await until(()=>evaluate(`!document.querySelector('main').hasAttribute('data-operation')`),'settings finished');
 await label('Ложусь спать');await until(()=>state().then(s=>!!s?.active),'night begins');
 await evaluate(`window.__holdEvents=[];window.addEventListener('blur',()=>__holdEvents.push({type:'blur',time:performance.now()}));document.addEventListener('visibilitychange',()=>__holdEvents.push({type:'visibility',hidden:document.hidden,time:performance.now()}));`);
 let center=await evaluate(`(()=>{const b=document.querySelector('button[aria-label="Удерживать «Проснуться» 3 секунды"]').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...center,button:'left',clickCount:1});await delay(1000);
 shell('input','keyevent','3');await delay(3400);const hidden=await evaluate('document.hidden');
 shell('am','start','-n','app.overman.sleep/.MainActivity');await delay(800);
 assert.equal((await state()).active.wokeAt,undefined,'backgrounding must not complete an interrupted hold');
 const lifecycle=await evaluate('window.__holdEvents');assert.ok(lifecycle.some(e=>e.type==='blur'||e.hidden),'OS sends a real focus/visibility interruption');
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',...center,button:'left',clickCount:1});
 checks.push({name:'Actual Android Home/background/resume after interrupted WebView hold leaves night sleeping',hiddenWhileBackgrounded:hidden,lifecycle});
 // True touch events in the installed WebView, followed by an independent full hold.
 const touch=type=>call('Input.dispatchTouchEvent',{type,touchPoints:type==='touchStart'?[{...center,id:1}]:[]});
 await touch('touchStart');await delay(1000);await touch('touchCancel');await delay(2400);assert.equal((await state()).active.wokeAt,undefined);
 checks.push({name:'Actual WebView touch cancellation prevents wake'});
 const start=await evaluate('performance.now()');await touch('touchStart');await delay(2200);assert.equal((await state()).active.wokeAt,undefined);
 await until(()=>state().then(s=>!!s?.active?.wokeAt),'full touch hold completes');await touch('touchEnd');
 const first=(await state()).active.wokeAt;await delay(500);assert.equal((await state()).active.wokeAt,first);
 assert.ok(await evaluate(`performance.now()-${start}>=3000`));
 checks.push({name:'Fresh full WebView touch hold records one stable wake after >=3000 ms',wokeAt:first});
 writeFileSync('docs/product-evidence/01.03-hold-android.json',JSON.stringify({platform:'Installed QA APK, Android 15 dedicated emulator; actual lifecycle and Java bridge',checks},null,2));
 writeFileSync('docs/product-evidence/01.03-hold-android.png',execFileSync(adb,['-s',serial,'exec-out','screencap','-p']));console.log(JSON.stringify({checks}));
}finally{ws.close();}
