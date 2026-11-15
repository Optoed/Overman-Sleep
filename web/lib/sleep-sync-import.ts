/** Confirmed import dependency. A durable fence stops ordinary sends before any
 * cancellation; a second approval commits the reviewed diary/queue/baseline.
 * Product controller holds its writer lock and checks native alarms at approval.
 */
import {SLEEP_KEY,defaultAlarm,parseSleep,type SleepState} from '../components/sleep/sleep-state';
import {openSleepSyncArchive,readSleepImportPause,sleepDiaryForExport} from './sleep-sync-archive';
import {enqueueSleepOperations,type SleepOperation} from './sleep-sync-queue';
import {reviewSleepReconciliation,validateSleepSnapshotProgress,type OwnedSleepSnapshot,type SleepReconciliation} from './sleep-sync-reconcile';
import type {SleepCancellationReceipt} from './sleep-api';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
type Client={readSnapshot:()=>Promise<OwnedSleepSnapshot>;cancelOperation:(op:SleepOperation,ownerId:string)=>Promise<SleepCancellationReceipt>};
type Options={getOwnerId:()=>string|null;backupOriginal:(raw:string)=>void|Promise<void>;createId?:()=>string;serverOrigin?:string};
type Choices=Record<string,'local'|'server'>;
function plain(value:SleepState):SleepState{const next=parseSleep(sleepDiaryForExport(JSON.stringify(value)));if(!next)throw Error('Import diary required');return next;}
function candidate(original:SleepState,source:SleepState,server:OwnedSleepSnapshot):SleepState{
  const credits=[...new Set([...original.credits,...source.credits,...server.snapshot.credits])].sort();
  const next={...structuredClone(source),revision:original.revision,active:null,
    alarm:{...(source.alarm??defaultAlarm),enabled:false,reminder:false},
    credits,deletedCredits:credits.filter(d=>!source.nights.some(n=>n.date===d)),garden:original.garden||source.garden||server.snapshot.garden};
  parseSleep(JSON.stringify(next));return next;
}
function assertOwner(options:Options,owner:string){if(options.getOwnerId()?.toLowerCase()!==owner.toLowerCase())throw Error('Synchronization owner changed');}
async function sourceHash(source:SleepState){
  const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
  const bytes=new TextEncoder().encode(JSON.stringify(stable(source)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
function requireInactive(state:SleepState){if(state.active)throw Error('Finish the active night before importing');}
function plan(current:SleepState,source:SleepState,owner:string,server:OwnedSleepSnapshot,choices:Choices={}){
  // The reviewed import is an explicit replacement proposal. Missing server
  // dates propose deletion; original server targets still require a choice.
  return reviewSleepReconciliation(candidate(current,source,server),owner,server,server,choices);
}
async function resume(storage:Storage,ownerId:string,source:SleepState,client:Client,options:Options,recovery=false){
  assertOwner(options,ownerId);const pause=readSleepImportPause(storage,ownerId);if(!pause)throw Error('No paused import to resume');
  const expectedRaw=storage.getItem(SLEEP_KEY);const imported=plain(source),digest=await sourceHash(imported);assertOwner(options,ownerId);
  if(!recovery&&digest!==pause.sourceSha256)throw Error('Select the same import file, or explicitly recover the original diary');
  if(storage.getItem(SLEEP_KEY)!==expectedRaw)throw Error('Archive changed while resuming import');
  let tx=openSleepSyncArchive(storage,ownerId,pause.id);
  if(options.serverOrigin){try{const missing=tx.serverOrigin===null;tx.bindServerOrigin(options.serverOrigin);if(missing){assertOwner(options,ownerId);tx.commit(ownerId);tx=openSleepSyncArchive(storage,ownerId,pause.id);}}catch(error){try{tx.abort();}catch{}throw error;}}
  const original=tx.diary,oldIds=new Set(tx.queue.operations.map(o=>o.operationId.toLowerCase()));
  requireInactive(original);
  try{
    for(const op of tx.queue.operations){assertOwner(options,ownerId);const receipt=await client.cancelOperation(op,ownerId);assertOwner(options,ownerId);tx.retireCancelled(receipt);}
    assertOwner(options,ownerId);const incoming=await client.readSnapshot();assertOwner(options,ownerId);
    const server=tx.validateServerSnapshot(incoming);
    let review=plan(original,imported,ownerId,server),closed=false;
    const live=()=>{if(closed)throw Error('Import review is closed');};
    return{
      kind:recovery?'recover_original' as const:'import' as const,
      get review():SleepReconciliation{live();return structuredClone(review);},
      choose(choices:Choices){live();review=plan(original,imported,ownerId,server,structuredClone(choices));return structuredClone(review);},
      approve(confirmed:boolean){
        live();if(!confirmed)throw Error('Import needs explicit final approval');
        try{
          assertOwner(options,ownerId);
          tx.storage.setItem(SLEEP_KEY,JSON.stringify(candidate(original,imported,server)));
          tx.applyReview(review,true);tx.finishImport(pause.id);
          const operations=review.uploads.map(upload=>{
            const operationId=(options.createId??(()=>crypto.randomUUID()))();
            if(oldIds.has(operationId.toLowerCase()))throw Error('Cancelled or applied UUID cannot be reused');
            return{...upload,operationId};
          });
          if(operations.length)enqueueSleepOperations(tx.storage,tx.queue,operations);
          assertOwner(options,ownerId);const result=tx.commit(ownerId);closed=true;return result;
        }catch(error){tx.abort();closed=true;throw error;}
      },
      // Server cancellation is durable. Discarding a preview keeps the pause;
      // recovery must review and requeue the original desired content explicitly.
      discard(){live();tx.abort();closed=true;}
    };
  }catch(error){tx.abort();throw error;}
}
export async function prepareSleepSyncImport(storage:Storage,ownerId:string,value:SleepState,client:Client,options:Options){
  assertOwner(options,ownerId);const tx=openSleepSyncArchive(storage,ownerId),original=tx.diary,source=plain(value),originalRaw=storage.getItem(SLEEP_KEY)!;
  try{
    if(options.serverOrigin)tx.bindServerOrigin(options.serverOrigin);
    if(!tx.baseline)throw Error('Review the first account link before importing synchronized data');requireInactive(original);
    const digest=await sourceHash(source);assertOwner(options,ownerId);
    const server=validateSleepSnapshotProgress(ownerId,tx.baseline,await client.readSnapshot());assertOwner(options,ownerId);
    const review=plan(original,source,ownerId,server),pending=tx.queue.operations;let closed=false;
    const live=()=>{if(closed)throw Error('Import preparation is closed');};
    return{
      get review(){live();return structuredClone(review);},
      get pending(){live();return structuredClone(pending);},
      async start(confirmed:boolean){
        live();if(!confirmed)throw Error('Pause and cancellation need explicit approval');
        if(review.unverifiedCredits.length)throw Error('Historical credits need an explicit migration before import');
        try{
          assertOwner(options,ownerId);if(storage.getItem(SLEEP_KEY)!==originalRaw)throw Error('Archive changed before import');
          await options.backupOriginal(originalRaw);assertOwner(options,ownerId);
          if(storage.getItem(SLEEP_KEY)!==originalRaw)throw Error('Archive changed during backup');
          tx.pauseImport({id:(options.createId??(()=>crypto.randomUUID()))(),sourceSha256:digest});tx.commit(ownerId);closed=true;
          return await resume(storage,ownerId,source,client,options);
        }catch(error){if(!closed){tx.abort();closed=true;}throw error;}
      },
      discard(){live();tx.abort();closed=true;}
    };
  }catch(error){tx.abort();throw error;}
}
export function resumeSleepSyncImport(storage:Storage,ownerId:string,source:SleepState,client:Client,options:Options){return resume(storage,ownerId,source,client,options);}
export function recoverPausedSleepImport(storage:Storage,ownerId:string,client:Client,options:Options){
  const pause=readSleepImportPause(storage,ownerId);if(!pause)throw Error('No paused import to recover');
  const tx=openSleepSyncArchive(storage,ownerId,pause.id),source=tx.diary;tx.abort();return resume(storage,ownerId,source,client,options,true);
}