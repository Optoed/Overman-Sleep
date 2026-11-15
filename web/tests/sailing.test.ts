import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaneGeometry } from 'three';
import { sailPoint, updateSail, updateWakeTrail, WAKE_CAPACITY, WAKE_LIFETIME, type WakeTrail } from '../components/tower/sailing';
import { boatApproach } from '../components/tower/world-physics';
import { coastRadius } from '../components/tower/island-shape';

test('sail attachment points remain fixed while the cloth and its normals move independently',()=>{
  for(const [u,v] of [[0,0],[1,0],[0,1],[.25,1],[.5,1],[1,1]]){
    const reference=sailPoint(u,v,0,0);
    for(const time of [1,8,60])for(const phase of [0,2.3,4.6]){
      const point=sailPoint(u,v,time,phase);
      for(const key of ['x','y','z'] as const)assert.ok(Math.abs(point[key]-reference[key])<1e-10);
    }
  }
  const a=new PlaneGeometry(1,1,14,16),b=new PlaneGeometry(1,1,14,16);
  updateSail(a,0,0);updateSail(b,0,2.3);
  const before=Array.from(a.attributes.normal.array),other=Array.from(b.attributes.position.array);
  updateSail(a,2,0);assert.deepEqual(Array.from(b.attributes.position.array),other);
  assert.ok(Array.from(a.attributes.normal.array).some((x,i)=>Math.abs(x-before[i])>.01));
  const normal=a.attributes.normal;
  for(let i=0;i<normal.count;i++)assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-5);
  a.dispose();b.dispose();
});

test('wakes appear only during horizontal travel, expire after mooring and reset on teleport or reduced motion',()=>{
  const trail:WakeTrail={points:[],previous:null,distance:0};
  for(let i=0;i<60;i++)updateWakeTrail(trail,{x:0,z:0},i/60,1/60,1,true);
  assert.equal(trail.points.length,0);
  for(let i=1;i<=180;i++)updateWakeTrail(trail,{x:i/60*.56,z:0},1+i/60,1/60,1,true);
  assert.ok(trail.points.length>8&&trail.points.length<15);
  assert.ok(trail.points.every(p=>p.x<1.68&&p.dx===1&&p.dz===0));
  updateWakeTrail(trail,{x:1.68,z:0},4+WAKE_LIFETIME+.1,1/60,1,true);assert.equal(trail.points.length,0);
  updateWakeTrail(trail,{x:2,z:0},12,1/60,1,true);assert.ok(trail.points.length>0);
  updateWakeTrail(trail,{x:20,z:0},12.1,.1,1,true);assert.equal(trail.points.length,0);
  updateWakeTrail(trail,{x:20.3,z:0},12.2,.1,1,true);assert.ok(trail.points.length>0);
  updateWakeTrail(trail,{x:20.6,z:0},12.3,.1,1,false);assert.equal(trail.points.length,0);
});

test('wake history stays bounded and trails arriving boats offshore',()=>{
  const fast:WakeTrail={points:[],previous:null,distance:0};
  for(let i=0;i<1000;i++){updateWakeTrail(fast,{x:i*.2,z:0},i*.02,.02,1,true);assert.ok(fast.points.length<=WAKE_CAPACITY);}
  for(const [x,z,heading,scale] of [[4.7,7.9,-.2,.68],[-8.3,1.7,.6,1],[8.3,-5.8,1.4,1]]){
    const trail:WakeTrail={points:[],previous:null,distance:0};
    for(let i=0;i<=1500;i++){
      const position=boatApproach(x,z,1-i/1500,heading);updateWakeTrail(trail,position,i/60,1/60,scale,true);
      for(const p of trail.points)assert.ok(Math.hypot(p.x,p.z)>coastRadius(Math.atan2(p.z,p.x))+.5);
    }
  }
});
