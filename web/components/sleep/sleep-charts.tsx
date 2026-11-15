'use client';
import { useId, useState } from 'react';
import { Info, BarChart3, Moon, Sun, Clock3 } from 'lucide-react';
import { type Night } from './sleep-state';
import type { DiaryScoreVersion } from './sleep-score-version';
import { periodRangeLabel, type AnalyticsPeriodView } from './sleep-period';
import { clockPeriod, CLOCK_METRICS, type ClockMetric } from './sleep-clock-insights';
import { bedtimeMinute, clockLabel, compareSleepPeriods, debt, debtSummary, durationSummary, durationValues, type DurationMetric, inBed, mean, minuteLabel, minutesLabel, nightScore, scoreColor, summarize, sleepTrend } from './sleep-insights';
import styles from './sleep-app.module.css';
import HelpHint from './help-hint';
import RhythmSummary from './rhythm-summary';

export function Metric({label,value,detail,source}:{label:string;value:string;detail?:string;source?:'diary'|'self-report'}){
  return <div className={styles.metric} data-assessment-source={source}><span>{label}{detail&&<HelpHint label={`О показателе ${label}`} text={detail}/>}</span><strong>{value}</strong></div>;
}
export function Score({night,onInfo,version}:{version:DiaryScoreVersion;night:Night;onInfo:()=>void}){
  const score=nightScore(night,version),caption=score>=80?'Высокая оценка':score>=60?'Средняя оценка':'Низкая оценка';
  return <section className={styles.scoreCard} data-score-version={night.scoreModel??'diary-v1'} aria-label={`Оценка ночи: ${score} из 100`}>
    <div><span className={styles.eyebrow}>ОЦЕНКА СНА</span><div className={styles.scoreNumber}>{score}<small>/100</small></div><h2>{caption}</h2></div>
    <div className={styles.scoreMoon}><Moon size={38} strokeWidth={1}/><i/><i/></div>
    <div className={styles.scoreScale}><i style={{left:`${Math.max(2,Math.min(98,score))}%`}}/></div>
    <p data-assessment-source="diary">{night.source==='health-connect'?'Дневник · источник Health Connect':'По дневнику'} · {night.scoreModel??'v1'}</p><button aria-label="Как считается оценка" onClick={onInfo}><Info size={19}/></button>
  </section>;
}
type ChartProps={dates:string[];nights:Night[];value:(n:Night)=>number|undefined;label:string;format:(v:number)=>string;max?:number;line?:boolean;emptyLabel?:string;onSelect:(date:string)=>void};
export function Chart({dates,nights,value,label,format,max,line=false,emptyLabel='Пока нет записей',onSelect}:ChartProps){
  const values=dates.map(date=>{const n=nights.find(v=>v.date===date);return n?value(n):undefined;}),known=values.filter((v):v is number=>v!==undefined),avg=mean(known);
  const low=line&&known.length?Math.floor((Math.min(...known)-30)/60)*60:0,high=max??(known.length?Math.max(low+60,Math.ceil((Math.max(...known)+30)/60)*60):600);
  const x=(i:number)=>90+(i+.5)*(250/dates.length),y=(v:number)=>196-(v-low)/(high-low)*156;
  return <div className={styles.chart}>
    <div className={styles.chartSummary}><span>{known.length?`Мин. ${format(Math.min(...known))} · Макс. ${format(Math.max(...known))}`:emptyLabel}</span><strong>{avg===null?'—':format(avg)}<small>в среднем</small></strong></div>
    <svg viewBox="0 0 360 240" role="img" aria-label={label}>
      {[0,.5,1].map(f=><g key={f}><line x1="90" x2="340" y1={196-f*156} y2={196-f*156} stroke="currentColor" opacity=".12" strokeDasharray="3 5"/><text x="0" y={200-f*156} fill="currentColor" opacity=".6" fontSize="13">{format(low+f*(high-low))}</text></g>)}
      {avg!==null&&<line x1="90" x2="340" y1={y(avg)} y2={y(avg)} stroke="currentColor" opacity=".55" strokeDasharray="5 5"/>}
      {values.map((v,i)=>v===undefined?null:<g key={i}>
        {line&&i>0&&values[i-1]!==undefined&&<line x1={x(i-1)} y1={y(values[i-1]!)} x2={x(i)} y2={y(v)} stroke="#9bddbd" strokeWidth="2"/>}
        {line?<circle cx={x(i)} cy={y(v)} r={dates.length>7?3:5} fill="#9bddbd"/>:<rect x={x(i)-Math.min(16,170/dates.length)} y={y(v)} width={Math.min(32,340/dates.length)} height={Math.max(2,196-y(v))} rx="4" fill={v===Math.max(...known)?'#ecc58a':'#8bcbae'}/>}
        <title>{`${dates[i]}: ${format(v)}`}</title>
      </g>)}
      {dates.map((d,i)=>(dates.length<=7||i%5===0||i===dates.length-1)&&<text key={d} x={x(i)} y="226" textAnchor="middle" fill="currentColor" opacity=".6" fontSize="14">{dates.length<=7?new Date(`${d}T12:00`).toLocaleDateString('ru-RU',{weekday:'short'}):d.slice(-2)}</text>)}
    </svg>
    <div className={styles.chartDays} aria-label={`${label}: выбрать день`}>{dates.map((d,i)=><button key={d} onClick={()=>onSelect(d)} aria-label={`${d}: ${values[i]===undefined?'нет данных':format(values[i]!)}`}>{d.slice(-2)}</button>)}</div>
    <HelpHint label={`Как читать график: ${label}`} text="Нажми на дату, чтобы открыть ночь. Пропуски не считаются нулевым сном."/>
  </div>;
}
export function Analytics({nights,range,onSelect,onInfo,version}:{version:DiaryScoreVersion;nights:Night[];range:AnalyticsPeriodView;onSelect:(date:string)=>void;onInfo:()=>void}){
  const end=range.through,days=range.shownDays;
  const stats=summarize(nights,end,days,version);

  return <div className={styles.analytics} data-score-version={version}><details className={styles.inlineHelp} data-score-period={version}><summary>Как читать баллы?</summary><p>Прежние ночи — v1, новые — v2. Баллы разных версий не сравниваются напрямую. Самочувствие 1–5 хранится отдельно.</p></details>
    <div className={styles.metricGrid}><Metric label="Записано ночей" value={`${stats.rows.length} / ${days}`}/><Metric label="Средний сон" value={minutesLabel(stats.duration)}/><Metric label="Средний подъём" value={clockLabel(stats.wake)}/><Metric label="Самочувствие" source="self-report" detail="Твоя оценка · 1–5" value={stats.mood===null?'—':`${stats.mood.toFixed(1)} / 5`}/></div>
    <RhythmSummary nights={nights} dates={stats.dates}/>
    <SleepTrend version={version} nights={nights} range={range} onSelect={onSelect}/>
    <section className={styles.card}><div className={styles.sectionHead}><h2>Оценка сна по дням</h2><button onClick={onInfo} aria-label="Как считается оценка"><Info size={18}/></button></div><Chart dates={stats.dates} nights={nights} value={n=>nightScore(n,version)} max={100} label="Оценка ночей" format={v=>String(Math.round(v))} onSelect={onSelect}/></section>
    <ClockAnalytics nights={nights} dates={stats.dates} onSelect={onSelect}/>
    <DurationAnalytics nights={nights} dates={stats.dates} onSelect={onSelect}/>
    <DebtAnalytics nights={nights} dates={stats.dates} onSelect={onSelect}/>

  </div>;
}

function DebtAnalytics({nights,dates,onSelect}:{nights:Night[];dates:string[];onSelect:(date:string)=>void}){
  const [selectedDate,setSelectedDate]=useState(''),descriptionId=useId();
  const summary=debtSummary(nights,dates),selected=summary.rows.find(row=>row.date===selectedDate)??[...summary.rows].reverse().find(row=>row.recorded)??summary.rows[summary.rows.length-1];
  const dayLabel=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  return <section className={styles.card} aria-label="Долг по сну" aria-describedby={descriptionId}>
    <div className={styles.sectionHead}><h2>Долг по сну</h2><Sun size={19}/></div>
    <div className={styles.metricGrid}><div data-debt-stat="total"><Metric label="Всего за записанные ночи" value={minutesLabel(summary.total)}/></div><div data-debt-stat="mean"><Metric label="Среднее за записанную ночь" value={minutesLabel(summary.mean)}/></div></div>
    <p className={styles.fine} data-debt-count={summary.count}>Записей: {summary.count} из {dates.length} календарных дней. {summary.count?`Среднее — сумма недобора, делённая на ${summary.count}.`:'Сумма и среднее недоступны: нет записей.'}</p>
    <span id={descriptionId} data-debt-model="true"><HelpHint label="Как считается долг по сну" text="Для каждой ночи: максимум из 0 и разницы «цель той ночи − указанный сон». Затем складываем недобор по записям периода. Используем сохранённую цель каждой ночи, а не сегодняшнюю настройку. Пересыпание не уменьшает долг других ночей. Пропущенные дни не входят в сумму и среднее; нулевой недобор записанной ночи входит в среднее. Это ориентир дневника."/></span>
    <Chart dates={dates} nights={nights} value={debt} label="Недостающий сон относительно личной цели" format={minutesLabel} onSelect={onSelect}/>
    {selected&&<div className={styles.trendReading} data-debt-reading={selected.date}>
      <label className={styles.trendSelect}>Дата расчёта долга<select value={selected.date} onChange={event=>setSelectedDate(event.target.value)}>{summary.rows.map(row=><option key={row.date} value={row.date}>{dayLabel(row.date)}</option>)}</select></label>
      <div aria-live="polite" aria-atomic="true"><p className={styles.fine}>{dayLabel(selected.date)} · расчёт отдельной ночи</p><dl className={styles.clockMetrics}><div><dt>Цель ночи</dt><dd data-debt-value="target">{minutesLabel(selected.target)}</dd></div><div><dt>Указан сон</dt><dd data-debt-value="sleep">{minutesLabel(selected.sleep)}</dd></div><div><dt>Недобор</dt><dd data-debt-value="deficit">{minutesLabel(selected.deficit)}</dd></div></dl>{!selected.recorded&&<p className={styles.fine} data-debt-missing="true">За эту ночь нет записи. Недобор неизвестен.</p>}</div>
    </div>}
    <details className={styles.trendTable} data-debt-table="true"><summary>Расчёт по всем ночам</summary><table><caption>Историческая цель, указанный сон и недобор. Все числа в минутах; прочерк означает отсутствие записи.</caption><thead><tr><th scope="col">Дата</th><th scope="col">Цель / сон<br/>мин</th><th scope="col">Недобор<br/>мин</th></tr></thead><tbody>{summary.rows.map(row=><tr key={row.date} data-debt-row={row.date}><th scope="row"><button onClick={()=>onSelect(row.date)} aria-label={`Долг: открыть ночь за ${row.date}`}><time dateTime={row.date}>{new Date(row.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</time></button></th><td><span data-debt-target="true">{row.target??'—'}</span> / <span data-debt-sleep="true">{row.sleep??'—'}</span></td><td data-debt-deficit="true">{row.deficit??'—'}</td></tr>)}</tbody></table></details>
  </section>;
}

const clockLabels:Record<ClockMetric,string>={bed:'Лёг',asleep:'Заснул',wake:'Проснулся'};
function ClockAnalytics({nights,dates,onSelect}:{nights:Night[];dates:string[];onSelect:(date:string)=>void}){
  const [metric,setMetric]=useState<ClockMetric>('bed'),[selectedDate,setSelectedDate]=useState(''),descriptionId=useId();
  const period=clockPeriod(nights,dates),stat=period.metrics[metric],selected=period.rows.find(row=>row.date===selectedDate)??[...period.rows].reverse().find(row=>row.recorded)??period.rows[period.rows.length-1];
  const plotted=stat.plotValues.filter((value):value is number=>value!==null),extent=stat.plotMean===null?plotted:[...plotted,stat.plotMean];
  const low=extent.length?Math.floor((Math.min(...extent)-30)/60)*60:0,high=extent.length?Math.max(low+60,Math.ceil((Math.max(...extent)+30)/60)*60):60;
  const x=(index:number)=>90+(index+.5)*(250/dates.length),y=(value:number)=>196-(value-low)/(high-low)*156;
  const dayLabel=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  return <section className={styles.card} aria-label="Время сна и подъёма" data-clock-metric={metric}>
    <div className={styles.sectionHead}><h2>Время сна и подъёма</h2><Clock3 size={19}/></div>
    <div className={styles.chips}>{CLOCK_METRICS.map(key=><button key={key} aria-pressed={metric===key} onClick={()=>setMetric(key)}>{clockLabels[key]}</button>)}</div>
    <dl className={styles.clockMetrics}><div><dt>Раннее</dt><dd data-clock-stat="earliest">{clockLabel(stat.earliest)}</dd></div><div><dt>Позднее</dt><dd data-clock-stat="latest">{clockLabel(stat.latest)}</dd></div><div><dt>Среднее</dt><dd data-clock-stat="mean">{clockLabel(stat.mean)}</dd></div></dl>
    <p className={styles.fine} data-clock-count={stat.count}>Указано: {stat.count} из {period.recordCount} записанных ночей. Прочерки не входят в среднее.</p>
    <p id={descriptionId} className={styles.fine} data-clock-method="true">Среднее учитывает круг циферблата: 23:30 и 00:30 дают 00:00. Раннее и позднее — края кратчайшего диапазона часов.</p>
    <p className={styles.fine} data-clock-reference="true">Сравниваются сохранённые местные часы каждой ночи. «Заснул» — оценка: начало плюс указанные минуты, в часах начала ночи.</p>
    {stat.ambiguous&&<p className={styles.fine} data-clock-ambiguous="true">Нет однозначного среднего: часы распределены по циферблату в разные стороны.</p>}
    {stat.count?<svg className={styles.clockPlot} viewBox="0 0 360 240" role="img" aria-describedby={descriptionId} aria-label="Часы выбранного режима; пропуски не соединяются">
      {[0,.5,1].map(f=><g key={f}><line x1="90" x2="340" y1={196-f*156} y2={196-f*156} stroke="currentColor" opacity=".16" strokeDasharray="3 5"/><text x="0" y={200-f*156} fill="currentColor" fontSize="13">{clockLabel(low+f*(high-low))}</text></g>)}
      {stat.plotMean!==null&&<line data-clock-mean="true" x1="90" x2="340" y1={y(stat.plotMean)} y2={y(stat.plotMean)} stroke="currentColor" opacity=".55" strokeDasharray="5 5"/>}
      {stat.plotValues.map((value,index)=>value===null?null:<g key={dates[index]}>{index>0&&stat.plotValues[index-1]!==null&&<line data-clock-from={dates[index-1]} data-clock-to={dates[index]} x1={x(index-1)} y1={y(stat.plotValues[index-1]!)} x2={x(index)} y2={y(value)} stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}<circle data-clock-point={dates[index]} data-clock-plot-value={value} cx={x(index)} cy={y(value)} r={dates.length>7?3:5} fill="var(--accent)"/><title>{`${dates[index]}: ${clockLabel(period.rows[index][metric])}`}</title></g>)}
      {dates.map((date,index)=>(dates.length<=7||index%5===0||index===dates.length-1)&&<text key={date} x={x(index)} y="226" textAnchor="middle" fill="currentColor" fontSize="14">{date.slice(-2)}</text>)}
    </svg>:<p className={styles.fine} data-clock-empty="true">Нет указанных часов.</p>}
    <div className={styles.chartDays} aria-label="Время сна и подъёма: выбрать день">{period.rows.map(row=><button key={row.date} onClick={()=>onSelect(row.date)} aria-label={`${row.date}: ${row[metric]===null?'нет данных':clockLabel(row[metric])}`}>{row.date.slice(-2)}</button>)}</div>
    <small className={styles.fine}>Дата открывает ночь в журнале. Линия не соединяет пропуски.</small>
    {selected&&<div className={styles.trendReading} data-clock-reading={selected.date}><label className={styles.trendSelect}>Дата значений времени<select value={selected.date} onChange={event=>setSelectedDate(event.target.value)}>{period.rows.map(row=><option key={row.date} value={row.date}>{dayLabel(row.date)}</option>)}</select></label><div aria-live="polite" aria-atomic="true"><p className={styles.fine}>{dayLabel(selected.date)} · часы отдельной ночи</p><dl className={styles.clockMetrics}>{CLOCK_METRICS.map(key=><div key={key}><dt>{clockLabels[key]}</dt><dd data-clock-value={key}>{clockLabel(selected[key])}</dd></div>)}</dl>{!selected.recorded&&<p className={styles.fine} data-clock-missing="true">За эту ночь нет записи.</p>}</div></div>}
  </section>;
}

const durationLabels:Record<DurationMetric,string>={sleep:'Сон',bed:'В кровати',latency:'Засыпание',awake:'Бодрствование'};
const durationExplanation:Record<DurationMetric,string>={sleep:'Сон — приблизительная длительность, которую ты указал в дневнике.',bed:'В кровати — время между отходом ко сну и подъёмом. Оно включает засыпание и ночные паузы.',latency:'Засыпание — указанные минуты до сна. Не вычисляется по другим полям.',awake:'Бодрствование — указанные минуты ночных пауз. Не вычисляется из разницы со сном.'};
const durationLabel=(value:number|null,key:DurationMetric)=>value===null?'—':key==='latency'||key==='awake'?minuteLabel(value):minutesLabel(value);
function DurationAnalytics({nights,dates,onSelect}:{nights:Night[];dates:string[];onSelect:(date:string)=>void}){
  const [metric,setMetric]=useState<DurationMetric>('sleep'),[selectedDate,setSelectedDate]=useState('');
  const summary=durationSummary(nights,dates),stat=summary.metrics[metric];
  const selected=summary.rows.find(row=>row.date===selectedDate)??[...summary.rows].reverse().find(row=>row.recorded)??summary.rows[summary.rows.length-1];
  const dayLabel=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  return <section className={styles.card} aria-label="Продолжительность сна" data-duration-metric={metric}>
    <div className={styles.sectionHead}><h2>Продолжительность сна</h2><Moon size={19}/></div>
    <div className={styles.chips}>{(Object.keys(durationLabels) as DurationMetric[]).map(key=><button key={key} aria-pressed={metric===key} onClick={()=>setMetric(key)}>{durationLabels[key]}</button>)}</div>
    <p className={styles.fine} data-duration-explanation="true">{durationExplanation[metric]}</p>
    <p className={styles.fine} data-duration-coverage={stat.count}>Данные: {stat.count} из {summary.recordCount} записанных ночей. {stat.count?`Среднее — сумма указанных значений, делённая на ${stat.count}.`:'Среднее недоступно: нет указанных значений.'} Прочерк не равен нулю и не входит в среднее.</p>
    <div data-duration-chart={metric}><Chart dates={dates} nights={nights} value={night=>durationValues(night)[metric]??undefined} label="Продолжительность сна" format={value=>durationLabel(value,metric)} emptyLabel="Нет указанных значений" onSelect={onSelect}/></div>
    {selected&&<div className={styles.trendReading} data-duration-reading={selected.date}>
      <label className={styles.trendSelect}>Дата значений длительности<select value={selected.date} onChange={event=>setSelectedDate(event.target.value)}>{summary.rows.map(row=><option key={row.date} value={row.date}>{dayLabel(row.date)}</option>)}</select></label>
      <div aria-live="polite" aria-atomic="true"><p className={styles.fine}>{dayLabel(selected.date)} · значения отдельной ночи</p><dl className={styles.durationValues}>{(Object.keys(durationLabels) as DurationMetric[]).map(key=><div key={key}><dt>{durationLabels[key]}</dt><dd data-duration-value={key}>{durationLabel(selected[key],key)}</dd></div>)}</dl>{!selected.recorded&&<p className={styles.fine} data-duration-missing="true">За эту ночь нет записи.</p>}</div>
    </div>}
  </section>;
}

function SleepTrend({nights,range,onSelect,version}:{version:DiaryScoreVersion;nights:Night[];range:AnalyticsPeriodView;onSelect:(date:string)=>void}){
  const end=range.through,days=range.shownDays;
  const [selectedDate,setSelectedDate]=useState(''),descriptionId=useId();
  const points=sleepTrend(nights,end,days,version),current=summarize(nights,end,days,version),previous=range.previous?summarize(nights,range.previous.end,range.previous.days,version):summarize([],end,1,version);
  const selected=points.find(p=>p.date===selectedDate)??[...points].reverse().find(p=>p.score!==null)??points[points.length-1];
  const dayLabel=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  const pointValue=(value:number|null,scale:number)=>value===null?'Нет записи':`${value.toFixed(1)} / ${scale}`;
  const comparison=compareSleepPeriods(current,previous);
  const delta=(value:number|null,suffix:string)=>value===null?'Недостаточно данных':`${value>0?'+':''}${value.toFixed(1)} ${suffix}`;
  const dailyValue=(value:number|null,scale:number)=>value===null?'Нет записи':`${value} / ${scale}`;
  const x=(i:number)=>35+i*(282/Math.max(1,points.length-1)),y=(value:number,key:'score'|'mood')=>200-(key==='score'?value/100:(value-1)/4)*164;
  return <section className={styles.card} aria-label="Изменение качества сна"><div className={styles.sectionHead}><h2>Как меняется сон</h2><BarChartIcon/></div>
    <div className={styles.trendChanges}><div><strong>{current.score===null?'—':current.score.toFixed(1)}<small>Среднее периода · из 100</small></strong><small>{delta(comparison.score,'балла')}</small></div><div><strong>{current.mood===null?'—':current.mood.toFixed(1)}<small>Среднее периода · из 5</small></strong><small>{delta(comparison.mood,'из 5')}</small></div></div>
    <p className={styles.fine} data-period-counts="true">Записей в периоде: {current.rows.length}; в предыдущем: {previous.rows.length}. Каждая ночь имеет одинаковый вес.</p><p className={styles.fine} data-comparison-status={comparison.comparable?'ready':'insufficient'}>{comparison.comparable?'Показана разница средних по имеющимся записям.':comparison.mixedModels?'Разные версии расчёта. Прямое сравнение отключено.':`Для разницы средних нужно минимум ${comparison.minimumNights} записи в каждом периоде.`}</p>
    <p className={styles.fine} data-previous-period-start={range.previous?.start} data-previous-period-end={range.previous?.end}>{range.previous?`Предыдущий период целиком: ${periodRangeLabel(range.previous)}.`:'Более раннего календарного периода нет.'}</p>
    <div className={styles.chart}><div className={styles.trendLegend}><span data-assessment-source="diary"><i aria-hidden="true"/><span>Расчёт дневника · 0–100<small>Сплошная линия · круг</small></span></span><span data-assessment-source="self-report"><i aria-hidden="true"/><span>Твоя оценка · 1–5<small>Пунктир · ромб</small></span></span></div>
      <div className={styles.trendAxes} aria-hidden="true"><span>Баллы · 0–100</span><span>Самочувствие · 1–5</span></div>
      <svg viewBox="0 0 360 240" role="img" aria-describedby={descriptionId} aria-label="Две линии: средние за семь календарных дней, балл от 0 до 100 и самочувствие от 1 до 5 для дат выбранного периода">
        {[0,.5,1].map(f=><g key={f}><line x1="35" x2="317" y1={200-f*164} y2={200-f*164} stroke="currentColor" opacity=".16" strokeDasharray="3 5"/><text x="0" y={205-f*164} fontSize="14" fill="currentColor">{f*100}</text><text x="344" y={205-f*164} textAnchor="end" fontSize="14" fill="var(--warm)">{1+f*4}</text></g>)}
        {(['score','mood'] as const).map(key=>points.map((p,i)=>p[key]===null?null:<g key={`${key}-${p.date}`}>
          {i>0&&points[i-1][key]!==null&&<line x1={x(i-1)} x2={x(i)} y1={y(points[i-1][key]!,key)} y2={y(p[key]!,key)} data-trend-series={key} stroke={key==='score'?'var(--accent)':'var(--warm)'} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeDasharray={key==='mood'?'6 3':undefined}/>}
          {key==='score'?<circle data-trend-marker="score" cx={x(i)} cy={y(p.score!,'score')} r={days>7?3.5:4.5} fill="var(--accent)"/>:<polygon data-trend-marker="mood" points={`${x(i)},${y(p.mood!,'mood')-5} ${x(i)+5},${y(p.mood!,'mood')} ${x(i)},${y(p.mood!,'mood')+5} ${x(i)-5},${y(p.mood!,'mood')}`} fill="var(--surface)" stroke="var(--warm)" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}<title>{`${p.date}: ${key==='score'?'Оценка':'Самочувствие'} ${p[key]!.toFixed(1)} · ${p.count} ночей`}</title>
        </g>))}
        {points.map((p,i)=>(days<=7||i%5===0||i===days-1)&&<text key={p.date} x={x(i)} y="227" textAnchor="middle" fontSize="14" fill="currentColor">{Number(p.date.slice(-2))}</text>)}
      </svg>
      {!current.rows.length&&<p className={styles.fine}>Добавь первую ночь — здесь появятся две линии.</p>}
      <details className={styles.inlineHelp}><summary>Как читать график?</summary><p id={descriptionId} className={styles.fine}>Точка — среднее за 7 календарных дней: эта дата и 6 предыдущих. Сумма дневных значений делится на число записей, все ночи равны по весу. Пропуски не входят в делитель и не заменяются нулём. Сплошная линия с кругами: баллы 0–100, шкала слева. Пунктир с ромбами: самочувствие 1–5, шкала справа. Пропуски разрывают линию. Точные значения доступны ниже по дате и в текстовой таблице. Баллы разных версий не усредняются; переход между ними разрывает линию.</p></details>
      {selected&&<div className={styles.trendReading} data-trend-reading={selected.date}>
        <label className={styles.trendSelect}>Дата значений графика<select value={selected.date} onChange={e=>setSelectedDate(e.target.value)}>{points.map(p=><option key={p.date} value={p.date}>{dayLabel(p.date)}</option>)}</select></label>
        <div className={styles.trendValues} aria-live="polite" aria-atomic="true"><p><time dateTime={selected.date}>{dayLabel(selected.date)}</time> · отдельная ночь, без усреднения</p><div data-trend-daily={selected.date}><span>Балл ночи · <span className={styles.trendUnit}>0–100</span><strong data-trend-daily-value="score">{dailyValue(selected.dailyScore,100)}</strong></span><span>Твоя оценка · <span className={styles.trendUnit}>1–5</span><strong data-trend-daily-value="mood">{dailyValue(selected.dailyMood,5)}</strong></span></div><p>Средняя точка на графике · 7 календарных дней</p><p data-trend-window="true">{dayLabel(selected.windowStart)} — {dayLabel(selected.date)}. Записей: <span data-trend-count={selected.count}>{selected.count} / 7</span>.</p><div><span>Расчёт · <span className={styles.trendUnit}>0–100</span><strong data-trend-value="score">{selected.scoreMixed?'Разные версии':pointValue(selected.score,100)}</strong></span><span>Самочувствие · <span className={styles.trendUnit}>1–5</span><strong data-trend-value="mood">{pointValue(selected.mood,5)}</strong></span></div>{selected.dailyScore===null&&<p data-trend-gap="true">За эту ночь нет записи, поэтому точка на линии не строится, даже если в семи днях есть другие записи.</p>}</div>
      </div>}
      <details className={styles.trendTable} data-trend-table="true"><summary>Все значения текстом</summary><table><caption>Данные графика: балл и самочувствие. Средние за 7 дней.</caption><thead><tr><th scope="col">Дата<br/><small>Записей / 7</small></th><th scope="col">Расчёт<br/>0–100</th><th scope="col">Самочувствие<br/>1–5</th></tr></thead><tbody>{points.map(p=><tr key={p.date} data-trend-row={p.date}><th scope="row"><button onClick={()=>onSelect(p.date)} aria-label={`Открыть ночь за ${p.date}`}><time dateTime={p.date}>{new Date(`${p.date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</time></button><small data-trend-count={p.count}>{p.count} / 7</small></th><td>{p.scoreMixed?'Разные версии':pointValue(p.score,100)}</td><td>{pointValue(p.mood,5)}</td></tr>)}</tbody></table></details>
      <p className={styles.fine}>Открыть ночь из графика:</p>
      <div className={styles.chartDays} aria-label="График изменений: выбрать день">{points.map(p=><button key={p.date} onClick={()=>onSelect(p.date)} aria-label={`${p.date}: открыть запись сна`}>{p.date.slice(-2)}</button>)}</div>
    </div>
  </section>;
}
function BarChartIcon(){return <BarChart3 size={20} aria-hidden="true"/>;}
