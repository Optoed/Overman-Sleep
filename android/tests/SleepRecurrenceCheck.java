package app.overman.sleep;
import java.time.*;import java.util.*;
public class SleepRecurrenceCheck {
 static int cases;
 static long at(String value){return Instant.parse(value).toEpochMilli();}
 static void expect(String wake,String now,String consumed,String skip,String expected,String zone){long actual=SleepTiming.nextAlarm(wake,at(now),TimeZone.getTimeZone(zone),consumed,skip);if(actual!=at(expected))throw new AssertionError(Instant.ofEpochMilli(actual)+" != "+expected);cases++;}
 public static void main(String[] args){
 expect("07:30","2026-11-05T04:00:00Z","","","2026-11-05T04:30:00Z","Europe/Moscow");
 expect("07:30","2026-11-05T04:00:00Z","","2026-11-05","2026-11-06T04:30:00Z","Europe/Moscow");
 expect("07:30","2026-11-06T04:00:00Z","","2026-11-05","2026-11-06T04:30:00Z","Europe/Moscow");
 expect("07:30","2026-11-05T04:00:00Z","2026-11-05","2026-11-06","2026-11-07T04:30:00Z","Europe/Moscow");
 expect("07:30","2026-11-05T04:00:00Z","2026-309","","2026-11-06T04:30:00Z","Europe/Moscow");
 expect("07:30","2026-11-05T04:30:00Z","","","2026-11-06T04:30:00Z","Europe/Moscow");
 expect("00:15","2026-12-31T23:00:00Z","","2026-12-31","2027-01-01T00:15:00Z","UTC");
 expect("07:30","2026-03-28T05:30:00Z","","2026-03-28","2026-03-29T05:30:00Z","Europe/Berlin");
 expect("01:30","2026-11-01T04:30:00Z","","2026-11-01","2026-11-02T06:30:00Z","America/New_York");
 expect("02:30","2026-03-08T05:00:00Z","","2026-03-08","2026-03-09T06:30:00Z","America/New_York");
 expect("07:30","2026-11-04T21:00:00Z","2026-11-05","","2026-11-06T04:30:00Z","Europe/Moscow");
 expect("07:30","2026-11-06T04:00:00Z","2026-11-05","","2026-11-06T04:30:00Z","Europe/Moscow");
 if(SleepTiming.occurrence("07:30","2026-11-05",TimeZone.getTimeZone("Europe/Moscow"))!=at("2026-11-05T04:30:00Z"))throw new AssertionError("skip instant");cases++;
 if(SleepTiming.occurrence("07:30","",TimeZone.getTimeZone("UTC"))!=0)throw new AssertionError("absent skip");cases++;
 System.out.println(cases+" recurrence cases passed: daily, one skip, early wake, legacy date, midnight, year rollover and DST.");
 }
}
