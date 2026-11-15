import type {Night} from './sleep-state';
import {healthScoreDetails} from './sleep-health-score';
import {minutesLabel} from './sleep-insights';
import styles from './sleep-app.module.css';
import HealthOriginInfo from './health-origin-info';
import {dateAt,clockAt,offsetLabel} from './sleep-time';

/** The source snapshot and the editable diary are intentionally separate. */
export default function HealthScoreCard({night}:{night:Night}){
 const snapshot=night.healthScore;if(!snapshot)return null;
 const details=healthScoreDetails(snapshot);
 const interval=night.healthInterval;
 const corrected=Math.abs(snapshot.sleepMinutes-night.sleepMinutes)>1e-9||Math.abs(snapshot.intervalMinutes-(night.wake-night.bed)/60000)>1e-9||!!interval&&(interval.start!==night.bed||interval.end!==night.wake);
 return <section className={styles.card} aria-label="Сохранённый индекс Health Connect" data-health-score={snapshot.score} data-health-score-version={snapshot.version}>
  <span className={styles.eyebrow}>ПО ДАННЫМ HEALTH CONNECT</span><h2>Индекс сна · {snapshot.score} / 100</h2>
  <p className={styles.fine}>Предварительный индекс · самочувствие на него не влияет.</p>
  <HealthOriginInfo origin={night.healthOrigin}/>
  {interval?<p className={styles.fine} data-health-interval>Исходный интервал: {dateAt(interval.start,interval.bedOffset)} {clockAt(interval.start,interval.bedOffset)} ({offsetLabel(interval.bedOffset)}) — {dateAt(interval.end,interval.wakeOffset)} {clockAt(interval.end,interval.wakeOffset)} ({offsetLabel(interval.wakeOffset)}). Часовой пояс зафиксирован при импорте. Эти границы сохраняются при исправлении дневника.</p>:<p className={styles.fine}>Исходные дата и время этой записи не были сохранены отдельно. Мы не восстанавливаем их по исправленному дневнику.</p>}
  <div className={styles.metricGrid}><div className={styles.metric}><strong>{minutesLabel(snapshot.sleepMinutes)}</strong><span>Сон в исходной записи</span></div><div className={styles.metric}><strong>{Math.round(details.efficiency*100)}%</strong><span>Доля сна в интервале</span></div></div>
  {corrected&&<p role="status">Дневник исправлен вручную. Здесь сохранён индекс исходной записи Health Connect.</p>}
  <details className={styles.inlineHelp}><summary>Из чего складывается индекс?</summary>
   <p>Продолжительность: {details.durationPoints.toFixed(1)} из 70. Доля сна: {details.continuityPoints.toFixed(1)} из 30. Сумма округляется один раз.</p>
   <p>Цель при импорте — {minutesLabel(snapshot.goalMinutes)}; ориентир расчёта — {minutesLabel(details.referenceMinutes)}. Версия {snapshot.version==='health-preview-v2'?'2':'1'} сохранена вместе с исходными значениями и не меняется при исправлении дневника или смене цели.</p>
   <p>Это индекс приложения, а не балл устройства или медицинская оценка. Health Connect передаёт записи других приложений; наличие записи само по себе не подтверждает измерение датчиками. Пульс и доли REM/глубокого сна в расчёт не входят. При неизвестных интервалах индекс не создаётся.</p>
  </details>
 </section>;
}
