'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {createSleepProductSync,sleepProductSyncMessage,type SleepProductSyncView} from '../../lib/sleep-product-sync';
import {type SleepState,type Night} from './sleep-state';
import {readBackup} from './sleep-insights';
import {isAndroid} from './sleep-device';
import styles from './sleep-app.module.css';
import FriendsPanel from './friends-panel';
type Props={hidden:boolean;disabled:boolean;getStorage:()=>Pick<Storage,'getItem'|'setItem'>;getState:()=>SleepState;assertWritable:()=>void;onSaved:(state:SleepState)=>void;registerImport:(handler:((file:File)=>Promise<void>)|null)=>void;guardImport:()=>Promise<void>;prepareImportCommit:(state:SleepState)=>Promise<void>;restoreImportDevice:(state:SleepState)=>Promise<void>;runAction:(action:()=>void|Promise<void>)=>Promise<unknown>};
const consent={display:'flex',alignItems:'center',gap:10,minHeight:44} as const;
const consentInput={width:20,height:20,minHeight:20,margin:0,padding:0,flexShrink:0,accentColor:'var(--accent)'};
const accountInput={color:'var(--text)',background:'var(--surface2)'};
const dateLabel=(day:string)=>new Date(day+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
function Entry({night}:{night:Night|null}){return night?<div className={styles.fine}><p>{night.bedClock} → {night.wakeClock} · {Math.floor(night.sleepMinutes/60)} ч {Math.round(night.sleepMinutes%60)} мин · самочувствие {night.rested}/5</p><p>Цель: {night.target.bed} → {night.target.wake} · {night.target.hours} ч · ±{night.target.tolerance} мин</p>{night.note&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{night.note}</p>}</div>:<p className={styles.fine}>Записи нет</p>;}
export default function SleepSyncPanel(props:Props){
 const current=useRef(props);current.current=props;
 const [controller]=useState(()=>createSleepProductSync({getStorage:()=>current.current.getStorage(),getState:()=>current.current.getState(),assertWritable:()=>current.current.assertWritable(),onSaved:s=>current.current.onSaved(s),guardImport:()=>current.current.guardImport(),prepareImportCommit:s=>current.current.prepareImportCommit(s),restoreImportDevice:s=>current.current.restoreImportDevice(s),allowLoopbackHttp:!isAndroid()&&['127.0.0.1','localhost','[::1]'].includes(location.hostname)}));
 const [view,setView]=useState<SleepProductSyncView>(()=>controller.view()),[error,setError]=useState(''),[notice,setNotice]=useState(''),[mode,setMode]=useState<'login'|'register'>('login'),[confirmed,setConfirmed]=useState(false),[shown,setShown]=useState(50),[legacyConfirmed,setLegacyConfirmed]=useState(false),[stopConfirmed,setStopConfirmed]=useState(false),[importConfirmed,setImportConfirmed]=useState(false),[resumeConfirmed,setResumeConfirmed]=useState(false),[recoverConfirmed,setRecoverConfirmed]=useState(false);
 const resumeFile=useRef<HTMLInputElement>(null);
 const [address,setAddress]=useState(()=>controller.view().binding?.serverOrigin??(!isAndroid()&&['127.0.0.1','localhost','[::1]'].includes(location.hostname)?'http://127.0.0.1:3902':''));
 function refresh(){try{setView(controller.view());}catch(e){setError(sleepProductSyncMessage(e));}}
 useEffect(()=>{if(props.hidden||props.disabled||controller.view().origin)return;const native=isAndroid(),loopback=['127.0.0.1','localhost','[::1]'].includes(location.hostname),target=controller.view().binding?.serverOrigin||process.env.NEXT_PUBLIC_OVERMAN_API_ORIGIN||(!native&&!loopback?location.origin:'');if(target)try{setAddress(target);setView(controller.configure(target));}catch(e){setError(sleepProductSyncMessage(e));}},[controller,props.hidden,props.disabled]);
 useEffect(()=>{refresh();},[props.hidden,props.disabled]);
 async function run(action:()=>void|Promise<void>){await current.current.runAction(async()=>{setError('');setNotice('');try{await action();refresh();}catch(e){setError(sleepProductSyncMessage(e));refresh();}});}
 function configure(e:FormEvent<HTMLFormElement>){e.preventDefault();void run(()=>{setView(controller.configure(address));setNotice('Адрес сервера выбран.');});}
 function signIn(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,data=new FormData(form),login=String(data.get('login')??''),password=String(data.get('password')??'');form.reset();void run(async()=>{setView(await controller.signIn(mode,login,password));setNotice('Вход выполнен. Сначала сравни записи.');});}
 function resetReview(){setConfirmed(false);setLegacyConfirmed(false);setStopConfirmed(false);setImportConfirmed(false);setResumeConfirmed(false);setRecoverConfirmed(false);setShown(50);}
 useEffect(()=>{current.current.registerImport(async file=>{await run(async()=>{resetReview();if(file.size>3500000)throw Error('Файл больше 3,5 МБ.');setView(await controller.prepareImport(readBackup(await file.text())));});});return()=>current.current.registerImport(null);},[controller]);
 async function resumeSelected(file:File){await run(async()=>{const agreed=resumeConfirmed;resetReview();if(file.size>3500000)throw Error('Файл больше 3,5 МБ.');setView(await controller.resumeImport(readBackup(await file.text()),agreed));});}
 const blocked=props.disabled,binding=view.binding,pause=binding?.importPaused||binding?.legacyPaused;
 return <section className={styles.card} style={props.hidden?{display:'none'}:undefined} aria-label="Аккаунт и копия на сервере">
  <h2>Аккаунт и копия на сервере</h2>
  <p className={styles.fine}>Дневник работает без сети. Обмен записями — только по твоей команде.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.fine}>{notice}</p>}
  {!view.profile&&<>
   <details className={styles.details} open={!view.origin}><summary>{view.origin?'Подключение к серверу':'Подключить аккаунт'}</summary><form className={styles.form} onSubmit={configure}>
    <label>Адрес своего сервера<input style={accountInput} type="url" aria-label="Адрес своего сервера" value={address} onChange={e=>setAddress(e.target.value)} placeholder="https://…" autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={blocked}/></label>
    <button className={styles.secondary} disabled={blocked} type="submit">Выбрать сервер</button>
   </form></details>
   {view.origin&&<>
    <p className={styles.fine}>Сервер: {view.origin}</p>
    <div className={styles.fields}><button className={styles.secondary} aria-pressed={mode==='login'} onClick={()=>setMode('login')} disabled={blocked}>У меня есть аккаунт</button><button className={styles.secondary} aria-pressed={mode==='register'} onClick={()=>setMode('register')} disabled={blocked}>Создать аккаунт</button></div>
    <form className={styles.form} onSubmit={signIn}>
     <label>Логин<input style={accountInput} name="login" aria-label="Логин аккаунта" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} maxLength={32} pattern="[A-Za-z0-9_]{3,32}" required disabled={blocked}/></label>
     <label>Пароль<input style={accountInput} name="password" aria-label="Пароль аккаунта" type="password" autoComplete={mode==='register'?'new-password':'current-password'} minLength={15} maxLength={256} required disabled={blocked}/></label>
     <p className={styles.fine}>Логин: 3–32 латинские буквы, цифры или _. Пароль: 15–128 символов. После закрытия приложения нужно войти снова.</p>
     <button className={styles.primary} disabled={blocked} type="submit">{mode==='register'?'Зарегистрироваться':'Войти'}</button>
    </form>
   </>}
  </>}
  {view.profile&&<>
   <FriendsPanel key={view.origin+view.profile.userId} ownerId={view.profile.userId} disabled={blocked||props.hidden} request={controller.friends}/>
   <p className={styles.fine}>Аккаунт: <strong>{view.profile.username}</strong> · {view.origin}</p>
   <p className={styles.fine}>{binding?.reviewed?'Ожидают отправки: '+binding.pending:'Связь дневника с аккаунтом ещё не подтверждена.'}</p>
   {pause&&<p className={styles.fine}>Остался незавершённый перенос. Локальные записи сохранены; обмен приостановлен.</p>}
   <button className={styles.secondary} disabled={blocked||!!pause} onClick={()=>void run(async()=>{resetReview();setView(await controller.compare());})}>Сравнить записи</button>
   <button className={styles.secondary} disabled={blocked||!!pause||!binding?.serverOrigin||!binding.pending} onClick={()=>void run(async()=>{resetReview();setView(await controller.sendNext());})}>Отправить следующую запись{binding?.pending?' · '+binding.pending:''}</button>
   {!pause&&<details className={styles.details}><summary>Награды из старого дневника</summary><p className={styles.fine}>Перенеси сохранённые награды, у которых больше нет исходных записей сна. Перед отправкой будет отдельное подтверждение.</p><button className={styles.secondary} disabled={blocked} onClick={()=>void run(async()=>{resetReview();const next=await controller.prepareLegacy();setView(next);if(!next.legacy)setNotice('Старых наград для переноса нет. Сравни записи обычным способом.');})}>Проверить старые награды</button></details>}
   <p className={styles.fine}>Сравнение читает сервер. Отправка выполняется отдельной кнопкой, по одной записи. Выход не удаляет дневник.</p>
   <button className={styles.textButton} disabled={blocked} onClick={()=>void run(async()=>{resetReview();await controller.logout();setNotice('Ты вышел. Записи остались на устройстве.');})}>Выйти из аккаунта</button>
  </>}
  {view.profile&&view.importPlan&&<div className={styles.form} aria-label="Подготовка восстановления">
   <h3>Заменить дневник из копии?</h3><p className={styles.fine}>Записи: {view.importPlan.nights} · награды: {view.importPlan.credits}. Копия заменит записи. Сохранённые награды останутся; будильник и напоминания будут выключены.</p>
   <p className={styles.fine}>Остановим прежние отправки: {view.importPlan.pending}. Уже принятые сервером записи и награды останутся. Исходный дневник сохраним на устройстве, затем покажем сравнение.</p>
   {!!view.importPlan.unverifiedCredits&&<><p className={styles.fine}>В копии есть старые награды без исходной успешной записи: {view.importPlan.unverifiedCredits}. Сначала перенеси их, затем снова выбери этот файл.</p><button className={styles.secondary} disabled={blocked} onClick={()=>void run(async()=>{resetReview();setView(await controller.prepareImportLegacy());})}>Проверить старые награды из копии</button></>}
   <label><span style={consent}><input style={consentInput} type="checkbox" checked={importConfirmed} onChange={e=>setImportConfirmed(e.target.checked)} disabled={blocked}/> Заменить записи и остановить прежние отправки</span></label>
   <button className={styles.primary} disabled={blocked||!importConfirmed||!!view.importPlan.unverifiedCredits} onClick={()=>void run(async()=>{const agreed=importConfirmed;resetReview();setView(await controller.startImport(agreed));})}>Начать восстановление копии</button>
   <button className={styles.secondary} disabled={blocked} onClick={()=>void run(()=>{resetReview();setView(controller.discard());})}>Отменить подготовку восстановления</button>
  </div>}
  {view.profile&&binding?.importPaused&&!view.review&&<div className={styles.form} aria-label="Незавершённое восстановление">
   <h3>Восстановление не завершено</h3><p className={styles.fine}>Текущие записи доступны. Выбери тот же файл для продолжения или сохрани текущий дневник вместо копии. Уже выполненная на сервере остановка отправок не отменяется.</p>
   <label><span style={consent}><input style={consentInput} type="checkbox" checked={resumeConfirmed} onChange={e=>setResumeConfirmed(e.target.checked)} disabled={blocked}/> Продолжить восстановление с тем же файлом</span></label>
   <button className={styles.secondary} disabled={blocked||!resumeConfirmed} onClick={()=>resumeFile.current?.click()}>Выбрать тот же файл и продолжить</button><input ref={resumeFile} className={styles.srOnly} type="file" aria-label="Файл для продолжения восстановления" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void resumeSelected(file);e.target.value='';}}/>
   <label><span style={consent}><input style={consentInput} type="checkbox" checked={recoverConfirmed} onChange={e=>setRecoverConfirmed(e.target.checked)} disabled={blocked}/> Сохранить текущий дневник вместо копии</span></label>
   <button className={styles.secondary} disabled={blocked||!recoverConfirmed} onClick={()=>void run(async()=>{const agreed=recoverConfirmed;resetReview();setView(await controller.recoverImport(agreed));})}>Восстановить обмен текущих записей</button>
  </div>}
  {view.profile&&view.legacy&&<div className={styles.form} aria-label="Перенос старых наград">
   <h3>{view.legacy.stage==='prepare'?'Старые награды к переносу':'Перенос не завершён'}</h3>
   <p className={styles.fine}>Дат с сохранённой наградой: {view.legacy.dates.length}. {view.legacy.garden?'Открытый сад тоже сохранится.':'Перенос сада не требуется.'}</p>
   <p className={styles.fine}>Это прогресс из старого дневника. Исходные записи сна не создаются заново. Сервер: {view.origin}</p>
   {!!view.legacy.dates.length&&<details><summary>Даты старых наград</summary><ul>{view.legacy.dates.slice(0,shown).map(day=><li key={day}>{dateLabel(day)}</li>)}</ul>{view.legacy.dates.length>shown&&<button className={styles.secondary} onClick={()=>setShown(v=>v+50)}>Показать ещё 50</button>}</details>}
   {view.reviewKind!=='legacy'&&<>
    <label><span style={consent}><input style={consentInput} type="checkbox" checked={legacyConfirmed} onChange={e=>setLegacyConfirmed(e.target.checked)} disabled={blocked}/> {view.legacy.stage==='prepare'?'Сохранить эти старые награды на сервере':'Повторить этот перенос на выбранный сервер'}</span></label>
    <button className={styles.primary} disabled={blocked||!legacyConfirmed} onClick={()=>void run(async()=>{const agreed=legacyConfirmed;resetReview();setView(view.legacy?.stage==='prepare'?await controller.startLegacy(agreed):await controller.resumeLegacy(agreed));})}>{view.legacy.stage==='prepare'?'Начать перенос старых наград':'Возобновить перенос старых наград'}</button>
    {view.legacy.stage==='prepare'?<button className={styles.secondary} disabled={blocked} onClick={()=>void run(()=>{setView(controller.discard());resetReview();})}>Отменить подготовку переноса</button>:<details className={styles.details}><summary>Остановить повторную отправку</summary><p className={styles.fine}>Локальные награды останутся. Уже сохранённый на сервере прогресс не отменяется и вернётся при следующем сравнении.</p><label><span style={consent}><input style={consentInput} type="checkbox" checked={stopConfirmed} onChange={e=>setStopConfirmed(e.target.checked)} disabled={blocked}/> Остановить повторную отправку без отмены серверного прогресса</span></label><button className={styles.secondary} disabled={blocked||!stopConfirmed} onClick={()=>void run(()=>{setView(controller.stopLegacy(stopConfirmed));resetReview();setNotice('Повторная отправка остановлена. Локальные и серверные награды сохранены.');})}>Остановить перенос старых наград</button></details>}
   </>}
  </div>}
  {view.review&&<div className={styles.form} aria-label="Сравнение дневников">
   <h3>{view.reviewKind==='import'?'Сравнение восстановления':view.reviewKind==='recover_original'?'Сравнение текущего дневника':view.reviewKind==='legacy'?'Подтверждение старых наград':view.reviewKind==='upload_receipt'?'Ответ после отправки':'Сравнение записей'}</h3>
   <p className={styles.fine}>На устройстве после применения: {view.review.next.nights.length} записей · {view.review.next.credits.length} успешных дат. Ожидают отправки по этому сравнению: {view.review.uploads.length}. Изменятся на устройстве: {view.changes.length}.</p>
   {(view.reviewKind==='upload_receipt'||view.reviewKind==='legacy')&&<p className={styles.fine}>Сервер ответил. Примени сравнение, чтобы сохранить подтверждение на устройстве.</p>}
   {view.conflicts.map(conflict=><fieldset className={styles.education} key={conflict.date}>
    <legend>{dateLabel(conflict.date)}</legend>
    {conflict.reason==='original_target'&&<p className={styles.fine}>У записи на сервере другая исходная цель, индекс, интервал или происхождение Health Connect. Сначала сохрани локальную копию, если она нужна; заменить эти исходные данные нельзя.</p>}
    <details><summary>На устройстве</summary><Entry night={conflict.local}/></details><details><summary>На сервере</summary><Entry night={conflict.server}/></details>
    <button className={styles.secondary} disabled={blocked||!conflict.canKeepLocal} aria-pressed={view.choices[conflict.date]==='local'} onClick={()=>void run(()=>setView(controller.choose(conflict.date,'local')))}>Оставить запись устройства</button>
    <button className={styles.secondary} disabled={blocked} aria-pressed={view.choices[conflict.date]==='server'} onClick={()=>void run(()=>setView(controller.choose(conflict.date,'server')))}>Взять запись сервера</button>
   </fieldset>)}
   {!!view.changes.length&&<details><summary>Что изменится на устройстве · {view.changes.length}</summary>{view.changes.slice(0,shown).map(row=><details key={row.date}><summary>{dateLabel(row.date)}</summary><p>Сейчас</p><Entry night={row.local}/><p>После применения</p><Entry night={row.next}/></details>)}{view.changes.length>shown&&<button className={styles.secondary} onClick={()=>setShown(v=>v+50)}>Показать ещё 50</button>}</details>}
   {!!view.review.unverifiedCredits.length&&<p role="status" className={styles.fine}>Старые награды требуют отдельного переноса: {view.review.unverifiedCredits.length}. Сейчас они сохранены на устройстве. Применение сравнения пока недоступно.</p>}
   <label><span style={consent}><input style={consentInput} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={blocked}/> Применить это сравнение</span></label>
   <button className={styles.primary} disabled={blocked||!confirmed||!!view.review.conflicts.length||!!view.review.unverifiedCredits.length} onClick={()=>void run(async()=>{setView(view.reviewKind==='import'||view.reviewKind==='recover_original'?await controller.approveImport(confirmed):controller.approve(confirmed));resetReview();setNotice('Сравнение сохранено. Новые изменения можно отправить отдельной кнопкой.');})}>Применить сравнение</button>
   <button className={styles.secondary} disabled={blocked} onClick={()=>void run(()=>{setView(controller.discard());resetReview();})}>Закрыть сравнение</button>
  </div>}
 </section>;
}
