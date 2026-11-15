import * as THREE from 'three';

const SIZE=64;
let volume:Uint8Array|undefined;

// A small, periodic density field replaces per-pixel procedural octaves. The
// CPU data is shared, while each renderer owns and disposes its GPU texture.
export function cloudVolume(){
  if(!volume){
    volume=new Uint8Array(SIZE**3);
    const hash=(x:number,y:number,z:number,period:number)=>{
      let n=Math.imul(x%period,73856093)^Math.imul(y%period,19349663)^Math.imul(z%period,83492791);
      n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);
      return ((n^(n>>>16))>>>0)/4294967295;
    };
    const smooth=(x:number)=>x*x*(3-2*x);
    for(let z=0;z<SIZE;z++)for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
      let density=0,weight=.55,total=0;
      for(let period=4;period<=32;period*=2){
        const px=x/SIZE*period,py=y/SIZE*period,pz=z/SIZE*period;
        const ix=Math.floor(px),iy=Math.floor(py),iz=Math.floor(pz);
        const fx=smooth(px-ix),fy=smooth(py-iy),fz=smooth(pz-iz);
        let sample=0;
        for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
          sample+=hash(ix+dx,iy+dy,iz+dz,period)*(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);
        }
        density+=sample*weight;total+=weight;weight*=.5;
      }
      volume[x+SIZE*(y+SIZE*z)]=Math.round(density/total*255);
    }
  }
  const texture=new THREE.Data3DTexture(volume,SIZE,SIZE,SIZE);
  texture.format=THREE.RedFormat;texture.type=THREE.UnsignedByteType;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapT=texture.wrapR=THREE.RepeatWrapping;
  texture.unpackAlignment=1;texture.needsUpdate=true;
  return texture;
}

export function cloudSkyFragment(steps:number){return `
  varying vec3 vDirection;
  uniform float uTime,uStorm,uMist,uDusk;
  uniform vec3 uSun,uHorizon,uZenith;
  uniform highp sampler3D uCloudVolume;
  float cloudShape(vec3 p){
    vec3 drift=vec3(uTime*.0012,0.,uTime*.0004);
    return texture(uCloudVolume,p*vec3(.95,1.65,.95)+drift).r;
  }
  float cloudDensity(vec3 p){
    vec3 drift=vec3(uTime*.0012,0.,uTime*.0004);
    float detail=texture(uCloudVolume,p*3.2+drift*1.4+vec3(.37,.1,.61)).r;
    float threshold=mix(.55,.34,uStorm*.85+uMist*.12);
    float radius=length(p);
    float profile=smoothstep(2.,2.12,radius)*(1.-smoothstep(2.44,2.65,radius));
    return max(0.,cloudShape(p)+(detail-.5)*.12-threshold)*10.*profile;
  }
  void main(){
    vec3 d=normalize(vDirection);
    float facing=max(0.,dot(d,uSun));
    // A finite slope at the horizon avoids a visible horizontal colour crease
    // when the viewpoint rises above the mountains.
    float elevation=(pow(max(0.,d.y)+.025,.45)-pow(.025,.45))/(pow(1.025,.45)-pow(.025,.45));
    vec3 c=mix(uHorizon,uZenith,elevation);
    c+=vec3(1.,.68,.32)*pow(facing,28.)*.18*(1.-uStorm);
    c+=vec3(2.,1.35,.72)*smoothstep(.9993,.99985,facing)*(1.-uStorm*.98);
    if(d.y>.025){
      float segment=.65/float(${steps});
      float transmission=1.;vec3 scattered=vec3(0.);
      vec3 shade=mix(mix(vec3(.62,.77,.83),vec3(.65,.56,.75),uDusk),vec3(.43,.54,.68),uStorm);
      vec3 lit=mix(mix(vec3(1.15,1.1,.96),vec3(1.4,.77,.38),uDusk),vec3(.78,.83,.88),uStorm);
      for(int i=0;i<${steps};i++){
        vec3 p=d*(2.+.65*(float(i)+.5)/float(${steps}));
        float density=cloudDensity(p);
        float shadow=max(0.,cloudShape(p+uSun*.17)-mix(.55,.34,uStorm*.85+uMist*.12))*10.;
        float sunThrough=exp(-shadow*3.2-density*1.8);
        float opacity=1.-exp(-density*segment*6.);
        float silver=pow(facing,10.)*sunThrough*(1.-uStorm)*.65;
        vec3 light=mix(shade,lit,sunThrough*.72)+lit*silver;
        scattered+=transmission*opacity*light;
        transmission*=1.-opacity;
      }
      c=mix(c,c*transmission+scattered,smoothstep(.025,.16,d.y));
    }
    c=mix(uHorizon,c,smoothstep(-.15,.06,d.y));gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;}
