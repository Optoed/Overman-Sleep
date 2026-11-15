package app.overman.sleep;
import android.content.Context;
import android.media.*;
import android.os.*;
import org.json.*;

/** Preview and wake use the same packaged tone, alarm route and gain. */
final class AlarmAudio {
    private static MediaPlayer preview;private static Vibrator previewVibrator;
    private static final Handler timer=new Handler(Looper.getMainLooper());
    private static String previewTone="";
    static AudioAttributes attributes(){return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();}
    static boolean hasVibrator(Context c){Vibrator v=c.getSystemService(Vibrator.class);return v!=null&&v.hasVibrator();}
    static int systemVolume(Context c){return c.getSystemService(AudioManager.class).getStreamVolume(AudioManager.STREAM_ALARM);}
    static void requireAudible(Context c,JSONObject settings){
        if(!java.util.Arrays.asList("dawn","bell","birds").contains(settings.optString("ringtone","dawn")))throw new IllegalArgumentException("Неизвестная мелодия.");
        String error=AlarmSoundPolicy.error(settings.optBoolean("enabled"),settings.optDouble("volume",.6),systemVolume(c),settings.optBoolean("vibration",true),hasVibrator(c));
        if("invalid_volume".equals(error))throw new IllegalArgumentException("Неверная громкость.");
        if(error!=null)throw new IllegalStateException("system_silent".equals(error)?"Громкость будильника Android выключена. Увеличь её в настройках звука или включи доступную вибрацию.":"Увеличь громкость или включи доступную вибрацию для будильника.");
    }
    static MediaPlayer play(Context c,JSONObject settings,boolean loop) throws Exception {
        String tone=settings.optString("ringtone","dawn");if(!java.util.Arrays.asList("dawn","bell","birds").contains(tone))throw new IllegalArgumentException("Неизвестная мелодия.");
        float volume=(float)settings.optDouble("volume",.6);if(!Float.isFinite(volume)||volume<0||volume>1)throw new IllegalArgumentException("Неверная громкость.");
        MediaPlayer p=new MediaPlayer();
        try{
            p.setAudioAttributes(attributes());int res=c.getResources().getIdentifier(tone,"raw",c.getPackageName());
            try(android.content.res.AssetFileDescriptor file=c.getResources().openRawResourceFd(res)){p.setDataSource(file.getFileDescriptor(),file.getStartOffset(),file.getLength());}
            p.setLooping(loop);p.setVolume(volume,volume);p.prepare();p.start();return p;
        }catch(Exception error){p.release();throw error;}
    }
    static MediaPlayer fallback(Context c,JSONObject settings) throws Exception {
        MediaPlayer p=new MediaPlayer();try{p.setAudioAttributes(attributes());p.setDataSource(c,android.provider.Settings.System.DEFAULT_ALARM_ALERT_URI);p.setLooping(true);float gain=(float)settings.optDouble("volume",.6);p.setVolume(gain,gain);p.prepare();p.start();return p;}catch(Exception error){p.release();throw error;}
    }
    static Vibrator vibrate(Context c,boolean repeat){Vibrator v=c.getSystemService(Vibrator.class);if(v!=null&&v.hasVibrator())v.vibrate(VibrationEffect.createWaveform(new long[]{0,500,600,500,1500},repeat?0:-1),attributes());return v;}
    static void stopPreview(){timer.removeCallbacksAndMessages(null);if(preview!=null){try{preview.stop();}catch(Exception ignored){}preview.release();preview=null;}if(previewVibrator!=null){previewVibrator.cancel();previewVibrator=null;}previewTone="";}
    static void preview(Context c,JSONObject settings) throws Exception {
        if(AlarmController.prefs(c).getBoolean("ringing",false))throw new IllegalStateException("Сначала удерживай «Проснуться» 3 секунды.");
        stopPreview();try{preview=play(c,settings,false);previewTone=settings.optString("ringtone","dawn");
            if(settings.optBoolean("vibration",true))previewVibrator=vibrate(c,false);
            timer.postDelayed(AlarmAudio::stopPreview,4200);
        }catch(Exception error){stopPreview();throw new IllegalStateException("Не удалось прослушать мелодию. Проверь громкость Android и повтори.",error);}
    }
    static void status(Context c,JSONObject s) throws JSONException {s.put("alarmSystemVolume",systemVolume(c));s.put("alarmSystemVolumeMax",c.getSystemService(AudioManager.class).getStreamMaxVolume(AudioManager.STREAM_ALARM));s.put("vibrationAvailable",hasVibrator(c));boolean playing=false;try{playing=preview!=null&&preview.isPlaying();}catch(Exception ignored){}s.put("previewPlaying",playing);if(playing)s.put("previewTone",previewTone);}
}
