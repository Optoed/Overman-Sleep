/** 05.02: explicit review around HTTP and the single authoritative archive.
 * Preparation does not write. Approval writes diary, queue and baseline once.
 * SleepApp must still supply its native storage adapter and writer lock.
 */
import {openSleepSyncArchive} from './sleep-sync-archive';
import {enqueueSleepOperations,sendFirstSleepOperation,sleepQueueKey,type SleepSnapshot} from './sleep-sync-queue';
import {reviewSleepReconciliation,sameSleepNightContent,type OwnedSleepSnapshot,type SleepReconciliation} from './sleep-sync-reconcile';

type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
type Client={readSnapshot:()=>Promise<OwnedSleepSnapshot>;rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
type Transaction=ReturnType<typeof openSleepSyncArchive>;
type Choices=Record<string,'local'|'server'>;
function preview(tx:Transaction,ownerId:string,incoming:OwnedSleepSnapshot,kind:'pull'|'upload_receipt',createId:()=>string){
  let closed=false;
  const live=()=>{if(closed)throw Error('Synchronization review is closed');};
  const server=structuredClone(incoming);
  let review=reviewSleepReconciliation(tx.diary,ownerId,tx.baseline,server);
  return{
    kind,
    get review():SleepReconciliation{live();return structuredClone(review);},
    choose(choices:Choices){live();review=reviewSleepReconciliation(tx.diary,ownerId,tx.baseline,server,structuredClone(choices));return structuredClone(review);},
    approve(confirmed:boolean,currentOwnerId:string){
      live();if(!confirmed)throw Error('Synchronization needs explicit approval');
      try{
        if(currentOwnerId.toLowerCase()!==ownerId.toLowerCase())throw Error('Synchronization owner changed');
        // A higher server revision makes this old expected revision incapable
        // of a fresh write. Retiring it is safe only inside this explicit review;
        // SQL replays of an already committed UUID only return current state.
        const queue=tx.queue,rows=new Map(review.server.snapshot.dates.map(row=>[row.date,row]));
        const retained=queue.operations.filter(op=>(rows.get(op.date)?.revision??0)<=op.expectedRevision);
        const pendingByDate=new Map(retained.map(op=>[op.date,op]));
        for(const upload of review.uploads){const pending=pendingByDate.get(upload.date);
          if(pending&&(pending.expectedRevision!==upload.expectedRevision||!sameSleepNightContent(pending.night,upload.night)))
            throw Error('This date still has a different pending operation; preserve it and finish its review first');
        }
        if(retained.length!==queue.operations.length){
          if(queue.revision>=Number.MAX_SAFE_INTEGER-1)throw Error('Synchronization queue revision exhausted');
          tx.storage.setItem(sleepQueueKey(ownerId),JSON.stringify({...queue,revision:queue.revision+1,operations:retained}));
        }
        tx.applyReview(review,true);
        const uploads=review.uploads.filter(upload=>!pendingByDate.has(upload.date));
        if(uploads.length)enqueueSleepOperations(tx.storage,tx.queue,uploads.map(upload=>({...upload,operationId:createId()})));
        const saved=tx.commit(currentOwnerId);closed=true;return saved;
      }catch(error){tx.abort();closed=true;throw error;}
    },
    discard(){live();tx.abort();closed=true;}
  };
}
export async function prepareSleepSyncPull(storage:Storage,ownerId:string,client:Client,createId=()=>crypto.randomUUID(),serverOrigin?:string){
  const tx=openSleepSyncArchive(storage,ownerId);
  try{if(serverOrigin)tx.bindServerOrigin(serverOrigin);return preview(tx,ownerId,await client.readSnapshot(),'pull',createId);}catch(error){tx.abort();throw error;}
}
export async function prepareSleepSyncUpload(storage:Storage,ownerId:string,client:Client,createId=()=>crypto.randomUUID(),serverOrigin?:string){
  const tx=openSleepSyncArchive(storage,ownerId);
  try{
    if(serverOrigin)tx.bindServerOrigin(serverOrigin);
    const receipt=await sendFirstSleepOperation(tx.storage,tx.queue,client);
    if(!receipt){tx.abort();return null;}
    return preview(tx,ownerId,{ownerId,snapshot:receipt.snapshot as SleepSnapshot},'upload_receipt',createId);
  }catch(error){tx.abort();throw error;}
}