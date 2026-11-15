package app.overman.sleep.health;
import android.health.connect.datatypes.Metadata;
public final class HealthRecordingMethodTest {
    public static void main(String[] args) {
        int[] values={Metadata.RECORDING_METHOD_UNKNOWN,Metadata.RECORDING_METHOD_ACTIVELY_RECORDED,Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED,Metadata.RECORDING_METHOD_MANUAL_ENTRY,4,-1,999};
        String[] expected={"unknown","active","automatic","manual","unknown","unknown","unknown"};
        for(int i=0;i<values.length;i++)if(!expected[i].equals(HealthRecordingMethod.name(values[i])))throw new AssertionError("Recording method "+values[i]);
        System.out.println("PASS: manual, automatic, active, unknown and future Android recording methods");
    }
}
