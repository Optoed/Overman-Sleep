import { floorRadius } from './tower-architecture';

/** Coordinates are relative to the crane level. All station props and their
 * resident share the same transform, including the resident's individual scale. */
export function workStation(index:number,floors:number){
  const slot=Math.max(0,Math.min(4,index));
  if(slot<2){
    const clear=(x:number)=>floors===0||floors%6!==0||[0,1].every(j=>{
      const a=(floors-6)/6*1.45+.72+j*Math.PI,r=floorRadius(floors-1)+.25;
      return Math.hypot(x-Math.sin(a)*r,1.94-Math.cos(a)*r)>.86;
    });
    const first=[-.8,0,.8].find(clear)??-.8;
    const x=slot===0?first:[.8,0,-.8].find(x=>clear(x)&&Math.abs(x-first)>.7)??.8;
    return {x,y:.342,z:1.94,angle:Math.PI};
  }
  return {x:slot===2?-.65:slot===3?.65:0,y:floors%6===0?-.138:-.188,z:slot===4?.58:-.62,angle:Math.PI};
}

const smooth=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};
/** Four deliberate strikes followed by a pause to inspect the work. */
export function workMotion(time:number,phase:number,still=false){
  const cycle=still?4.5:((time+phase)%7.4+7.4)%7.4;
  const active=cycle<3.84,beat=(cycle%.96)/.96;
  const lift=!active?0:beat<.45?smooth(beat/.45):1-smooth((beat-.45)/.21);
  return {lift,active,contact:active&&beat>=.66&&beat<=.82};
}

// Bottom face of the hammer at full contact, derived from the articulated arm
// and the hammer head dimensions. This is also the top of the workpiece.
export const WORK_SURFACE=.49-.108*Math.cos(-1.3)-.101*Math.cos(-.5)
  -.025*Math.cos(-.5)-.124*Math.sin(-.5)
  -(.025*Math.cos(.5)+.0225*Math.sin(.5));
export const WORK_DEPTH=-.108*Math.sin(-1.3)-.101*Math.sin(-.5)
  -.025*Math.sin(-.5)+.124*Math.cos(-.5);
