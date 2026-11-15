import {assessSleep} from './sleep-assessment';
import { sleepDiaryForExport } from '../../lib/sleep-sync-archive';
import { clockPeriod } from './sleep-clock-insights';
import { archiveScoreVersion, DIARY_SCORE_VERSION, resolveDiaryScoreVersion, type DiaryScoreVersion } from './sleep-score-version';
import { shiftCalendarDate } from './sleep-time';
import { clockMinutes, distance, localInput, parseSleep, type Night, type Schedule, type SleepState } from './sleep-state';
import { localDate } from '../tower/world-state';

export const minutesLabel=(v:number|null)=>v===null?'—':`${Math.floor(Math.round(v)/60)} ч ${Math.round(v)%60} мин`;
export const minuteLabel=(v:number|null)=>v===null?'—':`${Math.round(v)} мин`;
export const clockLabel=(v:number|null)=>v===null?'—':`${String(Math.floor(((Math.round(v)%1440)+1440)%1440/60)).padStart(2,'0')}:${String(((Math.round(v)%60)+60)%60).padStart(2,'0')}`;
export const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
export const inBed=(n:Night)=>(n.wake-n.bed)/60000;
export const DURATION_METRICS=['sleep','bed','latency','awake'] as const;
export type DurationMetric=typeof DURATION_METRICS[number];
/** Recorded minutes only. Missing optional observations are not inferred. */
export function durationValues(night?:Night){return {sleep:night?.sleepMinutes??null,bed:night?inBed(night):null,latency:night?.latencyMinutes??null,awake:night?.awakeMinutes??null};}
export function durationSummary(nights:Night[],dates:string[]){
  const rows=dates.map(date=>{const night=nights.find(n=>n.date===date);return {date,recorded:!!night,...durationValues(night)};});
  const metrics=Object.fromEntries(DURATION_METRICS.map(key=>{const known=rows.flatMap(row=>row[key]===null?[]:[row[key]!]);return [key,{count:known.length,mean:mean(known)}];})) as Record<DurationMetric,{count:number;mean:number|null}>;
  return {rows,recordCount:rows.filter(row=>row.recorded).length,metrics};
}
export const debt=(n:Night)=>Math.max(0,n.target.hours*60-n.sleepMinutes);
/** Equal-weight diary deficits, using each record's historical target. */
export function debtSummary(nights:Night[],dates:string[]){
  const rows=dates.map(date=>{const night=nights.find(n=>n.date===date);return {date,recorded:!!night,target:night?night.target.hours*60:null,sleep:night?.sleepMinutes??null,deficit:night?debt(night):null};});
  const known=rows.flatMap(row=>row.deficit===null?[]:[row.deficit]);
  const total=known.length?known.reduce((sum,value)=>sum+value,0):null;
  return {rows,count:known.length,total,mean:total===null?null:total/known.length};
}

/** Frozen product definition; the identifier must change if this formula changes. */
export const DIARY_SCORE=Object.freeze({version:DIARY_SCORE_VERSION,base:60,efficiencyWeight:20,bedWeight:10,wakeWeight:10,regularityFadeMinutes:120,minimumBedMinutes:1});
/** A diary comparison index, not a clinical scale or sleep-stage measurement. */
export function nightScoreDetails(n:Night,version:DiaryScoreVersion=DIARY_SCORE_VERSION) {
  resolveDiaryScoreVersion(version);
  if(n.scoreModel==='diary-v2')return assessSleep(n);
  const bedMinutes=inBed(n),goalMinutes=n.target.hours*60;
  if(!Number.isFinite(n.sleepMinutes)||n.sleepMinutes<0||!Number.isFinite(bedMinutes)||bedMinutes<=0||!Number.isFinite(goalMinutes)||goalMinutes<=0)throw Error('Для расчёта нужны корректные длительность сна, время в кровати и цель.');
  const regularity=(actual:string,target:string)=>Math.max(0,1-Math.max(0,distance(actual,target)-n.target.tolerance)/DIARY_SCORE.regularityFadeMinutes);
  const duration=Math.min(1,n.sleepMinutes/goalMinutes),efficiency=Math.min(1,n.sleepMinutes/Math.max(DIARY_SCORE.minimumBedMinutes,bedMinutes));
  const bedRegularity=regularity(n.bedClock,n.target.bed),wakeRegularity=regularity(n.wakeClock,n.target.wake);
  const raw=duration*(DIARY_SCORE.base+DIARY_SCORE.efficiencyWeight*efficiency+DIARY_SCORE.bedWeight*bedRegularity+DIARY_SCORE.wakeWeight*wakeRegularity);
  if(!Number.isFinite(raw))throw Error('Для расчёта нужны корректные часы и допуск записи.');
  return {version:DIARY_SCORE_VERSION,score:Math.max(0,Math.min(100,Math.round(raw))),raw,duration,efficiency,bedRegularity,wakeRegularity,bedMinutes,goalMinutes};
}
export const mixedScoreModels=(nights:Night[])=>new Set(nights.map(n=>n.scoreModel??DIARY_SCORE_VERSION)).size>1;
export const nightScore=(n:Night,version:DiaryScoreVersion=DIARY_SCORE_VERSION)=>nightScoreDetails(n,version).score;
export function sleepTrend(nights:Night[],end:string,days:number,version:DiaryScoreVersion=DIARY_SCORE_VERSION){
  resolveDiaryScoreVersion(version);
  return dateRange(end,days).map(date=>{
    const windowStart=shiftDate(date,-6),rows=nights.filter(n=>n.date>=windowStart&&n.date<=date),night=nights.find(n=>n.date===date);
    // A point needs its own diary record; missing dates remain gaps even when
    // earlier records exist in the seven-calendar-day window.
    const scoreMixed=mixedScoreModels(rows);
    return {date,windowStart,scoreMixed,count:rows.length,dailyScore:night?nightScore(night,version):null,dailyMood:night?.rested??null,score:night&&!scoreMixed?mean(rows.map(n=>nightScore(n,version))):null,mood:night?mean(rows.map(n=>n.rested)):null};
  });
}
export const scoreColor=(n:number)=>n<40?'#ef817d':n<60?'#f1a368':n<80?'#e6cd83':'#8cdac6';
export const bedtimeMinute=(n:Night)=>{const m=clockMinutes(n.bedClock);return m<720?m+1440:m;};
export function dateRange(end:string,days:number) {return Array.from({length:days},(_,i)=>shiftCalendarDate(end,-days+1+i));}
export const shiftDate=shiftCalendarDate;
export function summarize(nights:Night[],end:string,days:number,version:DiaryScoreVersion=DIARY_SCORE_VERSION) {
  resolveDiaryScoreVersion(version);
  const dates=dateRange(end,days),rows=nights.filter(n=>n.date>=dates[0]&&n.date<=end);
  const optional=(key:'latencyMinutes'|'awakeMinutes'|'noiseDbfs')=>mean(rows.flatMap(n=>n[key]===undefined?[]:[n[key]!]));
  const clocks=clockPeriod(rows,dates).metrics;
  return { dates, rows, scoreMixed:mixedScoreModels(rows), score:mixedScoreModels(rows)?null:mean(rows.map(n=>nightScore(n,version))), duration:mean(rows.map(n=>n.sleepMinutes)), inBed:mean(rows.map(inBed)), debt:rows.length?rows.reduce((s,n)=>s+debt(n),0):null, meanDebt:mean(rows.map(debt)), bedtime:clocks.bed.mean, wake:clocks.wake.mean, earliestBed:clocks.bed.earliest, latestBed:clocks.bed.latest, latency:optional('latencyMinutes'), awake:optional('awakeMinutes'), noise:optional('noiseDbfs'), mood:mean(rows.map(n=>n.rested)), asleepAt:clocks.asleep.mean, earliestWake:clocks.wake.earliest, latestWake:clocks.wake.latest };
}
/** Product display guard, not a medical/statistical significance threshold. */
export const COMPARISON_MIN_NIGHTS=3;
export function compareSleepPeriods(current:Pick<ReturnType<typeof summarize>,'rows'|'score'|'mood'>,previous:Pick<ReturnType<typeof summarize>,'rows'|'score'|'mood'>){
  const models=(rows:Night[])=>[...new Set(rows.map(n=>n.scoreModel??'diary-v1'))];
  const currentModels=models(current.rows),previousModels=models(previous.rows);
  const comparable=currentModels.length===1&&previousModels.length===1&&currentModels[0]===previousModels[0]&&[current,previous].every(p=>p.rows.length>=COMPARISON_MIN_NIGHTS&&p.score!==null&&p.mood!==null&&Number.isFinite(p.score)&&Number.isFinite(p.mood));
  return {comparable,mixedModels:currentModels.length>1||previousModels.length>1||currentModels.length===1&&previousModels.length===1&&currentModels[0]!==previousModels[0],minimumNights:COMPARISON_MIN_NIGHTS,score:comparable?current.score!-previous.score!:null,mood:comparable?current.mood!-previous.mood!:null};
}
export function nextClock(clock:string,now=Date.now()) {const d=new Date(now);const [h,m]=clock.split(':').map(Number);d.setHours(h,m,0,0);if(+d<=now)d.setDate(d.getDate()+1);return +d;}
export function reminderTime(schedule:Schedule,lead:number,now=Date.now()) {
  if(![5,10,15,20,30,45,60,90,120].includes(lead))throw Error('Выбери время напоминания из списка.');
  const [h,m]=schedule.bed.split(':').map(Number),base=new Date(now);
  for(let day=0;day<4;day++){const bed=new Date(base.getFullYear(),base.getMonth(),base.getDate()+day,h,m,0,0),at=+bed-lead*60000;if(at>now)return at;}
  throw Error('Не удалось определить следующее напоминание.');
}
export function backupText(s:SleepState){return JSON.stringify({format:'overman-sleep',version:1,exportedAt:new Date().toISOString(),state:{...JSON.parse(sleepDiaryForExport(JSON.stringify(s))),scoreVersion:archiveScoreVersion(s)}},null,2);}
export function readBackup(text:string) {
  if(text.length>3500000)throw Error('Файл слишком большой. Максимум 3,5 МБ.');
  let value;try{value=JSON.parse(text);}catch{throw Error('Это не JSON-файл резервной копии.');}
  const raw=value?.format==='overman-sleep'?value.state:value;
  if(value?.format==='overman-sleep'&&value.version!==1)throw Error('Версия резервной копии не поддерживается.');
  const state=parseSleep(sleepDiaryForExport(JSON.stringify(raw)));if(!state)throw Error('В файле нет записей сна.');return state;
}
export function morningDefaults(schedule:Schedule,date=localDate(),active?:number) {
  const wake=new Date(`${date}T${schedule.wake}:00`),bed=new Date(`${date}T${schedule.bed}:00`);if(+bed>=+wake)bed.setDate(bed.getDate()-1);
  return {bed:localInput(active??+bed),wake:localInput(+wake)};
}
