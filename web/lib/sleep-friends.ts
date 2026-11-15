import {sleepApiOrigin,readSleepApiJson,validateSleepApiSession,type SleepApiSession} from './sleep-api';
export type FriendAction='list'|'profile'|'request'|'accept'|'remove'|'share'|'invite-sleep'|'join-sleep'|'decline-sleep';
export type Friend={id:string;direction:'incoming'|'outgoing';status:'pending'|'accepted';name:string;sharing:{sleep:boolean;progress:boolean};sleep:null|{date:string;bed:number;wake:number;bedClock:string;wakeClock:string;bedOffset:number|null;wakeOffset:number|null};progress:null|{successfulNights:number;floors:number;garden:boolean}};
export type SleepCircle={id:string;invitationId:string;host:string;isHost:boolean;wakeDate:string;expiresAt:number;reply:'invited'|'joined'|'declined';joined:number;members:number;streak:number};
export type FriendsState={ownerId:string;profile:{name:string;code:string};friends:Friend[];circles?:SleepCircle[]};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\u0000-\u001f\u007f]/.test(v);
const clock=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export class FriendsError extends Error{}
export function parseFriendsState(v:unknown,owner:string):FriendsState{
 if(!obj(v)||v.ownerId!==owner||!obj(v.profile)||!name(v.profile.name)||!uuid(v.profile.code)||!Array.isArray(v.friends)||v.friends.length>100)throw new FriendsError('Ответ сервера друзей не подтверждён.');
 const ids=new Set<string>();for(const f of v.friends){
  if(!obj(f)||!uuid(f.id)||ids.has(f.id)||!['incoming','outgoing'].includes(String(f.direction))||!['pending','accepted'].includes(String(f.status))||!name(f.name)||!obj(f.sharing)||typeof f.sharing.sleep!=='boolean'||typeof f.sharing.progress!=='boolean')throw new FriendsError('Ответ сервера друзей не подтверждён.');ids.add(f.id);
  if(f.status==='pending'&&(f.sleep!==null||f.progress!==null))throw new FriendsError('Сервер передал данные без принятой дружбы.');
  if(f.sleep!==null){const s=f.sleep;if(!obj(s)||typeof s.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||typeof s.bed!=='number'||!Number.isFinite(s.bed)||typeof s.wake!=='number'||!Number.isFinite(s.wake)||s.wake<s.bed||!clock(s.bedClock)||!clock(s.wakeClock))throw new FriendsError('Запись друга не подтверждена.');}
  if(f.progress!==null){const p=f.progress;if(!obj(p)||!Number.isSafeInteger(p.successfulNights)||Number(p.successfulNights)<0||!Number.isInteger(p.floors)||Number(p.floors)<0||Number(p.floors)>100||typeof p.garden!=='boolean')throw new FriendsError('Прогресс друга не подтверждён.');}
 }
 if(v.circles!==undefined){if(!Array.isArray(v.circles)||v.circles.length>40)throw new FriendsError('Приглашения не подтверждены.');const circles=new Set<string>();for(const c of v.circles){if(!obj(c)||!uuid(c.id)||circles.has(c.id)||!uuid(c.invitationId)||!name(c.host)||typeof c.isHost!=='boolean'||typeof c.wakeDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.wakeDate)||!Number.isFinite(c.expiresAt)||!['invited','joined','declined'].includes(String(c.reply))||!Number.isSafeInteger(c.joined)||!Number.isSafeInteger(c.members)||Number(c.members)<2||Number(c.members)>20||Number(c.joined)<0||Number(c.joined)>Number(c.members)||!Number.isSafeInteger(c.streak)||Number(c.streak)<0)throw new FriendsError('Приглашения не подтверждены.');circles.add(c.id);}}
 return structuredClone(v) as unknown as FriendsState;
}
export function createSleepFriends(options:{baseUrl:string;getSession:()=>SleepApiSession|null;allowLoopbackHttp?:boolean;fetch?:typeof globalThis.fetch}){
 const origin=sleepApiOrigin(options.baseUrl,options.allowLoopbackHttp===true),fetcher=options.fetch??globalThis.fetch.bind(globalThis);
 return async(action:FriendAction='list',payload:Record<string,unknown>={}):Promise<FriendsState>=>{
  let session:SleepApiSession;try{session=validateSleepApiSession(options.getSession());}catch{throw new FriendsError('Войди в аккаунт, чтобы открыть друзей.');}
  const unchanged=()=>{const now=options.getSession();if(!now||now.ownerId!==session.ownerId||now.token!==session.token)throw new FriendsError('Аккаунт изменился. Открой друзей заново.');};
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
  try{
   const response=await fetcher(origin+'/v1/friends',{method:action==='list'?'GET':'POST',headers:{Accept:'application/json',Authorization:'Bearer '+session.token,...(action==='list'?{}:{'Content-Type':'application/json'})},...(action==='list'?{}:{body:JSON.stringify({action,payload,expectedOwnerId:session.ownerId})}),signal:abort.signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',mode:'cors'});
   unchanged();if(!response.ok){await response.body?.cancel();throw new FriendsError(response.status===401?'Сессия закончилась. Войди снова.':response.status===422?'Проверь код друга или обнови список: запрос уже мог измениться.':'Не удалось связаться с сервером друзей.');}
   const value=await readSleepApiJson(response,262144);unchanged();return parseFriendsState(value,session.ownerId);
  }catch(error){unchanged();if(error instanceof FriendsError)throw error;throw new FriendsError('Не удалось загрузить друзей. Попробуй ещё раз.');}finally{clearTimeout(timer);}
 };
}
