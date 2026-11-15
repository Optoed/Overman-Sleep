/** 05.02 durable queue used by the product offline writer. Own HTTP adapter is verified separately; product network UI is still pending. */
import { freshSleep, parseSleep, type Night } from '../components/sleep/sleep-state';

export type SleepOperation={operationId:string;date:string;expectedRevision:number;night:Night|null};
export type SleepLegacyCreditOperation={operationId:string;dates:string[];garden:boolean};
export type SleepQueue={version:1;ownerId:string;revision:number;operations:SleepOperation[]};
export type SleepSnapshot={protocolVersion:1;garden:boolean;credits:string[];deletedCredits:string[];
  dates:{date:string;revision:number;night:Night|null}[];legacyCredits?:string[];legacyGarden?:boolean};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
type RpcClient={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const revision=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<Number.MAX_SAFE_INTEGER;
export const sleepQueueKey=(ownerId:string)=>{
  if(!uuid(ownerId))throw Error('Invalid synchronization owner');
  return `overman.sleep-sync.v1.${ownerId.toLowerCase()}`;
};

function validNight(n:unknown,day:string):n is Night{
  if(!object(n)||n.date!==day||!Number.isInteger(n.bedOffset)||!Number.isInteger(n.wakeOffset))return false;
  if(Object.keys(n).some(k=>!['date','bed','wake','bedOffset','wakeOffset','bedClock','wakeClock','sleepMinutes','rested',
    'healthInterval','healthOrigin','healthScore','target','success','scoreModel','rewardRule','source','sessionId','latencyMinutes','awakeMinutes','noiseDbfs','note'].includes(k)))return false;
  try{const s=freshSleep();s.nights=[n as Night];s.credits=n.success?[day]:[];parseSleep(JSON.stringify(s));return true;}catch{return false;}
}
function operation(v:unknown):v is SleepOperation{
  return object(v)&&uuid(v.operationId)&&date(v.date)&&revision(v.expectedRevision)
    &&(v.night===null||validNight(v.night,v.date))
    &&Object.keys(v).every(k=>['operationId','date','expectedRevision','night'].includes(k));
}
export function validateSleepOperation(value:unknown):SleepOperation{
  if(!operation(value))throw Error('Invalid synchronization operation');
  return structuredClone(value);
}
export function validateSleepLegacyCredits(value:unknown):SleepLegacyCreditOperation{
 if(!object(value)||!uuid(value.operationId)||Object.keys(value).length!==3||Object.keys(value).some(k=>!['operationId','dates','garden'].includes(k))||
  typeof value.garden!=='boolean'||!Array.isArray(value.dates)||value.dates.length>2000||!value.dates.every(date)||new Set(value.dates).size!==value.dates.length||(!value.dates.length&&!value.garden))throw Error('Invalid legacy credit import');
 return{operationId:value.operationId,dates:[...value.dates].sort(),garden:value.garden};
}
export function readSleepQueue(storage:Storage,ownerId:string):SleepQueue{
  const raw=storage.getItem(sleepQueueKey(ownerId));
  if(raw===null)return{version:1,ownerId:ownerId.toLowerCase(),revision:0,operations:[]};
  try{
    if(raw.length>3000000)throw Error();const q=JSON.parse(raw);
    if(!object(q)||q.version!==1||q.ownerId!==ownerId.toLowerCase()||!revision(q.revision)
      ||Object.keys(q).some(k=>!['version','ownerId','revision','operations'].includes(k))
      ||!Array.isArray(q.operations)||q.operations.length>2000||!q.operations.every(operation)
      ||new Set(q.operations.map(o=>o.operationId.toLowerCase())).size!==q.operations.length
      ||new Set(q.operations.map(o=>o.date)).size!==q.operations.length)throw Error();
    return q as SleepQueue;
  }catch{throw Error('Synchronization queue is damaged; original data preserved');}
}
function commit(storage:Storage,before:SleepQueue,operations:SleepOperation[]):SleepQueue{
  const current=readSleepQueue(storage,before.ownerId);
  if(current.revision!==before.revision||JSON.stringify(current)!==JSON.stringify(before))throw Error('Synchronization queue changed; reload it');
  if(before.revision>=Number.MAX_SAFE_INTEGER-1)throw Error('Synchronization queue revision exhausted');
  const next={...before,revision:before.revision+1,operations:structuredClone(operations)};
  storage.setItem(sleepQueueKey(before.ownerId),JSON.stringify(next));return next;
}
export function enqueueSleepOperations(storage:Storage,before:SleepQueue,values:SleepOperation[]):SleepQueue{
  const operations=values.map(validateSleepOperation);
  if(before.operations.length+operations.length>2000)throw Error('Synchronization queue is full');
  const ids=new Set(before.operations.map(o=>o.operationId.toLowerCase())),dates=new Set(before.operations.map(o=>o.date));
  for(const next of operations){
    if(ids.has(next.operationId.toLowerCase())||dates.has(next.date))throw Error('This date already has a pending operation');
    ids.add(next.operationId.toLowerCase());dates.add(next.date);
  }
  return commit(storage,before,[...before.operations,...operations]);
}
export function enqueueSleepOperation(storage:Storage,before:SleepQueue,next:SleepOperation):SleepQueue{
  return enqueueSleepOperations(storage,before,[next]);
}
export function parseSleepSnapshot(raw:unknown):SleepSnapshot{
  if(!object(raw)||raw.protocolVersion!==1||typeof raw.garden!=='boolean'
    ||Object.keys(raw).some(k=>!['protocolVersion','garden','credits','deletedCredits','dates','legacyCredits','legacyGarden'].includes(k))
    ||!Array.isArray(raw.credits)||!Array.isArray(raw.deletedCredits)||!Array.isArray(raw.dates)
    ||raw.dates.length>2000||!raw.dates.every(d=>object(d)&&Object.keys(d).every(k=>['date','revision','night'].includes(k))&&date(d.date)&&revision(d.revision)&&d.revision>0
      &&(d.night===null||validNight(d.night,d.date)))
    ||new Set(raw.dates.map(d=>d.date)).size!==raw.dates.length)throw Error('Invalid server diary snapshot');
  if(Object.hasOwn(raw,'legacyCredits')||Object.hasOwn(raw,'legacyGarden')){
    if(!Array.isArray(raw.legacyCredits)||typeof raw.legacyGarden!=='boolean'||!raw.legacyCredits.every(date)||new Set(raw.legacyCredits).size!==raw.legacyCredits.length||
      raw.legacyCredits.some(d=>!(raw.credits as unknown[]).includes(d))||raw.legacyGarden&&!raw.garden)throw Error('Invalid legacy reward provenance');
  }
  const s=freshSleep();s.garden=raw.garden;s.nights=raw.dates.flatMap(d=>d.night?[d.night]:[]);
  s.credits=raw.credits as string[];s.deletedCredits=raw.deletedCredits as string[];
  try{parseSleep(JSON.stringify(s));}catch{throw Error('Invalid server reward snapshot');}
  return structuredClone(raw) as SleepSnapshot;
}

/** One operation per call. Errors/conflicts leave the durable queue untouched.
 * Returns an authoritative snapshot for explicit reconciliation, never XP deltas.
 * Caller must serialize calls and provide its currently authenticated diary
 * client; no service key or automatic revision rebasing. The expected-owner
 * guard is checked against the validated session server-side; it cannot select an account.
 */
export async function sendFirstSleepOperation(storage:Storage,before:SleepQueue,client:RpcClient):Promise<{queue:SleepQueue;snapshot:SleepSnapshot}|null>{
  const current=readSleepQueue(storage,before.ownerId);
  if(JSON.stringify(current)!==JSON.stringify(before))throw Error('Synchronization queue changed; reload it');
  const op=before.operations[0];if(!op)return null;
  const {data,error}=await client.rpc('save_sleep_diary_operation',{
    p_operation:op.operationId,p_date:op.date,p_expected:op.expectedRevision,p_night:structuredClone(op.night),p_expected_owner:before.ownerId
  });
  if(error)throw Error('Synchronization was not confirmed; pending operation preserved',{cause:error});
  const snapshot=parseSleepSnapshot(data);
  // Do not accept an unrelated/old response as acknowledgement of this request.
  const ack=snapshot.dates.find(d=>d.date===op.date);
  if(!ack||ack.revision<=op.expectedRevision)throw Error('Server did not acknowledge this date revision');
  const queue=commit(storage,before,before.operations.slice(1));
  return{queue,snapshot};
}
