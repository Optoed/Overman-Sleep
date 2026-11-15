/** Ordinary edits for an already reviewed account binding. Not an import API.
 * Diary delta and newly pending operations share one authoritative file commit.
 * Existing pending payloads remain immutable; newer local edits await ACK review.
 */
import {SLEEP_KEY,parseSleep,persistSleep,type SleepState} from '../components/sleep/sleep-state';
import {openSleepSyncArchive,sleepDiaryForExport} from './sleep-sync-archive';
import {enqueueSleepOperations,type SleepOperation} from './sleep-sync-queue';
import {sameSleepDiaryContent,sameSleepNightContent,sleepNightForSync} from './sleep-sync-reconcile';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
function plain(value:SleepState){const diary=parseSleep(sleepDiaryForExport(JSON.stringify(value)));if(!diary)throw Error('Existing diary required');return diary;}
export function persistSleepSyncEdit(storage:Storage,ownerId:string,before:SleepState,next:SleepState,createId=()=>crypto.randomUUID()):SleepState{
  const tx=openSleepSyncArchive(storage,ownerId);
  try{
    if(!tx.baseline)throw Error('Review the first account link before saving synchronized edits');
    const current=tx.diary,previous=plain(before),updated=plain(next);
    if(!sameSleepDiaryContent(previous,current))throw Error('Diary changed before this edit; reload it');
    if(current.credits.some(date=>!updated.credits.includes(date))||current.garden&&!updated.garden)
      throw Error('Archive replacement requires a separate synchronization review; earned progress preserved');
    persistSleep(tx.storage,SLEEP_KEY,current,updated);
    const oldRows=new Map(current.nights.map(n=>[n.date,n])),newRows=new Map(tx.diary.nights.map(n=>[n.date,n]));
    const revisions=new Map(tx.baseline.snapshot.dates.map(d=>[d.date,d.revision])),pending=new Set(tx.queue.operations.map(op=>op.date));
    const operations:SleepOperation[]=[];
    for(const date of new Set([...oldRows.keys(),...newRows.keys()])){
      const old=oldRows.get(date)??null,night=newRows.get(date)??null;
      if(sameSleepNightContent(old,night)||pending.has(date))continue;
      operations.push({operationId:createId(),date,expectedRevision:revisions.get(date)??0,night:sleepNightForSync(night)});
    }
    if(operations.length)enqueueSleepOperations(tx.storage,tx.queue,operations);
    return tx.commit(ownerId);
  }catch(error){tx.abort();throw error;}
}