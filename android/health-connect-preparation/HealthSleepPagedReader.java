package app.overman.sleep.health;

import android.content.Context;
import android.content.pm.PackageManager;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.SleepSessionRecord;
import android.os.Build;
import android.os.OutcomeReceiver;
import java.time.Instant;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Android 14+ read-only preparation. Caller must obtain explicit consent first.
 * No notes, provider identifiers, health data upload, or archive mutation. */
public final class HealthSleepPagedReader {
    public interface Result { void success(JSONObject value); void failure(String reason); }
    private static final String READ_SLEEP="android.permission.health.READ_SLEEP";
    private HealthSleepPagedReader() {}
    public static void read(Context context,long startMs,long endMs,Result callback) {
        if (Build.VERSION.SDK_INT < 34) { callback.failure("Health Connect требует Android 14 или отдельную интеграцию для более ранней версии."); return; }
        if (startMs < 0 || endMs <= startMs || endMs-startMs > 72L*60*60*1000 || endMs > System.currentTimeMillis()+60000) { callback.failure("Неверный период чтения."); return; }
        if (context.checkSelfPermission(READ_SLEEP) != PackageManager.PERMISSION_GRANTED) { callback.failure("Нет разрешения на чтение сна."); return; }
        HealthConnectManager manager=context.getSystemService(HealthConnectManager.class);
        if(manager==null) { callback.failure("Health Connect недоступен."); return; }
        try {
            var filter=new TimeInstantRangeFilter.Builder().setStartTime(Instant.ofEpochMilli(startMs)).setEndTime(Instant.ofEpochMilli(endMs)).build();
            var sequence=new HealthPageSequence<SleepSessionRecord>((token,reply)->{
                try {
                    var builder=new ReadRecordsRequestUsingFilters.Builder<>(SleepSessionRecord.class).setTimeRangeFilter(filter).setPageSize(100).setAscending(false);
                    if(token!=null)builder.setPageToken(token);
                    manager.readRecords(builder.build(),context.getMainExecutor(),new OutcomeReceiver<ReadRecordsResponse<SleepSessionRecord>,HealthConnectException>(){
                        @Override public void onResult(ReadRecordsResponse<SleepSessionRecord> response){reply.page(response.getRecords(),response.getNextPageToken());}
                        @Override public void onError(HealthConnectException error){reply.error();}
                    });
                }catch(RuntimeException error){reply.error();}
            },new HealthPageSequence.Result<SleepSessionRecord>(){
                public void complete(List<SleepSessionRecord> records){
                    try {
                        JSONArray sessions=new JSONArray();
                        for(SleepSessionRecord record:records){
                            JSONArray stages=new JSONArray();
                            for(SleepSessionRecord.Stage stage:record.getStages())stages.put(new JSONObject().put("start",stage.getStartTime().toEpochMilli()).put("end",stage.getEndTime().toEpochMilli()).put("kind",kind(stage.getType())));
                            sessions.put(new JSONObject().put("start",record.getStartTime().toEpochMilli()).put("end",record.getEndTime().toEpochMilli()).put("stages",stages));
                        }
                        callback.success(new JSONObject().put("sessions",sessions));
                    }catch(Exception error){callback.failure("Не удалось обработать записи сна.");}
                }
                public void error(){callback.failure("Не удалось полностью прочитать записи Health Connect. Проверь разрешение и источник данных.");}
            });
            sequence.start();
        } catch(RuntimeException unavailable) { callback.failure("Health Connect недоступен."); }
    }

    static String kind(int value) {
        if(value==SleepSessionRecord.StageType.STAGE_TYPE_AWAKE || value==SleepSessionRecord.StageType.STAGE_TYPE_AWAKE_IN_BED)return "awake";
        // An out-of-bed interval makes in-bed efficiency ambiguous; do not invent it.
        if(value==SleepSessionRecord.StageType.STAGE_TYPE_AWAKE_OUT_OF_BED)return "unknown";
        if(value==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING)return "sleeping";
        if(value==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_LIGHT)return "light";
        if(value==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_DEEP)return "deep";
        if(value==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_REM)return "rem";
        return "unknown";
    }
}