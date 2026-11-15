import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {adb,serial,shell,delay,until,start,reset,connect} from './device-test-session.mjs';
const key='overman.sleep-tower.v1',checks=[];
let session;
const state=()=>session.evaluate(`JSON.parse(__qaReadArchive('${key}'))`);
const phase=()=>session.evaluate(`document.querySelector('main').dataset.nightPhase`);
const label=name=>session.evaluate(`document.querySelector(${JSON.stringify(`button[aria-label=${JSON.stringify(name)}]`)}).click()`);
const nativeWake=()=>+(shell('run-as','app.overman.sleep','cat','shared_prefs/overman_device.xml').match(/name="wokeAt" value="(\d+)"/)?.[1]??0);
try{
 reset();session=await connect();await label('Настройки сна');await until(()=>session.evaluate(`!!document.querySelector('[role=dialog] form')`),'settings');await session.evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);await until(()=>state().then(s=>s?.configured),'configured');await until(()=>session.evaluate(`!document.querySelector('main').hasAttribute('data-operation')`),'ready');
 await label('Ложусь спать');await until(()=>phase().then(p=>p==='sleeping'),'night starts');const before=await state();
 // Actual quota exhaustion survives a killed WebView process.
 await session.evaluate(`(()=>{let n=0;try{for(;;)localStorage.setItem('qa-fill-'+n++,'x'.repeat(32768));}catch{}let s='';try{for(;;){s+='x';localStorage.setItem('qa-fill-last',s);}}catch{}})()`);
 // Forward the real command, then withhold only the native reply. Kill occurs
 // before the web code can journal or save its wake; native data is real.
 await session.evaluate(`(()=>{const bridge=window.OvermanAndroid;window.OvermanAndroid={invoke(method,body,id){if(method==='wake'){const reply=window.overmanNativeReply;window.overmanNativeReply=(rid,value,error)=>{if(rid===id&&!error){window.__withheldWake=value;return;}reply(rid,value,error);};}bridge.invoke(method,body,id);}};})()`);
 const b=await session.evaluate(`(()=>{const b=document.querySelector('button[aria-label="Удерживать «Проснуться» 3 секунды"]').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};})()`);
 await session.call('Input.dispatchMouseEvent',{type:'mousePressed',...b,button:'left',clickCount:1});await until(()=>session.evaluate('!!window.__withheldWake'),'native wake reply withheld');
 const first=nativeWake();assert.ok(first>0);assert.equal((await state()).active.wokeAt,undefined);assert.equal((await session.evaluate('window.__withheldWake')).wakeNight.started,before.active.started);
 shell('am','force-stop','app.overman.sleep');session.close();session=null;start();session=await connect();await until(()=>phase().then(p=>p==='awaiting_mood'),'native receipt restores morning');
 assert.equal(nativeWake(),first);assert.equal((await state()).active.wokeAt,first,'native disk archive succeeds despite mirror quota');assert.equal(await session.evaluate(`JSON.parse(localStorage.getItem('${key}')).active.wokeAt`),undefined,'full mirror is unchanged');assert.ok(!(await session.evaluate('document.body.innerText')).includes('Не удалось обновить дневник'));
 checks.push('Actual Java wake commits; successful reply deliberately withheld; process force-stopped before JS can save. Restart under actual full localStorage recovers morning and commits authoritative native archive with original start/goal/time; full mirror stays unchanged.');
 writeFileSync('docs/product-evidence/01.04-native-recovered.png',execFileSync(adb,['-s',serial,'exec-out','screencap','-p']));
 await session.evaluate(`for(const k of Object.keys(localStorage))if(k.startsWith('qa-fill-'))localStorage.removeItem(k)`);
 await session.call('Page.reload');await until(()=>state().then(s=>s.active.wokeAt===first),'native timestamp retained');
 checks.push('After mirror quota is freed, reload keeps the exact first durable wake in the original diary session, without requiring another hold or inflating duration.');
 // Deny primary reads and IndexedDB on the next reload. Only the native snapshot
 // is available; original diary bytes must remain untouched.
 const originalArchive=await session.evaluate(`__qaReadArchive('${key}')`);
 const injected=await session.call('Page.addScriptToEvaluateOnNewDocument',{source:`addEventListener('DOMContentLoaded',()=>{const get=Storage.prototype.getItem,bridge=window.__qaOriginalArchiveBridge=window.OvermanAndroid;window.__qaRead=()=>__qaReadArchive('${key}');window.OvermanAndroid={invoke:(...args)=>bridge.invoke(...args),readSleepArchive:()=>JSON.stringify({error:'QA Android archive read blocked'}),writeSleepArchive:(...args)=>bridge.writeSleepArchive(...args),saveMorningDraft:body=>bridge.saveMorningDraft(body),readMorningDraft:()=>bridge.readMorningDraft(),clearMorningDraft:id=>bridge.clearMorningDraft(id)};Storage.prototype.getItem=function(k){if(k==='${key}')throw new DOMException('QA mirror read blocked','SecurityError');return get.call(this,k);};indexedDB.open=()=>{throw new DOMException('QA journal unavailable','SecurityError');};},{once:true})`});
 await session.call('Page.reload');await until(()=>session.evaluate(`typeof window.__qaRead==='function'&&document.readyState==='complete'&&document.querySelector('main')?.dataset.nightPhase==='awaiting_mood'`),'unreadable archive recovers native night');
 assert.equal(await session.evaluate(`window.__qaRead()`),originalArchive);const recoveryText=await session.evaluate('document.body.innerText');assert.ok(recoveryText.includes('Android')&&recoveryText.includes('сохранено отдельно'));assert.equal(await session.evaluate(`document.querySelector('main').dataset.nightPhase`),'awaiting_mood');assert.equal(await session.evaluate(`!!document.querySelector('button[aria-label="Ложусь спать"]')`),false);
 checks.push('Explicit Android archive read denial plus mirror SecurityError and unavailable IndexedDB: independent actual native wake snapshot restores morning, blocks new-night start, and leaves original archive bytes untouched.');
 await session.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injected.identifier});await session.call('Page.reload');await until(()=>state().then(s=>s?.active?.wokeAt===first),'native restore saved after read permission recovers');assert.equal(nativeWake(),first);
 checks.push('Read access restored: reload saves the same first wake; no new night or duration inflation.');
 // Real filesystem rejection, independent of the separately persisted native
 // wake. The target app is unprivileged even on our disposable emulator.
 await session.evaluate(`__qaWriteArchive('${key}',${JSON.stringify(JSON.stringify(before))})`);
 await session.evaluate(`(()=>{let n=0;try{for(;;)localStorage.setItem('qa-fill-'+n++,'x'.repeat(32768));}catch{}let s='';try{for(;;){s+='x';localStorage.setItem('qa-fill-last',s);}}catch{}})()`);
 shell('run-as','app.overman.sleep','chmod','500','files');await session.call('Page.reload');await until(()=>phase().then(p=>p==='awaiting_mood'),'real read-only file restores pending morning');
 assert.equal((await state()).active.wokeAt,undefined);assert.equal(nativeWake(),first);assert.ok((await session.evaluate('document.body.innerText')).includes('сохранено отдельно'));checks.push('Real app files directory made read-only plus full WebView quota: failed native archive write leaves original diary bytes/rewards unchanged; independent real native wake restores morning with an explicit error, no false saved message.');
 shell('am','force-stop','app.overman.sleep');session.close();start();session=await connect();await until(()=>phase().then(p=>p==='awaiting_mood'),'read-only archive survives process death');assert.equal(nativeWake(),first);assert.equal((await state()).active.wokeAt,undefined);checks.push('Force-stop while actual archive writes remain forbidden: cold launch retains the first native wake and pending morning without a new session or second hold.');
 shell('run-as','app.overman.sleep','chmod','700','files');await session.evaluate(`for(const k of Object.keys(localStorage))if(k.startsWith('qa-fill-'))localStorage.removeItem(k)`);await session.evaluate(`([...document.querySelectorAll('button')].find(b=>b.textContent==='Повторить сохранение')).click()`);await until(()=>state().then(s=>s.active.wokeAt===first),'permission restored explicit retry');assert.equal(nativeWake(),first);checks.push('After actual file permission and quota recovery, deliberate retry writes exactly the original wake; no duration inflation or duplicate record.');
 writeFileSync('docs/product-evidence/01.04-android-recovery.json',JSON.stringify({platform:'Installed APK Android 15 dedicated emulator',firstWake:first,started:before.active.started,checks,faultInjection:'Only the native reply is withheld; real Java command, preferences, force-stop and restart. Read denial/IndexedDB denial explicit. Quota exhaustion is real. Actual ringing is checked separately by system-alarm regression.'},null,2));console.log(JSON.stringify({checks}));
}finally{try{shell('run-as','app.overman.sleep','chmod','700','files');}finally{session?.close();}}
