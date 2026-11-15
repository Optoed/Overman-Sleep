'use client';
import dynamic from 'next/dynamic';

// The personal diary depends on the browser's clock, timezone and local storage.
// A server-local initial day/theme cannot be hydrated safely in another zone.
const SleepTower=dynamic(()=>import('./sleep-app'),{
 ssr:false,
 loading:()=> <p role="status" style={{padding:'2rem'}}>Открываем дневник…</p>,
});
export default function SleepWebEntry(){return <SleepTower/>;}
