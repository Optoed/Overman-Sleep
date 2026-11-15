'use client';
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowUpRight, BookOpen, CloudRain, Compass, Download, Feather, Leaf, MessageCircle, Plus, Shield, Sparkles, Sun, Sunset, X } from 'lucide-react';
import RoomScene from './room-scene';
import { activeMemories, ATMOSPHERES, CATALOG, deleteEntry, emptyRoom, interpret, localReply, parseRoom, persist, RESIDENTS, ROOM_KEY, saveEntry, today, type Atmosphere, type Entry, type ItemKind, type Message, type Resident, type RoomState } from './room-state';
import { parseWorld, STORAGE_KEY } from '../tower/world-state';
import styles from './room.module.css';

type Panel = 'journal' | 'archive' | 'goal' | 'privacy' | `memory:${string}` | `resident:${Resident}` | null;
const blank = (): Entry => ({ id: '', date: today(), text: '', title: '', goal: '', kind: 'frame', atmosphere: 'sunset' });
function download(raw: string, name: string) { const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export default function RoomExperience() {
  const [state, setState] = useState<RoomState>(emptyRoom), current = useRef(state);
  const storage = useRef<Storage | null>(null), key = useRef(ROOM_KEY), blocked = useRef(false);
  const [loaded, setLoaded] = useState(false), [demo, setDemo] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<Panel>(null), [draft, setDraft] = useState<Entry>(blank), [confirmDelete, setConfirmDelete] = useState(false);
  const [chat, setChat] = useState(''), [busy, setBusy] = useState(false), request = useRef<AbortController | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false), [useAi, setUseAi] = useState(false), [aiLabel, setAiLabel] = useState('AI-провайдер');
  const [showHistory, setShowHistory] = useState(false), stage = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const resident = panel?.startsWith('resident:') ? panel.slice(9) as Resident : null;
  const lastReply = resident ? [...state.chats[resident]].reverse().find(m => m.role === 'assistant') : undefined;
  const speech = resident ? { resident, text: lastReply?.text ?? RESIDENTS[resident].greeting, busy, mode: lastReply?.mode === 'ai' ? 'AI' : 'Локальный режим' } : null;
  const selected = panel?.startsWith('memory:') ? state.entries.find(e => e.id === panel.slice(7)) : undefined;
  const goalEntry = state.entries.find(e => e.goal);
  const title = panel === 'journal' ? draft.id ? 'Переписать эту главу' : 'Как прошёл день?' : panel === 'archive' ? 'История твоей комнаты' : panel === 'goal' ? 'Один шаг на завтра' : panel === 'privacy' ? 'Только твоя история' : resident ? RESIDENTS[resident].name : selected?.title ?? 'Воспоминание';
  useEffect(() => {
    const isDemo = new URLSearchParams(location.search).get('demo') === '1'; setDemo(isDemo); key.current = isDemo ? `${ROOM_KEY}.demo` : ROOM_KEY;
    try { storage.current = isDemo ? sessionStorage : localStorage; const next = parseRoom(storage.current.getItem(key.current)); current.current = next; setState(next); }
    catch (e) { blocked.current = true; setError(e instanceof Error ? e.message : 'Хранилище недоступно. Сохранение отключено.'); }
    setLoaded(true);
    const changed = (e: StorageEvent) => { if (e.key === key.current || e.key === null) { blocked.current = true; request.current?.abort(); setError('Кабинет изменён в другой вкладке. Скопируй незавершённый текст и обнови страницу.'); } };
    window.addEventListener('storage', changed);
    const controller = new AbortController(); fetch('/api/room-chat', { signal: controller.signal }).then(r => r.json()).then(v => { setAiAvailable(v.available === true); if (typeof v.label === 'string') setAiLabel(v.label); }).catch(() => {});
    return () => { window.removeEventListener('storage', changed); controller.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => { request.current?.abort(); request.current = null; setBusy(false); setChat(''); setConfirmDelete(false); }, [panel]);
  useEffect(() => {
    setShowHistory(false); if (!resident) return;
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => stage.current?.querySelector<HTMLButtonElement>('[data-end-conversation]')?.focus(), 0);
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setPanel(null); }
      if (e.key === 'Tab') {
        const items = Array.from(stage.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),a[href]') ?? []).filter(el => el.offsetParent !== null);
        const first = items[0], last = items.at(-1); if (!first) return;
        if (e.shiftKey && (document.activeElement === first || !stage.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !stage.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => { clearTimeout(timer); document.body.style.overflow = overflow; window.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [resident]);
  useEffect(() => { chatEnd.current?.scrollIntoView?.({ block: 'nearest' }); }, [state.chats, busy]);
  useEffect(() => {
    if (panel !== 'journal' || draft.id || !loaded || blocked.current) return;
    try { storage.current?.setItem(`${key.current}.draft`, JSON.stringify(draft)); } catch { setError('Не удалось сохранить черновик. Скопируй текст перед закрытием.'); }
  }, [draft, panel, loaded]);
  function commit(next: RoomState) {
    if (blocked.current || !storage.current) { setError('Сохранение недоступно. Экспортируй данные и обнови страницу.'); return false; }
    try { const saved = persist(storage.current, key.current, next, current.current.revision); current.current = saved; setState(saved); setError(''); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Не получилось сохранить.'); return false; }
  }
  function openJournal(entry?: Entry) {
    let next = entry ? { ...entry } : { ...blank(), atmosphere: state.atmosphere };
    if (!entry) { try { const raw = storage.current?.getItem(`${key.current}.draft`); if (raw) { const saved = JSON.parse(raw); if (typeof saved.text === 'string' && saved.text.length <= 3000 && typeof saved.title === 'string' && typeof saved.goal === 'string' && Object.hasOwn(CATALOG, saved.kind) && Object.hasOwn(ATMOSPHERES, saved.atmosphere)) next = { ...next, text: saved.text, title: saved.title.slice(0, 100), goal: saved.goal.slice(0, 500), kind: saved.kind, atmosphere: saved.atmosphere }; } } catch { /* A damaged draft does not overwrite the saved archive. */ } }
    setDraft(next); setPanel('journal');
  }
  function submitEntry(e: React.FormEvent) {
    e.preventDefault(); const suggestion = interpret(draft.text);
    const next = { ...draft, id: draft.id || crypto.randomUUID(), text: draft.text.trim(), title: draft.title.trim() || suggestion.title, goal: draft.goal.trim() };
    try { if (commit(saveEntry(current.current, next))) { try { storage.current?.removeItem(`${key.current}.draft`); } catch {} setPanel(`memory:${next.id}`); setNotice('День сохранён. В комнате осталось что-то твоё.'); } }
    catch (e) { setError(e instanceof Error ? e.message : 'Проверь запись.'); }
  }
  function importJournal() {
    if (demo) return;
    try { const world = parseWorld(localStorage.getItem(STORAGE_KEY)); if (!world?.journal.length) { setNotice('В дневнике острова пока нет записей.'); return; }
      let next = current.current; let count = 0;
      for (const e of [...world.journal].reverse()) { const id = `island-${e.id}`; if (next.entries.some(x => x.id === id) || !e.text.trim()) continue; next = saveEntry(next, { id, date: e.date, text: e.text, ...interpret(e.text), goal: e.tomorrow.slice(0, 500), atmosphere: e.mood === 'bright' ? 'sun' : e.mood === 'heavy' ? 'rain' : 'sunset' }); count++; }
      if (commit(next)) setNotice(`Добавлено воспоминаний: ${count}. Дневник острова не изменён.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось перенести дневник.'); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!resident || busy || request.current || !chat.trim()) return;
    const id = resident, input = chat.trim(), before = current.current;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    let text = '', mode: 'local' | 'ai' = 'local';
    try {
      if (useAi) {
        const response = await fetch('/api/room-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resident: id, input, entries: before.entries.slice(0, 12), history: before.chats[id].slice(-12) }), signal: controller.signal });
        const result = await response.json(); if (!response.ok || typeof result.text !== 'string') throw new Error(result.error || 'AI сейчас недоступен. Текст оставлен в поле. Можно переключиться на локальный режим.'); text = result.text; mode = 'ai';
      } else { text = localReply(id, before, input); }
      if (controller.signal.aborted) return;
      if (current.current.revision !== before.revision) throw new Error('Записи изменились во время ответа. Отправь сообщение ещё раз.');
      const messages: Message[] = [...before.chats[id], { id: crypto.randomUUID(), role: 'user', text: input, mode }, { id: crypto.randomUUID(), role: 'assistant', text, mode }];
      if (commit({ ...before, chats: { ...before.chats, [id]: messages.slice(-100) } })) setChat('');
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Ответ не получен. Попробуй ещё раз.'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  const choose = (id: string) => { if (id === 'goal' || id.startsWith('memory:') || id.startsWith('resident:')) setPanel(id as Panel); };
  const changeAtmosphere = (value: Atmosphere) => commit({ ...current.current, atmosphere: value });
  return <div className={styles.app}>
    <header className={styles.header}><a href="/" className={styles.back}><ArrowLeft size={17}/> На остров</a><a href="/" className={styles.brand}>BECOME <b>OVERMAN</b></a><button onClick={() => setPanel('privacy')} className={styles.privacy}><Shield size={15}/><span>{demo ? 'Демо · отдельно' : 'Личный кабинет'}</span></button></header>
    <div className={styles.layout}>
      <section className={styles.world} aria-label="Твой личный кабинет">
        <div className={styles.worldTitle}><div><span className={styles.eyebrow}>ВНУТРИ ТВОЕЙ БАШНИ</span><h1>Здесь живёт твоя история<span>.</span></h1></div><span className={styles.chapter}>{String(state.entries.length).padStart(2, '0')}<small>воспоминаний</small></span></div>
        <div ref={stage} className={resident ? styles.conversationStage : styles.roomStage} role={resident ? 'dialog' : undefined} aria-modal={resident ? true : undefined} aria-label={resident ? `Разговор: ${RESIDENTS[resident].name}` : undefined}>
          {loaded && <RoomScene state={state} paused={!!panel} onSelect={choose} speech={speech}>
            {resident && <>
              <div className={styles.conversationTop}><div><span>ВНУТРИ ТВОЕЙ ИСТОРИИ</span><h2>{RESIDENTS[resident].name}</h2><p>{RESIDENTS[resident].subtitle}</p></div><button data-end-conversation onClick={() => setPanel(null)} aria-label="Закончить разговор"><X size={20}/><span>Вернуться · Esc</span></button></div>
              <div className={styles.conversationBottom}>
                {error && <p className={styles.conversationError} role="alert">{error}</p>}
                <div className={styles.conversationTools}><span>{useAi ? aiLabel : 'Демо-диалог · для свободных ответов подключи AI'}</span><button onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory}>{showHistory ? 'Скрыть историю' : 'История разговора'}</button></div>
                {showHistory && <div className={styles.conversationHistory}>{state.chats[resident].length ? state.chats[resident].map(m => <p key={m.id}><strong>{m.role === 'user' ? 'Ты' : RESIDENTS[resident].name}:</strong> {m.text}</p>) : <p>Вы ещё не разговаривали. Первое сообщение останется здесь.</p>}<div ref={chatEnd}/></div>}
                <form onSubmit={send} className={styles.conversationInput}><label className={styles.srOnly} htmlFor="scene-resident-message">Сообщение жителю</label><textarea id="scene-resident-message" value={chat} onChange={e => setChat(e.target.value)} maxLength={2000} rows={2} placeholder="Скажи, что у тебя на уме…" disabled={busy}/><button disabled={busy || !chat.trim() || blocked.current} aria-label="Отправить">{busy ? '…' : <ArrowUpRight size={22}/>}</button></form>
                {busy ? <button className={styles.cancelRequest} onClick={() => { request.current?.abort(); request.current = null; setBusy(false); }}>Отменить запрос</button> : <div className={styles.conversationSuggestions}>{['Хочу разобраться со своей целью', 'Сегодня было непросто', 'Что стоит попробовать завтра?'].map(text => <button key={text} onClick={() => { setChat(text); stage.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }}>{text}</button>)}</div>}
              </div>
            </>}
          </RoomScene>}
        </div>
        <div className={styles.sceneFooter}><span><Compass size={14}/> WASD — идти · стрелки или перетаскивание — осмотр · E — открыть</span><span>На телефоне — стрелки на экране</span></div>
        <div className={styles.weather}><span>Настроение комнаты</span><div>{(Object.keys(ATMOSPHERES) as Atmosphere[]).map(a => <button key={a} aria-pressed={state.atmosphere === a} onClick={() => changeAtmosphere(a)} disabled={!loaded || blocked.current}>{a === 'sun' ? <Sun size={15}/> : a === 'sunset' ? <Sunset size={15}/> : <CloudRain size={15}/>} {ATMOSPHERES[a]}</button>)}</div></div>
      </section>
      <aside className={styles.sidebar}>
        <section className={styles.journalCard}><span className={styles.eyebrow}><Feather size={14}/> МАЛЕНЬКИЙ ВЕЧЕРНИЙ РИТУАЛ</span><h2>Каким был <br/>твой день?</h2><p>Пара мыслей. Один предмет. <br/>Ещё одна глава, которая останется.</p><button className={styles.primary} onClick={() => openJournal()} disabled={!loaded}>Рассказать о дне <Plus size={17}/></button><small>Без оценок, серий и правильных ответов.</small></section>
        <section className={styles.residents}><div className={styles.sectionHeading}><h2>Ты не один</h2><span>3 собеседника</span></div>{(Object.keys(RESIDENTS) as Resident[]).map((id, i) => <button key={id} className={styles.resident} onClick={() => setPanel(`resident:${id}`)} disabled={!loaded}><span aria-hidden="true" className={styles.portrait} style={{ '--resident': RESIDENTS[id].color } as React.CSSProperties}><span>{['◉', '•', '⌁'][i]}</span></span><span><strong>{RESIDENTS[id].name}</strong><small>{RESIDENTS[id].subtitle}</small></span><MessageCircle size={17}/></button>)}<p className={styles.fine}>{useAi ? `${aiLabel} · AI включён в этом сеансе.` : 'Локальные вопросы по твоим записям. AI не подключён.'}</p></section>
        <button className={styles.goalCard} onClick={() => setPanel('goal')}><span className={styles.eyebrow}>ОДИН ШАГ НА ЗАВТРА</span><strong>{goalEntry?.goal || 'Дать место чему-то важному'}</strong><ArrowUpRight size={18}/></button>
      </aside>
    </div>
    {error && <div className={styles.error} role="alert">{error} <button onClick={() => { try { download(storage.current?.getItem(key.current) || JSON.stringify(current.current), 'overman-backup.json'); } catch { setNotice('Браузер не разрешил чтение резервной копии.'); } }}>Скачать резервную копию</button></div>}
    {notice && <div className={styles.notice} role="status">{notice}<button aria-label="Скрыть уведомление" onClick={() => setNotice('')}><X size={15}/></button></div>}
    <section className={styles.memories}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>НЕ ПРОСТО ВЕЩИ</span><h2>Следы твоих дней</h2></div><button className={styles.textButton} onClick={() => setPanel('archive')}>Весь архив <ArrowUpRight size={16}/></button></div><div className={styles.memoryGrid}>{activeMemories(state).map(e => <button key={e.id} className={styles.memoryCard} onClick={() => setPanel(`memory:${e.id}`)}><span className={styles.objectIcon} style={{ background: `${CATALOG[e.kind].color}28`, color: CATALOG[e.kind].color }}>{e.kind === 'book' ? <BookOpen/> : e.kind === 'plant' ? <Leaf/> : e.kind === 'compass' ? <Compass/> : <Sparkles/>}</span><small>{e.date} · {CATALOG[e.kind].label}</small><strong>{e.title}</strong></button>)}{!state.entries.length && <button className={styles.empty} onClick={() => openJournal()}><Feather size={25}/><strong>Пока здесь чистый лист</strong><span>Расскажи о своём дне — первое воспоминание займёт место в комнате.</span></button>}</div></section>
    <footer className={styles.footer}>Твоя история хранится {demo ? 'в демосеансе этой вкладки' : 'только в этом браузере'}. <button onClick={() => setPanel('privacy')}>Хранение и приватность</button></footer>
    <Dialog.Root open={panel !== null && !resident} onOpenChange={open => { if (!open) setPanel(null); }}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.dialog} aria-describedby="room-dialog-description"><Dialog.Close className={styles.close} aria-label="Закрыть"><X size={21}/></Dialog.Close><span className={styles.eyebrow}>ТВОЯ КОМНАТА</span><Dialog.Title className={styles.dialogTitle}>{title}</Dialog.Title><Dialog.Description id="room-dialog-description" className={styles.description}>{panel === 'journal' ? 'Можно быть честным. Непростой день не разрушает твою башню.' : 'Здесь сохраняется то, чему ты решил дать место.'}</Dialog.Description>
      {error && <p className={styles.inlineError} role="alert">{error}</p>}
      {panel === 'journal' && <form className={styles.form} onSubmit={submitEntry}>
        <label>Сегодня<textarea value={draft.text} maxLength={3000} rows={5} required onChange={e => setDraft(d => ({ ...d, text: e.target.value }))} placeholder="Что произошло? Что хочется запомнить?"/></label>
        <button className={styles.secondary} type="button" onClick={() => setDraft(d => ({ ...d, ...interpret(d.text) }))} disabled={!draft.text.trim()}><Sparkles size={15}/> Подобрать предмет и заголовок</button>
        <p className={styles.fine}>Подбор по словам выполняется в браузере. Можно изменить любой результат.</p>
        <label>Название воспоминания<input value={draft.title} maxLength={100} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Маленькая глава моей жизни"/></label>
        <label htmlFor="memory-kind">Предмет</label><select id="memory-kind" value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as ItemKind }))}>{Object.entries(CATALOG).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select>
        <label>Один шаг на завтра<input value={draft.goal} maxLength={500} onChange={e => setDraft(d => ({ ...d, goal: e.target.value }))} placeholder="Необязательно. Что хочется попробовать?"/></label>
        <label htmlFor="memory-atmosphere">Атмосфера</label><select id="memory-atmosphere" value={draft.atmosphere} onChange={e => setDraft(d => ({ ...d, atmosphere: e.target.value as Atmosphere }))}>{Object.entries(ATMOSPHERES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
        {draft.id && <p className={styles.fine}>При изменении записи беседы будут очищены, чтобы жители не цитировали прежнюю версию.</p>}
        <button className={styles.primary} disabled={!draft.text.trim() || blocked.current}>Сохранить воспоминание <Feather size={16}/></button>
      </form>}
      {selected && <article className={styles.memoryDetail}><span className={styles.tag}>{selected.date} · {CATALOG[selected.kind].label}</span><p>{selected.text}</p>{selected.goal && <blockquote>На завтра: {selected.goal}</blockquote>}<p className={styles.fine}>{CATALOG[selected.kind].description} {activeMemories(state).some(e => e.id === selected.id) ? 'Этот предмет сейчас в комнате.' : 'Это воспоминание находится в архиве.'}</p><button className={styles.secondary} onClick={() => openJournal(selected)}>Исправить запись или интерпретацию</button>{!confirmDelete ? <button className={styles.danger} onClick={() => setConfirmDelete(true)}>Удалить воспоминание</button> : <div className={styles.confirm}><p>Удалить запись, её предмет и все беседы, которые могли её упоминать?</p><button className={styles.danger} onClick={() => { if (commit(deleteEntry(current.current, selected.id))) { setPanel('archive'); setNotice('Запись, предмет и беседы удалены.'); } }}>Да, удалить</button><button onClick={() => setConfirmDelete(false)}>Отмена</button></div>}</article>}
      {panel === 'archive' && <div className={styles.archive}><p className={styles.fine}>В комнате — шесть последних воспоминаний. Остальные остаются здесь. Редактирование даты дня не меняет прогресс острова.</p>{!state.entries.length && <p>Первую главу ещё предстоит написать.</p>}{state.entries.map(e => <button key={e.id} onClick={() => setPanel(`memory:${e.id}`)}><span>{e.date} · {CATALOG[e.kind].label}</span><strong>{e.title}</strong><ArrowUpRight size={16}/></button>)}<button className={styles.secondary} onClick={() => download(JSON.stringify(state, null, 2), 'overman-my-room.json')}><Download size={16}/> Скачать мои записи</button>{!demo && <button className={styles.secondary} onClick={importJournal}>Скопировать записи из дневника острова</button>}</div>}
      {panel === 'goal' && <div className={styles.memoryDetail}><blockquote>{goalEntry?.goal || 'Пока нет записанного шага. Возможно, сегодня тебе просто нужен отдых.'}</blockquote>{goalEntry && <p>Из записи «{goalEntry.title}» · {goalEntry.date}</p>}<button className={styles.primary} onClick={() => openJournal(goalEntry)}>Записать или изменить шаг <Feather size={16}/></button></div>}
      {panel === 'privacy' && <div className={styles.memoryDetail}><p>Это локальный кабинет. Записи и беседы доступны людям с доступом к этому профилю браузера. Они не публикуются в рейтингах и не отправляются друзьям. Синхронизации между устройствами пока нет.</p><p>Очистка данных браузера удалит кабинет. Скачивай резервную копию важных записей. Кабинет хранится отдельно от острова.</p><button className={styles.secondary} onClick={() => download(JSON.stringify(state, null, 2), 'overman-my-room.json')}><Download size={16}/> Скачать записи и беседы</button><h3>Разговоры с AI</h3><p>{aiAvailable ? `Настроен ${aiLabel}. При включении провайдеру передаются твоё сообщение, последние 12 записей дневника и 12 сообщений выбранного разговора. Ответы внешнего провайдера могут расходовать его оплачиваемый лимит.` : 'AI-провайдер пока не подключён. Нужны его параметры и ключ на сервере. Сейчас жители используют подготовленные вопросы с отсылками к твоим записям; это демонстрация, а не полноценный AI-чат.'}</p><label className={styles.consent}><input type="checkbox" checked={useAi} disabled={!aiAvailable} onChange={e => setUseAi(e.target.checked)}/> Разрешаю передавать этот контекст настроенному AI-провайдеру в этом сеансе</label><a className={styles.textButton} href="/room?demo=1">Открыть отдельный демосеанс ↗</a></div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
