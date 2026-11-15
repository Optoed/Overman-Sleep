import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSleepApi,SleepApiError,type SleepApiSession} from '../lib/sleep-api';
import {readSleepQueue,enqueueSleepOperation,sendFirstSleepOperation,type SleepOperation} from '../lib/sleep-sync-queue';
const owner=randomUUID(),token='a'.repeat(43),identity={ownerId:owner,token};
const empty={protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[]};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const errorCode=(code:string)=>(error:unknown)=>error instanceof SleepApiError&&error.code===code;
function operation():SleepOperation{
  const wake=Date.parse('2026-06-01T07:30:00+03:00');return{operationId:randomUUID(),date:'2026-06-01',expectedRevision:0,
    night:{date:'2026-06-01',bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',
      sleepMinutes:480,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:true}};
}
function queued(){
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
  const op=operation(),queue=enqueueSleepOperation(storage,readSleepQueue(storage,owner),op);
  return{storage,queue,op,raw:()=>JSON.stringify([...values])};
}
function client(fetcher:typeof fetch,getSession:()=>SleepApiSession|null=()=>identity,timeoutMs=1000){
  return createSleepApi({baseUrl:'http://127.0.0.1:3902',allowLoopbackHttp:true,getSession,fetch:fetcher,timeoutMs});
}

test('05.02 own HTTP: insecure/credential-bearing server config and missing sessions never send a token',async()=>{
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;return reply({userId:owner});};
  for(const baseUrl of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com/?token=private','https://example.com/#private','file:///private'])
    assert.throws(()=>createSleepApi({baseUrl,allowLoopbackHttp:true,getSession:()=>identity,fetch:fetcher}),errorCode('configuration'));
  assert.throws(()=>createSleepApi({baseUrl:'http://127.0.0.1:3902',getSession:()=>identity}),errorCode('configuration'));
  for(const getSession of [()=>null,()=>({...identity,token:'bad'}),()=>{throw Error(token);}])
    await assert.rejects(client(fetcher,getSession).readSnapshot(),errorCode('authentication'));
  assert.equal(calls,0);
});

test('05.02 own HTTP: validated identity precedes snapshot; cookies, redirects, referrers and cache are disabled',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const api=client(async(input,init)=>{calls.push({url:String(input),init:init!});return reply(String(input).endsWith('/v1/session')?{userId:owner}:empty);});
  const result=await api.readSnapshot();assert.deepEqual(result,{ownerId:owner,snapshot:empty});
  assert.deepEqual(calls.map(c=>c.url),['http://127.0.0.1:3902/v1/session','http://127.0.0.1:3902/v1/diary']);
  for(const {init} of calls){assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.referrerPolicy,'no-referrer');}
  assert.ok(!JSON.stringify(result).includes(token));
});

test('05.02 own HTTP: queue maps a fixed endpoint with unchanged UUID and bound expected owner',async()=>{
  const q=queued(),requests:Record<string,unknown>[]=[];
  const api=client(async(input,init)=>{
    if(String(input).endsWith('/v1/session'))return reply({userId:owner});
    assert.equal(String(input),'http://127.0.0.1:3902/v1/diary/operations');assert.equal(init!.method,'POST');
    requests.push(JSON.parse(init!.body as string));
    return reply({...empty,credits:[q.op.date],dates:[{date:q.op.date,revision:1,night:q.op.night}]});
  });
  const sent=await sendFirstSleepOperation(q.storage,q.queue,api);assert.equal(sent!.queue.operations.length,0);
  assert.deepEqual(requests,[{...q.op,expectedOwnerId:owner}]);
  const invalid=await api.rpc('arbitrary_sql',{});assert.equal(invalid.error?.code,'invalid_operation');assert.equal(requests.length,1);
});

test('05.02 own HTTP: mismatched owner/token cannot read another diary or submit a pending operation',async()=>{
  let calls=0;const q=queued(),before=q.raw();
  const api=client(async()=>{calls++;return reply({userId:randomUUID()});});
  await assert.rejects(api.readSnapshot(),errorCode('owner_changed'));assert.equal(calls,1);
  await assert.rejects(api.saveOperation(q.op,randomUUID()),errorCode('owner_changed'));assert.equal(calls,1);
  await assert.rejects(sendFirstSleepOperation(q.storage,q.queue,api));assert.equal(q.raw(),before);assert.equal(calls,2);
});

test('05.02 own HTTP: logout or token rotation after committed headers leaves pending UUID intact',async()=>{
  for(const replacement of [null,{...identity,token:'b'.repeat(43)},{ownerId:randomUUID(),token:'c'.repeat(43)}]){
    let current:SleepApiSession|null=identity;const q=queued(),before=q.raw();let commits=0;
    const api=client(async input=>{
      if(String(input).endsWith('/v1/session'))return reply({userId:owner});
      commits++;current=replacement;return reply({...empty,credits:[q.op.date],dates:[{date:q.op.date,revision:1,night:q.op.night}]});
    },()=>current);
    await assert.rejects(sendFirstSleepOperation(q.storage,q.queue,api));assert.equal(commits,1);assert.equal(q.raw(),before);
  }
});

test('05.02 own HTTP: auth/conflict/server failures are redacted and never retried or acknowledged',async()=>{
  for(const [status,code] of [[401,'authentication'],[403,'forbidden'],[409,'conflict'],[422,'invalid_operation'],[503,'server']] as const){
    const q=queued(),before=q.raw();let posts=0;
    const api=client(async input=>{
      if(String(input).endsWith('/v1/session'))return reply({userId:owner});
      posts++;return reply({error:'secret SQL '+token},status);
    });
    const result=await api.rpc('save_sleep_diary_operation',{p_operation:q.op.operationId,p_date:q.op.date,p_expected:0,p_night:q.op.night,p_expected_owner:owner});
    assert.equal(result.error?.code,code);assert.equal(result.error?.status,status);assert.ok(!String(result.error).includes(token));
    assert.equal(posts,1);assert.equal(q.raw(),before);
  }
  const api=client(async()=>{throw Error('Failed to fetch '+token);});
  await assert.rejects(api.readSnapshot(),e=>errorCode('network')(e)&&!String(e).includes(token));
});

test('05.02 own HTTP: corrupt/unknown/old snapshots do not remove a pending operation',async()=>{
  for(const bad of [{...empty,extra:'unknown'},empty,{...empty,credits:[operation().date]},
    {...empty,dates:[{date:'2026-06-01',revision:0,night:null}]}]){
    const q=queued(),before=q.raw();const api=client(async input=>reply(String(input).endsWith('/v1/session')?{userId:owner}:bad));
    await assert.rejects(sendFirstSleepOperation(q.storage,q.queue,api));assert.equal(q.raw(),before);
  }
});

test('05.02 own HTTP: timeout and explicit abort leave pending data intact',async()=>{
  const stalled:typeof fetch=async(_input,init)=>new Promise((_resolve,reject)=>{
    init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  const q=queued(),before=q.raw();const api=client(stalled,()=>identity,10);
  await assert.rejects(api.readSnapshot(),errorCode('timeout'));
  await assert.rejects(sendFirstSleepOperation(q.storage,q.queue,api));assert.equal(q.raw(),before);
  const cancelled=new AbortController();cancelled.abort();let calls=0;
  const noCall=client(async()=>{calls++;return reply(empty);});
  await assert.rejects(noCall.readSnapshot(cancelled.signal),errorCode('cancelled'));assert.equal(calls,0);
  const active=new AbortController();const pending=client(stalled).readSnapshot(active.signal);active.abort();
  await assert.rejects(pending,errorCode('cancelled'));
});

test('05.02 own HTTP: malformed UTF-8/JSON, non-JSON and oversized streaming responses are bounded',async()=>{
  const cases=[()=>new Response('<html>private</html>',{headers:{'Content-Type':'text/html'}}),
    ()=>new Response('{',{headers:{'Content-Type':'application/json'}}),
    ()=>new Response(new Uint8Array([0xff]),{headers:{'Content-Type':'application/json'}}),
    ()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'9000001'}}),
    ()=>new Response(new Uint8Array(9000001),{headers:{'Content-Type':'application/json'}})];
  for(const response of cases){
    const q=queued(),before=q.raw();const api=client(async input=>String(input).endsWith('/v1/session')?reply({userId:owner}):response());
    await assert.rejects(sendFirstSleepOperation(q.storage,q.queue,api));assert.equal(q.raw(),before);
  }
});

test('05.02 own HTTP: invalid operation is rejected before network and unknown input is not forwarded',async()=>{
  let calls=0;const api=client(async()=>{calls++;return reply(empty);});
  for(const value of [{...operation(),expectedRevision:-1},{...operation(),date:'2026-02-31'},{...operation(),extra:'unexpected'}])
    await assert.rejects(api.saveOperation(value,owner),errorCode('invalid_operation'));
  assert.equal(calls,0);
});
test('05.02 own HTTP: a valid 2000-night Russian diary is not mistaken for an oversized UTF-8 response',async()=>{
  const note='я'.repeat(1000),sample=operation().night!;
  const dates=Array.from({length:2000},(_,i)=>{
    const wake=Date.parse('2000-01-01T07:30:00+03:00')+i*86400000,date=new Date(wake+180*60000).toISOString().slice(0,10);
    return{date,revision:1,night:{...sample,date,bed:wake-510*60000,wake,sleepMinutes:0,success:false,note}};
  });
  const data={...empty,dates},encoded=JSON.stringify(data);assert.ok(encoded.length<3000000);assert.ok(new TextEncoder().encode(encoded).length>3000000);
  const result=await client(async input=>reply(String(input).endsWith('/v1/session')?{userId:owner}:data)).readSnapshot();
  assert.equal(result.snapshot.dates.length,2000);assert.equal(result.snapshot.dates[1999].night?.note,note);
});
test('05.02 own HTTP: an omitted expected account never falls back to the current session for a write',async()=>{
  let calls=0;const api=client(async()=>{calls++;return reply(empty);});
  await assert.rejects(api.saveOperation(operation(),undefined as unknown as string),errorCode('owner_changed'));
  assert.equal(calls,0);
});
test('05.02 own HTTP cancellation: receipt is bound to exact account/UUID and never clears the durable queue',async()=>{
 const q=queued(),before=q.raw();let requests=0;
 const api=client(async(input,init)=>{
   if(String(input).endsWith('/v1/session'))return reply({userId:owner});
   assert.equal(String(input),'http://127.0.0.1:3902/v1/diary/cancellations');requests++;
   assert.deepEqual(JSON.parse(init!.body as string),{operationId:q.op.operationId,expectedOwnerId:owner});
   return reply({protocolVersion:1,ownerId:owner,operationId:q.op.operationId,cancelled:true,snapshot:empty});
 });
 const receipt=await api.cancelOperation(q.op,owner);assert.equal(receipt.cancelled,true);assert.deepEqual(receipt.snapshot,empty);
 assert.equal(requests,1);assert.equal(q.raw(),before);
});

test('05.02 own HTTP cancellation: forged/unknown/unacknowledged receipts are not accepted',async()=>{
 const q=queued(),before=q.raw(),valid={protocolVersion:1,ownerId:owner,operationId:q.op.operationId,cancelled:true,snapshot:empty};
 for(const value of [{...valid,ownerId:randomUUID()},{...valid,operationId:randomUUID()},{...valid,extra:'untrusted'},{...valid,cancelled:false},
   {...valid,protocolVersion:2},{...valid,snapshot:{...empty,extra:'bad'}}]){
   const api=client(async input=>reply(String(input).endsWith('/v1/session')?{userId:owner}:value));
   await assert.rejects(api.cancelOperation(q.op,owner),errorCode('invalid_response'));assert.equal(q.raw(),before);
 }
 const applied={...valid,cancelled:false,snapshot:{...empty,credits:[q.op.date],dates:[{date:q.op.date,revision:1,night:q.op.night}]}};
 const good=client(async input=>reply(String(input).endsWith('/v1/session')?{userId:owner}:applied));
 assert.equal((await good.cancelOperation(q.op,owner)).cancelled,false);assert.equal(q.raw(),before);
});
test('05.02 legacy HTTP import sends only labelled-date claim fields after identity check; no durable queue changes',async()=>{
 const q=queued(),before=q.raw(),op={operationId:randomUUID(),dates:['2026-06-02','2026-06-01'],garden:true},calls:{url:string;body:unknown}[]=[];
 const snapshot={...empty,garden:true,credits:['2026-06-01','2026-06-02'],deletedCredits:['2026-06-01','2026-06-02'],dates:['2026-06-01','2026-06-02'].map(date=>({date,revision:1,night:null})),legacyCredits:['2026-06-01','2026-06-02'],legacyGarden:true};
 const api=client(async(input,init)=>{calls.push({url:String(input),body:init?.body?JSON.parse(String(init.body)):null});return reply(String(input).endsWith('/session')?{userId:owner}:{protocolVersion:1,ownerId:owner,operationId:op.operationId,snapshot});});
 const result=await api.importLegacyCredits(op,owner);assert.equal(result.snapshot.legacyGarden,true);assert.equal(calls.length,2);assert.ok(calls[1].url.endsWith('/legacy-credits'));
 assert.deepEqual(calls[1].body,{operationId:op.operationId,dates:['2026-06-01','2026-06-02'],garden:true,expectedOwnerId:owner});assert.equal(q.raw(),before);
});

test('05.02 legacy HTTP rejects unacknowledged dates/garden, wrong owner/UUID and unknown receipt fields',async()=>{
 const op={operationId:randomUUID(),dates:['2026-06-01'],garden:true};
 const snapshot={...empty,garden:true,credits:op.dates,deletedCredits:op.dates,dates:[{date:op.dates[0],revision:1,night:null}],legacyCredits:op.dates,legacyGarden:true};
 const good={protocolVersion:1,ownerId:owner,operationId:op.operationId,snapshot};
 for(const bad of [{...good,ownerId:randomUUID()},{...good,operationId:randomUUID()},{...good,extra:true},{...good,snapshot:empty},{...good,snapshot:{...snapshot,garden:false,legacyGarden:false}},{...good,snapshot:{...snapshot,legacyCredits:['2026-06-02']}}]){
  const api=client(async input=>reply(String(input).endsWith('/session')?{userId:owner}:bad));await assert.rejects(api.importLegacyCredits(op,owner),errorCode('invalid_response'));
 }
 let calls=0;const api=client(async()=>{calls++;return reply({});});await assert.rejects(api.importLegacyCredits({...op,dates:[null]} as never,owner),errorCode('invalid_operation'));assert.equal(calls,0);
});