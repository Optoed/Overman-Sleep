import * as THREE from 'three';

const PERIOD=128;
let pixels:Uint8Array|undefined;

/** One texel packs the four corner heights of one periodic noise cell.
 * The shader retains its continuous analytic slope, including cell seams. */
export function rippleTexture(){
  if(!pixels){
    pixels=new Uint8Array(PERIOD*PERIOD*4);
    const lattice=new Uint8Array(PERIOD*PERIOD);
    for(let y=0;y<PERIOD;y++)for(let x=0;x<PERIOD;x++){
      const n=Math.sin((x-PERIOD/2)*127.1+(y-PERIOD/2)*311.7)*43758.5453;
      lattice[y*PERIOD+x]=Math.round((n-Math.floor(n))*255);
    }
    for(let y=0;y<PERIOD;y++)for(let x=0;x<PERIOD;x++){
      const index=(y*PERIOD+x)*4,right=(x+1)%PERIOD,above=(y+1)%PERIOD;
      pixels[index]=lattice[y*PERIOD+x];pixels[index+1]=lattice[y*PERIOD+right];
      pixels[index+2]=lattice[above*PERIOD+x];pixels[index+3]=lattice[above*PERIOD+right];
    }
  }
  const texture=new THREE.DataTexture(pixels,PERIOD,PERIOD,THREE.RGBAFormat,THREE.UnsignedByteType);
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.minFilter=texture.magFilter=THREE.NearestFilter;
  texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;
  return texture;
}

export const rippleGradientGLSL=`
uniform sampler2D uRipple;
vec2 rippleGradient(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
  vec4 h=texture2D(uRipple,(i+${PERIOD/2+.5})/${PERIOD}.);
  return du*vec2(mix(h.g-h.r,h.a-h.b,u.y),mix(h.b-h.r,h.a-h.g,u.x));
}
`;
