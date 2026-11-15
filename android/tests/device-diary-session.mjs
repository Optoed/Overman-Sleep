import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
export const serial=process.env.OVERMAN_TEST_DEVICE??'emulator-5570',adb=resolve('.tools/android-sdk/platform-tools/adb.exe');
const fixtures={'emulator-5570':{name:'overman-diary-clean',api:35,port:9235},'emulator-5556':{name:'overman-qa-api26',api:26,port:9225},'emulator-5558':{name:'overman-qa-api31',api:31,port:9227},'emulator-5554':{name:'overman-qa',api:35,port:9223}};
export const fixture=fixtures[serial];if(!fixture)throw Error('Only dedicated compatibility emulator serials permitted');
export const shell=(...args)=>execFileSync(adb,['-s',serial,'shell',...args],{encoding:'utf8',timeout:12000});
const actualName=execFileSync(adb,['-s',serial,'emu','avd','name'],{encoding:'utf8',timeout:10000}).trim().split(/\r?\n/)[0].trim();
assert.equal(actualName,fixture.name,'Personal or unrelated AVDs are never fixtures');assert.equal(+shell('getprop','ro.build.version.sdk').trim(),fixture.api,'Actual API must match branch');
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export const archiveQaSource=`(()=>{const actual=()=>window.__qaOriginalArchiveBridge??=window.__actualBridge??window.__qa?.bridge??window.OvermanAndroid;window.__qaReadArchive=key=>JSON.parse(actual().readSleepArchive(key)).raw??localStorage.getItem(key);window.__qaWriteArchive=(key,raw)=>{const bridge=actual(),expected=JSON.parse(bridge.readSleepArchive(key)).raw,error=bridge.writeSleepArchive(key,expected,raw);if(error)throw Error(error);localStorage.setItem(key,raw);};})()`;
export const until=async(fn,label)=>{let last;for(let i=0;i<180;i++){try{if(await fn())return;}catch(e){last=e;}await delay(100);}throw Error(label+(last?`: ${last.message}`:''));};
export function start(){shell('input','keyevent','224');shell('wm','dismiss-keyguard');shell('am','start','-n','app.overman.sleep/.MainActivity');}
export function reset(){shell('pm','clear','app.overman.sleep');if(fixture.api>=33)shell('pm','grant','app.overman.sleep','android.permission.POST_NOTIFICATIONS');start();}
export async function connect(options={}){
 let pid;await until(()=>{pid=shell('pidof','app.overman.sleep').trim();return !!pid;},'process starts');execFileSync(adb,['-s',serial,'forward','tcp:'+fixture.port,`localabstract:webview_devtools_remote_${pid}`]);
 let target;await until(async()=>{const targets=(await(await fetch(`http://127.0.0.1:${fixture.port}/json/list`)).json()).filter(t=>t.url.includes('appassets'));target=targets.find(t=>{try{const d=JSON.parse(t.description||'{}');return d.attached&&d.visible;}catch{return false;}})??targets.find(t=>{try{return JSON.parse(t.description||'{}').attached;}catch{return false;}})??targets[0];return !!target;},'WebView starts');
 const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map(),events=[];let id=0;
 ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.method){events.push(r);return;}const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);};
 await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},20000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('WebView detached'));}pending.clear();};await call('Page.enable');await call('Runtime.enable');
 async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
 if(options.archive!==false){await call('Page.addScriptToEvaluateOnNewDocument',{source:archiveQaSource});await evaluate(archiveQaSource);}
 if(options.ready!==false)await until(()=>evaluate(`document.readyState==='complete'&&!!document.querySelector('main[data-night-phase]')&&!document.body.innerText.includes('Загрузка…')&&!document.querySelector('main').hasAttribute('data-operation')`),'offline UI loaded');
 return{call,evaluate,events,close:()=>ws.close()};
}


