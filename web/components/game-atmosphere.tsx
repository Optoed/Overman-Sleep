'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
const WireWorld = dynamic(() => import('./intro/wire-world'), { ssr: false });

export default function GameAtmosphere() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference?.matches ?? false);
    update(); preference?.addEventListener('change', update);
    return () => preference?.removeEventListener('change', update);
  }, []);
  return <div className="game-atmosphere" aria-hidden="true"><WireWorld active reduced={reduced}/></div>;
}
