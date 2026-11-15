import {isAndroid,nativeCall} from './sleep-device';
/** Separate from all alarm/preview audio and vibration. */
export function createMeditationCue(){
 let context:AudioContext|null=null,stopped=false,nodes:OscillatorNode[]=[];
 return {
  async prime(){stopped=false;if(isAndroid())return;context??=new AudioContext();await context.resume();},
  async play(sessionId?:string){if(stopped)return;if(isAndroid()){await nativeCall('meditationCue',{sessionId});return;}
   if(!context||context.state!=='running')throw Error('Звук недоступен.');const now=context.currentTime;
   for(const frequency of [220,330,440]){const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.025,now+3);gain.gain.linearRampToValueAtTime(0,now+9);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(now);oscillator.stop(now+9);nodes.push(oscillator);}
  },
  stop(){stopped=true;for(const node of nodes){try{node.stop();}catch{}}nodes=[];if(isAndroid())void nativeCall('stopMeditationCue').catch(()=>{});},
  dispose(){this.stop();void context?.close();context=null;}
 };
}
