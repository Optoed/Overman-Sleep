import * as THREE from 'three';
import { alpineCoastMask } from './alpine-mask';
import { terrainNoise } from './terrain-noise';
import { buildHorizonField, sampleHorizon, type HorizonField } from './terrain-horizon';

const horizonCache=new WeakMap<Float32Array,{minimum:number;field:HorizonField}>();

let elevation:Promise<{values:Float32Array;minimum:number}>|undefined;
function loadElevation(){
  if(!elevation)elevation=(async()=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    await Promise.all([0,1].flatMap(y=>[0,1].map(async x=>{const image=new Image();image.src=`/world/alpine-height-${x}-${y}.png`;await image.decode();ctx.drawImage(image,x*256,y*256);})));const data=ctx.getImageData(0,0,512,512).data;
    const values=new Float32Array(512*512);let minimum=Infinity;
    for(let i=0;i<values.length;i++){values[i]=data[i*4]*256+data[i*4+1]+data[i*4+2]/256-32768;minimum=Math.min(minimum,values[i]);}
    return {values,minimum};
  })().catch(error=>{elevation=undefined;throw error;});
  return elevation;
}

/** Build real relief from Mapzen Terrarium elevation samples of the Matterhorn region.
 * Scaled/arranged for a fictional lake; not a geographic map. See public/world/CREDITS.txt. */
export async function alpineGeometry(resolution=160){
  const {values,minimum}=await loadElevation();
  return buildAlpineGeometry(values,minimum,resolution);
}

export function buildAlpineGeometry(values:Float32Array,minimum:number,resolution:number){
  const height=(u:number,v:number)=>{
    const x=Math.min(511,Math.max(0,u*511)),y=Math.min(511,Math.max(0,v*511)),ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(511,ix+1),jy=Math.min(511,iy+1);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(values[iy*512+ix],values[iy*512+jx],x-ix),THREE.MathUtils.lerp(values[jy*512+ix],values[jy*512+jx],x-ix),y-iy);
  };
  const surface=(x:number,z:number)=>{
    const u=(x+90)/180,v=(z+90)/180,fade=alpineCoastMask(x/90,z/90);
    const h=(height(u,v)-minimum)*.016;
    // Subordinate erosion follows stretched, warped channels; the surveyed DEM
    // still determines the mountain, while small outcrops break smooth ramps.
    const warp=terrainNoise(x*.035,z*.035)*5;
    const ridge=1-Math.abs(terrainNoise(x*.32+warp,z*.11)*2-1);
    const crags=(ridge-.6)*1.4+(terrainNoise(x*.61,z*.43)-.5)*.45;
    return (h+crags*THREE.MathUtils.smoothstep(h,2,12))*fade-4;
  };
  let cached=horizonCache.get(values);
  if(!cached||cached.minimum!==minimum){cached={minimum,field:buildHorizonField(surface)};horizonCache.set(values,cached);}
  const g=new THREE.PlaneGeometry(180,180,resolution,resolution);g.rotateX(-Math.PI/2);const p=g.attributes.position,normal=g.attributes.normal,colors=[],cavities=[],horizon0:number[]=[],horizon1:number[]=[];
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),u=(x+90)/180,v=(z+90)/180;
    const h=(height(u,v)-minimum)*.016;
    // Broad crevices remain shaded even outside the island's shadow map. Sample
    // the DEM in metres so this does not change with mesh resolution/quality.
    const step=1/160,centre=height(u,v);
    const concavity=(height(u-step,v)+height(u+step,v)+height(u,v-step)+height(u,v+step)-4*centre)*.016;
    const shelter=1-THREE.MathUtils.smoothstep(concavity,.035,.36)*.3;
    cavities.push(THREE.MathUtils.smoothstep(concavity,.015,.24));
    p.setY(i,surface(x,z));
    const horizon=sampleHorizon(cached.field,x,z);horizon0.push(...horizon.slice(0,4));horizon1.push(...horizon.slice(4));
    // Fixed-distance derivatives retain relief across both mesh quality levels.
    const n=new THREE.Vector3(surface(x-.4,z)-surface(x+.4,z),.8,surface(x,z-.4)-surface(x,z+.4)).normalize();normal.setXYZ(i,n.x,n.y,n.z);
    const c=new THREE.Color('#92958d');c.lerp(new THREE.Color('#c3c4bd'),THREE.MathUtils.smoothstep(h,12,45));c.multiplyScalar(shelter);colors.push(c.r,c.g,c.b);}
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('terrainCavity',new THREE.Float32BufferAttribute(cavities,1));
  g.setAttribute('terrainHorizon0',new THREE.Float32BufferAttribute(horizon0,4));g.setAttribute('terrainHorizon1',new THREE.Float32BufferAttribute(horizon1,4));g.computeBoundingSphere();return g;
}
