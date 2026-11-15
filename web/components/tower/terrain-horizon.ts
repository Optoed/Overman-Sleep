export type HeightSurface=(x:number,z:number)=>number;
export type HorizonField={values:Float32Array;resolution:number;extent:number};
const DISTANCES=[1.2,2.4,4,6.5,10,15,22,31,43,58,76,98];

/** Bake angular horizons once, rather than ray-marching every rendered pixel.
 * Heights are local to the DEM; the shader transforms sunlight into this space. */
export function buildHorizonField(surface:HeightSurface,resolution=64,extent=90):HorizonField {
  const width=resolution+1,values=new Float32Array(width*width*8);
  for(let row=0;row<=resolution;row++)for(let col=0;col<=resolution;col++){
    const x=(col/resolution*2-1)*extent,z=(row/resolution*2-1)*extent,height=surface(x,z)+.18;
    for(let direction=0;direction<8;direction++){
      const angle=direction*Math.PI/4,dx=Math.cos(angle),dz=Math.sin(angle);let horizon=0;
      for(const distance of DISTANCES){
        const sx=x+dx*distance,sz=z+dz*distance;
        if(Math.abs(sx)>extent||Math.abs(sz)>extent)break;
        horizon=Math.max(horizon,(surface(sx,sz)-height)/distance);
      }
      values[(row*width+col)*8+direction]=Math.min(8,horizon);
    }
  }
  return {values,resolution,extent};
}

export function sampleHorizon(field:HorizonField,x:number,z:number){
  const {values,resolution,extent}=field,width=resolution+1;
  const u=Math.max(0,Math.min(resolution,(x/extent+1)*resolution/2)),v=Math.max(0,Math.min(resolution,(z/extent+1)*resolution/2));
  const a=Math.floor(u),b=Math.floor(v),c=Math.min(resolution,a+1),d=Math.min(resolution,b+1),tx=u-a,tz=v-b;
  return Array.from({length:8},(_,i)=>{
    const lower=values[(b*width+a)*8+i]*(1-tx)+values[(b*width+c)*8+i]*tx;
    const upper=values[(d*width+a)*8+i]*(1-tx)+values[(d*width+c)*8+i]*tx;
    return lower*(1-tz)+upper*tz;
  });
}

export const terrainHorizonVertexGLSL=`
  attribute vec4 terrainHorizon0,terrainHorizon1;
  uniform vec3 terrainSun;
  varying vec2 terrainVisibility;
  float horizonValue(int index){return index<4?terrainHorizon0[index]:terrainHorizon1[index-4];}
  vec2 terrainIllumination(){
    vec3 light=vec3(dot(terrainSun,modelMatrix[0].xyz)/dot(modelMatrix[0].xyz,modelMatrix[0].xyz),
      dot(terrainSun,modelMatrix[1].xyz)/dot(modelMatrix[1].xyz,modelMatrix[1].xyz),
      dot(terrainSun,modelMatrix[2].xyz)/dot(modelMatrix[2].xyz,modelMatrix[2].xyz));
    float bearing=mod(atan(light.z,light.x)*1.27323954+8.,8.);
    int first=int(floor(bearing)),second=first==7?0:first+1;
    float horizon=mix(horizonValue(first),horizonValue(second),fract(bearing));
    float sunSlope=light.y/max(.00001,length(light.xz));
    float exposure=smoothstep(horizon-.045,horizon+.065,sunSlope);
    vec3 scale=vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));
    float diagonal=length(scale.xz)*.70710678;
    vec4 elevationScale=scale.y/vec4(scale.x,diagonal,scale.z,diagonal);
    vec4 h0=terrainHorizon0*elevationScale,h1=terrainHorizon1*elevationScale;
    vec4 sky0=1./(1.+h0*h0),sky1=1./(1.+h1*h1);
    return vec2(exposure,dot(sky0+sky1,vec4(.125)));
  }
`;
