package app.overman.sleep.health;
import java.util.*;
public final class HealthPageSequenceTest {
 static void check(boolean ok){if(!ok)throw new AssertionError();}
 static final class Outcome implements HealthPageSequence.Result<Integer>{List<Integer> values;int errors,completed;public void complete(List<Integer> v){values=v;completed++;}public void error(){errors++;}}
 public static void main(String[] args){
  var observed=new ArrayList<Long>();var a=new Outcome();var seq=new HealthPageSequence<Integer>((token,reply)->{observed.add(token);if(token==null)reply.page(List.of(1),7);else reply.page(List.of(2),-1);},a);seq.start();check(observed.equals(Arrays.asList(null,7L)));check(a.values.equals(List.of(1,2))&&a.completed==1&&a.errors==0);
  var b=new Outcome();new HealthPageSequence<Integer>((token,reply)->{reply.page(List.of(1),7);reply.error();},b).start();check(b.errors==1&&b.completed==0&&b.values==null);
  var c=new Outcome();new HealthPageSequence<Integer>((token,reply)->{reply.page(List.of(1),-1);reply.error();reply.page(List.of(9),-1);},c).start();check(c.errors==0&&c.completed==1&&c.values.equals(List.of(1)));
  var d=new Outcome();new HealthPageSequence<Integer>((token,reply)->{if(token==null)reply.page(List.of(1),7);else reply.error();},d).start();check(d.errors==1&&d.values==null);
  var e=new Outcome();new HealthPageSequence<Integer>((token,reply)->{throw new IllegalStateException();},e).start();check(e.errors==1&&e.values==null);
  System.out.println("PASS: sequential pages, token loop, partial failure, duplicate callbacks and exceptions");
 }
}