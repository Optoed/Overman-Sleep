import assert from 'node:assert/strict';
import test from 'node:test';
import { HoldConfirmation } from '../components/sleep/hold-confirmation';

for(const input of ['pointer:1','pointer:22','key: ','key:Enter'])test(`${input}: minimum 3000 ms and one completion per gesture`,()=>{
  const hold=new HoldConfirmation();
  assert.equal(hold.complete(100000),false);
  assert.equal(hold.begin(input,1000),true);
  assert.equal(hold.progress(2500),.5);
  assert.equal(hold.complete(3999.999),false);
  assert.equal(hold.complete(4000),true);
  assert.equal(hold.complete(4001),false);
  assert.equal(hold.begin(input,5000),false);
  hold.cancel(input);assert.equal(hold.begin(input,5000),true);
  assert.equal(hold.complete(7999),false);assert.equal(hold.complete(8000),true);
});
test('interruption discards elapsed time; backwards clock cannot confirm',()=>{
  const hold=new HoldConfirmation();hold.begin('pointer:1',5000);
  assert.equal(hold.progress(4000),0);assert.equal(hold.complete(4000),false);
  hold.cancel();assert.equal(hold.progress(9000),0);assert.equal(hold.complete(9000),false);
  hold.begin('pointer:1',9000);assert.equal(hold.complete(11999),false);assert.equal(hold.complete(12000),true);
});
test('another pointer or key cannot steal, restart or cancel the owner',()=>{
  const hold=new HoldConfirmation();hold.begin('pointer:1',0);
  for(const other of ['pointer:2','key: ','key:Enter']){
    assert.equal(hold.begin(other,1500),false);assert.equal(hold.cancel(other),false);
    assert.equal(hold.owns('pointer:1'),true);
  }
  assert.equal(hold.complete(2999),false);assert.equal(hold.complete(3000),true);
});
