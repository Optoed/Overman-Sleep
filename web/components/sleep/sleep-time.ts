export const MAX_NIGHT_MS=24*3600000;
export type TimeOffsets={bed?:number;wake?:number};
/** Minutes east of UTC; stored per endpoint because travel/DST can change it. */
export const offsetAt=(ms:number)=>-new Date(ms).getTimezoneOffset();
export const validOffset=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=-840&&v<=840;
export const validOffsets=(v:unknown):v is TimeOffsets=>!!v&&typeof v==='object'&&['bed','wake'].every(k=>!(k in v)||(v as Record<string,unknown>)[k]===undefined||validOffset((v as Record<string,unknown>)[k]));
export function inputAt(ms:number,offset=offsetAt(ms)){return new Date(ms+offset*60000).toISOString().slice(0,16);}
export const dateAt=(ms:number,offset=offsetAt(ms))=>inputAt(ms,offset).slice(0,10);
export const clockAt=(ms:number,offset=offsetAt(ms))=>inputAt(ms,offset).slice(11);
export const offsetLabel=(offset:number)=>`UTC${offset<0?'−':'+'}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`;
function civilTime(text:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text))throw Error('Укажи дату и время полностью.');
 const ms=Date.parse(text+'Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,16)!==text)throw Error('Такой даты или времени нет. Проверь ввод.');return ms;
}
export function timeCandidates(text:string){
 let civil:number;try{civil=civilTime(text);}catch{return [];}
 const offsets=new Set<number>();for(let h=-36;h<=36;h+=6)offsets.add(offsetAt(civil+h*3600000));
 return [...offsets].map(offset=>({offset,ms:civil-offset*60000})).filter(x=>inputAt(x.ms)===text).sort((a,b)=>a.ms-b.ms);
}
export function parseTimeInput(text:string,offset?:number){
 const civil=civilTime(text);
 if(offset!==undefined){if(!validOffset(offset))throw Error('Неверный часовой пояс.');return civil-offset*60000;}
 const candidates=timeCandidates(text);
 if(!candidates.length)throw Error('Этого местного времени нет из-за перевода часов. Укажи время после перехода.');
 if(candidates.length>1)throw Error('Этот час повторяется дважды. Выбери смещение UTC под временем.');
 return candidates[0].ms;
}
/** Pure calendar days are independent of DST and the current device zone. */
export function shiftCalendarDate(date:string,days:number){const d=new Date(date+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==date)throw Error('Неверная дата.');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function historyOffsets(n:{date:string;bedClock:string;wakeClock:string;bed:number;wake:number;bedOffset?:number;wakeOffset?:number}):TimeOffsets{
 const wake=n.wakeOffset??(Date.parse(`${n.date}T${n.wakeClock}:00Z`)-Math.floor(n.wake/60000)*60000)/60000;
 const candidates=[-1,0,1].map(shift=>(Date.parse(`${shiftCalendarDate(n.date,shift)}T${n.bedClock}:00Z`)-Math.floor(n.bed/60000)*60000)/60000).filter(validOffset).sort((a,b)=>Math.abs(a-wake)-Math.abs(b-wake));
 return {bed:n.bedOffset??candidates[0]??wake,wake};
}
export function timeReview(active:{started:number;wokeAt?:number;timeReview?:boolean},now=Date.now()){
 if((active.wokeAt??now)<active.started)return active.wokeAt===undefined?'Часы переведены назад. После подъёма нужно уточнить даты сна.':'Часы переведены назад. Подъём сохранён; уточни обе даты и длительность сна.';
 if((active.wokeAt??now)-active.started>MAX_NIGHT_MS)return 'Запись оставалась открытой больше 24 часов. Укажи время реального сна.'+(active.timeReview?' Время на устройстве также изменилось.':'');
 if(active.timeReview)return 'Время на устройстве изменилось. Уточни обе даты и длительность сна.';
 return '';
}

/** Stable endpoint context; never format historical instants in today's zone. */
export function historyTimeContext(n:Parameters<typeof historyOffsets>[0]){
 const offsets=historyOffsets(n);
 return {bed:`${inputAt(n.bed,offsets.bed).replace('T',' ')} · ${offsetLabel(offsets.bed!)}`,wake:`${inputAt(n.wake,offsets.wake).replace('T',' ')} · ${offsetLabel(offsets.wake!)}`,inferred:n.bedOffset===undefined||n.wakeOffset===undefined};
}
