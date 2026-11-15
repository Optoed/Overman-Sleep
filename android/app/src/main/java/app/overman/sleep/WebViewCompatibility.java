package app.overman.sleep;
/** The separate offline bundle requires modern JavaScript and CSS; OS version alone is insufficient. */
final class WebViewCompatibility {
    static final int MIN_MAJOR=111;
    static int major(String version){
        if(version==null)return -1;
        try{String raw=version.trim();int dot=raw.indexOf('.');String first=dot<0?raw:raw.substring(0,dot);return first.matches("[0-9]+")?Integer.parseInt(first):-1;}
        catch(RuntimeException invalid){return -1;}
    }
    static boolean supported(String version){return major(version)>=MIN_MAJOR;}
}
