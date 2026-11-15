import test from 'node:test';import assert from 'node:assert/strict';
import {freshSleep,parseSleep,persistSleep,SLEEP_KEY} from '../components/sleep/sleep-state';
import {UnsupportedDiaryScoreVersion} from '../components/sleep/sleep-score-version';

test('a future archive marker prevents an old client from parsing or overwriting it',()=>{
 const state=freshSleep(),raw=JSON.stringify({...state,scoreVersion:'health-records-v1'});let stored=raw;
 const storage={getItem:(key:string)=>key===SLEEP_KEY?stored:null,setItem:(_key:string,value:string)=>{stored=value;}};
 assert.throws(()=>parseSleep(raw),UnsupportedDiaryScoreVersion);
 assert.throws(()=>persistSleep(storage,SLEEP_KEY,state,{...state,configured:true}),UnsupportedDiaryScoreVersion);
 assert.equal(stored,raw);
});
