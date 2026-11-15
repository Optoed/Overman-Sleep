import test from 'node:test';import assert from 'node:assert/strict';
import {alarmAudioIssue} from '../components/sleep/alarm-audio';import {defaultAlarm} from '../components/sleep/sleep-state';
const native={native:true,notifications:true,exact:true,microphone:false,alarmSystemVolume:5,vibrationAvailable:true};
test('silent enabled alarm cannot be saved, disabled alarm remains valid',()=>{
 assert.ok(alarmAudioIssue({...defaultAlarm,enabled:true,volume:0,vibration:false},native));
 assert.equal(alarmAudioIssue({...defaultAlarm,volume:0,vibration:false},native),null);
 assert.equal(alarmAudioIssue({...defaultAlarm,enabled:true,volume:.2,vibration:false},native),null);
});
test('system zero and unavailable vibration are considered, a deliberate vibration-only alarm is allowed',()=>{
 const on={...defaultAlarm,enabled:true};
 assert.equal(alarmAudioIssue({...on,volume:0},native),null);
 assert.equal(alarmAudioIssue(on,{...native,alarmSystemVolume:0}),null);
 assert.match(alarmAudioIssue({...on,vibration:false},{...native,alarmSystemVolume:0})!,/Android выключена/);
 assert.ok(alarmAudioIssue({...on,volume:0},{...native,vibrationAvailable:false}));
 assert.ok(alarmAudioIssue(on,{...native,alarmSystemVolume:0,vibrationAvailable:false}));
});
