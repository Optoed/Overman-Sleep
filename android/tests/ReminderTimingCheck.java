package app.overman.sleep;
import java.time.*;import java.util.*;
public class ReminderTimingCheck {
 static int cases;static long at(String s){return Instant.parse(s).toEpochMilli();}
 static void expect(String bed,int lead,String now,String consumed,String expected,String goal,String zone){SleepTiming.Reminder r=SleepTiming.nextReminder(bed,lead,at(now),TimeZone.getTimeZone(zone),consumed);if(r.deadline!=at(expected)||r.bedtime!=at(goal)||!r.bedDate.equals(Instant.ofEpochMilli(r.bedtime).atZone(ZoneId.of(zone)).toLocalDate().toString()))throw new AssertionError(Instant.ofEpochMilli(r.deadline)+" / "+Instant.ofEpochMilli(r.bedtime));cases++;}
 public static void main(String[] args){
 expect("23:00",30,"2026-11-04T19:00:00Z","","2026-11-04T19:30:00Z","2026-11-04T20:00:00Z","Europe/Moscow");
 expect("00:15",30,"2026-11-04T20:00:00Z","","2026-11-04T20:45:00Z","2026-11-04T21:15:00Z","Europe/Moscow");
 expect("00:15",30,"2026-11-04T21:05:00Z","","2026-11-05T20:45:00Z","2026-11-05T21:15:00Z","Europe/Moscow");
 expect("00:15",30,"2026-11-04T20:45:00Z","","2026-11-05T20:45:00Z","2026-11-05T21:15:00Z","Europe/Moscow");
 expect("23:00",30,"2026-11-04T19:00:00Z","2026-11-04","2026-11-05T19:30:00Z","2026-11-05T20:00:00Z","Europe/Moscow");
 expect("00:10",120,"2026-12-31T23:30:00Z","","2027-01-01T22:10:00Z","2027-01-02T00:10:00Z","UTC");
 expect("03:15",60,"2026-03-29T00:30:00Z","","2026-03-30T00:15:00Z","2026-03-30T01:15:00Z","Europe/Berlin");
 expect("03:15",60,"2026-03-28T23:00:00Z","","2026-03-29T00:15:00Z","2026-03-29T01:15:00Z","Europe/Berlin");
 expect("01:30",30,"2026-11-01T04:30:00Z","","2026-11-01T05:00:00Z","2026-11-01T05:30:00Z","America/New_York");
 expect("01:30",30,"2026-11-01T05:15:00Z","2026-11-01","2026-11-02T06:00:00Z","2026-11-02T06:30:00Z","America/New_York");
 for(int lead:new int[]{5,10,15,20,30,45,60,90,120}){if(!SleepTiming.validReminderLead(lead))throw new AssertionError("valid lead");cases++;}
 for(int lead:new int[]{-1,0,4,6,121,1440}){try{SleepTiming.nextReminder("23:00",lead,at("2026-11-04T00:00:00Z"),TimeZone.getTimeZone("UTC"),"");throw new AssertionError("invalid lead accepted");}catch(IllegalArgumentException expected){cases++;}}
 long now=at("2026-11-04T22:30:00Z");if(!AlarmDeliveryPolicy.reminder(now,now,now,true))throw new AssertionError("due");cases++;
 if(AlarmDeliveryPolicy.reminder(now,now,now-1,true)||AlarmDeliveryPolicy.reminder(now,now-1,now,true)||AlarmDeliveryPolicy.reminder(0,0,now,true)||AlarmDeliveryPolicy.reminder(now,now,now,false))throw new AssertionError("stale/future/off accepted");cases+=4;
 System.out.println(cases+" reminder cases passed: midnight, year, DST gap/overlap, consumed date, all leads, validation and stale delivery.");
 }
}
