import * as THREE from 'three';

export function sailPoint(u:number,v:number,time:number,phase:number){
  const across=Math.sin(u*Math.PI),free=1-v;
  return {x:(u-.5)*1.75*(.74+.26*v),y:(v-.5)*2.25+across*free*.08,
    z:across*Math.sin(v*Math.PI)*(.29+.025*Math.sin(time*.9+phase))
      +across*free*free*Math.sin(time*2.1+v*17+u*8+phase)*.034};
}

export function updateSail(geometry:THREE.BufferGeometry,time:number,phase:number){
  const uv=geometry.attributes.uv,p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){const s=sailPoint(uv.getX(i),uv.getY(i),time,phase);p.setXYZ(i,s.x,s.y,s.z);}
  p.needsUpdate=true;geometry.computeVertexNormals();
}

/** Broad painted panels read at island scale, without microscopic cloth noise. */
export function sailMaterial(){
  const m=new THREE.MeshLambertMaterial({color:'#fff0ce',side:THREE.DoubleSide});
  m.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 clothUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nclothUV=uv;');
    shader.fragmentShader='varying vec2 clothUV;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float stripe=abs(clothUV.x-.5);
      float aa=max(fwidth(clothUV.x),.001);
      float painted=1.-smoothstep(.15-aa,.15+aa,stripe);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.64,.26,.16),painted*.88);
      float hem=1.-smoothstep(.009,.026,min(min(clothUV.x,1.-clothUV.x),min(clothUV.y,1.-clothUV.y)));
      diffuseColor.rgb*=1.-hem*.12;
    `);
  };
  m.customProgramCacheKey=()=> 'storybook-sail';return m;
}

export function hullMaterial(){
  const m=new THREE.MeshLambertMaterial({color:'#5fa69a',side:THREE.DoubleSide});
  m.onBeforeCompile=shader=>{
    shader.vertexShader='varying float hullY;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nhullY=position.y;');
    shader.fragmentShader='varying float hullY;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float trim=smoothstep(.015,.04,hullY)*(1.-smoothstep(.12,.14,hullY));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.87,.7,.43),trim);
      diffuseColor.rgb*=mix(.72,1.,smoothstep(-.4,-.02,hullY));
    `);
  };
  m.customProgramCacheKey=()=> 'storybook-painted-hull';return m;
}

export type WakePoint={x:number;z:number;dx:number;dz:number;born:number;energy:number;scale:number};
export type WakeTrail={points:WakePoint[];previous:{x:number;z:number}|null;distance:number};
export const WAKE_LIFETIME=7,WAKE_CAPACITY=48;
export function updateWakeTrail(trail:WakeTrail,position:{x:number;z:number},time:number,dt:number,scale:number,enabled:boolean){
  trail.points=trail.points.filter(p=>time-p.born<WAKE_LIFETIME);
  if(!enabled){trail.points.length=0;trail.previous={...position};trail.distance=0;return;}
  if(!trail.previous){trail.previous={...position};return;}
  const x=position.x-trail.previous.x,z=position.z-trail.previous.z,distance=Math.hypot(x,z);
  trail.previous={...position};
  if(distance>3){trail.points.length=0;trail.distance=0;return;}
  if(dt<=0||distance/dt<.04)return;
  trail.distance+=distance;
  if(trail.distance<.14)return;
  trail.distance=0;
  const dx=x/distance,dz=z/distance;
  trail.points.push({x:position.x-dx*1.65*scale,z:position.z-dz*1.65*scale,dx,dz,born:time,energy:Math.min(1,distance/dt/1.1),scale});
  if(trail.points.length>WAKE_CAPACITY)trail.points.shift();
}
