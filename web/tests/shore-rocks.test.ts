import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fracturedRockGeometry } from '../components/tower/crafted-geometry';
import { shoreRocks } from '../components/tower/shore-rocks';
import { coastRadius,harbourClearance } from '../components/tower/island-shape';

test('outcrops and loose stones stay below the plateau and inside the protected shoreline, including triangle edges',()=>{
  const geometries=Array.from({length:8},(_,i)=>fracturedRockGeometry(i%4,i<4?5:1));
  const p=new THREE.Vector3(),q=new THREE.Vector3();
  let outcrops=0,chips=0;
  for(const seed of [0,1,451,91731,999999]){
    const rocks=shoreRocks(seed,geometries);assert.ok(rocks.length>8&&rocks.length<=84);
    for(const rock of rocks){
      if(rock.geometry<4)outcrops++;else chips++;
      const vertices=geometries[rock.geometry].attributes.position;
      for(let i=0;i<vertices.count;i++){
        p.fromBufferAttribute(vertices,i).applyMatrix4(rock.matrix);
        assert.ok(p.y<2.65);assert.ok(harbourClearance(Math.atan2(p.z,p.x))<=.35);
        assert.ok(Math.hypot(p.x,p.z)<coastRadius(Math.atan2(p.z,p.x))-.089);
        q.fromBufferAttribute(vertices,i-i%3+(i+1)%3).applyMatrix4(rock.matrix).add(p).multiplyScalar(.5);
        assert.ok(Math.hypot(q.x,q.z)<coastRadius(Math.atan2(q.z,q.x))-.07);
      }
    }
    assert.deepEqual(rocks.map(r=>r.matrix.elements),shoreRocks(seed,geometries).map(r=>r.matrix.elements));
  }
  assert.ok(outcrops>10&&chips>10);geometries.forEach(g=>g.dispose());
});
