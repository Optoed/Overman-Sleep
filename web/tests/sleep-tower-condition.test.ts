import test from 'node:test';import assert from 'node:assert/strict';import {towerCondition} from '../components/sleep/sleep-tower-condition';
const start='2026-11-01',day=(i:number)=>`2026-11-${String(i).padStart(2,'0')}`;
const misses=(count:number)=>Array.from({length:count},(_,i)=>({date:day(i+1),success:false}));
test('one freeze protects an isolated miss; damage begins on third unprotected violation',()=>{
 assert.equal(towerCondition(misses(1),20,start,day(1)).integrity,100);
 assert.equal(towerCondition(misses(3),20,start,day(3)).integrity,100);
 assert.equal(towerCondition(misses(4),20,start,day(4)).visibleFloors,16);
 assert.equal(towerCondition(misses(8),20,start,day(8)).status,'collapsed');
});
test('four successful nights restore a collapsed tower while preserving earned floors and input',()=>{
 const rows=misses(8),before=JSON.stringify(rows);const restored=[...rows,...Array.from({length:4},(_,i)=>({date:day(i+9),success:true}))];
 for(let count=1;count<=4;count++){const r=towerCondition(restored.slice(0,8+count),20,start,day(8+count));assert.equal(r.integrity,count*25);assert.equal(r.earnedFloors,20);}
 assert.equal(towerCondition(restored,20,start,day(12)).visibleFloors,20);assert.equal(JSON.stringify(rows),before);
});
test('unknown days and history before activation never trigger collapse or repair',()=>{
 const rows=[...misses(4),{date:day(10),success:false}];assert.equal(towerCondition(rows,20,day(10),day(10)).integrity,100);
 const r=towerCondition(rows,20,start,day(10));assert.equal(r.integrity,80);assert.equal(r.failureRun,1);
 assert.equal(towerCondition([...rows,{date:day(11),success:true}],20,start,day(10)).integrity,80);
});
test('weekly success replenishes capped freezes; corrupt history is rejected',()=>{
 const rows=Array.from({length:14},(_,i)=>({date:day(i+1),success:true}));assert.equal(towerCondition(rows,100,start,day(14)).freezes,2);
 assert.throws(()=>towerCondition([...rows,rows[0]],20,start,day(14)));assert.throws(()=>towerCondition([],101,start,day(1)));assert.throws(()=>towerCondition([],20,'2026-02-30',day(1)));
});
