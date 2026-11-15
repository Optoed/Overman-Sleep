/** 05.02 preparation: stage existing diary/queue helpers, then write one archive.
 * The product offline writer uses this module. Network review UI is still pending. Native atomicity comes from the supplied
 * createSleepStorage adapter; this is not a replacement for its writer lock.
 */
import {archiveScoreVersion} from '../components/sleep/sleep-score-version';
import {sleepApiOrigin} from './sleep-api';
import {SLEEP_KEY,parseSleep,type SleepState} from '../components/sleep/sleep-state';
import {readSleepQueue,sleepQueueKey,validateSleepLegacyCredits,type SleepLegacyCreditOperation,type SleepQueue,type SleepOperation} from './sleep-sync-queue';
import {applyReviewedSleepReconciliation,validateSleepSnapshotProgress,type OwnedSleepSnapshot,type SleepReconciliation} from './sleep-sync-reconcile';

type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
export type SleepImportPause={id:string;sourceSha256:string};
type SyncMetadata={version:1;ownerId:string;queue:SleepQueue;baseline:OwnedSleepSnapshot|null;serverOrigin?:string;importPause?:SleepImportPause;legacyMigration?:SleepLegacyCreditOperation};
function checkedPause(v:unknown):SleepImportPause{
  const p=v as SleepImportPause;sleepQueueKey(p?.id);
  if(!p||Object.keys(p).length!==2||!Object.hasOwn(p,'sourceSha256')||typeof p.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(p.sourceSha256))throw Error('Import pause is damaged');
  return structuredClone(p);
}
export function readSleepImportPause(storage:Storage,ownerId:string):SleepImportPause|null{
  const raw=storage.getItem(SLEEP_KEY);if(raw===null)return null;diaryFrom(raw);
  const root=JSON.parse(raw),m=root[META];if(!m?.importPause)return null;
  const pause=checkedPause(m.importPause),tx=openSleepSyncArchive(storage,ownerId,pause.id);tx.abort();return pause;
}
export function readSleepLegacyMigration(storage:Storage,ownerId:string):SleepLegacyCreditOperation|null{
 const raw=storage.getItem(SLEEP_KEY);if(raw===null)return null;diaryFrom(raw);const m=JSON.parse(raw)[META];if(!m?.legacyMigration)return null;
 const op=validateSleepLegacyCredits(m.legacyMigration),tx=openSleepSyncArchive(storage,ownerId,undefined,op.operationId);tx.abort();return op;
}
const META='_sleepSync';
function diaryFrom(raw:string):SleepState{
  const parsed=parseSleep(raw);if(!parsed)throw Error('Existing diary required');
  const copy={...parsed} as SleepState&Record<string,unknown>;delete copy[META];
  return copy;
}
function checkedQueue(raw:string,owner:string):SleepQueue{
  return readSleepQueue({getItem:()=>raw,setItem:()=>{throw Error('Read only');}},owner);
}
function checkedBaseline(value:OwnedSleepSnapshot|null,owner:string,previous:OwnedSleepSnapshot|null=null){
  if(value===null){if(previous)throw Error('Confirmed server baseline cannot be cleared');return null;}
  // Reuse owner, structural and monotonic history checks. Do not apply preview.
  return validateSleepSnapshotProgress(owner,previous,value);
}

/** Export only the diary: account binding, pending operations and baseline must
 * not travel with a backup into another account/device. No input/file mutation.
 */
export function sleepDiaryForExport(raw:string):string{return JSON.stringify(diaryFrom(raw));}

export function openSleepSyncArchive(storage:Storage,activeOwnerId:string,resumeImportId?:string,resumeLegacyId?:string){
  const queueKey=sleepQueueKey(activeOwnerId),owner=activeOwnerId.toLowerCase();
  const original=storage.getItem(SLEEP_KEY);
  if(original===null)throw Error('Existing diary required');
  const originalDiary=diaryFrom(original),root=JSON.parse(original);
  let diaryRaw=JSON.stringify(originalDiary),queueRaw:string,baseline:OwnedSleepSnapshot|null=null,serverOrigin:string|undefined,importPause:SleepImportPause|undefined,legacyMigration:SleepLegacyCreditOperation|undefined;
  if(Object.hasOwn(root,META)){
    const m=root[META] as SyncMetadata;
    if(!m||m.version!==1||m.ownerId!==owner||Object.keys(m).some(k=>!['version','ownerId','queue','baseline','serverOrigin','importPause','legacyMigration'].includes(k)))
      throw Error('Synchronization metadata damaged or owner changed; original archive preserved');
    queueRaw=JSON.stringify(checkedQueue(JSON.stringify(m.queue),owner));
    baseline=checkedBaseline(m.baseline,owner);
    if(Object.hasOwn(m,'serverOrigin')){serverOrigin=sleepApiOrigin(m.serverOrigin!,true);if(serverOrigin!==m.serverOrigin)throw Error('Stored server origin is not canonical');}
    if(Object.hasOwn(m,'importPause'))importPause=checkedPause(m.importPause);
    if(Object.hasOwn(m,'legacyMigration'))legacyMigration=validateSleepLegacyCredits(m.legacyMigration);
    if(importPause&&legacyMigration)throw Error('Archive has conflicting migration pauses');
  }else queueRaw=JSON.stringify(readSleepQueue({getItem:()=>null,setItem:()=>{}},owner));
  if(importPause&&resumeImportId!==importPause.id)throw Error('Import is paused; resume or recover it before outgoing synchronization');
  if(resumeImportId&&!importPause)throw Error('Import pause changed; reload the archive');
  if(legacyMigration&&resumeLegacyId!==legacyMigration.operationId)throw Error('Legacy migration is paused; resume it before outgoing synchronization');
  if(resumeLegacyId&&!legacyMigration)throw Error('Legacy migration changed; reopen the archive');
  let closed=false,dirty=false,removedOperations:SleepOperation[]=[],cancelledIds=new Set<string>();
  let acknowledgedSnapshot:OwnedSleepSnapshot|null=null;
  const live=()=>{if(closed)throw Error('Synchronization transaction is closed');};
  // No writes reach the real adapter until commit. Existing helpers can operate
  // without a second queue file or a window between archive/queue persistence.
  const staged:Storage={
    getItem(key){live();if(key===SLEEP_KEY)return diaryRaw;if(key===queueKey)return queueRaw;throw Error('Unsupported synchronization storage key');},
    setItem(key,raw){live();
      if(key===SLEEP_KEY){diaryRaw=JSON.stringify(diaryFrom(raw));dirty=true;return;}
      if(key===queueKey){
        const before=checkedQueue(queueRaw,owner),next=checkedQueue(raw,owner);
        if(next.revision<=before.revision)throw Error('Queue revision must advance');
        const removed:SleepOperation[]=[];
        for(const old of before.operations){const retained=next.operations.find(o=>o.operationId===old.operationId);
          if(retained&&JSON.stringify(retained)!==JSON.stringify(old))throw Error('Pending operation content cannot change');
          if(!retained)removed.push(structuredClone(old));
        }
        queueRaw=JSON.stringify(next);removedOperations.push(...removed);dirty=true;return;
      }
      throw Error('Unsupported synchronization storage key');
    }
  };
  return {
    storage:staged,
    get serverOrigin(){live();return serverOrigin??null;},
    bindServerOrigin(value:string){live();const origin=sleepApiOrigin(value,true);if(serverOrigin&&serverOrigin!==origin)throw Error('Diary server changed; original archive preserved');if(!serverOrigin){serverOrigin=origin;dirty=true;}},
    get importPause(){live();return importPause?structuredClone(importPause):null;},
    validateServerSnapshot(value:OwnedSleepSnapshot){live();return validateSleepSnapshotProgress(owner,acknowledgedSnapshot??baseline,value);},
    pauseImport(value:SleepImportPause){live();if(importPause||legacyMigration)throw Error('Another migration is already paused');importPause=checkedPause(value);dirty=true;},
    get legacyMigration(){live();return legacyMigration?structuredClone(legacyMigration):null;},
    beginLegacyMigration(value:SleepLegacyCreditOperation){live();if(importPause||legacyMigration)throw Error('Another migration is already paused');const operation=validateSleepLegacyCredits(value);if(checkedQueue(queueRaw,owner).operations.some(o=>o.operationId.toLowerCase()===operation.operationId.toLowerCase()))throw Error('Pending diary UUID cannot be reused for legacy migration');legacyMigration=operation;dirty=true;},
    acceptLegacyReceipt(receipt:{protocolVersion:number;ownerId:string;operationId:string;snapshot:unknown}){
      live();if(!legacyMigration||!receipt||Object.keys(receipt).length!==4||Object.keys(receipt).some(k=>!['protocolVersion','ownerId','operationId','snapshot'].includes(k))||receipt.protocolVersion!==1||receipt.ownerId?.toLowerCase()!==owner||receipt.operationId?.toLowerCase()!==legacyMigration.operationId.toLowerCase())throw Error('Invalid legacy migration receipt');
      const next=validateSleepSnapshotProgress(owner,acknowledgedSnapshot??baseline,{ownerId:owner,snapshot:receipt.snapshot as OwnedSleepSnapshot['snapshot']});
      if(legacyMigration.dates.some(d=>!next.snapshot.credits.includes(d))||legacyMigration.garden&&!next.snapshot.garden)throw Error('Legacy migration not acknowledged');
      acknowledgedSnapshot=next;return structuredClone(next);
    },
    stopLegacyRetry(id:string){live();if(legacyMigration?.operationId!==id||dirty||removedOperations.length||acknowledgedSnapshot)throw Error('Reopen unchanged legacy migration before stopping retry');legacyMigration=undefined;dirty=true;},
    finishLegacyMigration(id:string){live();if(legacyMigration?.operationId!==id||!acknowledgedSnapshot||removedOperations.length||!baseline||legacyMigration.dates.some(d=>!baseline!.snapshot.credits.includes(d))||legacyMigration.garden&&!baseline.snapshot.garden)throw Error('Apply the legacy migration receipt review first');legacyMigration=undefined;dirty=true;},
    retireCancelled(receipt:{protocolVersion:number;ownerId:string;operationId:string;cancelled:boolean;snapshot:unknown}){
      live();if(!importPause)throw Error('Pause the import before cancelling pending operations');
      if(!receipt||Object.keys(receipt).length!==5||Object.keys(receipt).some(k=>!['protocolVersion','ownerId','operationId','cancelled','snapshot'].includes(k))||receipt.protocolVersion!==1||receipt.ownerId?.toLowerCase()!==owner||typeof receipt.cancelled!=='boolean')throw Error('Invalid cancellation receipt');
      const queue=checkedQueue(queueRaw,owner),op=queue.operations.find(o=>o.operationId.toLowerCase()===receipt.operationId?.toLowerCase());
      if(!op)throw Error('Cancellation UUID does not match pending data');
      const next=validateSleepSnapshotProgress(owner,acknowledgedSnapshot??baseline,{ownerId:owner,snapshot:receipt.snapshot as OwnedSleepSnapshot['snapshot']});
      if(!receipt.cancelled&&!next.snapshot.dates.some(d=>d.date===op.date&&d.revision>op.expectedRevision))throw Error('Cancellation does not confirm the applied operation');
      if(queue.revision>=Number.MAX_SAFE_INTEGER-1)throw Error('Synchronization queue revision exhausted');
      staged.setItem(queueKey,JSON.stringify({...queue,revision:queue.revision+1,operations:queue.operations.filter(o=>o.operationId!==op.operationId)}));
      if(receipt.cancelled)cancelledIds.add(op.operationId);acknowledgedSnapshot=next;
    },
    finishImport(id:string){live();if(importPause?.id!==id||removedOperations.length||checkedQueue(queueRaw,owner).operations.length)throw Error('Apply the import review before releasing its pause');importPause=undefined;dirty=true;},
    get diary(){live();return diaryFrom(diaryRaw);},
    get queue(){live();return checkedQueue(queueRaw,owner);},
    get baseline(){live();return structuredClone(baseline);},
    applyReview(review:SleepReconciliation,confirmed:boolean){
      live();
      // Validate against this transaction's baseline before changing staged data.
      const nextBase=checkedBaseline(review.server,owner,acknowledgedSnapshot??baseline);
      if(removedOperations.some(op=>!cancelledIds.has(op.operationId)&&!nextBase?.snapshot.dates.some(d=>d.date===op.date&&d.revision>op.expectedRevision)))
        throw Error('Server snapshot does not confirm every removed operation');
      const saved=applyReviewedSleepReconciliation(staged,SLEEP_KEY,diaryFrom(diaryRaw),review,confirmed,owner);
      baseline=nextBase;removedOperations=[];dirty=true;return saved;
    },
    commit(currentOwnerId:string):SleepState{
      live();sleepQueueKey(currentOwnerId);
      if(currentOwnerId.toLowerCase()!==owner)throw Error('Synchronization owner changed');
      if(storage.getItem(SLEEP_KEY)!==original)throw Error('Authoritative archive changed; reopen synchronization');
      if(removedOperations.length)throw Error('Apply the reviewed server receipt before committing queue removal');
      if(!dirty){closed=true;return diaryFrom(diaryRaw);}
      if(originalDiary.revision>=Number.MAX_SAFE_INTEGER-1)throw Error('Diary revision exhausted');
      const diary=diaryFrom(diaryRaw),queue=checkedQueue(queueRaw,owner);
      const metadata:SyncMetadata={version:1,ownerId:owner,queue,baseline:checkedBaseline(baseline,owner),...(serverOrigin?{serverOrigin}:{}),...(importPause?{importPause}:{}),...(legacyMigration?{legacyMigration}:{})};
      // One authoritative file commit means one diary revision, even when
      // several helpers staged changes in memory during this transaction.
      const saved={...diary,scoreVersion:archiveScoreVersion(diary),revision:originalDiary.revision+1,[META]:metadata};
      const raw=JSON.stringify(saved);parseSleep(raw); // Includes the 3 MB archive limit.
      storage.setItem(SLEEP_KEY,raw);closed=true;
      return diaryFrom(raw);
    },
    abort(){live();closed=true;}
  };
}

/** Read binding/status only; never return queued night payloads or credentials. */
export function inspectSleepSyncArchive(storage:Storage){
 const raw=storage.getItem(SLEEP_KEY);if(raw===null)return null;diaryFrom(raw);const m=JSON.parse(raw)[META];if(m===undefined)return null;
 if(!m||typeof m.ownerId!=='string')throw Error('Synchronization metadata damaged; original archive preserved');
 const tx=openSleepSyncArchive(storage,m.ownerId,m.importPause?.id,m.legacyMigration?.operationId);
 const status={ownerId:tx.queue.ownerId,serverOrigin:tx.serverOrigin,reviewed:tx.baseline!==null,pending:tx.queue.operations.length,importPaused:tx.importPause!==null,legacyPaused:tx.legacyMigration!==null};tx.abort();return status;
}