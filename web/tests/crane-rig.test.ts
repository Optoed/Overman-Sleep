import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCraneRig, CRANE_TIP_X } from '../components/tower/crane-rig';

test('animated rope stays on the boom and load stays on its lower endpoint', () => {
  const rig = createCraneRig(), tower = new THREE.Group();
  tower.position.set(4, 28, -7); tower.rotation.set(.02, .4, -.03);
  tower.add(rig.root); rig.root.position.set(-1.8, 9.1, 1.6);
  const anchor = rig.pivot.localToWorld(new THREE.Vector3());
  for (let time = 0; time < 40; time += .13) {
    rig.update(time, false); tower.updateWorldMatrix(true, true);
    const top = rig.rope.localToWorld(new THREE.Vector3(0, .5, 0));
    const bottom = rig.rope.localToWorld(new THREE.Vector3(0, -.5, 0));
    assert.ok(top.distanceTo(anchor) < 1e-9, 'rope must not drift away from fixed pulley');
    assert.ok(bottom.distanceTo(rig.payload.getWorldPosition(new THREE.Vector3())) < 1e-9);
  }
  rig.dispose(); assert.equal(tower.children.length, 0);
});

test('reduced motion holds crane and payload stationary', () => {
  const rig = createCraneRig();
  const snapshot = (time: number) => {
    rig.update(time, true); rig.root.updateWorldMatrix(true, true);
    return [rig.rope, rig.payload].flatMap(part => part.matrixWorld.toArray());
  };
  assert.deepEqual(snapshot(0), snapshot(100)); rig.dispose();
});

test('the full swinging payload clears the scaffold posts and braces', () => {
  const rig = createCraneRig(); rig.root.position.set(CRANE_TIP_X, 4.1, 1.6);
  for (let time = 0; time < 40; time += .11) {
    rig.update(time, false); rig.root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(rig.payload);
    assert.ok(bounds.max.x < -1.86, 'cargo must remain outside the left scaffold post');
    assert.ok(bounds.min.y > .33, 'cargo must remain above the construction platform');
  }
  rig.dispose();
});
