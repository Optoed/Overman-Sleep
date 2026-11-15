import { defaultAlarm, type AlarmSettings, type Schedule } from './sleep-state';
import { createNativeRequests } from './native-requests';
export type DeviceStatus={reminderScheduleState?:'off'|'scheduled'|'permission_required'|'not_scheduled';reminderNotifications?:boolean;nextReminderAt?:number;reminderBedtimeAt?:number;reminderTimeZone?:string;reminderScheduleError?:string;alarmOccurrence?:number;pendingMorningAlarm?:boolean;skippedAlarmAt?:number;alarmRepeatsDaily?:boolean;tomorrowAlarmEnabled?:boolean;alarmClock?:string;fullScreen?:boolean;alarmSystemVolume?:number;alarmSystemVolumeMax?:number;vibrationAvailable?:boolean;previewPlaying?:boolean;previewTone?:string;alarmScheduleState?:'off'|'scheduled'|'permission_required'|'not_scheduled';nextAlarmAt?:number;alarmTimeZone?:string;alarmScheduleError?:string;native:boolean;exact:boolean;notifications:boolean;microphone:boolean;tracking?:boolean;noiseDbfs?:number;smartReason?:string;wokeAt?:number;activeNight?:{id?:string;started:number;target:Schedule};wakeOffset?:number;clockChanged?:boolean;wakeNight?:{id?:string;bedOffset?:number;timeReview?:boolean;started:number;target:Schedule};ringing?:boolean;protocolVersion?:number;sessionId?:string;revision?:number;wakeEvent?:{id:string;sessionId:string;wokeAt:number}};
declare global {interface Window {OvermanAndroid?:{readLaunchTarget?:()=>string;clearLaunchTarget?:(id:string)=>boolean;invoke:(method:string,body:string,id:string)=>void;readSleepArchive?:(key:string)=>string;writeSleepArchive?:(key:string,expected:string|null,raw:string)=>string;saveMorningDraft?:(body:string)=>boolean;readMorningDraft?:()=>string;clearMorningDraft?:(sessionId:string)=>boolean};overmanNativeReply?:(id:string,result:unknown,error?:string)=>void;}}
let requests:ReturnType<typeof createNativeRequests>|undefined;
export const isAndroid=()=>typeof window!=='undefined'&&!!window.OvermanAndroid;
export function nativeCall<T=DeviceStatus>(method:string,body:unknown={}):Promise<T>{
  if(!isAndroid())return Promise.reject(Error('Доступно в Android-приложении.'));
  requests??=createNativeRequests((method,body,id)=>window.OvermanAndroid!.invoke(method,body,id));
  if(window.overmanNativeReply!==requests.reply)window.overmanNativeReply=requests.reply;
  return requests.call<T>(method,body);
}
export const deviceStatus=()=>isAndroid()?nativeCall('status'):Promise.resolve<DeviceStatus>({native:false,exact:false,notifications:false,microphone:false});
export async function syncDevice(schedule:Schedule,alarm:AlarmSettings=defaultAlarm,expectedSessionId=''){if(isAndroid())return nativeCall('configure',{schedule,alarm,expectedSessionId});}

let audio:AudioContext|null=null;
const signal={nodes:[] as OscillatorNode[],timer:undefined as ReturnType<typeof setTimeout>|undefined,generation:0,active:false};
const previewSound={nodes:[] as OscillatorNode[],generation:0};
function clearNodes(channel:typeof previewSound){++channel.generation;channel.nodes.forEach(n=>{try{n.stop();}catch{}});channel.nodes=[];}
/** Preview controls never own the alarm's audio, timer or vibration. */
export function stopPreview(){clearNodes(previewSound);if(isAndroid())void nativeCall('stopPreview').catch(()=>{});}
export function stopTone(){signal.active=false;clearTimeout(signal.timer);clearNodes(signal);stopPreview();if(typeof navigator!=='undefined'&&navigator.vibrate)navigator.vibrate(0);}
export async function playTone(settings:AlarmSettings,preview=false){
  if(preview&&signal.active)return;
  if(preview&&isAndroid()){await nativeCall('preview',{alarm:settings});return;}
  const channel=preview?previewSound:signal;
  clearNodes(channel);const generation=channel.generation;
  if(!preview){signal.active=true;clearTimeout(signal.timer);stopPreview();}
  audio??=new AudioContext();await audio.resume();
  // A close/confirmed wake may happen while the browser resumes audio.
  if(channel.generation!==generation||(preview&&signal.active))return;
  const start=audio.currentTime;
  const play=(offset:number,freq:number,length:number)=>{const o=audio!.createOscillator(),g=audio!.createGain();o.type='sine';o.frequency.setValueAtTime(freq,start+offset);g.gain.setValueAtTime(0,start+offset);g.gain.linearRampToValueAtTime(settings.volume*.16,start+offset+.08);g.gain.linearRampToValueAtTime(0,start+offset+length);o.connect(g);g.connect(audio!.destination);o.start(start+offset);o.stop(start+offset+length);channel.nodes.push(o);};
  const pattern=settings.ringtone==='bell'?[659,830,987]:settings.ringtone==='birds'?[1046,1318,1174,1568]:[261,329,392,523];
  pattern.forEach((f,i)=>play(i*.3,f,1));if(!preview&&settings.vibration&&navigator.vibrate)navigator.vibrate([250,150,250]);
  if(!preview)signal.timer=setTimeout(()=>{void playTone(settings);},3500);
}
export async function primeAudio(){if(isAndroid())return;audio??=new AudioContext();await audio.resume();}
/** Raw microphone amplitude, not calibrated environmental dB SPL. No audio is saved. */
export async function monitorNoise(onLevel:(v:number)=>void){
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  const ctx=new AudioContext(),source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();analyser.fftSize=2048;source.connect(analyser);const values=new Float32Array(analyser.fftSize);
  const tick=setInterval(()=>{analyser.getFloatTimeDomainData(values);const power=values.reduce((s,v)=>s+v*v,0)/values.length;onLevel(Math.max(-120,Math.min(0,10*Math.log10(Math.max(power,1e-12)))));},1000);
  return ()=>{clearInterval(tick);source.disconnect();stream.getTracks().forEach(t=>t.stop());void ctx.close();};
}
