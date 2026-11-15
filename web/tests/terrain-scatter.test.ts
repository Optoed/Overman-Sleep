import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { terrainScatter } from '../components/tower/terrain-scatter';
import { seeded } from '../components/tower/world-state';

test('forest samples follow the triangle surface, cover its interior, and retain interpolated normals',()=>{
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,3,3,0,0,0,3],3));
  const normal=new THREE.Vector3(-1,1,0).normalize();g.setAttribute('normal',new THREE.Float32BufferAttribute([...normal,...normal,...normal],3));g.setIndex([0,1,2]);
  const random=seeded(42),p=new THREE.Vector3(),n=new THREE.Vector3();let meanX=0,meanZ=0;
  for(let i=0;i<2000;i++){
    terrainScatter(g,random,p,n);assert.ok(p.x>=0&&p.z>=0&&p.x+p.z<=3+1e-8);
    assert.ok(Math.abs(p.y-p.x)<1e-8);assert.ok(n.distanceTo(normal)<1e-7);
    meanX+=p.x;meanZ+=p.z;
  }
  assert.ok(Math.abs(meanX/2000-1)<.05&&Math.abs(meanZ/2000-1)<.05);
  const plain=g.toNonIndexed(),a=new THREE.Vector3(),b=new THREE.Vector3();
  terrainScatter(g,seeded(17),a,n);terrainScatter(plain,seeded(17),b,n);assert.ok(a.distanceTo(b)<1e-8);
  g.dispose();plain.dispose();
});
