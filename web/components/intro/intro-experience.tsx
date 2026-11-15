'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUpRight, Volume2, VolumeX } from 'lucide-react';
import { escapePosition, loadingProgress, LOAD_DURATION, STALL_DURATION, MAX_ESCAPES, type Point } from '@/lib/intro';
import { IntroAudio } from './intro-audio';
import '@fontsource/press-start-2p/400.css';
import './intro.css';

const WireWorld = dynamic(() => import('./wire-world'), { ssr: false });
type Phase = 'loading' | 'stalled' | 'chase' | 'ready';
const remarks = [
  'Остался один процент.\nНажми «продолжить». Всё просто.',
  'Ой.\nКажется, у кнопки свои планы.',
  'Чуть-чуть левее.\nНет. Теперь уже правее.',
  'Ты правда думал,\nчто будет так просто?',
  'Упорство обнаружено.\nПроверяем, не случайность ли это.',
  'Ладно, ладно.\nПоследний раз. Почти честно.',
];

function TypedText({ text, audio, reduced }: { text: string; audio: IntroAudio | null; reduced: boolean }) {
  const [count, setCount] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) { setCount(text.length); return; }
    setCount(0);
    let index = 0;
    const interval = setInterval(() => {
      index++;
      setCount(index);
      if (text[index - 1]?.trim()) audio?.blip(text.charCodeAt(index - 1));
      if (index >= text.length) clearInterval(interval);
    }, 43);
    return () => clearInterval(interval);
  }, [text, audio, reduced]);
  return <><span className="intro-sr-only" role="status">{text}</span><span aria-hidden="true">{text.slice(0, count)}<span className="intro-caret">▌</span></span></>;
}

export default function IntroExperience({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState(0);
  const [escapes, setEscapes] = useState(0);
  const [position, setPosition] = useState<Point | null>(null);
  const [sound, setSound] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [audio] = useState(() => new IntroAudio());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lastEscape = useRef(-Infinity);
  const escapeCount = useRef(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeRef = useRef(false);
  const deliberatelyMuted = useRef(false);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    setReduced(media?.matches ?? false);
    const onChange = () => setReduced(media?.matches ?? false);
    media?.addEventListener('change', onChange);
    const oldColor = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    const theme = document.querySelector('meta[name="theme-color"]');
    theme?.setAttribute('content', '#050505');
    return () => {
      media?.removeEventListener('change', onChange);
      if (oldColor) theme?.setAttribute('content', oldColor);
      audio.dispose();
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [audio]);

  useEffect(() => {
    const started = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - started;
      setProgress(loadingProgress(elapsed));
      if (elapsed >= LOAD_DURATION + STALL_DURATION) { setPhase('chase'); clearInterval(interval); }
      else if (elapsed >= LOAD_DURATION) setPhase('stalled');
    }, 60);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // A resize/orientation change must never strand the button outside the screen.
    const onResize = () => setPosition(null);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const finish = useCallback(() => {
    if (completeRef.current) return;
    completeRef.current = true;
    setExiting(true);
    audio.mute();
    exitTimer.current = setTimeout(onComplete, reduced ? 0 : 450);
  }, [audio, onComplete, reduced]);

  const unlockAudio = async () => {
    if (sound || deliberatelyMuted.current) return;
    const enabled = await audio.enable();
    setSound(enabled); setAudioError(!enabled);
  };
  const evade = (pointer: Point) => {
    if (phase !== 'chase' || reduced || Date.now() - lastEscape.current < 280) return;
    lastEscape.current = Date.now();
    escapeCount.current++;
    audio.blip(0, true);
    if (escapeCount.current >= MAX_ESCAPES) {
      setEscapes(MAX_ESCAPES); setPhase('ready'); setProgress(100); setPosition(null); return;
    }
    const box = buttonRef.current?.getBoundingClientRect();
    setPosition(escapePosition({ width: window.innerWidth, height: window.innerHeight },
      { width: box?.width || 260, height: box?.height || 62 }, pointer, position ?? undefined));
    setEscapes(escapeCount.current);
  };
  const message = phase === 'loading'
    ? progress < 35 ? 'Собираем новую версию тебя.\nСтарую пока не удаляем.'
      : progress < 75 ? 'Отключаем бесконечный скролл.\nЭто может быть болезненно.' : 'Ищем силу воли.\nГде-то же она была.'
    : phase === 'stalled' ? '99%.\nОставшийся процент — на твоей совести.'
      : phase === 'ready' ? 'Ладно. Ты не сдаёшься.\nЭто хорошее начало.' : remarks[Math.min(escapes, remarks.length - 1)];
  const interactive = phase === 'chase' || phase === 'ready';

  return <div className={`intro-root intro-phase-${phase} ${exiting ? 'intro-exiting' : ''} ${reduced ? 'intro-reduced' : ''}`}>
    <WireWorld active={interactive} reduced={reduced}/>
    <div className="intro-vignette" aria-hidden="true"/>
    <div className="intro-scanlines" aria-hidden="true"/>
    <header className="intro-header">
      <a className="intro-wordmark" href="/intro" aria-label="Повторить вступление">BECOME<span>OVERMAN<span className="intro-mark-dot">®</span></span></a>
      <div className="intro-controls"><button className="intro-sound" aria-label={sound ? 'Выключить звук' : 'Включить звук'} aria-pressed={sound}
        onClick={() => { if (sound) { deliberatelyMuted.current = true; audio.mute(); setSound(false); } else { deliberatelyMuted.current = false; void unlockAudio(); } }}>
        {sound ? <Volume2 size={15}/> : <VolumeX size={15}/>}<span>ЗВУК {sound ? 'ON' : 'OFF'}</span></button>
        <button className="intro-skip" onClick={finish}>Пропустить <ArrowUpRight size={15}/></button></div>
    </header>

    <section className="intro-stage" aria-label="Интерактивное вступление">
      <div className="intro-chapter"><span className="intro-square"/> ГЛАВА НОЛЬ <span className="intro-chapter-line"/> ПРОВЕРКА НАСТОЙЧИВОСТИ</div>
      <h1 className="intro-heading">{phase === 'ready' ? <>ТЫ ВСЁ ЕЩЁ<br/><span>ЗДЕСЬ.</span></> : interactive ? <>ПОЙМАЙ<br/><span>СВОЙ ШАНС.</span></> : <>ЗАГРУЗКА<br/><span>ТВОЕЙ ВОЛИ.</span></>}</h1>
      <div className="intro-loader">
        <div className="intro-loader-meta"><span>{phase === 'ready' ? 'ПРОВЕРКА ПРОЙДЕНА' : phase === 'stalled' || phase === 'chase' ? 'ОЖИДАНИЕ ЧЕЛОВЕЧЕСКОГО ФАКТОРА' : 'ИНИЦИАЛИЗАЦИЯ ХАРАКТЕРА'}</span><span className="intro-percent">{String(progress).padStart(2, '0')}<small>%</small></span></div>
        <div className="intro-progress" role="progressbar" aria-label="Загрузка вступления" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="intro-progress-fill" style={{ width: `${progress}%` }}><span/></div>
        </div>
        <div className="intro-loader-foot"><span>{phase === 'stalled' ? <><i className="intro-spinner"/> ЕЩЁ СЕКУНДУ. НАВЕРНОЕ.</> : phase === 'chase' ? `ПОПЫТОК: ${String(escapes).padStart(2,'0')}` : phase === 'ready' ? 'УПОРСТВО ПОДТВЕРЖДЕНО' : 'НЕ ЗАКРЫВАЙ. ТЫ ЖЕ ТОЛЬКО НАЧАЛ.'}</span><span>SYS. 001</span></div>
      </div>

      <div className="intro-dialogue"><span className="intro-asterisk" aria-hidden="true">✳</span><p><TypedText text={message} audio={audio} reduced={reduced}/></p><span className="intro-dialogue-corner" aria-hidden="true">⌟</span></div>
      <div className="intro-action-slot">
        {interactive ? <button ref={buttonRef} className={`intro-runaway ${position ? 'intro-runaway-floating' : ''} ${phase === 'ready' ? 'intro-enter' : ''}`}
          style={position ? { left: position.x, top: position.y } : undefined}
          onPointerEnter={event => { if (event.pointerType === 'mouse') evade({ x: event.clientX, y: event.clientY }); }}
          onPointerDown={event => {
            void unlockAudio();
            if (phase === 'chase' && !reduced) { event.preventDefault(); evade({ x: event.clientX, y: event.clientY }); }
          }}
          onClick={event => {
            if (phase === 'ready' || reduced) finish();
            else if (event.detail === 0) { setPhase('ready'); setProgress(100); setPosition(null); }
            else evade({ x: event.clientX, y: event.clientY });
          }}>
          <span>{phase === 'ready' ? 'ВОЙТИ В ИГРУ' : escapes === 0 ? 'ПРОДОЛЖИТЬ' : escapes === 4 ? 'НУ ПОПРОБУЙ' : 'Я ЗДЕСЬ'}</span><ArrowUpRight size={20}/>
        </button> : <div className="intro-waiting" aria-hidden="true">{phase === 'stalled' ? '…' : 'ПОДОЖДИ НЕМНОГО'}</div>}
      </div>
      <p className="intro-action-hint">{phase === 'ready' ? 'Первый квест ждёт. Теперь всё по-настоящему.' : phase === 'chase' ? 'Нажми на кнопку. Если получится.' : 'Хорошие вещи требуют терпения. Эта — тоже.'}</p>
    </section>

    <footer className="intro-footer"><span>НЕ ЕЩЁ ОДИН ТРЕКЕР ПРИВЫЧЕК.</span><span className="intro-audio-hint">{audioError ? 'Звук недоступен в этом браузере' : sound ? 'СЛЫШИШЬ? ЭТО НАЧАЛО.' : 'ДЛЯ ПОЛНОГО ЭФФЕКТА ВКЛЮЧИ ЗВУК ↗'}</span><span>EST. 2026 <span className="intro-footer-star">✳</span></span></footer>
  </div>;
}
