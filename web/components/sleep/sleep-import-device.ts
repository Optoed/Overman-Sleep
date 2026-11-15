/** Fresh native reads bracket import effects; no wake acknowledgement or alarm hold bypass. */
import type {DeviceStatus} from './sleep-device';
import type {SleepState} from './sleep-state';
type Options={native:boolean;assertWritable:()=>void;status:()=>Promise<DeviceStatus>;stop:(sessionId:string)=>Promise<DeviceStatus>;configure:(state:SleepState)=>Promise<DeviceStatus|void>};
function quiet(status:DeviceStatus){if(!status?.native)throw Error('Не удалось проверить состояние устройства.');if(status.ringing||status.wakeEvent||status.activeNight||status.wokeAt)throw Error('Сначала заверши ночь и сохрани подъём на устройстве.');}
export function createSleepImportDevice(options:Options){
 async function guard(disarmed=false){options.assertWritable();if(options.native){const status=await options.status();options.assertWritable();quiet(status);if(disarmed&&(status.alarmScheduleState!=='off'||status.reminderScheduleState!=='off'))throw Error('Устройство не подтвердило выключение будильника.');}}
 return{guard,async prepare(state:SleepState){if(state.active||state.alarm?.enabled||state.alarm?.reminder)throw Error('Восстановление не должно включать будильник.');await guard();if(options.native){const status=await options.status();options.assertWritable();quiet(status);const stopped=await options.stop(status.sessionId??'');options.assertWritable();quiet(stopped);}const configured=await options.configure(state);options.assertWritable();if(options.native){if(!configured)throw Error('Устройство не подтвердило выключение будильника.');quiet(configured);if(configured.alarmScheduleState!=='off'||configured.reminderScheduleState!=='off')throw Error('Устройство не подтвердило выключение будильника.');}await guard(true);}};
}
