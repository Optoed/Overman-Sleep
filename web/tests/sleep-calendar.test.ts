import test from 'node:test';import assert from 'node:assert/strict';
import {validCalendarDate,journalWeekEnd,journalWeekStart,previousJournalDay,nextJournalDay,readNotificationTarget} from '../components/sleep/sleep-calendar';
test('journal weeks run Monday to Sunday across month, year and leap boundaries',()=>{
 for(const [day,end] of [['2026-11-05','2026-11-08'],['2026-11-02','2026-11-08'],['2026-11-08','2026-11-08'],['2025-12-31','2026-01-04'],['2024-02-29','2024-03-03'],['2026-03-29','2026-03-29']])assert.equal(journalWeekEnd(day),end);
});
test('next journal week retains weekday and stops at today',()=>{assert.equal(nextJournalDay('2026-10-29','2026-11-05'),'2026-11-05');assert.equal(nextJournalDay('2026-11-01','2026-11-05'),'2026-11-05');});
test('calendar dates reject rollover, incomplete, malformed and hostile input',()=>{for(const d of [null,'','2026-02-29','2026-13-01','2026-11-31','2026-1-1','<script>'])assert.equal(validCalendarDate(d),false);assert.equal(validCalendarDate('2024-02-29'),true);assert.throws(()=>journalWeekEnd('2026-02-30'));});
test('notification target is a typed navigation hint, never a command or arbitrary date',()=>{for(const raw of ['',undefined,'{}','null','{"id":"1","target":"stop"}','{"id":"","target":"sleep"}'])assert.equal(readNotificationTarget(raw),null);assert.deepEqual(readNotificationTarget('{"id":"1","target":"morning","wokeAt":1}'),{id:'1',target:'morning'});});

test("calendar bounds never overflow into invalid extended years",()=>{assert.equal(validCalendarDate("0000-01-01"),false);assert.equal(journalWeekStart("0001-01-01"),"0001-01-01");assert.equal(journalWeekEnd("0001-01-01"),"0001-01-07");assert.equal(previousJournalDay("0001-01-01"),"0001-01-01");assert.equal(journalWeekStart("9999-12-31"),"9999-12-27");assert.equal(journalWeekEnd("9999-12-31"),"9999-12-31");assert.equal(nextJournalDay("9999-12-31","9999-12-31"),"9999-12-31");});
