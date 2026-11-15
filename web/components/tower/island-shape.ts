import { islandRadius } from './world-physics';

const HARBOURS = [[1.24, .43], [3.08, .45], [-.61, .29]] as const;
export const MAIN_DOCK_ANGLE=.25;
export function dockStairProfile(){
  const start=islandRadius(Math.PI/2-MAIN_DOCK_ANGLE)+.08;
  return Array.from({length:14},(_,i)=>({distance:start+i*.2,height:2.8-i*.18}));
}
export function harbourClearance(angle:number) {
  return Math.max(...HARBOURS.map(([centre,width])=>{
    const d=Math.atan2(Math.sin(angle-centre),Math.cos(angle-centre))/width;
    return Math.exp(-d*d*d*d);
  }));
}

/** Sea-level outline; the working harbours stay close to the original shore. */
export function coastRadius(angle:number) {
  const lobes=.35+.95*Math.pow(.5+.5*Math.sin(angle*3+.8),3)+.65*Math.pow(.5+.5*Math.cos(angle*5-1.4),6);
  return islandRadius(angle)+.16+lobes*(1-harbourClearance(angle));
}

/** World-space cliff profile. The walkable plateau stays unchanged above it. */
export function cliffRadius(angle:number,height:number) {
  const t=Math.max(0,Math.min(1,(height+.2)/2.98)),blend=t*t*(3-2*t);
  const bottom=coastRadius(angle),top=islandRadius(angle)+.1;
  const notch=Math.sin(t*Math.PI)*(.22+.48*Math.pow(Math.cos(angle*4+t*.8),2));
  const fracture=Math.sin(t*Math.PI)*Math.sin(angle*11+height*.9)*.13;
  // Narrow, slightly slanted joints divide the cliff into unequal blocks. They
  // only cut inward, and vanish at both the plateau and the waterline.
  let joints=0;
  for(let i=0;i<13;i++) {
    const centre=i*2.39996+Math.sin(i*4.3)*.18+height*(.025+Math.sin(i)*.023);
    const delta=Math.atan2(Math.sin(angle-centre),Math.cos(angle-centre));
    const width=.025+.016*(.5+.5*Math.sin(i*1.8));
    joints+=Math.exp(-Math.pow(delta/width,2))*(.13+.09*(.5+.5*Math.sin(i*2.7)));
  }
  const seam=Math.exp(-Math.pow((height-1.25-Math.sin(angle*3.1)*.21)/.105,2))*.1;
  return bottom+(top-bottom)*blend-notch+fracture-Math.sin(t*Math.PI)*(joints+seam)-Math.max(0,-.2-height)*.12;
}

// Shared constants keep the foam boundary aligned with the mesh, including coves.
export const coastShader=`
float harbourOpening(float a,float centre,float width){float d=atan(sin(a-centre),cos(a-centre))/width;return exp(-d*d*d*d);}
float coastRadius(float a){
  float harbour=${HARBOURS.map(([c,w])=>`harbourOpening(a,${c.toFixed(3)},${w.toFixed(3)})`).reduceRight((tail,value)=>`max(${value},${tail})`)};
  float lobes=.35+.95*pow(.5+.5*sin(a*3.+.8),3.)+.65*pow(.5+.5*cos(a*5.-1.4),6.);
  return 5.74*(1.+sin(a*3.+.4)*.045+cos(a*7.)*.025)+.16+lobes*(1.-harbour);
}`;
