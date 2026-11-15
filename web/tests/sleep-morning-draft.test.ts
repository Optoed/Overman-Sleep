import test from 'node:test';
import assert from 'node:assert/strict';
import {beginNight,captureWake,freshSleep} from '../components/sleep/sleep-state';
import {initialMorningFields,matchingMorningDraft,validMorningDraft,writeMorningDraftPrimary,writeMorningDraftBackup,morningDraftKey,type MorningDraft} from '../components/sleep/sleep-morning-draft';
const wake=Date.now(),started=wake-8*3600000,active=captureWake(beginNight(freshSleep(),started),wake).active!;
const entry=(sequence=1):MorningDraft=>({version:1,id:active.id,started,wokeAt:wake,sequence,fields:initialMorningFields(active)});
test('defaults use immutable captured wake and original goal, including after a long wait',()=>{
 const fields=initialMorningFields(active),copy=structuredClone(active);
 assert.equal(fields.sleep,'8');assert.deepEqual(initialMorningFields(copy),fields);
 assert.throws(()=>initialMorningFields({...active,wokeAt:undefined}));assert.deepEqual(active,copy);
});
test('incomplete fields are retained verbatim and no history record is created',()=>{
 const d=entry();d.fields={bed:'',wake:'',sleep:'',latency:'',awake:'0',rested:0,note:'Ещё заполняю\n🌙'};
 assert.equal(validMorningDraft(d),true);const saved=new Map<string,string>();writeMorningDraftPrimary({setItem:(k,v)=>{saved.set(k,v);}},'test',d);
 assert.deepEqual(JSON.parse(saved.get(morningDraftKey('test'))!),d);assert.equal(active.wokeAt,wake);
});
test('latest sequence for the exact night wins; stale or other-night drafts are ignored',()=>{
 const older=entry(2),latest=entry(5);latest.fields.note='Последний ввод';
 assert.equal(matchingMorningDraft([older,latest],active),latest);
 assert.equal(matchingMorningDraft([latest],{...active,started:started+1}),null);
 assert.equal(matchingMorningDraft([latest],{...active,wokeAt:wake+1}),null);
 assert.equal(matchingMorningDraft([latest],null),null);
});
test('malformed or excessive drafts cannot silently enter storage',()=>{
 for(const bad of [null,{}, {...entry(),sequence:-1},{...entry(),fields:{...entry().fields,rested:6}},{...entry(),fields:{...entry().fields,note:'x'.repeat(2001)}}])assert.equal(validMorningDraft(bad),false);
 assert.throws(()=>writeMorningDraftPrimary(null,'test',entry()));assert.throws(()=>writeMorningDraftPrimary({setItem(){throw new Error('quota');}},'test',entry()));
});
test('backup rejects an oversized numeric field before attempting a transaction',()=>{
 const d=entry();d.fields.sleep='9'.repeat(65);
 assert.throws(()=>writeMorningDraftBackup('test',d),/длину введённых значений/);
});
