package app.overman.sleep;
import android.app.Activity;import android.os.Bundle;import android.widget.TextView;
/** Local rationale for Health Connect permission settings. */
public final class HealthPrivacyActivity extends Activity {
 @Override public void onCreate(Bundle state){super.onCreate(state);TextView text=new TextView(this);int p=(int)(24*getResources().getDisplayMetrics().density);text.setPadding(p,p,p,p);text.setTextSize(18);text.setText("Данные сна в Overman\n\nПосле вашего разрешения приложение может показать записи сна из Health Connect. Просмотр выполняется только по вашему нажатию. После отдельного подтверждения запись, её исходные дата и время, приложение-источник и способ записи могут быть сохранены в дневник, резервную копию и синхронизированы с подключённым аккаунтом. Отправка на сервер при просмотре не выполняется. Вы можете отозвать доступ в настройках Health Connect.");setContentView(text);}
}
