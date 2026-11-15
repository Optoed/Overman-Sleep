package app.overman.sleep.health;
public final class HealthSleepReaderMappingTest {
 public static void main(String[] args) {
  int[] types={0,1,2,3,4,5,6,7,999};
  String[] expected={"unknown","awake","sleeping","unknown","light","deep","rem","awake","unknown"};
  for(int i=0;i<types.length;i++) if(!expected[i].equals(HealthSleepReader.kind(types[i]))) throw new AssertionError("Stage mapping: "+types[i]);
  System.out.println("PASS: all Android stage types, out-of-bed and future unknown types");
 }
}