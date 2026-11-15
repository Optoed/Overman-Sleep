package app.overman.sleep;

import android.app.*;
import android.content.*;
import android.os.Build;
import org.json.*;
import java.util.Calendar;

/** System scheduling stays independent of the WebView lifetime. */
final class AlarmController {
    static final String PREFS="overman_device";
    static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    static JSONObject config(Context c){try{return new JSONObject(prefs(c).getString("config","{}"));}catch(Exception e){return new JSONObject();}}
    static JSONObject alarm(Context c){return config(c).optJSONObject("alarm")==null?new JSONObject():config(c).optJSONObject("alarm");}
    static String sessionId(JSONObject night){if(night==null)return "";return night.optString("id","").isEmpty()?"legacy-"+night.optLong("started"):night.optString("id");}
    static JSONObject night(Context c){try{return new JSONObject(prefs(c).getString("wakeNight","{}"));}catch(Exception e){return new JSONObject();}}
    static String sessionId(Context c){return prefs(c).contains("wakeNight")?sessionId(night(c)):"";}
    static android.content.SharedPreferences.Editor revision(Context c,android.content.SharedPreferences.Editor edit){return edit.putLong("sessionRevision",prefs(c).getLong("sessionRevision",0)+1);}
    static void commitSession(Context c,android.content.SharedPreferences.Editor edit,String error){
        android.content.SharedPreferences p=prefs(c);java.util.Map<String,?> before=p.getAll();
        if(edit.commit())return;
        android.content.SharedPreferences.Editor rollback=p.edit();
        for(String key:new String[]{"config","wakeNight","wokeAt","wakeEventId","wakeAck","lastEndedSession","sessionRevision","startElapsed","startBoot","timeChanged","wakeOffset","lastAlarmDate","skippedAlarmDate","skippedAlarmClock","ringOccurrence","ringingWithPendingMorning","reminderDeadline","reminderBedtime","reminderBedDate","lastReminderBedDate","lastReminderAt","lastReminderOutcome","reminderPlanKey"}){Object value=before.get(key);if(value==null)rollback.remove(key);else if(value instanceof Long)rollback.putLong(key,(Long)value);else if(value instanceof Integer)rollback.putInt(key,(Integer)value);else if(value instanceof Boolean)rollback.putBoolean(key,(Boolean)value);else rollback.putString(key,(String)value);}
        rollback.commit();throw new IllegalStateException(error);
    }
    static void requireSession(Context c,String expected){if(expected==null||expected.isEmpty()||!expected.equals(sessionId(c)))throw new IllegalStateException("Эта ночь уже изменилась. Обнови состояние приложения и повтори.");}
    static int boot(Context c){return android.provider.Settings.Global.getInt(c.getContentResolver(),"boot_count",-1);}
    static boolean clockChanged(Context c){return prefs(c).getBoolean("timeChanged",false)||(prefs(c).getInt("startBoot",-2)==boot(c)&&SleepTiming.clockChanged(night(c).optLong("started"),prefs(c).getLong("startElapsed",-1),System.currentTimeMillis(),android.os.SystemClock.elapsedRealtime()));}
    static void startSession(Context c,JSONObject active,String previous) throws JSONException {
        if(active==null||!Double.isFinite(active.optDouble("started",Double.NaN))||active.optDouble("started")!=active.optLong("started")||active.optLong("started")>System.currentTimeMillis()+60000L||active.optLong("started",-1)<0||active.optJSONObject("target")==null||!sessionId(active).matches("[A-Za-z0-9-]{1,80}"))throw new IllegalStateException("Неверная сессия сна.");
        JSONObject goal=active.getJSONObject("target");String bed=goal.optString("bed"),wake=goal.optString("wake");double hours=goal.optDouble("hours",Double.NaN);int tolerance=goal.optInt("tolerance",-1);
        if(!bed.matches("([01][0-9]|2[0-3]):[0-5][0-9]")||!wake.matches("([01][0-9]|2[0-3]):[0-5][0-9]")||!Double.isFinite(hours)||hours<4||hours>12||(tolerance!=30&&tolerance!=45&&tolerance!=60))throw new IllegalStateException("Неверный режим сна.");
        int duration=(Integer.parseInt(wake.substring(0,2))*60+Integer.parseInt(wake.substring(3))-Integer.parseInt(bed.substring(0,2))*60-Integer.parseInt(bed.substring(3))+1440)%1440;if(duration<hours*60||duration>960)throw new IllegalStateException("Неверный режим сна.");
        if(active.has("bedOffset")&&(!Double.isFinite(active.optDouble("bedOffset"))||Math.rint(active.optDouble("bedOffset"))!=active.optDouble("bedOffset")||Math.abs(active.optDouble("bedOffset"))>840))throw new IllegalStateException("Неверный часовой пояс.");
        String current=sessionId(c),next=sessionId(active);
        if(current.equals(next)){
            if(night(c).optLong("started")!=active.optLong("started")||!night(c).getJSONObject("target").toString().equals(active.getJSONObject("target").toString()))throw new IllegalStateException("Данные этой ночи не совпадают.");
            return;
        }
        if(prefs(c).getBoolean("ringing",false))throw new IllegalStateException("Сначала удерживай «Проснуться» 3 секунды.");
        if(!current.equals(previous))throw new IllegalStateException("Эта ночь уже изменилась. Обнови состояние приложения и повтори.");
        if(!current.isEmpty()&&prefs(c).getLong("wokeAt",0)>0&&!eventId(c).equals(prefs(c).getString("wakeAck","")))throw new IllegalStateException("Сначала сохрани подтверждённый подъём предыдущей ночи.");
        if(!active.has("bedOffset"))active.put("bedOffset",java.util.TimeZone.getDefault().getOffset(active.getLong("started"))/60000);
        long elapsed=android.os.SystemClock.elapsedRealtime()-(System.currentTimeMillis()-active.getLong("started"));if(elapsed<0)elapsed=-1;
        commitSession(c,revision(c,prefs(c).edit().putString("wakeNight",active.toString()).putLong("startElapsed",elapsed).putInt("startBoot",boot(c)).remove("timeChanged").remove("wakeOffset").remove("wokeAt").remove("wakeEventId").remove("wakeAck")),"Не удалось сохранить начало ночи. Освободи место и повтори.");
    }
    static void ensureSession(Context c){if(!sessionId(c).isEmpty())return;try{
        JSONObject target=config(c).optJSONObject("schedule");if(target==null)throw new IllegalStateException("Режим сна не настроен.");
        Calendar bed=Calendar.getInstance();String[] clock=target.optString("bed","23:00").split(":");bed.set(Calendar.HOUR_OF_DAY,Integer.parseInt(clock[0]));bed.set(Calendar.MINUTE,Integer.parseInt(clock[1]));bed.set(Calendar.SECOND,0);bed.set(Calendar.MILLISECOND,0);if(bed.getTimeInMillis()>System.currentTimeMillis())bed.add(Calendar.DATE,-1);
        startSession(c,new JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("started",bed.getTimeInMillis()).put("target",target),"");
    }catch(JSONException e){throw new IllegalStateException("Не удалось создать сессию будильника.",e);}}
    static String eventId(Context c){long wake=prefs(c).getLong("wokeAt",0);return wake==0?"":prefs(c).getString("wakeEventId","wake-"+sessionId(c)+"-"+wake);}
    static void acknowledgeWake(Context c,String session,String event){requireSession(c,session);if(event.isEmpty()||!event.equals(eventId(c)))throw new IllegalStateException("Подтверждение относится к другому подъёму.");if(event.equals(prefs(c).getString("wakeAck","")))return;commitSession(c,revision(c,prefs(c).edit().putString("wakeAck",event)),"Не удалось подтвердить доставку подъёма. Повтори синхронизацию.");}
    static void stopSession(Context c,String expected){
        if(prefs(c).getBoolean("ringing",false))throw new IllegalStateException("Для остановки сигнала удерживай «Проснуться» 3 секунды.");
        String current=sessionId(c);if(current.isEmpty()){if(expected.isEmpty()||expected.equals(prefs(c).getString("lastEndedSession","")))return;throw new IllegalStateException("Эта ночь уже изменилась.");}
        requireSession(c,expected);
        commitSession(c,revision(c,prefs(c).edit().putString("lastEndedSession",current).remove("wakeNight").remove("wokeAt").remove("wakeEventId").remove("wakeAck").remove("startElapsed").remove("startBoot").remove("timeChanged").remove("wakeOffset")),"Не удалось завершить сессию на устройстве. Повтори действие.");
        c.stopService(new Intent(c,TrackingService.class));c.stopService(new Intent(c,AlarmService.class));
    }
    static boolean fullScreen(Context c){return Build.VERSION.SDK_INT<34||c.getSystemService(NotificationManager.class).canUseFullScreenIntent();}
    static boolean exact(Context c){return Build.VERSION.SDK_INT<31||c.getSystemService(AlarmManager.class).canScheduleExactAlarms();}
    static long next(String clock){return SleepTiming.nextAlarm(clock,System.currentTimeMillis(),java.util.TimeZone.getDefault(),"");}
    static PendingIntent action(Context c,String action,int code){return PendingIntent.getBroadcast(c,code,new Intent(c,AlarmReceiver.class).setAction(action),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static PendingIntent action(Context c,String action,int code,long deadline){return PendingIntent.getBroadcast(c,code,new Intent(c,AlarmReceiver.class).setAction(action).putExtra("alarmDeadline",deadline),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static long deliveryDeadline(Context c,String action){return prefs(c).getLong("wake".equals(action)?"deadline":action+"Deadline",0);}
    static void schedule(Context c){
        try{scheduleReminder(c);}catch(RuntimeException error){prefs(c).edit().putString("reminderError","Не удалось поставить напоминание. Сохрани режим ещё раз.").commit();android.util.Log.e("OvermanAlarm","Reminder schedule failed independently of wake alarm",error);}
        AlarmManager manager=c.getSystemService(AlarmManager.class);JSONObject root=config(c),settings=alarm(c),schedule=root.optJSONObject("schedule");
        manager.cancel(action(c,"wake",100));manager.cancel(action(c,"snooze",103));manager.cancel(action(c,"smart",104));cancelResume(c);
        if(!prefs(c).edit().remove("deadline").remove("schedulingError").remove("smartDeadline").remove("snoozeDeadline").commit())throw new IllegalStateException("Не удалось сохранить состояние будильника. Повтори сохранение режима.");
        if(schedule==null)return;
        if(settings.optBoolean("enabled")&&exact(c)){
            long deadline=SleepTiming.nextAlarm(schedule.optString("wake","07:30"),System.currentTimeMillis(),java.util.TimeZone.getDefault(),prefs(c).getString("lastAlarmDate",""),skipDate(c));
            try{
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(deadline,PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE)),action(c,"wake",100,deadline));
                if(!prefs(c).edit().putLong("deadline",deadline).commit()){manager.cancel(action(c,"wake",100));prefs(c).edit().remove("deadline").commit();throw new IllegalStateException("Не удалось подтвердить сохранение будильника.");}
            }catch(RuntimeException error){prefs(c).edit().remove("deadline").putString("schedulingError","Не удалось поставить сигнал. Сохрани режим ещё раз.").commit();throw error;}
        }
    }
    static boolean reminderNotifications(Context c){
        NotificationManager manager=c.getSystemService(NotificationManager.class);NotificationChannel channel=manager.getNotificationChannel("reminders_v1");
        return manager.areNotificationsEnabled()&&(channel==null||channel.getImportance()!=NotificationManager.IMPORTANCE_NONE);
    }
    static void scheduleReminder(Context c){
        AlarmManager manager=c.getSystemService(AlarmManager.class);
        long savedAt=prefs(c).getLong("reminderDeadline",0),savedBedtime=prefs(c).getLong("reminderBedtime",0);String savedDate=prefs(c).getString("reminderBedDate",""),savedKey=prefs(c).getString("reminderPlanKey","");
        manager.cancel(action(c,"remind",101));
        if(!prefs(c).edit().remove("reminderDeadline").remove("reminderBedtime").remove("reminderBedDate").remove("reminderPlanKey").remove("reminderError").commit())throw new IllegalStateException("Не удалось сохранить состояние напоминания.");
        JSONObject target=config(c).optJSONObject("schedule"),settings=alarm(c);
        if(target==null||!settings.optBoolean("reminder")||!reminderNotifications(c)){if(!settings.optBoolean("reminder"))c.getSystemService(NotificationManager.class).cancel(300);return;}
        String key=target.optString("bed","23:00")+"/"+settings.optInt("reminderMinutes",30)+"/"+java.util.TimeZone.getDefault().getID();
        // Inexact delivery may still be pending after the requested minute. Reopen,
        // boot or permission refresh must not silently postpone it to tomorrow.
        SleepTiming.Reminder next=savedAt>0&&savedBedtime>System.currentTimeMillis()&&key.equals(savedKey)&&!savedDate.equals(prefs(c).getString("lastReminderBedDate",""))?new SleepTiming.Reminder(savedAt,savedBedtime,savedDate):SleepTiming.nextReminder(target.optString("bed","23:00"),settings.optInt("reminderMinutes",30),System.currentTimeMillis(),java.util.TimeZone.getDefault(),prefs(c).getString("lastReminderBedDate",""));
        try{
            if(!prefs(c).edit().putLong("reminderDeadline",next.deadline).putLong("reminderBedtime",next.bedtime).putString("reminderBedDate",next.bedDate).putString("reminderPlanKey",key).commit())throw new IllegalStateException("Не удалось сохранить срок напоминания.");
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next.deadline,action(c,"remind",101,next.deadline));
        }catch(RuntimeException error){manager.cancel(action(c,"remind",101));prefs(c).edit().remove("reminderDeadline").putString("reminderError","Не удалось поставить напоминание. Сохрани режим ещё раз.").commit();throw error;}
    }
    static void deliverReminder(Context c,Intent intent){
        android.content.SharedPreferences p=prefs(c);long planned=p.getLong("reminderDeadline",0),now=System.currentTimeMillis(),bedtime=p.getLong("reminderBedtime",0);
        if(!AlarmDeliveryPolicy.reminder(planned,intent.getLongExtra("alarmDeadline",0),now,alarm(c).optBoolean("reminder")))return;
        String bedDate=p.getString("reminderBedDate","");
        if(bedDate.isEmpty()||bedDate.equals(p.getString("lastReminderBedDate","")))return;
        String outcome=!reminderNotifications(c)?"permission_required":now>=bedtime?"late":p.getBoolean("ringing",false)||(!sessionId(c).isEmpty()&&p.getLong("wokeAt",0)==0)?"sleeping":"notified";
        try{
            commitSession(c,p.edit().putString("lastReminderBedDate",bedDate).putLong("lastReminderAt",now).putString("lastReminderOutcome","notified".equals(outcome)?"posting":outcome).remove("reminderDeadline"),"Не удалось сохранить доставку напоминания.");
            if("notified".equals(outcome)){
                PendingIntent open=PendingIntent.getActivity(c,301,MainActivity.open(c,"sleep"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                c.getSystemService(NotificationManager.class).notify(300,new Notification.Builder(c,"reminders_v1").setSmallIcon(app.overman.sleep.R.drawable.ic_moon).setContentTitle("Скоро пора спать").setContentText("По плану ты ложишься в "+config(c).optJSONObject("schedule").optString("bed")+". Начинай готовиться ко сну.").setCategory(Notification.CATEGORY_REMINDER).setContentIntent(open).setAutoCancel(true).build());
                p.edit().putString("lastReminderOutcome","notified").commit();
            }
        }catch(RuntimeException error){p.edit().putString("lastReminderOutcome","failed").commit();android.util.Log.e("OvermanAlarm","Reminder delivery failed",error);}
        finally{try{scheduleReminder(c);}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Next reminder could not be scheduled",error);}}
    }
    static void resumeAfterBoot(Context c){
        // Exact user-alarm delivery may start media playback; BOOT_COMPLETED itself
        // may not start that foreground-service type on Android 15.
        if(!prefs(c).getBoolean("ringing",false)||(prefs(c).getLong("wokeAt",0)>0&&!prefs(c).getBoolean("ringingWithPendingMorning",false))||!exact(c)||sessionId(c).isEmpty())return;
        long at=System.currentTimeMillis()+1500;
        if(!prefs(c).edit().putLong("resumeDeadline",at).commit())throw new IllegalStateException("Не удалось восстановить звучащий будильник.");
        Intent intent=new Intent(c,AlarmReceiver.class).setAction("resume").putExtra("alarmDeadline",at).putExtra("receiverSession",sessionId(c));
        PendingIntent pending=PendingIntent.getBroadcast(c,105,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        c.getSystemService(AlarmManager.class).setAlarmClock(new AlarmManager.AlarmClockInfo(at,PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE)),pending);
    }
    static void cancelResume(Context c){
        c.getSystemService(AlarmManager.class).cancel(action(c,"resume",105));prefs(c).edit().remove("resumeDeadline").commit();
    }
    static String skipDate(Context c){return prefs(c).getString("skippedAlarmClock","").equals(config(c).optJSONObject("schedule")==null?"":config(c).optJSONObject("schedule").optString("wake"))?prefs(c).getString("skippedAlarmDate",""):"";}
    static long skippedAt(Context c){JSONObject target=config(c).optJSONObject("schedule");long at=target==null?0:SleepTiming.occurrence(target.optString("wake"),skipDate(c),java.util.TimeZone.getDefault());return at>0&&SleepTiming.sameDay(prefs(c).getString("lastAlarmDate",""),java.time.Instant.ofEpochMilli(at).atZone(java.util.TimeZone.getDefault().toZoneId()).toLocalDate())?0:at;}
    static void changeSkip(Context c,boolean restore,long expected){
        if(prefs(c).getBoolean("ringing",false))throw new IllegalStateException("Сначала удерживай «Проснуться» 3 секунды.");
        if(!alarm(c).optBoolean("enabled")||!exact(c))throw new IllegalStateException("Включи будильник и разреши точные сигналы.");
        long now=System.currentTimeMillis(),skipped=skippedAt(c),deadline=prefs(c).getLong("deadline",0);
        if((restore?(skipped<=now||skipped!=expected):(skipped>now||deadline<=now||deadline!=expected)))throw new IllegalStateException("Ближайший сигнал уже изменился. Проверь время и повтори.");
        android.content.SharedPreferences.Editor edit=revision(c,prefs(c).edit());
        if(restore)edit.remove("skippedAlarmDate").remove("skippedAlarmClock");
        else edit.putString("skippedAlarmDate",SleepTiming.stamp(deadline,java.util.TimeZone.getDefault())).putString("skippedAlarmClock",config(c).optJSONObject("schedule").optString("wake"));
        commitSession(c,edit,"Не удалось сохранить пропуск сигнала. Повтори действие.");schedule(c);
    }
    static void markWake(Context c,long at){prefs(c).edit().putString("lastAlarmDate",SleepTiming.stamp(at,java.util.TimeZone.getDefault())).commit();}
    static void finishWake(Context c){finishWake(c,sessionId(c));}
    static void finishWake(Context c,String expected){finishWake(c,expected,0);}
    static void finishWake(Context c,String expected,long occurrence){
        requireSession(c,expected);
        if(prefs(c).getBoolean("ringing",false)&&prefs(c).getBoolean("ringingWithPendingMorning",false)&&occurrence!=prefs(c).getLong("ringOccurrence",0))throw new IllegalStateException("Этот сигнал уже изменился. Удержи кнопку заново.");
        long wokeAt=prefs(c).getLong("wokeAt",0);
        if(wokeAt==0)wokeAt=System.currentTimeMillis();
        android.content.SharedPreferences p=prefs(c);long previous=p.getLong("wokeAt",0);boolean ringing=p.getBoolean("ringing",false);
        boolean previousReview=p.getBoolean("timeChanged",false);int previousOffset=p.getInt("wakeOffset",9999);
        String previousEvent=p.getString("wakeEventId",null);long previousRevision=p.getLong("sessionRevision",0);
        String lastDate=p.getString("lastAlarmDate","");
        String consumed=lastDate;
        if(previous==0&&!ringing){JSONObject target=night(c).optJSONObject("target");if(target!=null)consumed=SleepTiming.stamp(SleepTiming.nextAlarm(target.optString("wake"),night(c).optLong("started"),java.util.TimeZone.getDefault(),""),java.util.TimeZone.getDefault());}
        boolean previousPending=p.getBoolean("ringingWithPendingMorning",false);
        String event=previous>0?eventId(c):"wake-"+expected+"-"+wokeAt;
        if(!revision(c,p.edit().putLong("wokeAt",wokeAt).putInt("wakeOffset",previousOffset==9999?java.util.TimeZone.getDefault().getOffset(wokeAt)/60000:previousOffset).putBoolean("timeChanged",previous>0?previousReview:previousReview||clockChanged(c)||wokeAt<night(c).optLong("started")).putString("wakeEventId",event).putString("lastAlarmDate",consumed).putBoolean("ringingWithPendingMorning",false).putBoolean("ringing",false)).commit()){
            // SharedPreferences updates its in-memory map even when its disk write fails.
            android.content.SharedPreferences.Editor rollback=p.edit().putBoolean("ringing",ringing);
            if(previous>0)rollback.putLong("wokeAt",previous);else rollback.remove("wokeAt");if(previousEvent==null)rollback.remove("wakeEventId");else rollback.putString("wakeEventId",previousEvent);if(previousOffset==9999)rollback.remove("wakeOffset");else rollback.putInt("wakeOffset",previousOffset);rollback.putString("lastAlarmDate",lastDate).putBoolean("ringingWithPendingMorning",previousPending);rollback.putBoolean("timeChanged",previousReview).putLong("sessionRevision",previousRevision).commit();
            throw new IllegalStateException("Не удалось сохранить время подъёма. Сигнал продолжает звучать. Освободите место и повторите удержание.");
        }
        try{cancelResume(c);}catch(RuntimeException error){android.util.Log.w("OvermanAlarm","Resume cancellation failed after saved wake",error);}
        c.stopService(new Intent(c,AlarmService.class));c.stopService(new Intent(c,TrackingService.class));
        try{schedule(c);}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Next daily alarm after wake could not be scheduled",error);}
    }
    static void snooze(Context c){if(!exact(c))return;long deadline=System.currentTimeMillis()+300000;if(!prefs(c).edit().putLong("snoozeDeadline",deadline).commit())throw new IllegalStateException("Не удалось сохранить повтор сигнала.");c.getSystemService(AlarmManager.class).setAlarmClock(new AlarmManager.AlarmClockInfo(deadline,PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_IMMUTABLE)),action(c,"snooze",103,deadline));}
    static void channels(Context c){
        NotificationManager m=c.getSystemService(NotificationManager.class);
        NotificationChannel wake=new NotificationChannel("wake_v1","Будильник",NotificationManager.IMPORTANCE_HIGH);wake.setSound(null,null);wake.enableVibration(false);wake.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);m.createNotificationChannel(wake);
        m.createNotificationChannel(new NotificationChannel("tracking_v1","Ночное наблюдение",NotificationManager.IMPORTANCE_LOW));m.createNotificationChannel(new NotificationChannel("reminders_v1","Вечерние напоминания",NotificationManager.IMPORTANCE_DEFAULT));
    }
    static JSONObject status(Context c) throws JSONException {
        JSONObject s=new JSONObject();AlarmAudio.status(c,s);
        boolean reminder=alarm(c).optBoolean("reminder"),reminderAllowed=reminderNotifications(c);long reminderAt=prefs(c).getLong("reminderDeadline",0),reminderBedtime=prefs(c).getLong("reminderBedtime",0);
        s.put("reminderNotifications",reminderAllowed);s.put("reminderScheduleState",!reminder?"off":!reminderAllowed?"permission_required":reminderAt>0&&reminderBedtime>System.currentTimeMillis()?"scheduled":"not_scheduled");s.put("reminderTimeZone",java.util.TimeZone.getDefault().getID());if(reminder&&reminderAllowed&&reminderAt>0&&reminderBedtime>System.currentTimeMillis()){s.put("nextReminderAt",reminderAt);s.put("reminderBedtimeAt",reminderBedtime);}if(prefs(c).contains("reminderError"))s.put("reminderScheduleError",prefs(c).getString("reminderError",""));s.put("native",true);s.put("fullScreen",fullScreen(c));s.put("exact",exact(c));s.put("notifications",c.getSystemService(NotificationManager.class).areNotificationsEnabled());s.put("microphone",c.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED);s.put("tracking",TrackingService.running);
        if(!sessionId(c).isEmpty())s.put("activeNight",night(c));s.put("clockChanged",clockChanged(c));if(prefs(c).contains("wakeOffset"))s.put("wakeOffset",prefs(c).getInt("wakeOffset",0));s.put("protocolVersion",2);s.put("sessionId",sessionId(c));s.put("revision",prefs(c).getLong("sessionRevision",0));
        String event=eventId(c);if(!event.isEmpty()&&!event.equals(prefs(c).getString("wakeAck","")))s.put("wakeEvent",new JSONObject().put("id",event).put("sessionId",sessionId(c)).put("wokeAt",prefs(c).getLong("wokeAt",0)));
        s.put("alarmOccurrence",prefs(c).getLong("ringOccurrence",0));s.put("pendingMorningAlarm",prefs(c).getBoolean("ringingWithPendingMorning",false));s.put("ringing",prefs(c).getBoolean("ringing",false));long wokeAt=prefs(c).getLong("wokeAt",0);if(wokeAt>0){s.put("wokeAt",wokeAt);String night=prefs(c).getString("wakeNight","");if(!night.isEmpty())try{s.put("wakeNight",new JSONObject(night));}catch(JSONException ignored){}}
        boolean enabled=alarm(c).optBoolean("enabled");long deadline=prefs(c).getLong("deadline",0);
        String scheduleState=!enabled?"off":(!exact(c)||!s.getBoolean("notifications"))?"permission_required":deadline>System.currentTimeMillis()?"scheduled":"not_scheduled";
        s.put("alarmScheduleState",scheduleState);s.put("alarmTimeZone",java.util.TimeZone.getDefault().getID());
        if("scheduled".equals(scheduleState))s.put("nextAlarmAt",deadline);
        long skipped=skippedAt(c);if(skipped>System.currentTimeMillis())s.put("skippedAlarmAt",skipped);
        s.put("alarmRepeatsDaily",true);
        if("scheduled".equals(scheduleState)){
            java.time.LocalDate tomorrow=java.time.Instant.ofEpochMilli(System.currentTimeMillis()).atZone(java.util.TimeZone.getDefault().toZoneId()).toLocalDate().plusDays(1);
            boolean tomorrowOn=!SleepTiming.sameDay(skipDate(c),tomorrow)&&!SleepTiming.sameDay(prefs(c).getString("lastAlarmDate",""),tomorrow);
            s.put("tomorrowAlarmEnabled",tomorrowOn);s.put("alarmClock",config(c).optJSONObject("schedule").optString("wake"));
        }
        if(prefs(c).contains("schedulingError"))s.put("alarmScheduleError",prefs(c).getString("schedulingError",""));
        int count=prefs(c).getInt("noiseCount",0);if(count>0)s.put("noiseDbfs",Math.max(-120,Math.min(0,10*Math.log10(Double.longBitsToDouble(prefs(c).getLong("noisePower",Double.doubleToLongBits(0)))/count))));return s;
    }
}
