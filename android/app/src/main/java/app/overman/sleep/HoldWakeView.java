package app.overman.sleep;
import android.content.Context;
import android.graphics.*;
import android.os.SystemClock;
import android.view.*;

final class HoldWakeView extends View {
    private final HoldConfirmation hold=new HoldConfirmation();
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Runnable onWake;
    private boolean active=false;
    private int pointerId=-1,keyCode=-1;
    HoldWakeView(Context context,Runnable action){super(context);onWake=action;setFocusable(true);setContentDescription("Проснуться. Удерживайте 3 секунды. Для клавиатуры удерживайте пробел или Enter.");}
    private float dp(float value){return value*getResources().getDisplayMetrics().density;}
    private void begin(){if(active||!isEnabled())return;active=true;hold.begin(SystemClock.elapsedRealtime());postOnAnimation(tick);invalidate();}
    private void cancel(){active=false;pointerId=-1;keyCode=-1;hold.cancel();removeCallbacks(tick);invalidate();}
    private final Runnable tick=new Runnable(){public void run(){if(!active)return;long now=SystemClock.elapsedRealtime();invalidate();if(hold.complete(now)){active=false;try{onWake.run();}catch(IllegalStateException error){hold.retryAfterFailure();cancel();android.widget.Toast.makeText(getContext(),error.getMessage(),android.widget.Toast.LENGTH_LONG).show();}}else postOnAnimation(this);}};
    @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);RectF bounds=new RectF(0,0,getWidth(),getHeight());paint.setColor(0xff253c38);canvas.drawRoundRect(bounds,dp(18),dp(18),paint);canvas.save();Path clip=new Path();clip.addRoundRect(bounds,dp(18),dp(18),Path.Direction.CW);canvas.clipPath(clip);paint.setColor(0xff32685b);canvas.drawRect(0,0,getWidth()*hold.progress(SystemClock.elapsedRealtime()),getHeight(),paint);canvas.restore();paint.setTextAlign(Paint.Align.CENTER);paint.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));paint.setColor(0xffdef6e9);paint.setTextSize(dp(19));canvas.drawText("Проснуться",getWidth()/2f,getHeight()/2f-dp(1),paint);paint.setTextSize(dp(13));canvas.drawText(active?"Продолжайте удерживать…":"Удерживайте 3 секунды",getWidth()/2f,getHeight()/2f+dp(23),paint);}
    @Override public boolean onTouchEvent(MotionEvent event){
        if(!isEnabled())return false;
        switch(event.getActionMasked()){
            case MotionEvent.ACTION_DOWN:
                if(pointerId<0&&keyCode<0){requestFocus();pointerId=event.getPointerId(0);begin();}return true;
            case MotionEvent.ACTION_MOVE:
                if(pointerId<0)return true;
                int index=event.findPointerIndex(pointerId);
                if(index<0||event.getX(index)<0||event.getX(index)>=getWidth()||event.getY(index)<0||event.getY(index)>=getHeight())cancel();return true;
            case MotionEvent.ACTION_POINTER_UP:
                if(event.getPointerId(event.getActionIndex())==pointerId)cancel();return true;
            case MotionEvent.ACTION_UP:
                if(event.getPointerId(event.getActionIndex())==pointerId){performClick();cancel();}return true;
            case MotionEvent.ACTION_CANCEL:
                if(pointerId>=0)cancel();return true;
            default:return true;
        }
    }
    @Override public boolean performClick(){super.performClick();return true;}
    @Override public boolean onKeyDown(int key,KeyEvent event){if(key==KeyEvent.KEYCODE_SPACE||key==KeyEvent.KEYCODE_ENTER||key==KeyEvent.KEYCODE_DPAD_CENTER){if(isEnabled()&&event.getRepeatCount()==0&&pointerId<0&&keyCode<0){keyCode=key;begin();}return true;}return super.onKeyDown(key,event);}
    @Override public boolean onKeyUp(int key,KeyEvent event){if(key==KeyEvent.KEYCODE_SPACE||key==KeyEvent.KEYCODE_ENTER||key==KeyEvent.KEYCODE_DPAD_CENTER){if(keyCode==key)cancel();return true;}return super.onKeyUp(key,event);}
    @Override protected void onFocusChanged(boolean focused,int direction,Rect previous){super.onFocusChanged(focused,direction,previous);if(!focused)cancel();}
    @Override protected void onVisibilityChanged(View changed,int visibility){super.onVisibilityChanged(changed,visibility);if(visibility!=VISIBLE)cancel();}
    @Override public void setEnabled(boolean enabled){super.setEnabled(enabled);if(!enabled)cancel();}
    @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);if(visibility!=VISIBLE)cancel();}
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(!focused)cancel();}
    @Override protected void onDetachedFromWindow(){cancel();super.onDetachedFromWindow();}
}
