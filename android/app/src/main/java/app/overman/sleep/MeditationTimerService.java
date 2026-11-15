package app.overman.sleep;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.provider.Settings;
import org.json.JSONObject;

/** User-started foreground countdown. Separate storage/channel from all alarms. */
public final class MeditationTimerService extends Service {
 private static final String PREFS="overman_meditation",CHANNEL="overman_meditation_timer";
 private static final int NOTIFICATION=310;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private PowerManager.WakeLock lock;
 private String session="";
 private static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREFS,MODE_PRIVATE);}
 private static int boot(Context c){return Settings.Global.getInt(c.getContentResolver(),Settings.Global.BOOT_COUNT,-1);}
 static JSONObject start(Context c,JSONObject input)throws Exception {
  String id=input.getString("id");long started=input.getLong("started"),now=System.currentTimeMillis();int minutes=input.getInt("minutes");
  if(!id.matches("[0-9a-fA-F-]{36}")||!java.util.UUID.fromString(id).toString().equalsIgnoreCase(id)||Math.abs(now-started)>10000||!(minutes==5||minutes==10||minutes==12||minutes==15||minutes==20)||!(input.opt("quiet") instanceof Boolean))throw new Exception("Проверь параметры медитации.");
  SharedPreferences p=prefs(c);if(p.getBoolean("active",false)&&!id.equals(p.getString("id","")))throw new Exception("На устройстве уже идёт медитация.");
  if(!p.edit().putString("id",id).putLong("started",started).putLong("deadline",started+minutes*60000L).putLong("elapsedEnd",SystemClock.elapsedRealtime()+Math.max(0,started+minutes*60000L-now)).putInt("boot",boot(c)).putBoolean("quiet",input.getBoolean("quiet")).putBoolean("active",true).putBoolean("signalled",false).putBoolean("cancelled",false).commit())throw new Exception("Не удалось сохранить таймер медитации.");
  try{c.startForegroundService(new Intent(c,MeditationTimerService.class));}catch(Exception error){p.edit().putBoolean("active",false).commit();throw error;}
  return new JSONObject().put("scheduled",true).put("id",id);
 }
 static JSONObject cancel(Context c,String id)throws Exception {
  return stop(c,id,false);
 }
 static JSONObject complete(Context c,String id)throws Exception {
  SharedPreferences p=prefs(c);if(!id.equals(p.getString("id",""))||p.getBoolean("cancelled",false)||p.getInt("boot",-1)!=boot(c)||p.getLong("elapsedEnd",Long.MAX_VALUE)>SystemClock.elapsedRealtime())throw new Exception("Системный отсчёт ещё не завершён либо был отменён.");
  return stop(c,id,true);
 }
 private static JSONObject stop(Context c,String id,boolean completed)throws Exception {
  SharedPreferences p=prefs(c);if(!id.equals(p.getString("id",""))){if(p.getBoolean("active",false))throw new Exception("Сеанс медитации изменился.");return new JSONObject().put("cancelled",true);}
  if(!p.edit().putBoolean("active",false).putBoolean("cancelled",!completed).commit())throw new Exception("Не удалось остановить таймер.");
  c.stopService(new Intent(c,MeditationTimerService.class));MeditationCue.stop();((NotificationManager)c.getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIFICATION);
  return new JSONObject().put("cancelled",true);
 }
 static boolean ownsCue(Context c,String id){SharedPreferences p=prefs(c);return id.equals(p.getString("id",""))&&(p.getBoolean("active",false)||p.getBoolean("signalled",false));}
 static void resume(Context c){
  SharedPreferences p=prefs(c);if(!p.getBoolean("active",false))return;
  // A shutdown/reboot does not count as meditation or replay a long-missed cue.
  if(p.getInt("boot",-1)!=boot(c)){p.edit().putBoolean("active",false).commit();return;}
  if(p.getLong("elapsedEnd",0)<SystemClock.elapsedRealtime()-60000){p.edit().putBoolean("active",false).commit();return;}
  try{c.startForegroundService(new Intent(c,MeditationTimerService.class));}catch(Exception ignored){}
 }
 public IBinder onBind(Intent i){return null;}
 private Notification notification(boolean done){
  NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
  NotificationChannel channel=new NotificationChannel(CHANNEL,"Медитация",NotificationManager.IMPORTANCE_LOW);channel.setSound(null,null);channel.enableVibration(false);manager.createNotificationChannel(channel);
  PendingIntent open=PendingIntent.getActivity(this,310,new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification.Builder n=new Notification.Builder(this,CHANNEL).setSmallIcon(app.overman.sleep.R.drawable.ic_moon).setContentTitle(done?"Медитация завершена":"Медитация").setContentText(done?"Мягко возвращайся. Открой Overman, чтобы завершить сеанс.":"Тихая пауза · таймер работает с погашенным экраном").setContentIntent(open).setOngoing(!done).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE);
  if(!done)n.setWhen(prefs(this).getLong("deadline",0)).setUsesChronometer(true).setChronometerCountDown(true);
  return n.build();
 }
 public int onStartCommand(Intent intent,int flags,int startId){
  SharedPreferences p=prefs(this);if(!p.getBoolean("active",false)){stopSelf();return START_NOT_STICKY;}
  session=p.getString("id","");long remaining=Math.max(0,p.getLong("elapsedEnd",0)-SystemClock.elapsedRealtime());
  startForeground(NOTIFICATION,notification(false),Build.VERSION.SDK_INT>=34?ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE:ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
  handler.removeCallbacksAndMessages(null);if(lock!=null&&lock.isHeld())lock.release();
  lock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Overman:meditation");lock.acquire(Math.min(remaining+15000,21*60000));
  handler.postDelayed(()->finishSession(session),remaining);return START_NOT_STICKY;
 }
 private void finishSession(String id){
  SharedPreferences p=prefs(this);if(!id.equals(p.getString("id",""))||!p.getBoolean("active",false)){stopSelf();return;}
  if(!p.edit().putBoolean("active",false).putBoolean("signalled",true).commit()){stopSelf();return;}
  if(!p.getBoolean("quiet",false)){try{MeditationCue.play(this);}catch(Exception error){android.util.Log.w("OvermanMeditation","Completion media unavailable");}}
  ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION,notification(true));
  handler.postDelayed(()->{stopForeground(STOP_FOREGROUND_DETACH);stopSelf();},10000);
 }
 public void onDestroy(){handler.removeCallbacksAndMessages(null);if(lock!=null&&lock.isHeld())lock.release();super.onDestroy();}
}
