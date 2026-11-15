'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { activeMemories, CATALOG, RESIDENTS, type Resident, type RoomState } from './room-state';
import { movePlayer } from './room-collision';
import { bubblePosition, conversationView } from './conversation';
import RoomSpeech, { type Speech } from './room-speech';
import { RoomRenderBudget } from './room-render-budget';
import styles from './room.module.css';

type Props = { state: RoomState; paused: boolean; onSelect: (id: string) => void; speech?: Speech | null; children?: ReactNode };
type SceneApi = { update: (state: RoomState) => void; home: () => void; stop: () => void };
export default function RoomScene({ state, paused, onSelect, speech, children }: Props) {
  const mount = useRef<HTMLDivElement>(null), api = useRef<SceneApi | null>(null);
  const keys = useRef(new Set<string>()), pausedRef = useRef(paused), selectRef = useRef(onSelect), initial = useRef(state);
  const speechRef = useRef(speech), bubble = useRef<HTMLDivElement>(null);
  speechRef.current = speech;
  const [error, setError] = useState(''), [target, setTarget] = useState(''), [ready, setReady] = useState(false);
  pausedRef.current = paused; selectRef.current = onSelect;
  useEffect(() => { api.current?.update(state); }, [state]);
  useEffect(() => { if (paused) { keys.current.clear(); api.current?.stop(); } }, [paused]);
  useEffect(() => {
    const el = mount.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
    catch { setError('3D недоступно в этом браузере. Все воспоминания и разговоры доступны через кнопки ниже.'); return; }
    const budget = new RoomRenderBudget(window.devicePixelRatio || 1);
    renderer.setPixelRatio(budget.scale);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', 'Кабинет: WASD — идти, стрелки — осмотр, E — взаимодействовать, Escape — отпустить управление');
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#bfd9d5');
    const camera = new THREE.PerspectiveCamera(65, 1, .08, 100); camera.position.set(0, 1.65, 3.1); camera.rotation.order = 'YXZ';
    let yaw = 0, pitch = -.06, drag: { x: number; y: number; total: number; id: number } | null = null;
    let frame = 0, last = performance.now(), lastDiagnostic = 0, lastPick = 0, lastShadow = 0, active = true, hovered = '', hoveredLabel = '', atmosphere = initial.current.atmosphere;
    let focused: Resident | null = null, memorySignature = '', frameTotal = 0, frameCount = 0, cpuTotal = 0;
    let returnView: { position: THREE.Vector3; yaw: number; pitch: number } | null = null;
    let focusView: { position: THREE.Vector3; yaw: number; pitch: number } | null = null;
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>(), matCache = new Map<string | number, THREE.MeshStandardMaterial>(); let buildingStatic = true;
    const mat = (color: string | number) => { if (buildingStatic && matCache.has(color)) return matCache.get(color)!; const m = new THREE.MeshStandardMaterial({ color, roughness: .87 }); materials.add(m); if (buildingStatic) matCache.set(color, m); return m; };
    const cream = mat('#e9dcca'), wood = mat('#a16f4c'), darkWood = mat('#684733'), teal = mat('#6f9690'), brass = mat('#bd9753'), paper = mat('#f5ebd7');
    const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      geometries.add(geometry); const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    const box = (parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) => mesh(parent, new RoundedBoxGeometry(w, h, d, 1, Math.min(.07, w * .12, h * .12, d * .12)), material, x, y, z);
    const sphere = (parent: THREE.Object3D, x: number, y: number, z: number, radius: number, material: THREE.Material) => mesh(parent, new THREE.SphereGeometry(radius, 16, 12), material, x, y, z);
    const cylinder = (parent: THREE.Object3D, x: number, y: number, z: number, r1: number, r2: number, h: number, material: THREE.Material) => mesh(parent, new THREE.CylinderGeometry(r1, r2, h, 16), material, x, y, z);
    const ambient = new THREE.HemisphereLight('#ffefce', '#889690', 2.1); scene.add(ambient);
    const sun = new THREE.DirectionalLight('#ffcd8c', 3.4); sun.position.set(-3, 7, -7); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8; sun.shadow.camera.far = 35; sun.shadow.normalBias = .035; scene.add(sun);
    const warm = new THREE.PointLight('#ffc87f', 12, 8, 2); warm.position.set(-2.8, 2, -2.1); scene.add(warm);
    // Small procedural material maps stay local and share one GPU texture each.
    const grain = document.createElement('canvas'); grain.width = grain.height = 128; const grainContext = grain.getContext('2d')!;
    grainContext.fillStyle = '#ead6b6'; grainContext.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 46; i++) { grainContext.strokeStyle = `rgba(119,76,40,${.035 + (i % 3) * .013})`; grainContext.beginPath(); for (let x = 0; x <= 128; x += 8) { const y = i * 2.8 + Math.sin(x * .027 + i) * 1.8; if (x === 0) grainContext.moveTo(x, y); else grainContext.lineTo(x, y); } grainContext.stroke(); }
    const grainTexture = new THREE.CanvasTexture(grain); grainTexture.colorSpace = THREE.SRGBColorSpace; textures.add(grainTexture); wood.map = grainTexture;
    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64; const sc = shadowCanvas.getContext('2d')!;
    const gradient = sc.createRadialGradient(32, 32, 2, 32, 32, 31); gradient.addColorStop(0, 'rgba(57,48,35,.25)'); gradient.addColorStop(1, 'rgba(57,48,35,0)'); sc.fillStyle = gradient; sc.fillRect(0, 0, 64, 64);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas); textures.add(shadowTexture);
    const contact = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }); materials.add(contact);
    for (const [x, z, w, d] of [[-2.5, -2.5, 3.6, 2], [3.25, -2.5, 2.8, 1.8], [-3.4, 1.5, 1, 1], [2.5, .7, 1, 1], [.8, -2.7, 1, 1]]) { const s = mesh(scene, new THREE.PlaneGeometry(w, d), contact, x, .057, z); s.rotation.x = -Math.PI / 2; s.castShadow = false; s.receiveShadow = false; }
    // Solid architectural pieces frame a real opening to the outside landscape.
    box(scene, 0, -.12, 0, 10, .24, 8, darkWood);
    for (let i = 0; i < 20; i++) box(scene, -4.75 + i * .5, .012, 0, .485, .025, 7.98, mat(i % 3 ? '#c49b73' : '#bb8e68'));
    box(scene, -5, 2, 0, .25, 4, 8, cream); box(scene, 5, 2, 0, .25, 4, 8, cream);
    box(scene, 0, 2, 4, 10, 4, .25, cream);
    box(scene, -3.4, 2, -4, 3.2, 4, .25, cream); box(scene, 3.4, 2, -4, 3.2, 4, .25, cream);
    box(scene, 0, .43, -4, 3.6, .86, .25, cream); box(scene, 0, 3.84, -4, 3.6, .32, .25, cream);
    box(scene, 0, 4.08, 0, 10, .18, 8, paper);
    const panelPaint = mat('#a0b7a6');
    for (const x of [-4.83, 4.83]) {
      box(scene, x, .55, 0, .08, 1.1, 7.8, panelPaint); box(scene, x, 1.12, 0, .13, .07, 7.8, wood);
      for (let z = -3.65; z < 4; z += .55) box(scene, x > 0 ? x - .047 : x + .047, .56, z, .055, 1.05, .04, paper);
    }
    box(scene, 0, .55, 3.83, 9.7, 1.1, .08, panelPaint); box(scene, 0, 1.12, 3.79, 9.7, .07, .12, wood);
    for (const x of [-4.8, -1.82, 1.82, 4.8]) box(scene, x, 2, -3.8, .15, 4, .16, wood);
    for (const x of [-4.8, 0, 4.8]) box(scene, x, 3.85, 0, .18, .26, 8, wood);
    box(scene, 0, .92, -3.8, 4, .16, .65, wood);
    box(scene, 0, 2.2, -3.91, .055, 2.6, .12, wood); box(scene, 0, 2.8, -3.91, 3.5, .055, .12, wood);
    const curtain = mat('#dfb893');
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      const fold = cylinder(scene, side * (1.5 + i * .08), 2.35, -3.57 + Math.sin(i * 1.8) * .04, .068, .052, 2.62, curtain); fold.scale.z = .6;
    }
    box(scene, 0, 3.7, -3.5, 4.15, .08, .08, brass);
    // Layered hills are geometry, visible through the window.
    const landscape = new THREE.Group(); scene.add(landscape);
    box(landscape, 0, -1.2, -19, 65, .1, 32, mat('#6dada9'));
    for (let i = 0; i < 12; i++) {
      const mountain = mesh(landscape, new THREE.ConeGeometry(3.2 + (i % 3), 5 + (i % 4), 5), mat(i % 2 ? '#98b5b1' : '#7eaaa4'), -22 + i * 4, -.6, -23 - (i % 2) * 5);
      mountain.rotation.y = i * .9;
      mesh(landscape, new THREE.ConeGeometry(1, 1.4, 5), paper, mountain.position.x, mountain.position.y + 2.6, mountain.position.z);
    }
    const cloud = mat('#f1e6d3');
    for (let i = 0; i < 6; i++) for (let puff = 0; puff < 3; puff++) {
      const c = sphere(landscape, -15 + i * 6 + puff * 1.1, 6.2 + i % 2 + (puff === 1 ? .3 : 0), -25, puff === 1 ? 1.05 : .8, cloud);
      c.scale.set(1.25, .65, 1); c.castShadow = false;
    }
    const sunMaterial = new THREE.MeshBasicMaterial({ color: '#ffe0a5' }); materials.add(sunMaterial);
    const sunDisk = sphere(landscape, 7, 5, -28, 1.4, sunMaterial); sunDisk.castShadow = false;
    // A woven circular rug anchors the small room.
    const rug = cylinder(scene, 0, .045, .4, 2.15, 2.15, .025, mat('#a0b6a0')); rug.scale.z = .77;
    const rugBorder = mesh(scene, new THREE.TorusGeometry(2.02, .026, 5, 64), paper, 0, .065, .4); rugBorder.rotation.x = Math.PI / 2; rugBorder.scale.y = .77;
    box(scene, -2.5, 1.06, -2.5, 2.9, .16, 1.25, wood);
    for (const x of [-3.75, -1.25]) for (const z of [-2.96, -2.04]) box(scene, x, .5, z, .12, 1, .12, darkWood);
    box(scene, -3.48, .68, -2.5, .7, .65, 1.05, wood);
    for (let i = 0; i < 3; i++) { box(scene, -3.48, .46 + i * .2, -1.965, .61, .16, .04, darkWood); sphere(scene, -3.48, .46 + i * .2, -1.925, .035, brass); }
    cylinder(scene, -3.5, 1.19, -2.7, .19, .24, .1, brass); cylinder(scene, -3.5, 1.5, -2.7, .035, .035, .62, brass);
    cylinder(scene, -3.5, 1.86, -2.7, .2, .39, .36, paper);
    box(scene, -2.9, 1.17, -2.15, .5, .04, .35, paper);
    box(scene, -4.56, 1.6, -.3, .65, 3.2, 3.4, darkWood);
    for (const z of [-1.96, 1.36]) box(scene, -4.3, 1.6, z, .8, 3.2, .12, wood);
    for (let j = 0; j < 5; j++) {
      box(scene, -4.3, .2 + j * .65, -.3, .8, .07, 3.4, wood);
      for (let i = 0; i < 8; i++) {
        const m = [teal, paper, brass, mat('#bc8371')][i % 4];
        box(scene, -4.17, .45 + j * .65, -1.65 + i * .35, .37, .36 + (i % 3) * .055, .15, m);
      }
    }
    // Sofa, tea table and soft cushions.
    box(scene, 3.25, .44, -2.5, 2.15, .5, 1.25, teal); box(scene, 3.25, .96, -3, 2.15, .85, .25, teal);
    for (const x of [2.26, 4.24]) box(scene, x, .73, -2.5, .25, .6, 1.25, teal);
    const cushion = box(scene, 3.9, .89, -2.75, .45, .42, .22, paper); cushion.rotation.z = -.2;
    const pillow = sphere(scene, 2.66, .91, -2.76, .28, mat('#d6a081')); pillow.scale.set(1.1, .9, .45); pillow.rotation.z = .18;
    box(scene, 3.25, .715, -2.45, 1.7, .16, .95, mat('#8eaea0'));
    box(scene, 3.63, .825, -2.17, .45, .055, .66, mat('#d3be95'));
    box(scene, 2.6, .57, -.9, 1.3, .12, .75, wood);
    for (const x of [2.08, 3.12]) for (const z of [-1.18, -.62]) box(scene, x, .3, z, .08, .6, .08, darkWood);
    cylinder(scene, 2.65, .71, -.9, .095, .075, .16, paper);
    mesh(scene, new THREE.TorusGeometry(.065, .018, 6, 16), paper, 2.755, .72, -.9);
    cylinder(scene, 2.33, .658, -.85, .16, .16, .03, brass); sphere(scene, 2.33, .73, -.85, .085, mat('#c9975f'));
    // A tangible tomorrow board; HTML supplies its full readable text.
    const board = new THREE.Group(); board.userData = { target: 'goal', label: 'Один шаг на завтра' }; scene.add(board);
    box(board, 3.15, 2.45, -3.79, 1.55, 1.05, .1, wood); box(board, 3.15, 2.45, -3.72, 1.4, .9, .04, mat('#677c67'));
    for (let i = 0; i < 3; i++) box(board, 2.77 + i * .38, 2.46 + (i % 2) * .12, -3.675, .28, .31, .025, paper);
    const residents = new THREE.Group(); scene.add(residents);
    const people: THREE.Group[] = [];
    const faces: { eyes: THREE.Mesh[]; mouth: THREE.Mesh; head: THREE.Group; arms: THREE.Group[]; resting: number }[] = [];
    for (const [index, id] of (Object.keys(RESIDENTS) as (keyof typeof RESIDENTS)[]).entries()) {
      const group = new THREE.Group(); const spots = [[-3.4, 1.5], [2.5, .7], [.8, -2.7]];
      group.position.set(spots[index][0], 0, spots[index][1]); group.rotation.y = [.65, -.8, 0][index];
      group.userData = { target: `resident:${id}`, label: RESIDENTS[id].name }; residents.add(group); people.push(group);
      const shirt = mat(RESIDENTS[id].color), skin = mat('#dfb594'), hair = mat(['#584d60', '#795c41', '#6b4235'][index]);
      cylinder(group, 0, .69, 0, .18, .24, .55, shirt);
      for (const x of [-.105, .105]) { box(group, x, .24, 0, .13, .4, .16, darkWood); box(group, x, .07, .06, .16, .12, .27, darkWood); }
      const head = new THREE.Group(); head.position.y = 1.17; group.add(head);
      sphere(head, 0, 0, 0, .29, skin); const cap = sphere(head, 0, .19, -.04, .28, hair); cap.scale.y = .52;
      for (let t = 0; t < 4; t++) { const tuft = sphere(head, -.17 + t * .105, .2 + Math.sin(t + index) * .025, .12, .095, hair); tuft.scale.set(1.1, .6, 1); }
      for (const x of [-.285, .285]) { const ear = sphere(head, x, -.015, -.01, .062, skin); ear.scale.set(.75, 1.1, .75); }
      const eyes: THREE.Mesh[] = [];
      for (const x of [-.105, .105]) {
        const white = sphere(head, x, .028, .26, .045, paper); white.scale.set(1, 1.3, .45);
        const pupil = sphere(head, x, .025, .285, .024, darkWood); eyes.push(white, pupil);
        const brow = box(head, x, .112, .257, .09, .024, .028, hair); brow.rotation.z = index === 0 ? x * 1.3 : -x * .6;
      }
      sphere(head, 0, -.03, .29, .042, skin);
      const mouth = sphere(head, 0, -.123, .257, .038, darkWood); mouth.scale.set(1, .25, .3);
      const arms: THREE.Group[] = [];
      for (const x of [-.255, .255]) { const arm = new THREE.Group(); group.add(arm); arm.position.set(x, .87, 0); arm.rotation.z = x > 0 ? .12 : -.12; cylinder(arm, 0, -.13, 0, .075, .065, .31, shirt); cylinder(arm, 0, -.295, 0, .068, .065, .055, paper); sphere(arm, 0, -.36, .025, .077, skin); arms.push(arm); }
      if (index === 0) { for (const x of [-.105, .105]) mesh(head, new THREE.TorusGeometry(.072, .012, 6, 20), brass, x, .028, .29); box(head, 0, .028, .29, .055, .012, .014, brass); }
      if (index === 2) { box(group, 0, .97, .05, .32, .085, .34, paper); const scarf = box(group, -.095, .79, .195, .12, .3, .05, paper); scarf.rotation.z = -.13; }
      if (index === 1) { box(group, 0, .71, .195, .27, .27, .045, paper); box(group, .08, .81, .225, .05, .15, .02, brass); }
      for (let b = 0; b < 3; b++) sphere(group, 0, .57 + b * .12, .206, .018, brass);
      faces.push({ eyes, mouth, head, arms, resting: group.rotation.y });
    }
    const memories = new THREE.Group(); scene.add(memories);
    const dynamicGeometry = new Set<THREE.BufferGeometry>(), dynamicMaterial = new Set<THREE.Material>();
    const clearMemories = () => {
      for (const g of dynamicGeometry) { g.dispose(); geometries.delete(g); } dynamicGeometry.clear();
      for (const m of dynamicMaterial) { m.dispose(); materials.delete(m); } dynamicMaterial.clear(); memories.clear();
    };
    const slots = [[-2.25, 1.15, -2.6], [-1.38, 1.15, -2.62], [-3.32, 2.55, -3.55], [-2.38, 2.55, -3.55], [3.9, 1.85, -3.55], [2.6, 1.85, -3.55]];
    box(scene, -2.85, 2.48, -3.6, 2.1, .09, .6, wood); box(scene, 3.25, 1.78, -3.6, 2.2, .09, .6, wood);
    const rainPositions = new Float32Array(220 * 3); for (let i = 0; i < 220; i++) { rainPositions[i * 3] = Math.sin(i * 3.7) * 6; rainPositions[i * 3 + 1] = (i % 37) * .18; rainPositions[i * 3 + 2] = -5 - (i % 11) * .6; }
    const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3)); geometries.add(rainGeo);
    const rainMat = new THREE.PointsMaterial({ color: '#e6f1eb', size: .034, transparent: true, opacity: .7 }); materials.add(rainMat);
    const rain = new THREE.Points(rainGeo, rainMat); scene.add(rain);
    // Merge only immutable, non-interactive siblings. Characters, memories and
    // the board keep their own transforms and hit targets.
    const batchStatic = (parent: THREE.Object3D) => {
      const groups = new Map<THREE.Material, THREE.Mesh[]>();
      for (const object of parent.children) if (object instanceof THREE.Mesh && !Array.isArray(object.material) && !object.userData.target) {
        const siblings = groups.get(object.material) ?? []; siblings.push(object); groups.set(object.material, siblings);
      }
      for (const [material, objects] of groups) {
        if (objects.length < 2) continue;
        const parts = objects.map(object => { object.updateMatrix(); let part = object.geometry.clone(); if (part.index) { const expanded = part.toNonIndexed(); part.dispose(); part = expanded; } part.applyMatrix4(object.matrix); return part; });
        const geometry = mergeGeometries(parts); parts.forEach(p => p.dispose()); if (!geometry) continue;
        geometries.add(geometry); const merged = new THREE.Mesh(geometry, material); merged.castShadow = objects.some(o => o.castShadow); merged.receiveShadow = objects.some(o => o.receiveShadow); parent.add(merged);
        for (const object of objects) { parent.remove(object); object.geometry.dispose(); geometries.delete(object.geometry); }
      }
    };
    batchStatic(scene); people.forEach(batchStatic);
    buildingStatic = false;
    const update = (next: RoomState) => {
      atmosphere = next.atmosphere; rain.visible = atmosphere === 'rain'; sunDisk.visible = atmosphere !== 'rain';
      scene.background = new THREE.Color(atmosphere === 'rain' ? '#9dacb9' : atmosphere === 'sun' ? '#b8dad7' : '#ecc2a7');
      sun.intensity = atmosphere === 'rain' ? .65 : atmosphere === 'sun' ? 2.8 : 2.2;
      sun.color.set(atmosphere === 'sun' ? '#fff1d1' : '#ffd09a'); warm.intensity = atmosphere === 'rain' ? 18 : 12;
      renderer.shadowMap.needsUpdate = true;
      const signature = JSON.stringify(activeMemories(next).map(e => [e.id, e.kind, e.title]));
      if (signature === memorySignature) return;
      memorySignature = signature;
      clearMemories(); const beforeGeo = new Set(geometries), beforeMat = new Set(materials);
      activeMemories(next).forEach((entry, i) => {
        const group = new THREE.Group(); group.position.set(...slots[i] as [number, number, number]); group.userData = { target: `memory:${entry.id}`, label: entry.title }; memories.add(group);
        const color = mat(CATALOG[entry.kind].color);
        if (entry.kind === 'model') {
          box(group, 0, .04, 0, .58, .08, .43, brass);
          box(group, -.1, .2, 0, .24, .27, .24, paper); box(group, .14, .28, -.04, .18, .44, .19, color);
          mesh(group, new THREE.ConeGeometry(.17, .23, 4), teal, .14, .61, -.04).rotation.y = Math.PI / 4;
        } else if (entry.kind === 'book') {
          const book = box(group, 0, .23, 0, .36, .46, .13, color); book.rotation.z = -.1;
          box(group, .015, .23, -.005, .32, .41, .135, paper); box(group, -.17, .23, .01, .055, .46, .17, color);
        } else if (entry.kind === 'plant') {
          cylinder(group, 0, .14, 0, .18, .12, .28, color);
          cylinder(group, 0, .37, 0, .022, .022, .38, teal);
          for (let j = 0; j < 5; j++) { const leaf = sphere(group, Math.sin(j * 2.4) * .13, .37 + j * .055, Math.cos(j * 2.4) * .1, .11, teal); leaf.scale.set(1.6, .55, 1); leaf.rotation.z = j; }
        } else if (entry.kind === 'compass') {
          cylinder(group, 0, .045, 0, .22, .22, .09, brass);
          const ring = mesh(group, new THREE.TorusGeometry(.22, .025, 8, 32), brass, 0, .32, 0); ring.rotation.y = .35;
          const needle = mesh(group, new THREE.ConeGeometry(.055, .3, 4), color, 0, .32, 0); needle.rotation.z = -.45;
        } else {
          box(group, 0, .24, 0, .52, .48, .06, color); box(group, 0, .24, .04, .43, .39, .025, paper);
          sphere(group, .08, .31, .065, .055, brass); box(group, -.02, .17, .065, .3, .075, .02, teal);
        }
      });
      for (const g of geometries) if (!beforeGeo.has(g)) dynamicGeometry.add(g);
      for (const m of materials) if (!beforeMat.has(m)) dynamicMaterial.add(m);
    };
    update(initial.current);
    const raycaster = new THREE.Raycaster();
    const pick = (x = 0, y = 0) => {
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        if (hit.distance > 12) return null;
        if (!(hit.object instanceof THREE.Mesh)) continue;
        let object: THREE.Object3D | null = hit.object;
        while (object) { if (object.userData.target) return object.userData as { target: string; label: string }; object = object.parent; }
        return null; // A wall or furnishing occludes anything behind it.
      }
      return null;
    };
    const canvas = renderer.domElement;
    const down = (e: PointerEvent) => { if (pausedRef.current || e.button !== 0) return; canvas.focus(); drag = { x: e.clientX, y: e.clientY, total: 0, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!drag || pausedRef.current) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.total += Math.abs(dx) + Math.abs(dy); yaw -= dx * .004; pitch = THREE.MathUtils.clamp(pitch - dy * .003, -.95, .95); drag.x = e.clientX; drag.y = e.clientY; };
    const up = (e: PointerEvent) => { if (!drag) return; const clicked = drag.total < 7; drag = null; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); if (clicked && !pausedRef.current) { const r = canvas.getBoundingClientRect(); const result = pick((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); if (result) selectRef.current(result.target); } };
    const stop = () => { keys.current.clear(); if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id); drag = null; };
    const keydown = (e: KeyboardEvent) => {
      if (pausedRef.current || document.activeElement !== canvas) return;
      if (e.code === 'Escape') { stop(); canvas.blur(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyE'].includes(e.code)) { e.preventDefault(); keys.current.add(e.code); }
      if (e.code === 'KeyE' && !e.repeat && hovered) selectRef.current(hovered);
    };
    const keyup = (e: KeyboardEvent) => keys.current.delete(e.code);
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', stop); canvas.addEventListener('blur', stop);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', stop);
    const contextLost = (e: Event) => { e.preventDefault(); active = false; stop(); setError('Графический контекст потерян. Перезагрузи страницу; записи сохранены. Кнопки воспоминаний и чатов продолжают работать.'); };
    canvas.addEventListener('webglcontextlost', contextLost);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick); const elapsed = now - last, dt = Math.min(elapsed / 1000, .04); last = now;
      if (!active || document.hidden) return;
      const cpuStart = performance.now();
      const nextFocus = speechRef.current?.resident ?? null;
      if (focused !== nextFocus) {
        if (nextFocus) {
          if (!focused) returnView = { position: camera.position.clone(), yaw, pitch };
          const person = people[(Object.keys(RESIDENTS) as Resident[]).indexOf(nextFocus)];
          const safe = conversationView({ x: camera.position.x, z: camera.position.z }, person.position);
          const distance = Math.hypot(person.position.x - safe.x, person.position.z - safe.z);
          focusView = { position: new THREE.Vector3(safe.x, 1.65, safe.z), yaw: Math.atan2(safe.x - person.position.x, safe.z - person.position.z), pitch: Math.atan2(1.0 - 1.65, distance) };
        } else if (returnView) { focusView = returnView; returnView = null; }
        focused = nextFocus; keys.current.clear();
      }
      if (focusView) {
        const blend = reduced.matches ? 1 : 1 - Math.exp(-dt * 6);
        camera.position.lerp(focusView.position, blend);
        yaw += Math.atan2(Math.sin(focusView.yaw - yaw), Math.cos(focusView.yaw - yaw)) * blend;
        pitch += (focusView.pitch - pitch) * blend;
        if (!focused && camera.position.distanceToSquared(focusView.position) < .0001) focusView = null;
      }
      if (!pausedRef.current) {
        const k = keys.current; yaw += ((k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0)) * dt * 1.5;
        pitch = THREE.MathUtils.clamp(pitch + ((k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0)) * dt, -.95, .95);
        let forward = Number(k.has('KeyW')) - Number(k.has('KeyS')), right = Number(k.has('KeyD')) - Number(k.has('KeyA'));
        const length = Math.hypot(forward, right); if (length) { forward /= length; right /= length; }
        const p = movePlayer(camera.position.x, camera.position.z, (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * dt * 2, (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * dt * 2);
        camera.position.x = p.x; camera.position.z = p.z;
      }
      camera.rotation.set(pitch, yaw, 0); camera.updateMatrixWorld();
      people.forEach((person, i) => {
        const speaking = nextFocus === (Object.keys(RESIDENTS) as Resident[])[i], face = faces[i];
        const desired = speaking ? Math.atan2(camera.position.x - person.position.x, camera.position.z - person.position.z) : face.resting;
        person.rotation.y += Math.atan2(Math.sin(desired - person.rotation.y), Math.cos(desired - person.rotation.y)) * (reduced.matches ? 1 : 1 - Math.exp(-dt * 4));
        if (!reduced.matches) {
          person.position.y = Math.sin(now * .0018 + i * 2) * .007;
          const blink = Math.sin(now * .001 + i * 2.7) > .995;
          face.eyes.forEach((eye, index) => { eye.scale.y = blink ? .08 : index % 2 === 0 ? 1.3 : 1; });
          face.head.rotation.z = Math.sin(now * .0009 + i) * (speaking ? .035 : .012);
          face.mouth.scale.y = speaking && bubble.current?.firstElementChild?.getAttribute('data-speaking') === 'true' ? .4 + Math.abs(Math.sin(now * .009)) * .45 : .25;
          face.arms.forEach((arm, a) => { arm.rotation.x = speaking ? -.22 + Math.sin(now * .002 + a * 2) * .12 : Math.sin(now * .001 + i) * .025; });
        }
      });
      if (!reduced.matches && rain.visible) { for (let i = 1; i < rainPositions.length; i += 3) { rainPositions[i] -= dt * 3.5; if (rainPositions[i] < -.5) rainPositions[i] = 6; } rainGeo.attributes.position.needsUpdate = true; }
      if (now - lastPick > 90) {
        const result = pausedRef.current ? null : pick(); hovered = result?.target || ''; const label = result?.label || '';
        if (label !== hoveredLabel) { hoveredLabel = label; setTarget(label); } lastPick = now;
      }
      if (focused && bubble.current) {
        const person = people[(Object.keys(RESIDENTS) as Resident[]).indexOf(focused)];
        const point = new THREE.Vector3(person.position.x, 1.62, person.position.z).project(camera);
        const position = bubblePosition((point.x * .5 + .5) * el.clientWidth, (-point.y * .5 + .5) * el.clientHeight, el.clientWidth, el.clientHeight, bubble.current.offsetWidth, bubble.current.offsetHeight);
        bubble.current.style.left = `${position.x}px`; bubble.current.style.top = `${position.y}px`;
      }
      if (now - lastShadow > 250 && !reduced.matches) { renderer.shadowMap.needsUpdate = true; lastShadow = now; }
      renderer.render(scene, camera);
      if (!canvas.dataset.roomRendered) canvas.dataset.roomRendered = 'true';
      cpuTotal += performance.now() - cpuStart; frameTotal += elapsed; frameCount++;
      const scale = budget.sample(elapsed); if (scale !== null) { renderer.setPixelRatio(scale); resize(); }
      if (process.env.NODE_ENV === 'development' && now - lastDiagnostic > 500) { canvas.dataset.cameraX = camera.position.x.toFixed(3); canvas.dataset.cameraZ = camera.position.z.toFixed(3); canvas.dataset.drawCalls = String(renderer.info.render.calls); canvas.dataset.triangles = String(renderer.info.render.triangles); canvas.dataset.fps = (frameCount * 1000 / frameTotal).toFixed(1); canvas.dataset.cpuMs = (cpuTotal / frameCount).toFixed(2); canvas.dataset.pixelRatio = budget.scale.toFixed(2); canvas.dataset.focusedResident = focused ?? ''; frameTotal = 0; frameCount = 0; cpuTotal = 0; lastDiagnostic = now; }
    };
    api.current = { update, stop, home: () => { camera.position.set(0, 1.65, 3.1); yaw = 0; pitch = -.06; stop(); } };
    setReady(true); frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame); api.current = null; stop(); observer.disconnect();
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', stop);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', stop); canvas.removeEventListener('blur', stop); canvas.removeEventListener('webglcontextlost', contextLost);
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); canvas.remove();
    };
  }, []);
  const control = (code: string, label: string, icon: string) => <button aria-label={label} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); keys.current.add(code); }} onPointerUp={() => keys.current.delete(code)} onPointerCancel={() => keys.current.delete(code)} onLostPointerCapture={() => keys.current.delete(code)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); keys.current.add(code); } }} onKeyUp={() => keys.current.delete(code)} onBlur={() => keys.current.delete(code)}>{icon}</button>;
  return <div className={`${styles.scene} ${speech ? styles.conversationScene : ''}`}>
    <div ref={mount} className={styles.canvas}/>
    {!ready && !error && <div className={styles.loading}>Открываем окна твоего кабинета…</div>}
    {error && <div className={styles.sceneError} role="status">{error}</div>}
    {!speech && <><span className={styles.crosshair} aria-hidden="true">+</span><div className={styles.sceneCaption}><span>ТВОЁ МЕСТО В МИРЕ</span><strong>Комната, которая помнит.</strong></div></>}
    {speech && <div ref={bubble} className={styles.speechAnchor}><RoomSpeech speech={speech}/></div>}
    {children}
    {!paused && ready && <><button className={styles.homeCamera} onClick={() => api.current?.home()} aria-label="Вернуться ко входу">↺</button><div className={styles.interact}><span>{target ? `${target} · нажми на предмет или E` : 'Потяни экран, чтобы осмотреться'}</span></div><div className={styles.walkPad}>{control('KeyW', 'Идти вперёд', '↑')}<div>{control('KeyA', 'Идти влево', '←')}{control('KeyS', 'Идти назад', '↓')}{control('KeyD', 'Идти вправо', '→')}</div></div></>}
  </div>;
}
