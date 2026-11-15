import { inputAt, timeReview, validOffsets, type TimeOffsets } from './sleep-time';
import type { SleepState } from './sleep-state';
import { localInput, sessionId, validSessionId } from './sleep-state';

export type MorningFields={bed:string;wake:string;sleep:string;latency:string;awake:string;rested:number;note:string};
export type MorningDraft={version:1;id?:string;started:number;wokeAt:number;sequence:number;timeReview?:boolean;offsets?:TimeOffsets;fields:MorningFields};
export const morningDraftKey=(key:string)=>`${key}.morning-draft`;
export function validMorningDraft(value:unknown):value is MorningDraft{
  const d=value as MorningDraft;
  return !!d&&d.version===1&&(d.timeReview===undefined||typeof d.timeReview==='boolean')&&(d.offsets===undefined||validOffsets(d.offsets))&&(d.id===undefined||validSessionId(d.id))&&Number.isFinite(d.started)&&d.started>=0&&Number.isFinite(d.wokeAt)&&d.wokeAt>=0&&(d.wokeAt>=d.started||d.timeReview===true)&&d.wokeAt<=8640000000000000&&Number.isSafeInteger(d.sequence)&&d.sequence>=0&&!!d.fields&&Number.isInteger(d.fields.rested)&&d.fields.rested>=0&&d.fields.rested<=5&&
    ['bed','wake','sleep','latency','awake'].every(k=>typeof d.fields[k as keyof MorningFields]==='string'&&(d.fields[k as keyof MorningFields] as string).length<=64)&&typeof d.fields.note==='string'&&d.fields.note.length<=2000;
}
export function matchingMorningDraft(drafts:MorningDraft[],active:SleepState['active']):MorningDraft|null{
  if(!active||active.wokeAt===undefined)return null;
  return drafts.filter(d=>validMorningDraft(d)&&sessionId(d)===sessionId(active)&&d.started===active.started&&d.wokeAt===active.wokeAt).sort((a,b)=>b.sequence-a.sequence)[0]??null;
}
/** Defaults always use the captured wake and this night's goal, never the reopen time. */
export function initialMorningFields(active:NonNullable<SleepState['active']>):MorningFields{
  if(active.wokeAt===undefined)throw Error('Сначала подтверди подъём.');
  const minutes=Math.max(0,(active.wokeAt-active.started)/60000);
  return{bed:inputAt(active.started,active.bedOffset),wake:inputAt(active.wokeAt,active.wakeOffset),sleep:timeReview(active)?'':String(Math.floor(Math.min(active.target.hours*60,minutes)/60*100)/100),latency:'',awake:'',rested:0,note:''};
}
export function writeMorningDraftPrimary(storage:Pick<Storage,'setItem'>|null,key:string,draft:MorningDraft){
  if(!validMorningDraft(draft))throw Error('Не удалось сохранить черновик: проверь введённые данные.');
  if(!storage)throw Error('Основное хранилище недоступно.');
  storage.setItem(morningDraftKey(key),JSON.stringify(draft));
}
async function backup<T>(key:string,operation:'read'|'write'|'delete',draft?:MorningDraft):Promise<T>{
  return new Promise((resolve,reject)=>{
    let db:IDBDatabase|undefined,settled=false;
    const finish=(error?:unknown,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();error?reject(error):resolve(value as T);};
    const timer=setTimeout(()=>finish(Error('Хранилище черновиков не ответило.')),3000);let open:IDBOpenDBRequest;
    try{open=indexedDB.open('overman-sleep-drafts-v1',1);}catch(e){finish(e);return;}
    open.onupgradeneeded=()=>open.result.createObjectStore('drafts');
    open.onerror=()=>finish(open.error??Error('Черновики недоступны.'));open.onblocked=()=>finish(Error('Закрой другие вкладки для доступа к черновику.'));
    open.onsuccess=()=>{db=open.result;if(settled){db.close();return;}try{
      const tx=operation==='read'?db.transaction('drafts','readonly'):db.transaction('drafts','readwrite',{durability:'strict'}),store=tx.objectStore('drafts');let result:unknown;
      tx.oncomplete=()=>finish(undefined,result as T);tx.onabort=()=>finish(tx.error??Error('Черновик не сохранён.'));tx.onerror=()=>{};
      if(operation==='read'){const r=store.get(key);r.onsuccess=()=>result=r.result??null;}
      if(operation==='write')store.put(draft,key);
      if(operation==='delete')store.delete(key);
    }catch(e){finish(e);}};
  });
}
export async function readMorningDrafts(storage:Pick<Storage,'getItem'>|null,key:string):Promise<MorningDraft[]>{
  const drafts:MorningDraft[]=[];let failure:unknown;
  try{const raw=storage?.getItem(morningDraftKey(key));if(raw){const d=JSON.parse(raw);if(!validMorningDraft(d))throw Error('Черновик повреждён.');drafts.push(d);}}catch(e){failure=e;}
  try{const d=await backup<unknown>(key,'read');if(d!==null){if(!validMorningDraft(d))throw Error('Резервный черновик повреждён.');drafts.push(d);}}catch(e){failure=e;}
  if(!drafts.length&&failure)throw Error('Не удалось прочитать утренний черновик. Исходные данные не изменены.');
  return drafts;
}
export function writeMorningDraftBackup(key:string,draft:MorningDraft){
  if(!validMorningDraft(draft))throw Error('Не удалось сохранить черновик: проверь длину введённых значений.');
  return backup<void>(key,'write',draft);
}
export async function clearMorningDraft(storage:Pick<Storage,'removeItem'>|null,key:string){
  let error:unknown;try{storage?.removeItem(morningDraftKey(key));}catch(e){error=e;}
  try{await backup(key,'delete');}catch(e){error=e;}
  if(error)throw error;
}
