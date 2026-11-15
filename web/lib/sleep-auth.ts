/** Own-account transport for diary sync05.02. Tokens/passwords never persisted.
 * Account access does not link, read, send or replace a diary by itself.
 */
import {sleepApiOrigin,readSleepApiJson,validateSleepApiSession,type SleepApiSession} from './sleep-api';
export type SleepAccountProfile={userId:string;username:string;expiresAt:number};
type AuthCode='configuration'|'invalid_input'|'invalid_credentials'|'name_unavailable'|'limited'|'unavailable'|'cancelled'|'invalid_response';
const messages:Record<AuthCode,string>={configuration:'Проверь адрес сервера.',invalid_input:'Логин: 3–32 латинские буквы, цифры или _. Пароль: 15–128 символов.',invalid_credentials:'Неверный логин или пароль.',name_unavailable:'Этот логин недоступен.',limited:'Слишком много попыток. Попробуй позже.',unavailable:'Не удалось подключиться. Данные на устройстве сохранены.',cancelled:'Вход отменён.',invalid_response:'Не удалось подтвердить ответ сервера. Данные на устройстве сохранены.'};
export class SleepAuthError extends Error{constructor(public readonly code:AuthCode,public readonly status?:number){super(messages[code]);this.name='SleepAuthError';}}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function createSleepAccount(options:{baseUrl:string;allowLoopbackHttp?:boolean;fetch?:typeof globalThis.fetch;timeoutMs?:number;now?:()=>number}){
 let origin:string;try{origin=sleepApiOrigin(options.baseUrl,options.allowLoopbackHttp===true);}catch{throw new SleepAuthError('configuration');}
 const timeout=options.timeoutMs??15000,now=options.now??Date.now,fetcher=options.fetch??globalThis.fetch.bind(globalThis);
 if(!Number.isInteger(timeout)||timeout<1||timeout>60000)throw new SleepAuthError('configuration');
 let current:(SleepAccountProfile&{session:SleepApiSession})|null=null,generation=0,pending:AbortController|null=null;
 async function request(path:string,body:unknown,bearer:string|undefined,controller:AbortController){
  const response=await fetcher(origin+path,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},
   body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',mode:'cors',signal:controller.signal});
  if(!response.ok){await response.body?.cancel();throw new SleepAuthError(response.status===401?'invalid_credentials':response.status===409?'name_unavailable':response.status===429?'limited':'unavailable',response.status);}
  try{return await readSleepApiJson(response,2048);}catch{throw new SleepAuthError('invalid_response');}
 }
 async function revoke(token:string){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{
  const raw=await request('/v1/auth/logout',{},token,controller);if(!object(raw)||Object.keys(raw).length!==1||raw.signedOut!==true)throw new SleepAuthError('invalid_response');
 }catch(error){throw error instanceof SleepAuthError?error:new SleepAuthError('unavailable');}finally{clearTimeout(timer);controller.abort();}}
 async function signIn(kind:'register'|'login',login:string,password:string,signal?:AbortSignal):Promise<SleepAccountProfile>{
  const username=typeof login==='string'?login.trim().toLowerCase():'';
  if(!/^[a-z0-9_]{3,32}$/.test(username)||typeof password!=='string'||Array.from(password).length<15||Array.from(password).length>128||new TextEncoder().encode(password).length>512)throw new SleepAuthError('invalid_input');
  const version=++generation;pending?.abort();const controller=new AbortController();pending=controller;const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   if(signal?.aborted)throw new SleepAuthError('cancelled');
   const raw=await request('/v1/auth/'+kind,{login:username,password},undefined,controller);
   if(!object(raw)||Object.keys(raw).length!==5||Object.keys(raw).some(k=>!['protocolVersion','userId','username','token','expiresAt'].includes(k))||raw.protocolVersion!==1||raw.username!==username||!Number.isSafeInteger(raw.expiresAt)||Number(raw.expiresAt)<=now()||Number(raw.expiresAt)>now()+35*86400000)throw new SleepAuthError('invalid_response');
   let session:SleepApiSession;try{session=validateSleepApiSession({ownerId:raw.userId as string,token:raw.token as string});}catch{throw new SleepAuthError('invalid_response');}
   if(version!==generation||controller.signal.aborted){await revoke(session.token).catch(()=>{});throw new SleepAuthError('cancelled');}
   const profile={userId:session.ownerId,username,expiresAt:Number(raw.expiresAt)};current={...profile,session};return{...profile};
  }catch(error){if(version!==generation||controller.signal.aborted)throw new SleepAuthError('cancelled');throw error instanceof SleepAuthError?error:new SleepAuthError('unavailable');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();if(pending===controller)pending=null;}
 }
 return{
  register:(login:string,password:string,signal?:AbortSignal)=>signIn('register',login,password,signal),
  login:(login:string,password:string,signal?:AbortSignal)=>signIn('login',login,password,signal),
  getSession:():SleepApiSession|null=>current&&current.expiresAt>now()?{...current.session}:null,
  getProfile:():SleepAccountProfile|null=>current&&current.expiresAt>now()?{userId:current.userId,username:current.username,expiresAt:current.expiresAt}:null,
  async logout(){++generation;pending?.abort();pending=null;const old=current;current=null;if(old)await revoke(old.session.token);}
 };
}