package app.overman.sleep;
public class WebViewCompatibilityCheck {
 public static void main(String[] args){int cases=0;for(String v:new String[]{null,""," ","69.0.3497.100","99.0","100.0","110.0","bad","100beta","999999999999999999999"}){if(WebViewCompatibility.supported(v))throw new AssertionError("unsupported: "+v);cases++;}for(String v:new String[]{"111","111.0.5563.116"," 120.0.1 ","142.0.1"}){if(!WebViewCompatibility.supported(v))throw new AssertionError("supported: "+v);cases++;}if(WebViewCompatibility.major("69.0.3497.100")!=69)throw new AssertionError("major parser");System.out.println((cases+1)+" WebView compatibility boundaries passed: missing, malformed, overflow, old, minimum and newer.");}
}
