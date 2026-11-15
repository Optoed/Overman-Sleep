'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronLeft, ChevronRight, Download, Expand, Flame, Leaf, Moon, Plus, Minus, Settings2, Sparkles, Sun, X } from 'lucide-react';
import LivingScene from '../tower/living-scene';
import { floorsOf, localDate, parseWorld, STORAGE_KEY, WEATHER, MAX_FLOORS, type Weather } from '../tower/world-state';
import type { WorldRenderer } from '../tower/world-renderer';
import { SLEEP_KEY, clockMinutes, demoSleep, freshSleep, localInput, nightChecks, parseSleep, persistSleep, recordNight, sleepWorld, streaks, validSchedule, type Night, type SleepState } from './sleep-state';
import styles from './sleep.module.css';

type Panel = 'schedule' | 'morning' | 'history' | 'settings' | 'demo' | null;
const hours = (minutes: number) => `${Math.floor(minutes / 60)} ч ${Math.round(minutes % 60)} мин`;
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const plural = (n: number, one: string, few: string, many: string) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;

export default function SleepTower() {
  const [state, setState] = useState(() => freshSleep()), [loaded, setLoaded] = useState(false), [demo, setDemo] = useState(false);
  const [panel, setPanel] = useState<Panel>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [schedule, setSchedule] = useState(state.schedule), [quality, setQuality] = useState<'high' | 'low'>('low'), [reduced, setReduced] = useState(false);
  const [bed, setBed] = useState(''), [wake, setWake] = useState(''), [duration, setDuration] = useState('8'), [rested, setRested] = useState(3), [editing, setEditing] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const api = useRef<WorldRenderer | null>(null), current = useRef(state), storage = useRef<Storage | null>(null), key = useRef(SLEEP_KEY), blocked = useRef(false);
  const world = useMemo(() => sleepWorld(state, now), [state, now]), floors = floorsOf(world), streak = streaks(state.nights, localDate(new Date(now))).current;
  const latest = state.nights[0];
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 6 + i); const date = localDate(d); return { date, night: state.nights.find(n => n.date === date) }; }), [now, state.nights]);
  const recorded = week.flatMap(d => d.night ? [d.night] : []), successful = recorded.filter(n => n.success).length;
  const avg = recorded.length ? Math.round(recorded.reduce((a, n) => a + n.sleepMinutes, 0) / recorded.length) : null;
  const previousStart = new Date(now); previousStart.setDate(previousStart.getDate() - 13);
  const previous = state.nights.filter(n => n.date >= localDate(previousStart) && n.date < week[0].date);
  const previousAvg = previous.length ? Math.round(previous.reduce((sum, n) => sum + n.sleepMinutes, 0) / previous.length) : null;
  const untilBed = (clockMinutes(state.schedule.bed) - new Date(now).getHours() * 60 - new Date(now).getMinutes() + 1440) % 1440;
  useEffect(() => {
    const params = new URLSearchParams(location.search), isDemo = params.get('demo') === '1'; setDemo(isDemo); key.current = isDemo ? `${SLEEP_KEY}.demo` : SLEEP_KEY;
    try {
      storage.current = isDemo ? sessionStorage : localStorage;
      const saved = parseSleep(storage.current.getItem(key.current));
      let initial = saved;
      const requestedFloors = Number(params.get('floors'));
      if (isDemo && params.has('floors') && Number.isInteger(requestedFloors) && requestedFloors >= 0 && requestedFloors <= MAX_FLOORS) {
        initial = { ...demoSleep(requestedFloors), revision: saved?.revision ?? 0 };
      }
      if (!initial) {
        const oldRaw = isDemo ? null : localStorage.getItem(STORAGE_KEY), old = parseWorld(oldRaw);
        if (oldRaw && !old) throw new Error('Прежнее сохранение острова не удалось прочитать. Оно не изменено. Можно открыть отдельное демо.');
        initial = isDemo ? demoSleep() : freshSleep(old ?? undefined);
      }
      current.current = initial; setState(initial); setSchedule(initial.schedule);
    } catch (e) { blocked.current = true; setError(e instanceof Error ? e.message : 'Сохранение недоступно.'); }
    setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches); setLoaded(true);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    const conflict = (e: StorageEvent) => { if (e.storageArea === storage.current && (e.key === key.current || e.key === null)) { blocked.current = true; setError('Данные изменились в другой вкладке. Обнови страницу перед сохранением.'); } };
    addEventListener('storage', conflict); return () => { clearInterval(timer); removeEventListener('storage', conflict); };
  }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(t); }, [notice]);
  function commit(next: SleepState) {
    if (blocked.current || !storage.current) return false;
    try { const saved = persistSleep(storage.current, key.current, current.current, next); current.current = saved; setState(saved); setError(''); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить. Не закрывай страницу и попробуй ещё раз.'); return false; }
  }
  function openSchedule() { setSchedule(current.current.schedule); setPanel('schedule'); }
  function startNight() {
    if (!state.configured) { openSchedule(); return; }
    if (commit({ ...current.current, active: { started: Date.now(), target: { ...current.current.schedule } } })) setNotice('Ночь началась. Можно закрыть приложение.');
  }
  function morning(n?: Night) {
    const end = n?.wake ?? Date.now(); let start = n?.bed ?? state.active?.started;
    if (start === undefined) { const d = new Date(end); const [h, m] = state.schedule.bed.split(':').map(Number); d.setHours(h, m, 0, 0); if (+d >= end) d.setDate(d.getDate() - 1); start = +d; }
    setBed(localInput(start)); setWake(localInput(end)); setDuration(String(n ? n.sleepMinutes / 60 : Math.min(state.schedule.hours, Math.floor((end - start) / 60000) / 60).toFixed(2))); setRested(n?.rested ?? 3); setEditing(n?.date ?? null); setPanel('morning');
  }
  function saveNight(e: React.FormEvent) {
    e.preventDefault();
    try {
      const wakeMs = new Date(wake).getTime();
      if (editing && localDate(new Date(wakeMs)) !== editing) throw new Error('При исправлении сохрани дату пробуждения. Для другой даты добавь отдельную ночь.');
      const next = recordNight(current.current, { bed: new Date(bed).getTime(), wake: wakeMs, sleepMinutes: Math.round(Number(duration) * 60), rested });
      const gained = next.credits.length > current.current.credits.length;
      if (commit(next)) { setPanel(null); setNotice(gained ? next.credits.length % 7 === 0 ? 'Новый этаж! Семь ночей стали частью твоего мира.' : 'Материалы доставлены. Башня растёт ночь за ночью.' : 'Ночь сохранена. Уже построенное остаётся с тобой.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Проверь данные ночи.'); }
  }
  function exportData() {
    const raw = blocked.current ? storage.current?.getItem(key.current) ?? '{}' : JSON.stringify(current.current, null, 2);
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })); a.href = url; a.download = 'overman-sleep.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const progress = floors >= MAX_FLOORS ? 7 : state.credits.length % 7;
  const titles = { schedule: 'Твой ритм сна', morning: editing ? 'Исправить ночь' : 'Доброе утро', history: 'Ночь за ночью', settings: 'Твой остров', demo: 'Заглянуть в будущее' };
  return <main className={styles.app}>
    <header className={styles.header}><a className={styles.brand} href="/"><Moon size={23}/><span>BECOME OVERMAN<small>THE SLEEP CHAPTER</small></span></a><nav><button onClick={() => setPanel('history')}>Мои ночи</button><button onClick={() => setPanel('settings')} aria-label="Настройки"><Settings2 size={19}/></button></nav></header>
    {demo && <div className={styles.demoBanner}>Демонстрационный остров · вымышленные ночи, отдельное сохранение <a href="/">Вернуться к своему острову ↗</a></div>}
    {loaded && state.configured && !state.active && untilBed <= 30 && <div className={styles.reminder} role="status">До твоего времени сна {untilBed} мин. Пора завершать день. Башня подождёт до утра.</div>}
    {error && <div className={styles.error} role="alert">{error} <button onClick={exportData}>Скачать данные</button> · <a href="/?demo=1">Открыть демо</a></div>}
    <section className={styles.intro}><div><span className={styles.eyebrow}>МАЛЕНЬКИЙ ВЕЧЕРНИЙ РИТУАЛ</span><h1>Ты отдыхаешь.<br/><em>Твой мир растёт.</em></h1></div><p>Одна привычка. Свой ритм.<br/>И целый остров, который ждёт тебя утром.</p></section>
    <div className={styles.layout}>
      <section className={styles.world} aria-label="Башня сна">
        <div className={styles.scene}>
          {loaded && !state.active && <LivingScene world={world} api={api} reduced={reduced} quality={quality} speed={1}/>}
          {state.active ? <div className={styles.night}><Moon size={60} strokeWidth={.8}/><span className={styles.eyebrow}>ОСТРОВ ОТДЫХАЕТ</span><h2>На сегодня достаточно.</h2><p>Отложи телефон. Утром здесь<br/>начнётся новая маленькая история.</p><button onClick={() => morning()} className={styles.wakeButton}><Sun size={19}/> Я проснулся</button><small>Можно закрыть приложение — начало ночи сохранено.</small><button onClick={() => { if (commit({ ...current.current, active: null })) setNotice('Начало ночи отменено. Прогресс не изменился.'); }} className={styles.nightCancel}>Нажал случайно · отменить</button></div> : <>
            <div className={styles.sceneLabel}><span>ТВОЙ ОСТРОВ</span><strong>{floors === 0 ? 'Здесь начинается история' : `Башня · ${floors} ${plural(floors, 'этаж', 'этажа', 'этажей')}`}</strong></div>
            <div className={styles.sceneActions}><button aria-label="Показать всю башню" onClick={() => api.current?.camera('overview')}><Expand size={18}/></button><button aria-label="Подняться к вершине" onClick={() => api.current?.camera('top')}><ArrowUp size={18}/></button><button aria-label="Спуститься к острову" onClick={() => api.current?.camera('home')}><ArrowDown size={18}/></button></div>
            <div className={styles.orbit}><button aria-label="Повернуть влево" onClick={() => api.current?.camera('left')}><ChevronLeft size={18}/></button><span>ПОТЯНИ, ЧТОБЫ ОСМОТРЕТЬСЯ</span><button aria-label="Повернуть вправо" onClick={() => api.current?.camera('right')}><ChevronRight size={18}/></button><button aria-label="Отдалить" onClick={() => api.current?.camera('out')}><Minus size={16}/></button><button aria-label="Приблизить" onClick={() => api.current?.camera('in')}><Plus size={16}/></button></div>
          </>}
        </div>
        <div className={styles.build}><div><span className={styles.eyebrow}>{floors >= MAX_FLOORS ? 'НЕБЕСНЫЙ ГОРОД' : `СЛЕДУЮЩИЙ ЭТАЖ · ${floors + 1}`}</span><h3>{floors >= MAX_FLOORS ? 'Твой мир продолжает жить' : `${7 - progress} ${plural(7 - progress, 'ночь', 'ночи', 'ночей')} до нового этажа`}</h3></div><span className={styles.progressCount}>{progress}<small>/ 7</small></span><div className={styles.stones}>{Array.from({ length: 7 }, (_, i) => <i key={i} data-done={i < progress}/>)}</div><p>Ночи накапливаются. Пропуск не отнимает построенное.</p></div>
      </section>
      <aside className={styles.sidebar}>
        <section className={styles.tonight}><div className={styles.cardHeading}><span className={styles.eyebrow}>СЕГОДНЯ НОЧЬЮ</span><Moon size={18}/></div><h2>{state.active ? 'Спокойной ночи' : 'Дай себе выдохнуть'}</h2><button className={styles.schedule} onClick={openSchedule} disabled={!!state.active}><span><small>ЛОЖУСЬ</small><strong>{state.schedule.bed}</strong></span><i>→</i><span><small>ВСТАЮ</small><strong>{state.schedule.wake}</strong></span><Settings2 size={15}/></button><p className={styles.target}>Цель: {state.schedule.hours} ч сна · окно ±{state.schedule.tolerance} мин</p><button className={styles.primary} disabled={!loaded || blocked.current || !!state.active} onClick={state.configured ? startNight : openSchedule}>{state.configured ? 'Ложусь спать' : 'Настроить мой режим'}<Moon size={18}/></button><button className={styles.textButton} disabled={!loaded || blocked.current} onClick={() => morning()}>{state.active ? 'Я уже проснулся' : 'Записать прошедшую ночь'}<ArrowUpRight size={16}/></button><p className={styles.micro}>Вечером — одно нажатие.<br/>Все открытия оставим на утро.</p></section>
        <section className={styles.lastNight}><div className={styles.cardHeading}><span className={styles.eyebrow}>ПОСЛЕДНЯЯ НОЧЬ</span><Sun size={18}/></div>{latest ? <><div className={styles.duration}>{hours(latest.sleepMinutes)}</div><p>{dayLabel(latest.date)} · {latest.bedClock} — {latest.wakeClock}</p><div className={styles.checks}>{Object.entries(nightChecks(latest)).map(([id, ok]) => <span key={id} data-ok={ok}>{ok ? <Check size={13}/> : <span>·</span>}{id === 'bed' ? 'Лёг вовремя' : id === 'wake' ? 'Встал вовремя' : 'Достаточно сна'}</span>)}</div><button className={styles.textButton} onClick={() => morning(latest)}>Исправить запись <ArrowUpRight size={14}/></button></> : <><h3>Первое утро впереди</h3><p>Запиши ночь — здесь появятся её продолжительность и попадание в твой режим.</p></>}<small>Дневник сна · твоя оценка, без датчиков</small></section>
        <section className={styles.reward}><Leaf size={28} strokeWidth={1.3}/><div><span className={styles.eyebrow}>{state.garden ? 'ОТКРЫТО' : 'СЛЕДУЮЩЕЕ ОТКРЫТИЕ'}</span><h3>Сад на башне</h3><p>{state.garden ? 'Твоя награда за семь ночей подряд. Сад останется с тобой.' : `${Math.min(streak, 7)} / 7 ночей подряд в режиме. На башне появятся растения.`}</p></div></section>
      </aside>
    </div>
    <section className={styles.week}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>РИТМ ВАЖНЕЕ ИДЕАЛЬНОСТИ</span><h2>Твоя неделя</h2></div><button className={styles.textButton} onClick={() => setPanel('history')}>Все ночи <ArrowUpRight size={17}/></button></div><div className={styles.weekBody}><div className={styles.days}>{week.map(({ date, night }) => <button key={date} onClick={() => night ? morning(night) : setPanel('history')} aria-label={`${date}: ${night ? hours(night.sleepMinutes) : 'нет записи'}`}><small>{new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short' })}</small><span data-kind={night ? night.success ? 'success' : 'recorded' : 'empty'}>{night ? night.success ? <Check size={18}/> : <Moon size={17}/> : '—'}</span><small>{date.slice(-2)}</small></button>)}</div><div className={styles.weekStats}><div><strong>{successful}<small> / {recorded.length || '—'}</small></strong><span>ночей в режиме</span></div><div><strong>{avg === null ? '—' : hours(avg)}</strong><span>средняя оценка сна</span></div><div><strong><Flame size={19}/>{streak}</strong><span>ночей подряд</span></div></div></div><p className={styles.weekNote}>Пустой день означает «нет записи», а не плохой сон. Самочувствие и режим — разные вещи.</p></section>
    {avg !== null && previousAvg !== null && <p className={styles.comparison}>По записанным ночам: средняя оценка сна {avg === previousAvg ? 'не изменилась' : `${avg > previousAvg ? 'выросла' : 'снизилась'} на ${Math.abs(avg - previousAvg)} мин`} относительно предыдущих семи дней. Записей в периодах: {recorded.length} и {previous.length}. Это сравнение дневника, а не оценка здоровья.</p>}
    <footer className={styles.footer}><span><Moon size={14}/> Спи для себя. Строй без спешки.</span><button onClick={() => setPanel('demo')}>Посмотреть развитие башни <Sparkles size={14}/></button><small>{demo ? 'Отдельный демосеанс' : 'Записи хранятся в этом браузере'}</small></footer>
    {!panel && <div className={styles.quickAction}><span>{state.schedule.bed} → {state.schedule.wake}<small>Твой вечерний ритуал</small></span><button disabled={!loaded || blocked.current} onClick={state.active ? () => morning() : state.configured ? startNight : openSchedule}>{state.active ? 'Утро' : state.configured ? 'Ложусь' : 'Мой режим'}<Moon size={16}/></button></div>}
    {notice && <div className={styles.toast} role="status">{notice}</div>}
    <Dialog.Root open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.dialog}><Dialog.Close aria-label="Закрыть" className={styles.close}><X size={20}/></Dialog.Close><span className={styles.eyebrow}>ТВОЙ МИР. ТВОЙ РИТМ.</span><Dialog.Title className={styles.dialogTitle}>{panel ? titles[panel] : ''}</Dialog.Title><Dialog.Description className={styles.description}>{panel === 'morning' ? 'Примерная оценка достаточно хороша. Здесь не нужно ничего доказывать.' : panel === 'schedule' ? 'Выбери подходящий тебе режим. Изменения применяются к будущим ночам.' : panel === 'history' ? 'Время, самочувствие и маленькие шаги вперёд.' : panel === 'demo' ? 'Вымышленные ночи покажут развитие. Личные записи останутся отдельно.' : 'Внешний вид и сохранение твоего мира.'}</Dialog.Description>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {panel === 'schedule' && <form className={styles.form} onSubmit={e => { e.preventDefault(); if (!validSchedule(schedule)) { setError('Между отходом ко сну и подъёмом должно хватать времени на выбранную продолжительность сна.'); return; } if (commit({ ...current.current, schedule, configured: true })) { setPanel(null); setNotice('Режим сохранён. Вечером нажми «Ложусь спать».'); } }}><div className={styles.fields}><label>Ложусь в<input required type="time" value={schedule.bed} onChange={e => setSchedule({ ...schedule, bed: e.target.value })}/></label><label>Встаю в<input required type="time" value={schedule.wake} onChange={e => setSchedule({ ...schedule, wake: e.target.value })}/></label></div><label>Моя цель сна, часов<input required type="number" min="4" max="12" step="0.25" value={schedule.hours} onChange={e => setSchedule({ ...schedule, hours: Number(e.target.value) })}/></label><label>Допустимое отклонение от времени<select aria-label="Допустимое отклонение от времени" value={schedule.tolerance} onChange={e => setSchedule({ ...schedule, tolerance: Number(e.target.value) })}><option value="30">±30 минут</option><option value="45">±45 минут</option><option value="60">±60 минут</option></select></label><p className={styles.fine}>Ночь приносит материалы, когда время отхода ко сну и подъёма попадает в окно, а твоя оценка сна не ниже цели минус 30 минут. Самочувствие на награды не влияет. Напоминания вне открытого приложения пока не подключены.</p><button className={styles.primary} disabled={blocked.current || !!state.active}>Сохранить режим <Check size={17}/></button>{state.active && <p>Режим можно изменить после завершения текущей ночи.</p>}</form>}
      {panel === 'morning' && <form className={styles.form} onSubmit={saveNight}><label>Лёг в кровать<input required type="datetime-local" value={bed} onChange={e => setBed(e.target.value)}/></label><label>Проснулся<input required type="datetime-local" value={wake} onChange={e => setWake(e.target.value)}/></label><label>Сколько примерно спал, часов<input required type="number" min="0" max="24" step="any" value={duration} onChange={e => setDuration(e.target.value)}/></label><p className={styles.fine}>Вычти время засыпания и ночных пробуждений, если помнишь. Мы не измеряем фазы сна и не приравниваем время в кровати ко сну.</p><fieldset className={styles.feelings}><legend>Насколько ты отдохнул?</legend>{['Совсем нет', 'Мало', 'Средне', 'Хорошо', 'Отлично'].map((label, i) => <button type="button" key={label} aria-pressed={rested === i + 1} onClick={() => setRested(i + 1)}><span>{i + 1}</span>{label}</button>)}</fieldset><button className={styles.primary} disabled={blocked.current}>Сохранить ночь <Sun size={17}/></button><p className={styles.fine}>Одна запись на дату пробуждения. Исправление заменит её, без повторной награды. Уже выданные материалы сохраняются.</p></form>}
      {panel === 'history' && <div className={styles.history}>{!state.nights.length ? <p>Здесь пока тихо. После первой записи появится история сна.</p> : state.nights.map(n => <button key={n.date} onClick={() => morning(n)}><span><strong>{dayLabel(n.date)}</strong><small>{n.bedClock} → {n.wakeClock} · самочувствие {n.rested}/5</small></span><span><strong>{hours(n.sleepMinutes)}</strong><small>{n.success ? 'В режиме' : 'Записано'}</small></span><ChevronRight size={17}/></button>)}<button className={styles.secondary} onClick={() => morning()}>Добавить ночь <Plus size={17}/></button></div>}
      {panel === 'settings' && <div className={styles.form}><button className={styles.secondary} onClick={openSchedule}>Настроить режим сна <Moon size={17}/></button><label>Погода<select aria-label="Погода" value={state.world.weather} onChange={e => commit({ ...current.current, world: { ...current.current.world, weather: e.target.value as Weather } })}>{Object.entries(WEATHER).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className={styles.switch}><span>Детальная графика</span><input type="checkbox" checked={quality === 'high'} onChange={e => setQuality(e.target.checked ? 'high' : 'low')}/></label><label className={styles.switch}><span>Уменьшить движение</span><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)}/></label><button className={styles.secondary} onClick={exportData}>Скачать мои записи <Download size={17}/></button><p className={styles.fine}>Дневник локальный: без облачной синхронизации, часов и AI. Очистка браузера удалит записи. Не редактируй их одновременно в нескольких вкладках. Прежний остров скопирован при первом запуске и хранится отдельно.</p><a className={styles.textButton} href="/tower">Прежняя версия и личная комната ↗</a></div>}
      {panel === 'demo' && <div className={styles.form}>{demo ? <><div className={styles.demoOptions}>{[0, 4, 12, 24, 100].map(n => <button key={n} className={styles.secondary} onClick={() => { const next = demoSleep(n); if (commit(next)) { history.replaceState(null, '', `/?demo=1&floors=${n}`); setPanel(null); } }}>{n === 0 ? 'Начало' : `${n} ${plural(n, 'этаж', 'этажа', 'этажей')}`}</button>)}</div><a className={styles.primary} href="/">Вернуться к своему острову</a></> : <a className={styles.primary} href="/?demo=1">Открыть отдельное демо <ArrowUpRight size={17}/></a>}<p className={styles.fine}>Каждые семь успешных ночей суммарно дают этаж. Семь подряд открывают сад. Серия может прерваться, но этажи и украшения остаются.</p></div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </main>;
}
