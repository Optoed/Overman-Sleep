'use client';

import { useEffect, useState } from 'react';
import type { IntroAudio } from './intro/intro-audio';

export default function GameDialogue({ text, audio }: { text: string; audio: IntroAudio }) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setLength(text.length); return; }
    let cursor = 0;
    setLength(0);
    const timer = setInterval(() => {
      cursor++; setLength(cursor);
      if (text[cursor - 1]?.trim()) audio.blip(text.charCodeAt(cursor - 1));
      if (cursor >= text.length) clearInterval(timer);
    }, 28);
    return () => clearInterval(timer);
  }, [text, audio]);
  return <div className="game-dialogue"><span className="game-dialogue-star" aria-hidden="true">✳</span>
    <p><span className="sr-only">{text}</span><span aria-hidden="true">{text.slice(0,length)}<i className="game-caret">▌</i></span></p>
    <span className="game-dialogue-id" aria-hidden="true">SYS / 01</span></div>;
}
