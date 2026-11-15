package app.overman.sleep;

/** Pure elapsed-time confirmation shared by the Android view and its tests. */
final class HoldConfirmation {
    private long start=-1;
    private boolean completed=false;
    void begin(long now){if(start<0&&!completed)start=now;}
    void cancel(){start=-1;}
    void retryAfterFailure(){start=-1;completed=false;}
    float progress(long now){return start<0?0:Math.min(1f,Math.max(0f,(now-start)/3000f));}
    boolean complete(long now){if(completed||start<0||now-start<3000)return false;completed=true;start=-1;return true;}
}
