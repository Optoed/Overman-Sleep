import { journalWeekStart, journalWeekEnd, validCalendarDate } from './sleep-calendar';
import { shiftCalendarDate } from './sleep-time';

export type AnalyticsPeriodKind='week'|'month';
export type CalendarPeriod={start:string;end:string;days:number};
const length=(start:string,end:string)=>(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000+1;
/** Civil calendar ranges, never elapsed milliseconds in a device time zone. */
export function calendarPeriod(kind:AnalyticsPeriodKind,date:string):CalendarPeriod{
  if(!validCalendarDate(date))throw Error('Неверная дата периода.');
  const start=kind==='week'?journalWeekStart(date):date.slice(0,7)+'-01';
  let end:string;
  if(kind==='week')end=journalWeekEnd(date);
  else{const d=new Date(start+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1,0);end=d.toISOString().slice(0,10);if(end.startsWith('+'))end='9999-12-31';}
  return {start,end,days:length(start,end)};
}
export function analyticsPeriod(kind:AnalyticsPeriodKind,anchor:string,today:string){
  if(!validCalendarDate(anchor)||!validCalendarDate(today))throw Error('Неверная дата периода.');
  const current=calendarPeriod(kind,anchor>today?today:anchor),through=current.end>today?today:current.end;
  const previous=current.start==='0001-01-01'?null:calendarPeriod(kind,shiftCalendarDate(current.start,-1));
  const next=current.end==='9999-12-31'?null:calendarPeriod(kind,shiftCalendarDate(current.end,1));
  return {kind,current,through,shownDays:length(current.start,through),partial:through<current.end,previous,canNext:next!==null&&next.start<=today,next};
}
export type AnalyticsPeriodView=ReturnType<typeof analyticsPeriod>;
export function shiftAnalyticsPeriod(kind:AnalyticsPeriodKind,anchor:string,today:string,direction:-1|1){
  const view=analyticsPeriod(kind,anchor,today);
  return direction<0?view.previous?.start??view.current.start:view.canNext?view.next!.start:view.current.start;
}
export const periodDateLabel=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
export const periodRangeLabel=(range:Pick<CalendarPeriod,'start'|'end'>)=>`${periodDateLabel(range.start)} — ${periodDateLabel(range.end)}`;
