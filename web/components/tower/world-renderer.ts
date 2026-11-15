import * as THREE from 'three';
import {sceneTouch} from './scene-touch';
import { createEnvironment, terrainNoise } from './environment';
import { groundHeight, islandRadius, groundObstacles, makeWalkRoute, pointOnRoute, isWalkable, waterHeight, waterSlope, boatApproach, type Point2, type Obstacle } from './world-physics';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { rockMaterial } from './rock-material';
import { cliffRadius, harbourClearance, MAIN_DOCK_ANGLE, dockStairProfile } from './island-shape';
import { towerWings, towerHeight, floorHeight, floorRadius, towerWallRadius } from './tower-architecture';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MATERIALS, floorsOf, peopleOf, seeded, type WorldState } from './world-state';
import { createResidents, type Resident } from './residents';
import { createCraneRig, CRANE_TIP_X } from './crane-rig';
import { woodMaterial, woodDepthMaterial } from './wood-material';
import { timberGeometry, fracturedRockGeometry } from './crafted-geometry';
import { grassBladeGeometry, grassMaterial, fernGeometry, vegetationFits, FERN_RADIUS } from './vegetation';
import { sailMaterial, hullMaterial, updateSail } from './sailing';
import { createBoatWakes } from './boat-wakes';
import { workStation, WORK_SURFACE, WORK_DEPTH } from './workstations';
import { createWindowLighting } from './window-lighting';
import { frameTiming } from './frame-timing';
import { shadowSchedule } from './shadow-schedule';
import { shoreRocks } from './shore-rocks';
import { rimSurfaceHeight,cliffCrownHeight,soilRimGeometry,updateSoilRim,cliffRootGeometry } from './island-rim';
import {createTowerRuins,type TowerDamageView} from './tower-ruins';

export type CameraAction = 'left' | 'right' | 'in' | 'out' | 'top' | 'home' | 'overview' | 'reset';
export type SceneEvent = 'stone' | 'collapse' | 'arrival';
export type WorldRenderer = { update:(world:WorldState)=>void; damage?:(view:TowerDamageView|null,animate?:boolean)=>void; camera:(action:CameraAction)=>void; height:(fraction:number)=>void; event:(kind:SceneEvent)=>void; speed:(value:number)=>void; capture:()=>string; dispose:()=>void };

export function createWorldRenderer(host:HTMLDivElement, initial:WorldState, reduced:boolean,quality:'high'|'low'='high'):WorldRenderer {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,quality==='low'?1:1.5));
  renderer.setClearColor('#101b20'); renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.22;
  renderer.shadowMap.enabled=quality==='high'; renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate=false;const shadowClock=shadowSchedule();
  renderer.domElement.setAttribute('aria-label','Живой остров. Веди пальцем вбок для вращения, вверх или вниз для прокрутки. Два пальца меняют масштаб. Есть кнопки камеры и сброс.');
  renderer.domElement.setAttribute('role','img');
  host.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),distanceFog=new THREE.FogExp2('#6a8086',.007);scene.fog=distanceFog;
  const camera=new THREE.PerspectiveCamera(42,1,.1,900);
  const composer=quality==='high'?new EffectComposer(renderer,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:Math.min(4,renderer.capabilities.maxSamples)})):null;
  const bloom=composer?new UnrealBloomPass(new THREE.Vector2(512,512),.17,.35,1.1):null;
  const output=composer?new OutputPass():null;
  if(composer&&bloom&&output){composer.addPass(new RenderPass(scene,camera));composer.addPass(bloom);composer.addPass(output);}
  renderer.info.autoReset=false;
  const timing=frameTiming(renderer.getContext(),quality==='high');
  if(process.env.NODE_ENV==='development'){
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    host.dataset.sceneGpuRenderer=debug?String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)):'unavailable';
  }
  if(bloom){const renderBloom=bloom.render.bind(bloom);bloom.render=(...args)=>{timing.begin('bloom');try{renderBloom(...args);}finally{timing.end('bloom');}};}
  const renderShadows=renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render=(...args)=>{if(!renderer.shadowMap.enabled||!renderer.shadowMap.autoUpdate&&!renderer.shadowMap.needsUpdate)return renderShadows(...args);timing.begin('shadows');try{renderShadows(...args);}finally{timing.end('shadows');}};
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=.065; controls.enablePan=false;controls.enableZoom=false;
  controls.minDistance=9; controls.maxDistance=165; controls.minPolarAngle=.58; controls.maxPolarAngle=1.49;
  controls.rotateSpeed=.42; controls.zoomSpeed=.65;
  controls.touches.ONE=THREE.TOUCH.ROTATE; controls.touches.TWO=THREE.TOUCH.DOLLY_ROTATE;
  const geometries=new Map<string,THREE.BufferGeometry>();
  const materials=new Map<string,THREE.Material>();
  const textures:THREE.Texture[]=[];
  let world=initial, random=seeded(world.seed), time=0, speed=1, last=performance.now(), frame=0, stopped=false;
  let measuredFrames=0,measurementStart=performance.now();
  let preparationMs=0,submissionMs=0,reflectionMs=0;
  let floors=floorsOf(world), lastKey='', automaticStone=0, automaticCollapse=0,pendingBatch=false;
  let targetHeight=4, desiredRadius=29, desiredAngle=.72, manualCamera=false;
  let cameraTween=0; const cameraGoal=new THREE.Vector3();
  const ambient=new THREE.HemisphereLight('#d8f1ef','#a7b997',1.7); scene.add(ambient);
  const sun=new THREE.DirectionalLight('#ffddb0',3.7); sun.position.set(-26,42,18); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048); Object.assign(sun.shadow.camera,{left:-20,right:20,top:45,bottom:-18,near:1,far:110}); sun.shadow.bias=-.0007; sun.shadow.normalBias=.035; scene.add(sun);
  const rim=new THREE.DirectionalLight('#b0d4ed',.65); rim.position.set(24,16,-22); scene.add(rim);
  const warm=new THREE.PointLight('#ffa34c',11,17,2); warm.position.set(2,5,4); scene.add(warm);

  function geo(key:string,create:()=>THREE.BufferGeometry) { if(!geometries.has(key)) geometries.set(key,create()); return geometries.get(key)!; }
  function mat(color:string,roughness=.9,emissive=false) {
    const key=`${color}-${roughness}-${emissive}`;
    if(!materials.has(key)) materials.set(key,emissive?new THREE.MeshBasicMaterial({color}):new THREE.MeshLambertMaterial({color}));
    return materials.get(key)!;
  }
  function mesh(g:THREE.BufferGeometry,m:THREE.Material,parent:THREE.Object3D,x=0,y=0,z=0){ const o=new THREE.Mesh(g,m); o.position.set(x,y,z); o.castShadow=true; o.receiveShadow=true; parent.add(o); return o; }
  const timberColors=new Set(['#a28d67','#96805b','#aa936b','#756044','#715638','#68513a','#62503b','#9b7b50','#997a50','#a48657','#725937','#80664a','#826646','#766149','#77634b','#a08962','#6a5640','#745b3c','#755635','#7a6345','#8e7859','#6c5439','#6c543a','#9b835b','#a88c5d','#5d4a34','#695740','#63513a']);
  for(const color of ['#957854','#ae9068','#b59a71','#77664b','#8a7655','#76654b'])timberColors.add(color);
  const timberDepth=woodDepthMaterial();materials.set('timber-depth',timberDepth);
  function box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:string){
    const axis=w>=h&&w>=d?'x':h>=d?'y':'z',key=`wood-${color}-${axis}`;
    let surface=mat(color);
    if(timberColors.has(color)){if(!materials.has(key))materials.set(key,woodMaterial(color,axis));surface=materials.get(key)!;}
    const timber=timberColors.has(color),shape=timber
      ?geo('timber-unit',()=>timberGeometry(1,1,1))
      :geo('box',()=>new THREE.BoxGeometry(1,1,1));
    const o=mesh(shape,surface,parent,x,y,z);o.scale.set(w,h,d);if(timber)o.customDepthMaterial=timberDepth;return o;
  }
  function cylinder(parent:THREE.Object3D,x:number,y:number,z:number,rt:number,rb:number,h:number,color:string,sides=16){ return mesh(geo(`c-${rt}-${rb}-${h}-${sides}`,()=>new THREE.CylinderGeometry(rt,rb,h,sides)),mat(color),parent,x,y,z); }
  // Curved, flared roof profile keeps the original roof width and height.
  // Shared geometry lets static batching retain one draw per roof colour.
  function storyRoof(parent:THREE.Object3D,y:number,radius:number,height:number,color:string){
    const profile=[[1,0],[1,.045],[.78,.13],[.56,.31],[.34,.55],[.15,.79],[.035,1],[0,1]].map(([r,h])=>new THREE.Vector2(r,h));
    const roof=mesh(geo('storybook-roof',()=>new THREE.LatheGeometry(profile,16)),mat(color),parent,0,y-height/2,0);
    roof.scale.set(radius,height,radius);return roof;
  }
  function sphere(parent:THREE.Object3D,x:number,y:number,z:number,s:number,color:string){const o=mesh(geo('ico',()=>new THREE.IcosahedronGeometry(1,1)),mat(color),parent,x,y,z);o.scale.setScalar(s);return o;}
  function beam(parent:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,width:number,color:string){ const o=box(parent,0,0,0,width,a.distanceTo(b),width,color); o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());return o; }
  function lineBeam(parent:THREE.Object3D,a:number[],b:number[],w=.09,color='#68513a'){return beam(parent,new THREE.Vector3(...a),new THREE.Vector3(...b),w,color);}
  function batchStatic(root:THREE.Object3D,excluded=new Set<THREE.Object3D>()){
    root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),groups=new Map<string,THREE.Mesh[]>();
    const visit=(o:THREE.Object3D)=>{if(excluded.has(o))return;if(o instanceof THREE.Mesh&&!(o instanceof THREE.InstancedMesh)&&!Array.isArray(o.material)){const key=o.geometry.uuid+o.material.uuid;const list=groups.get(key)??[];list.push(o);groups.set(key,list);}o.children.forEach(visit);};root.children.forEach(visit);
    groups.forEach(items=>{if(items.length<3)return;const first=items[0],batch=new THREE.InstancedMesh(first.geometry,first.material,items.length);batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.customDepthMaterial=first.customDepthMaterial;items.forEach((o,i)=>{batch.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld));o.removeFromParent();});batch.computeBoundingSphere();root.add(batch);});
  }

  const stoneMaterial=new THREE.MeshLambertMaterial({color:new THREE.Color(MATERIALS[world.material].color).lerp(new THREE.Color('#fff0d4'),.28)});materials.set('stone',stoneMaterial);
  const environment=createEnvironment(scene,world,quality,renderer,timing);
  const boatWakes=createBoatWakes(scene);

  const island=new THREE.Group();scene.add(island);
  const cliffMaterial=rockMaterial(textures);materials.set('cliff',cliffMaterial);
  mesh(geo('island',()=>{
    const g=new THREE.CylinderGeometry(1,1,3.98,quality==='high'?256:128,48,true);const p=g.attributes.position,colors=[];
    for(let i=0;i<p.count;i++){const a=Math.atan2(p.getZ(i),p.getX(i)),baseY=p.getY(i)+.79,y=baseY+(cliffCrownHeight(a)-2.78)*THREE.MathUtils.smoothstep(baseY,2.15,2.78),r=cliffRadius(a,y),x=Math.cos(a)*r,z=Math.sin(a)*r;p.setXYZ(i,x,y,z);
      const c=new THREE.Color('#c2c2b2').lerp(new THREE.Color('#8a9990'),THREE.MathUtils.smoothstep(-y,-1.7,.5));c.multiplyScalar(.86+terrainNoise(x*7+y*4,z*7)*.22);if(y>2.4)c.lerp(new THREE.Color('#839064'),.35);colors.push(c.r,c.g,c.b);}
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
  }),cliffMaterial,island);
  const groundMaterial=new THREE.MeshLambertMaterial({vertexColors:true});materials.set('ground',groundMaterial);
  const groundGeometry=geo('living-ground',()=>{
    const vertices:number[]=[],uv:number[]=[],indices:number[]=[],colors:number[]=[],rings=26,segments=192;
    for(let r=0;r<=rings;r++)for(let i=0;i<=segments;i++){
      const a=i/segments*Math.PI*2,radius=r<24?r/24*islandRadius(a):islandRadius(a)-(26-r)*.08,x=Math.cos(a)*radius,z=Math.sin(a)*radius;
      vertices.push(x,2.91,z);uv.push(x/12+.5,z/12+.5);
      // Broad painted patches, baked once into vertices rather than sampled
      // in every frame. The edge meets the green soil lip without a hard seam.
      const patch=terrainNoise(x*.55,z*.55),edge=THREE.MathUtils.smoothstep(radius/islandRadius(a),.88,1);
      const c=new THREE.Color('#79b967').lerp(new THREE.Color('#acd582'),patch).lerp(new THREE.Color('#8bc979'),edge);
      colors.push(c.r,c.g,c.b);
      if(r<rings&&i<segments){const n=r*(segments+1)+i;indices.push(n,n+1,n+segments+1,n+1,n+segments+2,n+segments+1);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
  });
  mesh(groundGeometry,groundMaterial,island);
  const soilSkirt=geo('soil-skirt',soilRimGeometry);
  const soilMaterial=new THREE.MeshLambertMaterial({vertexColors:true});materials.set('soil-lip',soilMaterial);
  mesh(soilSkirt,soilMaterial,island);
  const contactCanvas=document.createElement('canvas');contactCanvas.width=contactCanvas.height=64;const contactCtx=contactCanvas.getContext('2d')!,contactGradient=contactCtx.createRadialGradient(32,32,2,32,32,31);
  contactGradient.addColorStop(0,'rgba(13,22,16,.6)');contactGradient.addColorStop(.48,'rgba(13,22,16,.3)');contactGradient.addColorStop(1,'rgba(13,22,16,0)');contactCtx.fillStyle=contactGradient;contactCtx.fillRect(0,0,64,64);
  const contactTexture=new THREE.CanvasTexture(contactCanvas);textures.push(contactTexture);const contactMaterial=new THREE.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});materials.set('contact',contactMaterial);
  function contact(parent:THREE.Object3D,x:number,z:number,rx:number,rz=rx){const o=mesh(geo('contact-plane',()=>new THREE.PlaneGeometry(2,2)),contactMaterial,parent,x,2.923,z);o.rotation.x=-Math.PI/2;o.scale.set(rx,rz,1);o.castShadow=o.receiveShadow=false;return o;}
  contact(island,0,0,3.3);
  const boulderGeometries=Array.from({length:8},(_,i)=>geo(`fractured-rock-${i}`,()=>fracturedRockGeometry(i%4,i<4?(quality==='high'?5:3):1)));
  const shoreline=shoreRocks(world.seed,boulderGeometries);
  boulderGeometries.forEach((geometry,i)=>{
    const transforms=shoreline.filter(rock=>rock.geometry===i);if(!transforms.length)return;
    const stones=new THREE.InstancedMesh(geometry,cliffMaterial,transforms.length);stones.castShadow=true;stones.receiveShadow=true;
    transforms.forEach((rock,j)=>stones.setMatrixAt(j,rock.matrix));stones.computeBoundingSphere();island.add(stones);
  });
  // The external stair starts at the cliff lip and lands on the dock; no steps
  // disappear underneath the plateau or stop halfway down the rock wall.
  const stair=new THREE.Group();stair.rotation.y=MAIN_DOCK_ANGLE;island.add(stair);
  const stairSteps=dockStairProfile(),stairStart=stairSteps[0].distance;
  box(stair,0,2.88,stairStart-.17,1.12,.14,.56,'#a28d67');
  for(let i=0;i<stairSteps.length;i++){
    const y=stairSteps[i].height,z=stairSteps[i].distance;
    box(stair,0,y,z,1.12,.18,.235,i%3?'#96805b':'#aa936b');
    if(i%4===0||i===13)for(const side of [-1,1])box(stair,side*.55,y+.37,z,.055,.72,.055,'#756044');
  }
  for(const side of [-1,1]){
    lineBeam(stair,[side*.43,2.69,stairStart-.1],[side*.43,.34,stairStart+2.72],.13,'#6c543a');
    lineBeam(stair,[side*.55,3.52,stairStart],[side*.55,1.18,stairStart+2.6],.06,'#9b835b');
  }
  batchStatic(stair);
  const treeCrowns:THREE.Group[]=[];const flags:THREE.Mesh[]=[];const boats:THREE.Group[]=[];let animatedFloors:THREE.Group[]=[];
  const sails:{mesh:THREE.Mesh;phase:number}[]=[];
  const groundTrees:Obstacle[]=[];let navigationObstacles:Obstacle[]=[];
  const dynamicProps=new THREE.Group();island.add(dynamicProps);
  const wind={value:0};
  const leafMaterial=new THREE.MeshLambertMaterial({color:'#b0d880',side:THREE.DoubleSide});materials.set('leaves',leafMaterial);
  const foliageMatrix=new THREE.Matrix4(),foliagePosition=new THREE.Vector3(),foliageRotation=new THREE.Quaternion(),foliageScale=new THREE.Vector3();
  // Rounded crowns stay above walking clearance; trunk footprints are unchanged.
  function tree(parent:THREE.Object3D,x:number,y:number,z:number,size:number,pine=false){
    if(parent===island)groundTrees.push({x,z,radius:.12*size});
    if(parent===island||parent===dynamicProps)contact(parent,x,z,.48*size);
    const crown=new THREE.Group();crown.position.set(x,y,z);crown.scale.setScalar(size);parent.add(crown);
    cylinder(crown,0,.8,0,.075,.11,1.6,'#b88858',9);
    if(pine){
      for(let tier=0;tier<3;tier++){
        const radius=.85-tier*.21,height=1.2-tier*.14;
        const o=mesh(geo(`storybook-pine-${tier}`,()=>new THREE.ConeGeometry(radius,height,10,1)),mat(['#388e78','#54ab83','#86c992'][tier]),crown,0,1.25+tier*.57,0);
        o.rotation.y=tier*.42;
      }
    }else{
      const palette=world.biome==='coast'?['#83b958','#a2ce70','#c2df86']:['#53ab7b','#77c58c','#a0d895'];
      for(let j=0;j<7;j++){
        const a=j*2.39996,r=j===0?0:.43;
        const o=mesh(geo('storybook-crown',()=>new THREE.IcosahedronGeometry(1,2)),mat(palette[j%3]),crown,Math.sin(a)*r,1.55+(j%3)*.25,Math.cos(a)*r);
        o.scale.set(.58,.63,.57);
      }
    }
    batchStatic(crown);treeCrowns.push(crown);
  }
  // Plant locations are independent of needle/leaf count and quality settings.
  const treePlacement=seeded(world.seed+714);
  for(let i=0;i<19;i++){const a=treePlacement()*Math.PI*2,r=4.65+treePlacement()*.7,size=.55+treePlacement()*.85;if(a>.4&&a<1.5)continue;tree(island,Math.cos(a)*r,2.9,Math.sin(a)*r,size,world.biome==='alpine'||i%3===0);}
  const rootMaterial=new THREE.MeshStandardMaterial({color:'#9b896c',vertexColors:true,roughness:1});materials.set('exposed-roots',rootMaterial);
  mesh(geo('cliff-roots',()=>cliffRootGeometry(groundTrees)),rootMaterial,island);
  const meadowMaterial=grassMaterial(wind);materials.set('meadow',meadowMaterial);
  const grassCount=quality==='high'?2800:1200,grass=new THREE.InstancedMesh(geo('grass-blade',grassBladeGeometry),meadowMaterial,grassCount);grass.receiveShadow=true;island.add(grass);
  const ferns=new THREE.InstancedMesh(geo('fern',fernGeometry),leafMaterial,quality==='high'?42:16);ferns.receiveShadow=true;island.add(ferns);
  function plantGrass(){
    const rng=seeded(world.seed+241),routes=workers.map(w=>w.route);let count=0,fernCount=0;
    const shadowGrass=new THREE.Color('#6eae55'),litGrass=new THREE.Color('#b6d979'),up=new THREE.Vector3(0,1,0);
    // Small, irregular tufts break the lip silhouette; the same full-footprint
    // route checks as the meadow keep their tips clear of residents and stairs.
    for(let cluster=0;cluster<(quality==='high'?130:65);cluster++){
      const a=rng()*Math.PI*2;
      if(harbourClearance(a)>.2||terrainNoise(Math.cos(a)*8,Math.sin(a)*8)<.4)continue;
      for(let blade=0;blade<(quality==='high'?12:6);blade++){
        const angle=a+(rng()-.5)*.045,r=islandRadius(angle)-.20-rng()*.045,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
        if(!vegetationFits(x,z,.16,navigationObstacles,routes))continue;
        const h=.15+rng()*.12;
        foliagePosition.set(x,rimSurfaceHeight(x,z,navigationObstacles),z);
        foliageRotation.setFromAxisAngle(up,Math.PI/2-angle+(rng()-.5)*.6);foliageScale.set(.012+rng()*.016,h,h*.5);
        foliageMatrix.compose(foliagePosition,foliageRotation,foliageScale);grass.setMatrixAt(count,foliageMatrix);
        grass.setColorAt(count++,shadowGrass.clone().lerp(litGrass,.25+rng()*.45));
      }
    }
    for(let cluster=0;cluster<(quality==='high'?170:100);cluster++){
      const a=rng()*Math.PI*2,r=3.65+rng()*2.05,cx=Math.cos(a)*r,cz=Math.sin(a)*r,patch=terrainNoise(cx*1.2,cz*1.2),spread=.13+rng()*.23;
      if(patch<.23)continue;
      for(let blade=0;blade<(quality==='high'?14:9)&&count<grassCount;blade++){
        const angle=rng()*Math.PI*2,distance=Math.sqrt(rng())*spread,x=cx+Math.cos(angle)*distance,z=cz+Math.sin(angle)*distance;
        if(!vegetationFits(x,z,.12,navigationObstacles,routes))continue;
        const h=.065+patch*.06+rng()*.085;
        foliagePosition.set(x,rimSurfaceHeight(x,z,navigationObstacles),z);foliageRotation.setFromAxisAngle(new THREE.Vector3(0,1,0),angle+(rng()-.5)*.6);foliageScale.set(.012+rng()*.018,h,h*.5);
        foliageMatrix.compose(foliagePosition,foliageRotation,foliageScale);grass.setMatrixAt(count,foliageMatrix);
        const color=shadowGrass.clone().lerp(litGrass,patch*.45+rng()*.2);if(blade%17===0)color.lerp(new THREE.Color('#a08d52'),.4);grass.setColorAt(count++,color);
      }
      const fernScale=.35+rng()*.2;
      if(cluster%3===0&&fernCount<ferns.instanceMatrix.count&&vegetationFits(cx,cz,fernScale*FERN_RADIUS,navigationObstacles,routes)){
        foliagePosition.set(cx,rimSurfaceHeight(cx,cz,navigationObstacles),cz);foliageRotation.setFromAxisAngle(new THREE.Vector3(0,1,0),rng()*Math.PI*2);foliageScale.setScalar(fernScale);foliageMatrix.compose(foliagePosition,foliageRotation,foliageScale);
        ferns.setMatrixAt(fernCount,foliageMatrix);ferns.setColorAt(fernCount++,new THREE.Color('#395b32').lerp(new THREE.Color('#758947'),rng()*.45));
      }
    }
    grass.count=count;grass.instanceMatrix.needsUpdate=true;if(grass.instanceColor)grass.instanceColor.needsUpdate=true;grass.computeBoundingSphere();
    ferns.count=fernCount;ferns.instanceMatrix.needsUpdate=true;if(ferns.instanceColor)ferns.instanceColor.needsUpdate=true;ferns.computeBoundingSphere();
    host.dataset.sceneGrassBlades=String(count);host.dataset.sceneFerns=String(fernCount);
  }
  const islandTreeCount=treeCrowns.length;

  const settlement=new THREE.Group();island.add(settlement);
  function dock(angle:number,length:number){const g=new THREE.Group();g.rotation.y=angle;settlement.add(g);
    for(let i=0;i<Math.floor(length*5);i++)box(g,0,.45,5+i*.21,1.35,.14,.19,i%3?'#77664b':'#8a7655');
    for(let i=0;i<4;i++)for(const side of [-1,1]){cylinder(g,side*.63,.1,5+i*length/3,.06,.08,1.4,'#484536',6);box(g,side*.64,.7,5+i*length/3,.09,.6,.09,'#76654b');}
  }
  const windows:THREE.Mesh[]=[];
  const glowMat=new THREE.MeshBasicMaterial({color:new THREE.Color('#ffd393').multiplyScalar(2.2)});materials.set('glow',glowMat);
  const darkWindow=mat('#182025');
  const archGlass=geo('arch-window',()=>{
    const shape=new THREE.Shape();shape.moveTo(-.26,0);shape.lineTo(-.26,.69);shape.absarc(0,.69,.26,Math.PI,0,true);shape.lineTo(.26,0);shape.closePath();
    return new THREE.ShapeGeometry(shape);
  });
  const windowLighting=createWindowLighting(scene,archGlass,glowMat,darkWindow);
  function windowArch(parent:THREE.Object3D,angle:number,y:number,r:number,scale=1){
    const g=new THREE.Group();g.position.set(Math.sin(angle)*r,y,Math.cos(angle)*r);g.rotation.y=angle;g.scale.setScalar(scale);parent.add(g);
    const window=mesh(archGlass,glowMat,g,0,0,.03);window.castShadow=false;window.visible=false;windows.push(window);
    const frame=mesh(geo('arch-frame',()=>new THREE.TorusGeometry(.31,.055,5,14,Math.PI)),mat('#f0ddb1'),g,0,.68,.035);
    frame.rotation.z=0;
    for(const x of [-.31,.31])box(g,x,.34,0,.11,.72,.14,'#e0c994');
    box(g,0,.025,.04,.73,.1,.21,'#f0ddb1');box(g,0,.47,.06,.045,.88,.055,'#5d4a34');box(g,0,.47,.06,.52,.045,.055,'#5d4a34');
    for(const side of [-1,1]){
      box(g,side*.43,.34,.015,.14,.6,.065,'#6ba59b');
      box(g,side*.43,.18,.052,.14,.045,.025,'#aec7a0');
      box(g,side*.43,.49,.052,.14,.045,.025,'#aec7a0');
    }
    return g;
  }
  function house(parent:THREE.Object3D,x:number,z:number,scale=1){
    contact(parent,x,z,1.05*scale);
    const g=new THREE.Group();g.position.set(x,2.94,z);g.scale.setScalar(scale);parent.add(g);
    const body=mesh(geo('house-body',()=>new THREE.BoxGeometry(1.25,1.35,1.2)),stoneMaterial,g,0,.65,0);
    const roof=storyRoof(g,1.57,1.1,.9,'#cf805b');roof.scale.z*=.92;
    box(g,0,.5,.61,.4,1.02,.06,'#3b382d');windowArch(g,Math.PI/2,.35,.64,.65);
    for(let i=0;i<5;i++)box(g,-.62+i*.31,1.22,.64,.045,.19,.04,'#8e7859');
    return body;
  }
  const linen=sailMaterial(),hullSurface=hullMaterial();materials.set('sail-linen',linen);materials.set('planked-hull',hullSurface);
  function boat(x:number,z:number,big:boolean,index:number){
    const g=new THREE.Group();g.position.set(x,.1,z);g.rotation.y=index*.8-.2;scene.add(g);boats.push(g);
    const vessel=new THREE.Group();vessel.scale.setScalar(big?1:.68);g.add(vessel);
    const width=(z:number)=>.76*Math.pow(Math.max(0,1-Math.pow(z/1.9,2)),.65);
    const hull=mesh(geo('lofted-hull',()=>{
      const positions:number[]=[],indices:number[]=[],uv:number[]=[];
      for(let j=0;j<=32;j++){const zz=-1.9+j/32*3.8,w=width(zz);for(let k=0;k<=12;k++){
        const a=k/12*Math.PI;positions.push(Math.cos(a)*w,.17-Math.sin(a)*.64+Math.pow(Math.abs(zz)/1.9,5)*.2,zz);uv.push(k/12,j/32);
        if(j<32&&k<12){const n=j*13+k;indices.push(n,n+13,n+1,n+1,n+13,n+14);}
      }}
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
    }),hullSurface,vessel);
    for(let j=0;j<24;j++){const zz=-1.78+j*.15,w=width(zz);box(vessel,0,.14,zz,w*1.88,.07,.139,j%4?'#957854':'#ae9068');}
    for(const side of [-1,1])for(let j=0;j<20;j++){
      const a=-1.88+j*3.76/20,b=a+3.76/20;
      lineBeam(vessel,[side*width(a),.25+Math.pow(Math.abs(a)/1.9,5)*.2,a],[side*width(b),.25+Math.pow(Math.abs(b)/1.9,5)*.2,b],.085,'#b59a71');
      if(j%4===0)lineBeam(vessel,[side*width(a),.17,a],[side*width(a),.42,a],.04,'#63513a');
    }
    box(vessel,0,.32,-1.05,1.07,.12,.27,'#6c5439');box(vessel,0,.32,.85,1.23,.12,.26,'#6c5439');
    cylinder(vessel,0,1.8,0,.035,.065,3.5,'#755635',10);
    lineBeam(vessel,[-.95,3.15,0],[.95,3.15,0],.055,'#745b3c');
    for(const side of [-1,1])lineBeam(vessel,[0,3.35,0],[side*.68,.27,.65],.013,'#bcb49a');
    lineBeam(vessel,[0,3.3,0],[0,.47,1.86],.013,'#bcb49a');
    const sailGeo=geo(`linen-sail-${index}`,()=>new THREE.PlaneGeometry(1,1,14,16));updateSail(sailGeo,time,index*2.3);
    const sail=mesh(sailGeo,linen,vessel,0,2.025,.07);sails.push({mesh:sail,phase:index*2.3});
    for(const side of [-1,1]){
      // Tie both fixed top corners to the yard, across the cloth's forward offset.
      lineBeam(vessel,[side*.875,3.15,.07],[side*.875,3.15,0],.016,'#bcb49a');
      lineBeam(vessel,[side*.6475,.9,.07],[side*.62,.37,.85],.011,'#bcb49a');
      box(vessel,side*.52,.25,-1.25,.06,.11,.22,'#63513a');
    }
    for(let turn=0;turn<3;turn++){
      const rope=mesh(geo(`rope-coil-${turn}`,()=>new THREE.TorusGeometry(.08+turn*.035,.013,4,18)),mat('#a29577'),vessel,.2,.22,-1.28);rope.rotation.x=-Math.PI/2;
    }
    batchStatic(vessel,new Set([sail]));g.userData={baseX:x,baseZ:z,heading:index*.8-.2,phase:index*2,arrival:index>0&&!reduced?1:0};
  }
  let tower=new THREE.Group();tower.position.y=2.95;scene.add(tower);
  const residentRenderer=createResidents(scene);
  const workers: (Resident & {working:boolean;route:Point2[];distance:number})[]=[];
  function worker(index:number){
    const resident=residentRenderer.add(index,world.seed);
    workers.push(Object.assign(resident,{working:index%4===0,route:[] as Point2[],distance:resident.phase}));
  }
  function balcony(parent:THREE.Object3D,angle:number,y:number,r:number){
    const g=new THREE.Group();g.rotation.y=angle;g.position.y=y;parent.add(g);
    box(g,0,0,r+.28,1.65,.13,.9,'#766149');
    for(let i=0;i<6;i++)box(g,-.72+i*.29,.38,r+.72,.045,.72,.045,'#77634b');
    box(g,0,.76,r+.72,1.65,.08,.08,'#a08962');
    for(const side of [-1,1])lineBeam(g,[side*.64,0,r+.65],[side*.64,-.67,r-.06],.075,'#6a5640');
  }
  const craneRig=createCraneRig(),craneHook=craneRig.root;let craneY=0;
  const stoneColors=['#9a9586','#a8a28f','#827f74','#b2a993'];
  function buildTower(previousFloors:number){
    shadowClock.invalidate();
    random=seeded(world.seed+384);
    navigationObstacles=groundObstacles(floors,groundTrees,world.motifs);
    const groundPositions=groundGeometry.attributes.position;
    for(let i=0;i<groundPositions.count;i++)groundPositions.setY(i,rimSurfaceHeight(groundPositions.getX(i),groundPositions.getZ(i),navigationObstacles));
    groundPositions.needsUpdate=true;groundGeometry.computeVertexNormals();
    updateSoilRim(soilSkirt,navigationObstacles);
    for(const group of [tower,dynamicProps,settlement])group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});
    scene.remove(tower); tower=new THREE.Group();tower.position.y=2.95;scene.add(tower);animatedFloors=[];windows.length=0;windowLighting.clear();pendingBatch=true;
    dynamicProps.clear();settlement.clear();treeCrowns.splice(islandTreeCount);flags.length=0;
    boats.forEach(b=>{b.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});scene.remove(b);});boats.length=0;sails.length=0;boatWakes.clear();residentRenderer.clear();workers.length=0;
    dock(MAIN_DOCK_ANGLE,3.2);boat(4.7,7.9,false,0);
    if(floors>=4){dock(-1.7,2.8);boat(-8.3,1.7,true,1);}
    if(floors>=8)boat(8.3,-5.8,true,2);
    if(floors>=2)house(settlement,-3.9,1.8,.8);
    if(floors>=5)house(settlement,2.3,-4.1,.72);
    if(floors>=9)house(settlement,-3.6,-2.5,.68);
    for(let i=0;i<peopleOf(world);i++)worker(i);
    const foundation=cylinder(tower,0,.18,0,2.7,2.95,.36,'#7e7c70',24);foundation.material=stoneMaterial;
    // Building material stacks remain visible even on day one.
    for(let i=0;i<18;i++)box(dynamicProps,-2.1+(i%3)*.26,3.08+Math.floor(i/6)*.16,3.6+Math.floor(i%6/3)*.3,.24,.14,.28,'#aba18b');
    for(let i=0;i<8;i++){const log=cylinder(dynamicProps,-4.25,3.15+(i%2)*.16,-.8+Math.floor(i/2)*.2,.085,.085,1.5,'#7a6345',8);log.rotation.z=Math.PI/2;}
    const wings=towerWings(floors);
    for(const wing of wings){
      const g=new THREE.Group();g.position.set(wing.x,0,wing.z);tower.add(g);const height=towerHeight(wing.levels);
      const plinth=cylinder(g,0,.18,0,1.04,1.08,.36,'#8f8a77',32);plinth.material=stoneMaterial;
      mesh(geo(`wing-wall-${wing.levels}`,()=>{
        const shape=new THREE.CylinderGeometry(.8,.94,height,40),uv=shape.attributes.uv;
        for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*Math.PI*.87,uv.getY(i)*height/2);
        return shape;
      }),stoneMaterial,g,0,.35+height/2,0);
      for(let row=0;row<wing.levels;row++){
        const radius=.94-(row+.6)/wing.levels*.14;
        for(const offset of [-.84,0,.84])windowArch(g,wing.angle+offset,.35+towerHeight(row)+.6,radius+.023,.76);
        if(row%3===2){const belt=cylinder(g,0,.35+towerHeight(row),0,radius+.055,radius+.065,.13,'#a89e83',32);belt.material=stoneMaterial;}
      }
      cylinder(g,0,height+.43,0,1.01,1.01,.18,'#8f8267',32);
      storyRoof(g,height+1.21,1.12,1.5,'#479d91');
      cylinder(g,0,height+2.11,0,.019,.045,.42,'#a88c5d',8);sphere(g,0,height+2.35,0,.075,'#bcaa77');
      if(previousFloors<6&&!reduced){g.scale.y=.02;g.userData.born=time+.3;animatedFloors.push(g);}
    }
    const facadeFree=(a:number,y:number,r:number,padding=.05)=>wings.every(w=>y>towerHeight(w.levels)+2.5||Math.hypot(Math.sin(a)*r-w.x,Math.cos(a)*r-w.z)>1.12+padding);
    const freeAngle=(a:number,y:number,r:number)=>{for(let j=0;j<14;j++){const candidate=a+j*.45;if(facadeFree(candidate,y,r,.8))return candidate;}return a;};
    const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3();
    for(let f=0;f<floors;f++){
      const level=new THREE.Group();level.position.y=.35+towerHeight(f);tower.add(level);
      const r=floorRadius(f),h=floorHeight(f)-.05;
      mesh(geo(`wall-${f}`,()=>{const g=new THREE.CylinderGeometry(floorRadius(f+1),r,h,64),uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*Math.PI*r,uv.getY(i)*h/2+f*.17);return g;}),stoneMaterial,level,0,h/2,0);
      const ring=cylinder(level,0,0,0,r+.12,r+.15,.16,'#aaa18b',32);ring.material=stoneMaterial;
      if(f<6){
      const count=16,bricks=new THREE.InstancedMesh(geo('brick',()=>new THREE.BoxGeometry(1,1,1)),mat('#9f9a8d'),count);bricks.castShadow=true;bricks.receiveShadow=true;level.add(bricks);
      for(let b=0;b<count;b++){
        const a=b/16*Math.PI*2;
        position.set(Math.sin(a)*(r+.025),h-.16,Math.cos(a)*(r+.025));rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),a);scale.set(.22,.19,.21);matrix.compose(position,rotation,scale);bricks.setMatrixAt(b,matrix);bricks.setColorAt(b,new THREE.Color(stoneColors[(b+f+world.seed)%4]));
      }
      }
      const galleryWindows=f>=6&&f%6===5,windowY=galleryWindows?.18:.46,windowScale=galleryWindows?.7:1;
      for(let w=0;w<5;w++){const a=w/5*Math.PI*2+(f%2)*.1;if(facadeFree(a,level.position.y+windowY,r+.027))windowArch(level,a,windowY,r+.027,windowScale);}
      if(f%2===0||f===floors-1)balcony(level,freeAngle(f*.92+(world.seed%4),level.position.y+.15,r+.2),.15,r);
      if((f>=3 && (f%3===0||world.motifs.includes('garden')))||(world.mode==='sleep'&&world.motifs.includes('garden'))){const a=freeAngle(f*1.42,level.position.y+.31,r+.2);const planter=box(level,Math.sin(a)*(r+.18),.31,Math.cos(a)*(r+.18),.7,.34,.55,'#766d4a');planter.rotation.y=a;tree(level,Math.sin(a)*(r+.2),.5,Math.cos(a)*(r+.2),.55);}
      if(f%4===2&&facadeFree(Math.PI/2,level.position.y+.9,r+.1,.3)){const flag=mesh(geo('banner',()=>new THREE.PlaneGeometry(.45,1.3,3,10)),mat('#db875f'),level,r+.1,.9,0);flag.rotation.y=Math.PI/2;(flag.material as THREE.MeshLambertMaterial).side=THREE.DoubleSide;flags.push(flag);}
      // Every completed chapter leaves an architectural landmark in the skyline.
      // Open galleries and attached turrets break up the stack of identical floors.
      if(f%6===5){
        const gallery=floorHeight(f)-.12;
        const terrace=cylinder(level,0,gallery,0,r+1.08,r+.72,.24,'#a39d88',48);terrace.material=stoneMaterial;
        const railRadius=r+.99;
        for(let j=0;j<20;j++){
          const a=j/20*Math.PI*2,x=Math.sin(a)*railRadius,z=Math.cos(a)*railRadius;
          if(!facadeFree(a,level.position.y+gallery+.37,railRadius,.28))continue;
          box(level,x,gallery+.37,z,.07,.64,.07,'#706b54');
          const b=(j+1)/20*Math.PI*2;
          lineBeam(level,[x,gallery+.69,z],[Math.sin(b)*railRadius,gallery+.69,Math.cos(b)*railRadius],.06,'#867c60');
          if(j%4===2){const support=box(level,Math.sin(a)*(r+.31),gallery-.31,Math.cos(a)*(r+.31),.2,.45,.68,'#aaa18b');support.rotation.y=a;support.material=stoneMaterial;lineBeam(level,[Math.sin(a)*(r+.05),gallery-1.04,Math.cos(a)*(r+.05)],[Math.sin(a)*(r+.87),gallery-.14,Math.cos(a)*(r+.87)],.16,'#8c8066');}
        }
        for(let j=0;j<2&&f<floors-1;j++){
          const a=(f-5)/6*1.45+.72+Math.PI/2+j*Math.PI,rr=r+.68;
          if(!facadeFree(a,level.position.y+gallery+.17,rr,.65))continue;
          const planter=box(level,Math.sin(a)*rr,gallery+.22,Math.cos(a)*rr,.72,.25,.7,'#797657');planter.rotation.y=a;
          tree(level,Math.sin(a)*rr,gallery+.35,Math.cos(a)*rr,.46,true);
        }
        for(let j=0;j<2;j++){
          const a=(f-5)/6*1.45+.72+j*Math.PI,g=new THREE.Group();g.position.set(Math.sin(a)*(r+.25),gallery-1.55,Math.cos(a)*(r+.25));g.rotation.y=a;level.add(g);
          const foot=cylinder(g,0,-.05,0,.53,.2,.65,'#9f9780',16);foot.material=stoneMaterial;
          const body=cylinder(g,0,1.03,0,.48,.53,1.8,'#a99c83',24);body.material=stoneMaterial;
          windowArch(g,0,.58,.53,.67);
          cylinder(g,0,1.95,0,.59,.59,.13,'#776e58',24);
          storyRoof(g,2.42,.65,.88,j%2?'#65aaa0':'#478e91');
          cylinder(g,0,2.99,0,.018,.032,.37,'#ac9162',8);
          sphere(g,0,3.19,0,.055,'#b4a17b');
        }
      }
      batchStatic(level,new Set<THREE.Object3D>([...windows,...flags,...treeCrowns]));
      if(f>=previousFloors){level.userData.born=time+Math.max(0,f-previousFloors)*.08;level.userData.finishY=level.position.y;level.scale.y=reduced?1:.02;animatedFloors.push(level);}
    }
    // Individual buttresses strengthen the tower, visibly changing with health.
    for(let j=0;j<6;j++){
      const angle=j/6*Math.PI*2,r=2.78;const g=new THREE.Group();g.rotation.y=angle;tower.add(g);
      const height=floors?Math.min(5.7,floors*1.6):.45;
      const buttress=box(g,0,height*.5,r,.42,height,.58,'#a09984');buttress.material=stoneMaterial;
      lineBeam(g,[0,.2,r+.9],[0,height,r-.15],.27,'#8a806b');
    }
    craneY=.5+towerHeight(floors);
    const scaffold=new THREE.Group();scaffold.position.y=craneY;tower.add(scaffold);
    for(const x of [-1.8,1.8])for(const z of [-1.8,1.8])box(scaffold,x,.85,z,.12,2.5,.12,'#826646');
    // Bracing behind and beside the work area, never through its front benches.
    for(const side of [-1,1]){
      lineBeam(scaffold,[side*1.8,-.3,-1.8],[-side*1.8,1.65,-1.8],.065,'#80664a');
      lineBeam(scaffold,[side*1.8,-.3,-1.8],[side*1.8,1.65,1.8],.065,'#80664a');
    }
    for(const x of [-1.7,1.7])lineBeam(scaffold,[x,.15,2.05],[x*.58,-1.35,1.1],.12,'#715638');
    for(let i=0;i<9;i++)box(scaffold,-1.8+i*.45,.28,1.9,.4,.1,.75,'#9b7b50');
    box(scaffold,1.75,2.1,1.6,.16,4.2,.16,'#997a50');
    const boomStart=CRANE_TIP_X-.2,boomEnd=2.4;
    box(scaffold,(boomStart+boomEnd)/2,4.1,1.6,boomEnd-boomStart,.16,.17,'#a48657');
    lineBeam(scaffold,[1.7,2.8,1.6],[CRANE_TIP_X,4.1,1.6],.08,'#725937');
    workers.forEach((w,i)=>{
      if(!w.working)return;
      const station=workStation(i/4,floors),g=new THREE.Group();
      g.position.set(station.x,craneY+station.y,station.z);g.rotation.y=station.angle;g.scale.copy(w.root.scale);tower.add(g);
      // Low mason's bench. The workpiece meets the hammer, not an arbitrary height.
      for(const x of [-.22,.22])for(const z of [WORK_DEPTH-.085,WORK_DEPTH+.085])box(g,x,.126,z,.044,.252,.044,'#826646');
      box(g,0,.25,WORK_DEPTH,.54,.05,.25,'#9b7b50');
      for(const x of [-.22,.22])lineBeam(g,[x,.08,WORK_DEPTH-.095],[x,.21,WORK_DEPTH+.095],.026,'#80664a');
      if(i%8===0){
        const stone=box(g,.055,(WORK_SURFACE+.276)/2,WORK_DEPTH,.33,WORK_SURFACE-.276,.19,'#aaa18b');stone.material=stoneMaterial;
        for(let chip=0;chip<3;chip++)sphere(g,-.14-chip*.055,.285,WORK_DEPTH-.075+chip*.055,.018,'#a8a28f');
      }else{
        box(g,0,(WORK_SURFACE+.276)/2,WORK_DEPTH,.5,WORK_SURFACE-.276,.18,'#a48657');
        for(const x of [-.11,.107])cylinder(g,x,WORK_SURFACE+.001,WORK_DEPTH,.009,.009,.012,'#65716f',6);
      }
      // Offcuts below the bench stay out of the resident's standing footprint.
      for(let j=0;j<3;j++)box(g,-.13+j*.12,.035,WORK_DEPTH+.09,.095,.06,.11,'#aba18b');
    });
    craneHook.position.set(CRANE_TIP_X,craneY+4.1,1.6);tower.add(craneHook);
    if(floors>=2) {
      const door=windowArch(tower,Math.PI*.13,.18,2.53,1.75);door.children[0].userData.unlit=true;
      box(tower,.93,.12,2.92,1.2,.13,1.2,'#a69c85');
    }
    if(world.motifs.includes('library') && floors>=2){const g=new THREE.Group();g.position.set(wings.length?-1.1:-3,4.4,wings.length?2.5:-.2);tower.add(g);box(g,0,0,0,1.35,1.1,1,'#665742');for(let i=0;i<8;i++)box(g,-.48+i*.13,0,.53,.085,.65,.07,['#9e7950','#748575','#9d5f43'][i%3]);cylinder(g,0,.93,0,0,1.1,.7,'#6b624e',4);}
    if(world.motifs.includes('observatory')&&floors>=3){const g=new THREE.Group();g.position.set(0,craneY+.8,0);tower.add(g);const dome=mesh(geo('dome',()=>new THREE.SphereGeometry(1.4,20,12,0,Math.PI*2,0,Math.PI/2)),mat('#6b8b83',.4),g);const telescope=cylinder(g,.9,.4,0,.12,.19,1.7,'#ba9a63',12);telescope.rotation.z=-1.05;}
    if(world.motifs.includes('forge')&&floors>=1){house(settlement,3.6,-1.7,.85);cylinder(settlement,3.95,4.8,-1.7,.23,.3,2.3,'#747369',8);sphere(settlement,3.95,6.1,-1.7,.3,'#9a9693');}
    if(world.motifs.includes('garden'))for(let i=0;i<5;i++)tree(dynamicProps,-2.5+i*.5,3, -3.8,.75);
    workers.forEach((worker,i)=>{worker.route=makeWalkRoute(navigationObstacles,world.seed+i*127);});
    plantGrass();
    // The paths follow the same safe graph as the residents.
    workers.slice(0,3).forEach(w=>{for(let j=0;j<w.route.length-1;j++){
      const a=w.route[j],b=w.route[j+1],n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.35);
      for(let k=0;k<n;k++){const t=k/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,p=box(dynamicProps,x,groundHeight(x,z,navigationObstacles)+.016,z,.25,.025,.28,'#8d8b70');p.rotation.y=Math.atan2(b.x-a.x,b.z-a.z)+(k%3-1)*.13;}
    }});
    batchStatic(dynamicProps,new Set(treeCrowns));batchStatic(settlement,new Set(windows));
  }

  type Falling={mesh:THREE.Mesh;velocity:THREE.Vector3;spin:THREE.Vector3;age:number;fragment?:boolean};
  const falling:Falling[]=[];
  const scars:THREE.Mesh[]=[];
  const conditionVisual=createTowerRuins(scene,world.seed,MATERIALS[world.material].color,reduced,quality,(x,z)=>rimSurfaceHeight(x,z,navigationObstacles));
  let conditionFloors=floors;
  const splashMat=new THREE.MeshBasicMaterial({color:'#bed7d1',transparent:true,opacity:.6,side:THREE.DoubleSide,depthWrite:false});materials.set('splash',splashMat);
  const splashes:{mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;age:number;size:number}[]=[];
  function splash(x:number,z:number,size:number){
    const y=waterHeight(x,z,time,environment.storm())+.04,o=new THREE.Mesh(geo('splash',()=>new THREE.RingGeometry(.82,1,32)),splashMat.clone());o.position.set(x,y,z);o.rotation.x=-Math.PI/2;scene.add(o);splashes.push({mesh:o,age:0,size});
    for(let i=0;i<5;i++){const drop=mesh(geo('drop',()=>new THREE.IcosahedronGeometry(.045,0)),mat('#a6c6c8',.8,true),scene,x,y+.05,z);falling.push({mesh:drop,velocity:new THREE.Vector3((random()-.5)*size,1.5+random()*2,(random()-.5)*size),spin:new THREE.Vector3(),age:0});}
  }
  function fall(kind:SceneEvent){
    if(kind==='arrival'){const arriving=boats[1]??boats[0];if(arriving)arriving.userData.arrival=reduced?0:1;return;}
    if(floors===0)return;
    const count=1;
    const localHeight=Math.max(1,towerHeight(floors)*(.45+random()*.45)),radius=towerWallRadius(floors,localHeight);
    let direction=controls.getAzimuthalAngle()+.65;
    const wings=towerWings(floors);
    for(let attempt=0;attempt<14;attempt++){
      const candidate=controls.getAzimuthalAngle()+.65+attempt*.25;
      if(wings.every(w=>localHeight>towerHeight(w.levels)+2.5||Math.hypot(Math.sin(candidate)*radius-w.x,Math.cos(candidate)*radius-w.z)>1.4)){direction=candidate;break;}
    }
    tower.updateWorldMatrix(true,false);
    const outward=new THREE.Vector3(Math.sin(direction),0,Math.cos(direction)).transformDirection(tower.matrixWorld);
    for(let i=0;i<count && falling.length<55;i++){
      const size=kind==='collapse'?1.05:.22+random()*.15;
      const origin=tower.localToWorld(new THREE.Vector3(Math.sin(direction)*(radius+size*.35),localHeight,Math.cos(direction)*(radius+size*.35)));
      const b=box(scene,origin.x,origin.y,origin.z,size*1.4,size,size,stoneColors[i%4]);b.quaternion.copy(tower.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(waterUp,direction));
      const velocity=outward.clone().multiplyScalar(1.8+random());velocity.y+=.2;
      falling.push({mesh:b,velocity,spin:new THREE.Vector3(random()*2,random()*3,random()*2),age:0,fragment:kind==='collapse'});
    }
    // A dark inset remains where the masonry came loose, rather than hovering fragments.
    const arc=kind==='collapse'?.55:.16;
    const scar=mesh(geo(`curved-scar-${kind}`,()=>new THREE.CylinderGeometry(1,1,1,12,1,true,-arc/2,arc)),mat('#343a35'),tower,0,localHeight,0);
    scar.scale.set(radius+.018,kind==='collapse'?.8:.25,radius+.018);scar.rotation.y=direction;scar.castShadow=false;
    scars.push(scar);if(scars.length>18)scars.shift()?.removeFromParent();
  }

  function setWeather(){
    shadowClock.invalidate();
    environment.weather(world.weather,floors);
    const dusk=world.weather==='sunset';
    sun.position.set(-26,dusk?8:42,dusk?-34:34);sun.color.set(dusk?'#ffbe86':'#ffddb0');
    sun.intensity=world.weather==='sun'?1.65:world.weather==='rain'?.65:dusk?1.8:1.15;
    ambient.intensity=world.weather==='rain'?1.7:dusk?1.55:1.8;
    ambient.color.set(dusk?'#eed4e9':'#d8f1ef');rim.intensity=dusk?.6:.65;
    renderer.toneMappingExposure=1.03;
    glowMat.color.set('#ffc17c').multiplyScalar(dusk?2.1:world.weather==='rain'?1.8:1.25);
    if(bloom)bloom.strength=dusk?.15:.1;
  }
  function pointCamera(height:number,radius:number,angle=controls.getAzimuthalAngle()){
    controls.maxDistance=Math.max(165,overviewRadius()*1.5);
    targetHeight=height;desiredRadius=radius;desiredAngle=angle;cameraTween=1;
  }
  function overviewFloors(){return conditionVisual.phase==='falling'?conditionFloors:floors;}
  function overviewRadius(){const count=overviewFloors(),halfFov=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));return Math.max(count>0?35:29,(5+towerHeight(count)/2)/halfFov*1.45,8.2/(halfFov*camera.aspect));}
  function overviewHeight(){const count=overviewFloors();return count?3.8+towerHeight(count)/2:3.3;}
  function update(next:WorldState){
    const previous=floors,previousStrength=world.strength;world=next;floors=floorsOf(world);
    if(world.strength>previousStrength){scars.splice(0,Math.ceil(scars.length*.5)).forEach(s=>s.removeFromParent());}
    const key=`${floors}/${world.motifs.join(',')}`;
    if(lastKey!==key){buildTower(previous);lastKey=key;if(floors!==previous){pointCamera(overviewHeight(),overviewRadius());}}
    setWeather();
  }
  update(world);camera.position.set(19,14,24);controls.target.set(0,floors?3+floors:3.3,0);
  pointCamera(overviewHeight(),overviewRadius(),.67);
  const interaction=()=>{manualCamera=true;cameraTween=0;};controls.addEventListener('start',interaction);
  const touchView=()=>({angle:cameraTween?desiredAngle:controls.getAzimuthalAngle(),distance:cameraTween?desiredRadius:Math.hypot(camera.position.x-controls.target.x,camera.position.z-controls.target.z),height:cameraTween?targetHeight:controls.target.y});
  const touch=sceneTouch(renderer.domElement,dx=>{const v=touchView();manualCamera=true;pointCamera(v.height,v.distance,v.angle-dx/Math.max(1,host.clientWidth)*Math.PI*.84);},factor=>{const v=touchView();manualCamera=true;pointCamera(v.height,THREE.MathUtils.clamp(v.distance*factor,9,controls.maxDistance/1.02),v.angle);});
  const resize=()=>{const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;renderer.setSize(width,height);composer?.setSize(width,height);
    // Only the already-blurred glow uses a smaller buffer. The main image,
    // MSAA, shadow map and planar reflection keep their original resolutions.
    const glowScale=renderer.getPixelRatio()*.75;bloom?.setSize(Math.ceil(width*glowScale),Math.ceil(height*glowScale));
    camera.aspect=width/height;camera.updateProjectionMatrix();if(!manualCamera)pointCamera(overviewHeight(),overviewRadius(),desiredAngle);};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const contextLost=(e:Event)=>{e.preventDefault();host.dataset.context='lost';};
  renderer.domElement.addEventListener('webglcontextlost',contextLost);
  const waterUp=new THREE.Vector3(0,1,0),waterNormal=new THREE.Vector3(),boatHeading=new THREE.Quaternion(),boatDamage=new THREE.Quaternion(),boatForward=new THREE.Vector3(0,0,1);

  function animate(now:number){
    if(stopped)return;frame=requestAnimationFrame(animate);
    if(document.hidden){last=now;return;}
    if(now-last<30)return;
    const frameStarted=performance.now();timing.begin();
    const dt=Math.min((now-last)/1000,.08);last=now;const animationDt=dt*Math.min(speed,3);if(!reduced)time+=animationDt;
    environment.update(time,dt,reduced,camera.position);wind.value=time;
    const wasCollapsing=conditionVisual.phase==='falling';conditionVisual.tick(dt);
    if(wasCollapsing&&conditionVisual.phase!=='falling'&&!manualCamera){const previousMax=controls.maxDistance;pointCamera(overviewHeight(),overviewRadius());controls.maxDistance=Math.max(previousMax,controls.maxDistance);}
    host.dataset.sceneConditionPhase=conditionVisual.phase;host.dataset.sceneRuinCount=String(conditionVisual.ruinCount);host.dataset.sceneConditionPieces=String(conditionVisual.fallingCount);
    const damage=Math.max(0,(65-world.strength)/47);
    const lean=damage*.092;
    tower.rotation.z=THREE.MathUtils.lerp(tower.rotation.z,lean+(reduced?0:Math.sin(time*.85)*damage*.009),.045);
    tower.rotation.x=THREE.MathUtils.lerp(tower.rotation.x,-lean*.35,.045);
    treeCrowns.forEach((c,i)=>{const breeze=world.weather==='rain'?2.1:1;c.rotation.z=reduced?0:Math.sin(time*.65+i)*.018*breeze;c.rotation.x=reduced?0:Math.sin(time*.5+i)*.012*breeze;});
    flags.forEach((f,i)=>{const p=f.geometry.attributes.position;if(reduced)return;for(let j=0;j<p.count;j++)p.setZ(j,Math.sin(p.getY(j)*3+time*1.4+i)*.045);p.needsUpdate=true;});
    if(!reduced)sails.forEach(s=>updateSail(s.mesh.geometry,time,s.phase));
    boats.forEach((b,i)=>{
      if(b.userData.arrival>0)b.userData.arrival=Math.max(0,b.userData.arrival-dt*.04);
      const approach=boatApproach(b.userData.baseX,b.userData.baseZ,b.userData.arrival,b.userData.heading);
      b.position.x=approach.x;
      b.position.z=approach.z;
      const storm=environment.storm(),sl=waterSlope(b.position.x,b.position.z,time,storm);
      b.position.y=waterHeight(b.position.x,b.position.z,time,storm)+.27-(i===0?damage*.42:0);
      b.quaternion.setFromUnitVectors(waterUp,waterNormal.set(-sl.dx,1,-sl.dz).normalize());
      b.quaternion.multiply(boatHeading.setFromAxisAngle(waterUp,approach.heading));
      if(i===0)b.quaternion.multiply(boatDamage.setFromAxisAngle(boatForward,damage*.26));
      boatWakes.update(i,b.position,time,dt,i===0?.68:1,storm,!reduced);
    });
    host.dataset.sceneWakePoints=String(boatWakes.count());
    let navViolations=0;
    workers.forEach((w,i)=>{
      const idle=world.strength<50&&i%2===0;
      const onScaffold=w.working;
      if(!reduced&&!idle&&!w.working)w.distance+=animationDt*.24;
      const p=pointOnRoute(w.route,w.distance);
      w.root.visible=onScaffold||w.route.length>0;w.root.position.set(p.x,groundHeight(p.x,p.z,navigationObstacles)+.012,p.z);w.root.rotation.set(0,p.angle,0);
      if(onScaffold){
        const station=workStation(i/4,floors),local=new THREE.Vector3(station.x,craneY+station.y,station.z);
        tower.updateWorldMatrix(true,false);w.root.position.copy(tower.localToWorld(local));w.root.quaternion.copy(tower.quaternion);w.root.rotateY(station.angle);
      }
      else if(w.root.visible&&!isWalkable(w.root.position,navigationObstacles,.2))navViolations++;
      residentRenderer.pose(w,time,onScaffold||w.working,idle,reduced);
    });
    residentRenderer.flush();
    host.dataset.sceneNavViolations=String(navViolations);
    craneRig.update(time,reduced);
    animatedFloors.forEach(g=>{const progress=reduced?1:THREE.MathUtils.clamp((time-g.userData.born)/1.8,0,1);g.scale.y=Math.max(.02,1-Math.pow(1-progress,3));});
    windowLighting.update(windows,world.strength);
    if(pendingBatch&&animatedFloors.every(g=>g.scale.y>.9999)){batchStatic(tower,new Set<THREE.Object3D>([...windows,...flags,...treeCrowns,craneHook]));pendingBatch=false;}
    for(let i=falling.length-1;i>=0;i--){const b=falling[i],beforeY=b.mesh.position.y;b.age+=dt;const step=dt;b.velocity.y-=6.8*step;b.mesh.position.addScaledVector(b.velocity,step);b.mesh.rotation.x+=b.spin.x*step;b.mesh.rotation.z+=b.spin.z*step;
      const p=b.mesh.position,r=Math.hypot(p.x,p.z),a=Math.atan2(p.z,p.x),ground=rimSurfaceHeight(p.x,p.z,navigationObstacles),sea=waterHeight(p.x,p.z,time,environment.storm());
      const hitTop=beforeY>=ground&&p.y<ground&&r<islandRadius(a);
      const hitSide=p.y<=cliffCrownHeight(a)&&p.y>sea&&r<cliffRadius(a,p.y),hitRock=hitTop||hitSide,hitWater=p.y<sea;
      if(b.fragment&&(hitRock||hitWater)){
        const p=b.mesh.position;
        for(let j=0;j<8&&falling.length<55;j++){const s=.2+random()*.23;const part=box(scene,p.x+(random()-.5)*.8,Math.max(sea+.08,p.y)+random()*.5,p.z+(random()-.5)*.8,s*1.4,s,s,stoneColors[j%4]);falling.push({mesh:part,velocity:new THREE.Vector3(b.velocity.x+(random()-.5)*4,1+random()*2,b.velocity.z+(random()-.5)*4),spin:new THREE.Vector3(random()*4,random()*3,random()*3),age:0});}
        if(!hitRock)splash(p.x,p.z,2);scene.remove(b.mesh);falling.splice(i,1);continue;
      }
      if(hitRock){const d=new THREE.Vector3(p.x,0,p.z).normalize();b.velocity.x=d.x*4;b.velocity.z=d.z*4;b.velocity.y=hitTop?1.2:.8;p.y=hitTop?ground+.04:p.y+.08;if(hitSide){const edge=cliffRadius(a,p.y)+.18;p.x=d.x*edge;p.z=d.z*edge;}}
      if(hitWater||b.age>12){const isStone=b.mesh.geometry===geometries.get('box');if(isStone&&hitWater)splash(p.x,p.z,b.mesh.scale.x*2);scene.remove(b.mesh);falling.splice(i,1);}
    }
    for(let i=splashes.length-1;i>=0;i--){const s=splashes[i];s.age+=dt;s.mesh.scale.setScalar((.15+s.age*1.5)*s.size);s.mesh.material.opacity=.6*Math.pow(Math.max(0,1-s.age/1.8),2);const p=s.mesh.position,slope=waterSlope(p.x,p.z,time,environment.storm());p.y=waterHeight(p.x,p.z,time,environment.storm())+.04;s.mesh.quaternion.setFromUnitVectors(boatForward,waterNormal.set(-slope.dx,1,-slope.dz).normalize());if(s.age>1.8){scene.remove(s.mesh);s.mesh.material.dispose();splashes.splice(i,1);}}
    host.dataset.sceneDebris=String(falling.length);host.dataset.sceneRipples=String(splashes.length);
    if(damage>.15&&!reduced){automaticStone+=dt*speed;automaticCollapse+=dt*speed;if(automaticStone>=600){fall('stone');automaticStone=0;}if(automaticCollapse>=3600){fall('collapse');automaticCollapse=0;}}
    if(cameraTween){
      const target=new THREE.Vector3(0,targetHeight,0);controls.target.lerp(target,.065);
      cameraGoal.set(Math.sin(desiredAngle)*desiredRadius,Math.max(8,targetHeight+desiredRadius*.15),Math.cos(desiredAngle)*desiredRadius);
      camera.position.lerp(cameraGoal,.06);if(camera.position.distanceTo(cameraGoal)<.03&&controls.target.distanceTo(target)<.03)cameraTween=0;
    }
    if(!manualCamera&&!cameraTween&&!reduced){const a=.67+Math.sin(time*.055)*.025;camera.position.x=Math.sin(a)*desiredRadius;camera.position.z=Math.cos(a)*desiredRadius;}
    controls.update();
    // Full-height views must not dissolve a tall tower into distance fog.
    distanceFog.density=.007*Math.min(1,55/camera.position.distanceTo(controls.target));
    host.dataset.sceneCameraAngle=controls.getAzimuthalAngle().toFixed(4);host.dataset.sceneCameraGoalAngle=desiredAngle.toFixed(4);host.dataset.sceneCameraGoalRadius=desiredRadius.toFixed(2);
    host.dataset.sceneFloors=String(floors);host.dataset.sceneGarden=String(world.motifs.includes('garden'));
    host.dataset.sceneCameraTarget=controls.target.y.toFixed(2);host.dataset.sceneCameraDistance=camera.position.distanceTo(controls.target).toFixed(2);
    renderer.info.reset();renderer.shadowMap.needsUpdate=quality==='high'&&shadowClock.due(now,conditionVisual.phase==='falling'||falling.length>0||animatedFloors.some(g=>g.scale.y<.9999));
    host.dataset.sceneShadowUpdated=String(renderer.shadowMap.needsUpdate);
    const prepared=performance.now();if(composer)composer.render();else renderer.render(scene,camera);timing.end();
    preparationMs+=prepared-frameStarted;submissionMs+=performance.now()-prepared;reflectionMs+=environment.reflectionSubmitMs();
    measuredFrames++;if(now-measurementStart>2000){host.dataset.sceneFps=String(Math.round(measuredFrames*1000/(now-measurementStart)));host.dataset.sceneDrawCalls=String(renderer.info.render.calls);
      host.dataset.scenePrepareMs=(preparationMs/measuredFrames).toFixed(2);host.dataset.sceneSubmitMs=(submissionMs/measuredFrames).toFixed(2);host.dataset.sceneReflectionMs=(reflectionMs/measuredFrames).toFixed(2);host.dataset.sceneGpuMs=timing.milliseconds()?.toFixed(2)??'unavailable';
      const gpu=timing.summary();host.dataset.sceneGpuSamples=String(gpu?.samples??0);
      host.dataset.sceneGpuMeanMs=gpu?.mean.toFixed(2)??'unavailable';host.dataset.sceneGpuMinMs=gpu?.min.toFixed(2)??'unavailable';host.dataset.sceneGpuMaxMs=gpu?.max.toFixed(2)??'unavailable';
      host.dataset.sceneReflectionGpuMs=timing.milliseconds('reflection')?.toFixed(2)??'unavailable';
      host.dataset.sceneBloomGpuMs=timing.milliseconds('bloom')?.toFixed(2)??'unavailable';
      host.dataset.sceneShadowGpuMs=timing.milliseconds('shadows')?.toFixed(2)??'unavailable';host.dataset.sceneTriangles=String(renderer.info.render.triangles);
      measurementStart=now;measuredFrames=0;preparationMs=0;submissionMs=0;reflectionMs=0;}
  }
  frame=requestAnimationFrame(animate);
  return {
    update,
    damage(view,animate=false){conditionVisual.set(view,animate);if(view&&conditionVisual.phase==='falling')conditionFloors=view.earnedFloors;shadowClock.invalidate();if(view&&animate&&conditionVisual.phase==='falling'&&!manualCamera){
      const height=overviewHeight(),radius=overviewRadius();
      pointCamera(height,radius);controls.maxDistance=Math.max(controls.maxDistance,radius*1.5);
      if(measuredFrames===0){camera.position.set(Math.sin(desiredAngle)*radius,Math.max(8,height+radius*.15),Math.cos(desiredAngle)*radius);controls.target.set(0,height,0);cameraTween=0;}
    }},
    camera(action){manualCamera=true;
      // Consecutive button presses modify the destination, not an intermediate frame.
      const angle=cameraTween?desiredAngle:controls.getAzimuthalAngle();
      const distance=cameraTween?desiredRadius:Math.hypot(camera.position.x-controls.target.x,camera.position.z-controls.target.z);
      const height=cameraTween?targetHeight:controls.target.y;
      if(action==='reset'){manualCamera=false;pointCamera(overviewHeight(),overviewRadius(),.67);}
      else if(action==='home'){pointCamera(3.3,29,.67);}
      else if(action==='overview')pointCamera(overviewHeight(),overviewRadius(),angle);
      else if(action==='top')pointCamera(4.8+towerHeight(floors),16,angle);
      else if(action==='left'||action==='right')pointCamera(height,distance,angle+(action==='left'?-.38:.38));
      else pointCamera(height,THREE.MathUtils.clamp(distance*(action==='in'?.8:1.25),9,controls.maxDistance/1.02),angle);
    },
    height(fraction){manualCamera=true;pointCamera(3+Math.max(0,Math.min(1,fraction))*towerHeight(floors),Math.min(35,camera.position.distanceTo(controls.target)));},
    event:fall,speed(value){speed=Math.max(1,Math.min(120,value));},
    capture(){renderer.shadowMap.needsUpdate=quality==='high';if(composer)composer.render();else renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');},
    dispose(){stopped=true;cancelAnimationFrame(frame);observer.disconnect();touch.dispose();controls.dispose();timing.dispose();conditionVisual.dispose();craneRig.dispose();residentRenderer.dispose();boatWakes.dispose();windowLighting.dispose();environment.dispose();bloom?.dispose();output?.dispose();composer?.dispose();splashes.forEach(s=>s.mesh.material.dispose());scene.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});renderer.domElement.removeEventListener('webglcontextlost',contextLost);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();},
  };
}





