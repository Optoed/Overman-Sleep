package app.overman.sleep;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayInputStream;

public class MainActivity extends Activity {
    private String launchTarget="";
    static Intent open(Context context,String target){return new Intent(context,MainActivity.class).putExtra("overmanTarget",target).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);}
    private synchronized void captureLaunch(Intent intent){String target=intent==null?"":intent.getStringExtra("overmanTarget");if(!"sleep".equals(target)&&!"morning".equals(target))return;try{launchTarget=new JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("target",target).toString();}catch(JSONException ignored){}}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);captureLaunch(intent);if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('overman:resume'))",null);}
    @Override protected void onSaveInstanceState(Bundle out){synchronized(this){out.putString("launchTarget",launchTarget);}super.onSaveInstanceState(out);}
    private boolean compatibilityBlocked;private WebView web;private ValueCallback<Uri[]> files;private String exportText;private java.io.File exportSource;private Runnable afterPermission;
    @Override public void onCreate(Bundle bundle){super.onCreate(bundle);if(bundle!=null)launchTarget=bundle.getString("launchTarget","");else captureLaunch(getIntent());getWindow().setStatusBarColor(0xff10191b);getWindow().setNavigationBarColor(0xff152023);
        AlarmController.channels(this);
        MeditationTimerService.resume(this);
        // A user launch leaves Android's force-stopped state. Restore the system
        // alarm even if the WebView or diary cannot finish loading.
        if(AlarmController.prefs(this).getBoolean("ringing",false)){
            startForegroundService(new Intent(this,AlarmService.class).putExtra("receiverSession",AlarmController.sessionId(this)));
        }
        if(AlarmController.config(this).has("schedule")){
            try{AlarmController.schedule(this);}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Schedule restore on user launch failed",error);}
        }
        if(!WebViewCompatibility.supported(currentWebViewVersion())){compatibilityBlocked=true;showWebViewUpdate();return;}
        web=new WebView(this);web.setBackgroundColor(0xff10191b);
        android.widget.FrameLayout container=new android.widget.FrameLayout(this);container.setBackgroundColor(0xff10191b);container.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));setContentView(container);
        if(Build.VERSION.SDK_INT>=30){
            getWindow().setDecorFitsSystemWindows(false);
            container.setOnApplyWindowInsetsListener((view,insets)->{
                android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());
                int keyboard=insets.getInsets(android.view.WindowInsets.Type.ime()).bottom;
                view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,keyboard));
                return android.view.WindowInsets.CONSUMED;
            });
            container.requestApplyInsets();
        }
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMediaPlaybackRequiresUserGesture(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri u=request.getUrl();String path=u.getPath();
                if("https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&path!=null&&!path.contains("..")&&!path.contains("\\")){
                    String asset="/".equals(path)?"index.html":path.substring(1),mime=java.net.URLConnection.guessContentTypeFromName(asset);
                    if(asset.endsWith(".js"))mime="application/javascript";if(asset.endsWith(".css"))mime="text/css";if(asset.endsWith(".woff2"))mime="font/woff2";
                    try{return new WebResourceResponse(mime==null?"application/octet-stream":mime,"UTF-8",getAssets().open(asset));}catch(Exception ignored){}
                }
                if(RemoteApiPolicy.allow(u.getScheme(),u.getHost(),path,request.getMethod()))return null;
                return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !RemoteApiPolicy.localNavigation(request.getUrl().getScheme(),request.getUrl().getHost());}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(files!=null)files.onReceiveValue(null);files=callback;Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(pick,441);return true;}
        });
        web.addJavascriptInterface(new Bridge(),"OvermanAndroid");if((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)WebView.setWebContentsDebuggingEnabled(true);web.loadUrl("https://appassets.androidplatform.net/index.html");
    }

    private String currentWebViewVersion(){
        try{android.content.pm.PackageInfo info=WebView.getCurrentWebViewPackage();return info==null?null:info.versionName;}
        catch(RuntimeException unavailable){return null;}
    }
    private void showWebViewUpdate(){
        android.widget.ScrollView scroll=new android.widget.ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(0xff10191b);
        android.widget.LinearLayout content=new android.widget.LinearLayout(this);content.setOrientation(android.widget.LinearLayout.VERTICAL);scroll.addView(content,new android.widget.ScrollView.LayoutParams(-1,-2));
        int pad=(int)(24*getResources().getDisplayMetrics().density);content.setPadding(pad,pad,pad,pad);
        android.widget.TextView title=new android.widget.TextView(this);title.setText("Обнови Android System WebView");title.setTextSize(26);title.setTextColor(0xffedf4f1);title.setTypeface(android.graphics.Typeface.create("sans-serif-medium",android.graphics.Typeface.NORMAL));content.addView(title);
        android.widget.TextView detail=new android.widget.TextView(this);detail.setText("Для экрана Overman нужен WebView версии 111 или новее. Установленная версия: "+(currentWebViewVersion()==null?"не найдена":currentWebViewVersion())+".\n\nОбнови Android System WebView или Chrome в Google Play и открой приложение снова. Записи остаются на устройстве. Для работы будильника нужны разрешения Android. Во время сигнала удерживай кнопку на экране будильника 3 секунды.");detail.setTextSize(16);detail.setTextColor(0xffa1b4b3);detail.setPadding(0,pad,0,pad);content.addView(detail);
        android.widget.Button update=new android.widget.Button(this);update.setText("Обновить WebView");update.setAllCaps(false);update.setOnClickListener(v->{String name="com.google.android.webview";try{android.content.pm.PackageInfo info=WebView.getCurrentWebViewPackage();if(info!=null)name=info.packageName;}catch(RuntimeException ignored){}try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("market://details?id="+Uri.encode(name))));}catch(ActivityNotFoundException missing){try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://play.google.com/store/apps/details?id="+Uri.encode(name))));}catch(ActivityNotFoundException noBrowser){detail.setText("Открой Google Play и обнови Android System WebView или Chrome. После обновления открой Overman снова. Записи сохранены.");}}});content.addView(update,new android.widget.LinearLayout.LayoutParams(-1,-2));
        android.widget.Button retry=new android.widget.Button(this);retry.setText("Проверить снова");retry.setAllCaps(false);retry.setOnClickListener(v->recreate());content.addView(retry,new android.widget.LinearLayout.LayoutParams(-1,-2));
        if(AlarmController.prefs(this).getBoolean("ringing",false)){android.widget.Button alarm=new android.widget.Button(this);alarm.setText("Открыть будильник");alarm.setAllCaps(false);alarm.setOnClickListener(v->startActivity(new Intent(this,AlarmActivity.class)));content.addView(alarm,new android.widget.LinearLayout.LayoutParams(-1,-2));}
        setContentView(scroll);if(Build.VERSION.SDK_INT>=30){getWindow().setDecorFitsSystemWindows(false);scroll.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return android.view.WindowInsets.CONSUMED;});scroll.requestApplyInsets();}
    }

    private void reply(String id,Object value,String error){String js="window.overmanNativeReply&&window.overmanNativeReply("+JSONObject.quote(id)+","+(value==null?"null":value.toString())+","+(error==null?"null":JSONObject.quote(error))+")";web.evaluateJavascript(js,null);}
    private void refreshPermissions(){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('overman:resume'))",null);}
    private void requestNotificationPermissions(){
        if(!getSystemService(NotificationManager.class).areNotificationsEnabled()){
            String permission=android.Manifest.permission.POST_NOTIFICATIONS;
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED&&
                (!AlarmController.prefs(this).getBoolean("notificationRequested",false)||shouldShowRequestPermissionRationale(permission))){
                if(!AlarmController.prefs(this).edit().putBoolean("notificationRequested",true).commit())throw new IllegalStateException("Не удалось сохранить запрос разрешения. Повтори попытку.");
                requestPermissions(new String[]{permission},50);
            }else{
                try{startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));}
                catch(ActivityNotFoundException unavailable){startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}
            }
        }
    }
    private void requestAlarmPermissions(){if(!getSystemService(NotificationManager.class).areNotificationsEnabled())requestNotificationPermissions();else if(!AlarmController.exact(this))startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));}
    private void requestReminderPermissions(){
        if(!getSystemService(NotificationManager.class).areNotificationsEnabled())requestNotificationPermissions();
        else if(!AlarmController.reminderNotifications(this)){
            try{startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,"reminders_v1"));}
            catch(ActivityNotFoundException unavailable){startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));}
        }
    }
    final class Bridge{
        @JavascriptInterface public String readLaunchTarget(){synchronized(MainActivity.this){return launchTarget;}}
        @JavascriptInterface public boolean clearLaunchTarget(String id){synchronized(MainActivity.this){try{if(!new JSONObject(launchTarget).getString("id").equals(id))return false;launchTarget="";return true;}catch(JSONException ignored){return false;}}}
        @JavascriptInterface public String readSleepArchive(String key){try{String raw=ArchiveStore.read(MainActivity.this,key);return new JSONObject().put("raw",raw==null?JSONObject.NULL:raw).toString();}catch(Exception error){try{return new JSONObject().put("error",error.getMessage()==null?"Не удалось прочитать дневник Android. Исходный файл не изменён.":error.getMessage()).toString();}catch(Exception ignored){return "{\"error\":\"Не удалось прочитать дневник Android.\"}";}}}
        @JavascriptInterface public String writeSleepArchive(String key,String expected,String raw){try{ArchiveStore.write(MainActivity.this,key,expected,raw);return "";}catch(Exception error){return error.getMessage()==null?"Не удалось сохранить дневник Android.":error.getMessage();}}
        // Synchronous bridge methods finish the disk write before an input event
        // can report its draft saved, including an immediate process close.
        @JavascriptInterface public boolean saveMorningDraft(String body){try{
            if(body.length()>16000)return false;JSONObject d=new JSONObject(body),fields=d.getJSONObject("fields");
            if(!AlarmController.sessionId(d).equals(AlarmController.sessionId(MainActivity.this))||d.getLong("started")!=AlarmController.night(MainActivity.this).optLong("started")||d.getLong("wokeAt")!=AlarmController.prefs(MainActivity.this).getLong("wokeAt",0))return false;
            if(d.getInt("version")!=1||d.getLong("started")<0||(d.getLong("wokeAt")<0||(d.getLong("wokeAt")<d.getLong("started")&&!d.optBoolean("timeReview")))||d.getLong("sequence")<0||fields.getInt("rested")<0||fields.getInt("rested")>5||fields.getString("note").length()>2000)return false;
            JSONObject offsets=d.optJSONObject("offsets");if(offsets!=null)for(String field:new String[]{"bed","wake"})if(offsets.has(field)&&(!Double.isFinite(offsets.optDouble(field))||Math.rint(offsets.optDouble(field))!=offsets.optDouble(field)||Math.abs(offsets.optDouble(field))>840))return false;
            for(String field:new String[]{"bed","wake","sleep","latency","awake"})if(fields.getString(field).length()>64)return false;
            return AlarmController.prefs(MainActivity.this).edit().putString("morningDraft",body).commit();
        }catch(Exception error){return false;}}
        @JavascriptInterface public String readMorningDraft(){return AlarmController.prefs(MainActivity.this).getString("morningDraft","");}
        @JavascriptInterface public boolean clearMorningDraft(String session){try{if(!AlarmController.prefs(MainActivity.this).contains("morningDraft"))return true;AlarmController.requireSession(MainActivity.this,session);JSONObject draft=new JSONObject(readMorningDraft());if(!AlarmController.sessionId(draft).equals(session))return false;return AlarmController.prefs(MainActivity.this).edit().remove("morningDraft").commit();}catch(Exception error){return false;}}
        @JavascriptInterface public void invoke(String method,String body,String id){runOnUiThread(()->{try{
            if(body.length()>3500000)throw new Exception("Запрос слишком большой.");JSONObject input=new JSONObject(body);
            switch(method){
                case "meditationStart":reply(id,MeditationTimerService.start(MainActivity.this,input),null);break;
                case "meditationCancel":reply(id,MeditationTimerService.cancel(MainActivity.this,input.getString("id")),null);break;
                case "meditationComplete":reply(id,MeditationTimerService.complete(MainActivity.this,input.getString("id")),null);break;
                case "meditationCue":{boolean played=!MeditationTimerService.ownsCue(MainActivity.this,input.optString("sessionId"));if(played)MeditationCue.play(MainActivity.this);reply(id,new JSONObject().put("played",played),null);break;}
                case "stopMeditationCue":MeditationCue.stop();reply(id,new JSONObject().put("stopped",true),null);break;
                case "healthPermission":{
                    if(Build.VERSION.SDK_INT<34)throw new Exception("Просмотр Health Connect пока доступен на Android 14 и новее.");
                    String permission="android.permission.health.READ_SLEEP";
                    if(checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{permission},52);
                    reply(id,new JSONObject().put("granted",checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED),null);break;
                }
                case "healthRead":{
                    if(Build.VERSION.SDK_INT<34)throw new Exception("Просмотр Health Connect пока доступен на Android 14 и новее.");
                    app.overman.sleep.health.HealthSleepPagedReader.read(MainActivity.this,input.getLong("start"),input.getLong("end"),new app.overman.sleep.health.HealthSleepPagedReader.Result(){
                        public void success(JSONObject value){if(!isFinishing()&&web!=null)reply(id,value,null);}
                        public void failure(String reason){if(!isFinishing()&&web!=null)reply(id,null,reason);}
                    });break;
                }
                case "preview":AlarmAudio.preview(MainActivity.this,input.getJSONObject("alarm"));reply(id,AlarmController.status(MainActivity.this),null);break;
                case "stopPreview":AlarmAudio.stopPreview();reply(id,AlarmController.status(MainActivity.this),null);break;
                case "fullScreenPermission":
                    if(Build.VERSION.SDK_INT>=34){try{startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:"+getPackageName())));}catch(ActivityNotFoundException unavailable){startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}}
                    reply(id,AlarmController.status(MainActivity.this),null);break;
                case "alarmVolume":startActivity(new Intent(Settings.ACTION_SOUND_SETTINGS));reply(id,AlarmController.status(MainActivity.this),null);break;
                case "status":reply(id,AlarmController.status(MainActivity.this),null);break;
                case "configure":{
                    JSONObject s=input.getJSONObject("schedule"),a=input.getJSONObject("alarm");
                    if(!s.getString("bed").matches("([01][0-9]|2[0-3]):[0-5][0-9]")||!s.getString("wake").matches("([01][0-9]|2[0-3]):[0-5][0-9]"))throw new Exception("Неверное время.");
                    if(a.optDouble("reminderMinutes",Double.NaN)!=a.optInt("reminderMinutes",-1)||!SleepTiming.validReminderLead(a.optInt("reminderMinutes",-1)))throw new Exception("Выбери напоминание за 5–120 минут из списка.");
                    if(a.getDouble("volume")<0||a.getDouble("volume")>1)throw new Exception("Неверная громкость.");
                    if(a.optBoolean("enabled")&&!AlarmController.exact(MainActivity.this))throw new Exception("Разреши точные будильники в разделе Профиль → Разрешения Android.");
                    if(a.optBoolean("enabled")&&!getSystemService(NotificationManager.class).areNotificationsEnabled())throw new Exception("Разреши уведомления будильника в разделе Профиль → Разрешения Android.");
                    if(!AlarmController.prefs(MainActivity.this).getBoolean("ringing",false))AlarmAudio.requireAudible(MainActivity.this,a);
                    String configured=new JSONObject().put("schedule",s).put("alarm",a).toString();
                    String previous=AlarmController.prefs(MainActivity.this).getString("config","");
                    if(!previous.equals(configured)&&AlarmController.prefs(MainActivity.this).getBoolean("ringing",false))throw new Exception("Сначала удерживай «Проснуться» 3 секунды. Параметры сигнала можно изменить после пробуждения.");
                    if(!previous.equals(configured)){if(!AlarmController.sessionId(MainActivity.this).equals(input.optString("expectedSessionId")))throw new Exception("Эта ночь уже изменилась. Настройки не применены.");JSONObject oldRoot=AlarmController.config(MainActivity.this),oldTarget=oldRoot.optJSONObject("schedule"),oldAlarm=oldRoot.optJSONObject("alarm");
                        android.content.SharedPreferences.Editor edit=AlarmController.prefs(MainActivity.this).edit().putString("config",configured);
                        if(oldTarget==null||!oldTarget.optString("wake").equals(s.optString("wake"))||AlarmController.alarm(MainActivity.this).optBoolean("enabled")!=a.optBoolean("enabled"))edit.remove("skippedAlarmDate").remove("skippedAlarmClock");
                        AlarmController.commitSession(MainActivity.this,AlarmController.revision(MainActivity.this,edit),"Не удалось сохранить настройки на устройстве.");
                        if(oldTarget==null||!oldTarget.optString("bed").equals(s.optString("bed"))||(oldAlarm==null||oldAlarm.optInt("reminderMinutes")!=a.optInt("reminderMinutes"))||!a.optBoolean("reminder"))getSystemService(NotificationManager.class).cancel(300);}
                    if(!AlarmController.prefs(MainActivity.this).getBoolean("ringing",false))AlarmController.schedule(MainActivity.this);
                    reply(id,AlarmController.status(MainActivity.this),null);break;
                }
                case "reminderPermission":requestReminderPermissions();reply(id,AlarmController.status(MainActivity.this),null);break;
                case "permissions":{
                    requestAlarmPermissions();
                    reply(id,AlarmController.status(MainActivity.this),null);break;
                }
                case "skipAlarm":AlarmController.changeSkip(MainActivity.this,input.optBoolean("restore"),input.optLong("expectedAt"));reply(id,AlarmController.status(MainActivity.this),null);break;
                case "wake":AlarmController.finishWake(MainActivity.this,input.optString("sessionId"),input.optLong("alarmOccurrence"));reply(id,AlarmController.status(MainActivity.this),null);break;
                case "start":{
                    if(AlarmController.prefs(MainActivity.this).getBoolean("ringing",false))throw new Exception("Сначала удерживай «Проснуться» 3 секунды.");
                    JSONObject active=input.optJSONObject("active");
                    if(active!=null&&!AlarmController.sessionId(active).equals(AlarmController.sessionId(MainActivity.this)))AlarmAudio.requireAudible(MainActivity.this,AlarmController.alarm(MainActivity.this));
                    AlarmController.startSession(MainActivity.this,active,input.optString("previousSessionId"));
                    Runnable start=()->{try{AlarmController.requireSession(MainActivity.this,AlarmController.sessionId(active));JSONObject a=AlarmController.alarm(MainActivity.this);if(a.optBoolean("noise")&&checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw new Exception("Микрофон не разрешён. Отключи измерение шума или разреши доступ в настройках Android.");if(a.optBoolean("smart")||a.optBoolean("noise"))startForegroundService(new Intent(MainActivity.this,TrackingService.class));AlarmController.schedule(MainActivity.this);reply(id,AlarmController.status(MainActivity.this),null);}catch(Exception e){reply(id,null,e.getMessage());}};
                    if(AlarmController.alarm(MainActivity.this).optBoolean("noise")&&checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){afterPermission=start;requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},51);}else start.run();break;
                }
                case "ackWake":AlarmController.acknowledgeWake(MainActivity.this,input.optString("sessionId"),input.optString("eventId"));reply(id,AlarmController.status(MainActivity.this),null);break;
                case "stop":AlarmController.stopSession(MainActivity.this,input.optString("sessionId"));reply(id,AlarmController.status(MainActivity.this),null);break;
                case "exportOriginal":{
                    java.io.File source=ArchiveStore.path(MainActivity.this,input.getString("key"));
                    if(!source.exists())throw new Exception("Исходный файл Android не найден. Данные не изменены.");
                    exportSource=source;exportText=null;startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"overman-sleep-original.json"),440);reply(id,new JSONObject(),null);break;
                }
                case "export":exportSource=null;exportText=input.getString("text");startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"overman-sleep.json"),440);reply(id,new JSONObject(),null);break;
                default:throw new Exception("Неизвестное действие.");
            }
        }catch(Exception e){reply(id,null,e.getMessage());}});}
    }
    @Override public void onRequestPermissionsResult(int code,String[] names,int[] results){super.onRequestPermissionsResult(code,names,results);if(code==50){try{AlarmController.scheduleReminder(this);}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Reminder restore after permission failed",error);}refreshPermissions();}if(code==51&&afterPermission!=null){Runnable action=afterPermission;afterPermission=null;action.run();}}
    @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);if(code==441&&files!=null){files.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);files=null;}if(code==440){if(result==RESULT_OK&&data!=null&&(exportText!=null||exportSource!=null)){try(java.io.OutputStream out=getContentResolver().openOutputStream(data.getData())){if(exportSource!=null){try(java.io.InputStream in=new java.io.FileInputStream(exportSource)){byte[] bytes=new byte[8192];int count;while((count=in.read(bytes))!=-1)out.write(bytes,0,count);}}else out.write(exportText.getBytes(StandardCharsets.UTF_8));}catch(Exception e){android.widget.Toast.makeText(this,"Не удалось сохранить файл",android.widget.Toast.LENGTH_LONG).show();}}exportText=null;exportSource=null;}}
    @Override protected void onResume(){super.onResume();if(compatibilityBlocked&&WebViewCompatibility.supported(currentWebViewVersion())){recreate();return;}if(AlarmController.config(this).has("schedule")&&AlarmController.alarm(this).optBoolean("reminder"))try{AlarmController.scheduleReminder(this);}catch(RuntimeException error){android.util.Log.e("OvermanAlarm","Reminder restore on return failed",error);}if(web!=null){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('overman:resume'))",null);}}
    @Override protected void onPause(){AlarmAudio.stopPreview();if(web!=null)web.onPause();super.onPause();}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
}
