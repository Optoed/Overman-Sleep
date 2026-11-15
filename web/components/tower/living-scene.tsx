'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { WorldState } from './world-state';
import type { WorldRenderer } from './world-renderer';
import type {TowerDamageView} from './tower-ruins';
import styles from './living.module.css';

// Visual acknowledgement lasts for this app session only; it never writes the diary.
const seenDamage=new Map<string,number>();
function applyDamage(instance:WorldRenderer,world:WorldState,view:TowerDamageView|null){
 const scope=view?`${world.seed}:${view.scope}`:'',previous=seenDamage.get(scope);
 const animate=!!view&&(view.status==='damaged'||view.status==='collapsed')&&(previous===undefined||view.integrity<previous);
 instance.damage?.(view,animate);
 if(view){seenDamage.delete(scope);seenDamage.set(scope,view.integrity);if(seenDamage.size>32)seenDamage.delete(seenDamage.keys().next().value!);}
}
export default function LivingScene({world,api,reduced,quality,speed,damage=null}:{world:WorldState;api:RefObject<WorldRenderer|null>;reduced:boolean;quality:'high'|'low';speed:number;damage?:TowerDamageView|null}){
  const host=useRef<HTMLDivElement>(null),latest=useRef(world);
  const latestDamage=useRef(damage);latestDamage.current=damage;
  const [status,setStatus]=useState<'loading'|'ready'|'failed'>('loading');
  latest.current=world;
  const latestSpeed=useRef(speed);latestSpeed.current=speed;
  useEffect(()=>{
    let cancelled=false,instance:WorldRenderer|null=null;
    setStatus('loading');
    import('./world-renderer').then(({createWorldRenderer})=>{
      if(cancelled||!host.current)return;
      try{instance=createWorldRenderer(host.current,latest.current,reduced,quality);instance.speed(latestSpeed.current);applyDamage(instance,latest.current,latestDamage.current);api.current=instance;setStatus('ready');}
      catch(error){console.error('Tower renderer unavailable',error);setStatus('failed');}
    }).catch(()=>{if(!cancelled)setStatus('failed');});
    return()=>{cancelled=true;instance?.dispose();if(api.current===instance)api.current=null;};
  },[world.seed,world.material,world.biome,reduced,quality,api]);
  useEffect(()=>{api.current?.update(world);},[world,api]);
  useEffect(()=>{if(api.current)applyDamage(api.current,world,damage);},[world,damage,api]);
  useEffect(()=>{api.current?.speed(speed);},[speed,api]);
  return <div className={styles.sceneHost} ref={host} data-scene-status={status}>
    {status==='loading'&&<div className={styles.sceneLoading}><span/><p>Остров появляется из тумана</p></div>}
    {status==='failed'&&<div className={styles.fallback}><p>Остров пока скрыт туманом</p><span>Для живой сцены нужен WebGL. Прогресс и дневник доступны ниже.</span><a href="/concept">Открыть иллюстрированный макет</a></div>}
    <div className={styles.contextLost}><p>Графическая сцена приостановлена</p><button onClick={()=>window.location.reload()}>Вернуться на остров</button></div>
  </div>;
}
