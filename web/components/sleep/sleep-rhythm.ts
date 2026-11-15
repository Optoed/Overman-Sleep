import {clockStats} from './sleep-clock-insights';
import {clockMinutes,type Night} from './sleep-state';
export function sleepRhythm(nights:Night[],dates:string[]){
 const rows=dates.map(date=>nights.find(n=>n.date===date)),known=rows.filter((n):n is Night=>!!n),bed=clockStats(known.map(n=>clockMinutes(n.bedClock)));
 const deviation=known.length<3||bed.mean===null?null:known.reduce((sum,n)=>{const d=Math.abs(clockMinutes(n.bedClock)-bed.mean!);return sum+Math.min(d,1440-d);},0)/known.length;
 return {rows,count:known.length,successful:known.filter(n=>n.success).length,deviation};
}
