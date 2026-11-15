import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {adb,serial,shell,reset,start,connect,until,delay} from './device-test-session.mjs';
const out='docs/product-evidence/02.03-screen-off-r1',checks=[],rounds=[];let s;
const evaluate=c=>s.evaluate(c),key='overman.sleep-tower.v1';
async function native(method,body={}){return evaluate(`new Promise((resolve,reject)=>{if(!window.__outputNative){const pending=new Map();let app=window.overmanNativeReply;const dispatch=(id,v,e)=>{const done=pending.get(id);if(done){pending.delete(id);done(v,e);}else app?.(id,v,e);};Object.defineProperty(window,'overmanNativeReply',{configurable:true,get:()=>dispatch,set:v=>{app=v;}});window.__outputNative=pending;}const id='output-'+crypto.randomUUID();window.__outputNative.set(id,(v,e)=>e?reject(Error(e)):resolve(v));OvermanAndroid.invoke(${JSON.stringify(method)},${JSON.stringify(JSON.stringify(body))},id);setTimeout(()=>reject(Error('Native callback timeout')),15000);})`);}
async function ready(){await until(()=>evaluate(`!document.body.innerText.includes('Загрузка…')&&!document.querySelector('main').hasAttribute('data-operation')`),'UI ready');}
const button=t=>evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)}).click()`);
function resources(name){const player=shell('dumpsys','media.player').split('Decoder infos by media types:')[0],vibration=shell('dumpsys','vibrator_manager').split('CurrentVibration:')[1]?.split('CurrentExternalVibration:')[0]??'',power=shell('dumpsys','power'),notification=shell('dumpsys','notification'),services=shell('dumpsys','activity','services','app.overman.sleep');
 const record={player,vibration,power:power.split('\n').filter(v=>v.includes('Overman:alarm')&&v.includes('PARTIAL_WAKE_LOCK')).join('\n'),notification:notification.split('Notification List:')[1]?.split('Historical notifications:')[0]??notification,services};writeFileSync(out+'-'+name+'.json',JSON.stringify(record,null,2));return record;}
function sounding(r){assert.equal((r.player.match(/packageName: app\.overman\.sleep/g)??[]).length,1,'Exactly one active app player');assert.match(r.player,/looping\(true\)/);assert.match(r.player,/stream type\(4\)/);assert.match(r.vibration,/status\s*=\s*running/);assert.match(r.vibration,/opPkg=app.overman.sleep/);assert.equal((r.power.match(/Overman:alarm/g)??[]).length,1);assert.match(r.notification,/NotificationRecord\([^\n]*pkg=app\.overman\.sleep[^\n]*id=200\b/);assert.match(r.services,/AlarmService/);return r.player.match(/connId\((\d+)\)/)?.[1];}
function silent(r){assert.ok(!r.player.includes('packageName: app.overman.sleep'));assert.ok(!r.vibration.includes('opPkg=app.overman.sleep'));assert.equal(r.power,'');assert.ok(!/NotificationRecord\([^\n]*pkg=app\.overman\.sleep[^\n]*id=200\b/.test(r.notification));assert.ok(!r.services.includes('AlarmService'));}
async function xml(){for(let i=0;i<5;i++){try{shell('rm','-f','/sdcard/output-ui.xml');shell('uiautomator','dump','/sdcard/output-ui.xml');const v=shell('cat','/sdcard/output-ui.xml');if(v.includes('<hierarchy'))return v;}catch{}await delay(150);}throw Error('No fresh native UI');}
async function nativeHold(ms){shell('am','start','-n','app.overman.sleep/.AlarmActivity');const text=await xml(),b=text.match(/<node[^>]*content-desc="Проснуться\.[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(b,'Actual native hold visible');const x=String((+b[1]+ +b[3])/2),y=String((+b[2]+ +b[4])/2);writeFileSync(out+'-native.xml',text);shell('input','swipe',x,y,x,y,String(ms));}
async function webHold(ms){const p=await evaluate(`(()=>{const e=[...document.querySelectorAll('button[aria-label="Удерживать «Проснуться» 3 секунды"]')].at(-1);e.scrollIntoView({behavior:'instant',block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,visible:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),visibility:document.visibilityState};})()`);assert.equal(p.visible,true,'Topmost actual wake button receives the touch');assert.equal(p.visibility,'visible');assert.match(shell('dumpsys','window'),/mCurrentFocus[^\n]*MainActivity/);const tree=await xml(),view=tree.match(/<node[^>]*class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(view,'Focused actual WebView bounds');const scale=(+view[3]- +view[1])/p.width,x=String(Math.round(+view[1]+p.x*scale)),y=String(Math.round(+view[2]+p.y*scale));shell('input','swipe',x,y,x,y,String(ms));}


const prefs=()=>shell('cat','/data/user/0/app.overman.sleep/shared_prefs/overman_device.xml');
const num=name=>+(prefs().match(new RegExp('name="'+name+'" value="(\\d+)"'))?.[1]??0);
const str=name=>(prefs().match(new RegExp('<string name="'+name+'">([^<]*)</string>'))?.[1]??'').replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const disk=()=>JSON.parse(shell('cat','/data/user/0/app.overman.sleep/files/sleep-archive.json'));
const epoch=()=>+shell('date','+%s').trim()*1000;
async function foreground(){shell('input','keyevent','224');shell('wm','dismiss-keyguard');shell('am','start','-f','0x24000000','-n','app.overman.sleep/.MainActivity');s?.close();s=await connect();await ready();await evaluate(`dispatchEvent(new Event('overman:resume'))`);await delay(200);}

const qaSha=createHash('sha256').update(readFileSync('.tools/tested-02.03-screen-off-r1-qa.apk')).digest('hex');
async function running(name,gain,vibrate){const r=resources(name);assert.equal((r.player.match(/packageName: app\.overman\.sleep/g)??[]).length,1);assert.match(r.player,/looping\(true\)/);assert.match(r.player,/stream type\(4\)/);assert.ok(r.player.includes(`volume(${gain.toFixed(6)}, ${gain.toFixed(6)})`));assert.equal(r.vibration.includes('opPkg=app.overman.sleep'),vibrate);if(vibrate){assert.match(r.vibration,/status\s*=\s*running/);assert.match(r.vibration,/repeat=0/);}assert.equal((r.power.match(/Overman:alarm/g)??[]).length,1);assert.match(r.notification,/NotificationRecord\([^\n]*pkg=app\.overman\.sleep[^\n]*id=200\b/);assert.match(r.services,/AlarmService/);assert.ok(prefs().includes('name="ringing" value="true"'));return r;}
async function lockCycle(name,gain,vibrate,keycode){shell('input','keyevent','224');shell('wm','dismiss-keyguard');shell('am','start','-f','0x24000000','-n','app.overman.sleep/.AlarmActivity');await delay(750);shell('input','keyevent',String(keycode));await delay(2000);let power=shell('dumpsys','power');if(!power.includes('mWakefulness=Asleep')){writeFileSync(out+'-'+name+'-initial-screen.txt',power);shell('input','keyevent','223');await delay(2000);power=shell('dumpsys','power');}writeFileSync(out+'-'+name+'-screen-off.txt',power);assert.match(power,/mWakefulness=Asleep/);await running(name+'-after-lock',gain,vibrate);await delay(5500);await running(name+'-sustained',gain,vibrate);}
try{
 for(const [gain,vibrate,tone]of[[0,true,'birds'],[.8,true,'bell'],[.2,false,'dawn']]){
  s?.close();reset();shell('appops','set','--uid','app.overman.sleep','SCHEDULE_EXACT_ALARM','allow');await foreground();
  await native('configure',{schedule:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},alarm:{enabled:true,reminder:false,reminderMinutes:30,ringtone:tone,volume:gain,vibration:vibrate,smart:false,smartMinutes:20,noise:false},expectedSessionId:''});
  shell('am','start-foreground-service','-n','app.overman.sleep/.AlarmService');
  await until(async()=>{try{await running(tone+'-prepared',gain,vibrate);return true;}catch{return false;}},'Actual alarm resources prepared');
  const session=JSON.parse(str('wakeNight')).id;assert.ok(session);const firstPlayer=resources(tone+'-identity').player;
  await lockCycle(tone+'-power',gain,vibrate,26);await lockCycle(tone+'-sleep',gain,vibrate,223);await lockCycle(tone+'-power-again',gain,vibrate,26);
  assert.equal(JSON.parse(str('wakeNight')).id,session);assert.equal(num('wokeAt'),0);
  await nativeHold(700);await running(tone+'-short-hold',gain,vibrate);
  await nativeHold(3400);await until(()=>{try{silent(resources(tone+'-full-hold'));return true;}catch{return false;}},'Full hold releases resources');
  assert.ok(!prefs().includes('name="ringing" value="true"'));const woke=num('wokeAt');assert.ok(woke>0);
  shell('input','keyevent','224');shell('input','keyevent','26');await delay(1800);silent(resources(tone+'-no-revival-power'));shell('input','keyevent','224');shell('input','keyevent','223');await delay(1800);silent(resources(tone+'-no-revival-sleep'));assert.equal(num('wokeAt'),woke);
  rounds.push({tone,gain,vibration:vibrate,sessionId:session,wokeAt:woke,lockCycles:3,minimumSustainedMs:7500,shortHoldMs:700,fullHoldMs:3400});checks.push(tone+': power/sleep/repeated locking preserves selected output; short hold preserves alarm; full hold cleans permanently and later screen-off cannot revive it');
  console.log('PASS screen-off output and cleanup:',tone,gain,vibrate);
 }
 writeFileSync(out+'-vibrator-history.txt',shell('dumpsys','vibrator_manager'));
 writeFileSync(out+'.json',JSON.stringify({result:'passed',verifiedAt:new Date().toISOString(),qaSha256:qaSha,checks,rounds,fixture:'Dedicated overman-qa API35 emulator. Real installed service/media/vibrator/notification/wake lock and actual power/sleep/hold gestures. Native configure and explicit bare service start are QA stimuli; no claim of scheduled delivery or physical motor/speaker.'},null,2));
}catch(error){writeFileSync(out+'-failure.json',JSON.stringify({error:error.stack,qaSha256:qaSha,checks,rounds},null,2));throw error;}finally{s?.close();}

