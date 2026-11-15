package app.overman.sleep;
import android.content.*;
import android.app.*;
public class AlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){AlarmController.channels(c);String action=intent.getAction();
        if("resume".equals(action)){
            long planned=AlarmController.prefs(c).getLong("resumeDeadline",0);
            if(!AlarmDeliveryPolicy.resume(planned,intent.getLongExtra("alarmDeadline",0),System.currentTimeMillis(),AlarmController.prefs(c).getBoolean("ringing",false),(AlarmController.prefs(c).getBoolean("ringingWithPendingMorning",false)?0:AlarmController.prefs(c).getLong("wokeAt",0)),intent.getStringExtra("receiverSession"),AlarmController.sessionId(c)))return;
            if(!AlarmController.prefs(c).edit().remove("resumeDeadline").commit())return;
            c.startForegroundService(new Intent(c,AlarmService.class).putExtra("receiverSession",AlarmController.sessionId(c)));
        }else if("remind".equals(action)){
            AlarmController.deliverReminder(c,intent);
        }else if("wake".equals(action)||"snooze".equals(action)||"smart".equals(action)){
            long planned=AlarmController.deliveryDeadline(c,action);
            if(!AlarmController.alarm(c).optBoolean("enabled")||!AlarmDeliveryPolicy.accept(planned,intent.getLongExtra("alarmDeadline",planned),System.currentTimeMillis(),AlarmController.prefs(c).getBoolean("ringing",false)))return;
            AlarmController.ensureSession(c);String session=AlarmController.sessionId(c);
            // Keep sounding even if a subsequent scheduling/disk operation fails.
            if(!AlarmController.revision(c,AlarmController.prefs(c).edit().putBoolean("ringing",true).putLong("ringOccurrence",planned).putBoolean("ringingWithPendingMorning",AlarmController.prefs(c).getLong("wokeAt",0)>0)).commit())android.util.Log.w("OvermanAlarm","Delivery state could not be persisted");
            AlarmController.markWake(c,planned);try{AlarmController.schedule(c);}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Next alarm could not be scheduled",error);}
            c.stopService(new Intent(c,TrackingService.class));
            try{c.startForegroundService(new Intent(c,AlarmService.class).putExtra("receiverSession",session));}
            catch(RuntimeException error){AlarmController.revision(c,AlarmController.prefs(c).edit().putBoolean("ringing",false)).commit();android.util.Log.e("OvermanAlarm","Alarm service could not start",error);}
        }
    }
}
