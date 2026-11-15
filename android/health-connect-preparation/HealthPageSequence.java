package app.overman.sleep.health;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
/** Adapter-independent paging coordinator. Fetch only after explicit user action. */
public final class HealthPageSequence<T> {
 public interface Reply<T>{void page(List<T> records,long next);void error();}
 public interface Fetch<T>{void fetch(Long token,Reply<T> reply);}
 public interface Result<T>{void complete(List<T> records);void error();}
 private final Fetch<T> fetch;private final Result<T> result;private final HealthPageCollector<T> collector=new HealthPageCollector<>();private final AtomicBoolean done=new AtomicBoolean();private boolean started;
 public HealthPageSequence(Fetch<T> fetch,Result<T> result){this.fetch=java.util.Objects.requireNonNull(fetch);this.result=java.util.Objects.requireNonNull(result);}
 public synchronized void start(){if(started)throw new IllegalStateException("Already started");started=true;next(null);}
 private void fail(){if(done.compareAndSet(false,true))result.error();}
 private void next(Long token){if(done.get())return;AtomicBoolean answered=new AtomicBoolean();try{fetch.fetch(token,new Reply<T>(){
  public void page(List<T> rows,long following){if(!answered.compareAndSet(false,true)||done.get())return;try{collector.addPage(rows,following);if(collector.isComplete()){if(done.compareAndSet(false,true))result.complete(collector.result());}else next(collector.nextPageToken());}catch(RuntimeException failure){fail();}}
  public void error(){if(answered.compareAndSet(false,true))fail();}
 });}catch(RuntimeException failure){if(answered.compareAndSet(false,true))fail();}}
}