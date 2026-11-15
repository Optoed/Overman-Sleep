import test from 'node:test';
import assert from 'node:assert/strict';
import { frameTiming } from '../components/tower/frame-timing';

test('GPU measurements never nest queries or read incomplete results, and release pending queries',()=>{
  let available=false,active:object|null=null,created=0,deleted=0,results=0;
  const context={
    QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,
    getExtension:()=>({TIME_ELAPSED_EXT:3,GPU_DISJOINT_EXT:4}),
    getParameter:()=>false,
    createQuery:()=>{created++;return {};},
    beginQuery:(_target:number,q:object)=>{assert.equal(active,null);active=q;},
    endQuery:()=>{assert.ok(active);active=null;},
    deleteQuery:()=>{deleted++;},
    getQueryParameter:(_q:object,key:number)=>{
      assert.equal(active,null);
      if(key===1)return available;
      assert.ok(available);results++;return 6e6;
    },
  } as unknown as WebGL2RenderingContext;
  const timing=frameTiming(context);
  const frame=()=>{
    timing.begin();
    for(const scope of ['shadows','reflection','bloom'] as const){timing.begin(scope);timing.end(scope);}
    timing.end();
  };
  for(let i=0;i<20;i++)frame();
  assert.equal(created,1);assert.equal(results,0);assert.equal(timing.milliseconds(),null);
  available=true;for(let i=0;i<120;i++)frame();
  for(const scope of ['frame','shadows','reflection','bloom'] as const)assert.equal(timing.milliseconds(scope),6);
  assert.equal(timing.summary()?.mean,6);assert.ok(timing.summary()!.samples>1);
  assert.ok(created>10);timing.dispose();assert.equal(deleted,created);assert.equal(active,null);
});

test('unsupported GPU timing remains unavailable rather than interrupting rendering',()=>{
  const timing=frameTiming({getExtension:()=>null} as unknown as WebGLRenderingContext);
  timing.begin();timing.end();assert.equal(timing.milliseconds(),null);timing.dispose();
  assert.equal(timing.summary(),null);
});

test('GPU statistics bound their window and exclude disjoint samples',()=>{
  let duration=2,disjoint=false;
  const context={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,
    getExtension:()=>({TIME_ELAPSED_EXT:3,GPU_DISJOINT_EXT:4}),getParameter:()=>disjoint,
    createQuery:()=>({}),beginQuery:()=>{},endQuery:()=>{},deleteQuery:()=>{},
    getQueryParameter:(_q:object,key:number)=>key===1?true:duration*1e6,
  } as unknown as WebGL2RenderingContext;
  const timing=frameTiming(context,false),frames=(count:number)=>{for(let i=0;i<count;i++){timing.begin();timing.end();}};
  frames(160);assert.deepEqual(timing.summary(),{samples:16,mean:2,min:2,max:2});
  disjoint=true;duration=200;frames(160);assert.equal(timing.milliseconds(),null);
  assert.deepEqual(timing.summary(),{samples:16,mean:2,min:2,max:2});
  disjoint=false;duration=5;frames(160);
  assert.deepEqual(timing.summary(),{samples:16,mean:5,min:5,max:5});timing.dispose();
});
