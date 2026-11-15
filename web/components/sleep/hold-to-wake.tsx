'use client';
import { useEffect, useRef, useState } from 'react';
import { Sun } from 'lucide-react';
import { HoldConfirmation } from './hold-confirmation';
import styles from './sleep-app.module.css';

/** Confirmation uses elapsed monotonic time; releasing or leaving cancels it. */
export default function HoldToWake({onWake,disabled=false}:{onWake:()=>Promise<void>|void;disabled?:boolean}) {
  const [progress,setProgress]=useState(0),[busy,setBusy]=useState(false);
  const hold=useRef(new HoldConfirmation()),frame=useRef(0),locked=useRef(false),action=useRef(onWake);
  action.current=onWake;
  function cancel(input?:string){if(!hold.current.cancel(input))return;cancelAnimationFrame(frame.current);setProgress(0);}
  function begin(input:string){
    if(disabled||locked.current||!hold.current.begin(input,performance.now()))return false;
    const tick=()=>{
      if(!hold.current.owns(input))return;
      const now=performance.now();setProgress(hold.current.progress(now));
      if(!hold.current.complete(now)){frame.current=requestAnimationFrame(tick);return;}
      locked.current=true;setBusy(true);
      Promise.resolve().then(()=>action.current()).finally(()=>{locked.current=false;setBusy(false);setProgress(0);});
    };
    frame.current=requestAnimationFrame(tick);
    return true;
  }
  useEffect(()=>{const blur=()=>cancel(),hide=()=>{if(document.hidden)cancel();};document.addEventListener('visibilitychange',hide);window.addEventListener('blur',blur);return()=>{hold.current.cancel();cancelAnimationFrame(frame.current);document.removeEventListener('visibilitychange',hide);window.removeEventListener('blur',blur);};},[]);
  useEffect(()=>{if(disabled)cancel();},[disabled]);
  return <button className={styles.holdWake} disabled={disabled||busy} aria-label="Удерживать «Проснуться» 3 секунды"
    onContextMenu={e=>e.preventDefault()}
    onPointerDown={e=>{if(e.button===0&&begin(`pointer:${e.pointerId}`))e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(!hold.current.owns(`pointer:${e.pointerId}`))return;const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>=b.right||e.clientY<b.top||e.clientY>=b.bottom)cancel(`pointer:${e.pointerId}`);}}
    onPointerLeave={e=>cancel(`pointer:${e.pointerId}`)}
    onPointerUp={e=>cancel(`pointer:${e.pointerId}`)} onPointerCancel={e=>cancel(`pointer:${e.pointerId}`)} onLostPointerCapture={e=>cancel(`pointer:${e.pointerId}`)} onBlur={()=>cancel()}
    onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat)begin(`key:${e.key}`);}}}
    onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();cancel(`key:${e.key}`);}}}>
    <i aria-hidden="true" style={{transform:`scaleX(${progress})`}}/>
    <span><Sun size={21}/>{busy?'Сохраняем подъём…':progress>0?`Проснуться · ${Math.ceil((1-progress)*3)} с`:'Проснуться'}</span>
    <small>{busy?'':progress>0?'Продолжай удерживать':'Удерживай 3 секунды'}</small>
  </button>;
}
