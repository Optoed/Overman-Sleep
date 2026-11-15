package app.overman.sleep.tests;
import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.FrameLayout;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Explicit disk-failure injection against installed production controller and view. */
public final class WakePersistenceInstrumentation extends Instrumentation {
    private final Map<String,Object> values=new HashMap<>();private boolean fail=true;private int stops=0;
    private void check(boolean ok,String text){if(!ok)throw new AssertionError(text);}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private SharedPreferences preferences(){return (SharedPreferences)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.class},(p,m,a)->{
        switch(m.getName()){
            case "getInt":case "getLong":case "getBoolean":case "getString":return values.getOrDefault(a[0],a[1]);
            case "contains":return values.containsKey(a[0]);
            case "edit":Map<String,Object> pending=new HashMap<>();Set<String> removed=new HashSet<>();return Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.Editor.class},(editor,method,args)->{
                String name=method.getName();if(name.startsWith("put")){pending.put((String)args[0],args[1]);return editor;}if(name.equals("remove")){removed.add((String)args[0]);return editor;}
                if(name.equals("commit")||name.equals("apply")){for(String k:removed)values.remove(k);values.putAll(pending);return name.equals("commit")?!fail:null;}
                throw new UnsupportedOperationException(name);
            });
            default:throw new UnsupportedOperationException(m.getName());
        }
    });}
    @Override public void onStart(){Bundle result=new Bundle();try{
        Context fakeDisk=new ContextWrapper(getTargetContext()){
            @Override public SharedPreferences getSharedPreferences(String name,int mode){return preferences();}
            @Override public boolean stopService(Intent service){stops++;return true;}
        };
        Method finish=Class.forName("app.overman.sleep.AlarmController",true,getTargetContext().getClassLoader()).getDeclaredMethod("finishWake",Context.class);finish.setAccessible(true);
        values.put("wakeNight","{\"id\":\"disk-check\",\"started\":1}");values.put("ringing",true);
        try{finish.invoke(null,fakeDisk);throw new AssertionError("Disk rejection must throw");}catch(InvocationTargetException error){check(error.getCause() instanceof IllegalStateException,"explicit save error");}
        check(stops==0,"no services stopped before durable write");check(Boolean.TRUE.equals(values.get("ringing")),"ringing memory rolled back");check(!values.containsKey("wokeAt"),"failed wake memory rolled back");
        fail=false;finish.invoke(null,fakeDisk);long first=(Long)values.get("wokeAt");check(stops==2&&first>0,"successful commit precedes service stop");finish.invoke(null,fakeDisk);check((Long)values.get("wokeAt")==first,"retry keeps first durable wake");
        Intent intent=getTargetContext().getPackageManager().getLaunchIntentForPackage("app.overman.sleep");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);Activity activity=startActivitySync(intent);AtomicInteger attempts=new AtomicInteger();View[] view=new View[1];
        Constructor<?> ctor=Class.forName("app.overman.sleep.HoldWakeView",true,getTargetContext().getClassLoader()).getDeclaredConstructor(Context.class,Runnable.class);ctor.setAccessible(true);
        runOnMainSync(()->{try{FrameLayout host=new FrameLayout(activity);view[0]=(View)ctor.newInstance(activity,(Runnable)()->{if(attempts.incrementAndGet()==1)throw new IllegalStateException("Проверочный отказ записи. Повторите удержание.");});host.addView(view[0],new FrameLayout.LayoutParams(-1,240));activity.setContentView(host);}catch(Exception e){throw new RuntimeException(e);}});waitForIdleSync();SystemClock.sleep(200);
        touch(view[0],MotionEvent.ACTION_DOWN);SystemClock.sleep(3300);touch(view[0],MotionEvent.ACTION_UP);check(attempts.get()==1,"failed native view callback attempted once");
        touch(view[0],MotionEvent.ACTION_DOWN);SystemClock.sleep(2100);check(attempts.get()==1,"retry still needs 3 seconds");SystemClock.sleep(1200);touch(view[0],MotionEvent.ACTION_UP);check(attempts.get()==2,"view permits deliberate full retry after save failure");
        result.putString("result","passed");result.putString("checks","Injected commit=false does not stop services; failed SharedPreferences memory rolled back; successful commit stops services; first durable timestamp stable; native view failure permits new full 3-second hold.");finish(Activity.RESULT_OK,result);
    }catch(Throwable error){result.putString("result","failed");result.putString("failure",android.util.Log.getStackTraceString(error));finish(Activity.RESULT_CANCELED,result);}}
    private void touch(View view,int action){runOnMainSync(()->{long now=SystemClock.uptimeMillis();MotionEvent e=MotionEvent.obtain(now,now,action,40,100,0);view.dispatchTouchEvent(e);e.recycle();});}
}
