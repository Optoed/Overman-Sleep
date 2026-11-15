import test from 'node:test';import assert from 'node:assert/strict';
import {createNativeRequests} from '../components/sleep/native-requests';
import {beginNight,captureWake,freshSleep,sessionId,parseSleep,recordNight} from '../components/sleep/sleep-state';
import {acceptsDeviceStatus,matchingNativeWake,recordedNativeWake} from '../components/sleep/native-session';
import {recoverWake} from '../components/sleep/sleep-wake-recovery';
import type {DeviceStatus} from '../components/sleep/sleep-device';
test('reply IDs are page-specific; duplicate, unknown and late replies cannot resolve another call',async()=>{
 const sent:string[]=[],a=createNativeRequests((m,b,id)=>sent.push(id),100,'page-a'),b=createNativeRequests((m,v,id)=>sent.push(id),100,'page-b');
 const pa=a.call('wake'),pb=b.call('wake');assert.notEqual(sent[0],sent[1]);b.reply(sent[0],{stale:true});assert.equal(b.pendingCount,1);
 a.reply(sent[0],1);a.reply(sent[0],99);b.reply(sent[1],2);assert.equal(await pa,1);assert.equal(await pb,2);assert.equal(a.pendingCount+b.pendingCount,0);
});
test('timeout, native rejection and synchronous transport errors clear pending state and allow retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const sent:string[]=[],r=createNativeRequests((m,b,id)=>sent.push(id),100,'timeout');
 const failure=assert.rejects(r.call('wake'),/Android не ответил/);t.mock.timers.tick(101);await failure;assert.equal(r.pendingCount,0);
 const retry=r.call('wake');r.reply(sent[0],77);assert.equal(r.pendingCount,1);r.reply(sent[1],8);assert.equal(await retry,8);
 const rejected=assert.rejects(r.call('wake'),/отказ/);r.reply(sent[2],null,'отказ');await rejected;assert.equal(r.pendingCount,0);
 const throwing=createNativeRequests(()=>{throw Error('bridge gone');},100,'throw');await assert.rejects(throwing.call('start'),/bridge gone/);assert.equal(throwing.pendingCount,0);t.mock.timers.reset();
});
test('new sessions at the same wall time differ; old response and older native revision are rejected',()=>{
 const a=beginNight(freshSleep(),1000),b=beginNight(freshSleep(),1000);assert.notEqual(sessionId(a.active!),sessionId(b.active!));
 const status:DeviceStatus={native:true,exact:true,notifications:true,microphone:false,protocolVersion:2,sessionId:sessionId(a.active!),revision:5,wokeAt:2000,wakeNight:a.active!};
 assert.equal(acceptsDeviceStatus(b.active,status,0),false);assert.equal(matchingNativeWake(b,status),false);assert.equal(acceptsDeviceStatus(a.active,status,6),false);assert.equal(acceptsDeviceStatus(a.active,status,5),true);
 assert.equal(recoverWake(b,{version:1,...a.active!,wokeAt:2000},true,2000),b);
});
test('concurrent replies settle only their own request; old failures and timeout timers cannot cancel a retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const ids:string[]=[],r=createNativeRequests((m,b,id)=>ids.push(id),100,'reordered');
 const status=r.call('status'),start=r.call('start');r.reply(ids[1],{sessionId:'new',revision:8});r.reply(ids[0],{sessionId:'old',revision:7});
 assert.deepEqual(await start,{sessionId:'new',revision:8});assert.deepEqual(await status,{sessionId:'old',revision:7});assert.equal(r.pendingCount,0);
 const failed=assert.rejects(r.call('wake'),/Android не ответил/);t.mock.timers.tick(101);await failed;
 const retry=r.call('wake');r.reply(ids[2],null,'late failure');r.reply('unknown',null,'unrelated failure');assert.equal(r.pendingCount,1);
 r.reply(ids[3],{event:'once'});r.reply(ids[3],null,'duplicate failure');assert.deepEqual(await retry,{event:'once'});
 t.mock.timers.tick(1000);assert.equal(r.pendingCount,0);t.mock.timers.reset();
});
test('legacy nights retain stable identity; wake and acknowledgement must identify exactly that night',()=>{
 const a=freshSleep();a.active={started:1000,target:a.schedule};assert.equal(sessionId(a.active),'legacy-1000');
 const status:DeviceStatus={native:true,exact:true,notifications:true,microphone:false,protocolVersion:2,revision:1,sessionId:'legacy-1000',wakeNight:a.active,wokeAt:2000,wakeEvent:{id:'event',sessionId:'legacy-1000',wokeAt:2000}};
 assert.equal(matchingNativeWake(a,status),true);assert.equal(matchingNativeWake(a,{...status,wakeEvent:{...status.wakeEvent!,sessionId:'other'}}),false);
 assert.equal(recordedNativeWake(a,status),false);assert.equal(matchingNativeWake(a,{...status,wakeNight:{...a.active,started:999}}),false);
});
test('old archives remain readable while malformed new identifiers are refused',()=>{
 const s=freshSleep();s.active={started:1000,target:s.schedule};assert.deepEqual(parseSleep(JSON.stringify(s)),s);
 assert.throws(()=>parseSleep(JSON.stringify({...s,active:{...s.active,id:'invalid identifier'}})));
 const restored=recoverWake(s,{version:1,started:1000,target:s.schedule,wokeAt:2000},true,2000);assert.equal(restored.active?.wokeAt,2000);
});
test('a morning completion from another ID cannot finish a night with identical timestamps',()=>{
 const a=captureWake(beginNight(freshSleep(),1000),2000,1000,2000),b=captureWake(beginNight(freshSleep(),1000),2000,1000,2000);
 assert.throws(()=>recordNight(b,{bed:1000,wake:2000,sleepMinutes:0,rested:4},2000,{id:a.active!.id,started:1000,wokeAt:2000}));
});
