import * as THREE from 'three';
import { updateWakeTrail, WAKE_CAPACITY, WAKE_LIFETIME, type WakeTrail } from './sailing';
import { waterHeight } from './world-physics';

export function createBoatWakes(scene:THREE.Scene){
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:true,
    uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader:`attribute float foam;varying vec2 wakeUV;varying float wakeFoam;
      #include <common>
      #include <fog_pars_vertex>
      void main(){wakeUV=uv;wakeFoam=foam;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader:`varying vec2 wakeUV;varying float wakeFoam;
      #include <common>
      #include <fog_pars_fragment>
      void main(){float edge=sin(wakeUV.x*3.14159);
        float cells=sin(wakeUV.y*63.+wakeUV.x*11.)*sin(wakeUV.y*39.-wakeUV.x*17.);
        float opacity=edge*edge*wakeFoam*(.48+.52*smoothstep(-.4,.7,cells));
        gl_FragColor=vec4(.66,.78,.72,opacity);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const items=Array.from({length:3},()=>{
    const geometry=new THREE.BufferGeometry(),positions=new Float32Array(WAKE_CAPACITY*4*3),uv=new Float32Array(WAKE_CAPACITY*4*2),foam=new Float32Array(WAKE_CAPACITY*4),indices:number[]=[];
    for(let i=0;i<WAKE_CAPACITY-1;i++)for(let side=0;side<2;side++){const a=i*4+side*2,b=a+4;indices.push(a,b,a+1,a+1,b,b+1);}
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('foam',new THREE.BufferAttribute(foam,1).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(indices);geometry.setDrawRange(0,0);
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=2;scene.add(mesh);
    return {geometry,mesh,trail:{points:[],previous:null,distance:0} as WakeTrail};
  });
  return {
    update(index:number,position:{x:number;z:number},time:number,dt:number,scale:number,storm:number,enabled:boolean){
      const item=items[index];if(!item)return;
      updateWakeTrail(item.trail,position,time,dt,scale,enabled);
      const p=item.geometry.attributes.position,uv=item.geometry.attributes.uv,foam=item.geometry.attributes.foam;
      item.trail.points.forEach((point,i)=>{
        const age=Math.max(0,time-point.born),spread=point.scale*(.22+age*.17),width=.13+age*.035;
        for(let side=0;side<2;side++)for(let edge=0;edge<2;edge++){
          const distance=(side?1:-1)*(spread+(edge?width:0)),x=point.x-point.dz*distance,z=point.z+point.dx*distance,j=i*4+side*2+edge;
          p.setXYZ(j,x,waterHeight(x,z,time,storm)+.025,z);uv.setXY(j,edge,point.born*.2);
          foam.setX(j,point.energy*.88*Math.pow(Math.max(0,1-age/WAKE_LIFETIME),1.6)*Math.min(1,age*4));
        }
      });
      p.needsUpdate=true;uv.needsUpdate=true;foam.needsUpdate=true;item.geometry.setDrawRange(0,Math.max(0,item.trail.points.length-1)*12);
    },
    count(){return items.reduce((sum,item)=>sum+item.trail.points.length,0);},
    clear(){items.forEach(item=>{item.trail={points:[],previous:null,distance:0};item.geometry.setDrawRange(0,0);});},
    dispose(){items.forEach(item=>{item.mesh.removeFromParent();item.geometry.dispose();});material.dispose();},
  };
}
