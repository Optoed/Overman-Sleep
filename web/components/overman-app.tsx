'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Clock3, Flame,
  Globe2, LayoutGrid, LogOut, Menu, Moon, RefreshCw, Search, Settings2, ShieldCheck,
  Sparkles, Target, Trophy, UserRound, UserRoundPlus, UsersRound, Volume2, VolumeX, X } from 'lucide-react';
import type { User } from '@/lib/legacy-backend';
import { Checkbox, Modal } from './ui';
import { complete, dayLabel, friendIds, hoursLabel, localDay, shiftDay, stats,
  type Checkin, type Profile, type Snapshot } from '@/lib/domain';
import { demoSnapshot } from '@/lib/demo';
import { isConfigured, legacyBackend } from '@/lib/legacy-backend';
import { loadSnapshot, readableError } from '@/lib/api';
import GameAtmosphere from './game-atmosphere';
import GameDialogue from './game-dialogue';
import { IntroAudio } from './intro/intro-audio';

type View = 'today' | 'players' | 'ranking' | 'profile';
const navigation = [
  { id: 'today' as const, label: 'Сегодня', icon: LayoutGrid },
  { id: 'players' as const, label: 'Игроки', icon: UsersRound },
  { id: 'ranking' as const, label: 'Рейтинг', icon: Trophy },
  { id: 'profile' as const, label: 'Мой профиль', icon: UserRound },
];

export default function OvermanApp() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<View>('today');
  const [selected, setSelected] = useState<Profile | null>(null);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const requestSequence = useRef(0);
  const activeUserId = useRef<string | null>(null);
  const [gameAudio] = useState(() => new IntroAudio());
  const [sound, setSound] = useState(false);
  useEffect(() => () => gameAudio.dispose(), [gameAudio]);

  const refresh = useCallback(async (id: string, initial = false) => {
    const sequence = ++requestSequence.current;
    if (initial) setLoading(true);
    try {
      const result = await loadSnapshot(id);
      if (sequence === requestSequence.current) { setData(result); setError(''); setLoadFailed(false); }
    } catch (err) { if (sequence === requestSequence.current) { setError(readableError(err)); setLoadFailed(true); } }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!legacyBackend) { setDemo(true); setData(demoSnapshot()); setLoading(false); return; }
    const { data: { subscription } } = legacyBackend.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      const nextId = session?.user.id ?? null;
      if (nextId && nextId === activeUserId.current) return;
      activeUserId.current = nextId;
      if (session?.user) { setDemo(false); void refresh(session.user.id, true); }
      else { requestSequence.current++; setData(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
    // StrictMode can unsubscribe and subscribe again before INITIAL_SESSION arrives.
  }, [refresh]);
  useEffect(() => {
    const tick = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (demo || !user) return;
    const reload = () => { if (document.visibilityState === 'visible') void refresh(user.id); };
    const timer = setInterval(reload, 60000);
    document.addEventListener('visibilitychange', reload);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', reload); };
  }, [demo, user, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const today = localDay(data?.me.timezone ?? 'Europe/Moscow', clock);
  const ownReports = data?.checkins.filter(item => item.user_id === data.me.id) ?? [];
  const ownStats = stats(ownReports, today);

  async function saveCheckin(values: Pick<Checkin, 'bedtime' | 'sleep_minutes' | 'rested' | 'on_time' | 'unplugged' | 'discipline'>, reportDay: string) {
    if (!data || busy) return false;
    setBusy(true); setError('');
    try {
      if (demo) {
        if (reportDay !== localDay(data.me.timezone)) throw new Error('report_day_closed');
        const existing = data.checkins.find(c => c.user_id === data.me.id && c.day === reportDay);
        const item: Checkin = { ...values, id: `demo-${reportDay}`, user_id: data.me.id, day: reportDay,
          target_bedtime: existing?.target_bedtime ?? data.me.bedtime, target_min: existing?.target_min ?? data.me.sleep_min, target_max: existing?.target_max ?? data.me.sleep_max,
          created_at: new Date().toISOString() };
        setData(prev => prev && ({ ...prev, checkins: [...prev.checkins.filter(c => !(c.user_id === prev.me.id && c.day === reportDay)), item] }));
      } else {
        const result = await legacyBackend!.rpc('save_checkin', { p_day: reportDay, p_bedtime: values.bedtime,
          p_sleep_minutes: values.sleep_minutes, p_rested: values.rested, p_on_time: values.on_time,
          p_unplugged: values.unplugged, p_discipline: values.discipline });
        if (result.error) throw result.error;
        await refresh(data.me.id);
      }
      setNotice(values.rested && values.on_time && values.unplugged ? 'Слово сдержано. Ещё один день в твою пользу.' : 'Отчёт сохранён. Честность — тоже дисциплина.');
      return true;
    } catch (err) { setError(readableError(err)); return false; }
    finally { setBusy(false); }
  }

  async function saveProfile(values: Omit<Profile, 'id' | 'created_at'>) {
    setBusy(true); setError('');
    try {
      if (demo && data) {
        const me = { ...data.me, ...values };
        setData({ ...data, me, profiles: data.profiles.map(p => p.id === me.id ? me : p) });
      } else {
        const result = await legacyBackend!.rpc('save_profile', { p_nickname: values.nickname, p_bedtime: values.bedtime,
          p_sleep_min: values.sleep_min, p_sleep_max: values.sleep_max, p_timezone: values.timezone });
        if (result.error) throw result.error;
        await refresh(user!.id);
      }
      setSettings(false); setNotice('Твой режим сохранён.');
    } catch (err) { setError(readableError(err)); }
    finally { setBusy(false); }
  }

  async function friendship(otherId: string, action: 'request' | 'accept' | 'remove') {
    if (!data || busy) return;
    setBusy(true); setError('');
    try {
      if (demo) {
        setData(prev => {
          if (!prev) return prev;
          let list = prev.friendships;
          if (action === 'request') list = [...list, { id: crypto.randomUUID(), requester: prev.me.id, recipient: otherId, status: 'pending' }];
          else if (action === 'accept') list = list.map(f => f.requester === otherId && f.recipient === prev.me.id ? { ...f, status: 'accepted' } : f);
          else list = list.filter(f => !([f.requester, f.recipient].includes(otherId) && [f.requester, f.recipient].includes(prev.me.id)));
          return { ...prev, friendships: list };
        });
      } else {
        const result = await legacyBackend!.rpc('manage_friendship', { p_other: otherId, p_action: action });
        if (result.error) throw result.error;
        await refresh(data.me.id);
      }
      setNotice(action === 'request' ? 'Заявка отправлена.' : action === 'accept' ? 'Теперь вы друзья.' : 'Список друзей обновлён.');
    } catch (err) { setError(readableError(err)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (demo) { setDemo(false); setData(null); setView('today'); return; }
    const result = await legacyBackend!.auth.signOut();
    if (result.error) setError(readableError(result.error));
    else { setData(null); setView('today'); }
  }

  function openProfile(profile: Profile) { setSelected(profile); setView('profile'); }
  function navigate(next: View) { setView(next); setSelected(null); setMobileMenu(false); }

  if (loading) return <div className="loading-screen"><Brand/><div className="loading-line"/><p>Собираем твой прогресс…</p></div>;
  if (!data) return <AuthScreen user={user} error={error} loadFailed={loadFailed} busy={busy} onProfile={saveProfile}
    onDemo={() => { setDemo(true); setData(demoSnapshot()); setError(''); }}
    onRetry={() => user && refresh(user.id, true)} onSignOut={signOut}/>;

  const activeProfile = selected ? data.profiles.find(p => p.id === selected.id) ?? data.me : data.me;
  const incoming = data.friendships.filter(f => f.recipient === data.me.id && f.status === 'pending').length;

  return <div className="app-shell" onClickCapture={event => {
    if ((event.target as HTMLElement).closest('button:not([data-sound-control])')) gameAudio.blip(3);
  }}>
    <GameAtmosphere/>
    {mobileMenu && <button className="nav-scrim" aria-label="Закрыть меню" onClick={() => setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
      <a href="/" className="brand-link" aria-label="Become Overman — главная"><Brand/></a>
      <div className="workspace-label">ВЫБЕРИ СВОЙ ХОД <span>01</span></div>
      <nav aria-label="Главная навигация">{navigation.map(({ id, label, icon: Icon }) =>
        <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}>
          <Icon size={18}/><span>{label}</span>{id === 'players' && incoming > 0 && <span className="nav-count">{incoming}</span>}
        </button>)}</nav>
      <div className="sidebar-quest"><span className="eyebrow">ТВОЙ ПЕРВЫЙ КВЕСТ</span><div><Moon size={17}/> Режим сна</div><span className="tiny-muted">Большое начинается с базового.</span></div>
      <div className="sidebar-bottom"><a className="replay-link" href="/intro"><ArrowUpRight size={15}/> Глава ноль · переиграть</a><button className="help-link" onClick={() => setHelp(true)}><CircleHelp size={17}/> Как это работает</button>
        <div className="sidebar-user"><Avatar name={data.me.nickname}/><button onClick={() => navigate('profile')}><strong>{data.me.nickname}</strong><span>На своей стороне</span></button>
          <button className="icon-button" aria-label="Выйти" title="Выйти" onClick={signOut}><LogOut size={16}/></button></div>
      </div>
    </aside>
    <div className="main-wrap">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={() => setMobileMenu(true)}><Menu size={20}/></button>
        <span>Твоё пространство</span><ChevronRight size={13}/><strong>{navigation.find(n => n.id === view)?.label}</strong></div>
        <div className="topbar-actions"><button className="game-sound" data-sound-control aria-label={sound ? 'Выключить звук' : 'Включить звук'} aria-pressed={sound}
          onClick={async () => { if (sound) { gameAudio.mute(); setSound(false); } else { setSound(await gameAudio.enable()); } }}>
          {sound ? <Volume2 size={16}/> : <VolumeX size={16}/>}<span>ЗВУК {sound ? 'ON' : 'OFF'}</span></button>
          <span className="edition"><span className="status-dot"/> ГЛАВА 01 <span className="edition-tag">BETA</span></span></div>
      </header>
      <main>
        {demo && <div className="demo-banner"><span><Sparkles size={15}/> Демо-режим · пример данных, изменения до перезагрузки</span>
          {isConfigured ? <button onClick={() => { setDemo(false); setData(null); }}>Создать аккаунт <ArrowUpRight size={14}/></button> : <span className="demo-note">Онлайн-база ещё не подключена</span>}</div>}
        {error && <div className="error-banner" role="alert">{error}<button className="icon-button" aria-label="Скрыть сообщение" onClick={() => setError('')}><X size={17}/></button></div>}
        <GameDialogue audio={gameAudio} text={view === 'today' ? 'Ты здесь. Уже неплохо. Теперь — сдержи одно обещание.' : view === 'players' ? 'У каждого свой путь. Но идти рядом никто не запрещал.' : view === 'ranking' ? 'Здесь побеждает тот, кто возвращается. День за днём.' : 'Это твоя история. Она пишется поступками.'}/>
        {view === 'today' && <>
          <div className="page-heading"><div><div className="eyebrow date-line">{dayLabel(today, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1>Держи слово себе<span className="heading-dot">.</span></h1><p>Один квест. Каждый день. Твоя точка опоры.</p></div>
            <button className="button button-secondary schedule-button" onClick={() => setSettings(true)}><Settings2 size={16}/> Мой режим</button></div>
          <div className="dashboard-grid">
            <QuestCard key={`${today}-${data.me.id}`} profile={data.me} report={ownReports.find(c => c.day === today)} today={today} busy={busy} onSave={saveCheckin}/>
            <div className="right-column"><section className="streak-card"><div className="card-kicker"><span>ТЕКУЩАЯ СЕРИЯ</span><Flame size={20}/></div>
              <div className="streak-number">{String(ownStats.current).padStart(2, '0')}<span>{pluralDays(ownStats.current)}<br/>подряд</span></div>
              <p>{ownStats.current > 0 ? 'Ты уже строишь новую версию себя.' : 'Первый день — начало твоей серии.'}</p>
              <div className="streak-footer"><span><Trophy size={14}/> Личный рекорд</span><strong>{ownStats.best} {pluralDays(ownStats.best)}</strong></div></section>
              <section className="regime-card"><div className="section-label"><Clock3 size={16}/><span>ТВОЙ РЕЖИМ</span></div><div className="regime-times"><div><span>Отбой</span><strong>{data.me.bedtime.slice(0,5)}</strong></div><ArrowRight size={20}/><div><span>Цель сна</span><strong>{data.me.sleep_min / 60}–{data.me.sleep_max / 60}<small> ч</small></strong></div></div>
                <p>Ритм, который ты выбираешь сам.</p></section>
            </div>
          </div>
          <section className="week-section"><div className="section-heading"><h2>Маленькие шаги. Видимый прогресс.</h2><span>Последние 7 дней</span></div>
            <WeekStrip reports={ownReports} today={today}/></section>
          <section className="community-preview"><div className="section-heading"><h2>Люди рядом</h2><button className="text-button" onClick={() => navigate('players')}>Все игроки <ArrowRight size={15}/></button></div>
            <div className="community-row">{data.profiles.filter(p => p.id !== data.me.id).slice(0,3).map(p => <button key={p.id} className="compact-player" onClick={() => openProfile(p)}>
              <Avatar name={p.nickname}/><span><strong>{p.nickname}</strong><small>Отбой {p.bedtime.slice(0,5)}</small></span><span className="compact-streak"><Flame size={14}/>{stats(data.checkins.filter(c => c.user_id === p.id), localDay(p.timezone, clock)).current}</span></button>)}
              {data.profiles.length < 2 && <div className="empty-inline">Ты здесь первым. Поделись ссылкой на приложение с другом.</div>}</div></section>
        </>}
        {(view === 'players' || view === 'ranking') && <Players data={data} ranking={view === 'ranking'} clock={clock} onProfile={openProfile} onFriend={friendship} busy={busy}/>}
        {view === 'profile' && <ProfilePage profile={activeProfile} data={data} clock={clock} onEdit={() => setSettings(true)} onFriend={friendship} busy={busy}/>}
        <footer className="page-footer"><span>BECOME OVERMAN</span><span>Дисциплина начинается с одного решения.</span><span>01 / СОН</span></footer>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Мобильная навигация">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={20}/><span>{id === 'profile' ? 'Профиль' : label}</span></button>)}</nav>
    <Modal open={settings} onOpenChange={setSettings} title="Твой режим" description="Выбери ритм, которого хочешь придерживаться. Новые цели применятся со следующего отчёта.">
      <ProfileForm profile={data.me} onSave={saveProfile} busy={busy}/>{error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
    <Modal open={help} onOpenChange={setHelp} title="Одно обещание. Каждый день." description="Здесь ты соревнуешься прежде всего с собой.">
      <div className="help-content"><p><strong>Утром отметь прошедшую ночь.</strong> Дата отчёта — день пробуждения в твоём часовом поясе.</p><p><strong>Три галочки — квест выполнен.</strong> Неполный отчёт сохраняется, но не продолжает серию. Сегодняшние ответы можно исправлять до полуночи.</p><p><strong>Рейтинг — за последние 7 дней.</strong> Считаем полностью выполненные квесты, при равенстве — текущую серию. Самооценка на место не влияет.</p><p><strong>Всё по-честному.</strong> Другие участники видят ник, режим и отчёты. Email виден только тебе.</p></div>
    </Modal>
    {notice && <div className="toast" role="status"><Check size={18}/>{notice}</div>}
  </div>;
}

function Brand() { return <div className="brand"><span className="brand-mark">B.</span><span>become<br/><strong>overman</strong></span></div>; }
function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-hidden="true">{name.slice(0,2).toUpperCase()}</span>;
}
function pluralDays(n: number) { return n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'дня' : 'дней'; }

function QuestCard({ profile, report, today, busy, onSave }: { profile: Profile; report?: Checkin; today: string; busy: boolean;
  onSave: (values: Pick<Checkin, 'bedtime' | 'sleep_minutes' | 'rested' | 'on_time' | 'unplugged' | 'discipline'>, day: string) => Promise<boolean> }) {
  const [rested, setRested] = useState(report?.rested ?? false);
  const [onTime, setOnTime] = useState(report?.on_time ?? false);
  const [unplugged, setUnplugged] = useState(report?.unplugged ?? false);
  const [bedtime, setBedtime] = useState(report?.bedtime.slice(0,5) ?? profile.bedtime.slice(0,5));
  const [minutes, setMinutes] = useState(report?.sleep_minutes ?? profile.sleep_min);
  const [discipline, setDiscipline] = useState(report?.discipline ?? 3);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setRested(report?.rested ?? false); setOnTime(report?.on_time ?? false); setUnplugged(report?.unplugged ?? false);
    setBedtime(report?.bedtime.slice(0,5) ?? profile.bedtime.slice(0,5));
    setMinutes(report?.sleep_minutes ?? profile.sleep_min); setDiscipline(report?.discipline ?? 3);
  }, [report, profile.bedtime, profile.sleep_min, dirty]);
  const count = Number(rested) + Number(onTime) + Number(unplugged);
  const targetMin = report?.target_min ?? profile.sleep_min;
  const targetMax = report?.target_max ?? profile.sleep_max;
  const targetBedtime = report?.target_bedtime ?? profile.bedtime;
  const mismatch = rested && (minutes < targetMin || minutes > targetMax);
  const checkboxes = [
    { value: rested, set: setRested, title: 'Я выспался', text: `${targetMin / 60}–${targetMax / 60} часов — столько, сколько мне нужно`, icon: Moon },
    { value: onTime, set: setOnTime, title: 'Я лёг вовремя', text: `Соблюдал свой режим. Мой ориентир — ${targetBedtime.slice(0,5)}`, icon: Clock3 },
    { value: unplugged, set: setUnplugged, title: 'Я отключился от лишнего', text: 'Без думскроллинга и залипания перед сном', icon: ShieldCheck },
  ];
  return <section className={`quest-card ${report && complete(report) && !dirty ? 'quest-done' : ''}`}>
    <div className="quest-top"><span className="eyebrow">ЕЖЕДНЕВНЫЙ КВЕСТ <span className="muted">/ 001</span></span><span className={`pill ${report && !dirty ? 'pill-saved' : ''}`}>{report && !dirty ? complete(report) ? 'Выполнен' : 'Отчёт сохранён' : 'В процессе'}</span></div>
    <div className="quest-title"><span className="moon-tile"><Moon size={28} strokeWidth={1.5}/></span><div><h2>Режим сна</h2><p>Завтрашний день начинается сегодня.</p></div></div>
    <div className="quest-progress"><span>{count} из 3 выполнено</span><div aria-hidden="true">{[1,2,3].map(n => <i key={n} className={n <= count ? 'filled' : ''}/>)}</div></div>
    <form onSubmit={async event => { event.preventDefault(); if (await onSave({ bedtime, sleep_minutes: minutes, rested, on_time: onTime, unplugged, discipline }, today)) setDirty(false); }}>
      <div className="quest-checks">{checkboxes.map(({ value, set, title, text }) => <div className={`quest-check ${value ? 'checked' : ''}`} key={title}>
        <Checkbox checked={value} onChange={v => { set(v); setDirty(true); }} label={title}/><button type="button" className="check-label" onClick={() => { set(!value); setDirty(true); }}><strong>{title}</strong><span>{text}</span></button></div>)}</div>
      <div className="report-details"><label>Во сколько лёг<input type="time" required value={bedtime} onChange={e => { setBedtime(e.target.value); setDirty(true); }}/></label>
        <label>Сколько спал<select value={minutes} onChange={e => { setMinutes(Number(e.target.value)); setDirty(true); }}>
          {Array.from({ length: 97 }, (_, i) => i * 15).map(n => <option key={n} value={n}>{hoursLabel(n)}</option>)}</select></label></div>
      {mismatch && <p className="form-error">Сон вне твоей цели {targetMin / 60}–{targetMax / 60} ч. Проверь время или сними первую отметку.</p>}
      <div className="discipline-row"><div><span>Как твоя дисциплина?</span><small>Твоя честная оценка</small></div><div className="discipline-options" role="group" aria-label="Оценка дисциплины">{[1,2,3,4,5].map(n => <button type="button" key={n} className={discipline === n ? 'selected' : ''} aria-pressed={discipline === n} aria-label={`${n} из 5`} onClick={() => { setDiscipline(n); setDirty(true); }}>{n}</button>)}</div></div>
      <button className="button button-primary submit-quest" disabled={busy || mismatch || (!!report && !dirty)}>{busy ? 'Сохраняем…' : report && !dirty ? <><Check size={17}/> Отчёт сохранён</> : <>{report ? 'Обновить отчёт' : 'Сохранить мой день'}<ArrowRight size={17}/></>}</button>
      <p className="quest-footnote">{report ? 'Можно исправить до конца сегодняшнего дня.' : 'Маленькое действие. Настоящее изменение.'}</p>
    </form>
  </section>;
}

function WeekStrip({ reports, today }: { reports: Checkin[]; today: string }) {
  return <div className="week-strip">{Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6)).map(day => {
    const item = reports.find(r => r.day === day), done = item && complete(item), isToday = day === today;
    return <div key={day} className={`week-day ${done ? 'done' : ''} ${isToday ? 'is-today' : ''}`}>
      <span>{isToday ? 'Сегодня' : dayLabel(day, { weekday: 'short' })}</span><strong>{dayLabel(day, { day: 'numeric' })}</strong>
      <div className="day-symbol" aria-label={done ? 'Квест выполнен' : item ? 'Частично выполнен' : isToday ? 'Ждёт отметки' : 'Нет отчёта'}>{done ? <Check size={16}/> : item ? <span>{Number(item.rested) + Number(item.on_time) + Number(item.unplugged)}/3</span> : <span>—</span>}</div>
    </div>;
  })}</div>;
}

function FriendButton({ profile, data, busy, onFriend }: { profile: Profile; data: Snapshot; busy: boolean; onFriend: (id: string, action: 'request' | 'accept' | 'remove') => void }) {
  if (profile.id === data.me.id) return <span className="you-tag">Это ты</span>;
  const edge = data.friendships.find(f => [f.requester, f.recipient].includes(profile.id) && [f.requester, f.recipient].includes(data.me.id));
  if (!edge) return <button disabled={busy} className="button button-secondary button-small" onClick={() => onFriend(profile.id, 'request')}><UserRoundPlus size={15}/> Добавить</button>;
  if (edge.status === 'accepted') return <button disabled={busy} className="button button-secondary button-small" title="Удалить из друзей" onClick={() => onFriend(profile.id, 'remove')}><Check size={15}/> В друзьях</button>;
  if (edge.requester === data.me.id) return <button disabled={busy} className="button button-secondary button-small" onClick={() => onFriend(profile.id, 'remove')}>Отменить заявку</button>;
  return <div className="friend-actions"><button disabled={busy} className="button button-primary button-small" onClick={() => onFriend(profile.id, 'accept')}>Принять</button><button disabled={busy} className="icon-button" aria-label="Отклонить заявку" onClick={() => onFriend(profile.id, 'remove')}><X size={17}/></button></div>;
}

function Players({ data, ranking, clock, onProfile, onFriend, busy }: { data: Snapshot; ranking: boolean; clock: Date;
  onProfile: (p: Profile) => void; onFriend: (id: string, action: 'request' | 'accept' | 'remove') => void; busy: boolean }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'friends' | 'requests'>('all');
  const friends = friendIds(data.friendships, data.me.id);
  const requests = new Set(data.friendships.filter(f => f.recipient === data.me.id && f.status === 'pending').map(f => f.requester));
  const players = data.profiles.map(p => ({ profile: p, stats: stats(data.checkins.filter(c => c.user_id === p.id), localDay(p.timezone, clock)) }))
    .sort((a,b) => b.stats.week - a.stats.week || b.stats.current - a.stats.current || a.profile.nickname.localeCompare(b.profile.nickname));
  const visible = players.filter(({ profile: p }) => p.nickname.toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' || filter === 'friends' && (friends.has(p.id) || ranking && p.id === data.me.id) || filter === 'requests' && requests.has(p.id)));
  return <>
    <div className="page-heading"><div><div className="eyebrow">{ranking ? 'ПРОГРЕСС В ДЕЙСТВИИ' : 'В ОДНОМ РИТМЕ'}</div><h1>{ranking ? 'Каждый день считается.' : 'Сильнее вместе.'}</h1><p>{ranking ? 'Успешные дни за неделю. Последовательность важнее идеальности.' : 'Найди своих людей. Держите слово себе — рядом друг с другом.'}</p></div><span className="heading-icon">{ranking ? <Trophy size={32}/> : <UsersRound size={32}/>}</span></div>
    <div className="list-toolbar"><div className="segmented" role="group" aria-label="Фильтр игроков">
      <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Все игроки</button><button className={filter === 'friends' ? 'selected' : ''} onClick={() => setFilter('friends')}>Друзья</button>
      {!ranking && <button className={filter === 'requests' ? 'selected' : ''} onClick={() => setFilter('requests')}>Заявки {requests.size > 0 && <span>{requests.size}</span>}</button>}</div>
      <label className="search-field"><Search size={17}/><input aria-label="Поиск по нику" placeholder="Найти по нику…" value={search} onChange={e => setSearch(e.target.value)}/></label></div>
    {ranking ? <div className="leaderboard"><div className="leaderboard-head"><span>МЕСТО / ИГРОК</span><span>УСПЕШНЫХ ДНЕЙ</span><span>СЕРИЯ</span></div>
      {visible.map(({ profile: p, stats: s }, index) => <button key={p.id} className={`leaderboard-row ${p.id === data.me.id ? 'is-me' : ''}`} onClick={() => onProfile(p)}>
        <span className="rank-person"><span className="rank-number">{String(index + 1).padStart(2,'0')}</span><Avatar name={p.nickname}/><strong>{p.nickname}{p.id === data.me.id && <small>ты</small>}</strong></span>
        <span className="rank-week"><span className="mini-bars" aria-hidden="true">{[1,2,3,4,5,6,7].map(n => <i key={n} className={n <= s.week ? 'filled' : ''}/>)}</span><strong>{s.week}<small> / 7</small></strong></span>
        <span className="rank-streak"><Flame size={16}/>{s.current}<ChevronRight size={16}/></span></button>)}
      <div className="ranking-note"><ShieldCheck size={16}/> У каждого свой режим. В рейтинге важна регулярность, а не время отбоя.</div></div>
      : <div className="players-grid">{visible.map(({ profile: p, stats: s }) => {
        const report = data.checkins.filter(c => c.user_id === p.id).sort((a,b) => b.day.localeCompare(a.day))[0];
        return <article className="player-card" key={p.id}><div className="player-card-top"><button className="player-identity" onClick={() => onProfile(p)}><Avatar name={p.nickname}/><span><strong>{p.nickname}</strong><small>{friends.has(p.id) ? 'Твой друг' : 'Участник'}</small></span></button><span className="player-streak"><Flame size={15}/>{s.current}</span></div>
          <div className="player-regime"><span>Режим<strong>{p.bedtime.slice(0,5)}</strong></span><span>Цель сна<strong>{p.sleep_min / 60}–{p.sleep_max / 60} ч</strong></span><span>Дисциплина<strong>{report ? `${report.discipline}/5` : '—'}</strong></span></div>
          <div className="player-card-bottom"><button className="text-button" onClick={() => onProfile(p)}>Профиль <ArrowUpRight size={14}/></button><FriendButton profile={p} data={data} busy={busy} onFriend={onFriend}/></div></article>;
      })}</div>}
    {visible.length === 0 && <div className="empty-state"><UsersRound size={34}/><h2>{search ? 'Пока никого не нашли' : filter === 'requests' ? 'Новых заявок нет' : 'Здесь скоро будут твои люди'}</h2><p>{search ? 'Попробуй другой ник или убери фильтр.' : 'Найди участника во вкладке «Все игроки» или пригласи друга по ссылке на приложение.'}</p></div>}
  </>;
}

function ProfilePage({ profile, data, clock, onEdit, onFriend, busy }: { profile: Profile; data: Snapshot; clock: Date; onEdit: () => void;
  onFriend: (id: string, action: 'request' | 'accept' | 'remove') => void; busy: boolean }) {
  const today = localDay(profile.timezone, clock);
  const reports = data.checkins.filter(c => c.user_id === profile.id).sort((a,b) => b.day.localeCompare(a.day));
  const progress = stats(reports, today);
  return <><div className="profile-heading"><Avatar name={profile.nickname} large/><div><div className="eyebrow">{profile.id === data.me.id ? 'ТВОЙ ПУТЬ' : 'ПРОФИЛЬ УЧАСТНИКА'}</div><h1>{profile.nickname}</h1><p>В игре с {dayLabel(profile.created_at.slice(0,10))}</p></div>
    {profile.id === data.me.id ? <button className="button button-secondary" onClick={onEdit}><Settings2 size={16}/> Мой режим</button> : <FriendButton profile={profile} data={data} busy={busy} onFriend={onFriend}/>}</div>
    <div className="profile-stats">{[{ n: progress.current, text: 'дней подряд', icon: Flame }, { n: progress.best, text: 'личный рекорд', icon: Trophy }, { n: progress.total, text: 'успешных дней', icon: Target }].map(({n,text,icon:Icon}) => <div key={text}><Icon size={20}/><strong>{n}</strong><span>{text}</span></div>)}</div>
    <div className="profile-schedule"><Moon size={20}/><span>Отбой <strong>{profile.bedtime.slice(0,5)}</strong></span><span>Сон <strong>{profile.sleep_min / 60}–{profile.sleep_max / 60} ч</strong></span><span className="timezone-label"><Globe2 size={14}/>{profile.timezone}</span></div>
    <section className="week-section"><div className="section-heading"><h2>Последние семь дней</h2></div><WeekStrip reports={reports} today={today}/></section>
    <section><div className="section-heading"><h2>История дисциплины</h2><span>Честные отчёты</span></div><div className="history-list">
      {reports.slice(0,30).map(report => <div className="history-row" key={report.id}><div className={`history-status ${complete(report) ? 'done' : ''}`}>{complete(report) ? <Check size={18}/> : <Moon size={18}/>}</div><div><strong>{dayLabel(report.day)}</strong><span>{complete(report) ? 'Слово сдержано' : `${Number(report.rested) + Number(report.on_time) + Number(report.unplugged)} из 3 пунктов`}</span></div>
        <span className="history-time"><Clock3 size={14}/>{report.bedtime.slice(0,5)}</span><span className="history-duration">{hoursLabel(report.sleep_minutes)}</span><span className="history-discipline">{report.discipline}<small>/5</small></span></div>)}
      {reports.length === 0 && <div className="empty-state"><Moon size={30}/><h2>Всё начинается с первого дня</h2><p>Первый отчёт появится здесь после сохранения квеста.</p></div>}
    </div>{reports.length > 30 && <p className="muted history-note">Показаны последние 30 отчётов. Статистика учитывает всю историю.</p>}</section></>;
}

function ProfileForm({ profile, onSave, busy }: { profile?: Profile; onSave: (values: Omit<Profile, 'id' | 'created_at'>) => Promise<void>; busy: boolean }) {
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [bedtime, setBedtime] = useState(profile?.bedtime.slice(0,5) ?? '23:00');
  const [min, setMin] = useState((profile?.sleep_min ?? 480) / 60);
  const [max, setMax] = useState((profile?.sleep_max ?? 540) / 60);
  const [timezone, setTimezone] = useState(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const valid = min <= max && nickname.trim().length >= 3;
  return <form className="profile-form" onSubmit={e => { e.preventDefault(); if (valid) void onSave({ nickname: nickname.trim(), bedtime, sleep_min: Math.round(min * 60), sleep_max: Math.round(max * 60), timezone }); }}>
    <label>Твой ник<input required minLength={3} maxLength={24} pattern="[A-Za-zА-Яа-яЁё0-9_.-]+" title="3–24 символа: буквы, цифры, точка, дефис или подчёркивание" autoComplete="nickname" placeholder="Например, overman" value={nickname} onChange={e => setNickname(e.target.value)}/></label>
    <label>Плановое время отбоя<input required type="time" value={bedtime} onChange={e => setBedtime(e.target.value)}/></label>
    <div className="form-columns"><label>Цель сна, от (ч)<input required type="number" min={1} max={16} step={.25} value={min} onChange={e => setMin(Number(e.target.value))}/></label><label>До (ч)<input required type="number" min={1} max={16} step={.25} value={max} onChange={e => setMax(Number(e.target.value))}/></label></div>
    {min > max && <p className="form-error">Нижняя граница должна быть меньше верхней.</p>}
    <label>Часовой пояс<select value={timezone} onChange={e => setTimezone(e.target.value)}>{[...new Set([timezone, ...zones])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
    {!profile && <p className="privacy-note"><ShieldCheck size={17}/> Твой ник, режим и отчёты видны участникам. Email остаётся приватным.</p>}
    <button className="button button-primary" disabled={busy || !valid}>{busy ? 'Сохраняем…' : profile ? 'Сохранить режим' : 'Начать свой путь'}<ArrowRight size={16}/></button>
  </form>;
}

function AuthScreen({ user, error, loadFailed, busy, onProfile, onDemo, onRetry, onSignOut }: { user: User | null; error: string; loadFailed: boolean; busy: boolean;
  onProfile: (values: Omit<Profile, 'id' | 'created_at'>) => Promise<void>; onDemo: () => void; onRetry: () => void; onSignOut: () => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!legacyBackend || pending) return;
    setPending(true); setAuthError(''); setMessage('');
    try {
      const result = register ? await legacyBackend.auth.signUp({ email, password,
        options: { emailRedirectTo: window.location.origin } }) : await legacyBackend.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (register && !result.data.session) setMessage('Проверь почту: отправили ссылку для подтверждения. После подтверждения войди с паролем.');
    } catch (err) { setAuthError(readableError(err)); }
    finally { setPending(false); }
  }
  return <div className="auth-page"><GameAtmosphere/><div className="auth-story"><Brand/><div><div className="eyebrow">BECOME OVERMAN / ГЛАВА 01</div><h1>Большое<br/>начинается<br/>с базового<span>.</span></h1><p>Один квест. Твой режим сна.<br/>И люди, которые идут рядом.</p><div className="auth-steps"><span><Moon size={18}/> Высыпайся.</span><span><Clock3 size={18}/> Держи ритм.</span><span><ShieldCheck size={18}/> Держи слово.</span></div></div><span className="eyebrow">ТВОЯ НОВАЯ ВЕРСИЯ НАЧИНАЕТСЯ СЕГОДНЯ</span></div>
    <div className="auth-form-wrap"><div className="auth-form"><span className="auth-mark"><ArrowUpRight size={28}/></span><h2>{user ? 'Твой первый шаг.' : register ? 'Начни с себя.' : 'На своей стороне.'}</h2><p className="muted">{user ? 'Выбери ник и свой режим. Всё можно изменить позже.' : register ? 'Создай аккаунт, чтобы сохранять прогресс.' : 'Войди и продолжи свой путь.'}</p>
      {error && <div className="form-error" role="alert">{error}{user && <button className="text-button" onClick={onRetry}><RefreshCw size={14}/> Повторить загрузку</button>}</div>}
      {user ? <>{!loadFailed && <ProfileForm onSave={onProfile} busy={busy}/>}<button className="text-button auth-switch" onClick={onSignOut}>Выйти из аккаунта</button></> : <>
        <form className="profile-form" onSubmit={submit}><label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label>
          <label>Пароль<input type="password" required minLength={8} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Не менее 8 символов"/></label>
          {authError && <p className="form-error" role="alert">{authError}</p>}{message && <p className="success-message" role="status">{message}</p>}
          <button className="button button-primary" disabled={pending || !isConfigured}>{pending ? 'Подожди…' : register ? 'Создать аккаунт' : 'Войти'}<ArrowRight size={17}/></button>
        </form>
        {!isConfigured && <p className="setup-note">Онлайн-база пока не подключена. Сейчас можно посмотреть приложение в демо-режиме.</p>}
        <button className="text-button auth-switch" onClick={() => { setRegister(!register); setAuthError(''); setMessage(''); }}>{register ? 'Уже есть аккаунт? Войти' : 'Впервые здесь? Создать аккаунт'}</button>
        <div className="auth-divider"><span>или сначала посмотри</span></div><button className="button button-secondary demo-entry" onClick={onDemo}>Открыть демо <ArrowUpRight size={16}/></button>
      </>}
    </div></div>
  </div>;
}
