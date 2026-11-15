import * as THREE from 'three';
import { islandRadius, type Obstacle, type Point2 } from './world-physics';
export const FERN_RADIUS=.7;

/** Folded, arching blade, rooted at y=0. Its tip bends without a flat card edge. */
export function grassBladeGeometry(){
  const vertices:number[]=[],indices:number[]=[];
  for(let row=0;row<=5;row++){
    const t=row/5,width=Math.pow(1-t,.72)*.5;
    for(let side=-1;side<=1;side++)vertices.push(side*width+t*t*.5,t-.12*t*t*t,t*t*.85+(1-Math.abs(side))*.15*(1-t));
    if(row<5)for(let side=0;side<2;side++){const i=row*3+side;indices.push(i,i+3,i+1,i+1,i+3,i+4);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

export function fernGeometry(){
  const vertices:number[]=[];
  const triangle=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3)=>vertices.push(...a.toArray(),...b.toArray(),...c.toArray());
  for(let frond=0;frond<6;frond++){
    const angle=frond*2.39996,d=new THREE.Vector3(Math.sin(angle),0,Math.cos(angle)),side=new THREE.Vector3(d.z,0,-d.x);
    const point=(t:number)=>d.clone().multiplyScalar(t*.62).setY(Math.sin(t*Math.PI*.77)*(.57+(frond%3)*.07));
    triangle(side.clone().multiplyScalar(-.008),point(.14),side.clone().multiplyScalar(.008));
    for(let leaflet=1;leaflet<=9;leaflet++){
      const t=leaflet/10,base=point(t),next=point(t+.08),length=(.04+Math.sin(t*Math.PI)*.17)*(1-t*.35);
      triangle(base.clone().addScaledVector(side,-.009),next,base.clone().addScaledVector(side,.009));
      for(const sign of [-1,1]){
        const tip=base.clone().addScaledVector(side,length*sign).addScaledVector(d,.065);tip.y+=.025;
        const mid=base.clone().lerp(tip,.48);mid.y+=.035;
        triangle(base,mid.clone().addScaledVector(d,-.033),tip);
        triangle(base,tip,mid.clone().addScaledVector(d,.033));
      }
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();return g;
}

/** Reserve the entire plant footprint, including the tips, around people/paths. */
export function vegetationFits(x:number,z:number,radius:number,obstacles:Obstacle[],routes:Point2[][]){
  if(Math.hypot(x,z)+radius>islandRadius(Math.atan2(z,x))-.025)return false;
  if(obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.radius+radius+.045))return false;
  for(const route of routes)for(let i=0;i<route.length-1;i++){
    const a=route[i],b=route[i+1],dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz;
    const t=len?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len)):0;
    if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<radius+.19)return false;
  }
  return true;
}

export function grassMaterial(wind:{value:number}){
  const m=new THREE.MeshLambertMaterial({color:'#d1e7a9',side:THREE.DoubleSide});
  m.onBeforeCompile=shader=>{
    shader.uniforms.grassWind=wind;
    shader.vertexShader='uniform float grassWind;varying float bladeHeight;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      bladeHeight=position.y;
      vec3 breeze=vec3(.034,0.,.018)*sin(grassWind*1.35+instanceMatrix[3].x*.72+instanceMatrix[3].z*.91)*position.y*position.y;
      transformed+=vec3(dot(breeze,instanceMatrix[0].xyz)/dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),
        dot(breeze,instanceMatrix[1].xyz)/dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),
        dot(breeze,instanceMatrix[2].xyz)/dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));`);
    shader.fragmentShader='varying float bladeHeight;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb*=mix(vec3(.72,.81,.54),vec3(1.08,1.04,.83),smoothstep(0.,.85,bladeHeight));');
  };
  m.customProgramCacheKey=()=> 'rooted-grass-wind';return m;
}
