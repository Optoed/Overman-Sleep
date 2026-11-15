/** 05.02 dependency: explicit three-way review, not automatic cloud replacement. */
import {parseSleep,persistSleep,type Night,type SleepState} from '../components/sleep/sleep-state';
import {historyOffsets} from '../components/sleep/sleep-time';
import {parseSleepSnapshot,sleepQueueKey,type SleepSnapshot} from './sleep-sync-queue';

export type OwnedSleepSnapshot={ownerId:string;snapshot:SleepSnapshot};
export type SleepConflict={date:string;local:Night|null;server:Night|null;canKeepLocal:boolean;reason:'concurrent_change'|'original_target'};
export type SleepReconciliation={ownerId:string;localFingerprint:string;nextFingerprint:string;next:SleepState;
  conflicts:SleepConflict[];unverifiedCredits:string[];uploads:{date:string;expectedRevision:number;night:Night|null}[];server:OwnedSleepSnapshot};
type Choices=Record<string,'local'|'server'>;
function stable(v:unknown):string{
  if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',')+'}';
  return JSON.stringify(v);
}
function normalize(n:Night|null):Night|null{
  if(!n)return null;const offsets=historyOffsets(n);
  return {...structuredClone(n),bedOffset:offsets.bed,wakeOffset:offsets.wake,rewardRule:'v1'};
}
const equal=(a:unknown,b:unknown)=>stable(a)===stable(b);
/** The same canonical comparison used by three-way review, including captured offsets. */
export const sameSleepNightContent=(a:Night|null,b:Night|null)=>equal(normalize(a),normalize(b));
export const sleepNightForSync=(night:Night|null):Night|null=>normalize(night);
export const sameSleepDiaryContent=(a:SleepState,b:SleepState)=>equal(a,b);
function bound(v:OwnedSleepSnapshot,owner:string):OwnedSleepSnapshot{
  sleepQueueKey(v.ownerId);
  if(v.ownerId.toLowerCase()!==owner.toLowerCase())throw Error('Synchronization owner changed');
  return {ownerId:owner.toLowerCase(),snapshot:parseSleepSnapshot(v.snapshot)};
}

/** Validate history without merging it with the local archive (which may have
 * unsent dates of its own and need a separate capacity/conflict review).
 */
export function validateSleepSnapshotProgress(ownerId:string,baseline:OwnedSleepSnapshot|null,incoming:OwnedSleepSnapshot):OwnedSleepSnapshot{
  sleepQueueKey(ownerId);
  const server=bound(incoming,ownerId),base=baseline?bound(baseline,ownerId):null;
  if(base){
    const rows=new Map(server.snapshot.dates.map(d=>[d.date,d]));
    if(base.snapshot.legacyGarden&&!server.snapshot.legacyGarden||(base.snapshot.legacyCredits??[]).some(d=>!server.snapshot.legacyCredits?.includes(d)))throw Error('Server legacy provenance moved backwards');
    if(base.snapshot.garden&&!server.snapshot.garden||base.snapshot.credits.some(d=>!server.snapshot.credits.includes(d)))
      throw Error('Server reward history moved backwards');
    for(const b of base.snapshot.dates){const r=rows.get(b.date);
      if(!r||r.revision<b.revision||r.revision===b.revision&&(!equal(normalize(r.night),normalize(b.night))
        ||server.snapshot.credits.includes(b.date)!==base.snapshot.credits.includes(b.date)))throw Error('Server date revision moved backwards');
    }
  }
  return server;
}

/** No input mutation, storage write, upload or local settings replacement.
 * Missing baseline means first linking, not consent to overwrite either side.
 * Upload proposals have no UUID: they must be queued only after this review.
 */
export function reviewSleepReconciliation(local:SleepState,ownerId:string,baseline:OwnedSleepSnapshot|null,
  incoming:OwnedSleepSnapshot,choices:Choices={}):SleepReconciliation{
  sleepQueueKey(ownerId);parseSleep(JSON.stringify(local));
  const server=validateSleepSnapshotProgress(ownerId,baseline,incoming),base=baseline?bound(baseline,ownerId):null;
  const remoteRows=new Map(server.snapshot.dates.map(d=>[d.date,d]));
  const baseRows=new Map(base?.snapshot.dates.map(d=>[d.date,d])??[]);
  const localRows=new Map(local.nights.map(n=>[n.date,normalize(n)]));
  const dates=[...new Set([...localRows.keys(),...baseRows.keys(),...remoteRows.keys()])].sort();
  const merged=new Map<string,Night>(),conflicts:SleepConflict[]=[],uploads:SleepReconciliation['uploads']=[];
  const reviewedDates=new Set<string>();
  for(const day of dates){
    const l=localRows.get(day)??null,b=baseRows.get(day),r=remoteRows.get(day),bn=normalize(b?.night??null),rn=normalize(r?.night??null);
    const localChanged=!equal(l,bn);
    const serverChanged=!equal(rn,bn)||!b&&!!r;
    const originalTarget=!!l&&!!rn&&(!equal(l.target,rn.target)||!equal(l.healthScore??null,rn.healthScore??null)||!equal(l.healthOrigin??null,rn.healthOrigin??null)||!equal(l.healthInterval??null,rn.healthInterval??null));
    let chosen=l;
    if(equal(l,rn))chosen=l;
    else if(!localChanged)chosen=rn;
    else if(serverChanged||originalTarget){
      const conflict:SleepConflict={date:day,local:structuredClone(l),server:structuredClone(rn),canKeepLocal:!originalTarget,
        reason:originalTarget?'original_target':'concurrent_change'};
      const choice=choices[day];reviewedDates.add(day);
      if(choice==='server')chosen=rn;
      else if(choice==='local'&&conflict.canKeepLocal)chosen=l;
      else if(choice==='local')throw Error('This night keeps its original server target and health score; preserve a local copy before choosing the server');
      else conflicts.push(conflict);
    }
    if(chosen)merged.set(day,structuredClone(chosen));
    if(!equal(chosen,rn)&&!conflicts.some(c=>c.date===day))uploads.push({date:day,expectedRevision:r?.revision??0,night:structuredClone(chosen)});
  }
  if(Object.keys(choices).some(d=>!reviewedDates.has(d)))throw Error('Conflict review is stale; reload the comparison');
  const credits=[...new Set([...local.credits,...server.snapshot.credits])].sort();
  const nights=[...merged.values()];
  const next={...structuredClone(local),nights,credits,deletedCredits:credits.filter(d=>!merged.has(d)),garden:local.garden||server.snapshot.garden};
  // An old date-only credit cannot be reconstructed as a newly successful
  // night. Preserve it in the preview and stop, rather than inventing evidence.
  const unverifiedCredits=local.credits.filter(d=>!server.snapshot.credits.includes(d)&&!merged.get(d)?.success);
  // Parse validates combined archive limits and every retained credit/date.
  parseSleep(JSON.stringify(next));
  return {ownerId:ownerId.toLowerCase(),localFingerprint:stable(local),nextFingerprint:stable(next),next,conflicts,unverifiedCredits,uploads,server};
}

/** Explicit reviewed write through the existing authoritative storage adapter.
 * Baseline/queue persistence is deliberately not claimed atomic with this write;
 * the future coordinator must commit them in a single native envelope.
 */
export function applyReviewedSleepReconciliation(storage:Pick<Storage,'getItem'|'setItem'>,key:string,
  current:SleepState,review:SleepReconciliation,confirmed:boolean,activeOwnerId:string):SleepState{
  sleepQueueKey(activeOwnerId);
  if(activeOwnerId.toLowerCase()!==review.ownerId)throw Error('Synchronization owner changed');
  if(!confirmed||review.conflicts.length)throw Error('Review every conflict before applying synchronization');
  if(review.unverifiedCredits.length)throw Error('Historical credits need an explicit migration; earned progress preserved locally');
  if(stable(current)!==review.localFingerprint||stable(review.next)!==review.nextFingerprint)throw Error('Diary changed after review');
  const raw=storage.getItem(key),stored=raw===null?null:parseSleep(raw);
  if(!stored||stable(stored)!==review.localFingerprint)throw Error('Stored diary changed after review');
  return persistSleep(storage,key,current,review.next);
}
