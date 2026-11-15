'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {FriendAction,FriendsState} from '../../lib/sleep-friends';
import styles from './sleep-app.module.css';
import HelpHint from './help-hint';
import SleepCirclesPanel from './sleep-circles-panel';
type Props={ownerId:string;disabled:boolean;request:(action?:FriendAction,payload?:Record<string,unknown>)=>Promise<FriendsState>};
export default function FriendsPanel({ownerId,disabled,request}:Props){
 const [state,setState]=useState<FriendsState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[code,setCode]=useState(''),[displayName,setDisplayName]=useState(''),[remove,setRemove]=useState<string|null>(null),[notice,setNotice]=useState('');const generation=useRef(0),lock=useRef(false),current=useRef({ownerId,disabled,request});current.current={ownerId,disabled,request};
 useEffect(()=>{generation.current++;setState(null);setError('');setCode('');setDisplayName('');setRemove(null);return()=>{generation.current++;};},[ownerId]);
 async function run(action:FriendAction='list',payload:Record<string,unknown>={}){if(lock.current||current.current.disabled)return;const stamp=generation.current,owner=current.current.ownerId;lock.current=true;setBusy(true);setError('');setNotice('');try{const next=await current.current.request(action,payload);if(stamp!==generation.current||owner!==current.current.ownerId)return;setState(next);setDisplayName(next.profile.name);if(action==='request'){setCode('');setNotice('Запрос отправлен. Данные откроются только после принятия дружбы и отдельного согласия.');}if(action==='share')setNotice('Доступ обновлён.');setRemove(null);}catch(e){if(stamp===generation.current)setError(e instanceof Error?e.message:'Не удалось открыть друзей.');}finally{lock.current=false;setBusy(false);}}
 useEffect(()=>{if(!state||disabled)return;const timer=setInterval(()=>{if(!document.hidden)void run();},30000);return()=>clearInterval(timer);},[!!state,disabled]);
 const blocked=disabled||busy;
 function invite(e:FormEvent){e.preventDefault();void run('request',{code:code.trim()});}
 return <section aria-label="Друзья" aria-busy={busy} className={styles.card}>
  <div className={styles.sectionHead}><h2>Друзья</h2><HelpHint label="Приватность друзей" text="Добавляй друзей по коду. Время сна и прогресс закрыты, пока ты сам не откроешь их конкретному другу. Личные заметки никогда не передаются."/></div>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{busy&&<p role="status" className={styles.fine}>Ждём подтверждения сервера…</p>}{notice&&<p role="status" className={styles.fine}>{notice}</p>}
  <button type="button" className={styles.secondary} disabled={blocked} onClick={()=>void run()}>{state?'Обновить друзей':'Открыть друзей'}</button>
  {state&&<>
   <details className={styles.inlineHelp} open={state.friends.length===0}><summary>Мой профиль и код друга</summary><form className={styles.form} onSubmit={e=>{e.preventDefault();void run('profile',{name:displayName.trim()});}}><label>Имя для друзей<input aria-label="Имя для друзей" value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={64} required disabled={blocked}/></label><button className={styles.secondary} disabled={blocked}>Сохранить имя</button></form>
   <label className={styles.form}>Твой код друга<input aria-label="Твой код друга" readOnly value={state.profile.code} onFocus={e=>e.currentTarget.select()}/></label><p className={styles.fine}>Передай код лично. Приложение само никому не пишет и не читает контакты.</p></details>
   <form className={styles.form} onSubmit={invite}><label>Код друга<input aria-label="Код друга" value={code} onChange={e=>setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={36} disabled={blocked}/></label><button className={styles.primary} disabled={blocked||code.trim().length!==36}>Добавить друга</button></form>
   {state.friends.length===0&&<p className={styles.fine}>Пока никого нет. Обменяйтесь кодами, чтобы начать.</p>}
   <SleepCirclesPanel friends={state.friends} circles={state.circles??[]} disabled={blocked} run={run}/>{state.friends.map(friend=><article className={styles.education} key={friend.id}>
    <h3>{friend.name}</h3><p className={styles.fine}>{friend.status==='accepted'?'Вы друзья':friend.direction==='incoming'?'Хочет добавить тебя в друзья':'Ожидает принятия'}</p>
    {friend.status==='pending'&&friend.direction==='incoming'&&<button className={styles.primary} disabled={blocked} onClick={()=>void run('accept',{id:friend.id})}>Принять дружбу</button>}
    {friend.status==='accepted'&&<>
     <p className={styles.fine}>Что ты разрешаешь видеть этому другу:</p>
     <label className={styles.friendPermissions}><input type="checkbox" style={{width:20,minHeight:20,margin:0}} checked={friend.sharing.sleep} disabled={blocked} onChange={e=>void run('share',{id:friend.id,sleep:e.target.checked})}/> Моё время сна</label>
     <label className={styles.friendPermissions}><input type="checkbox" style={{width:20,minHeight:20,margin:0}} checked={friend.sharing.progress} disabled={blocked} onChange={e=>void run('share',{id:friend.id,progress:e.target.checked})}/> Мой прогресс башни</label>
     {friend.sleep?<p>Последняя запись друга · {friend.sleep.date}<br/>{friend.sleep.bedClock} → {friend.sleep.wakeClock}<small className={styles.fine}> · время записи друга</small></p>:<p className={styles.fine}>Время сна закрыто или друг ещё не отправил запись на сервер.</p>}
     {friend.progress?<div className={styles.friendProgress}><svg viewBox="0 0 70 100" role="img" aria-label={`Заработано этажей: ${friend.progress.floors}`}><path d="M6 92 Q35 78 64 92L56 98H14Z" fill="var(--accent)" opacity=".2"/>{Array.from({length:Math.min(8,friend.progress.floors)},(_,i)=><rect key={i} x={16+i*.8} y={79-i*9} width={38-i*1.6} height="8" rx="2" fill="var(--accent)" opacity={.5+i*.06}/>)}</svg><p>Заработано этажей · {friend.progress.floors}<br/>Успешных ночей · {friend.progress.successfulNights}{friend.progress.garden?' · есть сад':''}</p><HelpHint label="О башне друга" text="Миниатюра показывает заработанные этажи, до восьми условных сегментов. Текущее повреждение и персонализация друга пока не синхронизируются."/></div>:<p className={styles.fine}>Прогресс башни закрыт.</p>}
    </>}
    {remove===friend.id?<div><p className={styles.fine}>Удалить связь и закрыть общий доступ с обеих сторон?</p><button className={styles.secondary} disabled={blocked} onClick={()=>void run('remove',{id:friend.id})}>Да, удалить</button><button className={styles.textButton} disabled={blocked} onClick={()=>setRemove(null)}>Оставить</button></div>:<button className={styles.textButton} disabled={blocked} onClick={()=>setRemove(friend.id)}>{friend.status==='accepted'?'Удалить друга':friend.direction==='incoming'?'Отклонить запрос':'Отменить запрос'}</button>}
   </article>)}
   <HelpHint label="О видимости записей" text="Видны только явно отправленные на сервер записи. Отзыв доступа закрывает следующие просмотры; уже увиденное или сделанный другом снимок экрана удалить нельзя."/>
  </>}
 </section>;
}
