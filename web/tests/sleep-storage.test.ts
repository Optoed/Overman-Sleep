import test from 'node:test';import assert from 'node:assert/strict';
import {createSleepStorage,acquireSleepWriter,type ArchiveBridge} from '../components/sleep/sleep-storage';
import {SLEEP_KEY,freshSleep,persistSleep,parseSleep,recordNight,beginNight} from '../components/sleep/sleep-state';
import {createWorld} from '../components/tower/world-state';
function memory(initial:string|null=null){const values=new Map<string,string>();if(initial!==null)values.set(SLEEP_KEY,initial);return{get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);},clear:()=>values.clear()};}
function disk(){const values=new Map<string,string>();let fail=false;const bridge:ArchiveBridge={readSleepArchive:k=>JSON.stringify({raw:values.get(k)??null}),writeSleepArchive:(k,expected,raw)=>{if(fail)return 'Disk full';if((values.get(k)??null)!==expected)return 'Conflict';values.set(k,raw);return '';}};return{bridge,values,fail:()=>{fail=true;}};}
const sample=()=>{const now=Date.now(),s=beginNight(freshSleep(createWorld(27182)),now-8*3600000);return recordNight(s,{bed:now-8*3600000,wake:now,sleepMinutes:480,rested:4},now);};
test('malformed, oversized and inconsistent archives remain byte-for-byte unchanged on failed save',()=>{
 const valid=sample(),bad=[...['','{','null','[]','"text"','x'.repeat(3000001)],...[
 {...valid,version:2},{...valid,revision:Number.MAX_SAFE_INTEGER+1},{...valid,active:undefined},{...valid,world:{...valid.world,date:'2026-02-30'}},
 {...valid,nights:[...valid.nights,valid.nights[0]]},{...valid,credits:['2020-01-01']},{...valid,nights:[{...valid.nights[0],sleepMinutes:-1}]},
 {...valid,nights:[{...valid.nights[0],note:'x'.repeat(2001)}]},{...valid,nights:[{...valid.nights[0],wakeOffset:841}]},{...valid,nights:[{...valid.nights[0],date:'2000-01-01'}]},
 ].map(v=>JSON.stringify(v))];
 for(const raw of bad){const store=memory(raw),guard=createSleepStorage(store);assert.throws(()=>parseSleep(guard.getItem(SLEEP_KEY)));assert.throws(()=>persistSleep(guard,SLEEP_KEY,valid,valid));assert.equal(store.getItem(SLEEP_KEY),raw);}
});
test('legacy diary without alarm, theme, IDs or offsets preserves world, earned credits and pending morning',()=>{
 const s=sample();delete s.active!.id;delete s.active!.bedOffset;s.active!.wokeAt=Date.now();for(const n of s.nights){delete n.bedOffset;delete n.wakeOffset;delete n.sessionId;}const raw=JSON.stringify(s),parsed=parseSleep(raw)!;assert.deepEqual(parsed,s);
 const mirror=memory(raw),native=disk(),store=createSleepStorage(mirror,native.bridge);const saved=persistSleep(store,SLEEP_KEY,parsed,parsed);assert.deepEqual(saved.world,s.world);assert.deepEqual(saved.credits,s.credits);assert.deepEqual(saved.active,s.active);assert.equal(native.values.get(SLEEP_KEY),JSON.stringify(saved));assert.equal(parseSleep(native.values.get(SLEEP_KEY)!)!.revision,parsed.revision+1);
});
test('same-revision external edit is refused before overwrite, even without a storage event',()=>{
 const s=freshSleep(),raw=JSON.stringify(s),mirror=memory(raw),store=createSleepStorage(mirror);store.getItem(SLEEP_KEY);const other=JSON.stringify({...s,theme:'light'});mirror.setItem(SLEEP_KEY,other);assert.throws(()=>persistSleep(store,SLEEP_KEY,s,s),/другой вкладке/);assert.equal(mirror.getItem(SLEEP_KEY),other);
});
test('native commit is authoritative when mirror quota fails and a fresh page restores the complete record',()=>{
 const s=sample(),native=disk(),mirror=memory();mirror.setItem=()=>{throw Error('QuotaExceeded');};const store=createSleepStorage(mirror,native.bridge),saved=persistSleep(store,SLEEP_KEY,freshSleep(s.world),{...s,revision:0});assert.equal(mirror.getItem(SLEEP_KEY),null);assert.deepEqual(parseSleep(createSleepStorage(mirror,native.bridge).getItem(SLEEP_KEY)),saved);
});
test('native disk rejection cannot write mirror, return saved revision or add credits',()=>{
 const s=freshSleep(),raw=JSON.stringify(s),mirror=memory(raw),native=disk(),store=createSleepStorage(mirror,native.bridge);native.fail();assert.throws(()=>persistSleep(store,SLEEP_KEY,s,sample()),/Disk full/);assert.equal(native.values.has(SLEEP_KEY),false);assert.equal(mirror.getItem(SLEEP_KEY),raw);assert.equal(s.credits.length,0);assert.equal(s.revision,0);
});
test('corrupt authoritative native archive cannot fall back to a valid mirror or be overwritten by a stale page',()=>{
 const s=sample(),valid=JSON.stringify(s),mirror=memory(valid),native=disk(),broken='{broken native 🌙';native.values.set(SLEEP_KEY,broken);
 const store=createSleepStorage(mirror,native.bridge);assert.equal(store.getItem(SLEEP_KEY),broken);
 assert.throws(()=>parseSleep(store.getItem(SLEEP_KEY)));assert.throws(()=>persistSleep(store,SLEEP_KEY,s,s));
 assert.equal(native.values.get(SLEEP_KEY),broken);assert.equal(mirror.getItem(SLEEP_KEY),valid);
});
test('failed compatibility mirror never undoes native commit, including independent before-import copy',()=>{
 const native=disk(),mirror=memory(),store=createSleepStorage(mirror,native.bridge);mirror.setItem=()=>{throw Error('QuotaExceeded');};
 const original='{original invalid 🌙';store.setItem(SLEEP_KEY+'.before-import',original);assert.equal(native.values.get(SLEEP_KEY+'.before-import'),original);
 const s=freshSleep(),saved=persistSleep(store,SLEEP_KEY,s,s);assert.deepEqual(parseSleep(native.values.get(SLEEP_KEY)!),saved);
 assert.equal(native.values.get(SLEEP_KEY+'.before-import'),original);assert.equal(mirror.getItem(SLEEP_KEY),null);
});
test('two native pages use compare-and-swap and stale page cannot replace the first committed archive',()=>{
 const s=freshSleep(),raw=JSON.stringify(s),mirrorA=memory(raw),mirrorB=memory(raw),native=disk(),a=createSleepStorage(mirrorA,native.bridge),b=createSleepStorage(mirrorB,native.bridge);a.getItem(SLEEP_KEY);b.getItem(SLEEP_KEY);const winner=persistSleep(a,SLEEP_KEY,s,{...s,theme:'light'});assert.throws(()=>persistSleep(b,SLEEP_KEY,s,{...s,theme:'night'}));assert.deepEqual(parseSleep(native.values.get(SLEEP_KEY)!),winner);assert.equal(mirrorB.getItem(SLEEP_KEY),raw);
});
test('original invalid text can be read/exported and preserved before import without deletion',()=>{
 const raw='{broken original 🌙',mirror=memory(raw),native=disk(),store=createSleepStorage(mirror,native.bridge);assert.equal(store.getItem(SLEEP_KEY),raw);store.setItem(SLEEP_KEY+'.before-import',raw);assert.equal(native.values.get(SLEEP_KEY+'.before-import'),raw);assert.throws(()=>store.removeItem(SLEEP_KEY));assert.throws(()=>store.clear());assert.equal(store.getItem(SLEEP_KEY),raw);
});
test('browser writer lock grants only one writer and releases for later explicit retry',async()=>{
 let held=false;const locks={request:async(_name:string,_options:unknown,callback:(lock:object|null)=>Promise<void>)=>{if(held)return callback(null);held=true;try{await callback({});}finally{held=false;}}} as unknown as LockManager;
 const release=await acquireSleepWriter(locks);assert.equal(typeof release,'function');assert.equal(await acquireSleepWriter(locks),null);release!();await new Promise(r=>setTimeout(r,0));const next=await acquireSleepWriter(locks);assert.equal(typeof next,'function');next!();await assert.rejects(()=>acquireSleepWriter(undefined));
});
