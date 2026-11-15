import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sleepTrend,summarize,compareSleepPeriods,COMPARISON_MIN_NIGHTS,nightScore,backupText,readBackup} from '../components/sleep/sleep-insights';
import {parseSleep,type Night} from '../components/sleep/sleep-state';
const load=(n:string)=>JSON.parse(readFileSync(resolve(import.meta.dirname,'../../docs/product-evidence/'+n),'utf8'));
const original=()=>parseSleep(JSON.stringify(load('04.04-r2-beta-device-after-archive.json')))!;
const base=original().nights.find(n=>n.date==='2026-11-02')!;
function night(date:string,minutes:number,mood=3):Night{const wake=Date.parse(date+'T00:03:00Z');return{...base,date,bed:wake-480*60000,wake,bedOffset:0,wakeOffset:0,sleepMinutes:minutes,rested:mood,success:minutes>=450,note:'Тест среднего'};}
const stat=(count:number,sleep=480,mood=3)=>summarize(Array.from({length:count},(_,i)=>night('2026-11-'+String(i+1).padStart(2,'0'),sleep,mood)),'2026-11-07',7);

test('separate night keeps own score/mood while seven-day point is unweighted mean of recorded daily values',()=>{const rows=[night('2026-11-01',0,1),night('2026-11-03',240,3),night('2026-11-05',480,5)],p=sleepTrend(rows,'2026-11-05',1)[0];assert.equal(p.dailyScore,100);assert.equal(p.dailyMood,5);assert.equal(p.score,145/3);assert.equal(p.mood,3);assert.equal(p.count,3);assert.equal(p.windowStart,'2026-10-30');assert.notEqual(p.score,nightScore(night('2026-11-05',240)));assert.notEqual(p.score,145/7);});

test('inclusive calendar window excludes eighth-previous and future nights, regardless of input order',()=>{const rows=[night('2026-10-29',0),night('2026-10-30',240),night('2026-11-05',480),night('2026-11-06',0)],p=sleepTrend(rows,'2026-11-05',1)[0];assert.equal(p.windowStart,'2026-10-30');assert.equal(p.count,2);assert.equal(p.score,72.5);assert.equal(p.dailyScore,100);assert.deepEqual(sleepTrend([...rows].reverse(),'2026-11-05',1),[p]);});

test('missing date has no daily value or plotted point even with records in its window; it never becomes zero',()=>{const rows=[night('2026-11-01',480),night('2026-11-05',0)],p=sleepTrend(rows,'2026-11-03',1)[0];assert.equal(p.count,1);assert.equal(p.dailyScore,null);assert.equal(p.dailyMood,null);assert.equal(p.score,null);assert.equal(p.mood,null);assert.equal(p.windowStart,'2026-10-28');const end=sleepTrend(rows,'2026-11-05',1)[0];assert.equal(end.dailyScore,0);assert.equal(end.score,50);assert.equal(end.count,2);});

test('empty and isolated zero histories distinguish absence, real0 and one-record mean',()=>{const empty=sleepTrend([],'2026-11-05',3);assert.ok(empty.every(p=>p.count===0&&p.score===null&&p.dailyScore===null&&p.dailyMood===null));const zero=sleepTrend([night('2026-11-05',0,1)],'2026-11-05',1)[0];assert.equal(zero.dailyScore,0);assert.equal(zero.score,0);assert.equal(zero.dailyMood,1);assert.equal(zero.mood,1);assert.equal(zero.count,1);});

test('calendar seven-day window crosses month/year without turning into last seven records',()=>{const rows=[night('2026-12-27',0),night('2026-12-28',240),night('2026-12-31',480),night('2027-01-03',480)];const p=sleepTrend(rows,'2027-01-03',1)[0];assert.equal(p.windowStart,'2026-12-28');assert.equal(p.count,3);assert.equal(p.score,245/3);assert.equal(p.dailyScore,100);});

test('fewer than three records in either period hides both differences, including extreme apparent changes',()=>{assert.equal(COMPARISON_MIN_NIGHTS,3);for(let a=0;a<3;a++)for(let b=0;b<=5;b++){const ab=compareSleepPeriods(stat(a,480,5),stat(b,0,1)),ba=compareSleepPeriods(stat(b,0,1),stat(a,480,5));for(const c of[ab,ba]){assert.equal(c.comparable,false);assert.equal(c.minimumNights,3);assert.equal(c.score,null);assert.equal(c.mood,null);}}});

test('three genuine records suffice for numerical mean difference; unequal larger counts remain explicit, zero is data',()=>{const a=stat(3,0,1),b=stat(5,480,5),c=compareSleepPeriods(a,b);assert.equal(c.comparable,true);assert.equal(c.score,-100);assert.equal(c.mood,-4);const equal=compareSleepPeriods(a,a);assert.equal(equal.score,0);assert.equal(equal.mood,0);assert.equal(equal.comparable,true);});

test('difference uses original means before final display rounding, and missing/nonfinite aggregates stay unavailable',()=>{const a=summarize([night('2026-11-01',480),night('2026-11-02',480),night('2026-11-03',0)],'2026-11-07',7),b=summarize([night('2026-11-01',480),night('2026-11-02',240),night('2026-11-03',0)],'2026-11-07',7),d=compareSleepPeriods(a,b);assert.ok(d.comparable);assert.equal(d.score,a.score!-b.score!);assert.equal(d.score!.toFixed(1),'18.3');assert.notEqual(d.score!.toFixed(1),(+a.score!.toFixed(1)- +b.score!.toFixed(1)).toFixed(1));for(const bad of[{...a,score:null},{...a,mood:null},{...a,score:NaN},{...a,mood:Infinity}]){const c=compareSleepPeriods(bad,b);assert.equal(c.comparable,false);assert.equal(c.score,null);assert.equal(c.mood,null);}});

test('new read-only projections preserve all legacy scores/targets/rules/notes/credits/version and raw backup data',()=>{const s=original(),raw=JSON.stringify(s),gold=load('04.01-r2-score-compat.json').values as {date:string;before:number}[];const points=sleepTrend(s.nights,'2026-11-05',32,'diary-v1');for(const n of s.nights){assert.equal(nightScore(n),gold.find(g=>g.date===n.date)!.before);const p=points.find(p=>p.date===n.date)!;assert.equal(p.dailyScore,nightScore(n));assert.equal(p.dailyMood,n.rested);}compareSleepPeriods(summarize(s.nights,'2026-11-05',7),summarize(s.nights,'2026-10-29',7));assert.equal(JSON.stringify(s),raw);assert.deepEqual(readBackup(backupText(s)),s);assert.ok(!raw.includes('dailyScore'));assert.ok(!raw.includes('windowStart'));});
