import {clockMinutes,type Schedule} from './sleep-state';
export const DIAL_STEP=5;
export function angleAt(x:number,y:number,cx:number,cy:number){return Math.atan2(y-cy,x-cx);}
export function angleDelta(previous:number,next:number){return Math.atan2(Math.sin(next-previous),Math.cos(next-previous));}
const clock=(minute:number)=>{const m=((minute%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
export function shiftSleepWindow<T extends Schedule>(schedule:T,minutes:number):T{
 const delta=Math.round(minutes/DIAL_STEP)*DIAL_STEP;
 return {...schedule,bed:clock(clockMinutes(schedule.bed)+delta),wake:clock(clockMinutes(schedule.wake)+delta)};
}
