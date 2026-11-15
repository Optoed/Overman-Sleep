package app.overman.sleep;
/** A delivery must belong to the currently armed occurrence, not a replaced or consumed one. */
final class AlarmDeliveryPolicy {
    static boolean reminder(long planned,long delivered,long now,boolean enabled){return enabled&&planned>0&&delivered==planned&&now>=planned;}
    static boolean accept(long planned,long delivered,long now,boolean ringing){return !ringing&&planned>0&&delivered==planned&&planned-now<=1000;}
    static boolean resume(long planned,long delivered,long now,boolean ringing,long wokeAt,String expected,String session){
        return accept(planned,delivered,now,!ringing)&&wokeAt==0&&expected!=null&&!expected.isEmpty()&&expected.equals(session);
    }
}
