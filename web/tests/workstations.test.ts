import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createResidents } from '../components/tower/residents';
import { workMotion, workStation, WORK_SURFACE, WORK_DEPTH } from '../components/tower/workstations';
import { floorRadius } from '../components/tower/tower-architecture';

test('hammer contacts the workpiece without sinking through it, with a real pause between bursts',()=>{
  const scene=new THREE.Scene(),cast=createResidents(scene),r=cast.add(0,456);
  r.root.scale.setScalar(1);let contacts=0,rests=0,highest=0;
  for(let t=0;t<7.4;t+=.013){
    cast.pose(r,t,true,false,false);r.root.updateWorldMatrix(true,true);
    const corners:number[]=[];
    for(const y of [-.05,0])for(const z of [.1015,.1465])corners.push(r.hammer.localToWorld(new THREE.Vector3(0,y,z)).y);
    const bottom=Math.min(...corners);highest=Math.max(highest,bottom);
    assert.ok(bottom>=WORK_SURFACE-1e-8,`hammer penetrates stone at ${t}`);
    const motion=workMotion(t,r.phase);
    if(motion.contact){contacts++;assert.ok(Math.abs(bottom-WORK_SURFACE)<1e-8);}
    if(!motion.active)rests++;
  }
  assert.ok(contacts>20&&rests>200);assert.ok(highest-WORK_SURFACE>.2);
  cast.pose(r,4.5,true,false,false);r.root.updateWorldMatrix(true,true);
  const hit=r.hammer.localToWorld(new THREE.Vector3(0,-.025,.124));
  assert.ok(Math.abs(hit.z-WORK_DEPTH)<1e-8);
  assert.ok(Math.abs(hit.x-.107)<1e-8);
  cast.dispose();
});

test('work stations stay on platforms and clear the crane, braces and each other at every stage',()=>{
  for(let floors=0;floors<=24;floors++){
    const stations=Array.from({length:floors===0?1:5},(_,i)=>workStation(i,floors));
    stations.forEach((s,i)=>{
      if(i<2){
        // Both feet rest on one front deck plank, including maximum resident scale.
        for(const side of [-1,1]){
          const x=s.x+side*.049*1.04;
          assert.ok(Array.from({length:9},(_,j)=>-1.8+j*.45).some(center=>Math.abs(x-center)+.045*1.04<.2));
        }
        assert.ok(s.z-.11>1.525&&s.z+.11<2.275);
        assert.ok(Math.abs(s.y-.33-.012)<1e-9);
      }else{
        assert.ok(Math.hypot(s.x,s.z)+.15<floorRadius(floors-1)-.028);
        assert.ok(Math.abs(s.y-(floors%6===0?-.15:-.2)-.012)<1e-9);
      }
      assert.ok(Math.hypot(s.x-1.75,s.z-1.6)>.3);
      assert.ok(Math.abs(s.x)<1.8-.3&&s.z> -1.8+.4);
      for(let j=0;j<i;j++)assert.ok(Math.hypot(s.x-stations[j].x,s.z-stations[j].z)>.7);
      if(floors>0&&floors%6===0)for(let j=0;j<2;j++){
        const a=(floors-6)/6*1.45+.72+j*Math.PI,r=floorRadius(floors-1)+.25;
        assert.ok(Math.hypot(s.x-Math.sin(a)*r,s.z-Math.cos(a)*r)>.79);
      }
    });
  }
});

test('rest and reduced motion remove strikes and hide tools when a resident stops working',()=>{
  const scene=new THREE.Scene(),cast=createResidents(scene),r=cast.add(0,555);
  cast.pose(r,2,true,true,false);assert.equal(r.hammer.visible,false);
  for(const time of [0,5,30])assert.deepEqual(workMotion(time,1,true),workMotion(0,0,true));
  cast.pose(r,3,false,false,false);assert.equal(r.hammer.visible,false);
  cast.dispose();
});
