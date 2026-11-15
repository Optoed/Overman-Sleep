export type Material = 'limestone' | 'basalt' | 'sandstone';
export type Biome = 'highlands' | 'alpine' | 'coast';
export type Mood = 'bright' | 'calm' | 'heavy';
export type Weather = 'sun' | 'sunset' | 'mist' | 'rain';
export type Motif = 'library' | 'garden' | 'observatory' | 'forge';
export type HabitMode = 'both' | 'sleep' | 'focus' | 'roadmap';
export type WorldEvent = { id: string; day: number; title: string; detail: string; kind: 'build' | 'repair' | 'weather' | 'skip' | 'journal' };
export type JournalEntry = { id: string; date: string; text: string; tomorrow: string; mood: Mood; motifs: Motif[] };
export type WorldState = {
  version: 1; seed: number; name: string; material: Material; biome: Biome; mood: Mood; weather: Weather;
  mode: HabitMode; xp: number; strength: number; day: number; date: string; streak: number; successfulDays: number;
  today: { sleep: boolean; focus: number; goals: string[] }; goals: { id: string; label: string; motif: Motif }[];
  motifs: Motif[]; journal: JournalEntry[]; history: { day: number; date: string; status: 'done' | 'skip' | 'unknown' }[];
  events: WorldEvent[]; timer: { deadline: number | null; remaining: number; duration: number } | null;
};

export const STORAGE_KEY = 'overman.living-tower.v1';
export const FLOOR_COST = 100;
export const MAX_FLOORS = 100;
export const MATERIALS: Record<Material, { name: string; color: string; accent: string }> = {
  limestone: { name: 'Светлый известняк', color: '#a4a094', accent: '#b38c55' },
  basalt: { name: 'Тёмный базальт', color: '#535e61', accent: '#ab987b' },
  sandstone: { name: 'Тёплый песчаник', color: '#bd9675', accent: '#8b6346' },
};
export const BIOMES: Record<Biome, string> = { highlands: 'Туманные горы', alpine: 'Северный фьорд', coast: 'Золотой берег' };
export const MOTIFS: Record<Motif, string> = { library: 'Библиотека', garden: 'Висячие сады', observatory: 'Обсерватория', forge: 'Мастерская' };
export const WEATHER: Record<Weather, string> = { sun: 'Солнечно', sunset: 'Золотой час', mist: 'Тихий туман', rain: 'Дождь' };
export const MOODS: Record<Mood, string> = { bright: 'На подъёме', calm: 'Спокойно', heavy: 'Непростой день' };

export function localDate(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function nextDate(date: string) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1); return localDate(d); }
export function floorsOf(world: Pick<WorldState, 'xp'>) { return Math.min(MAX_FLOORS, Math.floor(world.xp / FLOOR_COST)); }
export function peopleOf(world: Pick<WorldState, 'xp'>) { return 3 + Math.min(17, Math.floor(floorsOf(world) * .7)); }
export function seeded(seed: number) { let n = seed >>> 0; return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function createWorld(seed = Math.floor(Math.random() * 1000000), date = localDate()): WorldState {
  const random = seeded(seed);
  return { version: 1, seed, name: 'Твоя башня', material: (['limestone','basalt','sandstone'] as const)[Math.floor(random()*3)], biome: (['highlands','alpine','coast'] as const)[Math.floor(random()*3)], mood:'calm', weather:'mist', mode:'both', xp:0, strength:86, day:1, date, streak:0, successfulDays:0, today:{sleep:false,focus:0,goals:[]}, goals:[], motifs:[], journal:[], history:[], timer:null, events:[{id:`${seed}-arrival`,day:1,title:'Остров ждёт тебя',detail:'Три строителя, первый причал и целый мир впереди.',kind:'build'}] };
}

function event(world: WorldState, title: string, detail: string, kind: WorldEvent['kind']): WorldState {
  return { ...world, events:[{id:`${world.day}-${world.xp}-${world.events.length}-${title}`,day:world.day,title,detail,kind},...world.events].slice(0,80) };
}
function award(world: WorldState, xp: number): WorldState {
  const before = floorsOf(world);
  const oldStrength = world.strength;
  let next = { ...world, xp:Math.min(MAX_FLOORS*FLOOR_COST+99, world.xp+xp), strength:Math.min(100,world.strength+12) };
  if (oldStrength<65) next = event(next,'Опоры становятся крепче','Строители вернулись к работе. Окна снова загораются.','repair');
  const after = floorsOf(next);
  if (after>before) {
    next = event(next, after===1?'Первый этаж':'Башня стала выше',`Построен ${after}-й этаж. Это твои накопленные действия, а не серия дней.`, 'build');
    const milestones: Record<number,[string,string]> = { 2:['Первые жители','У подножия появился дом. На острове стало уютнее.'],4:['Новая гавань','Строители закончили второй причал. Прибывает корабль.'],6:['Зелень среди камня','На балконах поселились растения.'],8:['Новые горизонты','В гавани ждёт большой парусник.'],12:['Выше облаков','Башня стала настоящим городом.'],18:['Маяк для странников','Твой свет видно с другого берега.'],24:['Небесный город','Вершина этой главы достигнута. Теперь можно укреплять и украшать мир.'] };
    for(let i=before+1;i<=after;i++) if(milestones[i]) next=event(next,...milestones[i],'build');
  }
  return next;
}

export function completeSleep(world: WorldState): WorldState { return world.today.sleep?world:award({...world,today:{...world.today,sleep:true}},world.mode==='sleep'?70:40); }
export function completeFocus(world: WorldState): WorldState { const next={...world,timer:null,today:{...world.today,focus:world.today.focus+1}}; return award(next,world.today.focus<3?35:0); }
export function completeGoal(world: WorldState,id: string): WorldState { return !world.goals.some(g=>g.id===id)||world.today.goals.includes(id)?world:award({...world,today:{...world.today,goals:[...world.today.goals,id]}},25); }
export function dayComplete(world: WorldState): boolean {
  if(world.mode==='sleep') return world.today.sleep;
  if(world.mode==='focus') return world.today.focus>0;
  if(world.mode==='roadmap') return world.goals.length>0 && world.goals.every(g=>world.today.goals.includes(g.id));
  return world.today.sleep&&world.today.focus>0;
}
export function advanceDay(world: WorldState, outcome: 'done' | 'skip' | 'unknown'): WorldState {
  const status = outcome==='done' && !dayComplete(world) ? 'unknown' : outcome;
  let next:WorldState={...world,day:world.day+1,date:nextDate(world.date),today:{sleep:false,focus:0,goals:[]},timer:null,
    strength:status==='skip'?Math.max(18,world.strength-18):world.strength,
    successfulDays:world.successfulDays+(status==='done'?1:0),streak:status==='done'?world.streak+1:0,
    history:[...world.history,{day:world.day,date:world.date,status}].slice(-90)};
  if(status==='skip') next=event(next,'Тихий день','Часть работ остановлена. Башня ждёт следующего шага.','skip');
  else if(status==='done') next=event(next,'День стал частью истории','Жители зажигают фонари. Завтра будет новая глава.','build');
  return next;
}
export function reconcileDate(world: WorldState, date = localDate()): WorldState {
  if (date<=world.date) return world;
  const elapsed = Math.round((new Date(`${date}T12:00:00`).getTime()-new Date(`${world.date}T12:00:00`).getTime())/86400000);
  if(elapsed<=0) return world;
  const status=dayComplete(world)?'done':'unknown';
  const history=[...world.history,{day:world.day,date:world.date,status} as const];
  return {...world,date,day:world.day+elapsed,today:{sleep:false,focus:0,goals:[]},streak:elapsed===1&&status==='done'?world.streak+1:0,successfulDays:world.successfulDays+(status==='done'?1:0),history:history.slice(-90)};
}
export function inferMotifs(text: string): Motif[] {
  const patterns: Record<Motif,RegExp>={library:/книг|чита|проч[еи]|уч[еиё]|язык|экзамен|исслед|read|book|learn/i,garden:/сад|растен|природ|прогул|спокой|семь|отдых|garden|walk/i,observatory:/зв[её]зд|космос|мечт|путешеств|наук|планет|space|travel/i,forge:/код|программ|проект|работ|тренир|спорт|зал|стро|code|work|gym/i};
  return (Object.keys(patterns) as Motif[]).filter(key=>patterns[key].test(text));
}
export function settleWorld(world: WorldState, now = Date.now()): WorldState {
  let next = world;
  if (next.timer?.deadline && next.timer.deadline <= now) {
    next = completeFocus(reconcileDate(next, localDate(new Date(next.timer.deadline))));
  }
  return reconcileDate(next, localDate(new Date(now)));
}
export function saveJournal(world: WorldState, text: string, tomorrow: string, mood: Mood, motifs: Motif[]): WorldState {
  const entry:JournalEntry={id:world.date,date:world.date,text:text.trim().slice(0,3000),tomorrow:tomorrow.trim().slice(0,1500),mood,motifs};
  return event({...world,mood,weather:({bright:'sun',calm:'mist',heavy:'rain'} as const)[mood],motifs:[...new Set([...world.motifs,...motifs])],journal:[entry,...world.journal.filter(e=>e.date!==world.date)].slice(0,60)},'Мир запомнил твой день',motifs.length?`В архитектуре появятся: ${motifs.map(m=>MOTIFS[m].toLowerCase()).join(', ')}.`:'Настроение дня стало погодой над островом.','journal');
}
export function stageWorld(world: WorldState,floors:number):WorldState { const f=Math.max(0,Math.min(MAX_FLOORS,Math.floor(floors))); return {...world,xp:f*100+30,day:f*2+1,strength:86,today:{sleep:false,focus:0,goals:[]},timer:null}; }

// Only deserialize a validated, bounded world; browser storage can be edited or damaged.
export function parseWorld(raw: string | null): WorldState | null {
  if(!raw) return null;
  try {
    const w=JSON.parse(raw);
    const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
    const date=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00'));
    const str=(s:unknown,max=3000)=>typeof s==='string'&&s.length<=max;
    const motif=(m:unknown)=>typeof m==='string'&&Object.hasOwn(MOTIFS,m);
    if(w.version!==1||!finite(w.seed,0,4294967295)||!str(w.name,80)||!Object.hasOwn(MATERIALS,w.material)||!Object.hasOwn(BIOMES,w.biome)||!Object.hasOwn(MOODS,w.mood)||!Object.hasOwn(WEATHER,w.weather)||!['both','sleep','focus','roadmap'].includes(w.mode)||!finite(w.xp,0,MAX_FLOORS*FLOOR_COST+99)||!finite(w.strength,18,100)||!finite(w.day,1,100000)||!date(w.date)||!finite(w.streak,0,100000)||!finite(w.successfulDays,0,100000)) return null;
    if(!w.today||typeof w.today.sleep!=='boolean'||!finite(w.today.focus,0,10000)||!Array.isArray(w.today.goals)||!w.today.goals.every((x:unknown)=>str(x,100))) return null;
    if(!Array.isArray(w.goals)||w.goals.length>8||!w.goals.every((g:Record<string,unknown>)=>g&&str(g.id,100)&&str(g.label,100)&&motif(g.motif))) return null;
    if(!Array.isArray(w.motifs)||w.motifs.length>4||!w.motifs.every(motif)) return null;
    if(!Array.isArray(w.events)||w.events.length>80||!w.events.every((e:Record<string,unknown>)=>e&&str(e.id,200)&&finite(e.day,1,100000)&&str(e.title,200)&&str(e.detail,1000)&&['build','repair','weather','skip','journal'].includes(String(e.kind)))) return null;
    if(!Array.isArray(w.journal)||w.journal.length>60||!w.journal.every((e:Record<string,unknown>)=>e&&str(e.id,30)&&date(e.date)&&str(e.text)&&str(e.tomorrow,1500)&&Object.hasOwn(MOODS,String(e.mood))&&Array.isArray(e.motifs)&&e.motifs.every(motif))) return null;
    if(!Array.isArray(w.history)||w.history.length>90||!w.history.every((e:Record<string,unknown>)=>e&&finite(e.day,1,100000)&&date(e.date)&&['done','skip','unknown'].includes(String(e.status)))) return null;
    if(w.timer!==null&&(!w.timer||!finite(w.timer.duration,1,3600)||!finite(w.timer.remaining,0,3600)||(w.timer.deadline!==null&&!finite(w.timer.deadline,0,Number.MAX_SAFE_INTEGER)))) return null;
    return w as WorldState;
  } catch { return null; }
}
