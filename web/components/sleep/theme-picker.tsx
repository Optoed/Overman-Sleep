import {APPEARANCES,appearanceStyle,type AppearanceId} from './sleep-themes';
import styles from './sleep-app.module.css';
export default function ThemePicker({value,onChange,disabled=false}:{value:AppearanceId;onChange:(id:AppearanceId)=>void;disabled?:boolean}){
 return <fieldset className={styles.themePicker} disabled={disabled}><legend>Тема оформления</legend><div className={styles.themeGrid}>{APPEARANCES.map(t=><label key={t.id} className={styles.themeChoice} data-selected={value===t.id} style={appearanceStyle(t)}><input type="radio" name="appearance" value={t.id} checked={value===t.id} onChange={()=>onChange(t.id)}/><span className={styles.themePreview} data-preview={t.id} aria-hidden="true"><span>8:30</span><i/><b/></span><span className={styles.themeName}>{t.name}</span><small>{t.description}</small><span className={styles.themeSelected} aria-hidden="true">{value===t.id?'✓':''}</span></label>)}</div></fieldset>;
}
