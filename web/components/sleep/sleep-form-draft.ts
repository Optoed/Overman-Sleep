import { validCalendarDate } from './sleep-calendar';
import { validMorningDraft, type MorningFields } from './sleep-morning-draft';
import { validOffsets, type TimeOffsets } from './sleep-time';
export type FormDraft={mode:'manual'|'edit';date:string;base:string|null;fields:MorningFields;offsets:TimeOffsets};
export type FormDraftBook={version:1;revision:number;entries:FormDraft[]};
export const formDraftKey=(key:string)=>`${key}.form-drafts`;
export const formDraftId=(d:Pick<FormDraft,'mode'|'date'>)=>`${d.mode}:${d.date}`;
export const emptyFormDrafts=():FormDraftBook=>({version:1,revision:0,entries:[]});
export function validFormDraft(v:unknown):v is FormDraft{
 const d=v as FormDraft;return !!d&&['manual','edit'].includes(d.mode)&&validCalendarDate(d.date)&&((d.mode==='manual'&&d.base===null)||(d.mode==='edit'&&typeof d.base==='string'&&d.base.length<=12000))&&validOffsets(d.offsets)&&validMorningDraft({version:1,started:0,wokeAt:0,sequence:0,fields:d.fields});
}
/** Private local data only. Parsing errors never include any source text. */
export function readFormDrafts(storage:Pick<Storage,'getItem'>|null,key:string):FormDraftBook{
 try{const raw=storage?.getItem(formDraftKey(key));if(!raw)return emptyFormDrafts();if(raw.length>1000000)throw Error();const b=JSON.parse(raw) as FormDraftBook;
 if(b.version!==1||!Number.isSafeInteger(b.revision)||b.revision<0||!Array.isArray(b.entries)||b.entries.length>50||!b.entries.every(validFormDraft)||new Set(b.entries.map(formDraftId)).size!==b.entries.length)throw Error();return b;
 }catch{throw Error('Не удалось прочитать личные черновики. Исходное сохранение не изменено.');}
}
export function putFormDraft(book:FormDraftBook,draft:FormDraft):FormDraftBook{
 if(!validFormDraft(draft))throw Error('Проверь длину полей черновика.');const id=formDraftId(draft),others=book.entries.filter(d=>formDraftId(d)!==id);
 if(others.length>=50)throw Error('Сохранено 50 черновиков. Сначала закончи одну из прежних записей.');return{version:1,revision:book.revision+1,entries:[...others,structuredClone(draft)]};
}
export function removeFormDrafts(book:FormDraftBook,matches:(d:FormDraft)=>boolean):FormDraftBook{return{version:1,revision:book.revision+1,entries:book.entries.filter(d=>!matches(d))};}
export function writeFormDrafts(storage:Pick<Storage,'setItem'>|null,key:string,book:FormDraftBook){
 if(!storage)throw Error('Хранилище личных черновиков недоступно.');const raw=JSON.stringify(book);readFormDrafts({getItem:()=>raw},key);try{storage.setItem(formDraftKey(key),raw);}catch{throw Error('Не удалось подтвердить запись личного черновика.');}
}
