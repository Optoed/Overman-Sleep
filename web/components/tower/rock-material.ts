import * as THREE from 'three';
import { mountainFogGLSL,mountainFogFragment } from './atmosphere';
export type TerrainLighting={direction:{value:THREE.Vector3};overcast:{value:number}};
/** Painted stone uses broad colour regions instead of scanned texture maps. */
export function rockMaterial(_textures:THREE.Texture[],snowline=1000,_lighting?:TerrainLighting){
  const alpine=snowline<900;
  const m=new THREE.MeshLambertMaterial({color:alpine?'#ffffff':'#caa886'});
  m.onBeforeCompile=shader=>{
    shader.uniforms.snowline={value:snowline};
    shader.vertexShader='varying vec3 rockPosition; varying vec3 rockSurface;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vec4 rockWorld=vec4(position,1.);
      #ifdef USE_INSTANCING
        rockWorld=instanceMatrix*rockWorld;
      #endif
      rockPosition=(modelMatrix*rockWorld).xyz;rockSurface=inverseTransformDirection(transformedNormal,viewMatrix);`);
    shader.fragmentShader=`varying vec3 rockPosition;varying vec3 rockSurface;uniform float snowline;
      ${alpine?mountainFogGLSL:''}
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float slope=normalize(rockSurface).y;
      ${alpine?`
      float cap=rockPosition.y+sin(rockPosition.x*.19)*1.2+sin(rockPosition.z*.17)*1.4;
      float snow=smoothstep(snowline-1.,snowline+3.,cap)*smoothstep(.24,.6,slope);
      vec3 painted=mix(vec3(.27,.43,.47),vec3(.48,.47,.62),smoothstep(5.,snowline+8.,rockPosition.y));
      float meadow=(1.-smoothstep(snowline*.4,snowline*.85,rockPosition.y))*smoothstep(.42,.78,slope);
      painted=mix(painted,vec3(.32,.55,.39),meadow*.72);
      diffuseColor.rgb=mix(painted,vec3(.91,.96,.91),snow);
      `:`
      // Large, gently tilted beds remain readable at phone scale. The same
      // world-space layers continue over the fitted shoreline boulders.
      float bed=rockPosition.y+sin(rockPosition.x*.69+rockPosition.z*.24)*.14
        +sin(rockPosition.z*.87-rockPosition.x*.16)*.09;
      vec3 lowerStone=vec3(.34,.41,.37);
      vec3 warmStone=vec3(.62,.44,.28);
      vec3 paleStone=vec3(.75,.59,.39);
      vec3 shorePaint=mix(lowerStone,warmStone,smoothstep(.35,.74,bed));
      shorePaint=mix(shorePaint,paleStone,smoothstep(1.36,1.57,bed));
      shorePaint=mix(shorePaint,warmStone,smoothstep(2.12,2.3,bed)*.38);
      shorePaint*=1.-.075*exp(-pow((bed-1.36)*16.,2.));
      float wet=1.-smoothstep(-.08,.32,rockPosition.y);
      diffuseColor.rgb=shorePaint*mix(1.,.76,wet);
      `}`);
    if(alpine)shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',mountainFogFragment('rockPosition'));
  };
  m.customProgramCacheKey=()=>`storybook-layered-rock-${snowline}`;
  return m;
}
