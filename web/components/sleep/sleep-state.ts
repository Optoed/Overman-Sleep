import { archiveScoreVersion, RECORD_SCORE_VERSION, DIARY_SCORE_VERSION, resolveDiaryScoreVersion, UnsupportedDiaryScoreVersion, type DiaryScoreVersion } from './sleep-score-version';
import {isAppearance,type AppearanceId} from './sleep-themes';
import {validateHealthScoreSnapshot,type HealthScoreSnapshot} from './sleep-health-score';
import {validHealthOrigin,type HealthOrigin} from './sleep-health-origin';
import {validHealthInterval,type HealthInterval} from './sleep-health-interval';
import { sleepDurationIssues } from './sleep-duration';
import {validTowerConditionPolicy,type TowerConditionPolicy} from './sleep-tower-condition';
import { offsetAt, validOffset, dateAt, clockAt, historyOffsets, MAX_NIGHT_MS } from './sleep-time';
import { createWorld, localDate, parseWorld, MAX_FLOORS, FLOOR_COST, type WorldState } from '../tower/world-state';

export const SLEEP_KEY = 'overman.sleep-tower.v1';
export type Schedule = { bed: string; wake: string; hours: number; tolerance: number };
export type Night = { healthInterval?:HealthInterval; healthOrigin?:HealthOrigin; healthScore?:HealthScoreSnapshot; scoreModel?: 'diary-v2'; rewardRule?: 'v1'; source?: 'manual' | 'timer' | 'health-connect'; sessionId?: string; bedOffset?: number; wakeOffset?: number; date: string; bed: number; wake: number; bedClock: string; wakeClock: string; sleepMinutes: number; rested: number; target: Schedule; success: boolean; latencyMinutes?: number; awakeMinutes?: number; noiseDbfs?: number; note?: string };
export type AlarmSettings = { enabled: boolean; reminder: boolean; reminderMinutes: number; ringtone: 'dawn' | 'bell' | 'birds'; volume: number; vibration: boolean; smart: boolean; smartMinutes: number; noise: boolean };
export const defaultAlarm: AlarmSettings = { enabled: false, reminder: false, reminderMinutes: 30, ringtone: 'dawn', volume: .6, vibration: true, smart: false, smartMinutes: 20, noise: false };
export type SleepState = { version: 1; scoreVersion?: DiaryScoreVersion; revision: number; world: WorldState; schedule: Schedule; configured: boolean; active: { id?: string; bedOffset?: number; wakeOffset?: number; timeReview?: boolean; started: number; target: Schedule; wokeAt?: number } | null; nights: Night[]; credits: string[]; deletedCredits?: string[]; garden: boolean; alarm?: AlarmSettings; theme?: 'night' | 'light'; appearance?: AppearanceId; appearanceMode?: 'auto'|'fixed'; towerCondition?:TowerConditionPolicy };
export const defaultSchedule: Schedule = { bed: '23:00', wake: '07:30', hours: 8, tolerance: 45 };
export const clockMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export const clockOf = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const distance = (a: string, b: string) => { const n = Math.abs(clockMinutes(a) - clockMinutes(b)); return Math.min(n, 1440 - n); };
const clockOK = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const dateOK = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function validSchedule(s: Schedule) {
  if (!s || !clockOK(s.bed) || !clockOK(s.wake) || !finite(s.hours, 4, 12) || ![30, 45, 60].includes(s.tolerance)) return false;
  const window = (clockMinutes(s.wake) - clockMinutes(s.bed) + 1440) % 1440;
  return window >= s.hours * 60 && window <= 960;
}
export function freshSleep(world = createWorld()): SleepState {
  return { version: 1, scoreVersion: DIARY_SCORE_VERSION, revision: 0, world: structuredClone(world), schedule: { ...defaultSchedule }, configured: false, active: null, nights: [], credits: [], garden: false };
}
export const sessionId=(active:{id?:string;started:number})=>active.id??`legacy-${active.started}`;
export const validSessionId=(id:unknown)=>typeof id==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(id);
export function nightPhase(state: SleepState): 'idle' | 'sleeping' | 'awaiting_mood' {
  return !state.active ? 'idle' : state.active.wokeAt === undefined ? 'sleeping' : 'awaiting_mood';
}
/** Repeated starts must preserve both an ongoing night and an unfinished morning. */
export function beginNight(state: SleepState, started = Date.now(), now = Date.now()): SleepState {
  if (state.active) return state;
  if (!finite(started, 0, Math.min(8640000000000000,now+60000)) || !validSchedule(state.schedule)) throw Error('Не удалось начать ночь: проверь время и режим сна.');
  return { ...state, active: { id: crypto.randomUUID(), bedOffset: offsetAt(started), started, target: { ...state.schedule } } };
}
/** The first confirmed wake wins; an event from another session is rejected. */
export function captureWake(state: SleepState, wokeAt: number, expectedStarted = state.active?.started, now = Date.now()): SleepState {
  const active = state.active;
  if (!active || expectedStarted !== active.started) throw Error('Эта ночь уже изменилась. Обнови состояние перед пробуждением.');
  if (active.wokeAt !== undefined) return state;
  if (!finite(wokeAt, active.timeReview?0:active.started, Math.min(8640000000000000, now + 60000))) throw Error('Не удалось сохранить время подъёма: проверь часы устройства.');
  return { ...state, active: { ...active, wokeAt, wakeOffset: active.wakeOffset??offsetAt(wokeAt) } };
}
/** Frozen identifiers: never change v1 semantics when introducing another rule. */
export const REWARD_RULES=Object.freeze({v1:Object.freeze({durationGraceMinutes:30,nightsPerFloor:7})});
/** Shared existing growth thresholds; historical reward-v1 semantics stay frozen. */
export const GROWTH_RULES=Object.freeze({nightsPerFloor:REWARD_RULES.v1.nightsPerFloor,gardenStreak:7});
export function rewardRuleFor(n:Pick<Night,'rewardRule'>){
 if(n.rewardRule!==undefined&&n.rewardRule!=='v1')throw Error('Правило награды этой записи пока не поддерживается. Исходная запись не изменена.');
 return REWARD_RULES.v1;
}
export function nightChecks(n: Pick<Night, 'bedClock' | 'wakeClock' | 'sleepMinutes' | 'target' | 'rewardRule'>) {
  return { bed: distance(n.bedClock, n.target.bed) <= n.target.tolerance, wake: distance(n.wakeClock, n.target.wake) <= n.target.tolerance, duration: n.sleepMinutes >= n.target.hours * 60 - rewardRuleFor(n).durationGraceMinutes };
}
export function streaks(nights: Night[], today = localDate()) {
  const ordered = [...nights].sort((a, b) => a.date.localeCompare(b.date));
  let run = 0, best = 0, prev = '';
  for (const n of ordered) { const contiguous = prev && (Date.parse(n.date) - Date.parse(prev)) === 86400000; run = n.success ? (contiguous ? run + 1 : 1) : 0; best = Math.max(best, run); prev = n.date; }
  const age = prev ? (Date.parse(today) - Date.parse(prev)) / 86400000 : Infinity;
  return { current: age >= 0 && age <= 1 ? run : 0, best };
}
export type NightInput = { bed: number; wake: number; bedOffset?: number; wakeOffset?: number; sleepMinutes: number; rested: number; latencyMinutes?: number; awakeMinutes?: number; noiseDbfs?: number; note?: string };
export class NightDateConflict extends Error{constructor(public date:string){super('На эту дату уже есть основная ночь. В v1 сохраняется одна ночь на дату пробуждения; дневной сон отдельно пока не поддерживается. Открой существующую запись, чтобы её исправить.');}}
export function recordNight(state: SleepState, input: NightInput, now = Date.now(), completion?: {id?:string;started:number;wokeAt:number},expectedEdit?:Night): SleepState {
  if (!finite(input.bed, 0, now) || !finite(input.wake, 0, now + 60000) || input.wake <= input.bed || input.wake - input.bed > MAX_NIGHT_MS) throw new Error('Проверь время: пробуждение должно быть после отхода ко сну, а ночь — не длиннее 24 часов.');
  if (!finite(input.sleepMinutes, 0, (input.wake - input.bed) / 60000) || !finite(input.rested, 1, 5) || !Number.isInteger(input.rested)) throw new Error('Оценка сна не может превышать время между отходом ко сну и пробуждением.');
  if (!validNightDetails(input)) throw new Error('Проверь время засыпания, бодрствования и заметку.');
  const durationError=Object.values(sleepDurationIssues({inBedMinutes:(input.wake-input.bed)/60000,sleepMinutes:input.sleepMinutes,latencyMinutes:input.latencyMinutes,awakeMinutes:input.awakeMinutes}))[0];
  if(durationError)throw Error(durationError);
  if((input.bedOffset!==undefined&&!validOffset(input.bedOffset))||(input.wakeOffset!==undefined&&!validOffset(input.wakeOffset)))throw Error('Неверный часовой пояс.');
  const bedOffset=input.bedOffset??offsetAt(input.bed),wakeOffset=input.wakeOffset??offsetAt(input.wake);
  const date = dateAt(input.wake,wakeOffset);
  const old = state.nights.find(n => n.date === date);
  if(old&&!expectedEdit)throw new NightDateConflict(date);
  if(expectedEdit){reviewedNight(state,expectedEdit);if(expectedEdit.date!==date)throw Error('При исправлении сохрани дату пробуждения.');}
  if(!completion&&!old&&input.wake>now)throw Error('Нельзя добавить будущую ночь.');
  if (state.nights.length >= 2000 && !old) throw new Error('Архив заполнен. Экспортируй записи перед дальнейшей работой.');
  // Diary dates do not identify a live session. Only its confirmed morning can
  // finish it; editing history must preserve even an overlapping active night.
  if (completion && (!state.active || state.active.wokeAt === undefined || state.active.started !== completion.started || state.active.wokeAt !== completion.wokeAt || (completion.id!==undefined&&state.active.id!==completion.id))) throw Error('Для завершения этой ночи сначала удерживай «Проснуться» 3 секунды.');
  const finishesActive = completion !== undefined;
  const target = (finishesActive ? state.active?.target : old?.target) ?? state.schedule;
  const n: Night = { ...input, ...(!old?{scoreModel:'diary-v2' as const}:old.scoreModel?{scoreModel:old.scoreModel}:{}), ...(!old?{rewardRule:'v1' as const}:old.rewardRule?{rewardRule:old.rewardRule}:{}), ...(!old||completion?{source:completion?'timer' as const:'manual' as const}:old.source?{source:old.source}:{}), ...(finishesActive&&state.active?{sessionId:sessionId(state.active)}:old?.sessionId?{sessionId:old.sessionId}:{}), date, bedOffset, wakeOffset, bedClock: clockAt(input.bed,bedOffset), wakeClock: clockAt(input.wake,wakeOffset), target: { ...target }, success: false };
  n.success = Object.values(nightChecks(n)).every(Boolean);
  if(old?.healthScore)n.healthScore=structuredClone(old.healthScore);
  if(old?.healthOrigin)n.healthOrigin=structuredClone(old.healthOrigin);
  if(old?.healthInterval)n.healthInterval=structuredClone(old.healthInterval);else delete n.healthInterval;
  const nights = [n, ...state.nights.filter(v => v.date !== date)].sort((a, b) => b.date.localeCompare(a.date));
  const credits = n.success && !state.credits.includes(date) ? [...state.credits, date] : state.credits;
  return { ...state, scoreVersion: state.scoreVersion==='health-intervals-v5'||state.scoreVersion==='health-sources-v4'||state.scoreVersion==='health-snapshots-v3'||nights.some(v=>v.healthScore||v.healthOrigin||v.healthInterval)?archiveScoreVersion({...state,nights}):n.scoreModel?RECORD_SCORE_VERSION:state.scoreVersion, nights, credits, ...(state.deletedCredits?{deletedCredits:state.deletedCredits.filter(d=>d!==date)}:{}), garden: state.garden || streaks(nights).best >= GROWTH_RULES.gardenStreak, active: finishesActive ? null : state.active };
}
/** Editing/removal must refer to the exact record the person reviewed. */
function reviewedNight(state:SleepState,expected:Night){
 const actual=state.nights.find(n=>n.date===expected.date);
 if(!actual||JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Запись уже изменилась или удалена. Закрой форму и открой её заново.');
 return actual;
}
export function editNight(state:SleepState,expected:Night,input:NightInput,now=Date.now()){
 reviewedNight(state,expected);
 if(dateAt(input.wake,input.wakeOffset??offsetAt(input.wake))!==expected.date)throw Error('При исправлении сохрани дату пробуждения. Для другой даты добавь отдельную ночь.');
 return recordNight(state,{...input,noiseDbfs:expected.noiseDbfs},now,undefined,expected);
}
/** Explicitly abandon only a confirmed second session for the reviewed occupied date. */
export function discardDuplicateMorning(state:SleepState,expected:NonNullable<SleepState['active']>,existing:Night):SleepState{
 const active=state.active;
 if(!active||active.wokeAt===undefined||sessionId(active)!==sessionId(expected)||active.started!==expected.started||active.wokeAt!==expected.wokeAt)throw Error('Этот сеанс уже изменился. Открой оценку заново.');
 reviewedNight(state,existing);
 if(dateAt(active.wokeAt,active.wakeOffset)!==existing.date)throw Error('Исправь дату подъёма: этот сеанс относится к другой дате.');
 return {...state,active:null};
}
export function deleteNight(state:SleepState,expected:Night):SleepState{
 reviewedNight(state,expected);
 const deletedCredits=state.credits.includes(expected.date)?[...new Set([...(state.deletedCredits??[]),expected.date])]:state.deletedCredits;
 return {...state,nights:state.nights.filter(n=>n.date!==expected.date),...(deletedCredits?{deletedCredits}: {})};
}
export function sleepWorld(state: SleepState, now = Date.now()): WorldState {
  const xp = Math.min(MAX_FLOORS*FLOOR_COST+99, state.world.xp + Math.floor(state.credits.length / GROWTH_RULES.nightsPerFloor) * 100 + Math.floor((state.credits.length % GROWTH_RULES.nightsPerFloor) * (100 - state.world.xp % 100) / GROWTH_RULES.nightsPerFloor));
  return { ...state.world, xp, mode: 'sleep', strength: 90, timer: null, weather: state.active ? 'sunset' : state.world.weather,
    streak: streaks(state.nights, localDate(new Date(now))).current, successfulDays: state.credits.length,
    motifs: state.garden ? [...new Set([...state.world.motifs, 'garden' as const])] : state.world.motifs };
}
export function parseSleep(raw: string | null): SleepState | null {
  if (raw === null) return null;
  try {
    if (raw.length > 3000000) throw Error(); const s = JSON.parse(raw) as SleepState;
    resolveDiaryScoreVersion(s?.scoreVersion);
    if (s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !parseWorld(JSON.stringify(s.world)) || !dateOK(s.world.date) || !s.world.history.every(n=>dateOK(n.date)) || !s.world.journal.every(n=>dateOK(n.date)) || !validSchedule(s.schedule) || typeof s.configured !== 'boolean' || typeof s.garden !== 'boolean') throw Error();
    if (s.alarm !== undefined && !validAlarm(s.alarm)) throw Error();
    if (s.theme !== undefined && !['night','light'].includes(s.theme)) throw Error();
    if(s.appearance!==undefined&&!isAppearance(s.appearance))throw Error();
    if(s.appearanceMode!==undefined&&!['auto','fixed'].includes(s.appearanceMode))throw Error();
    if(s.towerCondition!==undefined&&!validTowerConditionPolicy(s.towerCondition))throw Error();
    if (s.active !== null && (!s.active || !finite(s.active.started, 0, 8640000000000000) || !validSchedule(s.active.target) || (s.active.id!==undefined&&!validSessionId(s.active.id)) || (s.active.bedOffset!==undefined&&!validOffset(s.active.bedOffset)) || (s.active.wakeOffset!==undefined&&!validOffset(s.active.wakeOffset)) || (s.active.timeReview!==undefined&&typeof s.active.timeReview!=='boolean') || (s.active.wokeAt!==undefined&&!finite(s.active.wokeAt,s.active.timeReview?0:s.active.started,8640000000000000)))) throw Error();
    if (!Array.isArray(s.nights) || s.nights.length > 2000 || !Array.isArray(s.credits) || s.credits.length > 2000 || !s.credits.every(dateOK) || new Set(s.credits).size !== s.credits.length) throw Error();
    for (const n of s.nights) {
      if(n.healthInterval!==undefined&&(!validHealthInterval(n.healthInterval)||!n.healthScore||n.source!=='health-connect'||n.scoreModel!=='diary-v2'||Math.abs((n.healthInterval.end-n.healthInterval.start)/60000-n.healthScore.intervalMinutes)>1e-9))throw Error();
      if(n.healthOrigin!==undefined&&(!validHealthOrigin(n.healthOrigin)||!n.healthScore||n.source!=='health-connect'||n.scoreModel!=='diary-v2'))throw Error();
      if(n.healthScore!==undefined&&(!validateHealthScoreSnapshot(n.healthScore)||n.source!=='health-connect'||n.scoreModel!=='diary-v2'||Math.abs(n.healthScore.goalMinutes-n.target?.hours*60)>1e-9))throw Error();
      if (!n || (n.scoreModel!==undefined&&n.scoreModel!=='diary-v2') || (n.source!==undefined&&!['manual','timer','health-connect'].includes(n.source)) || (n.bedOffset!==undefined&&!validOffset(n.bedOffset)) || (n.wakeOffset!==undefined&&!validOffset(n.wakeOffset)) || (n.sessionId!==undefined&&!validSessionId(n.sessionId)) || !dateOK(n.date) || !finite(n.bed, 0, 8640000000000000) || !finite(n.wake, n.bed + 1, n.bed + 86400000) || !clockOK(n.bedClock) || !clockOK(n.wakeClock) || !finite(n.sleepMinutes, 0, (n.wake - n.bed) / 60000) || !Number.isInteger(n.rested) || !finite(n.rested, 1, 5) || !validSchedule(n.target) || n.success !== Object.values(nightChecks(n)).every(Boolean) || !validNightDetails(n)) throw Error();
      const offsets=historyOffsets(n);if(!validOffset(offsets.bed)||!validOffset(offsets.wake)||dateAt(n.wake,offsets.wake)!==n.date||clockAt(n.bed,offsets.bed)!==n.bedClock||clockAt(n.wake,offsets.wake)!==n.wakeClock)throw Error();
    }
    if(s.deletedCredits!==undefined&&(!Array.isArray(s.deletedCredits)||s.deletedCredits.length>2000||!s.deletedCredits.every(dateOK)||new Set(s.deletedCredits).size!==s.deletedCredits.length||s.deletedCredits.some(d=>!s.credits.includes(d)||s.nights.some(n=>n.date===d))))throw Error();
    if (new Set(s.nights.map(n => n.date)).size !== s.nights.length || s.credits.some(date => !s.nights.some(n => n.date === date)&&!s.deletedCredits?.includes(date)) || s.nights.some(n => n.success && !s.credits.includes(n.date))) throw Error();
    return s;
  } catch (error) { if(error instanceof UnsupportedDiaryScoreVersion)throw error;throw new Error('Сохранение сна повреждено. Мы не заменяли его. Сохрани копию данных и восстанови корректный файл.'); }
}
export function persistSleep(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, before: SleepState, next: SleepState) {
  const stored = parseSleep(storage.getItem(key));
  if ((stored?.revision ?? 0) !== before.revision) throw new Error('Записи изменились в другой вкладке. Скопируй незавершённый ввод и обнови страницу.');
  const saved = { ...next, scoreVersion: archiveScoreVersion(next), revision: before.revision + 1 }; parseSleep(JSON.stringify(saved));
  storage.setItem(key, JSON.stringify(saved)); return saved;
}
export function demoSleep(floors = 4, now = Date.now()) {
  let s = freshSleep(createWorld(27182)); s.configured = true;
  // Fictional demonstration nights are isolated from personal storage.
  const count = floors * 7;
  for (let i = count; i > 0; i--) {
    const wake = new Date(now); wake.setDate(wake.getDate() - i); wake.setHours(7, 30, 0, 0);
    const bed = new Date(wake); bed.setDate(bed.getDate() - 1); bed.setHours(23, 0, 0, 0);
    s = recordNight(s, { bed: +bed, wake: +wake, sleepMinutes: 450 + (i % 4) * 10, rested: 2 + i % 4 }, now);
  }
  return s;
}
export function localInput(ms: number) { const d = new Date(ms); return `${localDate(d)}T${clockOf(ms)}`; }

export function validAlarm(a: AlarmSettings) {
  return !!a && ['enabled','reminder','vibration','smart','noise'].every(k => typeof a[k as keyof AlarmSettings] === 'boolean') && [5,10,15,20,30,45,60,90,120].includes(a.reminderMinutes) && ['dawn','bell','birds'].includes(a.ringtone) && finite(a.volume,0,1) && [10,15,20,30,45,60].includes(a.smartMinutes);
}
function validNightDetails(n: {bed:number;wake:number;sleepMinutes:number;latencyMinutes?:number;awakeMinutes?:number;noiseDbfs?:number;note?:string}) {
  const remaining=(n.wake-n.bed)/60000-n.sleepMinutes;
  return (n.latencyMinutes===undefined||finite(n.latencyMinutes,0,remaining+.01)) && (n.awakeMinutes===undefined||finite(n.awakeMinutes,0,remaining+.01)) && (n.latencyMinutes??0)+(n.awakeMinutes??0)<=remaining+.01 && (n.noiseDbfs===undefined||finite(n.noiseDbfs,-120,0)) && (n.note===undefined||typeof n.note==='string'&&n.note.length<=2000);
}
