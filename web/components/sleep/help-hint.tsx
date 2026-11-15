'use client';
import {useEffect,useLayoutEffect,useId,useRef,useState} from 'react';
import {Info} from 'lucide-react';
import styles from './sleep-app.module.css';
/** Hover on desktop, keyboard focus or an explicit tap on touch screens. */
export default function HelpHint({label,text}:{label:string;text:string}){
 const id=useId(),root=useRef<HTMLSpanElement>(null),bubble=useRef<HTMLSpanElement>(null),[open,setOpen]=useState(false),pinned=useRef(false),[position,setPosition]=useState({left:16,top:16});
 useLayoutEffect(()=>{if(!open)return;const place=()=>{const anchor=root.current?.getBoundingClientRect(),tip=bubble.current?.getBoundingClientRect();if(!anchor||!tip)return;const left=Math.max(16,Math.min(anchor.right-tip.width,window.innerWidth-tip.width-16)),top=anchor.bottom+tip.height+12<=window.innerHeight?anchor.bottom+6:Math.max(16,anchor.top-tip.height-6);setPosition({left,top});};place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};},[open]);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)){pinned.current=false;setOpen(false);}};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
 return <span ref={root} className={styles.helpHint} onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>{if(!pinned.current)setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'){pinned.current=false;setOpen(false);}}}>
  <button type="button" aria-label={label} aria-expanded={open} aria-describedby={open?id:undefined} onFocus={()=>setOpen(true)} onBlur={()=>{pinned.current=false;setOpen(false);}} onClick={()=>{pinned.current=!pinned.current;setOpen(pinned.current);}}><Info size={17}/></button>
  <span ref={bubble} id={id} role="tooltip" hidden={!open} className={styles.helpBubble} style={{position:'fixed',left:position.left,top:position.top,right:'auto',maxHeight:'calc(100dvh - 32px)',overflowY:'auto'}}>{text}</span>
 </span>;
}
