import type { Metadata } from 'next';
import CityExperience from '@/components/city/city-experience';
export const metadata: Metadata = { title: 'Overman — Твой живой город', description: 'Маленькие шаги. Живой мир. Город, который растёт вместе с твоими привычками.' };
export default function CityPage() { return <CityExperience />; }
