'use client';
import type {SleepState} from './sleep-state';
import type {towerPresentation} from './sleep-growth';
import {Metric} from './sleep-charts';
import styles from './sleep-app.module.css';

export function TowerConditionSettings({policy,disabled,onChange}:{policy:SleepState['towerCondition'];disabled:boolean;onChange:(enabled:boolean)=>void}){
 return <section className={styles.card} aria-label="Повреждения и ремонт башни">
  <h2>Характер башни</h2>
  <label className={styles.toggle}><span>Разрушение и восстановление</span><input type="checkbox" checked={!!policy} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><i aria-hidden="true"/></label>
  <p className={styles.fine}>{policy?`Учитываем ночи с ${policy.activatedDate}.`:'Включи, чтобы башня реагировала на записанные нарушения режима. Начало — с завтрашней даты.'}</p>
  <details className={styles.inlineHelp}><summary>Заморозки и правила</summary>
   <p>Одна стартовая заморозка защищает от нарушения. Затем третья незащищённая ночь подряд повреждает башню; седьмая — обрушает её. Учитываются только записанные ночи и их сохранённые цели. Отсутствие записи прерывает цепочку, без штрафа и ремонта.</p>
   <p>Каждая успешная ночь возвращает 25% целостности: полное восстановление за четыре ночи. Семь успешных ночей подряд дают заморозку, максимум две. Самочувствие не влияет на эти правила.</p>
   <p>Заработанные этажи и сад сохраняются. Выключение возвращает полный вид башни; повторное включение начинает новый период с завтрашней даты. Настройка переносится с резервной копией, между аккаунтами автоматически не синхронизируется.</p>
  </details>
 </section>;
}
export function TowerConditionStatus({condition}:{condition:NonNullable<ReturnType<typeof towerPresentation>['condition']>}){
 const title=condition.status==='collapsed'?'Башня ждёт восстановления':condition.status==='repairing'?'Строители восстанавливают башню':condition.status==='damaged'?'Башня повреждена':'Башня в порядке';
 return <section className={styles.card} aria-label="Состояние башни" data-tower-condition={condition.status} data-tower-integrity={condition.integrity}>
  <h2>{title}</h2><div className={styles.metricGrid}><Metric label="Целостность" value={`${condition.integrity}%`}/><Metric label="Заморозки" value={`${condition.freezes} / 2`}/></div>
  <p className={styles.fine}>Видно {condition.visibleFloors} из {condition.earnedFloors} заработанных этажей.{condition.integrity<100?' Успешная ночь восстановит 25% целостности.':''}</p>
 </section>;
}
