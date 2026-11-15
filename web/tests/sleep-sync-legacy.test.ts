import{enqueueSleepOperation}from'../lib/sleep-sync-queue';
import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{freshSleep,recordNight,SLEEP_KEY}from'../components/sleep/sleep-state';
import{prepareSleepLegacyMigration,resumeSleepLegacyMigration,stopSleepLegacyMigration}from'../lib/sleep-sync-legacy';import{openSleepSyncArchive,readSleepLegacyMigration}from'../lib/sleep-sync-archive';import{prepareSleepSyncPull}from'../lib/sleep-sync-engine';import type{SleepSnapshot,SleepLegacyCreditOperation}from'../lib/sleep-sync-queue';
const owner=randomUUID(),empty=():SleepSnapshot=>({protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[]});
function fixture(){let raw=JSON.stringify({...freshSleep(),credits:['2026-06-01'],deletedCredits:['2026-06-01'],garden:true}),writes=0;const s={fail:false,getItem:(k:string)=>{assert.equal(k,SLEEP_KEY);return raw;},setItem(k:string,v:string){assert.equal(k,SLEEP_KEY);if(this.fail)throw Error('Disk full');raw=v;writes++;},get raw(){return raw;},get writes(){return writes;}};
 const c={calls:[] as SleepLegacyCreditOperation[],readSnapshot:async()=>({ownerId:owner,snapshot:empty()}),async importLegacyCredits(op:SleepLegacyCreditOperation){this.calls.push(structuredClone(op));return{protocolVersion:1 as const,ownerId:owner,operationId:op.operationId,snapshot:{...empty(),garden:op.garden,credits:op.dates,deletedCredits:op.dates,dates:op.dates.map(date=>({date,revision:1,night:null})),legacyCredits:op.dates,legacyGarden:op.garden}};}};
 return{s,c,options:{getOwnerId:()=>owner}};
}
test('05.02 legacy preparation is read-only; consent persists only minimal intent before HTTP and one reviewed final commit',async()=>{
 const f=fixture(),before=f.s.raw,p=await prepareSleepLegacyMigration(f.s,owner,f.c,f.options);assert.ok(p);assert.equal(f.s.raw,before);assert.equal(f.c.calls.length,0);await assert.rejects(p.start(false),/explicit approval/);assert.equal(f.s.writes,0);
 const ready=await p.start(true);assert.equal(f.s.writes,1);assert.ok(readSleepLegacyMigration(f.s,owner));assert.throws(()=>openSleepSyncArchive(f.s,owner),/migration is paused/);assert.throws(()=>ready.approve(false),/final approval/);
 const result=ready.approve(true);assert.equal(f.s.writes,2);assert.deepEqual(result.credits,['2026-06-01']);assert.equal(result.nights.length,0);assert.equal(result.garden,true);assert.equal(readSleepLegacyMigration(f.s,owner),null);
 const cold=openSleepSyncArchive(f.s,owner);assert.deepEqual(cold.baseline!.snapshot.legacyCredits,['2026-06-01']);assert.equal(cold.queue.operations.length,0);cold.abort();
});
test('05.02 lost legacy receipt keeps durable batch UUID; cold resume repeats exact claim and preserves data',async()=>{
 const f=fixture();let lose=true;const c={...f.c,importLegacyCredits:async(op:SleepLegacyCreditOperation)=>{const r=await f.c.importLegacyCredits(op);if(lose){lose=false;throw Error('Lost committed reply');}return r;}};
 const p=await prepareSleepLegacyMigration(f.s,owner,c,f.options);await assert.rejects(p!.start(true),/Lost committed/);const paused=f.s.raw,op=readSleepLegacyMigration(f.s,owner)!;
 await assert.rejects(prepareSleepSyncPull(f.s,owner,{...f.c,rpc:async()=>{throw Error('Must not send');}}),/migration is paused/);assert.equal(f.s.raw,paused);
 const ready=await resumeSleepLegacyMigration(f.s,owner,c,f.options);ready.approve(true);assert.equal(f.c.calls.length,2);assert.deepEqual(f.c.calls[0],f.c.calls[1]);assert.equal(f.c.calls[0].operationId,op.operationId);
});
test('05.02 disk failure and discarded review retain pause; retry retains imported reward without a new UUID',async()=>{
 const f=fixture(),p=await prepareSleepLegacyMigration(f.s,owner,f.c,f.options),ready=await p!.start(true),paused=f.s.raw;
 f.s.fail=true;assert.throws(()=>ready.approve(true),/Disk full/);assert.equal(f.s.raw,paused);f.s.fail=false;
 const again=await resumeSleepLegacyMigration(f.s,owner,f.c,f.options);again.discard();assert.equal(f.s.raw,paused);
 const final=await resumeSleepLegacyMigration(f.s,owner,f.c,f.options);final.approve(true);assert.equal(new Set(f.c.calls.map(o=>o.operationId)).size,1);
});
test('05.02 owner switch, wrong receipt UUID and unacknowledged reward preserve paused archive',async()=>{
 for(const fault of ['owner','uuid','missing']as const){const f=fixture();let active=owner;const c={...f.c,importLegacyCredits:async(op:SleepLegacyCreditOperation)=>{const r=await f.c.importLegacyCredits(op);if(fault==='owner')active=randomUUID();return fault==='uuid'?{...r,operationId:randomUUID()}:fault==='missing'?{...r,snapshot:empty()}:r;}};
 const p=await prepareSleepLegacyMigration(f.s,owner,c,{getOwnerId:()=>active});await assert.rejects(p!.start(true));assert.ok(readSleepLegacyMigration(f.s,owner));const op=readSleepLegacyMigration(f.s,owner)!,tx=openSleepSyncArchive(f.s,owner,undefined,op.operationId);assert.deepEqual(tx.diary.credits,['2026-06-01']);tx.abort();}
});
test('05.02 selected backup claims preserve old reward dates without importing its settings or metadata',async()=>{
 const f=fixture(),source={...freshSleep(),credits:['2026-06-02'],deletedCredits:['2026-06-02'],theme:'light' as const,_sleepSync:{token:'fictional'}};
 const p=await prepareSleepLegacyMigration(f.s,owner,f.c,f.options,source);assert.deepEqual(p!.operation.dates,['2026-06-01','2026-06-02']);const ready=await p!.start(true);const saved=ready.approve(true);assert.equal(saved.theme,undefined);assert.equal(saved.nights.length,0);assert.equal(saved.credits.length,2);assert.ok(!f.s.raw.includes('fictional'));
});
test('05.02 empty migration does nothing and does not silently claim successful nights',async()=>{
 const f=fixture();f.s.setItem(SLEEP_KEY,JSON.stringify(freshSleep()));const writes=f.s.writes;
 assert.equal(await prepareSleepLegacyMigration(f.s,owner,f.c,f.options),null);assert.equal(f.c.calls.length,0);assert.equal(f.s.writes,writes);const wake=Date.parse('2026-06-01T07:30:00+03:00');f.s.setItem(SLEEP_KEY,JSON.stringify(recordNight(freshSleep(),{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3},Date.now())));const raw=f.s.raw;assert.equal(await prepareSleepLegacyMigration(f.s,owner,f.c,f.options),null);assert.equal(f.s.raw,raw);
});
test('05.02 competing file change before final migration commit preserves entire newer archive',async()=>{
 const f=fixture(),p=await prepareSleepLegacyMigration(f.s,owner,f.c,f.options),ready=await p!.start(true);f.s.setItem(SLEEP_KEY,JSON.stringify({...JSON.parse(f.s.raw),theme:'light',revision:9}));const newer=f.s.raw;
 assert.throws(()=>ready.approve(true),/archive changed/);assert.equal(f.s.raw,newer);assert.ok(readSleepLegacyMigration(f.s,owner));
});

test('05.02 legacy-created revision retires stale pending only after explicit choice and replaces its UUID',async()=>{
 const f=fixture(),wake=Date.parse('2026-06-01T07:30:00+03:00'),n=recordNight(freshSleep(),{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:0,rested:3},Date.now()).nights[0];
 f.s.setItem(SLEEP_KEY,JSON.stringify({...freshSleep(),nights:[n],credits:[n.date]}));const tx=openSleepSyncArchive(f.s,owner),op={operationId:randomUUID(),date:n.date,expectedRevision:0,night:n};enqueueSleepOperation(tx.storage,tx.queue,op);tx.commit(owner);
 const p=await prepareSleepLegacyMigration(f.s,owner,f.c,f.options),ready=await p!.start(true);assert.equal(ready.review.conflicts.length,1);ready.choose({[n.date]:'local'});ready.approve(true);
 const cold=openSleepSyncArchive(f.s,owner);assert.equal(cold.queue.operations.length,1);assert.notEqual(cold.queue.operations[0].operationId,op.operationId);assert.equal(cold.queue.operations[0].expectedRevision,1);assert.equal(cold.diary.credits.length,1);assert.equal(cold.diary.nights[0].success,false);cold.abort();
});


test('05.02 stopping unknown-outcome legacy retry preserves earned diary/queue and does not pretend to undo server',async()=>{
 const f=fixture(),p=await prepareSleepLegacyMigration(f.s,owner,f.c,f.options),ready=await p!.start(true);ready.discard();const before=f.s.raw;
 assert.throws(()=>stopSleepLegacyMigration(f.s,owner,f.options,false),/explicit approval/);assert.equal(f.s.raw,before);
 const saved=stopSleepLegacyMigration(f.s,owner,f.options,true);assert.deepEqual(saved.credits,['2026-06-01']);assert.equal(saved.garden,true);assert.equal(readSleepLegacyMigration(f.s,owner),null);assert.equal(f.c.calls.length,1);const tx=openSleepSyncArchive(f.s,owner);assert.equal(tx.queue.operations.length,0);assert.equal(tx.baseline,null);tx.abort();
});

test('05.02 combined legacy history capacity is checked before persisting intent or sending',async()=>{
 const f=fixture(),dates=Array.from({length:2000},(_,i)=>new Date(Date.UTC(2000,0,1)+i*86400000).toISOString().slice(0,10)),snapshot:SleepSnapshot={protocolVersion:1,garden:false,credits:dates,deletedCredits:dates,dates:dates.map(date=>({date,revision:1,night:null}))};
 const before=f.s.raw,c={...f.c,readSnapshot:async()=>({ownerId:owner,snapshot})};await assert.rejects(prepareSleepLegacyMigration(f.s,owner,c,f.options),/capacity/);assert.equal(f.s.raw,before);assert.equal(f.c.calls.length,0);assert.equal(readSleepLegacyMigration(f.s,owner),null);
});

