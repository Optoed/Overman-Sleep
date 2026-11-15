package app.overman.sleep;
/** Network permission for fixed diary protocol endpoints. WebView keeps normal
 * TLS, certificate and CORS verification; local assets never fall through. */
final class RemoteApiPolicy {
    private static final String ASSETS="appassets.androidplatform.net";
    static boolean localNavigation(String scheme,String host){return "https".equals(scheme)&&ASSETS.equals(host);}
    static boolean allow(String scheme,String host,String path,String method){
        if(!"https".equals(scheme)||host==null||host.isEmpty()||ASSETS.equalsIgnoreCase(host)||path==null||method==null)return false;
        final boolean read="/v1/session".equals(path)||"/v1/diary".equals(path)||"/v1/friends".equals(path);
        final boolean write="/v1/auth/register".equals(path)||"/v1/auth/login".equals(path)||"/v1/auth/logout".equals(path)||"/v1/diary/operations".equals(path)||"/v1/diary/cancellations".equals(path)||"/v1/diary/legacy-credits".equals(path)||"/v1/friends".equals(path);
        return (read&&"GET".equals(method))||(write&&"POST".equals(method))||((read||write)&&"OPTIONS".equals(method));
    }
}
