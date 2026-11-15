/** Explicit preservation of self-declared old rewards, never successful-night
 * fabrication. Durable operation intent precedes HTTP; approval applies one
 * reviewed archive. Product controller supplies its writer lock and state updates.
 */
import {parseSleep,type SleepState} from '../components/sleep/sleep-state';
import {openSleepSyncArchive,readSleepLegacyMigration,sleepDiaryForExport} from './sleep-sync-archive';
import {enqueueSleepOperations,sleepQueueKey,validateSleepLegacyCredits,type SleepLegacyCreditOperation} from './sleep-sync-queue';
import {reviewSleepReconciliation,sameSleepNightContent,type OwnedSleepSnapshot,type SleepReconciliation} from './sleep-sync-reconcile';
import type {SleepLegacyCreditReceipt} from './sleep-api';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
type Client={readSnapshot:()=>Promise<OwnedSleepSnapshot>;importLegacyCredits:(op:SleepLegacyCreditOperation,owner:string)=>Promise<SleepLegacyCreditReceipt>};
type Options={getOwnerId:()=>string|null;createId?:()=>string;serverOrigin?:string};
type Choices=Record<string,'local'|'server'>;
function owner(options:Options,id:string){if(options.getOwnerId()?.toLowerCase()!==id.toLowerCase())throw Error('Synchronization owner changed');}
export async function resumeSleepLegacyMigration(storage:Storage,ownerId:string,client:Client,options:Options){
 owner(options,ownerId);const operation=readSleepLegacyMigration(storage,ownerId);if(!operation)throw Error('No legacy migration to resume');
 let tx=openSleepSyncArchive(storage,ownerId,undefined,operation.operationId);
 if(options.serverOrigin){try{const missing=tx.serverOrigin===null;tx.bindServerOrigin(options.serverOrigin);if(missing){owner(options,ownerId);tx.commit(ownerId);tx=openSleepSyncArchive(storage,ownerId,undefined,operation.operationId);}}catch(error){try{tx.abort();}catch{}throw error;}}
 try{
  const receipt=await client.importLegacyCredits(operation,ownerId);owner(options,ownerId);
  const server=tx.acceptLegacyReceipt(receipt),oldIds=new Set(tx.queue.operations.map(o=>o.operationId.toLowerCase()));
  let review=reviewSleepReconciliation(tx.diary,ownerId,tx.baseline,server),closed=false;
  const live=()=>{if(closed)throw Error('Legacy migration review is closed');};
  return{
   get review():SleepReconciliation{live();return structuredClone(review);},
   choose(choices:Choices){live();review=reviewSleepReconciliation(tx.diary,ownerId,tx.baseline,server,structuredClone(choices));return structuredClone(review);},
   approve(confirmed:boolean){
    live();if(!confirmed)throw Error('Legacy migration needs explicit final approval');
    try{
     owner(options,ownerId);const queue=tx.queue,rows=new Map(server.snapshot.dates.map(d=>[d.date,d]));
     const retained=queue.operations.filter(op=>(rows.get(op.date)?.revision??0)<=op.expectedRevision),pending=new Map(retained.map(op=>[op.date,op]));
     for(const upload of review.uploads){const old=pending.get(upload.date);if(old&&(old.expectedRevision!==upload.expectedRevision||!sameSleepNightContent(old.night,upload.night)))throw Error('Resolve existing pending data before migration approval');}
     if(retained.length!==queue.operations.length){if(queue.revision>=Number.MAX_SAFE_INTEGER-1)throw Error('Synchronization queue revision exhausted');tx.storage.setItem(sleepQueueKey(ownerId),JSON.stringify({...queue,revision:queue.revision+1,operations:retained}));}
     tx.applyReview(review,true);tx.finishLegacyMigration(operation.operationId);
     const uploads=review.uploads.filter(u=>!pending.has(u.date)).map(u=>{const operationId=(options.createId??(()=>crypto.randomUUID()))();if(oldIds.has(operationId.toLowerCase())||operationId.toLowerCase()===operation.operationId.toLowerCase())throw Error('Migration or retired UUID cannot be reused');return{...u,operationId};});
     if(uploads.length)enqueueSleepOperations(tx.storage,tx.queue,uploads);
     owner(options,ownerId);const result=tx.commit(ownerId);closed=true;return result;
    }catch(error){tx.abort();closed=true;throw error;}
   },
   discard(){live();tx.abort();closed=true;}
  };
 }catch(error){tx.abort();throw error;}
}
export async function prepareSleepLegacyMigration(storage:Storage,ownerId:string,client:Client,options:Options,source?:SleepState){
 owner(options,ownerId);const tx=openSleepSyncArchive(storage,ownerId);
 try{
  if(options.serverOrigin)tx.bindServerOrigin(options.serverOrigin);
  const local=tx.diary,selected=source?parseSleep(sleepDiaryForExport(JSON.stringify(source)))!:local;
  const incoming=await client.readSnapshot();owner(options,ownerId);const server=tx.validateServerSnapshot(incoming);
  // Complete successful nights can follow normal validation/upload. This path
  // preserves earned dates whose old successful version no longer exists.
  const dates=[...new Set([...local.credits,...selected.credits])].filter(d=>!server.snapshot.credits.includes(d)&&!local.nights.some(n=>n.date===d&&n.success)&&!selected.nights.some(n=>n.date===d&&n.success)).sort();
  const garden=(local.garden||selected.garden)&&!server.snapshot.garden;
  if(!dates.length&&!garden){tx.abort();return null;}
  if(new Set([...server.snapshot.dates.map(d=>d.date),...dates]).size>2000)throw Error('Combined legacy history exceeds archive capacity; original data preserved');
  const operation=validateSleepLegacyCredits({operationId:(options.createId??(()=>crypto.randomUUID()))(),dates,garden});
  let closed=false;const live=()=>{if(closed)throw Error('Legacy migration preparation is closed');};
  return{
   get operation(){live();return structuredClone(operation);},
   async start(confirmed:boolean){live();if(!confirmed)throw Error('Legacy archive rewards need explicit approval');
    try{owner(options,ownerId);tx.beginLegacyMigration(operation);tx.commit(ownerId);closed=true;return await resumeSleepLegacyMigration(storage,ownerId,client,options);}
    catch(error){if(!closed){tx.abort();closed=true;}throw error;}
   },
   discard(){live();tx.abort();closed=true;}
  };
 }catch(error){tx.abort();throw error;}
}
/** Stop local retry only. A committed additive server claim is not undone; a
 * later pull still restores it. Pending diary operations and local rewards stay.
 */
export function stopSleepLegacyMigration(storage:Storage,ownerId:string,options:Options,confirmed:boolean){
 owner(options,ownerId);if(!confirmed)throw Error('Stopping legacy migration retry needs explicit approval');
 const operation=readSleepLegacyMigration(storage,ownerId);if(!operation)throw Error('No legacy migration to stop');
 const tx=openSleepSyncArchive(storage,ownerId,undefined,operation.operationId);
 try{tx.stopLegacyRetry(operation.operationId);owner(options,ownerId);return tx.commit(ownerId);}catch(error){tx.abort();throw error;}
}
