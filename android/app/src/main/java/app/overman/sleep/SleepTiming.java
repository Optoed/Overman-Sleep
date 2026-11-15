package app.overman.sleep;
import java.util.Calendar;
import java.util.TimeZone;

/** Pure timing/activity policy, also exercised without an Android runtime. */
final class SleepTiming {
    static String stamp(Calendar date){return date.get(Calendar.YEAR)+"-"+date.get(Calendar.DAY_OF_YEAR);}
    static String stamp(long at,TimeZone zone){return java.time.Instant.ofEpochMilli(at).atZone(zone.toZoneId()).toLocalDate().toString();}
    static boolean sameDay(String saved,java.time.LocalDate date){return saved.equals(date.toString())||saved.equals(date.getYear()+"-"+date.getDayOfYear());}
    static long occurrence(String clock,String date,TimeZone zone){try{return java.time.LocalDate.parse(date).atTime(java.time.LocalTime.parse(clock)).atZone(zone.toZoneId()).toInstant().toEpochMilli();}catch(RuntimeException invalid){return 0;}}
    static long nextAlarm(String clock,long now,TimeZone zone,String alreadyRang){return nextAlarm(clock,now,zone,alreadyRang,"");}
    static long nextAlarm(String clock,long now,TimeZone zone,String alreadyRang,String skipped){
        java.time.ZoneId id=zone.toZoneId();java.time.LocalDate date=java.time.Instant.ofEpochMilli(now).atZone(id).toLocalDate();java.time.LocalTime time=java.time.LocalTime.parse(clock);
        for(int i=0;i<4;i++,date=date.plusDays(1)){
            long candidate=date.atTime(time).atZone(id).toInstant().toEpochMilli();
            if(candidate>now&&!sameDay(alreadyRang,date)&&!sameDay(skipped,date))return candidate;
        }
        throw new IllegalStateException("Не удалось определить следующий день будильника.");
    }
    static boolean validReminderLead(int minutes){return minutes==5||minutes==10||minutes==15||minutes==20||minutes==30||minutes==45||minutes==60||minutes==90||minutes==120;}
    static final class Reminder {
        final long deadline,bedtime;final String bedDate;
        Reminder(long deadline,long bedtime,String bedDate){this.deadline=deadline;this.bedtime=bedtime;this.bedDate=bedDate;}
    }
    static Reminder nextReminder(String clock,int lead,long now,TimeZone zone,String consumedBedDate){
        if(!validReminderLead(lead))throw new IllegalArgumentException("Выбери напоминание за 5–120 минут из списка.");
        java.time.ZoneId id=zone.toZoneId();java.time.LocalDate date=java.time.Instant.ofEpochMilli(now).atZone(id).toLocalDate();java.time.LocalTime time=java.time.LocalTime.parse(clock);
        for(int i=0;i<4;i++,date=date.plusDays(1)){
            long bedtime=date.atTime(time).atZone(id).toInstant().toEpochMilli(),deadline=bedtime-lead*60000L;
            if(deadline>now&&!sameDay(consumedBedDate,date))return new Reminder(deadline,bedtime,date.toString());
        }
        throw new IllegalStateException("Не удалось определить следующее напоминание.");
    }
    static boolean clockChanged(long startWall,long startElapsed,long nowWall,long nowElapsed){return startElapsed>=0&&nowElapsed>=startElapsed&&Math.abs((nowWall-startWall)-(nowElapsed-startElapsed))>120000L;}
    static final class WakeWindow {
        private int count=0;private long previous=0;
        boolean observe(float change,long now,long started,long deadline,int minutes){
            if(now<deadline-minutes*60000L||now>=deadline||now-started<20*60000L)return false;
            if(change>.35f&&now-previous>3000){count=now-previous<30000?count+1:1;previous=now;}
            return count>=3;
        }
    }
}
