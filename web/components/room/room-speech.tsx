'use client';
import { useEffect, useMemo, useState } from 'react';
import { speechPages } from './conversation';
import { RESIDENTS, type Resident } from './room-state';
import styles from './room.module.css';
export type Speech = { resident: Resident; text: string; mode: string; busy: boolean };
export default function RoomSpeech({ speech }: { speech: Speech }) {
  const pages = useMemo(() => speechPages(speech.text), [speech.text]);
  const [page, setPage] = useState(0), [letters, setLetters] = useState(0);
  useEffect(() => { setPage(0); setLetters(0); }, [speech.text, speech.resident]);
  const text = pages[Math.min(page, pages.length - 1)];
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setLetters(text.length); return; }
    setLetters(0); const timer = window.setInterval(() => setLetters(n => { if (n >= text.length) { clearInterval(timer); return n; } return n + 2; }), 28);
    return () => clearInterval(timer);
  }, [text]);
  const complete = letters >= text.length;
  return <div className={styles.speechBubble} data-speech-resident={speech.resident} data-speaking={!speech.busy && !complete}>
    <div className={styles.speechWho}><span style={{ background: RESIDENTS[speech.resident].color }}/><strong>{RESIDENTS[speech.resident].name}</strong><small>{speech.mode}</small></div>
    {speech.busy ? <p className={styles.thinking} role="status">Собирает мысли<span>…</span></p> : <><p aria-hidden="true">{text.slice(0, letters)}{!complete && <span className={styles.caret}>▏</span>}</p><p className={styles.srOnly} aria-live="polite">{text}</p><div className={styles.speechActions}>{!complete ? <button onClick={() => setLetters(text.length)}>Показать целиком</button> : page < pages.length - 1 ? <button onClick={() => setPage(p => p + 1)}>Дальше →</button> : <span>Твоя очередь</span>}{pages.length > 1 && <span>{page + 1} / {pages.length}</span>}</div></>}
  </div>;
}
