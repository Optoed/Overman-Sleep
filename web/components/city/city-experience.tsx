'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Building2, Check, CheckCheck, ChevronRight, Cloud, CloudRain, Compass, Dumbbell, FlaskConical, Heart, History, Home, Leaf, Map, Minus, Moon, Pause, PencilLine, Plane, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, Target, Users, VolumeX, X } from 'lucide-react';
import { CITY_KEY, CITY_LEGACY_KEY, DISTRICTS, completeDistrict, condition, demoCity, finishDay, isDue, levelOf, newCity, parseCity, population, settleTimer, writeJournal, type Biome, type City, type DistrictId, type Mood } from './city-state';
import type { CityRenderer } from './city-renderer';
import s from './city.module.css';
import { Coins, Hammer, Trophy, Zap } from 'lucide-react';
import { cityLevel, harvestEnergy, settleConstruction, touchActivity, startConstruction } from './city-game';
import { ConstructionStatus, DevelopmentPanel, EnergyPanel } from './city-game-panels';

const ICONS = { sport: Dumbbell, health: Heart, career: Building2, knowledge: FlaskConical, social: Users, travel: Plane, sleep: Moon };
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEATHER = { sun: 'Солнечно', mist: 'Тихий туман', rain: 'Дождь' };
type Tab = 'today' | 'districts' | 'people' | 'history' | 'development';
type Modal = 'journal' | 'settings' | 'focus' | 'finish' | 'reset' | 'energy' | null;
const NAMES = ['Миша', 'Аня', 'Лев', 'Соня', 'Марк', 'Вера', 'Артём', 'Алиса'];

export default function CityExperience() {
  const [live, setLive] = useState<City>(() => newCity(42620));
  const [sandbox, setSandbox] = useState<City | null>(null);
  const [example, setExample] = useState<'growth' | 'crisis' | null>(null);
  const [ready, setReady] = useState(false), [saveError, setSaveError] = useState('');
  const [tab, setTab] = useState<Tab>('today'), [selected, setSelected] = useState<DistrictId | null>(null);
  const [modal, setModal] = useState<Modal>(null), [reduced, setReduced] = useState(false);
  const [sceneStatus, setSceneStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [now, setNow] = useState(Date.now()), [notice, setNotice] = useState('');
  const [entry, setEntry] = useState(''), [tomorrow, setTomorrow] = useState(''), [mood, setMood] = useState<Mood>('sun');
  const sceneHost = useRef<HTMLDivElement>(null), engine = useRef<CityRenderer | null>(null);
  const panelRef = useRef<HTMLElement>(null), previousPanel = useRef('today:null');
  const current = sandbox ?? live, currentRef = useRef(current); currentRef.current = current;
  const liveRef = useRef(live); liveRef.current = live;
  const lastReward = useRef({ seed: current.seed, example, coins: current.game.coins, builds: current.game.builds, upgrades: current.game.upgrades.length });
  const select = useCallback((id: DistrictId) => { setSelected(id); setTab('districts'); }, []);
  const change = (fn: (city: City) => City) => { if (sandbox) setSandbox(c => c ? fn(c) : c); else setLive(fn); };
  const notify = (message: string) => setNotice(message);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CITY_KEY) ?? localStorage.getItem(CITY_LEGACY_KEY), saved = parseCity(raw);
      setLive(saved ? settleConstruction(settleTimer(harvestEnergy(saved, Date.now()), Date.now()), Date.now()) : touchActivity(newCity(), Date.now()));
      if (!raw) { setSandbox(demoCity('growth')); setExample('growth'); }
      if (raw && !saved) setSaveError('Сохранение повреждено. Создан новый город; можно начать заново.');
    } catch { setSaveError('Браузер не разрешает сохранение. Экспортируй город перед закрытием.'); }
    setReady(true);
    const media = matchMedia('(prefers-reduced-motion: reduce)'); setReduced(media.matches);
    const listener = () => setReduced(media.matches); media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem(CITY_KEY, JSON.stringify(live)); } catch { setSaveError('Не удалось сохранить город. Экспортируй его в настройках.'); } }, [live, ready]);
  useEffect(() => { const id = setInterval(() => { const time = Date.now(); setNow(time); if (!document.hidden) { setLive(c => settleConstruction(settleTimer(c, time), time)); setSandbox(c => c ? settleConstruction(settleTimer(c, time), time) : c); } }, 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!ready) return;
    const persistActivity = (returning: boolean) => {
      let latest = liveRef.current;
      try { const stored = parseCity(localStorage.getItem(CITY_KEY)); if (stored && stored.game.lastActive > latest.game.lastActive) latest = stored; } catch { /* The normal save effect reports unavailable storage. */ }
      const time = Date.now();
      const next = returning ? settleConstruction(settleTimer(harvestEnergy(latest, time), time), time) : touchActivity(latest, time);
      liveRef.current = next; setLive(next);
      try { localStorage.setItem(CITY_KEY, JSON.stringify(next)); } catch { /* Reported by the save effect. */ }
    };
    const visibility = () => persistActivity(!document.hidden);
    const pagehide = () => { if (!document.hidden) persistActivity(false); };
    const sync = (event: StorageEvent) => { if (event.key !== CITY_KEY) return; const saved = parseCity(event.newValue); if (saved) { liveRef.current = saved; setLive(saved); } };
    const heartbeat = setInterval(() => { if (!document.hidden) persistActivity(false); }, 10000);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide); window.addEventListener('storage', sync);
    return () => { clearInterval(heartbeat); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); window.removeEventListener('storage', sync); };
  }, [ready]);
  useEffect(() => {
    const previous = lastReward.current;
    if (previous.seed === current.seed && previous.example === example) {
      if (current.game.builds > previous.builds) setNotice('Бригада закончила работу! Город стал чуточку больше.');
      else if (current.game.coins > previous.coins) setNotice(`+${current.game.coins - previous.coins} монет! Так держать ✨`);
      else if (current.game.upgrades.length > previous.upgrades) setNotice('Новое место открыто! Посмотри, как изменился город ✨');
    }
    lastReward.current = { seed: current.seed, example, coins: current.game.coins, builds: current.game.builds, upgrades: current.game.upgrades.length };
  }, [current.seed, current.game.coins, current.game.builds, current.game.upgrades.length, example]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 4200); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    if (!ready || !sceneHost.current) return;
    let cancelled = false; setSceneStatus('loading');
    import('./city-renderer').then(({ createCityRenderer }) => {
      if (cancelled || !sceneHost.current) return;
      try { engine.current = createCityRenderer(sceneHost.current, currentRef.current, reduced, s.mapLabel, select, () => setSceneStatus('failed')); setSceneStatus('ready'); }
      catch { sceneHost.current.querySelectorAll('canvas,button').forEach(n => n.remove()); setSceneStatus('failed'); }
    }).catch(() => { if (!cancelled) setSceneStatus('failed'); });
    return () => { cancelled = true; engine.current?.dispose(); engine.current = null; };
  }, [ready, reduced, select]);
  useEffect(() => { engine.current?.update(current); }, [current]);
  useEffect(() => { engine.current?.select(selected); }, [selected, sceneStatus]);
  useEffect(() => { const key = `${tab}:${selected}`; if (previousPanel.current === key) return; previousPanel.current = key; if (matchMedia('(max-width:850px)').matches) panelRef.current?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' }); }, [tab, selected, reduced]);

  const due = DISTRICTS.filter(d => isDue(current, current.districts[d.id]));
  const done = due.filter(d => current.districts[d.id].done).length;
  const built = DISTRICTS.filter(d => current.districts[d.id].xp > 0).length;
  const damage = Math.round(DISTRICTS.reduce((n, d) => n + current.districts[d.id].damage, 0) / 7);
  const active = selected ? DISTRICTS.find(d => d.id === selected)! : null;
  const WeatherIcon = current.weather === 'sun' ? Sun : current.weather === 'mist' ? Cloud : CloudRain;
  const timerMs = current.timer ? current.timer.deadline ? Math.max(0, Math.min(current.timer.remaining, current.timer.deadline - now)) : current.timer.remaining : 25 * 60 * 1000;
  const seconds = Math.ceil(timerMs / 1000), timerText = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  const complete = (id: DistrictId) => { change(c => completeDistrict(c, id)); notify(`+${current.game.upgrades.includes('park') ? 20 : 15} монет · ${DISTRICTS.find(d => d.id === id)!.building} растёт!`); };
  function showExample(kind: 'growth' | 'crisis' | null) { setExample(kind); setSandbox(kind ? demoCity(kind) : null); setSelected(null); setTab('today'); }
  function openJournal() { const saved = current.journal.find(j => j.day === current.day); setEntry(saved?.text ?? ''); setTomorrow(saved?.tomorrow ?? ''); setMood(saved?.mood ?? current.weather); setModal('journal'); }
  function exportCity() { const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `city-day-${current.day}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Город экспортирован'); }

  return <div className={s.app}>
    <nav className={s.rail} aria-label="Разделы города">
      <button className={s.brand} aria-label="Мой город" onClick={() => { setTab('today'); setSelected(null); }}><Building2 size={26} /></button>
      <span className={s.railLine} />
      {([{ id: 'today', icon: Map, text: 'Город' }, { id: 'districts', icon: Target, text: 'Привычки' }, { id: 'development', icon: Trophy, text: 'Развитие' }, { id: 'people', icon: Users, text: 'Жители' }, { id: 'history', icon: History, text: 'История' }] as const).map(item => <button key={item.id} onClick={() => { setTab(item.id); setSelected(null); }} className={tab === item.id ? s.navActive : ''} aria-pressed={tab === item.id} title={item.text}><item.icon size={21} /><span>{item.text}</span></button>)}
      <div className={s.railBottom}><button onClick={() => setModal('settings')} aria-label="Настройки"><Settings2 size={21} /><span>Настройки</span></button><span className={s.avatar}>ТЫ</span></div>
    </nav>
    <div className={s.workspace}>
      <header className={s.header}>
        <div className={s.wordmark}>OVERMAN<span>Твоя жизнь. Твой город.</span></div>
        <div className={s.resources}><button onClick={() => setModal('energy')} aria-label={`Энергия: ${current.game.energy}`}><Zap size={17} fill="currentColor" /><b>{current.game.energy}</b><Plus size={12} /></button><button onClick={() => setTab('development')} aria-label={`Монеты: ${current.game.coins}`}><Coins size={17} /><b>{current.game.coins}</b></button><span><Trophy size={15} />Ур. {cityLevel(current)}</span></div>
        <div className={s.headerRight}><span className={s.local}><i />{sandbox ? 'Демонстрационный город' : saveError ? 'Сохранение недоступно' : 'Сохранено на устройстве'}</span><button className={s.outline} onClick={openJournal}><PencilLine size={16} />Записать день</button></div>
      </header>
      {saveError && <div className={s.error} role="status">{saveError}</div>}
      <main className={s.main}>
        <section className={s.mapArea} aria-label="Карта города">
          <div className={s.scene} ref={sceneHost} />
          {sceneStatus === 'loading' && <div className={s.loading}><Building2 /><span>Город просыпается…</span></div>}
          {sceneStatus === 'failed' && <div className={s.fallback}><img src="/city/city-concept.png" alt="Художественный концепт города привычек" /><p>3D недоступно в этом браузере. Это иллюстрация; привычки и управление городом доступны справа.</p></div>}
          <div className={s.mapHeading}>
            <div className={s.eyebrow}><Sparkles size={13} />БОЛЬШИЕ МЕЧТЫ. МАЛЕНЬКИЙ ГОРОД.</div>
            <h1>{current.name}</h1><p>{built === 0 ? 'Большой город начинается с одного шага.' : damage >= 20 ? 'Даже после шторма есть путь домой.' : 'Ты растёшь. И он растёт вместе с тобой.'}</p>
          </div>
          <div className={s.weather}><WeatherIcon size={19} /><span>{WEATHER[current.weather]}<small>{['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'][(current.day - 1) % 7]} · день {current.day}</small></span></div>
          <div className={s.stats}><div><Users size={17} /><strong>{population(current)}</strong><span>жителей</span></div><div><Building2 size={17} /><strong>{built}/7</strong><span>районов</span></div><div><Leaf size={17} /><strong>{100 - damage}%</strong><span>благополучие</span></div></div>
          <div className={s.compass}><Compass size={31} /><span>N</span></div>
          <div className={s.cameraControls} aria-label="Управление камерой">
            {([{ action: 'in', icon: Plus, label: 'Приблизить' }, { action: 'out', icon: Minus, label: 'Отдалить' }, { action: 'left', icon: ArrowLeft, label: 'Повернуть влево' }, { action: 'right', icon: ArrowRight, label: 'Повернуть вправо' }, { action: 'home', icon: RotateCcw, label: 'Общий вид' }] as const).map(c => <button key={c.action} onClick={() => engine.current?.camera(c.action)} title={c.label} aria-label={c.label} disabled={sceneStatus !== 'ready'}><c.icon size={17} /></button>)}
          </div>
          <div className={s.mapBottom}>
            <div className={s.preview}><span>ПОСМОТРЕТЬ ГОРОД</span><div>{([{ id: null, label: 'Мой город' }, { id: 'growth', label: 'Расцвет' }, { id: 'crisis', label: 'Кризис' }] as const).map(p => <button key={p.label} aria-pressed={example === p.id} className={example === p.id ? s.previewActive : ''} onClick={() => showExample(p.id)}>{p.label}{p.id === 'growth' && <Sparkles size={12} />}</button>)}</div></div>
            <span className={s.dragHint}>Потяни, чтобы оглядеться · прокрути для масштаба</span>
          </div>
          {sandbox && <div className={s.demoBanner}><Sparkles size={16} /><span>Это пример. Исследуй, меняй, восстанавливай.</span><button onClick={() => showExample(null)}>{built ? 'К своему городу' : 'Начать'}<ArrowRight size={14} /></button></div>}
        </section>
        <aside ref={panelRef} className={s.panel} aria-label="Управление городом">
          <div className={s.panelHeading}><span className={s.eyebrow}>{tab === 'development' ? 'НОВЫЕ ВОЗМОЖНОСТИ' : tab === 'today' ? 'КАЖДЫЙ ШАГ ВАЖЕН' : tab === 'districts' ? 'СЕМЬ ЧАСТЕЙ ТЕБЯ' : tab === 'people' ? 'ГОРОД — ЭТО ЛЮДИ' : 'ТВОЯ ИСТОРИЯ'}</span><span className={s.day}>ДЕНЬ {String(current.day).padStart(2, '0')}</span></div>
          {tab === 'today' && <>
            <h2>Приключение<br /><span>начинается с тебя!</span></h2>
            <p className={s.muted}>Каждый хороший шаг — новый кусочек города.</p>
            <button className={s.energyCard} onClick={() => setModal('energy')}><span className={s.energyCardIcon}><Zap size={29} fill="currentColor" /></span><span><small>ЭНЕРГИЯ ОТДЫХА</small><strong>{current.game.energy}<em>в запасе</em></strong><span>Направить в здание <ArrowRight size={12} /></span></span></button>
            {current.game.lastHarvest > 0 && <p className={s.returnReward}>Пока тебя не было: +{current.game.lastHarvest} энергии ✨</p>}
            {current.game.jobs.length > 0 && <button className={s.activeJobs} onClick={() => setModal('energy')}><Hammer size={15} />Бригады на работе: {current.game.jobs.length}<ChevronRight size={15} /></button>}
            <div className={s.progressHeader}><span>Сегодняшние шаги</span><strong>{done} <span>/ {due.length}</span></strong></div>
            <div className={s.progress}><i style={{ width: `${due.length ? done / due.length * 100 : 100}%` }} /></div>
            <div className={s.tasks}>{due.map(def => { const d = current.districts[def.id], Icon = ICONS[def.id]; return <div className={`${s.task} ${d.done ? s.taskDone : ''}`} key={def.id}>
              <button className={s.taskInfo} onClick={() => select(def.id)}><span className={s.habitIcon} style={{ color: def.color, background: `${def.color}15` }}><Icon size={19} /></span><span><strong>{def.task}</strong><small>{def.building} · {d.damage ? 'восстановление' : !d.xp ? 'первое здание' : `уровень ${levelOf(d)}`}</small></span></button>
              <button className={`${s.check} ${d.done ? s.checked : ''}`} aria-label={`${d.done ? 'Выполнено' : 'Выполнить'}: ${def.name}`} aria-pressed={d.done} disabled={d.done} onClick={() => complete(def.id)}>{d.done && <Check size={15} />}</button>
            </div>; })}</div>
            <button className={s.focusButton} onClick={() => setModal('focus')}><span><Target size={18} /><strong>{current.timer ? `Фокус · ${timerText}` : 'Время для фокуса'}</strong></span><span>{current.timer ? 'Вернуться' : '25 мин'}<Play size={13} fill="currentColor" /></span></button>
            <div className={s.note}><Leaf size={17} /><p>{done === due.length ? 'Сегодняшние шаги сделаны. Жители благодарны тебе.' : 'Не нужно менять всю жизнь за день. Достаточно одного маленького действия.'}</p></div>
            <button className={s.endDay} onClick={() => setModal('finish')}>Завершить день<ArrowRight size={16} /></button>
          </>}
          {tab === 'districts' && <>
            <h2>{active ? active.building : 'Твои районы'}</h2><p className={s.muted}>{active ? 'Одна привычка. Целый маленький мир.' : 'Выбери здание на карте или в списке.'}</p>
            {active ? (() => { const d = current.districts[active.id], Icon = ICONS[active.id]; return <div className={s.detail}>
              <div className={s.buildingBadge} style={{ background: `${active.color}20`, color: active.color }}><Icon size={46} /><span>{active.name}</span></div>
              <div className={s.detailTitle}><strong>{condition(d)}</strong><span>Уровень {levelOf(d)} / 5</span></div>
              <div className={s.progress}><i style={{ width: `${d.xp / 15 * 100}%`, background: active.color }} /></div><small className={s.muted}>{d.xp} из 15 шагов до полного развития</small>
              <label className={s.field}>Твоя привычка<input value={d.goal} maxLength={160} onChange={e => { const goal = e.target.value; change(c => ({ ...c, districts: { ...c.districts, [active.id]: { ...c.districts[active.id], goal } } })); }} /></label>
              <span className={s.fieldLabel}>Дни привычки</span><div className={s.week}>{WEEK.map((day, i) => <button key={day} aria-pressed={d.schedule.includes(i)} className={d.schedule.includes(i) ? s.weekActive : ''} onClick={() => change(c => ({ ...c, districts: { ...c.districts, [active.id]: { ...c.districts[active.id], schedule: d.schedule.includes(i) ? d.schedule.filter(n => n !== i) : [...d.schedule, i] } } }))}>{day}</button>)}</div>
              <div className={s.health}><ShieldCheck size={18} /><span>Состояние района</span><strong>{100 - d.damage}%</strong></div>
              {d.damage > 0 && <p className={s.warning}>{d.damage >= 70 ? 'Идёт эвакуация. ' : ''}Каждое выполненное действие уменьшает ущерб на 20. Полный ремонт займёт {Math.ceil(d.damage / 20)} дн.</p>}
              <button className={s.primary} disabled={d.done} onClick={() => complete(active.id)}>{d.done ? <><CheckCheck size={17} />На сегодня сделано</> : d.damage ? 'Помочь району восстановиться' : !d.xp ? 'Сделать шаг и заложить здание' : 'Отметить привычку'}</button>
              <ConstructionStatus city={current} id={active.id} now={now} />
              {!current.game.jobs.some(j => j.district === active.id) && <button className={s.energyBuildButton} disabled={current.game.energy < 20 || (d.xp >= 15 && d.damage === 0)} onClick={() => change(c => startConstruction(c, active.id, Date.now()))}><Hammer size={15} /><span>Строить на энергии</span><b><Zap size={13} />20</b></button>}
              <button className={s.textButton} onClick={() => setSelected(null)}>← Все районы</button>
            </div>; })() : <div className={s.districtList}>{DISTRICTS.map(def => { const d = current.districts[def.id], Icon = ICONS[def.id]; return <button key={def.id} onClick={() => select(def.id)}><span className={s.habitIcon} style={{ color: def.color, background: `${def.color}18` }}><Icon size={21} /></span><span><strong>{def.building}</strong><small>{condition(d)} · ур. {levelOf(d)}</small></span><ChevronRight size={16} /></button>; })}</div>}
          </>}
          {tab === 'people' && <><h2>Есть ради кого.</h2><p className={s.muted}>{population(current)} жителей называют этот город домом. С развитием районов сюда приезжают новые люди.</p><div className={s.residents}>{Array.from({ length: Math.min(8, population(current)) }, (_, i) => { const def = DISTRICTS[i % 7], d = current.districts[def.id]; return <div key={i}><span className={s.face} style={{ background: `${def.color}30` }}>{NAMES[i][0]}</span><div><strong>{NAMES[i]}</strong><small>{i < 3 ? 'Строитель' : `${def.building} · житель`}</small><p>{d.damage >= 70 ? 'Временно в убежище' : d.damage > 0 ? 'Помогает восстанавливать район' : !d.xp ? 'Готовит новый участок' : i % 2 ? 'Гуляет у фонтана' : 'Обживается в городе'}</p></div></div>; })}</div></>}
          {tab === 'history' && <><h2>Всё оставляет след.</h2><p className={s.muted}>Маленькая летопись больших перемен.</p><div className={s.timeline}>{current.events.map((e, i) => <div key={`${i}-${e.day}`}><span className={e.kind === 'crisis' ? s.eventDanger : s.eventDot} /><small>ДЕНЬ {e.day}</small><p>{e.text}</p></div>)}</div>{current.journal.length > 0 && <div className={s.journalHistory}><h3>Записи дневника</h3>{current.journal.map(j => <article key={j.day}><small>День {j.day} · {WEATHER[j.mood]}</small><p>{j.text}</p>{j.tomorrow && <p className={s.muted}>Завтра: {j.tomorrow}</p>}</article>)}</div>}</>}
          {tab === 'development' && <DevelopmentPanel city={current} change={change} />}
          <div className={s.panelFooter}><span className={s.liveDot} />{sandbox ? 'Пример · не меняет твой город' : 'Твой прогресс остаётся в этом браузере'}</div>
        </aside>
      </main>
      <footer className={s.footer}><div><span className={s.newsIcon}><Sparkles size={16} /></span><span><strong>Город живёт</strong><span>{current.events[0]?.text}</span></span></div><button onClick={() => setTab('history')}>Вся история<ArrowRight size={15} /></button></footer>
    </div>
    {notice && <><div className={s.toast} role="status"><Check size={17} />{notice}</div>{!reduced && (notice.includes('монет') || notice.includes('Бригада') || notice.includes('открыто')) && <div className={s.confetti} key={notice} aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ left: `${25 + i * 3.2}%`, background: ['#ffd85b', '#b08cf4', '#ff91b0', '#75d9c1'][i % 4], animationDelay: `${i % 5 * .08}s`, rotate: `${i * 37}deg` }} />)}</div>}</>}
    <Dialog.Root open={modal !== null} onOpenChange={open => { if (!open) setModal(null); }}><Dialog.Portal><Dialog.Overlay className={s.overlay} /><Dialog.Content className={s.modal}>
      <Dialog.Close className={s.close} aria-label="Закрыть"><X size={20} /></Dialog.Close>
      <Dialog.Title className={s.modalTitle}>{modal === 'energy' ? 'Ты отдыхаешь. Город растёт!' : modal === 'journal' ? 'Каким был твой день?' : modal === 'settings' ? 'Твой город, твои правила' : modal === 'focus' ? 'Побудь здесь. Сделай главное.' : modal === 'reset' ? 'Начать город заново?' : 'Завершить этот день?'}</Dialog.Title>
      <Dialog.Description className={s.modalDescription}>{modal === 'energy' ? 'Проведи время вне города, вернись с энергией и помоги строителям.' : modal === 'journal' ? 'Сохрани мысли. Пусть город запомнит их вместе с тобой.' : modal === 'settings' ? 'Настройки сохраняются только в этом браузере.' : modal === 'focus' ? 'Одна спокойная сессия помогает вырасти бизнес-центру.' : modal === 'reset' ? 'Здания, дневник и прогресс этого города будут удалены. Сначала можно экспортировать копию в настройках.' : 'Это игровой день. Календарное время не переключает его автоматически.'}</Dialog.Description>
      {modal === 'energy' && <EnergyPanel city={current} now={now} change={change} demo={!!sandbox} select={id => { select(id); setModal(null); }} />}
      {modal === 'journal' && <form onSubmit={e => { e.preventDefault(); change(c => writeJournal(c, entry, tomorrow, mood)); setModal(null); notify('Город запомнил твой день'); }}>
        <label className={s.field}>Что получилось сегодня?<textarea value={entry} onChange={e => setEntry(e.target.value)} maxLength={2000} required placeholder="Почитал книгу, выбрался на прогулку…" rows={4} /></label>
        <label className={s.field}>Маленький план на завтра<textarea value={tomorrow} onChange={e => setTomorrow(e.target.value)} maxLength={1000} rows={2} placeholder="С чего начнёшь следующий день?" /></label>
        <span className={s.fieldLabel}>Как ты себя чувствуешь?</span><div className={s.moods}>{([{ id: 'sun', label: 'На подъёме', icon: Sun }, { id: 'mist', label: 'Спокойно', icon: Cloud }, { id: 'rain', label: 'Непросто', icon: CloudRain }] as const).map(m => <button type="button" key={m.id} aria-pressed={mood === m.id} className={mood === m.id ? s.moodActive : ''} onClick={() => setMood(m.id)}><m.icon size={21} />{m.label}</button>)}</div>
        <p className={s.help}>Настроение меняет погоду, но не разрушает город. Упоминания книг, природы и путешествий добавляют украшения по простым локальным правилам.</p><button className={s.primary} type="submit">Сохранить день<BookOpen size={16} /></button>
      </form>}
      {modal === 'settings' && <>
        <label className={s.field}>Название города<input value={current.name} maxLength={40} onChange={e => { const name = e.target.value; change(c => ({ ...c, name })); }} /></label>
        <label className={s.field}>Окружение<select value={current.biome} onChange={e => { const biome = e.target.value as Biome; change(c => ({ ...c, biome })); }}><option value="coast">Зелёное побережье</option><option value="autumn">Золотая осень</option><option value="alpine">Северные горы</option></select></label>
        <button className={s.settingRow} aria-pressed={reduced} onClick={() => setReduced(!reduced)}><span>Спокойная сцена<small>Остановить движение жителей и эффекты</small></span><span className={reduced ? s.toggleOn : s.toggle}><i /></span></button>
        <button className={s.settingRow} onClick={exportCity}>Экспортировать город<ArrowDownToLine size={18} /></button>
        <label className={s.field}>Восстановить из файла<input type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 200000) { notify('Файл слишком большой'); return; } try { const imported = parseCity(await file.text()); if (!imported) { notify('Файл города не распознан'); return; } change(() => settleTimer(imported, Date.now())); notify('Город восстановлен из файла'); } catch { notify('Не удалось прочитать файл'); } }} /></label>
        <button className={s.textButton} onClick={() => setModal('reset')}>Начать заново</button><a className={s.towerLink} href="/tower">Открыть прежнюю башню ↗</a>
      </>}
      {modal === 'focus' && <><div className={s.timer}><span>{timerText}</span><small>{current.districts.career.done ? 'Сегодняшний шаг карьеры уже засчитан' : current.timer?.deadline ? 'Город строится, пока ты сосредоточен' : current.timer ? 'Пауза. Возвращайся, когда будешь готов.' : '25 минут · один шаг для карьеры'}</small></div>
        <button className={s.primary} disabled={current.districts.career.done && !current.timer} onClick={() => change(c => c.timer?.deadline ? { ...c, timer: { ...c.timer, remaining: Math.max(0, c.timer.deadline - Date.now()), deadline: null } } : { ...c, timer: { remaining: c.timer?.remaining ?? 1500000, deadline: Date.now() + (c.timer?.remaining ?? 1500000), day: c.day } })}>{current.timer?.deadline ? <><Pause size={17} />Пауза</> : <><Play size={17} />{current.timer ? 'Продолжить' : 'Начать фокус'}</>}</button>
        {current.timer && <button className={s.textButton} onClick={() => change(c => ({ ...c, timer: null }))}>Отменить сессию</button>}
        {sandbox && <button className={s.textButton} onClick={() => { change(c => completeDistrict({ ...c, timer: null }, 'career')); notify('Демонстрационная сессия завершена'); }}>Завершить демо-сессию сейчас</button>}
        <p className={s.help}><VolumeX size={13} /> Без звука. Активная сессия продолжится после закрытия окна; пауза сохраняется.</p>
      </>}
      {modal === 'finish' && <><div className={s.daySummary}><CheckCheck size={24} /><strong>{done} из {due.length} шагов сделано</strong></div>{done < due.length && <p className={s.warning}>Невыполненные привычки: {due.filter(d => !current.districts[d.id].done).map(d => d.name.toLowerCase()).join(', ')}. Построенные районы получат ущерб. Пустые участки останутся ждать.</p>}{current.timer && <p className={s.warning}>Текущая фокус-сессия будет отменена.</p>}<button className={s.primary} onClick={() => { change(finishDay); setModal(null); notify('Новый день. Новая возможность.'); }}>Перейти к дню {current.day + 1}<ArrowRight size={17} /></button></>}
      {modal === 'reset' && <button className={s.primary} onClick={() => { change(() => newCity()); setSelected(null); setTab('today'); setModal(null); notify('Новая гавань ждёт тебя'); }}>Да, начать с пустых участков</button>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
