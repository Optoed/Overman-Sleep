import {previewHealthSessions,type HealthSourceChoice} from './sleep-health-preview';
import {recordNight,parseSleep,type SleepState} from './sleep-state';
import type {HealthSleepSession} from './sleep-health-session';
import {snapshotHealthScoreV2} from './sleep-health-score';
import {archiveScoreVersion} from './sleep-score-version';
/** Only an explicit reviewed selection may become a new diary night. */
export function importHealthNight(state:SleepState,sessions:HealthSleepSession[],index:number,offsets:{bed:number;wake:number},rested:number,now=Date.now(),sourcePackage:HealthSourceChoice=undefined):SleepState{
 if(!Number.isInteger(index)||index<0||index>=sessions.length||!Number.isInteger(rested)||rested<1||rested>5)throw Error('Выбери запись и самочувствие.');
 const row=previewHealthSessions(sessions,state,offsets,now,sourcePackage).find(row=>row.index===index);if(!row||row.status!=='ready'||row.sleepMinutes===null||row.latencyMinutes===null||row.awakeMinutes===null)throw Error('Запись изменилась или её нельзя сохранить. Проверь список заново.');
 const next=recordNight(state,{bed:row.start,wake:row.end,bedOffset:row.bedOffset,wakeOffset:row.wakeOffset,sleepMinutes:row.sleepMinutes,latencyMinutes:row.latencyMinutes,awakeMinutes:row.awakeMinutes,rested},now);
 const healthScore=snapshotHealthScoreV2(sessions[index],state.schedule.hours*60);if(!healthScore)throw Error('Для сохранённого индекса недостаточно данных.');
 const origin=sessions[index].origin;
 const healthInterval={version:'health-connect-interval-v1' as const,start:row.start,end:row.end,bedOffset:row.bedOffset,wakeOffset:row.wakeOffset};
 const nights=next.nights.map(n=>n.date===row.date?{...n,source:'health-connect' as const,healthScore,healthInterval,...(origin?{healthOrigin:structuredClone(origin)}:{})}:n);const result={...next,nights,scoreVersion:archiveScoreVersion({...next,nights})};parseSleep(JSON.stringify(result));return result;
}
