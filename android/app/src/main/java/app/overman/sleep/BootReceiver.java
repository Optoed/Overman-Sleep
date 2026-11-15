package app.overman.sleep;
import android.content.*;
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent i){try{if((Intent.ACTION_TIME_CHANGED.equals(i.getAction())||(Intent.ACTION_TIMEZONE_CHANGED.equals(i.getAction())&&!AlarmController.night(c).has("bedOffset")))&&!AlarmController.sessionId(c).isEmpty())AlarmController.revision(c,AlarmController.prefs(c).edit().putBoolean("timeChanged",true)).commit();AlarmController.schedule(c);AlarmController.resumeAfterBoot(c);}catch(Exception error){android.util.Log.e("OvermanAlarm","System-event schedule restore failed",error);} }
}
