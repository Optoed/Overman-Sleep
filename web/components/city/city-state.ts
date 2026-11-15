import { newGame, rewardHabit, validGame, type Game } from './city-game';
// Keep legacy data separate: cached v1 clients must not overwrite the v2 economy.
export const CITY_KEY = 'overman.city.v2';
export const CITY_LEGACY_KEY = 'overman.city.v1';
export const DISTRICTS = [
  { id: 'sport', name: 'Спорт', building: 'Спортзал', task: 'Дать телу движение', goal: 'Тренировка или 30 минут движения', color: '#cd8152', x: -8, z: 4 },
  { id: 'health', name: 'Здоровье', building: 'Больница', task: 'Позаботиться о себе', goal: 'Прогулка, питание или забота о здоровье', color: '#5f9b85', x: -8, z: -4 },
  { id: 'career', name: 'Карьера', building: 'Бизнес-центр', task: 'Поработать с фокусом', goal: '25 минут без отвлечений', color: '#628ca0', x: 0, z: -6 },
  { id: 'knowledge', name: 'Знания', building: 'Лаборатория', task: 'Узнать что-то новое', goal: '20 минут чтения или учёбы', color: '#b19b57', x: 8, z: -4 },
  { id: 'social', name: 'Знакомства', building: 'Ночной клуб', task: 'Быть ближе к людям', goal: 'Встреча, разговор или новое знакомство', color: '#a67baf', x: 8, z: 4 },
  { id: 'travel', name: 'Путешествия', building: 'Аэропорт', task: 'Открыть новое место', goal: 'Поездка или шаг к будущему путешествию', color: '#7d9fac', x: 6, z: -12 },
  { id: 'sleep', name: 'Сон', building: 'Жилой квартал', task: 'Выспаться по режиму', goal: 'Лечь вовремя и дать себе 8 часов', color: '#8c8bae', x: -2, z: 8 },
] as const;
export type DistrictId = typeof DISTRICTS[number]['id'];
export type District = { xp: number; damage: number; misses: number; done: boolean; schedule: number[]; goal: string };
export type Mood = 'sun' | 'mist' | 'rain';
export type Biome = 'coast' | 'autumn' | 'alpine';
export type CityEvent = { day: number; text: string; kind: 'build' | 'repair' | 'crisis' | 'journal' };
export type City = {
  version: 2; seed: number; name: string; day: number; biome: Biome; weather: Mood; game: Game;
  districts: Record<DistrictId, District>; events: CityEvent[];
  journal: { day: number; text: string; tomorrow: string; mood: Mood }[];
  decorations: string[]; timer: { deadline: number | null; remaining: number; day: number } | null;
};
export const levelOf = (d: District) => Math.min(5, Math.ceil(d.xp / 3));
export const isDue = (c: City, d: District) => d.schedule.includes((c.day - 1) % 7);
export function population(c: City) { return 3 + DISTRICTS.reduce((n, { id }) => n + Math.max(0, levelOf(c.districts[id]) * 6 - Math.floor(c.districts[id].damage / 12)), 0); }
export function condition(d: District) { return !d.xp ? 'Пустой участок' : d.damage >= 70 ? 'Бедствие' : d.damage >= 40 ? 'Аварии' : d.damage > 0 ? 'Нужен ремонт' : 'Развивается'; }
export function randomFrom(seed: number) { let n = seed >>> 0; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
export function newCity(seed = Math.floor(Math.random() * 1e8)): City {
  return { version: 2, game: newGame(), seed, name: 'Тихая гавань', day: 1, biome: 'coast', weather: 'sun',
    districts: Object.fromEntries(DISTRICTS.map(d => [d.id, { xp: 0, damage: 0, misses: 0, done: false, schedule: d.id === 'travel' ? [5] : d.id === 'sport' ? [0, 2, 4] : [0, 1, 2, 3, 4, 5, 6], goal: d.goal }])) as City['districts'],
    events: [{ day: 1, text: 'Три строителя прибыли в гавань. Здесь начинается твой город.', kind: 'build' }], journal: [], decorations: [], timer: null };
}
function log(c: City, text: string, kind: CityEvent['kind']): City { return { ...c, events: [{ day: c.day, text, kind }, ...c.events].slice(0, 80) }; }
export function completeDistrict(c: City, id: DistrictId): City {
  const d = c.districts[id]; if (d.done) return c;
  const next = { ...d, xp: Math.min(15, d.xp + 1), damage: Math.max(0, d.damage - 20), misses: 0, done: true };
  const district = DISTRICTS.find(v => v.id === id)!;
  return rewardHabit(c, log({ ...c, districts: { ...c.districts, [id]: next } }, d.damage ? `${district.building}: жители ремонтируют район. Ущерб −20.` : `${district.building}: ${!d.xp ? 'заложен первый фундамент' : levelOf(next) > levelOf(d) ? 'новая стадия строительства' : 'строительство продвинулось'}.`, d.damage ? 'repair' : 'build'), id);
}
export function finishDay(c: City): City {
  let next: City = { ...c, districts: { ...c.districts }, timer: null };
  for (const { id, building } of DISTRICTS) {
    const d = c.districts[id], missed = isDue(c, d) && !d.done;
    const misses = missed ? Math.min(99, d.misses + 1) : d.misses;
    const damage = missed && d.xp > 0 ? Math.min(100, d.damage + 10 + Math.min(20, misses * 5) - (c.game.upgrades.includes('rescue') ? 5 : 0)) : d.damage;
    next.districts[id] = { ...d, done: false, misses, damage };
    if (damage > d.damage) next = log(next, `${building}: пропущено действие. ${damage >= 70 ? 'В районе бедствие, жители эвакуируются.' : damage >= 40 ? 'Начались аварии. Строители ждут помощи.' : 'Работы замедлились, появились повреждения.'}`, 'crisis');
  }
  return log({ ...next, day: c.day + 1 }, 'Новый день в городе. Каждый маленький шаг имеет значение.', 'build');
}
export function demoCity(kind: 'growth' | 'crisis'): City {
  const c = newCity(42620); c.day = 24; c.name = 'Солнечный берег';
  c.game = { ...newGame(), energy: 120, coins: 160, actions: 18, bestDaily: 4, upgrades: ['park', 'festival'] };
  for (const [i, { id }] of DISTRICTS.entries()) c.districts[id] = { ...c.districts[id], xp: [8, 7, 13, 10, 6, 7, 11][i], done: i === 0 || i === 3 };
  if (kind === 'crisis') { c.districts.sleep.damage = 85; c.districts.sleep.misses = 4; c.districts.social.damage = 55; c.districts.social.misses = 3; c.districts.health.damage = 25; c.weather = 'mist'; }
  c.events = [{ day: 24, text: kind === 'crisis' ? 'Жилой квартал затоплен. Отметь сон, чтобы начать восстановление.' : 'У лаборатории появился купол. В город приехали новые жители.', kind: kind === 'crisis' ? 'crisis' : 'build' }];
  return c;
}
export function writeJournal(c: City, text: string, tomorrow: string, mood: Mood): City {
  const themes = [ /книг|чита|уч[её]|язык/i.test(text) && 'library', /прогул|сад|природ|семь/i.test(text) && 'garden', /путеше|мечт|космос|наук/i.test(text) && 'stars' ].filter(Boolean) as string[];
  return log({ ...c, weather: mood, decorations: [...new Set([...c.decorations, ...themes])], journal: [{ day: c.day, text: text.trim().slice(0, 2000), tomorrow: tomorrow.trim().slice(0, 1000), mood }, ...c.journal.filter(j => j.day !== c.day)].slice(0, 60) }, 'Дневник сохранён. Настроение стало погодой над городом.', 'journal');
}
export function settleTimer(c: City, now: number): City {
  return c.timer?.deadline && c.timer.deadline <= now ? completeDistrict({ ...c, timer: null }, 'career') : c;
}
export function parseCity(raw: string | null): City | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    const num = (v: unknown, max: number) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max;
    const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
    if (![1, 2].includes(c.version) || !num(c.seed, 4294967295) || !str(c.name, 40) || !num(c.day, 100000) || c.day < 1 || !['coast', 'autumn', 'alpine'].includes(c.biome) || !['sun', 'mist', 'rain'].includes(c.weather)) return null;
    for (const { id } of DISTRICTS) { const d = c.districts?.[id]; if (!d || !num(d.xp, 15) || !num(d.damage, 100) || !num(d.misses, 99) || typeof d.done !== 'boolean' || !str(d.goal, 160) || !Array.isArray(d.schedule) || d.schedule.length > 7 || !d.schedule.every((n: unknown) => num(n, 6))) return null; }
    if (!Array.isArray(c.events) || c.events.length > 80 || !c.events.every((e: CityEvent) => e && num(e.day, 100000) && str(e.text, 500) && ['build', 'repair', 'crisis', 'journal'].includes(e.kind))) return null;
    if (!Array.isArray(c.journal) || c.journal.length > 60 || !c.journal.every((j: City['journal'][number]) => j && num(j.day, 100000) && str(j.text, 2000) && str(j.tomorrow, 1000) && ['sun', 'mist', 'rain'].includes(j.mood))) return null;
    if (!Array.isArray(c.decorations) || c.decorations.length > 3 || !c.decorations.every((x: string) => ['library', 'garden', 'stars'].includes(x))) return null;
    if (c.timer !== null && (!c.timer || !num(c.timer.remaining, 1500000) || !num(c.timer.day, 100000) || c.timer.day !== c.day || (c.timer.deadline !== null && !num(c.timer.deadline, 9999999999999)))) return null;
    if (c.version === 1) { c.version = 2; c.game = newGame(); }
    if (!validGame(c.game)) return null;
    return c as City;
  } catch { return null; }
}
