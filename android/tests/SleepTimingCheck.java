package app.overman.sleep;
import java.util.*;
import java.time.*;
public class SleepTimingCheck {
    public static void main(String[] args){
        TimeZone zone=TimeZone.getTimeZone("Europe/Moscow");long now=ZonedDateTime.of(2026,11,1,6,0,0,0,ZoneId.of("Europe/Moscow")).toInstant().toEpochMilli();
        long next=SleepTiming.nextAlarm("07:30",now,zone,"");assert next-now==90*60000L;
        Calendar date=Calendar.getInstance(zone);date.setTimeInMillis(now);
        long tomorrow=SleepTiming.nextAlarm("07:30",now,zone,SleepTiming.stamp(date));assert tomorrow-next==24*3600000L;
        assert SleepTiming.nextAlarm("07:30",next,zone,"")>next;
        TimeZone berlin=TimeZone.getTimeZone("Europe/Berlin");long before=ZonedDateTime.of(2026,3,28,8,0,0,0,ZoneId.of("Europe/Berlin")).toInstant().toEpochMilli();
        Calendar dst=Calendar.getInstance(berlin);dst.setTimeInMillis(SleepTiming.nextAlarm("07:30",before,berlin,""));assert dst.get(Calendar.DAY_OF_MONTH)==29&&dst.get(Calendar.HOUR_OF_DAY)==7&&dst.get(Calendar.MINUTE)==30;
        TimeZone ny=TimeZone.getTimeZone("America/New_York");
        assert SleepTiming.nextAlarm("01:30",Instant.parse("2026-11-01T04:30:00Z").toEpochMilli(),ny,"")==Instant.parse("2026-11-01T05:30:00Z").toEpochMilli();
        assert SleepTiming.nextAlarm("02:30",Instant.parse("2026-03-08T05:00:00Z").toEpochMilli(),ny,"")==Instant.parse("2026-03-08T07:30:00Z").toEpochMilli();
        assert SleepTiming.nextAlarm("00:15",Instant.parse("2026-12-31T23:30:00Z").toEpochMilli(),TimeZone.getTimeZone("UTC"),"")==Instant.parse("2027-01-01T00:15:00Z").toEpochMilli();
        TimeZone lordHowe=TimeZone.getTimeZone("Australia/Lord_Howe");
        assert SleepTiming.nextAlarm("01:45",Instant.parse("2026-04-04T13:00:00Z").toEpochMilli(),lordHowe,"")==Instant.parse("2026-04-04T14:45:00Z").toEpochMilli();
        assert SleepTiming.nextAlarm("02:15",Instant.parse("2026-10-03T13:00:00Z").toEpochMilli(),lordHowe,"")==Instant.parse("2026-10-03T15:45:00Z").toEpochMilli();
        assert SleepTiming.nextAlarm("07:30",Instant.parse("2028-02-29T17:45:00Z").toEpochMilli(),TimeZone.getTimeZone("Asia/Kathmandu"),"")==Instant.parse("2028-03-01T01:45:00Z").toEpochMilli();
        assert !SleepTiming.clockChanged(1000,5000,1000+8*3600000,5000+8*3600000);
        assert SleepTiming.clockChanged(1000,5000,1000+8*3600000+180000,5000+8*3600000);
        assert SleepTiming.clockChanged(1000,5000,1000+8*3600000-180000,5000+8*3600000);
        assert !SleepTiming.clockChanged(1000,-1,99999999,5000);
        long deadline=now+8*3600000L,start=now;
        SleepTiming.WakeWindow window=new SleepTiming.WakeWindow();assert !window.observe(2,deadline-21*60000L,start,deadline,20);assert !window.observe(.1f,deadline-19*60000L,start,deadline,20);
        assert !window.observe(1,deadline-18*60000L,start,deadline,20);assert !window.observe(1,deadline-18*60000L+4000,start,deadline,20);assert window.observe(1,deadline-18*60000L+8000,start,deadline,20);
        assert !new SleepTiming.WakeWindow().observe(2,deadline,start,deadline,20);
        assert !new SleepTiming.WakeWindow().observe(2,deadline-1000,deadline-2*60000,deadline,20);
        System.out.println("Android timing: next-day alarms, same-morning duplicate prevention, DST gaps/overlaps, year rollover, clock adjustment detection, smart window and calibration checks passed.");
    }
}
