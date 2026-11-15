import type {SleepState} from './sleep-state';
import {APPEARANCES,appearanceOf} from './sleep-themes';
const dayPalettes={
 journal:['#f4eee1','#fffbf2','#e9dfcd','#30251b','#695744','#805429'],
 sunset:['#fbedef','#fff7f8','#f0dce2','#422236','#785363','#a03c57'],
 morning:['#f6f4df','#fffef3','#e8e5c7','#25270f','#65653e','#686300'],
 clay:['#f3e9e0','#fff9f2','#e5d6c8','#3c291e','#715642','#92502a'],
 lunar:['#eeebf9','#fbf9ff','#dfdaef','#302543','#67587c','#7044a0'],
 swiss:['#efefed','#ffffff','#dededb','#171717','#5e5e5c','#ab3325'],
 night:['#f2f5f1','#ffffff','#e6eee8','#19322c','#526b63','#20644e'],
 light:['#f2f5f1','#ffffff','#e6eee8','#19322c','#526b63','#20644e']
} as const;
export function resolvedAppearance(state:Pick<SleepState,'appearance'|'theme'|'appearanceMode'|'active'>,now:number,ringing=false){
 const selected=appearanceOf(state),auto=state.appearanceMode!=='fixed',hour=new Date(now).getHours();
 const mode=auto?(state.active||ringing||hour<7||hour>=20?'night':'light'):selected.mode;
 if(mode===selected.mode)return selected;
 if(mode==='night')return {...APPEARANCES.find(t=>t.id==='night')!,id:selected.id,name:selected.name};
 const [bg,surface,surface2,text,muted,accent]=dayPalettes[selected.id];
 return {...selected,mode,bg,surface,surface2,text,muted,accent,onAccent:'#ffffff',warm:accent,line:muted+'55'};
}
