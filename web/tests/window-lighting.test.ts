import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWindowLighting } from '../components/tower/window-lighting';

test('window batches grow for a tall tower and retain only two active batches',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(),lit=new THREE.MeshBasicMaterial(),dark=new THREE.MeshBasicMaterial();
  const lighting=createWindowLighting(scene,geometry,lit,dark);
  const windows=Array.from({length:1200},()=>new THREE.Mesh(geometry,lit));
  for(const strength of [100,0,90]){
    lighting.update(windows,strength);
    const batches=scene.children.filter((o):o is THREE.InstancedMesh=>o instanceof THREE.InstancedMesh);
    assert.equal(batches.length,2);
    assert.equal(batches.reduce((sum,b)=>sum+b.count,0),windows.length);
    assert.ok(batches.every(b=>b.count<=b.instanceMatrix.count));
  }
  lighting.dispose();assert.equal(scene.children.length,0);
  geometry.dispose();lit.dispose();dark.dispose();
});

test('batched windows retain scale, position and lean, react to strength, and clear rebuilt openings',()=>{
  const scene=new THREE.Scene(),tower=new THREE.Group(),level=new THREE.Group(),geometry=new THREE.PlaneGeometry(),lit=new THREE.MeshBasicMaterial(),dark=new THREE.MeshStandardMaterial();
  tower.position.y=3;tower.rotation.z=.12;level.position.y=20;level.scale.y=.3;scene.add(tower);tower.add(level);
  const windows=Array.from({length:12},(_,i)=>{const w=new THREE.Mesh(geometry,lit);w.position.set(i*.2,.5,2);level.add(w);return w;});
  windows[0].userData.unlit=true;
  const lighting=createWindowLighting(scene,geometry,lit,dark);lighting.update(windows,50);
  const batches=scene.children.filter((o):o is THREE.InstancedMesh=>o instanceof THREE.InstancedMesh);
  assert.deepEqual(batches.map(b=>b.count),[6,6]);assert.ok(windows.every(w=>!w.visible));
  const matrix=new THREE.Matrix4();batches[1].getMatrixAt(0,matrix);
  matrix.elements.forEach((n,i)=>assert.ok(Math.abs(n-windows[0].matrixWorld.elements[i])<1e-5));
  level.scale.y=1;tower.rotation.z=-.2;lighting.update(windows,100);
  assert.deepEqual(batches.map(b=>b.count),[11,1]);batches[0].getMatrixAt(0,matrix);
  matrix.elements.forEach((n,i)=>assert.ok(Math.abs(n-windows[1].matrixWorld.elements[i])<1e-5));
  lighting.clear();assert.ok(batches.every(b=>b.count===0));lighting.update(windows.slice(0,1),0);
  assert.deepEqual(batches.map(b=>b.count),[0,1]);lighting.dispose();assert.deepEqual(scene.children,[tower]);
  geometry.dispose();lit.dispose();dark.dispose();
});
