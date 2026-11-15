import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const CRANE_TIP_X = -2.65;

export function craneMotion(time: number, reduced: boolean) {
  return { length: reduced ? 1.85 : 1.85 + Math.sin(time * .42) * .36, swing: reduced ? 0 : Math.sin(time * .7) * .022 };
}

/** The root is the fixed boom-tip axle. Only the suspended assembly moves. */
export function createCraneRig() {
  const root = new THREE.Group(); root.name = 'fixed-boom-tip';
  const ropeMat = new THREE.MeshLambertMaterial({ color: '#b29a66' });
  const wood = new THREE.MeshLambertMaterial({ color: '#ba8b51' });
  const iron = new THREE.MeshLambertMaterial({ color: '#506268' });
  const unit = new THREE.CylinderGeometry(1, 1, 1, 8), board = new RoundedBoxGeometry(1, 1, 1, 1, .06);
  const ring = new THREE.TorusGeometry(.065, .016, 5, 12);
  const pulleyGeo = new THREE.CylinderGeometry(.12, .12, .1, 16);
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
    const m = new THREE.Mesh(geometry, material); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  function box(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material = wood) {
    const m = mesh(board, material, parent); m.position.set(x, y, z); m.scale.set(w, h, d); return m;
  }
  const wheel = mesh(pulleyGeo, iron, root); wheel.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) box(root, 0, .07, side * .09, .08, .24, .035, iron);
  const pivot = new THREE.Group(); pivot.position.set(0, -.12, 0); root.add(pivot);
  const rope = mesh(unit, ropeMat, pivot);
  const payload = new THREE.Group(); pivot.add(payload);
  mesh(ring, iron, payload).position.y = -.055;
  box(payload, 0, -.43, 0, .64, .29, .48);
  for (const x of [-.22, .22]) box(payload, x, -.43, 0, .036, .303, .492, iron);
  const up = new THREE.Vector3(0, 1, 0);
  for (const x of [-.24, .24]) for (const z of [-.18, .18]) {
    const a = new THREE.Vector3(0, -.105, 0), b = new THREE.Vector3(x, -.28, z), m = mesh(unit, ropeMat, payload);
    m.position.copy(a).add(b).multiplyScalar(.5); m.scale.set(.013, a.distanceTo(b), .013); m.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
  }
  function update(time: number, reduced: boolean) {
    const motion = craneMotion(time, reduced);
    pivot.rotation.z = motion.swing;
    rope.position.y = -motion.length / 2; rope.scale.set(.022, motion.length, .022);
    payload.position.y = -motion.length;
  }
  update(0, true);
  return { root, pivot, rope, payload, update, dispose() { root.removeFromParent(); [unit, board, ring, pulleyGeo].forEach(g => g.dispose()); [ropeMat, wood, iron].forEach(m => m.dispose()); } };
}
