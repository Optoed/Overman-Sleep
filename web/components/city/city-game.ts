import { DISTRICTS, type City, type DistrictId } from './city-state';

export type UpgradeId = 'park' | 'rescue' | 'workshop' | 'festival';
export type Job = { district: DistrictId; start: number; end: number };
export type Game = {
  energy: number; coins: number; lastActive: number; lastHarvest: number;
  jobs: Job[]; upgrades: UpgradeId[]; claimed: string[];
  actions: number; builds: number; repairs: number; bestDaily: number;
};
export const ENERGY_COST = 20;
export const ENERGY_CAP = 500;
export const UPGRADES: { id: UpgradeId; name: string; icon: string; cost: number; description: string }[] = [
  { id: 'park', name: 'Парк радости', icon: '🌳', cost: 60, description: '+5 монет за каждую привычку. На острове появится цветущий парк.' },
  { id: 'rescue', name: 'Спасательная станция', icon: '🚒', cost: 90, description: 'Ущерб от пропусков меньше на 5. Город получит пожарную команду.' },
  { id: 'workshop', name: 'Мастерская', icon: '🔨', cost: 100, description: 'Новые заказы на энергии строятся за 15 секунд вместо 30.' },
  { id: 'festival', name: 'Небесный фестиваль', icon: '🎈', cost: 140, description: 'Большой воздушный шар и праздничные флажки над городом.' },
];
export function newGame(): Game { return { energy: 40, coins: 30, lastActive: 0, lastHarvest: 0, jobs: [], upgrades: [], claimed: [], actions: 0, builds: 0, repairs: 0, bestDaily: 0 }; }
function event(c: City, text: string, kind: 'build' | 'repair' = 'build'): City { return { ...c, events: [{ day: c.day, text, kind }, ...c.events].slice(0, 80) }; }
export function rewardHabit(before: City, after: City, id: DistrictId): City {
  const daily = DISTRICTS.filter(d => after.districts[d.id].done).length;
  const previousDaily = DISTRICTS.filter(d => before.districts[d.id].done).length;
  return { ...after, game: { ...after.game, coins: Math.min(999999, after.game.coins + 15 + (after.game.upgrades.includes('park') ? 5 : 0) + (daily >= 3 && previousDaily < 3 ? 10 : 0)), actions: Math.min(999999, after.game.actions + 1), bestDaily: Math.max(after.game.bestDaily, daily), repairs: Math.min(999999, after.game.repairs + (before.districts[id].damage > 0 && after.districts[id].damage === 0 ? 1 : 0)) } };
}
/** Called on returning, never on a foreground animation tick. Closed-tab gaps use the last persisted heartbeat. */
export function harvestEnergy(c: City, now: number): City {
  const minutes = c.game.lastActive > 0 ? Math.min(480, Math.floor(Math.max(0, now - c.game.lastActive) / 60000)) : 0;
  const earned = Math.min(minutes, ENERGY_CAP - c.game.energy);
  const next = { ...c, game: { ...c.game, energy: c.game.energy + earned, lastActive: now, lastHarvest: earned } };
  return earned ? event(next, `Пока тебя не было: +${earned} энергии. Выбери здание для новой стройки.`) : next;
}
export function touchActivity(c: City, now: number): City { return { ...c, game: { ...c.game, lastActive: now } }; }
export function startConstruction(c: City, district: DistrictId, now: number): City {
  const d = c.districts[district];
  if (c.game.energy < ENERGY_COST || c.game.jobs.some(j => j.district === district) || (d.xp >= 15 && d.damage === 0)) return c;
  const duration = c.game.upgrades.includes('workshop') ? 15000 : 30000;
  return event({ ...c, game: { ...c.game, energy: c.game.energy - ENERGY_COST, jobs: [...c.game.jobs, { district, start: now, end: now + duration }] } }, `${DISTRICTS.find(d => d.id === district)!.building}: бригада получила 20 энергии и начала работу.`);
}
export function settleConstruction(c: City, now: number): City {
  const completed = c.game.jobs.filter(j => j.end <= now); if (!completed.length) return c;
  let next: City = { ...c, districts: { ...c.districts }, game: { ...c.game, jobs: c.game.jobs.filter(j => j.end > now) } };
  for (const job of completed) {
    const d = next.districts[job.district];
    if (d.xp >= 15 && d.damage === 0) {
      next.game.energy = Math.min(ENERGY_CAP, next.game.energy + ENERGY_COST);
      next = event(next, 'Район уже полностью готов. Бригада вернула до 20 энергии в запас.');
      continue;
    }
    next.districts[job.district] = { ...d, xp: Math.min(15, d.xp + 1), damage: Math.max(0, d.damage - 10) };
    next.game.builds = Math.min(999999, next.game.builds + 1);
    if (d.damage > 0 && next.districts[job.district].damage === 0) next.game.repairs = Math.min(999999, next.game.repairs + 1);
    next = event(next, `${DISTRICTS.find(d => d.id === job.district)!.building}: строительство на энергии завершено! +1 шаг, ремонт +10.`, d.damage ? 'repair' : 'build');
  }
  return next;
}
export const QUESTS = [
  { id: 'first', name: 'Первый добрый шаг', person: 'Миша · строитель', text: 'Выполни любую привычку.', goal: 1, coins: 25, energy: 10, progress: (c: City) => c.game.actions },
  { id: 'trio', name: 'День с огоньком', person: 'Аня · садовница', text: 'Отметь три разных привычки за один день.', goal: 3, coins: 35, energy: 15, progress: (c: City) => c.game.bestDaily },
  { id: 'rest', name: 'Отдых тоже строит', person: 'Лев · инженер', text: 'Заверши первый заказ на энергии.', goal: 1, coins: 30, energy: 10, progress: (c: City) => c.game.builds },
  { id: 'districts', name: 'Большое начало', person: 'Соня · архитектор', text: 'Построй здания в трёх районах.', goal: 3, coins: 50, energy: 20, progress: (c: City) => DISTRICTS.filter(d => c.districts[d.id].xp > 0).length },
  { id: 'repair', name: 'После шторма', person: 'Марк · спасатель', text: 'Полностью восстанови повреждённый район.', goal: 1, coins: 60, energy: 20, progress: (c: City) => c.game.repairs },
];
export function claimQuest(c: City, id: string): City {
  const q = QUESTS.find(q => q.id === id); if (!q || c.game.claimed.includes(id) || q.progress(c) < q.goal) return c;
  return event({ ...c, game: { ...c.game, claimed: [...c.game.claimed, id], coins: Math.min(999999, c.game.coins + q.coins), energy: Math.min(ENERGY_CAP, c.game.energy + q.energy) } }, `Поручение «${q.name}» выполнено. +${q.coins} монет и до ${q.energy} энергии.`);
}
export function buyUpgrade(c: City, id: UpgradeId): City {
  const u = UPGRADES.find(u => u.id === id); if (!u || c.game.upgrades.includes(id) || c.game.coins < u.cost) return c;
  return event({ ...c, game: { ...c.game, coins: c.game.coins - u.cost, upgrades: [...c.game.upgrades, id] } }, `${u.name}: новое место появилось в городе!`);
}
export const cityLevel = (c: City) => 1 + Math.floor(DISTRICTS.reduce((n, d) => n + c.districts[d.id].xp, 0) / 7);
export function validGame(g: Game): boolean {
  const n = (v: unknown, max: number) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max;
  return !!g && n(g.energy, 500) && n(g.coins, 999999) && n(g.lastActive, 9999999999999) && n(g.lastHarvest, 480)
    && ['actions', 'builds', 'repairs'].every(k => n(g[k as 'actions'], 999999)) && n(g.bestDaily, 7)
    && Array.isArray(g.jobs) && g.jobs.length <= 7 && new Set(g.jobs.map(j => j?.district)).size === g.jobs.length
    && g.jobs.every(j => j && DISTRICTS.some(d => d.id === j.district) && n(j.start, 9999999999999) && n(j.end, 9999999999999) && j.end > j.start && j.end - j.start <= 30000)
    && Array.isArray(g.upgrades) && g.upgrades.length <= 4 && new Set(g.upgrades).size === g.upgrades.length && g.upgrades.every(id => UPGRADES.some(u => u.id === id))
    && Array.isArray(g.claimed) && g.claimed.length <= 5 && new Set(g.claimed).size === g.claimed.length && g.claimed.every(id => QUESTS.some(q => q.id === id));
}
