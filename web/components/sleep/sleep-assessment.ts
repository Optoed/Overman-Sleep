import type {Night} from './sleep-state';
import {distance} from './sleep-state';
/** Product index v2; transparent diary estimate, not a validated physiological scale.
 * Never infer movement, stages, pulse or awakenings from ambient sound.
 * Frozen per record, so an update cannot silently reinterpret archived scores. */
export const ASSESSMENT_MODEL='diary-v2' as const;
export const ASSESSMENT_WEIGHTS=Object.freeze({duration:60,efficiency:20,schedule:20});
export function assessSleep(n:Night){
 const bedMinutes=(n.wake-n.bed)/60000,goalMinutes=n.target.hours*60;
 if(!Number.isFinite(bedMinutes)||bedMinutes<=0||!Number.isFinite(goalMinutes)||goalMinutes<=0||!Number.isFinite(n.sleepMinutes)||n.sleepMinutes<0||n.sleepMinutes>bedMinutes+.01)throw Error('Некорректные данные для оценки сна.');
 const duration=Math.min(1,n.sleepMinutes/goalMinutes),efficiency=Math.min(1,n.sleepMinutes/bedMinutes);
 const adherence=(actual:string,target:string)=>Math.max(0,1-Math.max(0,distance(actual,target)-n.target.tolerance)/120);
 const bedRegularity=adherence(n.bedClock,n.target.bed),wakeRegularity=adherence(n.wakeClock,n.target.wake);
 // A short night must not retain a large base score merely for good timing.
 const points={duration:60*duration**2,efficiency:20*duration*efficiency,schedule:20*duration*(bedRegularity+wakeRegularity)/2};
 const raw=points.duration+points.efficiency+points.schedule;
 if(!Number.isFinite(raw))throw Error('Некорректные часы для оценки сна.');
 const pausesKnown=n.latencyMinutes!==undefined&&n.awakeMinutes!==undefined;
 return {version:ASSESSMENT_MODEL,score:Math.round(Math.max(0,Math.min(100,raw))),raw,points,duration,efficiency,bedRegularity,wakeRegularity,bedMinutes,goalMinutes,
  source:n.source==='timer'?'timer-and-diary' as const:n.source==='health-connect'?'health-connect' as const:'diary' as const,pausesKnown,
  missing:pausesKnown?[]:['Засыпание и ночное бодрствование не уточнены'],
  sensorMeasured:false as const};
}
