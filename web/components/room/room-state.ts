export const ROOM_KEY = 'overman.private-room.v1';
export const CATALOG = {
  model: { label: 'Макет проекта', description: 'Место для того, что ты создаёшь.', color: '#db9975' },
  book: { label: 'Книга открытий', description: 'Мысли, которым захотелось остаться.', color: '#749b9b' },
  plant: { label: 'Росток заботы', description: 'Напоминание о времени для себя и близких.', color: '#89a56c' },
  compass: { label: 'Компас перемен', description: 'Путь, который ты выбираешь.', color: '#d6b36f' },
  frame: { label: 'Памятная карточка', description: 'Обычный день тоже достоин памяти.', color: '#c5a1ab' },
} as const;
export const RESIDENTS = {
  skeptic: { name: 'Скептик', subtitle: 'Задаёт неудобные вопросы', color: '#8c82b2', greeting: 'Можем обойтись без красивых отчётов. О чём ты на самом деле хочешь поговорить?' },
  ally: { name: 'Союзник', subtitle: 'Замечает твои маленькие победы', color: '#75a58d', greeting: 'Рад тебя видеть. Здесь не нужно заслуживать отдых. Как ты сегодня?' },
  rebel: { name: 'Бунтарь', subtitle: 'Помогает найти собственный голос', color: '#cf8b6c', greeting: 'Что сегодня было твоим выбором, а что ты сделал потому, что «надо»?' },
} as const;
export type ItemKind = keyof typeof CATALOG;
export type Resident = keyof typeof RESIDENTS;
export type Atmosphere = 'sun' | 'sunset' | 'rain';
export const ATMOSPHERES: Record<Atmosphere, string> = { sun: 'Ясное утро', sunset: 'Золотой вечер', rain: 'Тихий дождь' };
export type Entry = { id: string; date: string; text: string; title: string; goal: string; kind: ItemKind; atmosphere: Atmosphere };
export type Message = { id: string; role: 'user' | 'assistant'; text: string; mode: 'local' | 'ai' };
export type RoomState = { version: 1; revision: number; entries: Entry[]; chats: Record<Resident, Message[]>; atmosphere: Atmosphere };
export const emptyRoom = (): RoomState => ({ version: 1, revision: 0, entries: [], chats: { skeptic: [], ally: [], rebel: [] }, atmosphere: 'sunset' });
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function interpret(text: string): Pick<Entry, 'title' | 'kind'> {
  const kind: ItemKind = /проект|код|созда|сделал|работ|project/i.test(text) ? 'model' : /книг|проч|уч[ёи]|экзамен|book/i.test(text) ? 'book' : /семь|друг|отдых|прогул|забот|сад/i.test(text) ? 'plant' : /путеше|решил|мечт|переезд|цель/i.test(text) ? 'compass' : 'frame';
  return { kind, title: text.trim().split(/[.!?\n]/)[0].slice(0, 100) || 'Маленькая глава' };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const has = (o: object, v: unknown) => typeof v === 'string' && Object.hasOwn(o, v);
export function validEntry(v: unknown): v is Entry {
  if (!record(v)) return false;
  return str(v.id, 100) && !!v.id && str(v.date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && !Number.isNaN(Date.parse(v.date)) &&
    str(v.text, 3000) && !!v.text.trim() && str(v.title, 100) && !!v.title.trim() && str(v.goal, 500) && has(CATALOG, v.kind) && has(ATMOSPHERES, v.atmosphere);
}
export function parseRoom(raw: string | null): RoomState {
  if (raw === null) return emptyRoom();
  if (raw.length > 2500000) throw new Error('Хранилище слишком велико. Сначала сохрани резервную копию.');
  let v: unknown; try { v = JSON.parse(raw); } catch { throw new Error('Записи повреждены. Автоматическая перезапись остановлена.'); }
  if (!record(v) || v.version !== 1 || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || !has(ATMOSPHERES, v.atmosphere) || !Array.isArray(v.entries) || v.entries.length > 365 || !v.entries.every(validEntry) || new Set(v.entries.map(e => e.id)).size !== v.entries.length || !record(v.chats)) throw new Error('Не удалось прочитать кабинет. Исходные данные сохранены.');
  for (const id of Object.keys(RESIDENTS)) {
    const list = v.chats[id];
    if (!Array.isArray(list) || list.length > 100 || !list.every(m => record(m) && str(m.id, 100) && ['user', 'assistant'].includes(String(m.role)) && str(m.text, 4000) && ['local', 'ai'].includes(String(m.mode)))) throw new Error('История разговора повреждена. Перезапись остановлена.');
  }
  return v as RoomState;
}
export function saveEntry(state: RoomState, entry: Entry): RoomState {
  if (!validEntry(entry)) throw new Error('Проверь текст, заголовок и дату записи.');
  const existing = state.entries.some(e => e.id === entry.id);
  if (!existing && state.entries.length >= 365) throw new Error('В архиве 365 записей. Экспортируй их и удали ненужные, прежде чем добавлять новые.');
  return { ...state, entries: [entry, ...state.entries.filter(e => e.id !== entry.id)].sort((a, b) => b.date.localeCompare(a.date)), atmosphere: entry.atmosphere,
    // Old replies can quote corrected private facts. Clear them when their source changes.
    chats: existing ? emptyRoom().chats : state.chats };
}
export function deleteEntry(state: RoomState, id: string): RoomState {
  const entries = state.entries.filter(e => e.id !== id);
  return { ...state, entries, chats: emptyRoom().chats, atmosphere: entries[0]?.atmosphere ?? 'sunset' };
}
export function activeMemories(state: RoomState) { return state.entries.slice(0, 6); }
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function persist(storage: StorageLike, key: string, state: RoomState, expected: number): RoomState {
  const current = parseRoom(storage.getItem(key));
  if (current.revision !== expected) throw new Error('Кабинет изменён в другой вкладке. Обнови страницу перед сохранением; скопируй незавершённый текст.');
  const next = { ...state, revision: expected + 1 };
  parseRoom(JSON.stringify(next));
  try { storage.setItem(key, JSON.stringify(next)); } catch { throw new Error('Не удалось сохранить: хранилище недоступно или заполнено. Текст оставлен на экране.'); }
  return next;
}
export function localReply(resident: Resident, state: RoomState, input: string): string {
  const history = state.chats[resident];
  const turn = history.filter(m => m.role === 'assistant').length;
  const entry = state.entries.length ? state.entries[turn % state.entries.length] : undefined;
  const anchor = entry ? `В записи от ${entry.date} ты написал: «${entry.title}». ` : '';
  const goal = state.entries.find(e => e.goal)?.goal;
  const questions: Record<Resident, string[]> = {
    skeptic: ['Какой факт подтверждает твою мысль, а какой ей противоречит?', 'Ты сейчас выбираешь следующий шаг или пытаешься найти идеальную гарантию?', 'Что можно проверить за десять минут вместо ещё одного большого плана?', 'Если убрать чужие ожидания, тебе самому это всё ещё нужно?'],
    ally: ['Что в этом дне тебе хотелось бы сохранить?', 'Какая поддержка сейчас помогла бы — отдых, разговор или небольшой конкретный шаг?', 'Что получилось, даже если со стороны это выглядит мелочью?', 'Как сделать завтрашний шаг достаточно маленьким, чтобы осталось место для жизни?'],
    rebel: ['С чем именно ты больше не хочешь мириться?', 'Где здесь твоё желание, а где чужое «так положено»?', 'Какую границу ты можешь обозначить спокойно и конкретно?', 'Что ты выберешь сам, даже если никто не будет оценивать результат?'],
  };
  const reflection = input.trim().slice(0, 160);
  return `${anchor}${goal && turn % 2 === 1 ? `Твой записанный шаг: «${goal}». ` : ''}Ты говоришь: «${reflection}». ${questions[resident][turn % 4]}`;
}
