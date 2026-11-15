import {sessionId,validSchedule,validSessionId, type SleepState} from './sleep-state';
import type {DeviceStatus} from './sleep-device';
export function matchingNativeWake(state:SleepState,status:DeviceStatus){
 const active=state.active,night=status.wakeNight;
 if(!night||!Number.isFinite(night.started)||!Number.isFinite(status.wokeAt)||(status.wokeAt!<night.started&&!status.clockChanged&&!night.timeReview)||!validSchedule(night.target)||!validSessionId(sessionId(night)))return false;
 const id=sessionId(night);
 if(status.protocolVersion===2&&(status.sessionId!==id||(status.wakeEvent&&(status.wakeEvent.sessionId!==id||status.wakeEvent.wokeAt!==status.wokeAt))))return false;
 return !active||(sessionId(active)===id&&active.started===night.started);
}
/** Bound to the current local session, not just to a plausible wall-clock time. */
export function acceptsDeviceStatus(active:SleepState['active'],status:DeviceStatus,revision:number){
 if(status.protocolVersion!==2)return true;
 if(!Number.isSafeInteger(status.revision)||status.revision!<revision)return false;
 return !active||status.sessionId===sessionId(active);
}
export function recordedNativeWake(state:SleepState,status:DeviceStatus){return !!status.sessionId&&state.nights.some(n=>n.sessionId===status.sessionId);}
