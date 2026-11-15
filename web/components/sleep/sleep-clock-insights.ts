import {clockMinutes,type Night} from './sleep-state';
export const CLOCK_METRICS=['bed','asleep','wake'] as const;
export type ClockMetric=typeof CLOCK_METRICS[number];
export const clockMinute=(value:number)=>((value%1440)+1440)%1440;
/** Observed local clocks. Estimated asleep time uses the recorded bed-clock frame. */
export function clockTimeValues(night?:Night){return {bed:night?clockMinutes(night.bedClock):null,asleep:night&&night.latencyMinutes!==undefined?clockMinute(clockMinutes(night.bedClock)+night.latencyMinutes):null,wake:night?clockMinutes(night.wakeClock):null};}
/** Equal-weight vector mean on a24-hour dial; zero resultant has no defined direction. */
export function clockStats(input:(number|null)[]){
  const known=input.filter((v):v is number=>v!==null);if(known.some(v=>!Number.isFinite(v)))throw Error('Неверное время для сравнения.');
  const sorted=known.map(clockMinute).sort((a,b)=>a-b);let start=sorted[0]??0,gap=-1;
  for(let i=0;i<sorted.length;i++){const next=i+1<sorted.length?sorted[i+1]:sorted[0]+1440,difference=next-sorted[i],candidate=clockMinute(next);if(difference>gap+1e-9||Math.abs(difference-gap)<1e-9&&candidate<start){start=candidate;gap=difference;}}
  const plotValues=input.map(value=>value===null?null:clockMinute(value)+(clockMinute(value)<start-1e-9?1440:0)),plotKnown=plotValues.filter((v):v is number=>v!==null);
  const low=plotKnown.length?Math.min(...plotKnown):null,high=plotKnown.length?Math.max(...plotKnown):null;
  const x=known.reduce((sum,value)=>sum+Math.cos(clockMinute(value)*Math.PI/720),0),y=known.reduce((sum,value)=>sum+Math.sin(clockMinute(value)*Math.PI/720),0);
  const mean=known.length&&Math.hypot(x,y)/known.length>=1e-10?clockMinute(Math.atan2(y,x)*720/Math.PI):null;
  const plotMean=mean===null||low===null||high===null?null:mean+1440*Math.round(((low+high)/2-mean)/1440);
  return {count:known.length,mean,earliest:low===null?null:clockMinute(low),latest:high===null?null:clockMinute(high),plotValues,plotMean,ambiguous:known.length>0&&mean===null};
}
export function clockPeriod(nights:Night[],dates:string[]){
  const rows=dates.map(date=>{const night=nights.find(n=>n.date===date);return{date,recorded:!!night,...clockTimeValues(night)};});
  const metrics=Object.fromEntries(CLOCK_METRICS.map(key=>[key,clockStats(rows.map(row=>row[key]))])) as Record<ClockMetric,ReturnType<typeof clockStats>>;
  return {rows,recordCount:rows.filter(row=>row.recorded).length,metrics};
}
