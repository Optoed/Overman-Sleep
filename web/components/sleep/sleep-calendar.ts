import { shiftCalendarDate } from './sleep-time';
/** Civil dates, independent of device offset and DST. Monday is the first day. */
export function validCalendarDate(value: unknown): value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')return false;
 const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;
}
export function journalWeekEnd(date:string){
 if(!validCalendarDate(date))throw Error('Неверная дата.');
 const end=shiftCalendarDate(date,(7-new Date(date+'T00:00:00Z').getUTCDay())%7);return end.startsWith('+')?'9999-12-31':end;
}
export function journalWeekStart(date:string){if(!validCalendarDate(date))throw Error('Неверная дата.');return shiftCalendarDate(date,-(new Date(date+'T00:00:00Z').getUTCDay()+6)%7);}
export function previousJournalDay(selected:string){return selected<'0001-01-08'?'0001-01-01':shiftCalendarDate(selected,-7);}
export function nextJournalDay(selected:string,today:string){if(selected>=today)return today;const next=shiftCalendarDate(selected,7);return next.startsWith('+')||next>today?today:next;}
export type NotificationTarget={id:string;target:'sleep'|'morning'};
export function readNotificationTarget(raw:string|undefined):NotificationTarget|null{
 try{const v=JSON.parse(raw??'null');return v&&typeof v.id==='string'&&v.id.length>0&&v.id.length<100&&(v.target==='sleep'||v.target==='morning')?{id:v.id,target:v.target}:null;}catch{return null;}
}
