import type {AlarmSettings} from './sleep-state';
import type {DeviceStatus} from './sleep-device';
export function alarmAudioIssue(settings:AlarmSettings,device:DeviceStatus){
 if(!settings.enabled)return null;
 const noSound=settings.volume===0||(device.native&&device.alarmSystemVolume===0);
 const vibrates=settings.vibration&&(!device.native||device.vibrationAvailable!==false);
 if(!noSound||vibrates)return null;
 return device.native&&device.alarmSystemVolume===0?'Громкость будильника Android выключена. Увеличь её в настройках звука или включи доступную вибрацию.':'Увеличь громкость или включи доступную вибрацию для будильника.';
}
