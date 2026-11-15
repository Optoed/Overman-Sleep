import type {Night} from './sleep-state';
import {minutesLabel} from './sleep-insights';
import {sleepRhythm} from './sleep-rhythm';
import HelpHint from './help-hint';
import styles from './sleep-app.module.css';
export default function RhythmSummary({nights,dates}:{nights:Night[];dates:string[]}){
 const rhythm=sleepRhythm(nights,dates),width=300/dates.length;
 return <section className={styles.card} aria-label="Ритм сна"><div className={styles.sectionHead}><h2>Твой ритм сна</h2><HelpHint label="Как читать ритм сна" text="Столбик — указанный сон относительно цели именно той ночи. Верхняя линия — 100% цели; превышение обрезано только на рисунке. Прочерк означает отсутствие записи. Разброс отбоя — среднее расстояние от кругового среднего времени, с учётом перехода через полночь; нужен минимум из трёх записей. Это дневниковая аналитика, не измерение качества сна датчиками."/></div>
 <div className={styles.metricGrid}><div className={styles.metric}><span>В режиме</span><strong>{rhythm.count?`${rhythm.successful} / ${rhythm.count}`:'—'}</strong></div><div className={styles.metric}><span>Разброс отбоя</span><strong>{rhythm.deviation===null?'—':`${Math.round(rhythm.deviation)} мин`}</strong></div></div>
 <svg viewBox="0 0 320 110" className={styles.rhythmChart} role="img" aria-label={`Сон относительно личной цели: ${rhythm.count} записей из ${dates.length}`}><line x1="10" x2="310" y1="15" y2="15" stroke="var(--muted)" strokeDasharray="3 4" opacity=".5"/>{rhythm.rows.map((n,i)=>{const x=10+i*width+width*.2,w=width*.6;if(!n)return <path key={dates[i]} d={`M${x},95h${w}`} stroke="var(--muted)"><title>{dates[i]}: нет записи</title></path>;const height=Math.max(1,Math.min(1,n.sleepMinutes/(n.target.hours*60))*75);return <rect key={n.date} x={x} y={95-height} width={w} height={height} rx={Math.min(4,w/2)} fill={n.success?'var(--accent)':'var(--warm)'}><title>{`${n.date}: ${minutesLabel(n.sleepMinutes)}, цель ${minutesLabel(n.target.hours*60)}`}</title></rect>;})}</svg><span className={styles.fine}>{rhythm.count} из {dates.length} ночей записано</span>
 </section>;
}
