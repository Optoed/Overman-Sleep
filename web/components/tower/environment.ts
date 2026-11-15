import * as THREE from 'three';
import { seeded, floorsOf, type WorldState, type Weather } from './world-state';
import { waterFieldGLSL, growthFog } from './world-physics';
import { alpineGeometry } from './alpine-terrain';
import { rockMaterial } from './rock-material';
import { terrainScatter } from './terrain-scatter';
import { geometryPass } from './geometry-pass';
import { cloudVolume,cloudSkyFragment } from './cloud-volume';
import { rippleTexture,rippleGradientGLSL } from './ripple-texture';
import { mountainFogGLSL,mountainFogFragment } from './atmosphere';
import type { frameTiming } from './frame-timing';
import { coastShader } from './island-shape';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainNoise, terrainFbm } from './terrain-noise';
export { terrainNoise, terrainFbm } from './terrain-noise';

// Continuous value noise: shared vertices always receive exactly the same displacement.

const noiseGLSL=`
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=mat2(.8,.6,-.6,.8)*p*2.04+7.1;a*=.5;}return v;}
`;

export function createEnvironment(scene:THREE.Scene, world:WorldState, quality:'high'|'low',renderer:THREE.WebGLRenderer,timing?:ReturnType<typeof frameTiming>) {
  const root=new THREE.Group();scene.add(root);
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
  function geometry<T extends THREE.BufferGeometry>(g:T){geometries.push(g);return g;}
  function material<T extends THREE.Material>(m:T){materials.push(m);return m;}
  const random=seeded(world.seed+9421);
  let disposed=false,progress=floorsOf(world)/12,opening=Math.min(1,progress);
  const uniforms={uTime:{value:0},uStorm:{value:0},uMist:{value:.5},uDusk:{value:0},uSun:{value:new THREE.Vector3(-.55,.43,.72).normalize()},uHorizon:{value:new THREE.Color('#b9cac8')},uZenith:{value:new THREE.Color('#3b7186')}};
  const cloudDensityTexture=cloudVolume();textures.push(cloudDensityTexture);
  const cloudMaterial=material(new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
    uniforms:{...uniforms,uCloudVolume:{value:cloudDensityTexture}},
    vertexShader:`varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:cloudSkyFragment(quality==='high'?5:3)}));
  const skyCache=new THREE.WebGLCubeRenderTarget(quality==='high'?512:256,{type:THREE.HalfFloatType,generateMipmaps:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false});
  const skyCamera=new THREE.CubeCamera(.1,600,skyCache),cloudScene=new THREE.Scene();
  cloudScene.add(new THREE.Mesh(geometry(new THREE.SphereGeometry(560,16,12)),cloudMaterial));
  const skyMaterial=material(new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
    uniforms:{uSky:{value:skyCache.texture}},
    // Infinite sky: neither the elevated viewer nor the reflected camera
    // should translate its horizon relative to the water.
    vertexShader:`varying vec3 vDirection;void main(){vDirection=position;vec4 clip=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=clip.xyww;}`,
    fragmentShader:`varying vec3 vDirection;uniform samplerCube uSky;void main(){gl_FragColor=textureCube(uSky,normalize(vDirection));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`}));
  let skyUpdated=-Infinity,skyWeather=-100;
  const sky=new THREE.Mesh(geometry(new THREE.SphereGeometry(560,32,20)),skyMaterial);root.add(sky);

  const reflector=new Reflector(geometry(new THREE.PlaneGeometry(2,2)),{textureWidth:640,textureHeight:640,multisample:0,clipBias:.003});
  reflector.rotation.x=-Math.PI/2;reflector.position.y=-.2;reflector.updateMatrixWorld();
  const reflectionUniforms=(reflector.material as THREE.ShaderMaterial).uniforms;
  const rippleMap=rippleTexture();textures.push(rippleMap);
  const waterUniforms={...uniforms,uRipple:{value:rippleMap},uSky:{value:skyCache.texture},uDeep:{value:new THREE.Color('#369ba5')},uShallow:{value:new THREE.Color('#8be2c4')},uReflection:reflectionUniforms.tDiffuse,uReflectionMatrix:reflectionUniforms.textureMatrix,uReflect:{value:quality==='high'?1:0}};
  const waveGLSL=`
    ${waterFieldGLSL}
    float waveHeight(vec2 p){return waterField(p).x*(1.+uStorm*.85);}
  `;
  const waterMaterial=material(new THREE.ShaderMaterial({uniforms:waterUniforms,vertexShader:`
    uniform float uTime,uStorm;uniform mat4 uReflectionMatrix;varying vec3 vWorld;varying vec4 vReflection;${waveGLSL}
    void main(){vec3 p=position;p.z+=waveHeight(vec2(p.x,-p.y));vReflection=uReflectionMatrix*vec4(p,1.);vec4 w=modelMatrix*vec4(p,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}
  `,fragmentShader:`
    uniform float uTime,uStorm,uMist,uReflect;uniform sampler2D uReflection;uniform samplerCube uSky;uniform vec3 uSun,uHorizon,uZenith,uDeep,uShallow;varying vec3 vWorld;varying vec4 vReflection;
    ${noiseGLSL}${waveGLSL}${coastShader}
    ${rippleGradientGLSL}
    void main(){vec2 p=vWorld.xz;
      float footprint=max(length(dFdx(p)),length(dFdy(p)));
      vec3 wave=waterField(p,footprint)*(1.+uStorm*.85);
      mat2 turn=mat2(.8,.6,-.6,.8);
      vec2 flow=vec2(uTime*.13,-uTime*.08);
      // Meso-scale chop survives after individual capillary ripples become
      // subpixel. Analytic gradients avoid repeated height samples.
      vec2 chop=transpose(turn)*rippleGradient(turn*p*.62+flow*.43)*.095*(1.-smoothstep(.6,3.2,footprint));
      chop+=rippleGradient(p*.31-flow*.27+vec2(13.7,4.1))*.065*(1.-smoothstep(1.2,5.4,footprint));
      vec2 small=rippleGradient(p*3.8+flow)*.048*(1.-smoothstep(.04,.42,footprint));
      small+=transpose(turn)*rippleGradient(turn*p*7.3-flow*1.7)*.026*(1.-smoothstep(.02,.2,footprint));
      vec2 surfaceSlope=-wave.yz+(chop*.6+small*.25)*(1.+uStorm*.7);
      vec3 N=normalize(vec3(surfaceSlope.x,1.,surfaceSlope.y));vec3 V=normalize(cameraPosition-vWorld);vec3 R=reflect(-V,N);
      float fresnel=.025+.38*pow(1.-max(dot(N,V),0.),5.);float d=length(p);
      float edge=d<12.?d-coastRadius(atan(p.y,p.x)):d-6.;
      float shore=1.-smoothstep(-.1,3.4,edge);
      vec3 c=mix(uDeep,uShallow,shore*.72);vec3 reflected=mix(uHorizon,uZenith,clamp(R.y*.8,0.,1.));
      if(uReflect>.5){
        vec3 viewSlope=mat3(viewMatrix)*vec3(N.x,0.,N.z);
        vec2 reflectionUV=vReflection.xy/vReflection.w+viewSlope.xy*vec2(.025,.065);
        float spread=.0015+uStorm*.0015+smoothstep(.25,2.5,footprint)*.002;
        reflectionUV=clamp(reflectionUV,.008,.992);
        // A short vertical lobe softens wave-scattered reflections while
        // retaining the actual silhouette, without another render pass.
        vec3 sceneReflection=texture2D(uReflection,reflectionUV).rgb*.5;
        sceneReflection+=texture2D(uReflection,reflectionUV+vec2(.0005,spread)).rgb*.25;
        sceneReflection+=texture2D(uReflection,reflectionUV-vec2(.0005,spread)).rgb*.25;
        reflected=mix(reflected,sceneReflection,.8);
      }else{
        float cloud=fbm(R.xz*4.+uTime*.003);reflected=mix(reflected,vec3(.46,.56,.61),smoothstep(.45,.7,cloud)*.2);
        float reflectedRidge=fbm(normalize(R.xz)*3.7)*.25;reflected=mix(reflected,vec3(.08,.16,.18),(1.-smoothstep(reflectedRidge-.025,reflectedRidge+.05,R.y))*.6);
      }
      c=mix(c,reflected,clamp(fresnel+.045*uReflect,0.,.88));vec3 H=normalize(V+uSun);float spec=pow(max(dot(N,H),0.),160.)*.42+pow(max(dot(N,H),0.),32.)*.09;
      c+=vec3(1.,.79,.48)*spec*(1.-uStorm*.88);
      float foam=0.;if(d<10.){
      float patches=noise(p*.77+vec2(uTime*.045,-uTime*.028));
      float surge=sin(uTime*.92+patches*5.+atan(p.y,p.x)*2.)*.5+.5;
      float runup=.06+surge*.38+wave.x*.65;
      float front=exp(-pow((edge-runup)*4.8,2.));
      float cells=noise(p*8.2+flow*.6);
      float breakup=smoothstep(.3,.73,patches)*smoothstep(.26,.66,cells);
      foam=front*breakup*(.24+surge*.58)*smoothstep(-.18,.08,edge);
      float trailing=exp(-pow((edge-runup-.34)*2.8,2.))*smoothstep(.62,.87,cells)*smoothstep(.45,.75,patches);
      foam+=trailing*.18*(1.-surge);
      }
      c=mix(c,vec3(.86,.98,.90),foam*.72);float distanceFog=1.-exp(-length(cameraPosition-vWorld)*(.0035+uMist*.003+uStorm*.002));
      float horizonBlend=smoothstep(170.,600.,length(cameraPosition-vWorld));
      c=mix(c,uHorizon,min(.9,distanceFog)*.7);
      if(horizonBlend>0.)c=mix(c,textureCube(uSky,normalize(vWorld-cameraPosition)).rgb,horizonBlend);
      gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` }));
  const waterGeometry=geometry(new THREE.PlaneGeometry(2,2,quality==='high'?256:128,quality==='high'?256:128));
  const wp=waterGeometry.attributes.position;const spread=(v:number)=>Math.sign(v)*(Math.abs(v)*22+Math.pow(Math.abs(v),4)*1578);
  for(let i=0;i<wp.count;i++)wp.setXY(i,spread(wp.getX(i)),spread(wp.getY(i)));waterGeometry.computeBoundingSphere();
  const water=new THREE.Mesh(waterGeometry,waterMaterial);water.rotation.x=-Math.PI/2;water.position.y=-.2;root.add(water);
  let reflectionSubmitMs=0;const reflectedTerrain=geometryPass();
  if(quality==='high')water.onBeforeRender=(r,s,c)=>{const started=performance.now();timing?.begin('reflection');water.visible=false;
    try{reflectedTerrain.run(()=>reflector.onBeforeRender(r,s,c,reflector.geometry,reflector.material as THREE.Material,null as unknown as THREE.Group));}
    finally{water.visible=true;timing?.end('reflection');reflectionSubmitMs+=performance.now()-started;}
  };

  // Alpine massifs behind lower, overlapping wooded foothills. The near shore stays
  // well outside the island's orbit, with coves rather than a continuous vertical wall.
  const terrainLighting={direction:{value:new THREE.Vector3(-26,42,34).normalize()},overcast:{value:0}};
  const alpineMaterial=material(rockMaterial(textures,world.biome==='coast'?34:world.biome==='alpine'?17:23,terrainLighting));
  const distantMaterial=material(rockMaterial(textures,world.biome==='coast'?53:world.biome==='alpine'?29:36,terrainLighting));
  // Two shared silhouettes replace the uniform field of tiny cones. All
  // components use non-indexed geometry so the merged meshes share attributes.
  const forestShape=(round:boolean)=>{
    const parts:THREE.BufferGeometry[]=[];
    const add=(g:THREE.BufferGeometry,color:string)=>{
      const piece=g.index?g.toNonIndexed():g;if(piece!==g)g.dispose();
      const c=new THREE.Color(color),colors=new Float32Array(piece.attributes.position.count*3);
      for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}
      piece.setAttribute('color',new THREE.BufferAttribute(colors,3));
      // Icosahedra, cones and trunks already carry position, normal and UV.
      parts.push(piece);
    };
    const trunk=new THREE.CylinderGeometry(.055,.085,.85,5);trunk.translate(0,.425,0);add(trunk,'#a99a6d');
    if(round){
      for(const [x,y,z,r] of [[-.26,1.04,0,.55],[.3,1.18,.09,.57],[0,1.55,-.03,.53]]){
        const crown=new THREE.IcosahedronGeometry(r,0);crown.scale(1,1.12,1);crown.translate(x,y,z);add(crown,y>1.4?'#cee4aa':'#a4cc94');
      }
    }else{
      for(let tier=0;tier<2;tier++){
        const crown=new THREE.ConeGeometry(.64-tier*.24,1.3-tier*.2,6);crown.rotateY(tier*.43);crown.translate(0,1.02+tier*.59,0);
        add(crown,['#77b09a','#bed9b1'][tier]);
      }
    }
    const merged=geometry(mergeGeometries(parts)!);parts.forEach(p=>p.dispose());return merged;
  };
  const forestGeometries=[forestShape(false),forestShape(true)];
  const forestMaterial=material(new THREE.MeshLambertMaterial({vertexColors:true}));
  forestMaterial.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 forestWorldPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      forestWorldPosition=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;`);
    shader.fragmentShader='varying vec3 forestWorldPosition;\n'+mountainFogGLSL+'\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',mountainFogFragment('forestWorldPosition'));
  };
  forestMaterial.customProgramCacheKey=()=> 'alpine-forest-height-fog';
  Promise.all([alpineGeometry(quality==='high'?96:64),alpineGeometry(quality==='high'?72:48),alpineGeometry(quality==='high'?64:40),quality==='high'?alpineGeometry(48):null,quality==='high'?alpineGeometry(40):null]).then(([g,foothills,distant,reflectedMassif,reflectedRidge])=>{
    if(disposed){g.dispose();foothills.dispose();distant.dispose();reflectedMassif?.dispose();reflectedRidge?.dispose();return;}
    geometry(g);geometry(foothills);geometry(distant);if(reflectedMassif)geometry(reflectedMassif);if(reflectedRidge)geometry(reflectedRidge);
    // A second, overlapping range closes the open ocean gaps between the near
    // massifs. Its coarse shared DEM retains the measured silhouette and fixed
    // normal derivatives without paying for foreground tessellation at 350 m.
    const elevations=[2.05,1.7,2.2,1.8,2.1,1.7,2.15,1.95,1.8];
    for(let i=0;i<elevations.length;i++){
      const angle=i/elevations.length*Math.PI*2+.42,radius=344+(i%3)*9;
      const land=new THREE.Mesh(distant,distantMaterial);
      if(reflectedRidge)reflectedTerrain.add(land,reflectedRidge);
      land.position.set(Math.sin(angle)*radius,-3,Math.cos(angle)*radius);
      land.rotation.y=angle+.93+i*1.71;
      land.scale.set(1.9+(i%2)*.12,elevations[i],1.74+(i%3)*.07);
      land.receiveShadow=true;root.add(land);
    }
    for(let i=0;i<5;i++){
      const angle=i/5*Math.PI*2+.2,land=new THREE.Mesh(g,alpineMaterial);
      if(reflectedMassif)reflectedTerrain.add(land,reflectedMassif);
      land.position.set(Math.sin(angle)*215,-2-(i%2)*3,Math.cos(angle)*215);
      land.rotation.y=angle+.6+i*1.37;land.scale.set(.9+(i%3)*.12,1.05+(i%3)*.18,.9+(i%3)*.12);land.receiveShadow=true;root.add(land);
    }
    for(let i=0;i<5;i++){
      const angle=i/5*Math.PI*2+.64,land=new THREE.Mesh(foothills,alpineMaterial),radius=184+(i%2)*13;
      if(reflectedRidge)reflectedTerrain.add(land,reflectedRidge);
      land.position.set(Math.sin(angle)*radius,-1.5,Math.cos(angle)*radius);
      land.rotation.y=angle+1.9+i*.81;land.scale.set(.94,.47+(i%3)*.055,.82);land.receiveShadow=true;root.add(land);
      // Actual silhouettes along the lower ridges establish scale. Keep trees
      // upright in world space instead of flattening them with the DEM tile.
      land.updateMatrixWorld();
      const capacity=quality==='high'?380:160;
      const forests=forestGeometries.map(g=>new THREE.InstancedMesh(g,forestMaterial,capacity));
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(land.matrixWorld);
      const rng=seeded(world.seed+1703+i*317),position=new THREE.Vector3(),normal=new THREE.Vector3(),transform=new THREE.Matrix4(),rotation=new THREE.Quaternion(),size=new THREE.Vector3();
      let total=0;const counts=[0,0],occupied=new Map<string,THREE.Vector3[]>();
      for(let attempt=0;attempt<capacity*32&&total<capacity;attempt++){
        terrainScatter(foothills,rng,position,normal);position.applyMatrix4(land.matrixWorld);normal.applyMatrix3(normalMatrix).normalize();
        const patch=terrainNoise(position.x*.035+world.seed%37,position.z*.035)*.8+terrainNoise(position.x*.095,position.z*.095)*.2;
        const treeline=12+terrainNoise(position.x*.018,position.z*.018)*7;
        if(position.y<1.2||position.y>treeline||normal.y<.79||patch<.54)continue;
        const s=1.05+rng()*.95;
        const cellX=Math.floor(position.x/2.8),cellZ=Math.floor(position.z/2.8);
        let crowded=false;
        for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(occupied.get(`${cellX+dx},${cellZ+dz}`)?.some(p=>Math.hypot(p.x-position.x,p.z-position.z)<1.4))crowded=true;
        if(crowded)continue;
        // Species follow broad local groves rather than alternating randomly.
        const grove=terrainNoise(position.x*.055+21,position.z*.055-13);
        const kind=grove>(world.biome==='alpine'?.66:.43)&&position.y<13?1:0;
        size.set(s,s*(.92+rng()*.18),s);rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),rng()*Math.PI*2);
        transform.compose(position,rotation,size);const forest=forests[kind],index=counts[kind]++;
        forest.setMatrixAt(index,transform);
        forest.setColorAt(index,new THREE.Color(kind?'#95ba85':'#74aaa0').lerp(new THREE.Color('#d2dfac'),patch*.5+rng()*.13));total++;
        const key=`${cellX},${cellZ}`,cell=occupied.get(key)??[];cell.push(position.clone());occupied.set(key,cell);
      }
      forests.forEach((forest,kind)=>{forest.count=counts[kind];forest.computeBoundingSphere();root.add(forest);});

    }
  }).catch(()=>{root.userData.terrainUnavailable=true;});
  // Soft atmospheric ribbons bring depth to the foothills without sorting opaque geometry.
  const cloudCanvas=document.createElement('canvas');cloudCanvas.width=128;cloudCanvas.height=64;const cx=cloudCanvas.getContext('2d')!;
  cx.scale(2,1);const gradient=cx.createRadialGradient(32,32,1,32,32,31);gradient.addColorStop(0,'rgba(255,255,255,.45)');gradient.addColorStop(.42,'rgba(255,255,255,.22)');gradient.addColorStop(1,'rgba(255,255,255,0)');cx.fillStyle=gradient;cx.fillRect(0,0,64,64);
  const cloudTexture=new THREE.CanvasTexture(cloudCanvas);textures.push(cloudTexture);
  const hazeMat=material(new THREE.SpriteMaterial({map:cloudTexture,color:'#b9cbc9',transparent:true,opacity:.26,depthWrite:false}));
  const haze:THREE.Sprite[]=[];
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2,s=new THREE.Sprite(material(hazeMat.clone()));s.position.set(Math.sin(a)*82,5+random()*7,Math.cos(a)*82);s.scale.set(65,13,1);s.userData.phase=i;root.add(s);haze.push(s);}

  const birdMat=material(new THREE.MeshStandardMaterial({color:'#e5dfca',roughness:.82,side:THREE.DoubleSide}));
  const wingShape=new THREE.Shape();wingShape.moveTo(0,0);wingShape.lineTo(.28,.11);wingShape.lineTo(.76,-.06);wingShape.lineTo(.93,-.3);wingShape.lineTo(.44,-.16);wingShape.lineTo(0,-.11);wingShape.closePath();
  const wingGeo=geometry(new THREE.ShapeGeometry(wingShape));wingGeo.rotateX(-Math.PI/2);
  const bodyGeo=geometry(new THREE.SphereGeometry(.09,8,6));
  const birds:{root:THREE.Group;left:THREE.Group;right:THREE.Group;phase:number;radius:number;height:number}[]=[];
  for(let i=0;i<(quality==='high'?11:5);i++){
    const bird=new THREE.Group(),left=new THREE.Group(),right=new THREE.Group();bird.add(left,right);
    const l=new THREE.Mesh(wingGeo,birdMat),r=new THREE.Mesh(wingGeo,birdMat);l.scale.x=-1;left.add(l);right.add(r);
    const body=new THREE.Mesh(bodyGeo,birdMat);body.scale.set(.85,.85,2.4);bird.add(body);bird.scale.setScalar(.24+random()*.18);root.add(bird);
    birds.push({root:bird,left,right,phase:random()*Math.PI*2,radius:9+random()*12,height:7+random()*14});
  }
  const rainCount=quality==='high'?1000:350,rainArray=new Float32Array(rainCount*6);
  const rainGeo=geometry(new THREE.BufferGeometry());rainGeo.setAttribute('position',new THREE.BufferAttribute(rainArray,3));
  const rainMat=material(new THREE.LineBasicMaterial({color:'#b2d2dc',transparent:true,opacity:.25,depthWrite:false}));const rain=new THREE.LineSegments(rainGeo,rainMat);rain.frustumCulled=false;root.add(rain);
  const rainSeeds=Array.from({length:rainCount},()=>[random()*72-36,random()*80,random()*72-36]);
  let targetWeather:Weather=world.weather,storm=world.weather==='rain'?1:0,mist=world.weather==='mist'?1:0,dusk=world.weather==='sunset'?1:0;
  const color=new THREE.Color();
  function update(time:number,dt:number,reduced:boolean,viewer:THREE.Vector3){
    reflectionSubmitMs=0;
    const blend=1-Math.exp(-dt*.9);storm=THREE.MathUtils.lerp(storm,targetWeather==='rain'?1:0,blend);mist=THREE.MathUtils.lerp(mist,targetWeather==='mist'?1:0,blend);
    dusk=THREE.MathUtils.lerp(dusk,targetWeather==='sunset'?1:0,blend);
    terrainLighting.direction.value.set(-26,targetWeather==='sunset'?8:42,targetWeather==='sunset'?-34:34).normalize();
    terrainLighting.overcast.value=storm;
    uniforms.uTime.value=time;uniforms.uStorm.value=storm;uniforms.uMist.value=mist;uniforms.uDusk.value=dusk;
    uniforms.uSun.value.set(-.55,THREE.MathUtils.lerp(.43,.12,dusk),THREE.MathUtils.lerp(.72,-.72,dusk)).normalize();
    uniforms.uHorizon.value.set('#d3eee3').lerp(color.set('#f4c4ae'),dusk).lerp(color.set('#adbfce'),storm*.82);
    uniforms.uZenith.value.set('#71bfd7').lerp(color.set('#a5aedc'),dusk).lerp(color.set('#819bb9'),storm*.8);
    // Clouds move much more slowly than the camera and water. Share one HDR
    // panorama between the main view and its reflection instead of tracing the
    // same volume twice on every pixel of every frame.
    const weatherKey=storm+mist*2+dusk*4;
    if(time-skyUpdated>=.5||Math.abs(weatherKey-skyWeather)>.035){
      skyCamera.update(renderer,cloudScene);skyUpdated=time;skyWeather=weatherKey;
    }
    opening=THREE.MathUtils.lerp(opening,THREE.MathUtils.clamp(progress,0,1),1-Math.exp(-dt*.35));
    const fog=scene.fog as THREE.FogExp2;fog.color.copy(uniforms.uHorizon.value);fog.density=growthFog(opening*12)*.65+mist*.0025+storm*.002;
    scene.environmentIntensity=.38-dusk*.13-storm*.12;
    waterUniforms.uDeep.value.set('#369ba5').lerp(color.set('#6a9cac'),dusk);
    hazeMat.color.copy(uniforms.uHorizon.value);hazeMat.opacity=.12+mist*.12+(1-opening)*.18;
    haze.forEach((h,i)=>{const a=i/16*Math.PI*2+time*.0008,r=24+opening*68;h.position.set(Math.sin(a)*r,3+Math.sin(i*2.1)*2,Math.cos(a)*r);h.scale.set(35+opening*30,10+mist*5,1);const facing=(Math.sin(a)*viewer.x+Math.cos(a)*viewer.z)/Math.max(1,Math.hypot(viewer.x,viewer.z));h.material.color.copy(hazeMat.color);h.material.opacity=hazeMat.opacity*(1-THREE.MathUtils.smoothstep(facing,0,.85)*.87);});
    birds.forEach((b,i)=>{const a=b.phase+time*(.055+(i%3)*.009),flap=reduced?0:Math.sin(time*4.7+i)*.43*Math.pow(Math.max(0,Math.sin(time*.37+i)),2);b.root.position.set(Math.sin(a)*b.radius,b.height+Math.sin(a*2)*1.1,Math.cos(a)*b.radius);b.root.rotation.set(Math.sin(a)*.08,a+Math.PI/2,Math.sin(a*.7)*.12);b.left.rotation.z=flap+.1;b.right.rotation.z=-flap-.1;b.root.visible=storm<.65||i<3;});
    rain.visible=storm>.04&&!reduced;rainMat.opacity=storm*.32;
    if(rain.visible){for(let i=0;i<rainCount;i++){const [x,y,z]=rainSeeds[i],k=i*6;const yy=((y-time*17)%80+80)%80;rainArray[k]=x+Math.sin(time*.2)*2;rainArray[k+1]=yy;rainArray[k+2]=z;rainArray[k+3]=rainArray[k]-.12;rainArray[k+4]=yy+.65;rainArray[k+5]=z-.07;}rainGeo.attributes.position.needsUpdate=true;}
  }
  return {update,reflectionSubmitMs:()=>reflectionSubmitMs,storm:()=>storm,weather(value:Weather,floors:number){targetWeather=value;progress=floors/12;},dispose(){disposed=true;root.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});root.removeFromParent();reflector.dispose();skyCache.dispose();scene.environment=null;geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}


