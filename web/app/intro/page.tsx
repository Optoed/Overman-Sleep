import type { Metadata } from 'next';
import { StandaloneIntro } from '@/components/intro/intro-gate';
export const metadata: Metadata = { title: 'Глава ноль — Become Overman', description: 'Проверка настойчивости. Попробуй добраться до первого квеста.' };
export default function IntroPage() { return <StandaloneIntro/>; }
