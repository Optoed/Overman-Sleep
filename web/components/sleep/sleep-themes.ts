import type { CSSProperties } from 'react';
import type { SleepState } from './sleep-state';
export const APPEARANCES = [
 {
  "id": "journal",
  "name": "Тихий журнал",
  "description": "Тушь и книжная типографика",
  "mode": "night",
  "bg": "#141311",
  "surface": "#211e1a",
  "surface2": "#302a23",
  "text": "#f5ecdb",
  "muted": "#c1af96",
  "accent": "#e4b984",
  "onAccent": "#251a10",
  "warm": "#e0b78c",
  "line": "#c1af9644"
 },
 {
  "id": "sunset",
  "name": "После заката",
  "description": "Тёмная слива и коралл",
  "mode": "night",
  "bg": "#1e101b",
  "surface": "#301b29",
  "surface2": "#452535",
  "text": "#fff1eb",
  "muted": "#d4b4c0",
  "accent": "#ff9d8f",
  "onAccent": "#30131e",
  "warm": "#f4bd78",
  "line": "#fff1eb33"
 },
 {
  "id": "morning",
  "name": "Доброе утро",
  "description": "Чёрный, жёлтый, крупные блоки",
  "mode": "night",
  "bg": "#11120e",
  "surface": "#1e2018",
  "surface2": "#2c2e21",
  "text": "#fffbdc",
  "muted": "#bfc2a3",
  "accent": "#f4e44a",
  "onAccent": "#171806",
  "warm": "#f3bb6c",
  "line": "#e2dc7f66"
 },
 {
  "id": "clay",
  "name": "Тёплый вечер",
  "description": "Тёмная керамика и медь",
  "mode": "night",
  "bg": "#1d1411",
  "surface": "#30221b",
  "surface2": "#433025",
  "text": "#f9e5d5",
  "muted": "#d4b5a0",
  "accent": "#eda67c",
  "onAccent": "#32190d",
  "warm": "#edbc87",
  "line": "#d4b5a044"
 },
 {
  "id": "lunar",
  "name": "Лунный свет",
  "description": "Ночной фиолетовый и свечение",
  "mode": "night",
  "bg": "#11101e",
  "surface": "#201b32",
  "surface2": "#302743",
  "text": "#f2edff",
  "muted": "#bfb1d9",
  "accent": "#c0a2ff",
  "onAccent": "#24133f",
  "warm": "#e9b8db",
  "line": "#bfb1d944"
 },
 {
  "id": "swiss",
  "name": "Чёткий ритм",
  "description": "Графит, белый, красный",
  "mode": "night",
  "bg": "#101010",
  "surface": "#1b1b1b",
  "surface2": "#2a2a2a",
  "text": "#f6f6f6",
  "muted": "#b8b8b8",
  "accent": "#ff9282",
  "onAccent": "#32100b",
  "warm": "#edbb8e",
  "line": "#b8b8b866"
 },
 {
  "id": "night",
  "name": "Прежняя тёмная",
  "description": "Графит и мята",
  "mode": "night",
  "bg": "#10191b",
  "surface": "#192426",
  "surface2": "#223133",
  "text": "#edf4f1",
  "muted": "#a1b4b3",
  "accent": "#9bddbd",
  "onAccent": "#102d22",
  "warm": "#ecc58a",
  "line": "#edf4f133"
 },
 {
  "id": "light",
  "name": "Прежняя светлая",
  "description": "Светлая и спокойная",
  "mode": "light",
  "bg": "#f2f5f1",
  "surface": "#ffffff",
  "surface2": "#e6eee8",
  "text": "#19322c",
  "muted": "#526b63",
  "accent": "#20644e",
  "onAccent": "#ffffff",
  "warm": "#9b6c40",
  "line": "#19322c33"
 }
] as const;
export type AppearanceId = typeof APPEARANCES[number]['id'];
export function isAppearance(value:unknown):value is AppearanceId {return typeof value==='string'&&APPEARANCES.some(t=>t.id===value);}
export function appearanceOf(state:Pick<SleepState,'appearance'|'theme'>){return APPEARANCES.find(t=>t.id===state.appearance)??APPEARANCES.find(t=>t.id===(state.theme??'night'))!;}
/** Only presentation changes; keep the diary, active night, alarm and sync metadata. */
export function withAppearance(state:SleepState,id:AppearanceId):SleepState {const t=APPEARANCES.find(t=>t.id===id);if(!t)throw Error('Неизвестная тема.');return {...state,appearance:t.id,theme:t.mode};}
export function appearanceStyle(t:{bg:string;surface:string;surface2:string;text:string;muted:string;accent:string;onAccent:string;warm:string;line:string;mode:string}):CSSProperties {return {'--bg':t.bg,'--surface':t.surface,'--surface2':t.surface2,'--text':t.text,'--muted':t.muted,'--accent':t.accent,'--on-accent':t.onAccent,'--warm':t.warm,'--line':t.line,colorScheme:t.mode==='night'?'dark':'light'} as CSSProperties;}
