import test from 'node:test';import assert from 'node:assert/strict';
import {freshSleep,recordNight,parseSleep} from '../components/sleep/sleep-state';
import {previewHealthSessions,healthSessionSources} from '../components/sleep/sleep-health-preview';
import {importHealthNight} from '../components/sleep/sleep-health-import';
import type {HealthSleepSession} from '../components/sleep/sleep-health-session';
const h=3600000,base=Date.UTC(2026,10,10,12),now=base+72*h,offsets={bed:0,wake:0};
const session=(start:number,end:number,packageName:string|null='app.first'):HealthSleepSession=>({start,end,stages:[{start,end,kind:'sleeping'}],origin:{version:'health-connect-origin-v1',packageName,recordingMethod:'automatic'}});
const statuses=(sessions:HealthSleepSession[])=>previewHealthSessions(sessions,freshSleep(),offsets,now).map(r=>r.status);
test('half-open intersections across wake dates block both records, including one millisecond',()=>{
 const a=session(base,base+8*h),b=session(base+7*h,base+13*h);
 assert.deepEqual(statuses([a,b]),['overlap','overlap']);
 assert.deepEqual(statuses([a,session(a.end,base+13*h)]),['ready','ready']);
 assert.deepEqual(statuses([a,session(a.end-1,base+13*h)]),['overlap','overlap']);
 assert.deepEqual(statuses([b,a]),['overlap','overlap']);
 assert.deepEqual(statuses([a,session(a.start+1,a.end-1)]),['duplicate','duplicate']);
});
test('explicit source choice resolves cross-app duplication without renumbering or score shopping',()=>{
 const a=session(base,base+8*h),b=session(base,base+9*h,'app.second'),state=freshSleep(),before=JSON.stringify({a,b,state});
 assert.deepEqual(statuses([a,b]),['duplicate','duplicate']);
 const rows=previewHealthSessions([a,b],state,offsets,now,'app.second');assert.equal(rows.length,1);assert.equal(rows[0].index,1);assert.equal(rows[0].status,'ready');
 assert.throws(()=>importHealthNight(state,[a,b],1,offsets,4,now));
 assert.throws(()=>importHealthNight(state,[a,b],0,offsets,4,now,'app.second'));
 const next=importHealthNight(state,[a,b],1,offsets,4,now,'app.second');assert.equal(next.nights.length,1);assert.equal(next.nights[0].healthOrigin?.packageName,'app.second');assert.equal(next.nights[0].sleepMinutes,540);assert.equal(next.nights[0].rested,4);
 assert.equal(JSON.stringify({a,b,state}),before);assert.ok(parseSleep(JSON.stringify(next)));
 assert.throws(()=>previewHealthSessions([a,b],state,offsets,now,'app.absent'));
});
test('source choice keeps same-app ambiguity blocked and treats unknown apps explicitly',()=>{
 const a=session(base,base+8*h),b=session(base+7*h,base+13*h),unknown=session(base,base+9*h,null),legacy={...unknown};delete legacy.origin;
 assert.deepEqual(previewHealthSessions([a,b,unknown],freshSleep(),offsets,now,'app.first').map(r=>r.status),['overlap','overlap']);
 assert.deepEqual(healthSessionSources([a,unknown,legacy,a]),['app.first',null]);
 assert.equal(previewHealthSessions([a,unknown],freshSleep(),offsets,now,null)[0].index,1);
 assert.deepEqual(previewHealthSessions([unknown,legacy],freshSleep(),offsets,now,null).map(r=>r.status),['duplicate','duplicate']);
 assert.throws(()=>previewHealthSessions([a,{...unknown,origin:{...unknown.origin!,recordingMethod:'future'} as never}],freshSleep(),offsets,now,'app.first'),'Invalid hidden records cannot bypass validation');
});
test('current saved intervals block a different-date reimport across sources and revalidate on save',()=>{
 const a=session(base,base+8*h),b=session(base+7*h,base+13*h,'app.second'),state=freshSleep();
 const reviewed=previewHealthSessions([a,b],state,offsets,now,'app.second');assert.equal(reviewed[0].status,'ready');
 const withNight=recordNight(state,{bed:a.start,wake:a.end,bedOffset:0,wakeOffset:0,sleepMinutes:480,rested:3},now),before=JSON.stringify(withNight);
 assert.equal(previewHealthSessions([b],withNight,offsets,now,'app.second')[0].status,'history-overlap');
 assert.throws(()=>importHealthNight(withNight,[a,b],1,offsets,4,now,'app.second'));assert.equal(JSON.stringify(withNight),before);
 const hc=importHealthNight(state,[a],0,offsets,3,now);assert.throws(()=>importHealthNight(hc,[b],0,offsets,4,now,'app.second'));assert.equal(hc.nights.length,1);
 assert.equal(previewHealthSessions([session(a.end,base+13*h)],withNight,offsets,now)[0].status,'ready');
});
test('active, future, same-date ledger and incomplete protections remain under source filtering',()=>{
 const a=session(base,base+8*h),b=session(base+7*h,base+13*h,'app.second'),state=freshSleep();
 assert.equal(previewHealthSessions([a,b],{...state,active:{started:base,target:state.schedule}},offsets,now,'app.second')[0].status,'active');
 assert.equal(previewHealthSessions([a,b],state,offsets,base,'app.second')[0].status,'future');
 assert.equal(previewHealthSessions([a,b],{...state,credits:['2026-11-11']},offsets,now,'app.second')[0].status,'existing');
 assert.equal(previewHealthSessions([{...b,stages:[]}],state,offsets,now,'app.second')[0].status,'incomplete');
});
