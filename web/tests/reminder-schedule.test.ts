import test from 'node:test';import assert from 'node:assert/strict';
import {reminderScheduleView} from '../components/sleep/alarm-schedule';import {reminderTime} from '../components/sleep/sleep-insights';import type {DeviceStatus} from '../components/sleep/sleep-device';
const native:DeviceStatus={native:true,exact:false,notifications:true,microphone:false,reminderNotifications:true};
test('reminder readiness is independent of exact alarms and microphone, and uses confirmed local date',()=>{
 const at=Date.parse('2026-12-31T20:45:00Z'),s=reminderScheduleView({...native,reminderScheduleState:'scheduled',nextReminderAt:at,reminderBedtimeAt:at+30*60000,reminderTimeZone:'Europe/Moscow'});
 assert.equal(s.state,'scheduled');assert.equal(s.at,at);assert.match(s.detail,/31 декабря/);assert.match(s.detail,/23:45/);
});
test('off, blocked channel/global notification, missing and failed reminders do not claim readiness',()=>{
 assert.equal(reminderScheduleView({...native,reminderScheduleState:'off'}).state,'off');assert.equal(reminderScheduleView(native).state,'checking');
 for(const denied of [{notifications:false},{reminderNotifications:false},{reminderScheduleState:'permission_required' as const}])assert.equal(reminderScheduleView({...native,...denied}).state,'permission_required');
 for(const bad of [{nextReminderAt:NaN},{reminderBedtimeAt:1},{reminderTimeZone:'bad/zone'},{reminderScheduleError:'failure'}])assert.equal(reminderScheduleView({...native,reminderScheduleState:'scheduled',nextReminderAt:100,reminderBedtimeAt:200,...bad}).state,'not_scheduled');
 assert.equal(reminderScheduleView({...native,native:false}).state,'web');assert.equal(reminderScheduleView(native,true).state,'demo');
});
test('web reminder crosses midnight once and skips an already-passed reminder instead of notifying late',()=>{
 const schedule={bed:'00:15',wake:'08:15',hours:8,tolerance:45};const before=new Date(2026,10,4,23,0).getTime(),after=new Date(2026,10,5,0,5).getTime();
 assert.equal(reminderTime(schedule,30,before),new Date(2026,10,4,23,45).getTime());assert.equal(reminderTime(schedule,30,after),new Date(2026,10,5,23,45).getTime());
 assert.equal(reminderTime(schedule,30,new Date(2026,10,4,23,45).getTime()),new Date(2026,10,5,23,45).getTime());
 for(const lead of [-1,0,6,121,NaN])assert.throws(()=>reminderTime(schedule,lead,before));
});

test('web bedtime-based calculation keeps real lead across a DST transition after a missed window',()=>{
 const previous=process.env.TZ;try{process.env.TZ='Europe/Berlin';assert.equal(new Date('2026-03-29T00:30:00Z').getHours(),1);
 assert.equal(reminderTime({bed:'03:15',wake:'11:15',hours:8,tolerance:45},60,Date.parse('2026-03-29T00:30:00Z')),Date.parse('2026-03-30T00:15:00Z'));
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
