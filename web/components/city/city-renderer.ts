import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DISTRICTS, levelOf, population, randomFrom, type City, type DistrictId } from './city-state';

export type CityRenderer = { update: (city: City) => void; select: (id: DistrictId | null) => void; camera: (action: 'in' | 'out' | 'left' | 'right' | 'home') => void; dispose: () => void };

export function createCityRenderer(host: HTMLDivElement, initial: City, reduced: boolean, labelClass: string, onSelect: (id: DistrictId) => void, onError: () => void): CityRenderer {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setClearColor('#bdd4cf'); renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Живой город. Перетаскивай для поворота, используй колесо или две точки касания для масштаба.');
  renderer.domElement.setAttribute('role', 'img'); host.appendChild(renderer.domElement);
  const scene = new T.Scene(); scene.fog = new T.Fog('#bdd4cf', 65, 140);
  const camera = new T.OrthographicCamera(-24, 24, 24, -24, .1, 250);
  camera.position.set(33, 35, 42); camera.zoom = 1.12;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, -2); controls.enableDamping = !reduced; controls.dampingFactor = .08;
  controls.enablePan = false; controls.minZoom = .65; controls.maxZoom = 2.6;
  controls.minPolarAngle = .3; controls.maxPolarAngle = 1.25; controls.rotateSpeed = .5;
  controls.touches.ONE = T.TOUCH.ROTATE; controls.touches.TWO = T.TOUCH.DOLLY_ROTATE;
  const ambient = new T.HemisphereLight('#d4edff', '#91bddd', 1.7); scene.add(ambient);
  const sun = new T.DirectionalLight('#fff3d8', 2.5); sun.position.set(-25, 45, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 100 }); sun.shadow.bias = -.0005; sun.shadow.normalBias = .05; scene.add(sun);
  const world = new T.Group(); scene.add(world);
  const geometries = new Map<string, T.BufferGeometry>(), materials = new Map<string, T.Material>(), textures: T.Texture[] = [];
  let city = initial, signature = '', tick = 0, frame = 0, last = performance.now(), disposed = false;
  let selected: DistrictId | null = null;
  let random = randomFrom(city.seed);
  const animations: ((t: number) => void)[] = [];
  const buildingHeights = new Map<DistrictId, number>();
  const constructionStarted = new Map<DistrictId, number>();
  const labels = DISTRICTS.map(d => {
    const el = document.createElement('button'); el.className = labelClass; el.textContent = d.building; el.setAttribute('aria-label', `Выбрать: ${d.building}`);
    el.style.setProperty('--district-color', d.color); el.addEventListener('click', () => onSelect(d.id)); host.appendChild(el); return { el, d };
  });
  const geometry = (key: string, factory: () => T.BufferGeometry) => { if (!geometries.has(key)) geometries.set(key, factory()); return geometries.get(key)!; };
  const gradient = new T.DataTexture(new Uint8Array([80,80,80,255,155,155,155,255,220,220,220,255,255,255,255,255]), 4, 1); gradient.minFilter = T.NearestFilter; gradient.magFilter = T.NearestFilter; gradient.needsUpdate = true; textures.push(gradient);
  const material = (color: string, glow = false) => { const key = color + glow; if (!materials.has(key)) materials.set(key, new T.MeshToonMaterial({ color, gradientMap: gradient, ...(glow ? { emissive: color, emissiveIntensity: .18 } : {}) })); return materials.get(key)!; };
  function mesh(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number) { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; }
  function box(p: T.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, c: string, glow = false) { const o = mesh(p, geometry('box', () => new T.BoxGeometry()), material(c, glow), x, y, z); o.scale.set(w, h, d); return o; }
  function rounded(p: T.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, c: string) { const o = mesh(p, geometry('rounded', () => new RoundedBoxGeometry(1, 1, 1, 2, .065)), material(c), x, y, z); o.scale.set(w,h,d); return o; }
  function cylinder(p: T.Object3D, x: number, y: number, z: number, r: number, h: number, c: string, top = r, sides = 20) { return mesh(p, geometry(`c${r},${h},${top},${sides}`, () => new T.CylinderGeometry(top, r, h, sides)), material(c), x, y, z); }
  function ball(p: T.Object3D, x: number, y: number, z: number, r: number, c: string) { const o = mesh(p, geometry('ball', () => new T.SphereGeometry(1, 12, 10)), material(c), x, y, z); o.scale.setScalar(r); return o; }
  function beam(p: T.Object3D, a: number[], b: number[], width: number, color: string) { const start = new T.Vector3(...a), end = new T.Vector3(...b); const o = box(p, 0, 0, 0, width, start.distanceTo(end), width, color); o.position.copy(start).add(end).multiplyScalar(.5); o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), end.sub(start).normalize()); return o; }
  function sign(p: T.Object3D, text: string, x: number, y: number, z: number, w: number, color = '#345864') {
    const key = `sign-${text}-${color}`;
    if (!materials.has(key)) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#f9f1dd'; ctx.fillRect(0, 0, 512, 128); ctx.fillStyle = color; ctx.font = 'bold 50px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 67, 480);
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; textures.push(texture); materials.set(key, new T.MeshBasicMaterial({ map: texture }));
    }
    const m = mesh(p, geometry('sign', () => new T.PlaneGeometry(1, 1)), materials.get(key)!, x, y, z); m.scale.set(w, w / 4, 1);
  }
  function tree(p: T.Object3D, x: number, z: number, size = 1) {
    const g = new T.Group(); g.position.set(x, .6, z); g.scale.setScalar(size); p.add(g);
    cylinder(g, 0, .6, 0, .11, 1.2, '#8c7756');
    const colors = city.biome === 'autumn' ? ['#ffb52e', '#f87c43', '#e8ce44'] : city.biome === 'alpine' ? ['#2aaf84', '#38c8a2', '#6bddb8'] : ['#71cd38', '#2dbb79', '#a1dc35'];
    const crown = ball(g, 0, 1.7, 0, .95, colors[Math.floor(random() * colors.length)]); crown.scale.y *= 1.2;
    ball(g, .5, 1.4, .15, .63, colors[0]); ball(g, -.45, 1.45, -.15, .56, colors[1]);
    const phase = random() * 6; animations.push(t => { crown.rotation.z = Math.sin(t * .7 + phase) * .035; });
  }
  function windows(p: T.Object3D, w: number, h: number, depth: number, damage: number) {
    for (let floor = 1; floor < h - .35; floor += .9) for (let col = -w / 2 + .5; col < w / 2 - .15; col += .85) {
      const c = damage > 40 && random() > .35 ? '#465451' : '#9feafa';
      box(p, col, floor, depth / 2 + .035, .49, .5, .045, c, c !== '#465451');
      box(p, w / 2 + .035, floor, col * depth / w, .045, .5, .49, c);
    }
  }
  function home(p: T.Object3D, x: number, z: number, scale: number, color = '#ece0c6') {
    const g = new T.Group(); g.position.set(x, .65, z); g.scale.setScalar(scale); p.add(g);
    rounded(g, 0, .8, 0, 1.4, 1.6, 1.4, color); windows(g, 1.4, 1.65, 1.4, 0);
    const roof = cylinder(g, 0, 1.9, 0, 1.15, .75, '#ff7458', 0, 4); roof.rotation.y = Math.PI / 4;
    box(g, -.25, .35, .73, .3, .7, .08, '#6d847c');
  }
  function scaffold(p: T.Object3D, w: number, h: number, d: number) {
    for (const x of [-w / 2 - .3, w / 2 + .3]) for (const z of [-d / 2 - .3, d / 2 + .3]) box(p, x, h / 2, z, .08, h, .08, '#bc975e');
    for (let y = .7; y < h; y += 1) { box(p, 0, y, d / 2 + .3, w + .7, .07, .4, '#caaa78'); beam(p, [-w / 2 - .3, y - .65, d / 2 + .3], [w / 2 + .3, y, d / 2 + .3], .055, '#b39460'); }
  }
  function person(p: T.Object3D, color: string, builder = false) {
    const g = new T.Group(); p.add(g); box(g, 0, .42, 0, .22, .3, .15, color);
    ball(g, 0, .73, 0, .19, '#ffd0a1');
    ball(g, -.065, .76, .165, .025, '#353055'); ball(g, .065, .76, .165, .025, '#353055');
    if (builder) cylinder(g, 0, .88, 0, .22, .1, '#ffca30');
    const l = box(g, -.07, .15, 0, .065, .28, .08, '#465662'), r = box(g, .07, .15, 0, .065, .28, .08, '#465662');
    const a = box(g, -.17, .42, 0, .06, .25, .07, color), b = box(g, .17, .42, 0, .06, .25, .07, color);
    return { g, l, r, a, b };
  }
  function district(id: DistrictId) {
    const def = DISTRICTS.find(d => d.id === id)!, state = city.districts[id], level = levelOf(state), damage = state.damage;
    const constructing = city.game.jobs.some(j => j.district === id);
    const g = new T.Group(); g.position.set(def.x, .65, def.z); g.userData.districtId = id; world.add(g);
    if (!reduced && constructionStarted.has(id)) { const start = constructionStarted.get(id)!; animations.push(t => { const progress = T.MathUtils.clamp((t - start) / 2.2, 0, 1); g.scale.y = .08 + .92 * (1 - Math.pow(1 - progress, 3)); }); }
    rounded(g, 0, -.04, 0, 5.8, .22, 5.8, '#fff0d5');
    rounded(g, 0, .09, 0, 5.5, .06, 5.5, '#92d34e');
    if (constructing) {
      const marker = cylinder(g, 0, .15, 0, 3, .035, '#ffe362', 3, 40);
      animations.push(t => { marker.scale.x = marker.scale.z = 1 + Math.sin(t * 2) * .025; });
      const builder = person(g, '#ffa225', true); builder.g.position.set(1.9, .2, 2.2);
      animations.push(t => { builder.a.rotation.x = -1 + Math.sin(t * 6) * .9; });
    }
    if (!level) {
      box(g, 0, .15, 0, 3.6, .09, 3.3, '#bcac8e');
      for (const x of [-2, 2]) for (const z of [-2, 2]) box(g, x, .5, z, .1, .8, .1, '#f2ecd8');
      for (let i = 0; i < 5; i++) box(g, -1.4 + i * .4, .28, .8, .25, .2, 1.3, '#b58f62');
      if (constructing) { scaffold(g, 3.6, 2.5, 3.3); rounded(g, 0, .55, 0, 3.2, .9, 2.8, '#ffcc69'); }
      sign(g, def.building.toUpperCase(), 0, 1, 1.4, 2.6); buildingHeights.set(id, 1.8); return;
    }
    const colors: Record<DistrictId, string> = { sport: '#ff9861', health: '#63d8c3', career: '#579deb', knowledge: '#ffca5a', social: '#bf8bed', travel: '#78cdec', sleep: '#a89bed' };
    const facade = damage >= 70 ? '#9997a6' : colors[id];
    let h = 1.5 + level * .65, w = 3.8, depth = 3.4;
    if (id === 'career') { h = 2.5 + level * 1.1; w = 3; depth = 3; }
    if (id === 'social') h = 1.5 + level * .35;
    if (id === 'travel') { h = 2; w = 4; depth = 2.2; }
    rounded(g, 0, h / 2 + .15, 0, w, h, depth, facade);
    windows(g, w, h, depth, damage);
    const rooftop = rounded(g, 0, h + .2, 0, w + .35, .35, depth + .35, id === 'social' ? '#864adc' : '#fff6e3');
    if (damage >= 70) { rooftop.rotation.z = -.13; rooftop.position.y -= .25; }
    box(g, 0, .55, depth / 2 + .08, .65, .9, .12, '#4f797d');
    box(g, 0, .18, depth / 2 + .4, 1.4, .25, .75, '#f5ecd9');
    sign(g, def.building.toUpperCase(), 0, h - .4, depth / 2 + .08, w - .4, def.color);
    if (id === 'sport') {
      const bar = cylinder(g, 0, h + 1, 0, .12, 2.6, '#6850a7'); bar.rotation.z = Math.PI / 2;
      for (const x of [-1.1, 1.1]) { const weight = cylinder(g, x, h + 1, 0, .5, .4, '#6253af'); weight.rotation.z = Math.PI / 2; }
      box(g, 0, .2, 2.3, 4.9, .07, .7, '#c88f6c');
    } else if (id === 'health') {
      rounded(g, 0, h + 1, 0, .42, 1.7, .4, '#ff6d7a'); rounded(g, 0, h + 1, 0, 1.6, .42, .4, '#ff6d7a');
      const ambulance = box(g, -1.4, .4, 2.3, 1, .5, .48, '#fbf1d8'); box(ambulance, 0, .55, 0, .25, .17, .5, '#ce7967');
    } else if (id === 'career') {
      box(g, 0, h + .55, 0, 1.9, .7, 2, '#71929a'); beam(g, [0, h + .9, 0], [0, h + 2, 0], .07, '#e1dbbe');
      for (let x = -1.5; x <= 1.5; x += .5) box(g, x, h / 2, 1.53, .045, h, .06, '#d1dacb');
    } else if (id === 'knowledge') {
      const dome = mesh(g, geometry('dome', () => new T.SphereGeometry(1.45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), material('#6f7ee8'), 0, h + .3, 0);
      const telescope = cylinder(dome, 0, .7, .6, .18, 1.4, '#e2d8b7'); telescope.rotation.x = Math.PI / 3;
      cylinder(g, -2.2, .5, 1.8, .3, .7, '#d8c88f');
    } else if (id === 'social') {
      for (let i = -2; i <= 2; i++) { ball(g, i * .7, h + .5, 1.6, .085, '#e7bb8b'); cylinder(g, i * .8, .55, 2.3, .23, .08, '#bb8b70'); }
      sign(g, 'SOCIAL CLUB', 0, h + .75, .1, 2.5, '#a1729e');
      box(g, 0, h + .34, 0, 3.3, .09, 2.7, '#85798e');
    } else if (id === 'travel') {
      box(g, 2.1, 1.8, -.1, .5, 3.6, .5, '#f3e6cb'); box(g, 2.1, 3.4, -.1, 1.1, .7, 1, '#8aacb0');
      box(g, 0, .2, 2, 5.2, .05, 1.1, '#849790');
      for (let i = -2; i <= 2; i++) box(g, i, .24, 2, .4, .02, .05, '#f4edcf');
      const plane = new T.Group(); g.add(plane); box(plane, 0, 0, 0, 1.6, .17, .2, '#f5ead8'); box(plane, 0, .04, 0, .4, .07, 1.3, '#eee5ce'); box(plane, -.6, .15, 0, .27, .25, .06, '#71959a');
      animations.push(t => { const phase = (t * .035) % 1; plane.position.set(-2 + phase * 4, phase > .7 ? .5 + (phase - .7) * 9 : .5, 2); });
    } else if (id === 'sleep') {
      const roof = cylinder(g, 0, h + .75, 0, 2.9, 1.6, '#7758d8', 0, 4); roof.rotation.y = Math.PI / 4;
      ball(g, 0, h + 1.8, 0, .52, '#ffdb61');
      if (level > 2) { home(g, -2.2, -1.7, .7); home(g, 2.2, -1.7, .7); }
    }
    if (level >= 3) { tree(g, -2.3, 2, .6); tree(g, 2.3, -2, .6); }
    if (level >= 4) for (let i = -1; i <= 1; i++) { box(g, i, h + .37, -depth / 2 + .2, .65, .2, .4, '#c4ac83'); ball(g, i, h + .6, -depth / 2 + .2, .3, '#7a9e76'); }
    if (level === 1 || damage > 0 || constructing) scaffold(g, w, h + .8, depth);
    if (level === 1 || constructing) {
      const crane = new T.Group(); crane.position.set(-2.4, 0, -2); g.add(crane); box(crane, 0, 2.4, 0, .16, 4.8, .16, '#d4ad61');
      const arm = new T.Group(); arm.position.y = 4.7; crane.add(arm); box(arm, 1, 0, 0, 3.5, .14, .14, '#d4ad61'); beam(arm, [2.5, 0, 0], [2.5, -2, 0], .025, '#5c6a65'); animations.push(t => { arm.rotation.y = Math.sin(t * .16) * .5; });
    }
    if (damage >= 40) {
      beam(g, [.8, h - .2, depth / 2 + .09], [.4, h * .6, depth / 2 + .09], .075, '#6b7164');
      beam(g, [.4, h * .6, depth / 2 + .09], [1, h * .3, depth / 2 + .09], .075, '#6b7164');
      for (let i = 0; i < 10; i++) { const rubble = box(g, (random() - .5) * 4.7, .3, 1.9 + random() * .7, .25 + random() * .3, .25, .3, '#a99c82'); rubble.rotation.set(random(), random(), random()); }
      const brick = box(g, 1.7, h, depth / 2 + .25, .35, .3, .3, '#b49a76');
      const splash = cylinder(g, 1.7, .28, depth / 2 + .4, .5, .015, '#c2dfd5');
      animations.push(t => { const cycle = (t + def.x) % 11; brick.visible = cycle > 0 && cycle < 2; brick.position.y = Math.max(.3, h - cycle * cycle * 2); brick.rotation.x = cycle * 2; const fall = Math.sqrt((h - .3) / 2); splash.visible = cycle > fall && cycle < fall + .8; splash.scale.setScalar(1 + Math.max(0, cycle - fall) * 2); });
    }
    if (damage >= 70) {
      if (id === 'sleep' || id === 'health') {
        const flood = box(g, 0, .26, 0, 5.7, .08, 5.7, '#83b9b5'); animations.push(t => { flood.position.y = .28 + Math.sin(t * 1.4) * .045; });
      }
      for (let i = 0; i < 6; i++) {
        const flame = cylinder(g, .7 + random(), h + .4, .4 + random(), .25, .8, i % 2 ? '#efaf59' : '#e58145', 0, 5);
        const smoke = ball(g, 1 + random(), h + 1.5 + i * .3, .7, .45 + i * .1, '#75827b');
        animations.push(t => { flame.scale.y = .6 + Math.sin(t * 7 + i) * .25; smoke.position.y = h + 1 + ((t * .5 + i * .45) % 3); smoke.position.x = 1 + Math.sin(t + i) * .3; smoke.scale.setScalar(.4 + ((t * .5 + i * .45) % 3) * .25); });
      }
    }
    buildingHeights.set(id, h + (id === 'sleep' ? 2 : 1.7));
    if (damage > 0 || level === 1 || constructing) {
      const worker = person(g, '#d3a755', true); worker.g.position.set(2.2, .25, 1);
      animations.push(t => { worker.a.rotation.x = Math.sin(t * 4) * .9; worker.g.rotation.y = -.6; });
    }
  }

  const waterUniforms = { time: { value: 0 }, tint: { value: new T.Color('#52cce7') } };
  const waterMaterial = new T.ShaderMaterial({ uniforms: waterUniforms, vertexShader: 'varying vec2 p;uniform float time;void main(){p=position.xy;vec3 v=position;v.z+=sin(v.x*.6+time)*.035+cos(v.y*.7+time)*.035;gl_Position=projectionMatrix*modelViewMatrix*vec4(v,1.);}', fragmentShader: 'varying vec2 p;uniform float time;uniform vec3 tint;void main(){float a=pow(max(0.,sin(p.x*1.1+p.y*2.+sin(p.y*.7+time)*.4+time*.6)),22.);float b=sin(p.x*.14+p.y*.12)*.018;gl_FragColor=vec4(tint+vec3(a*.019+b),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
  materials.set('water', waterMaterial);
  const water = mesh(scene, geometry('water', () => new T.PlaneGeometry(300, 300, 40, 40)), waterMaterial, 0, -.65, 0); water.rotation.x = -Math.PI / 2; water.receiveShadow = false; water.castShadow = false;
  const selection = mesh(scene, geometry('ring', () => new T.RingGeometry(3.05, 3.14, 64)), new T.MeshBasicMaterial({ color: '#f8dc9b', side: T.DoubleSide, transparent: true, opacity: .95 }), 0, .82, 0); selection.rotation.x = -Math.PI / 2; selection.visible = false; materials.set('selection', selection.material);

  function rebuild() {
    world.clear(); animations.length = 0; random = randomFrom(city.seed); buildingHeights.clear();
    const island = new T.Shape(); island.moveTo(-12, -17); island.lineTo(10, -17); island.quadraticCurveTo(14, -17, 14, -13); island.lineTo(14, 10); island.quadraticCurveTo(14, 14, 9, 14); island.lineTo(-10, 14); island.quadraticCurveTo(-14, 14, -14, 9); island.lineTo(-14, -13); island.quadraticCurveTo(-14, -17, -12, -17);
    const land = mesh(world, geometry('island', () => new T.ExtrudeGeometry(island, { depth: 1.4, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .3, bevelThickness: .2 })), material('#f8d18a'), 0, -1.1, -3); land.rotation.x = -Math.PI / 2;
    box(world, 0, .56, -2, 25, .06, 26, city.biome === 'autumn' ? '#edc75b' : '#8bce43');
    // A walkable ring and cross streets connect every district.
    for (const x of [-4.2, 4.2]) { box(world, x, .62, -2, 1.25, .055, 26, '#eee3c7'); box(world, x - .68, .65, -2, .08, .08, 26, '#faf0d8'); }
    for (const z of [-9, 0, 11]) box(world, 0, .63, z, 25, .05, 1.4, '#eee3c7');
    for (const x of [-12.3, 12.3]) box(world, x, .65, -2, .5, .1, 26, '#ddd7bb');
    cylinder(world, 0, .68, 1.4, 3, .12, '#dfd5b6', 3, 48);
    cylinder(world, 0, .84, 1.4, 1.35, .34, '#efe8ce'); cylinder(world, 0, 1.02, 1.4, 1.15, .035, '#83b9b7'); cylinder(world, 0, 1.4, 1.4, .27, .8, '#e5ddc0');
    cylinder(world, 0, 1.8, 1.4, .7, .16, '#eee4cb');
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; const drop = ball(world, Math.cos(a) * .7, 1.6, 1.4 + Math.sin(a) * .7, .05, '#bee7de'); animations.push(t => { drop.position.y = 1.1 + Math.abs(Math.sin(t * 2 + i)) * .85; }); }
    for (let i = 0; i < 52; i++) {
      const x = i < 26 ? (i % 2 ? -11.3 : 11.3) : (random() - .5) * 24, z = i < 26 ? -13 + Math.floor(i / 2) * 1.8 : i % 2 ? 12 : -10;
      if (Math.abs(x - 6) < 4 && z < -10) continue; tree(world, x + random() * .3, z, .7 + random() * .4);
    }
    for (const x of [-2.5, 2.5]) for (const z of [-1, 3.7]) { tree(world, x, z, .65); box(world, x, .93, z + 1, .7, .13, .27, '#ac8c62'); box(world, x, 1.12, z + 1.12, .7, .28, .07, '#ac8c62'); }
    for (let i = 0; i < 12; i++) { const x = i % 2 ? -4.9 : 4.9, z = -8 + Math.floor(i / 2) * 3.7; cylinder(world, x, 1.35, z, .04, 1.45, '#647c72'); ball(world, x, 2.12, z, .12, '#ffe6b7'); }
    for (const { id } of DISTRICTS) district(id);
    const total = DISTRICTS.reduce((n, d) => n + levelOf(city.districts[d.id]), 0);
    if (total > 7) { if (!city.game.upgrades.includes('workshop')) home(world, -8, 10, .85, '#ffc875'); home(world, -10, 9, .75, '#ffb9d2'); if (!city.game.upgrades.includes('rescue')) home(world, 8, 10, .9, '#a1e1f5'); }
    for (let i = 0; i < 24; i++) {
      const x = i % 2 ? -5.1 : 5.1, z = -7 + Math.floor(i / 2) * 1.4;
      ball(world, x, .82, z, .13, ['#ff8cb8', '#ffd35e', '#c694f7'][i % 3]);
      box(world, x, .7, z, .035, .18, .035, '#38a969');
    }
    const car = new T.Group(); world.add(car); rounded(car, 0, .22, 0, .85, .35, .45, '#ffb932'); rounded(car, -.08, .48, 0, .45, .28, .4, '#ffda69');
    box(car, .17, .49, 0, .025, .19, .35, '#7adbea');
    for (const x of [-.27, .27]) for (const z of [-.24, .24]) ball(car, x, .12, z, .11, '#504d72');
    animations.push(t => { car.position.set(Math.sin(t * .16) * 10, .65, 11); car.rotation.y = Math.cos(t * .16) > 0 ? 0 : Math.PI; });
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const foam = cylinder(world, Math.cos(angle) * 18, -.53, Math.sin(angle) * 21 - 1, .8, .014, '#c8f8ff', .8, 20); foam.scale.z = .16;
      animations.push(t => { foam.position.y = -.53 + Math.sin(t + i) * .018; foam.scale.x = 1 + Math.sin(t * .6 + i) * .16; });
    }
    if (city.game.upgrades.includes('park')) {
      rounded(world, -8, .7, -12, 4.8, .2, 3.8, '#ffe8a7'); rounded(world, -8, .84, -12, 4.4, .15, 3.4, '#65cd70');
      for (let i = 0; i < 15; i++) ball(world, -9.8 + random() * 3.5, 1, -13.3 + random() * 2.7, .18, ['#ff87ac', '#ffcf43', '#b585eb'][i % 3]);
      tree(world, -9, -12.4, .85); tree(world, -7, -12.4, .7);
      sign(world, 'ПАРК РАДОСТИ', -8, 1.6, -10.2, 2.7, '#2c995e');
    }
    if (city.game.upgrades.includes('rescue')) {
      rounded(world, 8, 1.5, 10, 2.5, 1.6, 1.9, '#ff8274'); rounded(world, 8, 2.4, 10, 2.8, .35, 2.1, '#fff2d8');
      box(world, 8, 1.3, 11, 1.6, 1.1, .05, '#645b91'); sign(world, 'СПАСАТЕЛИ', 8, 2.3, 11.1, 2.4, '#ea6957');
      rounded(world, 9.7, 1.03, 10.8, .8, .5, .42, '#f45358'); box(world, 9.7, 1.32, 10.8, .25, .14, .3, '#8fdbff');
    }
    if (city.game.upgrades.includes('workshop')) {
      rounded(world, -8, 1.4, 10, 2.8, 1.5, 2.1, '#ffc055'); const roof = cylinder(world, -8, 2.5, 10, 2.1, 1, '#5598d3', 0, 4); roof.rotation.y = Math.PI / 4;
      sign(world, 'МАСТЕРСКАЯ', -8, 1.8, 11.1, 2.6, '#be7a30'); cylinder(world, -9, 2.8, 9.5, .25, 1.1, '#f49c54');
    }
    if (city.game.upgrades.includes('festival')) {
      const balloon = new T.Group(); world.add(balloon);
      const balloonColors = ['#ff825d', '#ffd255', '#9671e6', '#ff825d', '#ffd255', '#9671e6'];
      for (let i = 0; i < 6; i++) { const segment = mesh(balloon, geometry(`balloon${i}`, () => new T.SphereGeometry(1.65, 6, 12, i * Math.PI / 3, Math.PI / 3)), material(balloonColors[i]), 0, 0, 0); segment.scale.y = 1.2; }
      rounded(balloon, 0, -2.4, 0, .8, .6, .65, '#dca16b');
      for (const x of [-.33, .33]) beam(balloon, [x, -2.2, .22], [x * 1.7, -1.3, .35], .035, '#fff1d6');
      animations.push(t => { balloon.position.set(-12 + Math.sin(t * .12) * .7, 8 + Math.sin(t * .65) * .32, -7); balloon.rotation.y = Math.sin(t * .15) * .25; });
      for (let i = 0; i < 9; i++) { const flag = cylinder(world, -3.5 + i * .85, 2.7 + Math.abs(i - 4) * .1, 11, .23, .45, balloonColors[i % 6], 0, 3); flag.rotation.z = Math.PI; }
      beam(world, [-4, .7, 11], [-4, 3.3, 11], .08, '#b292d0'); beam(world, [4, .7, 11], [4, 3.3, 11], .08, '#b292d0');
    }
    // Pier, sailboat and arriving ship.
    for (let i = 0; i < 16; i++) box(world, -8, .25, 12.5 + i * .32, 2.1, .15, .25, '#b99e71');
    for (const x of [-8.8, -7.2]) for (const z of [12.7, 15.8]) cylinder(world, x, -.1, z, .12, 1.8, '#8b8066');
    const boat = new T.Group(); boat.position.set(-5.5, -.35, 15.5); world.add(boat);
    const hull = cylinder(boat, 0, 0, 0, .65, .35, '#e9dcc0', .8, 8); hull.scale.z = 2;
    box(boat, 0, 1, 0, .045, 2, .045, '#ac9269'); const sail = mesh(boat, geometry('sail', () => new T.ConeGeometry(.8, 1.6, 3)), material('#f7e9cc'), .3, 1.1, 0); sail.scale.z = .06;
    animations.push(t => { boat.position.y = -.25 + Math.sin(t * 1.3) * .08; boat.rotation.z = Math.sin(t * .8) * .07; boat.position.z = 15.7 + Math.sin(t * .1) * .8; });
    for (let i = 0; i < Math.min(52, population(city)); i++) {
      const colors = ['#ff745e', '#32b7dd', '#ffc536', '#b078ed', '#fa78b1'];
      const citizen = person(world, colors[i % colors.length], i < 3); const phase = random(), lane = i % 2 ? -4.2 : 4.2;
      const endangered = city.districts.sleep.damage >= 70 && i % 6 === 0;
      animations.push(t => {
        const progress = (phase + t * (endangered ? .048 : .017)) % 1, length = 52.8;
        const distance = progress * length;
        let x = lane, z = 0, direction = 0;
        if (distance < 18) { z = -8 + distance; direction = 0; }
        else if (distance < 26.4) { x = lane + (lane < 0 ? 1 : -1) * (distance - 18); z = 10; direction = lane < 0 ? Math.PI / 2 : -Math.PI / 2; }
        else if (distance < 44.4) { x = -lane; z = 10 - (distance - 26.4); direction = Math.PI; }
        else { x = -lane + (lane < 0 ? -1 : 1) * (distance - 44.4); z = -8; direction = lane < 0 ? -Math.PI / 2 : Math.PI / 2; }
        citizen.g.position.set(x + Math.sin(i) * .22, .68 + Math.abs(Math.sin(t * 5 + i)) * .025, z); citizen.g.rotation.y = direction;
        citizen.l.rotation.x = Math.sin(t * (endangered ? 11 : 6) + i) * .5; citizen.r.rotation.x = -citizen.l.rotation.x; citizen.a.rotation.x = -citizen.l.rotation.x; citizen.b.rotation.x = citizen.l.rotation.x;
      });
    }
    if (city.districts.sleep.damage >= 70) for (let i = 0; i < 3; i++) { const raider = person(world, '#58615e'); animations.push(t => { raider.g.position.set(1 + i * .5, .69, 11 + Math.sin(t + i) * .45); raider.a.rotation.x = Math.sin(t * 3) * .7; }); }
    if (city.decorations.includes('library')) { box(world, 2, 1.2, 4.8, .8, 1.1, .4, '#b39569'); sign(world, 'КНИГИ', 2, 1.5, 5.02, .7); }
    if (city.decorations.includes('garden')) for (let i = 0; i < 15; i++) ball(world, -2.7 + random() * 1.5, .85, 4.5 + random(), .13, i % 2 ? '#cb8d81' : '#e5c775');
    if (city.decorations.includes('stars')) { beam(world, [2, .7, -2], [2, 1.8, -2], .09, '#8e8875'); const scope = cylinder(world, 2, 1.9, -2, .15, 1, '#7c9598'); scope.rotation.z = -.7; }
    // A soft mountain silhouette beyond the water.
    if (city.biome === 'alpine') for (let i = 0; i < 9; i++) { const mountain = cylinder(world, -65 + i * 15, -2, -75 - random() * 15, 10, 10 + random() * 12, '#b3c9c2', 0, 5); mountain.rotation.y = random(); }
    if (city.weather === 'rain') {
      const rain = new T.Group(); world.add(rain);
      for (let i = 0; i < 110; i++) { const drop = box(rain, (random() - .5) * 28, random() * 14, (random() - .5) * 28, .014, .35, .014, '#b5cecd'); const offset = random() * 14; animations.push(t => { drop.position.y = 15 - ((t * 7 + offset) % 14); }); }
    }
    const background = city.weather === 'sun' ? '#7cdcf2' : city.weather === 'mist' ? '#acdcf0' : '#86b4dd';
    renderer.setClearColor(background); (scene.fog as T.Fog).color.set(background); sun.intensity = city.weather === 'sun' ? 2.5 : 1.4; (scene.fog as T.Fog).near = city.weather === 'mist' ? 45 : 65;
    animations.forEach(fn => fn(tick));
  }
  function update(c: City) {
    if (c.seed !== city.seed) constructionStarted.clear();
    else if (signature) for (const { id } of DISTRICTS) if (levelOf(c.districts[id]) > levelOf(city.districts[id])) constructionStarted.set(id, tick);
    city = c; const key = JSON.stringify([c.seed, c.biome, c.weather, c.decorations, c.game.upgrades, c.game.jobs.map(j => j.district), DISTRICTS.map(d => [c.districts[d.id].xp, c.districts[d.id].damage])]);
    if (signature !== key) { signature = key; rebuild(); }
  }
  function resize() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); const aspect = w / h, half = aspect < 1 ? 23 / aspect : 24, shift = aspect < .85 ? 6 : 0; camera.left = -half * aspect; camera.right = half * aspect; camera.top = half + shift; camera.bottom = -half + shift; camera.updateProjectionMatrix(); }
  const observer = new ResizeObserver(resize); observer.observe(host);
  const projected = new T.Vector3();
  function render(now: number) {
    if (disposed) return; frame = requestAnimationFrame(render);
    const delta = Math.min((now - last) / 1000, .05); last = now;
    if (document.hidden) return;
    if (!reduced) { tick += delta; waterUniforms.time.value = tick; animations.forEach(fn => fn(tick)); }
    controls.update();
    if (selected) { const d = DISTRICTS.find(d => d.id === selected)!; selection.position.set(d.x, .85, d.z); selection.visible = true; } else selection.visible = false;
    renderer.render(scene, camera);
    for (const { el, d } of labels) {
      projected.set(d.x, (buildingHeights.get(d.id) ?? 3) + .65, d.z).project(camera);
      el.style.left = `${(projected.x * .5 + .5) * host.clientWidth}px`; el.style.top = `${(-projected.y * .5 + .5) * host.clientHeight}px`;
      el.style.visibility = Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 ? 'hidden' : 'visible';
      el.dataset.selected = String(selected === d.id); el.dataset.danger = String(city.districts[d.id].damage >= 40); el.setAttribute('aria-pressed', String(selected === d.id));
      const job = city.game.jobs.find(j => j.district === d.id); el.dataset.building = String(!!job); el.textContent = job ? `⚡ ${d.building} · ${Math.max(0, Math.ceil((job.end - Date.now()) / 1000))}с` : d.building;
    }
  }
  const lost = (event: Event) => { event.preventDefault(); onError(); }; renderer.domElement.addEventListener('webglcontextlost', lost);
  const raycaster = new T.Raycaster(); let press = [0, 0];
  const down = (e: PointerEvent) => { press = [e.clientX, e.clientY]; };
  const pick = (e: MouseEvent) => {
    if (Math.hypot(e.clientX - press[0], e.clientY - press[1]) > 7) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new T.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
    let object: T.Object3D | null = raycaster.intersectObjects(world.children, true)[0]?.object ?? null;
    while (object) { if (object.userData.districtId) { onSelect(object.userData.districtId as DistrictId); return; } object = object.parent; }
  };
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('click', pick);
  update(initial); resize(); controls.update(); frame = requestAnimationFrame(render);
  return { update, select: id => { selected = id; }, camera: action => {
    if (action === 'home') { camera.position.set(33, 35, 42); controls.target.set(0, 1, -2); camera.zoom = 1.12; }
    else if (action === 'in' || action === 'out') camera.zoom = T.MathUtils.clamp(camera.zoom * (action === 'in' ? 1.2 : 1 / 1.2), .65, 2.6);
    else { const offset = camera.position.clone().sub(controls.target); offset.applyAxisAngle(new T.Vector3(0, 1, 0), action === 'left' ? -.3 : .3); camera.position.copy(controls.target).add(offset); }
    camera.updateProjectionMatrix(); controls.update();
  }, dispose: () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('click', pick); renderer.dispose(); renderer.domElement.remove(); labels.forEach(({ el }) => el.remove()); } };
}
