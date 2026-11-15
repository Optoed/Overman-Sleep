import {archiveQaSource} from './device-test-session.mjs';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const serial=process.env.OVERMAN_TEST_DEVICE??'emulator-5554';
if(!serial.startsWith('emulator-'))throw Error('This destructive fixture is restricted to a dedicated emulator.');
import assert from 'node:assert/strict';
const adb=resolve('.tools/android-sdk/platform-tools/adb.exe');
const shell=(...args)=>execFileSync(adb,['-s',serial,'shell',...args],{encoding:'utf8'});
assert.equal(shell('getprop','ro.boot.qemu.avd_name').trim(),'overman-qa','Only the disposable Overman fixture is allowed.');
if(process.argv.includes('--reset-fixture')){
 shell('pm','clear','app.overman.sleep');shell('pm','grant','app.overman.sleep','android.permission.POST_NOTIFICATIONS');shell('input','keyevent','224');shell('wm','dismiss-keyguard');shell('am','start','-n','app.overman.sleep/.MainActivity');
 let ready=false;
 for(let attempt=0;attempt<120;attempt++){
  try{const pid=shell('pidof','app.overman.sleep').trim();if(pid){execFileSync(adb,['-s',serial,'forward','tcp:9223',`localabstract:webview_devtools_remote_${pid}`]);const targets=await(await fetch('http://127.0.0.1:9223/json/list')).json();if(targets.some(p=>p.url.includes('appassets'))){ready=true;break;}}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(ready,'clean installed QA WebView starts');
}
const pages=await(await fetch('http://127.0.0.1:9223/json/list')).json();
const target=pages.find(p=>p.url.includes('appassets'));
let ws=new WebSocket(target.webSocketDebuggerUrl);const pending=new Map();let id=0;
const onMessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}};ws.onmessage=onMessage;
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression:archiveQaSource+';'+expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function native(method,body={}){return evaluate(`new Promise((resolve,reject)=>{if(!window.__qaNative){const callbacks=new Map();let appReply=window.overmanNativeReply;const dispatch=(id,value,error)=>{const done=callbacks.get(id);if(done){callbacks.delete(id);done(value,error);}else appReply?.(id,value,error);};Object.defineProperty(window,'overmanNativeReply',{configurable:true,get:()=>dispatch,set:value=>{appReply=value;}});window.__qaNative=callbacks;}const id='qa-'+Math.random();window.__qaNative.set(id,(value,error)=>error?reject(Error(error)):resolve(value));OvermanAndroid.invoke(${JSON.stringify(method)},${JSON.stringify(JSON.stringify(body))},id);setTimeout(()=>{window.__qaNative.delete(id);reject(Error('native timeout'));},20000);})`);}
await call('Page.addScriptToEvaluateOnNewDocument',{source:archiveQaSource});await evaluate(archiveQaSource);
let setup;
try {
let loaded=false;
for(let attempt=0;attempt<120;attempt++){
 try{if(await evaluate(`!!document.querySelector('button[aria-label="Настройки сна"]')&&!document.body.innerText.includes('Загрузка…')`)){loaded=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,100));
}
assert.ok(loaded,'offline app rendered before reading its storage');
assert.equal(await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')||'null')?.active??null`),null,'Use a clean dedicated emulator fixture before running this check.');
console.log('Android screen', (await evaluate('document.body.innerText')).slice(0,700));
const status=await native('status');console.log('Initial Android status',status);
if(!status.exact)shell('appops','set','app.overman.sleep','SCHEDULE_EXACT_ALARM','allow');
shell('settings','put','system','screen_off_timeout','600000');
setup=await evaluate(`(()=>{const wake=new Date(Date.now()+90000);wake.setSeconds(0,0);const bed=new Date(wake);bed.setHours(bed.getHours()-8);const clock=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');const schedule={bed:clock(bed),wake:clock(wake),hours:8,tolerance:45};const alarm={enabled:true,reminder:false,reminderMinutes:30,ringtone:'bell',volume:.7,vibration:true,smart:false,smartMinutes:20,noise:false};return {schedule,alarm,deadline:+wake};})()`);
await native('configure',{schedule:setup.schedule,alarm:setup.alarm});
await evaluate(`(()=>{const key='overman.sleep-tower.v1';let s=JSON.parse(localStorage.getItem(key)||'null');if(!s){s={version:1,revision:0,world:null};}return s.world!==null;})()`);
// Use the visible form to save the schedule in the same storage used by the app.
await evaluate(`document.querySelector('button[aria-label="Настройки сна"]').click()`);
await new Promise(r=>setTimeout(r,250));
await evaluate(`(()=>{const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};const times=[...document.querySelectorAll('[role=dialog] input[type=time]')];set(times[0],${JSON.stringify(setup.schedule.bed)});set(times[1],${JSON.stringify(setup.schedule.wake)});})()`);
await new Promise(r=>setTimeout(r,200));
await evaluate(`(()=>{const d=document.querySelector('[role=dialog]');[...d.querySelectorAll('button')].find(b=>b.textContent==='Будильник').click();})()`);
await new Promise(r=>setTimeout(r,200));
await evaluate(`(()=>{const d=document.querySelector('[role=dialog]');const checkbox=[...d.querySelectorAll('label')].find(l=>l.textContent==='Будильник').querySelector('input');if(!checkbox.checked)checkbox.click();})()`);
await new Promise(r=>setTimeout(r,200));
await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);
await new Promise(r=>setTimeout(r,400));
await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Ложусь спать');if(!b)throw Error(document.body.innerText);b.click();})()`);
await new Promise(r=>setTimeout(r,400));
assert.ok((await evaluate('document.body.innerText')).includes('Спокойной ночи'));
const activeBefore=await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).active`);assert.ok(activeBefore?.started);
const alarmDump=shell('dumpsys','alarm');assert.ok(alarmDump.includes('app.overman.sleep'));
console.log('Scheduled system alarm',new Date(setup.deadline).toISOString(),'active night',activeBefore.started);
// Leave the WebView and turn the screen off. No web timer can fire this alarm.
shell('input','keyevent','3');shell('input','keyevent','223');
while(Date.now()<setup.deadline+18000){
 const service=shell('dumpsys','activity','services','app.overman.sleep');
 if(service.includes('AlarmService'))break;
 await new Promise(r=>setTimeout(r,1500));
}
let service=shell('dumpsys','activity','services','app.overman.sleep');assert.ok(service.includes('AlarmService'),'system alarm starts with the WebView in the background and screen off');
const prefs=()=>shell('run-as','app.overman.sleep','cat','shared_prefs/overman_device.xml');assert.ok(prefs().includes('name="ringing" value="true"'));
console.log('Alarm ringing while backgrounded.');
if(process.argv.includes('--bypass')){
 const checks=[],stillRinging=async label=>{assert.ok(prefs().includes('name="ringing" value="true"'),label);assert.ok(shell('dumpsys','activity','services','app.overman.sleep').includes('AlarmService'),label);assert.deepEqual(await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).active`),activeBefore,label);};
 // The background WebView has not received the new ringing state yet. Its old
 // cancellation control must still be refused by the real Android bridge.
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Нажал случайно · отменить')?.click()`);await new Promise(r=>setTimeout(r,500));await stillRinging('stale cancellation');checks.push('Cancellation from stale background UI cannot stop newly ringing native alarm or clear night');
 for(const [method,body] of [['stop',{}],['start',{active:activeBefore}],['configure',{schedule:setup.schedule,alarm:{...setup.alarm,enabled:false}}],['configure',{schedule:setup.schedule,alarm:{...setup.alarm,volume:0,vibration:false}}]]){
  await assert.rejects(()=>native(method,body),/Проснуться/);await stillRinging(method);
 }
 checks.push('Actual native stop/start/disable/mute commands reject while ringing; unchanged configure remains idempotent');const actual=await evaluate(`(()=>{const s=JSON.parse(__qaReadArchive('overman.sleep-tower.v1'));return {schedule:s.schedule,alarm:{...s.alarm,noise:false,smart:false}};})()`);await native('configure',actual);await stillRinging('same configuration');
 shell('input','keyevent','224');shell('wm','dismiss-keyguard');shell('input','keyevent','4');await stillRinging('Back from alarm');
 shell('am','start','-n','app.overman.sleep/.MainActivity');await new Promise(r=>setTimeout(r,700));
 await evaluate(`document.querySelector('button[aria-label="Настройки сна"]').click()`);await new Promise(r=>setTimeout(r,250));await evaluate(`document.querySelector('[role=dialog] form')?.requestSubmit()`);await new Promise(r=>setTimeout(r,250));await stillRinging('settings form');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await stillRinging('Escape');
 await evaluate(`document.querySelector('button[aria-label="Закрыть"]')?.click();[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Статистика').click()`);await new Promise(r=>setTimeout(r,250));
 // Explicit queued history actions while the actual native service is ringing.
 // A manual diary row must never act as acknowledgement of this active night.
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Добавить ночь').click()`);await new Promise(r=>setTimeout(r,200));
 await evaluate(`(()=>{const form=document.querySelector('[role=dialog] form'),sleep=form.querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(sleep,'0');sleep.dispatchEvent(new Event('input',{bubbles:true}));[...form.querySelectorAll('button')].find(b=>b.textContent==='4Хорошо').click();})()`);await new Promise(r=>setTimeout(r,100));await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);
 for(let i=0;i<100;i++){if(await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).nights.length===1&&!document.querySelector('main').hasAttribute('data-operation')`))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).nights.length`),1);await stillRinging('manual history row while ringing');
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Исправить').click()`);await new Promise(r=>setTimeout(r,200));await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='5Отлично').click()`);await new Promise(r=>setTimeout(r,100));await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);
 for(let i=0;i<100;i++){if(await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).nights[0].rested===5&&!document.querySelector('main').hasAttribute('data-operation')`))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).nights[0].rested`),5);assert.equal((await native('status')).wokeAt,undefined);assert.equal(await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).credits.length`),0);await stillRinging('overlapping history correction while ringing');checks.push('Queued manual history save and same-date correction commit actual diary rows while real native signal continues; original active session/start/goal unchanged, no wake timestamp or reward created');
 await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Профиль').click()`);await new Promise(r=>setTimeout(r,250));
 await evaluate(`(()=>{const s=JSON.parse(__qaReadArchive('overman.sleep-tower.v1'));const file=new File([JSON.stringify({format:'overman-sleep',version:1,state:s})],'qa.json',{type:'application/json'}),dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,300));
 await evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent==='Заменить текущую историю этой копией');label.querySelector('input').click();})()`);await new Promise(r=>setTimeout(r,150));await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Восстановить записи')).click()`);await new Promise(r=>setTimeout(r,300));await stillRinging('import');assert.equal(await evaluate(`localStorage.getItem('overman.sleep-tower.v1.before-import')`),null);
 assert.equal(await evaluate(`__qaReadArchive('overman.sleep-tower.v1.before-import')`),null);checks.push('Installed WebView queued settings/import/Escape handlers cannot dismiss signal, replace archive or end active night; both native and WebView safety copies stay absent');
 writeFileSync('docs/product-evidence/01.06-android-web-ringing.png',execFileSync(adb,['-s',serial,'exec-out','screencap','-p']));
 shell('input','keyevent','4');await stillRinging('MainActivity Back');shell('input','keyevent','3');await stillRinging('Home');
 checks.push('Back from native alarm and main app, plus Home, leave real foreground audio service running');
 writeFileSync('docs/product-evidence/01.06-android-bypass.json',JSON.stringify({checks,fixture:'Dedicated installed QA; real AlarmManager/service/Java bridge; stale/queued handlers explicitly dispatched; no successful native calls mocked'},null,2));
}
// Open the actual full-screen alarm screen if Android presents a notification first.
shell('input','keyevent','224');shell('wm','dismiss-keyguard');
let activity=shell('dumpsys','activity','activities');
if(!activity.includes('mResumedActivity')||!activity.match(/mResumedActivity[^\n]*AlarmActivity/)){
 shell('cmd','statusbar','expand-notifications');await new Promise(r=>setTimeout(r,500));
 shell('uiautomator','dump','/sdcard/overman-ui.xml');const xml=shell('cat','/sdcard/overman-ui.xml');
 const notification=xml.match(/<node[^>]*text="Пора вставать"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
 if(notification)shell('input','tap',String((+notification[1]+ +notification[3])/2),String((+notification[2]+ +notification[4])/2));
}
await new Promise(r=>setTimeout(r,1000));
shell('uiautomator','dump','/sdcard/overman-ui.xml');const xml=shell('cat','/sdcard/overman-ui.xml');writeFileSync('docs/sleep-mvp/android-alarm-ui.xml',xml);
const bounds=xml.match(/<node[^>]*content-desc="Проснуться\.[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(bounds,'native hold button is visible');
const x=String(Math.round((+bounds[1]+ +bounds[3])/2)),y=String(Math.round((+bounds[2]+ +bounds[4])/2));
writeFileSync('docs/sleep-mvp/android-ringing.png',execFileSync(adb,['-s',serial,'exec-out','screencap','-p']));
shell('input','tap',x,y);assert.ok(prefs().includes('name="ringing" value="true"'),'short tap must not stop the alarm');
shell('input','swipe',x,y,x,y,'1200');assert.ok(prefs().includes('name="ringing" value="true"'),'short hold must not stop the alarm');
shell('input','swipe',x,y,x,y,'3400');await new Promise(r=>setTimeout(r,1000));
assert.ok(prefs().includes('name="ringing" value="false"'),'three-second hold stops the signal');
service=shell('dumpsys','activity','services','app.overman.sleep');assert.ok(!service.includes('AlarmService'),'audio foreground service is stopped');
// Android Back may destroy MainActivity. Native wake opens a new WebView; the
// detached old document can still answer CDP but is not the user's screen.
const afterPages=await(await fetch('http://127.0.0.1:9223/json/list')).json();
const visible=afterPages.find(p=>p.url.includes('appassets')&&JSON.parse(p.description||'{}').attached)??afterPages.find(p=>p.url.includes('appassets'));
if(visible.webSocketDebuggerUrl!==ws.url){ws.close();ws=new WebSocket(visible.webSocketDebuggerUrl);ws.onmessage=onMessage;await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});}
const nativeWake=await native('status');assert.ok(nativeWake.wokeAt>=setup.deadline);
let morningReady=false;
for(let attempt=0;attempt<100;attempt++){
 if((await evaluate('document.body.innerText')).includes('Как прошла ночь?')){morningReady=true;break;}
 await new Promise(r=>setTimeout(r,100));
}
const activeAfter=await evaluate(`JSON.parse(__qaReadArchive('overman.sleep-tower.v1')).active`);assert.equal(activeAfter.wokeAt,nativeWake.wokeAt,'lock-screen wake is saved to the same diary session');
assert.ok(morningReady,'morning assessment opens after native hold');
writeFileSync('docs/sleep-mvp/android-morning.png',execFileSync(adb,['-s',serial,'exec-out','screencap','-p']));
await native('configure',{schedule:setup.schedule,alarm:{...setup.alarm,enabled:false},expectedSessionId:nativeWake.sessionId});
writeFileSync('docs/sleep-mvp/android-checks.json',JSON.stringify({platform:'Android 15 / API 35 emulator',deadline:setup.deadline,wokeAt:nativeWake.wokeAt,checks:['offline shared app loads','native system schedule','screen off and app backgrounded','alarm service starts','short tap and 1.2-second hold keep ringing','3.4-second hold stops ringing and service','wake snapshot synchronized into local diary','morning assessment opens'],limitations:['emulated hardware; physical speaker/battery behavior still requires a real-phone overnight test']},null,2));
console.log('ANDROID ALARM CHECKS PASSED',nativeWake);
} finally {
 try {const last=await native('status');if(last.ringing)await native('wake',{sessionId:last.sessionId});if(setup)await native('configure',{schedule:setup.schedule,alarm:{...setup.alarm,enabled:false},expectedSessionId:last.sessionId});} finally {ws.close();}
}
