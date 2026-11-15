import { validOffset } from './sleep-time';
import { captureWake, sessionId, validSessionId, validSchedule, type SleepState, type Schedule } from './sleep-state';

export type WakeReceipt={version:1;id?:string;bedOffset?:number;wakeOffset?:number;timeReview?:boolean;started:number;target:Schedule;wokeAt:number};
export const wakeStorageError=(detail:string)=>`Не удалось обновить дневник. ${detail} Время подъёма сохранено отдельно. Освободи место и нажми «Повторить сохранение».`;
export function validWakeReceipt(value:unknown):value is WakeReceipt {
  const r=value as WakeReceipt;
  return !!r&&r.version===1&&(r.bedOffset===undefined||validOffset(r.bedOffset))&&(r.wakeOffset===undefined||validOffset(r.wakeOffset))&&(r.timeReview===undefined||typeof r.timeReview==='boolean')&&(r.id===undefined||validSessionId(r.id))&&Number.isFinite(r.started)&&r.started>=0&&Number.isFinite(r.wokeAt)&&r.wokeAt>=0&&(r.wokeAt>=r.started||r.timeReview===true)&&r.wokeAt<=8640000000000000&&validSchedule(r.target);
}
/** A receipt can restore a missing archive, but cannot resurrect a completed or different night. */
export function recoverWake(state:SleepState,receipt:WakeReceipt,archiveExists:boolean,now=Date.now()):SleepState{
  if(!validWakeReceipt(receipt))throw Error('Резервная запись подъёма повреждена.');
  if(archiveExists&&(!state.active||(sessionId(state.active)!==sessionId(receipt)||state.active.started!==receipt.started)))return state;
  if(state.active?.wokeAt!==undefined)return state;
  const base=state.active?{...state,active:{...state.active,bedOffset:state.active.bedOffset??receipt.bedOffset,wakeOffset:state.active.wakeOffset??receipt.wakeOffset,timeReview:!!(state.active.timeReview||receipt.timeReview)}}:{...state,schedule:{...receipt.target},configured:true,active:{bedOffset:receipt.bedOffset,wakeOffset:receipt.wakeOffset,timeReview:!!receipt.timeReview,...(receipt.id?{id:receipt.id}:{}),started:receipt.started,target:{...receipt.target}}};
  return captureWake(base,receipt.wokeAt,receipt.started,receipt.timeReview?Math.max(now,receipt.wokeAt):now);
}

/** Separate from localStorage: a full diary quota must not erase a confirmed wake. */
async function journal<T>(key:string,operation:'read'|'write'|'delete',receipt?:WakeReceipt):Promise<T>{
  return new Promise((resolve,reject)=>{
    let db:IDBDatabase|undefined,settled=false;
    const finish=(error?:unknown,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();error?reject(error):resolve(value as T);};
    const timer=setTimeout(()=>finish(Error('Резервное хранилище не ответило.')),3000);
    let opening:IDBOpenDBRequest;
    try{opening=indexedDB.open('overman-sleep-recovery-v1',1);}catch(e){finish(e);return;}
    opening.onupgradeneeded=()=>opening.result.createObjectStore('wakes');
    opening.onerror=()=>finish(opening.error??Error('Резервное хранилище недоступно.'));
    opening.onblocked=()=>finish(Error('Закрой другие вкладки для доступа к резервной записи.'));
    opening.onsuccess=()=>{
      db=opening.result;if(settled){db.close();return;}
      try{
        const tx=db.transaction('wakes',operation==='read'?'readonly':'readwrite'),store=tx.objectStore('wakes');let result:unknown;
        tx.oncomplete=()=>finish(undefined,result as T);tx.onabort=()=>finish(tx.error??Error('Резервная запись не сохранена.'));tx.onerror=()=>{};
        const request=store.get(key);
        request.onsuccess=()=>{
          const old=request.result;
          if(operation==='read'){result=old??null;return;}
          if(operation==='delete'){store.delete(key);return;}
          // Retrying a failed diary write must retain the first confirmed timestamp.
          result=validWakeReceipt(old)&&sessionId(old)===sessionId(receipt!)?old:receipt;
          store.put(result,key);
        };
      }catch(e){finish(e);}
    };
  });
}
export async function readWakeReceipt(key:string){const r=await journal<unknown>(key,'read');if(r===null)return null;if(!validWakeReceipt(r))throw Error('Резервная запись подъёма повреждена.');return r;}
export async function writeWakeReceipt(key:string,receipt:WakeReceipt){if(!validWakeReceipt(receipt))throw Error('Неверное время подъёма.');return journal<WakeReceipt>(key,'write',receipt);}
export const clearWakeReceipt=(key:string)=>journal<void>(key,'delete');
