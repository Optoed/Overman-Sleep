package app.overman.sleep;
/** Pure safety rule, also testable on platforms whose alarm stream cannot reach zero. */
final class AlarmSoundPolicy {
    static String error(boolean enabled,double gain,int systemVolume,boolean vibration,boolean available){
        if(!Double.isFinite(gain)||gain<0||gain>1)return "invalid_volume";
        if(enabled&&(gain==0||systemVolume==0)&&!(vibration&&available))return systemVolume==0?"system_silent":"silent";
        return null;
    }
}
