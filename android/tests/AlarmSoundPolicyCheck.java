package app.overman.sleep;
public final class AlarmSoundPolicyCheck {
 static int checks;
 static void expect(String expected,boolean enabled,double gain,int system,boolean vibration,boolean available){String actual=AlarmSoundPolicy.error(enabled,gain,system,vibration,available);if(!java.util.Objects.equals(expected,actual))throw new AssertionError("expected="+expected+" actual="+actual);checks++;}
 public static void main(String[] args){
  expect(null,true,.6,6,false,false);
  expect("system_silent",true,.6,0,false,true);
  expect(null,true,.6,0,true,true);
  expect("system_silent",true,.6,0,true,false);
  expect("silent",true,0,6,false,true);
  expect(null,true,0,6,true,true);
  expect("silent",true,0,6,true,false);
  expect(null,false,0,0,false,false);
  expect(null,true,1,7,false,true);
  expect("invalid_volume",true,-.01,6,true,true);
  expect("invalid_volume",true,1.01,6,true,true);
  expect("invalid_volume",true,Double.NaN,6,true,true);
  expect("invalid_volume",false,Double.POSITIVE_INFINITY,6,true,true);
  System.out.println(checks+" Java sound-policy boundary cases passed, including a true zero system-volume input. This is a pure rule test, not a physical or native AudioManager-zero claim.");
 }
}
