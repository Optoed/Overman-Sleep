package app.overman.sleep.health;
import java.util.List;
public final class HealthPageCollectorTest {
 static void require(boolean condition){if(!condition)throw new AssertionError();}
 static void fails(Runnable action){try{action.run();throw new AssertionError("Expected rejection");}catch(IllegalArgumentException|IllegalStateException expected){}}
 public static void main(String[] args){
  var pages=new HealthPageCollector<String>();fails(pages::result);fails(pages::nextPageToken);
  pages.addPage(List.of("first"),7);require(!pages.isComplete());require(pages.nextPageToken()==7);fails(pages::result);
  pages.addPage(List.of("second"),-1);require(pages.isComplete());require(pages.result().equals(List.of("first","second")));fails(()->pages.addPage(List.of(),-1));
  var loop=new HealthPageCollector<String>();loop.addPage(List.of("private"),7);fails(()->loop.addPage(List.of("more"),7));fails(loop::result);fails(loop::nextPageToken);
  var limit=new HealthPageCollector<String>();for(int n=0;n<10;n++)limit.addPage(List.of(),n);fails(()->limit.addPage(List.of(),-1));fails(limit::result);
  var oversized=new HealthPageCollector<String>();fails(()->oversized.addPage(java.util.Collections.nCopies(1001,"x"),-1));fails(oversized::result);
  var invalid=new HealthPageCollector<String>();fails(()->invalid.addPage(List.of(),-2));
  var empty=new HealthPageCollector<String>();empty.addPage(List.of(),-1);require(empty.result().isEmpty());
  System.out.println("PASS: complete pages, empty response, token loop, size/page bounds and rejection of partial results");
 }
}