package app.overman.sleep.tests;

import android.app.*;
import android.content.Intent;
import android.os.*;
import android.view.*;
import android.widget.FrameLayout;
import java.lang.reflect.Constructor;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/** Test-only runner: exercises the installed production native view, no app test hooks. */
public final class HoldViewInstrumentation extends Instrumentation {
    private Activity activity;
    private View view;
    private final AtomicInteger calls=new AtomicInteger();
    private final AtomicLong completedAt=new AtomicLong();
    private final StringBuilder checks=new StringBuilder();
    private long start;
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private void ui(Runnable action){runOnMainSync(action);}
    private void expect(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    private void passed(String name){checks.append(name).append('\n');}
    private void fresh()throws Exception{
        calls.set(0);completedAt.set(0);
        Constructor<?> ctor=Class.forName("app.overman.sleep.HoldWakeView",true,getTargetContext().getClassLoader()).getDeclaredConstructor(android.content.Context.class,Runnable.class);ctor.setAccessible(true);
        ui(()->{try{
            FrameLayout host=new FrameLayout(activity);view=(View)ctor.newInstance(activity,(Runnable)()->{completedAt.set(SystemClock.elapsedRealtime());calls.incrementAndGet();});
            host.addView(view,new FrameLayout.LayoutParams(-1,240));activity.setContentView(host);view.setFocusableInTouchMode(true);view.requestFocus();
        }catch(Exception e){throw new RuntimeException(e);}});
        waitForIdleSync();SystemClock.sleep(150);
        expect(view.getWidth()>0&&view.hasWindowFocus(),"native view visible and window focused");
    }
    private void touch(int action,float x,float y){ui(()->{long now=SystemClock.uptimeMillis();MotionEvent e=MotionEvent.obtain(now,now,action,x,y,0);view.dispatchTouchEvent(e);e.recycle();});}
    private void down(){start=SystemClock.elapsedRealtime();touch(MotionEvent.ACTION_DOWN,40,100);}
    private void key(int action,int code,int repeat){ui(()->view.dispatchKeyEvent(new KeyEvent(0,SystemClock.uptimeMillis(),action,code,repeat)));}
    private void quiet(String name){SystemClock.sleep(2300);expect(calls.get()==0,name+" must not complete");passed(name+": cancelled before 3 seconds, no later callback");}
    private void finished(String name){
        SystemClock.sleep(2100);expect(calls.get()==0,name+" early callback");SystemClock.sleep(1150);
        expect(calls.get()==1,name+" completed exactly once");expect(completedAt.get()-start>=3000,name+" monotonic duration");
        SystemClock.sleep(350);expect(calls.get()==1,name+" repeated callback");passed(name+": one callback after "+(completedAt.get()-start)+" ms");
    }
    @Override public void onStart(){Bundle result=new Bundle();try{
        Intent intent=getTargetContext().getPackageManager().getLaunchIntentForPackage("app.overman.sleep");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);waitForIdleSync();SystemClock.sleep(400);
        fresh();down();SystemClock.sleep(1050);touch(MotionEvent.ACTION_UP,40,100);quiet("Touch release");
        // Restart on the same view: elapsed time from the cancelled attempt is never reused.
        down();finished("Touch restart");touch(MotionEvent.ACTION_UP,40,100);
        fresh();down();SystemClock.sleep(1050);touch(MotionEvent.ACTION_MOVE,-1,100);quiet("Pointer leaves bounds");touch(MotionEvent.ACTION_UP,-1,100);
        fresh();down();SystemClock.sleep(1050);touch(MotionEvent.ACTION_CANCEL,40,100);quiet("Touch cancellation");
        fresh();down();SystemClock.sleep(1050);ui(()->view.clearFocus());quiet("View focus loss");
        fresh();down();SystemClock.sleep(1050);ui(()->view.onWindowFocusChanged(false));quiet("Window focus loss (lifecycle callback)");
        fresh();down();SystemClock.sleep(1050);ui(()->view.setVisibility(View.INVISIBLE));quiet("View hidden");
        fresh();down();SystemClock.sleep(1050);ui(()->view.setEnabled(false));quiet("Disabled during hold");
        fresh();down();SystemClock.sleep(1050);
        ui(()->{
            MotionEvent.PointerProperties[] props=new MotionEvent.PointerProperties[2];MotionEvent.PointerCoords[] coords=new MotionEvent.PointerCoords[2];
            for(int i=0;i<2;i++){props[i]=new MotionEvent.PointerProperties();props[i].id=i;props[i].toolType=MotionEvent.TOOL_TYPE_FINGER;coords[i]=new MotionEvent.PointerCoords();coords[i].x=40+i*30;coords[i].y=100;coords[i].pressure=1;coords[i].size=1;}
            long now=SystemClock.uptimeMillis();MotionEvent e=MotionEvent.obtain(now,now,MotionEvent.ACTION_POINTER_DOWN|(1<<MotionEvent.ACTION_POINTER_INDEX_SHIFT),2,props,coords,0,0,1,1,0,0,android.view.InputDevice.SOURCE_TOUCHSCREEN,0);view.dispatchTouchEvent(e);e.recycle();
            e=MotionEvent.obtain(now,now,MotionEvent.ACTION_POINTER_UP,2,props,coords,0,0,1,1,0,0,android.view.InputDevice.SOURCE_TOUCHSCREEN,0);view.dispatchTouchEvent(e);e.recycle();
        });quiet("Original finger lifts while second remains");
        for(int code:new int[]{KeyEvent.KEYCODE_SPACE,KeyEvent.KEYCODE_ENTER,KeyEvent.KEYCODE_DPAD_CENTER}){
            fresh();start=SystemClock.elapsedRealtime();key(KeyEvent.ACTION_DOWN,code,0);
            // Repeated key-down and release of a different key cannot replace the owner.
            key(KeyEvent.ACTION_DOWN,code,1);key(KeyEvent.ACTION_UP,code==KeyEvent.KEYCODE_ENTER?KeyEvent.KEYCODE_SPACE:KeyEvent.KEYCODE_ENTER,0);
            finished("Keyboard "+code);key(KeyEvent.ACTION_UP,code,0);
        }
        fresh();key(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_ENTER,0);SystemClock.sleep(1050);key(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_ENTER,0);quiet("Keyboard release");
        fresh();down();SystemClock.sleep(1050);ui(()->((android.view.ViewGroup)view.getParent()).removeView(view));quiet("View detached");
        result.putString("checks",checks.toString());result.putString("result","passed");finish(Activity.RESULT_OK,result);
    }catch(Throwable e){result.putString("checks",checks.toString());result.putString("result","failed");result.putString("failure",android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
}
