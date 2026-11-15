import {summarizeHealthSession,type HealthSleepSession} from './sleep-health-session';

/** A versioned, self-contained snapshot; later goal changes cannot alter it. */
type HealthScoreInputs={score:number;sleepMinutes:number;intervalMinutes:number;goalMinutes:number};
export type HealthScoreSnapshot=HealthScoreInputs&({version:'health-preview-v1'}|{version:'health-preview-v2';referenceMinutes:number});
function scoreFromInputs(sleepMinutes:number,intervalMinutes:number,goalMinutes:number){
 if(!Number.isFinite(intervalMinutes)||intervalMinutes<=0||intervalMinutes>1440||!Number.isFinite(sleepMinutes)||sleepMinutes<0||sleepMinutes>intervalMinutes||!Number.isFinite(goalMinutes)||goalMinutes<=0||goalMinutes>1440)throw Error('Некорректные данные для индекса сна.');
 const duration=Math.min(1,sleepMinutes/goalMinutes);
 const efficiency=Math.min(1,sleepMinutes/intervalMinutes/0.85);
 const durationPoints=70*duration,continuityPoints=30*duration*efficiency;
 return {score:Math.round(durationPoints+continuityPoints),durationPoints,continuityPoints};
}
export function validateHealthScoreSnapshot(value:unknown):value is HealthScoreSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 const v2=v.version==='health-preview-v2';
 if(Object.keys(v).sort().join(',')!==(v2?'goalMinutes,intervalMinutes,referenceMinutes,score,sleepMinutes,version':'goalMinutes,intervalMinutes,score,sleepMinutes,version')||(!v2&&v.version!=='health-preview-v1')||typeof v.sleepMinutes!=='number'||typeof v.intervalMinutes!=='number'||typeof v.goalMinutes!=='number'||!Number.isInteger(v.score))return false;
 if(v2&&(v.referenceMinutes!==Math.max(v.goalMinutes,420)||!Number.isFinite(v.goalMinutes)||v.goalMinutes<=0||v.goalMinutes>1440))return false;
 try{return scoreFromInputs(v.sleepMinutes,v.intervalMinutes,v2?v.referenceMinutes as number:v.goalMinutes).score===v.score;}catch{return false;}
}
export function snapshotHealthScore(session:HealthSleepSession,goalMinutes:number):HealthScoreSnapshot|null{
 const scored=healthSleepScore(session,goalMinutes);if(!scored)return null;
 return {version:scored.version,score:scored.score,sleepMinutes:scored.sleepMinutes,intervalMinutes:(session.end-session.start)/60000,goalMinutes};
}
/** Exploratory index from a complete source session, not a medical score.
 * Self-reported wellbeing, stage percentages and heart rate are not inputs. */
export function healthSleepScore(session:HealthSleepSession,goalMinutes:number){
 if(!Number.isFinite(goalMinutes)||goalMinutes<=0||goalMinutes>24*60)throw Error('Некорректная цель сна.');
 const summary=summarizeHealthSession(session);
 if(!summary.complete||summary.sleepMinutes===null)return null;
 const inBed=(session.end-session.start)/60000;
 const points=scoreFromInputs(summary.sleepMinutes,inBed,goalMinutes);
 return {...points,
  sleepMinutes:summary.sleepMinutes,awakeMinutes:summary.knownAwakeMinutes,
  goalMinutes,version:'health-preview-v1' as const};
}

/** Preview v2 uses an adult population reference as a lower bound, never a
 * claim about this person's ideal sleep or a medical assessment. V1 snapshots
 * keep their original formula and are not recalculated. */
export function healthSleepScoreV2(session:HealthSleepSession,goalMinutes:number){
 if(!Number.isFinite(goalMinutes)||goalMinutes<=0||goalMinutes>1440)throw Error('Некорректная цель сна.');
 const referenceMinutes=Math.max(goalMinutes,420);
 const score=healthSleepScore(session,referenceMinutes);if(!score)return null;
 return {...score,version:'health-preview-v2' as const,goalMinutes,referenceMinutes};
}
export function snapshotHealthScoreV2(session:HealthSleepSession,goalMinutes:number):HealthScoreSnapshot|null{
 const scored=healthSleepScoreV2(session,goalMinutes);if(!scored)return null;
 return {version:scored.version,score:scored.score,sleepMinutes:scored.sleepMinutes,intervalMinutes:(session.end-session.start)/60000,goalMinutes,referenceMinutes:scored.referenceMinutes};
}
/** Uses frozen inputs only, including after a diary correction. */
export function healthScoreDetails(snapshot:HealthScoreSnapshot){
 if(!validateHealthScoreSnapshot(snapshot))throw Error('Некорректный сохранённый индекс сна.');
 const reference=snapshot.version==='health-preview-v2'?snapshot.referenceMinutes:snapshot.goalMinutes;
 return {...scoreFromInputs(snapshot.sleepMinutes,snapshot.intervalMinutes,reference),referenceMinutes:reference,efficiency:snapshot.sleepMinutes/snapshot.intervalMinutes};
}
