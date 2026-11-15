import {parseTimeInput, type TimeOffsets, MAX_NIGHT_MS} from './sleep-time';
import type {MorningFields} from './sleep-morning-draft';
export type DurationField='bed'|'wake'|'sleep'|'latency'|'awake';
export type DurationErrors=Partial<Record<DurationField,string>>;
/** Known minutes cannot exceed the interval. With both pauses known, only one minute of rounding may remain. */
export function sleepDurationIssues(input:{inBedMinutes:number;sleepMinutes:number;latencyMinutes?:number;awakeMinutes?:number}):DurationErrors{
 const {inBedMinutes:total,sleepMinutes:sleep,latencyMinutes:latency,awakeMinutes:awake}=input,errors:DurationErrors={};
 if(!Number.isFinite(total)||total<=0||total>1440)return{wake:'Проверь время в кровати: больше нуля и не более 24 часов.'};
 if(!Number.isFinite(sleep)||sleep<0||sleep>total)errors.sleep='Сон не может быть отрицательным или больше времени в кровати.';
 if(latency!==undefined&&(!Number.isFinite(latency)||latency<0||latency>total))errors.latency='Засыпание должно укладываться во время в кровати.';
 if(awake!==undefined&&(!Number.isFinite(awake)||awake<0||awake>total))errors.awake='Бодрствование должно укладываться во время в кровати.';
 if(Object.keys(errors).length)return errors;
 const sum=sleep+(latency??0)+(awake??0);
 if(sum>total+.01){const text=`Сон и указанные паузы вместе больше ${Math.round(total)} мин в кровати. Уточни длительность.`;errors.sleep=text;if(latency!==undefined)errors.latency=text;if(awake!==undefined)errors.awake=text;}
 else if(latency!==undefined&&awake!==undefined&&total-sum>1.000001)errors.sleep=`С учётом засыпания и бодрствования получается ${Math.round(total-latency-awake)} мин сна. Уточни длительность или проверь паузы.`;
 return errors;
}
export function morningDuration(fields:MorningFields,offsets:TimeOffsets={},now=Date.now(),wakeGraceMs=60000){
 const errors:DurationErrors={};let bed:number|undefined,wake:number|undefined;
 try{bed=parseTimeInput(fields.bed,offsets.bed);}catch(e){errors.bed=e instanceof Error?e.message:'Проверь время отхода ко сну.';}
 try{wake=parseTimeInput(fields.wake,offsets.wake);}catch(e){errors.wake=e instanceof Error?e.message:'Проверь время подъёма.';}
 if(bed!==undefined&&(bed<0||bed>now))errors.bed='Отход ко сну не может быть в будущем.';
 if(wake!==undefined&&(wake<0||wake>now+wakeGraceMs))errors.wake='Пробуждение не может быть в будущем.';
 if(bed!==undefined&&wake!==undefined&&(wake<=bed||wake-bed>MAX_NIGHT_MS))errors.wake='Подъём должен быть после отхода ко сну, в пределах 24 часов.';
 function number(text:string,field:'sleep'|'latency'|'awake',optional:boolean){if(text===''){if(!optional)errors[field]='Укажи, сколько примерно спал.';return undefined;}if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)||!Number.isFinite(Number(text))||Number(text)<0||Number(text)>(field==='sleep'?24:1440)){errors[field]=field==='sleep'?'Укажи число от 0 до 24 часов.':'Укажи число от 0 до 1440 минут.';return undefined;}return Number(text);}
 const hours=number(fields.sleep,'sleep',false),latencyMinutes=number(fields.latency,'latency',true),awakeMinutes=number(fields.awake,'awake',true),sleepMinutes=hours===undefined?undefined:Math.round(hours*60),inBedMinutes=bed===undefined||wake===undefined?undefined:(wake-bed)/60000;
 let calculatedMinutes:number|undefined;
 if(inBedMinutes!==undefined&&!errors.bed&&!errors.wake){
  if(sleepMinutes!==undefined&&!errors.sleep&&!errors.latency&&!errors.awake)Object.assign(errors,sleepDurationIssues({inBedMinutes,sleepMinutes,latencyMinutes,awakeMinutes}));
  if(latencyMinutes!==undefined&&awakeMinutes!==undefined&&latencyMinutes+awakeMinutes<=inBedMinutes)calculatedMinutes=Math.floor(inBedMinutes-latencyMinutes-awakeMinutes+.000001);
 }
 return{errors,bed,wake,sleepMinutes,latencyMinutes,awakeMinutes,inBedMinutes,calculatedMinutes,calculatedHours:calculatedMinutes===undefined?undefined:String(Math.floor(calculatedMinutes/60*100)/100)};
}
