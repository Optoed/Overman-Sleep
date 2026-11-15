'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { introWasSeen, markIntroSeen } from '@/lib/intro';
import IntroExperience from './intro-experience';
const OvermanApp = dynamic(() => import('@/components/overman-app'), { loading: () => <div className="intro-boot"/> });

export default function IntroGate() {
  const [state, setState] = useState<'checking' | 'intro' | 'app'>('checking');
  useEffect(() => { setState(introWasSeen() ? 'app' : 'intro'); }, []);
  if (state === 'checking') return <div className="intro-boot" aria-label="Загрузка"/>;
  if (state === 'app') return <OvermanApp/>;
  return <IntroExperience onComplete={() => { markIntroSeen(); setState('app'); }}/>;
}

export function StandaloneIntro() {
  return <IntroExperience onComplete={() => { markIntroSeen(); window.location.assign('/app'); }}/>;
}
