package app.overman.sleep;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
/** Finite low-volume media cue. Never owns or modifies the alarm channel. */
final class MeditationCue {
 private static AudioTrack track;
 static synchronized void stop(){if(track!=null){try{track.stop();}catch(Exception ignored){}track.release();track=null;}}
 static synchronized void play(Context context){
  if(AlarmController.prefs(context).getBoolean("ringing",false))return;
  stop();int rate=22050,seconds=9;short[] samples=new short[rate*seconds];
  for(int i=0;i<samples.length;i++){double t=i/(double)rate,envelope=Math.min(1,t/3)*Math.min(1,(seconds-t)/4);samples[i]=(short)(700*envelope*(Math.sin(2*Math.PI*220*t)+.5*Math.sin(2*Math.PI*330*t)));}
  AudioTrack next=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()).setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(samples.length*2).setTransferMode(AudioTrack.MODE_STATIC).build();
  next.write(samples,0,samples.length);track=next;next.play();
  Vibrator vibrator=(Vibrator)context.getSystemService(Context.VIBRATOR_SERVICE);if(vibrator!=null&&vibrator.hasVibrator())vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0,100,700,100},new int[]{0,30,0,20},-1));
  new Handler(Looper.getMainLooper()).postDelayed(()->{synchronized(MeditationCue.class){if(track==next)stop();}},seconds*1000L+300);
 }
}
