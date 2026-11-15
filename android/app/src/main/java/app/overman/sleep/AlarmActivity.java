package app.overman.sleep;
import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.*;
public class AlarmActivity extends Activity {
    @Override public void onCreate(Bundle state){super.onCreate(state);if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setGravity(Gravity.CENTER);layout.setPadding(50,80,50,80);layout.setBackgroundColor(0xff10191b);
        TextView title=new TextView(this);title.setText("Доброе утро.");title.setTextSize(34);title.setTypeface(android.graphics.Typeface.create("sans-serif-medium",android.graphics.Typeface.NORMAL));title.setTextColor(0xffeeeef5);layout.addView(title);
        TextView description=new TextView(this);description.setText(AlarmController.prefs(this).getBoolean("ringingWithPendingMorning",false)?"Ежедневный будильник.\nПрошлая ночь ещё ждёт оценки.\nУдерживайте кнопку 3 секунды,\nчтобы выключить сигнал.":"Удерживайте кнопку 3 секунды,\nчтобы выключить сигнал.");description.setGravity(Gravity.CENTER);description.setTextSize(17);description.setTextColor(0xffa0b3b2);description.setPadding(0,20,0,70);layout.addView(description);
        final String session=AlarmController.sessionId(this);final long occurrence=AlarmController.prefs(this).getLong("ringOccurrence",0);
        HoldWakeView stop=new HoldWakeView(this,()->{AlarmController.finishWake(this,session,occurrence);startActivity(MainActivity.open(this,"morning"));finish();});layout.addView(stop,new LinearLayout.LayoutParams(-1,(int)(96*getResources().getDisplayMetrics().density)));setContentView(layout);
    }
}
