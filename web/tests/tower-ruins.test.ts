import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTowerRuins,type TowerDamageView} from '../components/tower/tower-ruins';
const collapsed:TowerDamageView={scope:'2026-11-01',earnedFloors:20,visibleFloors:0,integrity:0,status:'collapsed'};
const ground=(x:number,z:number)=>3+Math.sin(x+z)*.05;
test('collapse fragments visibly fall, settle into retained ruins and never mutate the source',()=>{
 const scene=new THREE.Scene(),fx=createTowerRuins(scene,42,'#9f9a8d',false,'high',ground),before=JSON.stringify(collapsed);
 fx.set(collapsed,true);assert.equal(fx.phase,'falling');assert.equal(fx.fallingCount,80);
 const first=scene.getObjectByName('tower-condition-visual')!.children[1].children[0],y=first.position.y;
 for(let i=0;i<30;i++)fx.tick(.05);assert.ok(first.position.y<y);
 const current=first.position.y;fx.set({...collapsed},true);assert.equal(first.position.y,current);
 for(let i=0;i<100;i++)fx.tick(.05);assert.equal(fx.phase,'ruins');assert.equal(fx.fallingCount,0);assert.ok(fx.ruinCount>30);
 assert.equal(JSON.stringify(collapsed),before);fx.dispose();assert.equal(scene.children.length,0);
});
test('reduced motion displays ruins immediately without falling; repair removes rubble at full integrity',()=>{
 const scene=new THREE.Scene(),fx=createTowerRuins(scene,42,'#9f9a8d',true,'low',ground);
 fx.set(collapsed,true);assert.equal(fx.phase,'ruins');assert.equal(fx.fallingCount,0);const count=fx.ruinCount;
 fx.set({...collapsed,integrity:75,visibleFloors:15,status:'repairing'},false);assert.equal(fx.phase,'ruins');assert.ok(fx.ruinCount<count);
 assert.equal(scene.getObjectByName('tower-condition-visual')!.children[0].visible,true);
 fx.set({...collapsed,integrity:100,visibleFloors:20,status:'intact'},false);assert.equal(fx.phase,'intact');assert.equal(fx.ruinCount,0);fx.dispose();
});
test('all supported tower heights have bounded fragment counts and finite geometry/poses',()=>{
 for(const quality of ['low','high'] as const)for(const floors of [0,1,4,12,24,100]){
  const scene=new THREE.Scene(),fx=createTowerRuins(scene,137,'#9f9a8d',false,quality,ground);
  fx.set({...collapsed,earnedFloors:floors},true);assert.ok(fx.fallingCount<=(quality==='high'?80:40));
  assert.ok(fx.ruinCount<=(quality==='high'?51:27));
  for(let i=0;i<90;i++)fx.tick(.05);
  scene.traverse(o=>{assert.ok([...o.position,...o.scale,o.rotation.x,o.rotation.y,o.rotation.z].every(Number.isFinite));});
  assert.equal(fx.fallingCount,0);fx.set(null);assert.equal(fx.ruinCount,0);fx.dispose();
 }
});
test('invalid presentation or animation intervals cannot create geometry',()=>{
 const scene=new THREE.Scene(),fx=createTowerRuins(scene,42,'#9f9a8d',false,'low',ground);
 for(const view of [{...collapsed,earnedFloors:101},{...collapsed,visibleFloors:21},{...collapsed,integrity:NaN}])assert.throws(()=>fx.set(view));
 assert.throws(()=>fx.tick(-1));assert.throws(()=>fx.tick(Infinity));assert.equal(fx.fallingCount,0);fx.dispose();
});
