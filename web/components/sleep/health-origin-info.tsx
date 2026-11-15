import {healthOriginLabel,type HealthOrigin} from './sleep-health-origin';
import styles from './sleep-app.module.css';

export default function HealthOriginInfo({origin}:{origin?:HealthOrigin}){
 return <div data-health-origin={origin?.recordingMethod??'not-retained'}>
  <p className={styles.fine}><strong>{healthOriginLabel(origin)}</strong></p>
  <details className={styles.inlineHelp}><summary>Источник записи</summary>
   <p style={{overflowWrap:'anywhere'}}>{origin?.packageName?`Приложение: ${origin.packageName}`:'Приложение-источник не указано или не сохранено.'}</p>
   <p>Способ записи сообщает приложение-источник. Эта пометка не подтверждает точность датчиков. Индекс Overman рассчитан по переданной записи.</p>
  </details>
 </div>;
}
