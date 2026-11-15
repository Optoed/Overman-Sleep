import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
export const serial=process.env.OVERMAN_TEST_DEVICE??'emulator-5554',adb=resolve('.tools/android-sdk/platform-tools/adb.exe');
if(!serial.startsWith('emulator-'))throw Error('Dedicated emulator only');
export const shell=(...args)=>execFileSync(adb,['-s',serial,'shell',...args],{encoding:'utf8',timeout:20000});
assert.equal(shell('getprop','ro.boot.qemu.avd_name').trim(),'overman-qa','Personal devices are never fixtures');
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export const archiveQaSource=`(()=>{const actual=()=>window.__qaOriginalArchiveBridge??=window.__actualBridge??window.__qa?.bridge??window.OvermanAndroid;window.__qaReadArchive=key=>JSON.parse(actual().readSleepArchive(key)).raw??localStorage.getItem(key);window.__qaWriteArchive=(key,raw)=>{const bridge=actual(),expected=JSON.parse(bridge.readSleepArchive(key)).raw,error=bridge.writeSleepArchive(key,expected,raw);if(error)throw Error(error);localStorage.setItem(key,raw);};})()`;
export const until=async(fn,label)=>{let last;for(let i=0;i<180;i++){try{if(await fn())return;}catch(e){last=e;}await delay(100);}throw Error(label+(last?`: ${last.message}`:''));};
export function start(){shell('input','keyevent','224');shell('wm','dismiss-keyguard');shell('am','start','-n','app.overman.sleep/.MainActivity');}
export function reset(){shell('pm','clear','app.overman.sleep');shell('pm','grant','app.overman.sleep','android.permission.POST_NOTIFICATIONS');start();}
export async function connect(){
 let pid;await until(()=>{pid=shell('pidof','app.overman.sleep').trim();return !!pid;},'process starts');execFileSync(adb,['-s',serial,'forward','tcp:9223',`localabstract:webview_devtools_remote_${pid}`]);
 let target;await until(async()=>{const targets=(await(await fetch('http://127.0.0.1:9223/json/list')).json()).filter(t=>t.url.includes('appassets'));target=targets.find(t=>{try{const d=JSON.parse(t.description||'{}');return d.attached&&d.visible;}catch{return false;}})??targets.find(t=>{try{return JSON.parse(t.description||'{}').attached;}catch{return false;}})??targets[0];return !!target;},'WebView starts');
 const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
 ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);};
 await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},20000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('WebView detached'));}pending.clear();};await call('Page.enable');await call('Runtime.enable');
 async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
 await call('Page.addScriptToEvaluateOnNewDocument',{source:archiveQaSource});await evaluate(archiveQaSource);
 await until(()=>evaluate(`document.readyState==='complete'&&!!document.querySelector('main[data-night-phase]')`),'offline UI loaded');
 return{call,evaluate,close:()=>ws.close()};
}


