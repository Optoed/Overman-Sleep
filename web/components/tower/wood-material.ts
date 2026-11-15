import * as THREE from 'three';

const timberDimensionsGLSL=`
  vec3 timberDimensions(){
    mat4 tm=modelMatrix;
    #ifdef USE_INSTANCING
      tm=modelMatrix*instanceMatrix;
    #endif
    return max(vec3(.0001),vec3(length(tm[0].xyz),length(tm[1].xyz),length(tm[2].xyz)));
  }
`;
const timberBevelGLSL=`
  vec3 ts=timberDimensions();
  float tr=min(.025,min(ts.x,min(ts.y,ts.z))*.1);
  transformed=sign(position)*(.5-tr/ts)+normal*tr/ts;
`;

/** Shadows use the same physical bevel as the visible instanced boards. */
export function woodDepthMaterial(){
  const material=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+timberDimensionsGLSL)
      .replace('#include <begin_vertex>','#include <begin_vertex>\n'+timberBevelGLSL);
  };
  material.customProgramCacheKey=()=> 'timber-depth-bevel';
  return material;
}

/** Warm painted timber; keep the physical bevel shared with its shadow. */
export function woodMaterial(color:string,_axis:'x'|'y'|'z'){
  const material=new THREE.MeshLambertMaterial({color:new THREE.Color(color).lerp(new THREE.Color('#e6b877'),.25)});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+timberDimensionsGLSL)
      .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal *= timberDimensions();')
      .replace('#include <begin_vertex>','#include <begin_vertex>\n'+timberBevelGLSL);
  };
  material.customProgramCacheKey=()=> 'storybook-timber-bevel';
  return material;
}
