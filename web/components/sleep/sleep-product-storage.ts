/** Product writer for local/offline edits. The native Storage adapter and the
 * caller's writer lock remain authoritative; this module never makes requests.
 */
import {SLEEP_KEY,parseSleep,persistSleep,type SleepState} from './sleep-state';
import {openSleepSyncArchive,sleepDiaryForExport} from '../../lib/sleep-sync-archive';
import {persistSleepSyncEdit} from '../../lib/sleep-sync-edit';
import {sameSleepDiaryContent} from '../../lib/sleep-sync-reconcile';

type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
const META='_sleepSync';
function plain(value:SleepState):SleepState{return parseSleep(sleepDiaryForExport(JSON.stringify(value)))!;}
function binding(raw:string|null,key:string){
  if(raw===null||key!==SLEEP_KEY)return null;
  const root=JSON.parse(raw);if(!Object.hasOwn(root,META))return null;
  const m=root[META];
  if(!m||typeof m.ownerId!=='string')throw Error('Связь дневника с аккаунтом повреждена. Исходное сохранение не изменено.');
  // Resume IDs only permit reading/preserving an existing pause, never sending.
  const tx=openSleepSyncArchive({getItem:()=>raw,setItem:()=>{throw Error('Read only');}},m.ownerId,m.importPause?.id,m.legacyMigration?.operationId);
  const result={ownerId:tx.queue.ownerId,importId:tx.importPause?.id,legacyId:tx.legacyMigration?.operationId,reviewed:tx.baseline!==null};tx.abort();return result;
}
export function readSleepProductState(raw:string|null,key=SLEEP_KEY):SleepState|null{
  const state=parseSleep(raw);if(!state)return null;binding(raw,key);return plain(state);
}
export function persistSleepProductState(storage:Storage,key:string,before:SleepState,next:SleepState,createId=()=>crypto.randomUUID()):SleepState{
  const raw=storage.getItem(key),bound=binding(raw,key),previous=plain(before),updated=plain(next);
  if(!bound)return persistSleep(storage,key,previous,updated);
  if(bound.reviewed&&!bound.importId&&!bound.legacyId)return persistSleepSyncEdit(storage,bound.ownerId,previous,updated,createId);
  // A lost import/migration response must not block capture of tonight's wake.
  // Keep the old intent/payloads byte-for-byte; resume will review the new diary
  // and every preview opened before this write fails its authoritative raw CAS.
  const tx=openSleepSyncArchive(storage,bound.ownerId,bound.importId,bound.legacyId);
  try{
    if(!sameSleepDiaryContent(previous,tx.diary))throw Error('Записи изменились в другом окне. Обнови приложение перед сохранением.');
    if(tx.diary.credits.some(date=>!updated.credits.includes(date))||tx.diary.garden&&!updated.garden)throw Error('Заработанный прогресс нельзя удалить обычным сохранением.');
    persistSleep(tx.storage,SLEEP_KEY,tx.diary,updated);return tx.commit(bound.ownerId);
  }catch(error){tx.abort();throw error;}
}
/** Until the linked import review is mounted, never let the local restore path
 * silently drop a durable queue/account binding, even when metadata is damaged.
 * Unreadable local diaries retain the established backup/recovery path.
 */
export function assertSleepLocalRestoreAllowed(raw:string|null){
  if(raw===null)return;let root:unknown;try{root=JSON.parse(raw);}catch{return;}
  if(root&&typeof root==='object'&&Object.hasOwn(root,META))throw Error('Этот дневник связан с аккаунтом. Для восстановления нужно сравнение с сервером; локальная замена остановлена, записи и очередь сохранены.');
}
export function restoreSleepProductState(storage:Storage,key:string,expectedRaw:string|null,next:SleepState):SleepState{
  const raw=storage.getItem(key);if(raw!==expectedRaw)throw Error('Сохранение изменилось после выбора файла. Выбери файл ещё раз.');
  if(key===SLEEP_KEY)assertSleepLocalRestoreAllowed(raw);
  const saved=plain(next);storage.setItem(key,JSON.stringify(saved));return saved;
}