/** A unique page namespace isolates duplicate and late replies after reload. */
export function createNativeRequests(send:(method:string,body:string,id:string)=>void,timeoutMs=15000,prefix=crypto.randomUUID()){
 const pending=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let sequence=0;
 function reply(id:string,value:unknown,error?:string){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);error?p.reject(Error(error)):p.resolve(value);}
 function call<T>(method:string,body:unknown={}):Promise<T>{return new Promise((resolve,reject)=>{
  const id=`${prefix}:${++sequence}`,timer=setTimeout(()=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.reject(Error('Android не ответил. Состояние ночи не сброшено. Повтори действие.'));},timeoutMs);
  pending.set(id,{resolve:v=>resolve(v as T),reject,timer});
  try{send(method,JSON.stringify(body),id);}catch(e){pending.delete(id);clearTimeout(timer);reject(e);}
 });}
 return {call,reply,get pendingCount(){return pending.size;}};
}
