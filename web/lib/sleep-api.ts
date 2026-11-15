/** Own Go/PostgreSQL diary transport. No credential persistence or automatic retries.
 * Prepared for 05.02; SleepApp integration is separate.
 */
import {parseSleepSnapshot,validateSleepOperation,validateSleepLegacyCredits,type SleepOperation,type SleepSnapshot,type SleepLegacyCreditOperation} from './sleep-sync-queue';
import type {OwnedSleepSnapshot} from './sleep-sync-reconcile';

export type SleepApiSession={ownerId:string;token:string};
export type SleepCancellationReceipt={protocolVersion:1;ownerId:string;operationId:string;cancelled:boolean;snapshot:SleepSnapshot};
export type SleepLegacyCreditReceipt={protocolVersion:1;ownerId:string;operationId:string;snapshot:SleepSnapshot};
export type SleepApiErrorCode='configuration'|'authentication'|'owner_changed'|'conflict'|'forbidden'|
  'invalid_operation'|'invalid_response'|'network'|'timeout'|'cancelled'|'server';
const messages:Record<SleepApiErrorCode,string>={
  configuration:'Invalid diary server configuration',authentication:'Diary authentication required',
  owner_changed:'Diary account changed; pending changes preserved',conflict:'Diary changed on another client; review required',
  forbidden:'Diary access denied',invalid_operation:'Invalid diary operation',invalid_response:'Invalid diary server response',
  network:'Diary server unavailable; pending changes preserved',timeout:'Diary request timed out; pending changes preserved',
  cancelled:'Diary request cancelled; pending changes preserved',server:'Diary server could not confirm this request'
};
export class SleepApiError extends Error{
  constructor(public readonly code:SleepApiErrorCode,public readonly status?:number){super(messages[code]);this.name='SleepApiError';}
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
// A valid 3M UTF-16-character diary may occupy up to 9M UTF-8 bytes.
const MAX_RESPONSE_BYTES=9000000;
function session(value:SleepApiSession|null):SleepApiSession{
  if(!value||!uuid(value.ownerId)||typeof value.token!=='string'||!/^[A-Za-z0-9_-]{40,128}$/.test(value.token))throw new SleepApiError('authentication');
  return {ownerId:value.ownerId.toLowerCase(),token:value.token};
}
function serverOrigin(raw:string,allowLoopbackHttp:boolean){
  try{
    const url=new URL(raw);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
      !(url.protocol==='https:'||allowLoopbackHttp&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error();
    return url.origin;
  }catch{throw new SleepApiError('configuration');}
}
async function json(response:Response,maxBytes=MAX_RESPONSE_BYTES):Promise<unknown>{
  if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!response.body)throw new SleepApiError('invalid_response');
  const declared=response.headers.get('Content-Length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes)){
    await response.body.cancel();throw new SleepApiError('invalid_response');
  }
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{
    for(;;){const next=await reader.read();if(next.done)break;
      size+=next.value.byteLength;if(size>maxBytes){await reader.cancel();throw new SleepApiError('invalid_response');}
      parts.push(next.value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SleepApiError('invalid_response');}
}

export function createSleepApi(options:{baseUrl:string;getSession:()=>SleepApiSession|null;
  allowLoopbackHttp?:boolean;timeoutMs?:number;fetch?:typeof globalThis.fetch}){
  const origin=serverOrigin(options.baseUrl,options.allowLoopbackHttp===true),timeout=options.timeoutMs??15000;
  if(!Number.isInteger(timeout)||timeout<1||timeout>60000)throw new SleepApiError('configuration');
  const fetcher=options.fetch??globalThis.fetch.bind(globalThis);
  const capture=()=>{try{return session(options.getSession());}catch{throw new SleepApiError('authentication');}};
  async function run<T>(expectedOwner:string|undefined,work:(current:SleepApiSession,request:(path:string,body?:unknown)=>Promise<unknown>)=>Promise<T>,signal?:AbortSignal):Promise<T>{
    const current=capture();
    if(expectedOwner!==undefined&&(!uuid(expectedOwner)||expectedOwner.toLowerCase()!==current.ownerId))throw new SleepApiError('owner_changed');
    if(signal?.aborted)throw new SleepApiError('cancelled');
    const controller=new AbortController();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
    const unchanged=()=>{
      let now:SleepApiSession;try{now=capture();}catch{throw new SleepApiError('owner_changed');}
      if(now.ownerId!==current.ownerId||now.token!==current.token)throw new SleepApiError('owner_changed');
    };
    const request=async(path:string,body?:unknown)=>{
      unchanged();
      const response=await fetcher(origin+path,{method:body===undefined?'GET':'POST',
        headers:{Accept:'application/json',Authorization:'Bearer '+current.token,...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,
        credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',mode:'cors'});
      unchanged();
      if(!response.ok){await response.body?.cancel();
        throw new SleepApiError(response.status===401?'authentication':response.status===403?'forbidden':response.status===409?'conflict':
          [400,413,415,422].includes(response.status)?'invalid_operation':'server',response.status);
      }
      const value=await json(response);unchanged();return value;
    };
    try{
      // Read snapshots carry no owner field. Bind the token to the expected account
      // before accepting any diary data, even if a caller mismatches owner/token.
      const identity=await request('/v1/session');
      if(!object(identity)||Object.keys(identity).length!==1||!uuid(identity.userId))throw new SleepApiError('invalid_response');
      if(identity.userId.toLowerCase()!==current.ownerId)throw new SleepApiError('owner_changed');
      const value=await work(current,request);unchanged();
      if(controller.signal.aborted)throw new SleepApiError(timedOut?'timeout':'cancelled');
      return value;
    }catch(error){
      unchanged();
      if(controller.signal.aborted)throw new SleepApiError(timedOut?'timeout':'cancelled');
      if(error instanceof SleepApiError)throw error;
      // Never propagate browser URLs, tokens, SQL errors or arbitrary response text.
      throw new SleepApiError('network');
    }finally{controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  const snapshot=(raw:unknown):SleepSnapshot=>{try{return parseSleepSnapshot(raw);}catch{throw new SleepApiError('invalid_response');}};
  async function saveOperation(value:SleepOperation,expectedOwnerId:string,signal?:AbortSignal){
    if(!uuid(expectedOwnerId))throw new SleepApiError('owner_changed');
    let operation:SleepOperation;try{operation=validateSleepOperation(value);}catch{throw new SleepApiError('invalid_operation');}
    return run(expectedOwnerId,async(current,request)=>snapshot(await request('/v1/diary/operations',{...operation,expectedOwnerId:current.ownerId})),signal);
  }
  async function cancelOperation(value:SleepOperation,expectedOwnerId:string,signal?:AbortSignal):Promise<SleepCancellationReceipt>{
    if(!uuid(expectedOwnerId))throw new SleepApiError('owner_changed');
    let operation:SleepOperation;try{operation=validateSleepOperation(value);}catch{throw new SleepApiError('invalid_operation');}
    return run(expectedOwnerId,async(current,request)=>{
      const raw=await request('/v1/diary/cancellations',{operationId:operation.operationId,expectedOwnerId:current.ownerId});
      if(!object(raw)||Object.keys(raw).length!==5||Object.keys(raw).some(k=>!['protocolVersion','ownerId','operationId','cancelled','snapshot'].includes(k))||
        raw.protocolVersion!==1||!uuid(raw.ownerId)||raw.ownerId.toLowerCase()!==current.ownerId||!uuid(raw.operationId)||
        raw.operationId.toLowerCase()!==operation.operationId.toLowerCase()||typeof raw.cancelled!=='boolean')throw new SleepApiError('invalid_response');
      const state=snapshot(raw.snapshot);
      if(!raw.cancelled&&!state.dates.some(row=>row.date===operation.date&&row.revision>operation.expectedRevision))throw new SleepApiError('invalid_response');
      return{protocolVersion:1,ownerId:current.ownerId,operationId:operation.operationId,cancelled:raw.cancelled,snapshot:state};
    },signal);
  }
  async function importLegacyCredits(value:SleepLegacyCreditOperation,expectedOwnerId:string,signal?:AbortSignal):Promise<SleepLegacyCreditReceipt>{
    if(!uuid(expectedOwnerId))throw new SleepApiError('owner_changed');
    let operation:SleepLegacyCreditOperation;try{operation=validateSleepLegacyCredits(value);}catch{throw new SleepApiError('invalid_operation');}
    return run(expectedOwnerId,async(current,request)=>{
      const raw=await request('/v1/diary/legacy-credits',{...operation,expectedOwnerId:current.ownerId});
      if(!object(raw)||Object.keys(raw).length!==4||Object.keys(raw).some(k=>!['protocolVersion','ownerId','operationId','snapshot'].includes(k))||raw.protocolVersion!==1||
        !uuid(raw.ownerId)||raw.ownerId.toLowerCase()!==current.ownerId||!uuid(raw.operationId)||raw.operationId.toLowerCase()!==operation.operationId.toLowerCase())throw new SleepApiError('invalid_response');
      const state=snapshot(raw.snapshot);
      if(operation.dates.some(d=>!state.credits.includes(d))||operation.garden&&!state.garden)throw new SleepApiError('invalid_response');
      return{protocolVersion:1,ownerId:current.ownerId,operationId:operation.operationId,snapshot:state};
    },signal);
  }
  return {
    importLegacyCredits,
    readSnapshot:(signal?:AbortSignal):Promise<OwnedSleepSnapshot>=>run(undefined,async(current,request)=>
      ({ownerId:current.ownerId,snapshot:snapshot(await request('/v1/diary'))}),signal),
    saveOperation,
    cancelOperation,
    // Compatibility with the prepared durable queue. Only this named operation
    // maps to a fixed HTTP endpoint; arbitrary RPC/SQL calls are not supported.
    async rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:SleepApiError|null}>{
      try{
        if(name!=='save_sleep_diary_operation'||Object.keys(args).length!==5||
          Object.keys(args).some(k=>!['p_operation','p_date','p_expected','p_night','p_expected_owner'].includes(k))||!uuid(args.p_expected_owner))throw new SleepApiError('invalid_operation');
        const data=await saveOperation({operationId:args.p_operation,date:args.p_date,expectedRevision:args.p_expected,night:args.p_night} as SleepOperation,args.p_expected_owner);
        return {data,error:null};
      }catch(error){return {data:null,error:error instanceof SleepApiError?error:new SleepApiError('network')};}
    }
  };
}
export {serverOrigin as sleepApiOrigin,json as readSleepApiJson,session as validateSleepApiSession};
