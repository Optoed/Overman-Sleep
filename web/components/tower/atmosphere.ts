/** Exponential height fog integrated along the sight line. Low valleys hold
 * mist while higher ridges remain readable. Reflection cameras use the same
 * altitude as their real counterpart, rather than appearing submerged. */
export function mountainFog(distance: number, viewerHeight: number, terrainHeight: number, density: number) {
  const start = Math.max(1, Math.abs(viewerHeight)), end = Math.max(0, terrainHeight);
  const delta = (end - start) * .052;
  const average = Math.exp(-start * .052) * (Math.abs(delta) < .001 ? 1 - delta * .5 : -Math.expm1(-delta) / delta);
  const t=Math.max(0,Math.min(1,(density-.0028)/.006)),clearing=.56+.44*t*t*(3-2*t);
  const depth = Math.max(0, distance) * (.00055 + Math.max(0, density) * clearing * average * 1.1);
  return 1 - Math.exp(-depth);
}

export const mountainFogGLSL = `
float mountainAtmosphere(vec3 worldPosition,float density){
  float start=max(1.,abs(cameraPosition.y)),end=max(0.,worldPosition.y);
  float delta=(end-start)*.052;
  float average=exp(-start*.052)*(abs(delta)<.001?1.-delta*.5:(1.-exp(-delta))/delta);
  float clearing=.56+.44*smoothstep(.0028,.0088,density);
  float depth=length(cameraPosition-worldPosition)*(.00055+max(0.,density)*clearing*average*1.1);
  return 1.-exp(-depth);
}`;

/** Share the same optical path for terrain and objects standing on it. */
export function mountainFogFragment(position:string){return `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,mountainAtmosphere(${position},fogDensity));
    #else
      gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,smoothstep(fogNear,fogFar,vFogDepth));
    #endif
  #endif
`;}
