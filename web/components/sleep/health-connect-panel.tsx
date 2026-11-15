'use client';
import {useState} from 'react';
import {nativeCall} from './sleep-device';
import {previewHealthSessions,healthSessionSources,type HealthSourceChoice,type HealthPreviewStatus} from './sleep-health-preview';
import {offsetAt} from './sleep-time';
import {healthSleepScoreV2} from './sleep-health-score';
import {minutesLabel} from './sleep-insights';
import type {HealthSleepSession} from './sleep-health-session';
import type {SleepState} from './sleep-state';
import styles from './sleep-app.module.css';
import HealthOriginInfo from './health-origin-info';
type Data={sessions:HealthSleepSession[];offsets:{bed:number;wake:number}};
const sourceValue=(source:HealthSourceChoice)=>source===undefined?'all':source===null?'unknown':`package:${source}`;
const intervalLabel=(time:number)=>new Date(time).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const statusLabels:Record<HealthPreviewStatus,string>={ready:'Можно сохранить после проверки',existing:'На эту дату уже есть запись',duplicate:'Несколько записей на одну дату. Выбери источник; дубли одного приложения нужно исправить в нём.',overlap:'Интервал пересекается с другой записью в списке. Выбери источник или исправь записи в исходном приложении.', 'history-overlap':'Интервал пересекается с уже сохранённой ночью. Повторный учёт сна заблокирован.',active:'Сначала заверши текущую ночь',future:'Проверь дату записи',incomplete:'Есть неизвестные интервалы'};
/** Explicit foreground read; save only after a separate action and self-report. */
export default function HealthConnectPanel({state,available,disabled,onImport}:{state:SleepState;available:boolean;disabled:boolean;onImport:(sessions:HealthSleepSession[],index:number,offsets:{bed:number;wake:number},rested:number,sourcePackage:HealthSourceChoice)=>boolean}){
 const [data,setData]=useState<Data|null>(null),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[selection,setSelection]=useState<number|null>(null),[rested,setRested]=useState(0);
 const [source,setSource]=useState<HealthSourceChoice>(undefined);
 if(!available)return null;
 const rows=data?previewHealthSessions(data.sessions,state,data.offsets,Date.now(),source):null;
 const sources=data?healthSessionSources(data.sessions):[];
 async function permission(){setPending(true);setMessage('');try{const result=await nativeCall<{granted:boolean}>('healthPermission');setMessage(result.granted?'Доступ уже разрешён.':'После разрешения нажми «Показать записи».');}catch(e){setMessage(e instanceof Error?e.message:'Доступ пока недоступен.');}finally{setPending(false);}}
 async function read(){setPending(true);setData(null);setSelection(null);setRested(0);setSource(undefined);setMessage('');try{const end=Date.now(),response=await nativeCall<{sessions:HealthSleepSession[]}>('healthRead',{start:end-72*3600000,end});if(!response||!Array.isArray(response.sessions))throw Error('Не удалось проверить ответ Health Connect.');const offset=offsetAt(end);if(response.sessions.some(s=>offsetAt(s.start)!==offset||offsetAt(s.end)!==offset))throw Error('Часовой пояс изменился в этот период. Просмотр с точными датами пока недоступен.');const offsets={bed:offset,wake:offset};previewHealthSessions(response.sessions,state,offsets,end);setData({sessions:response.sessions,offsets});}catch(e){setMessage(e instanceof Error?e.message:'Записи недоступны.');}finally{setPending(false);}}
 function save(){if(!data||selection===null||!rested)return;if(onImport(data.sessions,selection,data.offsets,rested,source)){setSelection(null);setRested(0);setMessage('Запись сохранена.');}else setMessage('Запись не сохранена. Проверь состояние дневника и повтори.');}
 return <section className={styles.card} aria-label="Health Connect">
  <h2>Данные сна</h2><p className={styles.fine}>Записи Health Connect за три дня · Android 14 и новее.</p>
  <button className={styles.secondary} onClick={()=>void permission()} disabled={pending}>Разрешить доступ</button><button className={styles.secondary} onClick={()=>void read()} disabled={pending}>Показать записи</button>
  <p className={styles.fine}>Просмотр не меняет дневник. При сохранении исходный индекс останется отдельно от самочувствия и дневниковых баллов. Запись может синхронизироваться с аккаунтом.</p>
  <details className={styles.inlineHelp}><summary>Как считается индекс</summary><p>Предварительный индекс учитывает продолжительность и долю сна в интервале записи. Для продолжительности используется твоя цель, но не меньше 7 часов — общий ориентир для взрослых; потребности различаются и зависят от возраста. Он не зависит от самочувствия, не использует пульс или фазы и не является медицинской оценкой. Точность зависит от источника Health Connect; при неполных стадиях индекс не показывается. Сохранённые ранее баллы не меняются.</p></details>
  {message&&<p role="status">{message}</p>}
  {sources.length>1&&<div><label>Приложение-источник<select aria-label="Приложение-источник" value={sourceValue(source)} disabled={pending||disabled} onChange={e=>{const value=e.target.value;setSource(value==='all'?undefined:value==='unknown'?null:value.slice(8));setSelection(null);setRested(0);setMessage('');}}><option value="all">Все источники</option>{sources.map(item=><option key={sourceValue(item)} value={sourceValue(item)}>{item??'Приложение неизвестно'}</option>)}</select></label><p className={styles.fine}>Выбери приложение, которому доверяешь. Остальные записи будут скрыты только в этом просмотре. Пересекающиеся интервалы не складываются, источник с большим баллом не выбирается автоматически.</p></div>}
  {rows&&<div aria-live="polite">{rows.length===0?<p>Записей за этот период нет.</p>:rows.map(row=><section key={row.index} className={styles.metric} data-health-preview={row.status}>
   <strong>{row.date}</strong><span>Интервал: {intervalLabel(row.start)} — {intervalLabel(row.end)}</span><HealthOriginInfo origin={data!.sessions[row.index].origin}/>
   {row.complete&&<span>Индекс Health Connect (предварительно): {healthSleepScoreV2(data!.sessions[row.index],state.schedule.hours*60)?.score} / 100</span>}
   <span>{row.sleepMinutes===null?'Данных о сне недостаточно':`Сон: ${minutesLabel(row.sleepMinutes)}`}</span><small>{statusLabels[row.status]}</small>
   {row.status==='ready'&&<button type="button" className={styles.secondary} disabled={disabled||pending} onClick={()=>{setSelection(row.index);setRested(0);setMessage('');}}>Выбрать ночь {row.date}</button>}
   {selection===row.index&&row.status==='ready'&&<div><label>Как ты себя чувствуешь?<select aria-label="Самочувствие после сна" value={rested} onChange={e=>setRested(Number(e.target.value))}><option value={0}>Выбрать</option>{['Разбит','Устал','Нормально','Хорошо','Отлично'].map((label,i)=><option key={label} value={i+1}>{label}</option>)}</select></label><p className={styles.fine}>Проверь дату, длительность и источник. При сохранении приложение-источник, способ записи и исходный интервал войдут в дневник, резервную копию и синхронизацию с аккаунтом. Существующая запись не заменяется.</p><button type="button" className={styles.primary} disabled={!rested||disabled||pending} onClick={save}>Сохранить ночь</button><button type="button" className={styles.textButton} onClick={()=>setSelection(null)}>Отмена</button></div>}
  </section>)}</div>}
 </section>;
}
