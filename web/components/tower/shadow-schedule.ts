/** Slow residents move less than one shadow texel between cached maps.
 * Construction and falling debris bypass this reuse entirely. */
export function shadowSchedule(){
  let last=-Infinity,dirty=true;
  return {
    invalidate(){dirty=true;},
    due(now:number,fastMotion=false){
      if(dirty||fastMotion||now-last>=65||now<last){last=now;dirty=false;return true;}
      return false;
    },
  };
}
