import test from 'node:test';import assert from 'node:assert/strict';
import {alarmPermissionIssue,alarmScheduleView} from '../components/sleep/alarm-schedule';
import type {DeviceStatus} from '../components/sleep/sleep-device';
const native:DeviceStatus={native:true,exact:true,notifications:true,microphone:false};
test('scheduled label uses the native confirmed instant, date and timezone, not an unsaved clock',()=>{
 const at=Date.parse('2026-12-31T21:15:00Z'),view=alarmScheduleView({...native,alarmScheduleState:'scheduled',nextAlarmAt:at,alarmTimeZone:'Europe/Moscow'},false);
 assert.equal(view.state,'scheduled');assert.equal(view.at,at);assert.match(view.detail,/1 января 2027/);assert.match(view.detail,/00:15/);
});
test('disabled, denied, missing and failed native schedules never announce ready or invent a date',()=>{
 assert.equal(alarmScheduleView({...native,alarmScheduleState:'off',nextAlarmAt:1},true).state,'off');
 assert.equal(alarmScheduleView({...native,exact:false,alarmScheduleState:'permission_required',nextAlarmAt:1},true).state,'permission_required');
 for(const extra of [{alarmScheduleState:'not_scheduled' as const},{alarmScheduleState:'scheduled' as const,nextAlarmAt:NaN},{alarmScheduleState:'scheduled' as const,nextAlarmAt:0},{alarmScheduleState:'scheduled' as const,nextAlarmAt:1,alarmTimeZone:'invalid/zone'},{alarmScheduleState:'scheduled' as const,nextAlarmAt:1,alarmScheduleError:'Не удалось поставить сигнал'}])assert.equal(alarmScheduleView({...native,...extra},true).state,'not_scheduled');
 assert.equal(alarmScheduleView(native,true).state,'checking');
});
test('browser and demo cannot claim to have a system alarm',()=>{
 assert.equal(alarmScheduleView({...native,native:false},true).state,'web');assert.equal(alarmScheduleView({...native,alarmScheduleState:'scheduled',nextAlarmAt:1},true,true).state,'demo');
});

test('revoked notifications or exact alarms override a stale scheduled date and readiness text',()=>{
 for(const permission of ['notifications','exact'] as const){
  const denied={...native,[permission]:false,alarmScheduleState:'scheduled' as const,nextAlarmAt:Date.now()+3600000};
  const view=alarmScheduleView(denied,true);
  assert.equal(view.state,'permission_required');assert.equal(view.at,undefined);
  assert.match(view.detail,permission==='notifications'?/уведомления/:/точные будильники/);
  assert.ok(alarmPermissionIssue(denied));
 }
 assert.equal(alarmPermissionIssue(native),null);
 assert.match(alarmPermissionIssue({...native,notifications:false,exact:false})!,/уведомления/);
});

test('fullscreen refusal uses notification fallback without denying a valid exact alarm',()=>{
 const device={...native,fullScreen:false,alarmScheduleState:'scheduled' as const,nextAlarmAt:Date.now()+3600000};
 assert.equal(alarmPermissionIssue(device),null);assert.equal(alarmScheduleView(device,true).state,'scheduled');
 assert.equal(alarmScheduleView(device,true).at,device.nextAlarmAt);
});
