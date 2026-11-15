package app.overman.sleep;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.hardware.*;
import android.media.*;
import android.os.*;

/** Optional amplitude and phone activity. No audio clips and no claimed REM classifier. */
public class TrackingService extends Service implements SensorEventListener {
    static volatile boolean running=false;private SensorManager sensors;private AudioRecord mic;private Thread audioThread;private double powerSum=0;private int sampleCount=0;private long started=0;private float previousMagnitude=0;private PowerManager.WakeLock lock;private final Handler handler=new Handler(Looper.getMainLooper());private final SleepTiming.WakeWindow smartWindow=new SleepTiming.WakeWindow();
    @Override public int onStartCommand(Intent intent,int flags,int id){if(running)return START_NOT_STICKY;AlarmController.channels(this);
        PendingIntent open=PendingIntent.getActivity(this,1,MainActivity.open(this,"sleep"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notice=new Notification.Builder(this,"tracking_v1").setSmallIcon(app.overman.sleep.R.drawable.ic_moon).setContentTitle("Ночь началась").setContentText("Наблюдение включено тобой. Остановить — в приложении.").setContentIntent(open).setOngoing(true).build();
        boolean noise=AlarmController.alarm(this).optBoolean("noise")&&checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED;
        int type=Build.VERSION.SDK_INT>=34?ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE:0;if(noise&&Build.VERSION.SDK_INT>=30)type|=ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        if(Build.VERSION.SDK_INT>=29)startForeground(201,notice,type);else startForeground(201,notice);
        running=true;started=System.currentTimeMillis();powerSum=0;sampleCount=0;AlarmController.prefs(this).edit().remove("noisePower").remove("noiseCount").apply();
        lock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Overman:tracking");lock.acquire(16*3600000L);
        sensors=(SensorManager)getSystemService(SENSOR_SERVICE);Sensor motion=sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);if(motion!=null)sensors.registerListener(this,motion,SensorManager.SENSOR_DELAY_NORMAL);
        if(noise){try{int size=Math.max(4096,AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT));mic=new AudioRecord(MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,size);mic.startRecording();audioThread=new Thread(()->{short[] data=new short[2048];while(running&&mic!=null){int count=mic.read(data,0,data.length);if(count>0){double sum=0;for(int i=0;i<count;i++){double v=data[i]/32768.0;sum+=v*v;}synchronized(this){powerSum+=sum/count;sampleCount++;}if(sampleCount%30==0)persistNoise();}else break;}});audioThread.start();}catch(Exception ignored){}}
        handler.postDelayed(()->stopSelf(),16*3600000L);return START_NOT_STICKY;
    }
    private synchronized void persistNoise(){if(sampleCount>0)AlarmController.prefs(this).edit().putLong("noisePower",Double.doubleToLongBits(Math.max(powerSum,1e-12))).putInt("noiseCount",sampleCount).apply();}
    @Override public void onSensorChanged(SensorEvent event){
        float mag=(float)Math.sqrt(event.values[0]*event.values[0]+event.values[1]*event.values[1]+event.values[2]*event.values[2]);float change=Math.abs(mag-previousMagnitude);previousMagnitude=mag;long now=System.currentTimeMillis();
        if(!AlarmController.alarm(this).optBoolean("smart")||!AlarmController.alarm(this).optBoolean("enabled"))return;
        long deadline=AlarmController.prefs(this).getLong("deadline",0);
        if(smartWindow.observe(change,now,started,deadline,AlarmController.alarm(this).optInt("smartMinutes",20))&&AlarmController.exact(this)){
            // Dispatch through an exact system alarm, preserving its background-start exemption.
            // The original deadline stays armed until this receiver actually fires.
            PendingIntent show=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
            long smartDeadline=now+1000;if(!AlarmController.prefs(this).edit().putLong("smartDeadline",smartDeadline).commit())return;
            getSystemService(AlarmManager.class).setAlarmClock(new AlarmManager.AlarmClockInfo(smartDeadline,show),AlarmController.action(this,"smart",104,smartDeadline));
            stopSelf();
        }
    }
    @Override public void onAccuracyChanged(Sensor s,int accuracy){}
    @Override public void onDestroy(){running=false;handler.removeCallbacksAndMessages(null);if(sensors!=null)sensors.unregisterListener(this);if(mic!=null){try{mic.stop();}catch(Exception ignored){}if(audioThread!=null)try{audioThread.join(1000);}catch(Exception ignored){}mic.release();mic=null;}persistNoise();if(lock!=null&&lock.isHeld())lock.release();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}
