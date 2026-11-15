/** Normalize a single explicit Health Connect session without inventing missing stages.
 * Inputs are supplied by an Android adapter after permission, never fetched here. */
import {validHealthOrigin,type HealthOrigin} from './sleep-health-origin';
export type HealthStageKind='awake'|'sleeping'|'light'|'deep'|'rem'|'unknown';
export type HealthStage={start:number;end:number;kind:HealthStageKind};
export type HealthSleepSession={start:number;end:number;stages:HealthStage[];origin?:HealthOrigin};
export function summarizeHealthSession(session:HealthSleepSession){
 const {start,end,stages}=session;
 if(session.origin!==undefined&&!validHealthOrigin(session.origin))throw Error('Некорректные данные об источнике сна.');
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>24*60*60*1000||!Array.isArray(stages)||stages.length>10000)throw Error('Invalid sleep session');
 const sleepKinds=new Set<HealthStageKind>(['sleeping','light','deep','rem']);
 const allowed=new Set<HealthStageKind>(['awake','sleeping','light','deep','rem','unknown']);
 const ordered=stages.map(s=>({...s})).sort((a,b)=>a.start-b.start||a.end-b.end);let cursor=start,sleepMs=0,awakeMs=0,unknownMs=0,firstSleep:number|null=null,latencyMs=0;
 for(const stage of ordered){
  if(!Number.isFinite(stage.start)||!Number.isFinite(stage.end)||stage.start<start||stage.end>end||stage.end<=stage.start||stage.start<cursor||!allowed.has(stage.kind))throw Error('Invalid or overlapping sleep stage');
  unknownMs+=stage.start-cursor;const length=stage.end-stage.start;
  if(sleepKinds.has(stage.kind)){sleepMs+=length;if(firstSleep===null)firstSleep=stage.start;}
  else if(stage.kind==='awake'){awakeMs+=length;if(firstSleep===null)latencyMs+=length;}else unknownMs+=length;
  cursor=stage.end;
 }
 unknownMs+=end-cursor;
 // An incomplete record is not enough to produce exact sleep/awake minutes.
 const complete=unknownMs===0;
 return {start,end,complete,knownSleepMinutes:sleepMs/60000,knownAwakeMinutes:awakeMs/60000,unknownMinutes:unknownMs/60000,
  sleepMinutes:complete?sleepMs/60000:null,latencyMinutes:complete&&firstSleep!==null?latencyMs/60000:null,
  awakeMinutes:complete&&firstSleep!==null?(awakeMs-latencyMs)/60000:null};
}
