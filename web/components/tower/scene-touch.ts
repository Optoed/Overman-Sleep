/** Horizontal orbit and two-finger zoom leave vertical page scrolling to the browser. */
export function sceneTouch(canvas:HTMLElement,rotate:(pixels:number)=>void,zoom:(factor:number)=>void){
  type Point={identifier:number;clientX:number;clientY:number};
  let mode:'idle'|'pending'|'scroll'|'rotate'|'pinch'='idle',origin:Point|undefined,last:Point|undefined,gap=0;
  const previousAction=canvas.style.touchAction;canvas.style.touchAction='auto';
  const points=(e:TouchEvent)=>Array.from(e.targetTouches),distance=(p:Point[])=>Math.hypot(p[0].clientX-p[1].clientX,p[0].clientY-p[1].clientY);
  const reset=()=>{mode='idle';origin=last=undefined;gap=0;};
  const start=(e:TouchEvent)=>{const p=points(e);if(mode==='scroll')return;if(p.length>=2){mode='pinch';gap=distance(p);e.preventDefault();}else if(p.length===1){origin=last=p[0];mode='pending';}};
  const move=(e:TouchEvent)=>{const p=points(e);if(mode==='scroll'||!p.length)return;
    if(mode==='pinch'){e.preventDefault();if(p.length<2)return;const next=distance(p);if(gap>0&&next>0)zoom(gap/next);gap=next;return;}
    if(!origin||!last||p.length!==1||p[0].identifier!==origin.identifier)return;
    const dx=p[0].clientX-origin.clientX,dy=p[0].clientY-origin.clientY;
    if(mode==='pending'){if(Math.max(Math.abs(dx),Math.abs(dy))<8)return;if(Math.abs(dy)>=Math.abs(dx)){mode='scroll';return;}mode='rotate';}
    if(mode==='rotate'){e.preventDefault();rotate(p[0].clientX-last.clientX);last=p[0];}
  };
  // Prevent OrbitControls' pointer handler from claiming a touch before axis selection.
  const pointer=(e:PointerEvent)=>{if(e.pointerType==='touch')e.stopImmediatePropagation();};
  const end=(e:TouchEvent)=>{if(!e.targetTouches.length)reset();else if(mode==='pinch'){mode='scroll';origin=last=undefined;gap=0;}};
  const blur=()=>reset();canvas.addEventListener('pointerdown',pointer,true);canvas.addEventListener('touchstart',start,{passive:false});canvas.addEventListener('touchmove',move,{passive:false});canvas.addEventListener('touchend',end);canvas.addEventListener('touchcancel',blur);window.addEventListener('blur',blur);
  return{dispose(){reset();canvas.removeEventListener('pointerdown',pointer,true);canvas.removeEventListener('touchstart',start);canvas.removeEventListener('touchmove',move);canvas.removeEventListener('touchend',end);canvas.removeEventListener('touchcancel',blur);window.removeEventListener('blur',blur);canvas.style.touchAction=previousAction;}};
}
