import {validOffset} from './sleep-time';
/** Absolute source bounds and the review's display offsets captured at explicit import.
 * Offsets are not the source app's original zone metadata. Diary edits cannot move them. */
export type HealthInterval={version:'health-connect-interval-v1';start:number;end:number;bedOffset:number;wakeOffset:number};
export function validHealthInterval(value:unknown):value is HealthInterval{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).sort().join(',')==='bedOffset,end,start,version,wakeOffset'&&v.version==='health-connect-interval-v1'&&
  typeof v.start==='number'&&Number.isSafeInteger(v.start)&&v.start>=0&&typeof v.end==='number'&&Number.isSafeInteger(v.end)&&v.end<=8640000000000000&&v.end>v.start&&v.end-v.start<=86400000&&validOffset(v.bedOffset)&&validOffset(v.wakeOffset)&&v.start+v.bedOffset*60000<=253402300799999&&v.end+v.wakeOffset*60000<=253402300799999;
}
