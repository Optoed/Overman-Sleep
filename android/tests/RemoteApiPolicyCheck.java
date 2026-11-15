package app.overman.sleep;
public final class RemoteApiPolicyCheck {
 static int count;static void expect(boolean want,String scheme,String host,String path,String method){if(RemoteApiPolicy.allow(scheme,host,path,method)!=want)throw new AssertionError("Unexpected protocol route: "+scheme+" "+host+" "+method+" "+path);count++;}
 public static void main(String[] args){
  for(String path:new String[]{"/v1/session","/v1/diary","/v1/auth/register","/v1/auth/login","/v1/auth/logout","/v1/diary/operations","/v1/diary/cancellations","/v1/diary/legacy-credits"}){
   boolean read=path.equals("/v1/session")||path.equals("/v1/diary");expect(true,"https","127.0.0.1",path,read?"GET":"POST");expect(true,"https","api.example",path,"OPTIONS");expect(false,"https","api.example",path,read?"POST":"GET");expect(false,"http","127.0.0.1",path,read?"GET":"POST");expect(false,"https","appassets.androidplatform.net",path,read?"GET":"POST");expect(false,"https","api.example",path,"DELETE");
  }
  for(String path:new String[]{"/","/index.html","/v1/session/","/v1/session/../diary","/v1/anything","/v1/auth/password","/fonts/private.woff2","/redirect","/health"})expect(false,"https","api.example",path,"GET");
  for(String method:new String[]{"GET","POST","OPTIONS"})expect(true,"https","api.example","/v1/friends",method);
  for(String method:new String[]{"PUT","PATCH","DELETE"})expect(false,"https","api.example","/v1/friends",method);
  expect(false,"http","api.example","/v1/friends","GET");expect(false,"https","appassets.androidplatform.net","/v1/friends","POST");expect(false,"https","api.example","/v1/friends/other","GET");
  expect(false,"file","api.example","/v1/diary","GET");expect(false,"https",null,"/v1/diary","GET");expect(false,"https","","/v1/diary","GET");expect(false,"https","api.example",null,"GET");expect(false,"https","api.example","/v1/diary",null);expect(false,"https","APPASSETS.ANDROIDPLATFORM.NET","/v1/diary","GET");
  if(!RemoteApiPolicy.localNavigation("https","appassets.androidplatform.net")||RemoteApiPolicy.localNavigation("http","appassets.androidplatform.net")||RemoteApiPolicy.localNavigation("https","api.example")||RemoteApiPolicy.localNavigation("javascript",null))throw new AssertionError("Local navigation boundary");count+=4;
  System.out.println(count+" remote API policy cases passed");
 }
}
