import {summarizeHealthSession,type HealthSleepSession} from './sleep-health-session';
import {dateAt,validOffset} from './sleep-time';
import type {SleepState} from './sleep-state';
export type HealthPreviewStatus='ready'|'incomplete'|'existing'|'duplicate'|'overlap'|'history-overlap'|'active'|'future';
/** Undefined reviews all apps; null explicitly reviews records without a known app. */
export type HealthSourceChoice=string|null|undefined;
export function healthSessionSource(session:HealthSleepSession){return session.origin?.packageName??null;}
export function healthSessionSources(sessions:HealthSleepSession[]){return [...new Set(sessions.map(healthSessionSource))];}
const overlaps=(a:{start:number;end:number},b:{start:number;end:number})=>a.start<b.end&&b.start<a.end;
/** Read-only review: does not select, import or change the diary. */
export function previewHealthSessions(sessions:HealthSleepSession[],state:Pick<SleepState,'nights'|'credits'|'active'>,offsets:{bed:number;wake:number},now=Date.now(),sourcePackage:HealthSourceChoice=undefined){
 if(!Array.isArray(sessions)||sessions.length>1000||!validOffset(offsets?.bed)||!validOffset(offsets?.wake)||!Number.isFinite(now))throw Error('Невозможно подготовить просмотр записей.');
 // Validate the entire provider response before filtering; retain original indices for save.
 const allRows=sessions.map((session,index)=>{const summary=summarizeHealthSession(session);return {index,date:dateAt(summary.end,offsets.wake),bedOffset:offsets.bed,wakeOffset:offsets.wake,...summary};});
 if(sourcePackage!==undefined&&!healthSessionSources(sessions).includes(sourcePackage))throw Error('Источник изменился. Проверь список заново.');
 const rows=allRows.filter(row=>sourcePackage===undefined||healthSessionSource(sessions[row.index])===sourcePackage);
 const counts=new Map<string,number>();for(const row of rows)counts.set(row.date,(counts.get(row.date)??0)+1);
 const intersecting=new Set<number>();for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(overlaps(rows[i],rows[j])){intersecting.add(rows[i].index);intersecting.add(rows[j].index);}
 return rows.map(row=>{let status:HealthPreviewStatus='ready';
  if(state.active)status='active';else if(row.start<0||row.end>now)status='future';
  else if(state.nights.some(n=>n.date===row.date)||state.credits.includes(row.date))status='existing';
  else if(state.nights.some(n=>overlaps(row,{start:n.bed,end:n.wake})||n.healthInterval&&overlaps(row,n.healthInterval)))status='history-overlap';
  else if((counts.get(row.date)??0)>1)status='duplicate';
  else if(intersecting.has(row.index))status='overlap';
  else if(!row.complete||row.sleepMinutes===null||row.latencyMinutes===null||row.awakeMinutes===null)status='incomplete';
  return {...row,status};});
}
