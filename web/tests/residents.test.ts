import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createResidents } from '../components/tower/residents';

test('articulated walking keeps a supporting sole on the ground and both feet above it', () => {
  const scene = new THREE.Scene(), cast = createResidents(scene), resident = cast.add(1, 451);
  resident.root.scale.setScalar(1);
  for (let t = 0; t < 12; t += .031) {
    cast.pose(resident, t, false, false, false);
    resident.root.updateWorldMatrix(true, true);
    const soles = resident.legs.map(leg => leg.end.localToWorld(new THREE.Vector3(0, -.045, 0)).y);
    assert.ok(Math.min(...soles) > -1e-8);
    assert.ok(Math.abs(Math.min(...soles)) < 1e-8);
  }
  cast.dispose();
});

test('reduced motion freezes every articulated part, including the head', () => {
  const scene = new THREE.Scene(), cast = createResidents(scene), resident = cast.add(0, 451);
  function matrices(time: number) {
    cast.pose(resident, time, true, false, true); cast.flush();
    const result: number[] = []; resident.root.traverse(node => result.push(...node.matrixWorld.elements)); return result;
  }
  assert.deepEqual(matrices(0), matrices(10)); cast.dispose();
});

test('population batches replace their contents on rebuild and do not leave ghost residents', () => {
  const scene = new THREE.Scene(), cast = createResidents(scene);
  for (let i = 0; i < 20; i++) { const r = cast.add(i, 12); cast.pose(r, 3, i % 4 === 0, false, false); }
  cast.flush();
  const batches: THREE.InstancedMesh[] = []; scene.traverse(node => { if (node instanceof THREE.InstancedMesh) batches.push(node); });
  assert.equal(batches.length, 3);
  for (const batch of batches) assert.ok(batch.count > 0 && batch.count < batch.instanceMatrix.count);
  cast.clear(); assert.ok(batches.every(batch => batch.count === 0));
  const resident = cast.add(1, 993); cast.pose(resident, 0, false, false, false); cast.flush();
  assert.ok(batches.every(batch => batch.count < 70));
  resident.root.visible = false; cast.flush();
  const matrix = new THREE.Matrix4();
  for (const batch of batches) for (let i = 0; i < batch.count; i++) { batch.getMatrixAt(i, matrix); assert.equal(matrix.determinant(), 0); }
  cast.dispose(); assert.equal(scene.children.length, 0);
});
