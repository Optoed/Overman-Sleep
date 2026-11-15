package app.overman.sleep;
import android.app.*;
import android.content.*;
import android.media.*;
import android.os.*;
public class AlarmService extends Service {
    private MediaPlayer player;private Vibrator vibrator;private PowerManager.WakeLock lock;private boolean outputStarted;
    private String vibrationSession="";private boolean screenOffRegistered;
    private final Handler vibrationHandler=new Handler(Looper.getMainLooper());
    private final Runnable restoreScreenOffVibration=()->{
        if(!outputStarted||!AlarmController.prefs(this).getBoolean("ringing",false)||!vibrationSession.equals(AlarmController.sessionId(this))||!AlarmController.alarm(this).optBoolean("vibration",true))return;
        try{vibrator=AlarmAudio.vibrate(this,true);}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Alarm vibration could not resume after screen off",error);}
    };
    private final BroadcastReceiver screenOffReceiver=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){
            if(!Intent.ACTION_SCREEN_OFF.equals(intent.getAction())||!outputStarted)return;
            // Android cancels active vibrations on an explicit power/sleep key.
            // Resume only this still-unconfirmed alarm, after platform cancellation.
            vibrationHandler.removeCallbacks(restoreScreenOffVibration);
            vibrationHandler.postDelayed(restoreScreenOffVibration,500);
        }
    };
    private void listenForScreenOff(){
        if(screenOffRegistered)return;
        IntentFilter filter=new IntentFilter(Intent.ACTION_SCREEN_OFF);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(screenOffReceiver,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(screenOffReceiver,filter);
        screenOffRegistered=true;
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        String expected=intent==null?null:intent.getStringExtra("receiverSession");
        if(expected!=null&&(!expected.equals(AlarmController.sessionId(this))||!AlarmController.prefs(this).getBoolean("ringing",false))){if(!outputStarted)ignoreStart(id);return outputStarted?START_STICKY:START_NOT_STICKY;}
        if(intent==null&&!AlarmController.prefs(this).getBoolean("ringing",false)){ignoreStart(id);return START_NOT_STICKY;}if(outputStarted)return START_STICKY;AlarmController.ensureSession(this);vibrationSession=AlarmController.sessionId(this);AlarmController.revision(this,AlarmController.prefs(this).edit().putBoolean("ringing",true)).commit();AlarmController.channels(this);PendingIntent screen=PendingIntent.getActivity(this,0,new Intent(this,AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification n=new Notification.Builder(this,"wake_v1").setSmallIcon(app.overman.sleep.R.drawable.ic_moon).setContentTitle("Пора вставать").setContentText("Откройте и удерживайте «Проснуться» 3 секунды.").setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(true).setContentIntent(screen).addAction(app.overman.sleep.R.drawable.ic_moon,"Открыть будильник",screen).setFullScreenIntent(screen,true).build();
        promote(n);outputStarted=true;
        if(AlarmController.alarm(this).optBoolean("vibration",true))try{listenForScreenOff();}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Screen-off vibration listener unavailable",error);}
        lock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Overman:alarm");lock.acquire();
        MeditationCue.stop();
        AlarmAudio.stopPreview();
        try{player=AlarmAudio.play(this,AlarmController.alarm(this),true);}
        catch(Exception error){try{player=AlarmAudio.fallback(this,AlarmController.alarm(this));}catch(Exception unavailable){android.util.Log.e("OvermanAlarm","Alarm audio unavailable",unavailable);}}
        if(AlarmController.alarm(this).optBoolean("vibration",true))vibrator=AlarmAudio.vibrate(this,true);
        return START_STICKY;
    }
    private void promote(Notification notification){
        // Android explicitly permits systemExempted for user alarm clocks holding
        // exact-alarm access, including alarms continued after BOOT_COMPLETED.
        if(Build.VERSION.SDK_INT>=29){
            int type=Build.VERSION.SDK_INT>=34&&AlarmController.exact(this)?android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED:android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            startForeground(200,notification,type);
        }else startForeground(200,notification);
    }
    private void ignoreStart(int id){
        // Even an obsolete startForegroundService delivery must satisfy Android's
        // promotion contract before stopping, otherwise the process can crash later.
        AlarmController.channels(this);
        promote(new Notification.Builder(this,"tracking_v1").setSmallIcon(app.overman.sleep.R.drawable.ic_moon).setContentTitle("Overman").setContentText("Обновление состояния будильника.").setOnlyAlertOnce(true).setSound(null).setOngoing(true).build());
        stopSelfResult(id);
    }
    @Override public void onDestroy(){
        outputStarted=false;vibrationSession="";vibrationHandler.removeCallbacks(restoreScreenOffVibration);
        if(screenOffRegistered){screenOffRegistered=false;try{unregisterReceiver(screenOffReceiver);}catch(IllegalArgumentException ignored){}}
        MediaPlayer oldPlayer=player;player=null;
        if(oldPlayer!=null){try{oldPlayer.stop();}catch(RuntimeException ignored){}try{oldPlayer.release();}catch(RuntimeException error){android.util.Log.w("OvermanAlarm","Player release failed",error);}}
        Vibrator oldVibrator=vibrator;vibrator=null;if(oldVibrator!=null)try{oldVibrator.cancel();}catch(RuntimeException error){android.util.Log.w("OvermanAlarm","Vibration release failed",error);}
        PowerManager.WakeLock oldLock=lock;lock=null;if(oldLock!=null)try{if(oldLock.isHeld())oldLock.release();}catch(RuntimeException error){android.util.Log.w("OvermanAlarm","Wake lock release failed",error);}
        outputStarted=false;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
    @Override public IBinder onBind(Intent i){return null;}
}


