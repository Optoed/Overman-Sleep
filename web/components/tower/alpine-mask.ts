/** Local tile coordinates, -1..1. Every edge sinks below the lake instead of
 * exposing the rectangular DEM boundary. The central measured ridges stay intact. */
export function alpineCoastMask(x:number,z:number){
  const angle=Math.atan2(z,x),radius=.865+.055*Math.sin(angle*3+.9)+.035*Math.cos(angle*7-.4)+.023*Math.sin(angle*13+1.3);
  const t=Math.max(0,Math.min(1,(Math.hypot(x,z)-radius*.56)/(radius*.44)));
  return 1-t*t*(3-2*t);
}
