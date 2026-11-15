import { SLEEP_KEY } from './sleep-state';

export type ArchiveBridge={readSleepArchive:(key:string)=>string;writeSleepArchive:(key:string,expected:string|null,raw:string)=>string};
/** The native file is authoritative; localStorage is a compatibility mirror. */
export function createSleepStorage(mirror:Storage,bridge?:ArchiveBridge):Storage{
 const baselines=new Map<string,string|null>(),nativeBases=new Map<string,string|null>();
 const managed=(key:string)=>key===SLEEP_KEY||key===`${SLEEP_KEY}.before-import`||key===`${SLEEP_KEY}.form-drafts`;
 function read(key:string){
  if(!bridge||!managed(key))return mirror.getItem(key);
  const reply=JSON.parse(bridge.readSleepArchive(key)) as {raw:string|null;error?:string};
  if(reply.error)throw Error(reply.error);
  if(reply.raw!==null&&typeof reply.raw!=='string')throw Error('Не удалось прочитать дневник Android.');
  if(!nativeBases.has(key))nativeBases.set(key,reply.raw);
  return reply.raw??mirror.getItem(key);
 }
 return{
  get length(){return mirror.length;},key:index=>mirror.key(index),
  getItem(key){const raw=read(key);if(managed(key)&&!baselines.has(key))baselines.set(key,raw);return raw;},
  setItem(key,raw){
   if(!managed(key)){mirror.setItem(key,raw);return;}
   const existing=read(key);if(!baselines.has(key))baselines.set(key,existing);
   if(existing!==baselines.get(key))throw Error('Записи изменились в другой вкладке. Обнови страницу перед сохранением.');
   if(bridge){const error=bridge.writeSleepArchive(key,nativeBases.get(key)??null,raw);if(error)throw Error(error);nativeBases.set(key,raw);baselines.set(key,raw);try{mirror.setItem(key,raw);}catch{/* Native commit already completed; quota in the mirror cannot lose it. */}}
   else{mirror.setItem(key,raw);baselines.set(key,raw);}
  },
  removeItem(key){if(managed(key))throw Error('Удаление дневника этим действием запрещено.');mirror.removeItem(key);},
  clear(){throw Error('Очистка дневника этим действием запрещена.');},
 };
}

/** One writer per browser origin. Other tabs can inspect/export until refreshed. */
export async function acquireSleepWriter(locks:LockManager|undefined):Promise<(()=>void)|null>{
 if(!locks)throw Error('Браузер не поддерживает безопасную запись дневника. Открой приложение в современном браузере или Android.');
 return new Promise((resolve,reject)=>{
  void locks.request('overman-sleep-writer-v1',{mode:'exclusive',ifAvailable:true},async lock=>{
   if(!lock){resolve(null);return;}
   await new Promise<void>(release=>resolve(release));
  }).catch(reject);
 });
}
