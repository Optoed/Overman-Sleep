import * as THREE from 'three';
import { seeded } from './world-state';
import { workMotion } from './workstations';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

type Shape = 'round' | 'cylinder' | 'box';
type Limb = { upper: THREE.Group; lower: THREE.Group; end: THREE.Group };
export type Resident = {
  root: THREE.Group; body: THREE.Group; head: THREE.Group;
  arms: Limb[]; legs: Limb[]; load: THREE.Group; hammer: THREE.Group;
  carrying: boolean; phase: number;
};
type Part = { node: THREE.Object3D; resident: Resident; color: THREE.Color; accessory: 'load'|'hammer'|null };

/** A small articulated cast, drawn in three instanced batches, including shadows. */
export function createResidents(scene: THREE.Scene) {
  const group = new THREE.Group(); scene.add(group);
  const material = new THREE.MeshLambertMaterial();
  const geometries = {
    round: new THREE.SphereGeometry(1, 14, 10),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
    box: new RoundedBoxGeometry(1, 1, 1, 1, .12),
  };
  const parts: Record<Shape, Part[]> = { round: [], cylinder: [], box: [] };
  const batches = {} as Record<Shape, THREE.InstancedMesh>;
  const residents: Resident[] = [];
  const shapes: Shape[] = ['round', 'cylinder', 'box'];
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const shape of shapes) {
    const batch = new THREE.InstancedMesh(geometries[shape], material, 1600);
    batch.count = 0; batch.castShadow = true; batch.receiveShadow = true;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The population moves between the island and the top floor each frame.
    batch.frustumCulled = false; group.add(batch); batches[shape] = batch;
  }
  function add(index: number, seed: number): Resident {
    const random = seeded(seed + index * 331), root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
    root.add(body); body.add(head); group.add(root);
    const r: Resident = { root, body, head, arms: [], legs: [], load: new THREE.Group(), hammer: new THREE.Group(), carrying: index % 3 !== 0, phase: index * 1.51 };
    const coat = ['#53a9a0', '#df9164', '#a0b66b', '#769ac4', '#d0a663'][index % 5];
    const shirt = ['#d3c6a7', '#bdb8a1', '#d8cdb6'][index % 3];
    const skin = ['#bf9472', '#9b7052', '#d6b393', '#80553e'][index % 4];
    const hair = ['#46382b', '#6c4c32', '#807064', '#353331'][index % 4];
    const trousers = ['#515a52', '#514941', '#555a64'][index % 3];
    function part(shape: Shape, parent: THREE.Object3D, pos: number[], scale: number[], color: string) {
      const node = new THREE.Object3D(); node.position.set(pos[0], pos[1], pos[2]); node.scale.set(scale[0], scale[1], scale[2]); parent.add(node);
      let accessory:Part['accessory']=null;
      for(let p:THREE.Object3D|null=parent;p&&p!==root;p=p.parent){if(p===r.load)accessory='load';if(p===r.hammer)accessory='hammer';}
      parts[shape].push({ node, resident: r, color: new THREE.Color(color),accessory }); return node;
    }
    const round = (p: THREE.Object3D, pos: number[], scale: number[], color: string) => part('round', p, pos, scale, color);
    const box = (p: THREE.Object3D, pos: number[], scale: number[], color: string) => part('box', p, pos, scale, color);
    const cylinder = (p: THREE.Object3D, pos: number[], scale: number[], color: string) => part('cylinder', p, pos, scale, color);
    round(body, [0, .338, 0], [.095, .074, .065], trousers);
    box(body, [0, .435, 0], [.215, .235, .15], coat);
    round(body, [0, .53, 0], [.038, .04, .034], skin);
    // Open waistcoat, linen collar and a leather belt break up the torso.
    box(body, [0, .46, .076], [.074, .15, .018], shirt);
    for (const side of [-1, 1]) {
      const collar = box(body, [side * .029, .516, .054], [.045, .038, .016], shirt); collar.rotation.z = side * .4;
    }
    cylinder(body, [0, .355, 0], [.099, .027, .07], '#65513c');
    box(body, [0, .355, .071], [.026, .027, .008], '#bca174');
    for (let i = 0; i < 3; i++) round(body, [.026, .411 + i * .032, .073], [.006, .006, .004], '#c8af78');
    head.position.y = .63; head.scale.setScalar(1.42);
    box(head, [0, 0, 0], [.158, .17, .143], skin);
    round(head, [0, .052, -.016], [.084, .051, .077], hair);
    for (let tuft = 0; tuft < 3; tuft++) round(head, [-.051 + tuft * .046, .07 + tuft * .005, .023], [.037, .031, .052], hair);
    round(head, [0, -.009, .077], [.019, .018, .025], skin);
    for (const side of [-1, 1]) {
      round(head, [side * .079, -.008, 0], [.017, .025, .02], skin);
      round(head, [side * .031, .018, .074], [.018, .022, .008], '#f7e9d2');
      round(head, [side * .031, .016, .081], [.009, .012, .004], '#3c3832');
      round(head, [side * .028, .021, .084], [.003, .004, .002], '#fff6dd');
      box(head, [side * .031, .045, .073], [.035, .008, .01], hair);
    }
    box(head, [0, -.041, .075], [.029, .005, .005], '#705141');
    if (index % 3 === 0) {
      cylinder(head, [0, .092, -.004], [.109, .015, .093], '#a38a5d');
      round(head, [0, .107, -.009], [.085, .047, .077], '#ac9364');
      cylinder(head, [0, .103, -.009], [.086, .015, .078], '#715a41');
    } else if (index % 3 === 1) {
      round(head, [0, .086, -.01], [.09, .046, .083], coat);
      round(head, [0, .077, .064], [.082, .012, .04], coat);
    } else {
      round(head, [0, .018, -.063], [.039, .046, .028], hair);
      round(head, [0, -.02, -.079], [.027, .025, .028], hair);
    }
    for (const side of [-1, 1]) {
      const upper = new THREE.Group(), lower = new THREE.Group(), end = new THREE.Group();
      upper.position.set(side * .107, .49, 0); lower.position.y = -.108; end.position.y = -.101;
      body.add(upper); upper.add(lower); lower.add(end);
      round(upper, [side * .006, -.039, 0], [.043, .073, .044], shirt);
      round(lower, [0, -.029, 0], [.031, .047, .033], shirt);
      round(lower, [0, -.071, 0], [.024, .043, .025], skin);
      round(end, [0, -.009, 0], [.026, .032, .024], skin);
      r.arms.push({ upper, lower, end });
      const hip = new THREE.Group(), knee = new THREE.Group(), ankle = new THREE.Group();
      hip.position.set(side * .049, .3, 0); knee.position.y = -.125; ankle.position.y = -.13;
      body.add(hip); hip.add(knee); knee.add(ankle);
      round(hip, [0, -.054, 0], [.045, .076, .048], trousers);
      round(knee, [0, -.055, 0], [.034, .075, .038], trousers);
      box(ankle, [0, -.001, .025], [.084, .086, .146], '#65533d');
      box(ankle, [0, -.039, .029], [.086, .012, .154], '#343d37');
      r.legs.push({ upper: hip, lower: knee, end: ankle });
    }
    body.add(r.load); r.load.position.set(0, .372, .128);
    box(r.load, [0, 0, 0], [.19, .12, .13], '#9a8059');
    for (const x of [-.073, .073]) box(r.load, [x, 0, .068], [.017, .12, .012], '#69573f');
    for (const y of [-.043, .043]) box(r.load, [0, y, .072], [.19, .014, .01], '#b19a70');
    r.arms[1].end.add(r.hammer);
    cylinder(r.hammer, [0, -.025, .035], [.012, .19, .012], '#896a43').rotation.x = Math.PI / 2;
    box(r.hammer, [0, -.025, .124], [.105, .05, .045], '#65716f');
    root.scale.setScalar(.96 + random() * .08);
    residents.push(r); return r;
  }
  function pose(r: Resident, time: number, working: boolean, idle: boolean, reduced: boolean) {
    const moving = !working && !idle && !reduced, t = time * 5 + r.phase;
    const work=workMotion(time,r.phase,reduced||idle);
    r.load.visible = r.carrying && !working; r.hammer.visible = working&&!idle;
    r.head.rotation.set(idle ? .16 : working ? .18+work.lift*.06 : reduced ? 0 : Math.sin(time * .7 + r.phase) * .025, reduced||working&&work.active ? 0 : Math.sin(time * .36 + r.phase) * .12, 0);
    let sole = Infinity;
    r.legs.forEach((leg, j) => {
      const phase = Math.sin(t + j * Math.PI);
      const hip = moving ? -.42 * phase : 0, knee = moving ? Math.max(0, phase) * .62 : 0;
      leg.upper.rotation.x = hip; leg.lower.rotation.x = knee; leg.end.rotation.x = -hip - knee;
      sole = Math.min(sole, .3 - .125 * Math.cos(hip) - .13 * Math.cos(hip + knee) - .045);
    });
    r.body.position.y = -sole;
    r.arms.forEach((arm, j) => {
      arm.upper.rotation.z = j ? -.06 : .06;
      if (working) {
        arm.upper.rotation.z=0;
        arm.upper.rotation.x = idle ? -.08 : j ? -1.3 : -1;
        arm.lower.rotation.x = idle ? -.16 : j ? .8-work.lift*2.2 : -.5;
      } else if (r.carrying) {
        arm.upper.rotation.x = -.5; arm.lower.rotation.x = -.82;
        arm.upper.rotation.z = j ? .07 : -.07;
      } else {
        arm.upper.rotation.x = moving ? Math.sin(t + j * Math.PI) * .32 : -.08;
        arm.lower.rotation.x = -.16;
      }
    });
  }
  function flush() {
    group.updateWorldMatrix(true, true);
    for (const shape of shapes) {
      const batch = batches[shape], list = parts[shape];
      const recolor = batch.count !== list.length; batch.count = list.length;
      list.forEach((part, i) => {
        const visible=part.resident.root.visible&&(!part.accessory||part.resident[part.accessory].visible);
        batch.setMatrixAt(i, visible ? part.node.matrixWorld : hidden);
        if (recolor) batch.setColorAt(i, part.color);
      });
      batch.instanceMatrix.needsUpdate = true;
      if (recolor && batch.instanceColor) batch.instanceColor.needsUpdate = true;
    }
  }
  function clear() {
    residents.forEach(r => r.root.removeFromParent()); residents.length = 0;
    for (const shape of shapes) { parts[shape].length = 0; batches[shape].count = 0; }
  }
  return { add, pose, flush, clear, dispose() {
    clear(); group.removeFromParent(); shapes.forEach(s => { batches[s].dispose(); geometries[s].dispose(); }); material.dispose();
  } };
}
