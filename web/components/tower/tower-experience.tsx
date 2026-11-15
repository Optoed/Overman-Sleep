'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { BedDouble, Check, ChevronRight, Compass, Crown, Flame, Layers3, Pause, Play, RotateCcw, Shield, ShieldHalf, Sparkles, Target, Users, X } from 'lucide-react';
import styles from './tower.module.css';

type World = 'growth' | 'fragile';
type Panel = 'focus' | 'path' | 'friends' | 'profile' | 'strength' | null;
const artwork = '/tower/tower-concept.png';

function TowerIcon({ className }: { className?: string }) {
  return <svg className={className} width="30" height="36" viewBox="0 0 30 36" fill="currentColor" aria-hidden="true"><path d="M5 2h5v5h3V2h4v5h3V2h5l-2 12 3 20H4l3-20L5 2Zm8 18v9h4v-9a2 2 0 0 0-4 0Z"/><path d="M12 11h6v5h-6z" fill="#111617"/></svg>;
}

function TowerScreen({ world }: { world: World }) {
  const fragile = world === 'fragile';
  const [panel, setPanel] = useState<Panel>(null);
  const [sleepDone, setSleepDone] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [seconds, setSeconds] = useState(fragile ? 600 : 1500);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const strength = completed ? (fragile ? 58 : 94) : (fragile ? 42 : sleepDone ? 86 : 78);
  const floors = completed && !fragile ? 13 : 12;

  function finish() {
    setRunning(false); setDeadline(null); setSeconds(0); setCompleted(true); setPanel(null);
    setNotice(fragile ? 'Опора восстановлена. Ты снова строишь.' : 'Новый этаж. Твой город стал чуть больше.');
  }

  useEffect(() => {
    if (!running || deadline === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) {
        setRunning(false); setDeadline(null); setCompleted(true); setPanel(null);
        setNotice(fragile ? 'Опора восстановлена. Ты снова строишь.' : 'Новый этаж. Твой город стал чуть больше.');
      }
    };
    tick(); const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [running, deadline, fragile]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function startFocus() {
    if (completed) { setPanel('path'); return; }
    setPanel('focus');
    if (!running) { setDeadline(Date.now() + seconds * 1000); setRunning(true); }
  }
  function toggleTimer() {
    if (running) { setRunning(false); setDeadline(null); }
    else { setDeadline(Date.now() + seconds * 1000); setRunning(true); }
  }
  function reset() {
    setCompleted(false); setSleepDone(true); setRunning(false); setDeadline(null);
    setSeconds(fragile ? 600 : 1500); setPanel(null); setNotice('Прототип возвращён в исходное состояние');
  }
  const titles: Record<Exclude<Panel, null>, string> = { focus: 'Время для себя', path: 'Твой путь', friends: 'Рядом с тобой', profile: 'Хранитель башни', strength: 'Опора твоего мира' };

  return <article className={`${styles.screen} ${fragile ? styles.fragile : ''} ${completed ? styles.restored : ''}`} aria-label={fragile ? 'Башня после пропусков' : 'Растущая башня'}>
    <header className={styles.header}>
      <span className={styles.brand}>BECOME OVERMAN</span>
      <button className={styles.profile} onClick={() => setPanel('profile')} aria-label="Открыть профиль">
        <span className={styles.avatar} /><span>Ур. 7</span>
      </button>
      <h1>Твоя башня</h1>
      <p className={styles.subtitle}>{completed ? 'ТЫ СНОВА СТРОИШЬ' : fragile ? 'БАШНЯ ШАТАЕТСЯ' : '12 ДНЕЙ РОСТА'}</p>
    </header>

    <div className={styles.scene} role="img" aria-label={fragile ? 'Каменная башня накренилась, некоторые камни обвалились. Жители укрепляют её основание.' : 'Живая каменная башня с тёплыми окнами, садами и маленькими домами у воды.'}>
      {/* Keep the approved artwork intact; frame only its illustration region. */}
      <img className={styles.sceneImage} src={artwork} alt="" draggable={false} fetchPriority="high" />
      <div className={styles.mist} />
      <div className={styles.particles} aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div>
      {completed && <div className={styles.reward}><Sparkles size={16} />{fragile ? '+1 опора' : '+1 этаж'}</div>}
    </div>

    <div className={styles.controls}>
      <button className={styles.stats} onClick={() => setPanel('strength')} aria-label={`Прочность ${strength} процентов. Подробнее`}>
        <span><Layers3 className={styles.layers} /><span>{floors} этажей</span></span>
        <i />
        <span>{fragile ? <ShieldHalf /> : <Shield fill="currentColor" />}<span>Прочность <b>{strength}%</b></span></span>
        <ChevronRight className={styles.chevron} />
      </button>

      {fragile ? <section className={styles.recovery}>
        <div className={styles.recoveryCopy} aria-live="polite"><p>{completed ? 'Опора восстановлена.' : 'Два дня без опоры.'}</p><p>{completed ? 'Сегодня ты сделал важный шаг.' : 'Один шаг начнёт восстановление.'}</p></div>
        <button className={styles.primary} onClick={startFocus}>{completed ? 'Посмотреть свой путь' : running ? 'Вернуться к фокусу' : 'Укрепить башню'}</button>
        <p className={styles.caption}>{completed ? '10 минут для себя. Шаг для города.' : 'Фокус · 10 минут'}</p>
      </section> : <section className={styles.today}>
        <div className={styles.sectionHeading}><h2>СЕГОДНЯ</h2><button onClick={() => setPanel('path')} aria-label="Посмотреть сегодняшние действия">{Number(sleepDone) + Number(completed)} из 2 <ChevronRight size={16} /></button></div>
        <button className={styles.habit} onClick={() => setSleepDone(!sleepDone)} aria-pressed={sleepDone}>
          <BedDouble /><span><strong>Сон по режиму</strong><small>7–8 часов</small></span>
          <span className={`${styles.round} ${sleepDone ? styles.checked : ''}`}>{sleepDone && <Check />}</span>
        </button>
        <button className={styles.habit} onClick={startFocus}>
          <Target /><span><strong>Фокус · 25 минут</strong><small>{completed ? 'Сессия завершена' : running ? 'Сессия идёт · вернуться' : 'Глубокая работа'}</small></span>
          <span className={`${styles.round} ${completed ? styles.checked : ''}`}>{completed ? <Check /> : <Play fill="currentColor" />}</span>
        </button>
        <button className={styles.primary} onClick={startFocus}>{completed ? 'Этаж построен' : running ? 'Вернуться к фокусу' : 'Начать фокус'}</button>
        <p className={styles.caption}><TowerIcon />{completed ? 'Завтра начнётся новая история' : 'Следующий этаж — после сессии'}</p>
      </section>}

      <nav className={styles.nav} aria-label="Навигация приложения">
        <button className={styles.active} onClick={() => setPanel(null)} aria-current="page"><TowerIcon /><span>Башня</span></button>
        <button onClick={() => setPanel('path')}><Compass /><span>Путь</span></button>
        <button onClick={() => setPanel('friends')}><Users fill="currentColor" /><span>Друзья</span></button>
      </nav>
    </div>
    {notice && <div className={styles.toast} role="status"><Sparkles size={18} />{notice}</div>}

    <Dialog.Root open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}>
      <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.dialog}>
        <Dialog.Close className={styles.close} aria-label="Закрыть"><X size={22} /></Dialog.Close>
        <div className={styles.dialogEmblem}>{panel === 'friends' ? <Users /> : panel === 'focus' ? <Flame /> : <TowerIcon />}</div>
        <Dialog.Title className={styles.dialogTitle}>{panel ? titles[panel] : ''}</Dialog.Title>
        <Dialog.Description className={styles.dialogDescription}>{panel === 'focus' ? 'Одно дело. Никакой спешки. Башня подождёт.' : panel === 'friends' ? 'Маленький круг людей, которым не всё равно.' : panel === 'path' ? 'Каждый небольшой шаг становится частью твоего города.' : panel === 'strength' ? 'Регулярность укрепляет башню. Возвращение начинается с одного шага.' : 'Это твой мир. Строй его в своём ритме.'}</Dialog.Description>
        {panel === 'focus' && <>
          <div className={styles.timer} role="timer" aria-label="Оставшееся время">{String(Math.floor(seconds / 60)).padStart(2, '0')}<span>:</span>{String(seconds % 60).padStart(2, '0')}</div>
          <p className={styles.timerLabel}>{running ? 'КАМЕНЬ ЗА КАМНЕМ' : 'МОЖНО ПЕРЕВЕСТИ ДУХ'}</p>
          <button className={styles.dialogButton} onClick={toggleTimer}>{running ? <Pause size={18} /> : <Play size={18} />}{running ? 'Пауза' : 'Продолжить'}</button>
          <button className={styles.demoFinish} onClick={finish}><Sparkles size={15} />Завершить демо-сессию</button>
          <p className={styles.finePrint}>Демонстрация: можно сразу увидеть награду.</p>
        </>}
        {panel === 'path' && <>
          <div className={styles.week}>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, i) => <div key={day}><span>{day}</span><span className={i < (fragile ? 4 : 6) ? styles.dayDone : styles.dayEmpty}>{i < (fragile ? 4 : 6) ? <Check size={16} /> : '·'}</span></div>)}</div>
          <div className={styles.milestone}><TowerIcon /><div><strong>{floors} этажей построено</strong><p>{completed ? 'Сегодня башня стала сильнее.' : 'Следующая глава начинается сегодня.'}</p></div></div>
          <p className={styles.finePrint}>Пример истории для визуального прототипа.</p>
        </>}
        {panel === 'friends' && <div className={styles.emptyFriends}><Users size={44} strokeWidth={1} /><p>Здесь появятся башни твоих друзей</p><small>В этой версии мы исследуем внешний вид. Приглашения и общие города появятся после подключения аккаунтов.</small></div>}
        {panel === 'strength' && <><div className={styles.strengthNumber}>{strength}<small>%</small></div><div className={styles.strengthBar}><i style={{ width: `${strength}%` }} /></div><p className={styles.strengthText}>{fragile && !completed ? 'Башня покачнулась, но твои достижения остались. Короткая сессия фокуса восстановит первую опору.' : 'Крепкое основание — результат маленьких действий. Продолжай в удобном для себя темпе.'}</p></>}
        {panel === 'profile' && <><div className={styles.milestone}><Crown /><div><strong>Хранитель · уровень 7</strong><p>Демонстрационный профиль</p></div></div><button className={styles.reset} onClick={reset}><RotateCcw size={17} />Начать демонстрацию заново</button><p className={styles.finePrint}>Только фронтенд. Изменения действуют до обновления страницы.</p></>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </article>;
}

export default function TowerExperience() {
  const [view, setView] = useState<'both' | World>('both');
  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) setView('growth');
  }, []);
  return <div className={styles.experience}>
    <div className={`${styles.gallery} ${view === 'both' ? styles.both : styles.single}`} data-view={view}>
      <div className={styles.growthSlot}><TowerScreen world="growth" /></div>
      <div className={styles.fragileSlot}><TowerScreen world="fragile" /></div>
    </div>
    <aside className={styles.previewBar} aria-label="Состояния визуального прототипа"><span>ПРОТОТИП</span><div>{([{ key: 'growth', text: 'Рост' }, { key: 'fragile', text: 'После пропусков' }, { key: 'both', text: 'Сравнить' }] as const).map(item => <button key={item.key} aria-pressed={view === item.key} onClick={() => setView(item.key)}>{item.text}</button>)}</div></aside>
  </div>;
}
