'use client';
import {useRef,useState,useEffect,useId,type PointerEvent} from 'react';
import {Moon} from 'lucide-react';
import {clockMinutes,type Schedule} from './sleep-state';
import {clockLabel} from './sleep-insights';
import {angleAt,angleDelta,shiftSleepWindow} from './sleep-dial-gesture';
import styles from './sleep-app.module.css';
type Drag={id:number;last:number;delta:number;x:number;y:number;moved:boolean;base:Schedule};
export default function SleepDial({schedule,onEdit,onShift,disabled=false}:{schedule:Schedule;onEdit:()=>void;onShift:(next:Schedule,base:Schedule)=>Promise<unknown>;disabled?:boolean}){
 const drag=useRef<Drag|null>(null),[preview,setPreview]=useState<Schedule|null>(null),[saving,setSaving]=useState(false),hint=useId();
 const value=preview??schedule,duration=(clockMinutes(value.wake)-clockMinutes(value.bed)+1440)%1440;
 useEffect(()=>{if(disabled){drag.current=null;setPreview(null);}},[disabled]);
 const a=clockMinutes(value.bed)/1440*2*Math.PI-Math.PI/2,b=a+duration/1440*2*Math.PI;
 const p=(angle:number)=>({x:170+Math.cos(angle)*128,y:170+Math.sin(angle)*128}),start=p(a),end=p(b);
 const path=`M ${start.x} ${start.y} A 128 128 0 ${duration>720?1:0} 1 ${end.x} ${end.y}`;
 function pointerAngle(e:PointerEvent<SVGPathElement>){const r=e.currentTarget.ownerSVGElement!.getBoundingClientRect();return angleAt(e.clientX,e.clientY,r.left+r.width/2,r.top+r.height/2);}
 function down(e:PointerEvent<SVGPathElement>){if(disabled||saving||!e.isPrimary||e.button!==0||drag.current)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,last:pointerAngle(e),delta:0,x:e.clientX,y:e.clientY,moved:false,base:{...schedule}};}
 function move(e:PointerEvent<SVGPathElement>){const d=drag.current;if(!d||e.pointerId!==d.id)return;const angle=pointerAngle(e);d.delta+=angleDelta(d.last,angle);d.last=angle;d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>6;if(d.moved)setPreview(shiftSleepWindow(d.base,d.delta/(2*Math.PI)*1440));}
 async function save(next:Schedule,base:Schedule){setSaving(true);try{await onShift(next,base);}finally{setSaving(false);setPreview(null);}}
 function up(e:PointerEvent<SVGPathElement>){const d=drag.current;if(!d||e.pointerId!==d.id)return;move(e);drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);const next=shiftSleepWindow(d.base,d.delta/(2*Math.PI)*1440);if(!disabled&&d.moved&&(next.bed!==d.base.bed||next.wake!==d.base.wake))void save(next,d.base);else{setPreview(null);if(!d.moved&&!disabled)onEdit();}}
 function cancel(){drag.current=null;setPreview(null);}
 return <div className={styles.dialWrap} data-sleep-dial data-dragging={!!preview}>
 <div className={styles.sleepDial}>
 <svg viewBox="0 0 340 340" aria-label="Режим сна" style={{touchAction:'none'}}><circle cx="170" cy="170" r="128" fill="none" stroke="currentColor" opacity=".12" strokeWidth="14"/>
 <path d={path} fill="none" stroke="var(--accent)" strokeWidth="16" strokeLinecap="round"/>
 <circle cx={start.x} cy={start.y} r="7" fill="var(--text)"/><circle cx={end.x} cy={end.y} r="7" fill="var(--warm)"/>
 <path data-dial-arc d={path} fill="none" stroke="transparent" strokeWidth="48" role="slider" tabIndex={disabled||saving?-1:0} aria-label="Сдвинуть время сна и подъёма" aria-describedby={hint} aria-disabled={disabled||saving} aria-valuemin={0} aria-valuemax={1439} aria-valuenow={clockMinutes(value.bed)} aria-valuetext={`${value.bed} — ${value.wake}; ${clockLabel(duration).replace(/^0/,'')} сна`} style={{touchAction:'none',cursor:disabled?'default':'grab',pointerEvents:disabled||saving?'none':'stroke'}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current)cancel();}} onKeyDown={e=>{const delta=e.key==='ArrowRight'||e.key==='ArrowUp'?15:e.key==='ArrowLeft'||e.key==='ArrowDown'?-15:0;if(delta&&!disabled&&!saving){e.preventDefault();void save(shiftSleepWindow(schedule,delta),schedule);}}}/></svg>
 <button className={styles.dialCenter} disabled={disabled||saving} onClick={onEdit} aria-label={`Настроить режим: ${value.bed} — ${value.wake}`}><Moon size={20}/><strong>{clockLabel(duration).replace(/^0/,'')}</strong><span>часов сна</span><small>{value.bed} <i>→</i> {value.wake}</small></button>
 </div><p id={hint} className={styles.dialHint}>{saving?'Сохраняем…':'Сдвигай дугу · длительность сохранится'}</p>
 </div>;
}
