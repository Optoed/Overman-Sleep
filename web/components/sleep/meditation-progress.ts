import {localDate} from '../tower/world-state';
export const MEDITATION_KEY='overman.meditation.sessions.v2';
export type MeditationRecord={id:string;started:number;finished:number;minutes:number;date:string};
export type MeditationBook={version:2;records:MeditationRecord[];active:{id:string;started:number;minutes:number;quiet?:boolean}|null};
export const emptyMeditation=():MeditationBook=>({version:2,records:[],active:null});
export const MEDITATION_LENGTHS=[5,10,12,15,20] as const;
const validMinute=(n:number)=>MEDITATION_LENGTHS.includes(n as 5);
export function parseMeditation(raw:string|null):MeditationBook{
 if(raw===null)return emptyMeditation();
 const b=JSON.parse(raw) as MeditationBook;
 const session=(s:{id:string;started:number;minutes:number})=>s&&typeof s.id==='string'&&s.id.length>0&&s.id.length<=100&&Number.isSafeInteger(s.started)&&s.started>0&&validMinute(s.minutes);
 const date=(s:string)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!b||b.version!==2||!Array.isArray(b.records)||b.records.length>10000||b.records.some(r=>!session(r)||!Number.isSafeInteger(r.finished)||r.finished<r.started+r.minutes*60000||!date(r.date))||new Set(b.records.map(r=>r.id)).size!==b.records.length||(b.active!==null&&(!session(b.active)||(b.active.quiet!==undefined&&typeof b.active.quiet!=='boolean')||b.records.some(r=>r.id===b.active!.id))))throw Error('Не удалось прочитать медитации. Исходные данные сохранены.');
 return b;
}
export function meditationRecommendation(book:MeditationBook){return [10,12,15,20][Math.min(3,Math.floor(book.records.filter(r=>r.minutes>=10).length/3))];}
export function meditationStats(book:MeditationBook,today=localDate()){
 const dates=[...new Set(book.records.map(r=>r.date))].sort();let current=0,best=0,run=0,last='';
 for(const date of dates){run=last&&Date.parse(date)-Date.parse(last)===86400000?run+1:1;best=Math.max(best,run);last=date;}
 const yesterday=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);if(last===today||last===yesterday)current=run;
 return {current,best,sessions:book.records.length,minutes:book.records.reduce((n,r)=>n+r.minutes,0),dates};
}
export function completeMeditation(book:MeditationBook,now:number):MeditationBook{
 const s=book.active;if(!s||!Number.isSafeInteger(now)||now<s.started+s.minutes*60000)throw Error('Сеанс ещё не завершён.');
 // Completion is explicitly confirmed; never infer attention or sensor measurement.
 return {...book,active:null,records:[...book.records,{...s,finished:now,date:localDate(new Date(now))}]};
}
