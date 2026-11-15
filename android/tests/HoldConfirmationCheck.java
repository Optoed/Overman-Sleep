package app.overman.sleep;
public class HoldConfirmationCheck {
 public static void main(String[] args){
  HoldConfirmation hold=new HoldConfirmation();
  hold.begin(1000);assert !hold.complete(3999);assert hold.progress(2500)==.5f;
  hold.cancel();assert !hold.complete(5000);assert hold.progress(5000)==0;
  hold.begin(5000);assert !hold.complete(7999);assert hold.complete(8000);assert !hold.complete(9000);
  HoldConfirmation reverse=new HoldConfirmation();reverse.begin(500);assert reverse.progress(400)==0;reverse.cancel();assert !reverse.complete(999999);
  for(int i=0;i<20;i++){HoldConfirmation fresh=new HoldConfirmation();fresh.begin(0);fresh.begin(2000);assert !fresh.complete(2999);assert fresh.complete(3000);fresh.cancel();fresh.begin(6000);assert !fresh.complete(9999);}
  HoldConfirmation retry=new HoldConfirmation();retry.begin(1000);assert retry.complete(4000);retry.retryAfterFailure();retry.begin(5000);assert !retry.complete(7999);assert retry.complete(8000);assert !retry.complete(9000);
  System.out.println("Android hold: 3 seconds, cancellation, monotonic time and one-time completion passed.");
 }
}
