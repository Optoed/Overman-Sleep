import { ArrowRight, Check, Coins, Hammer, Sparkles, Trophy, Zap } from 'lucide-react';
import { DISTRICTS, type City, type DistrictId } from './city-state';
import { buyUpgrade, claimQuest, ENERGY_COST, QUESTS, startConstruction, UPGRADES } from './city-game';
import s from './city.module.css';

export function ConstructionStatus({ city, id, now }: { city: City; id: DistrictId; now: number }) {
  const job = city.game.jobs.find(j => j.district === id); if (!job) return null;
  const progress = Math.max(0, Math.min(100, (now - job.start) / (job.end - job.start) * 100));
  return <div className={s.job}><div><Hammer size={15} /><strong>Бригада строит</strong><span>{Math.max(0, Math.ceil(Math.min(job.end - job.start, job.end - now) / 1000))} сек</span></div><div className={s.progress}><i style={{ width: `${progress}%` }} /></div><small>+1 шаг строительства · ремонт +10</small></div>;
}

export function EnergyPanel({ city, now, change, select, demo }: { city: City; now: number; change: (fn: (c: City) => City) => void; select: (id: DistrictId) => void; demo: boolean }) {
  return <>
    <div className={s.energySummary}><span className={s.bigBolt}><Zap size={36} fill="currentColor" /></span><div><strong>{city.game.energy}<small> / 500</small></strong><p>энергии в запасе</p></div></div>
    <div className={s.energyRules}><span>1 минута вне города = <b>1 энергия</b></span><span>Одна стройка = <b>20 энергии</b></span></div>
    {city.game.lastHarvest > 0 && <p className={s.harvest}><Sparkles size={16} />Последнее возвращение принесло +{city.game.lastHarvest} энергии!</p>}
    <h3 className={s.subheading}>Куда отправим бригаду?</h3>
    <div className={s.energyBuildings}>{DISTRICTS.map(d => {
      const district = city.districts[d.id], job = city.game.jobs.find(j => j.district === d.id), maxed = district.xp >= 15 && district.damage === 0;
      return <div key={d.id}><div className={s.energyBuildingName}><i style={{ background: d.color }} /><button onClick={() => select(d.id)}>{d.building}</button><small>{district.xp}/15</small></div>
        {job ? <ConstructionStatus city={city} id={d.id} now={now} /> : <button aria-label={`Строить: ${d.building}, 20 энергии`} className={s.energyBuildButton} disabled={city.game.energy < ENERGY_COST || maxed} onClick={() => change(c => startConstruction(c, d.id, Date.now()))}><Hammer size={14} /><span>{maxed ? 'Полностью построено' : district.damage ? 'Стройка + ремонт' : district.xp ? 'Продолжить стройку' : 'Заложить здание'}</span><b><Zap size={12} fill="currentColor" />20</b></button>}
      </div>;
    })}</div>
    {city.game.energy < ENERGY_COST && <p className={s.warning}>Нужно ещё {ENERGY_COST - city.game.energy} энергии. Вернись после отдыха или выполни поручение жителей.</p>}
    <p className={s.help}>Энергия начисляется при возвращении, за полные минуты отсутствия, максимум за 8 часов. Веб-версия учитывает время вне этого приложения, а не использование всего телефона. Энергия помогает строить, но не отмечает привычки за тебя.</p>
    {demo && <button className={s.demoEnergy} onClick={() => change(c => ({ ...c, game: { ...c.game, energy: Math.min(500, c.game.energy + 60), lastHarvest: Math.min(60, 500 - c.game.energy) } }))}>Демо: вернуться после часа отдыха · +60<Zap size={14} /></button>}
  </>;
}

export function DevelopmentPanel({ city, change }: { city: City; change: (fn: (c: City) => City) => void }) {
  const total = DISTRICTS.reduce((n, d) => n + city.districts[d.id].xp, 0);
  const remaining = 7 - total % 7;
  return <><h2>Городу есть<br /><span>куда расти!</span></h2><p className={s.muted}>Выполняй поручения, собирай награды и открывай новые места.</p>
    <div className={s.nextLevel}><Trophy size={17} /><span>{total >= 105 ? 'Все районы достигли максимума!' : `Следующий уровень через ${remaining} ${remaining === 1 ? 'шаг' : remaining < 5 ? 'шага' : 'шагов'} строительства`}</span></div>
    <div className={s.sectionLabel}><Trophy size={16} />Поручения жителей<span>{city.game.claimed.length}/{QUESTS.length}</span></div>
    <div className={s.quests}>{QUESTS.map((q, i) => { const progress = Math.min(q.goal, q.progress(city)), claimed = city.game.claimed.includes(q.id), done = progress >= q.goal;
      return <article key={q.id} className={claimed ? s.questClaimed : ''}><div className={s.questTop}><span className={s.questAvatar}>{['👷', '👩‍🌾', '🧑‍🔧', '👩‍🎨', '🧑‍🚒'][i]}</span><div><small>{q.person}</small><h3>{q.name}</h3></div>{claimed && <Check size={16} />}</div><p>{q.text}</p>
        <div className={s.questProgress}><div className={s.progress}><i style={{ width: `${progress / q.goal * 100}%` }} /></div><span>{progress}/{q.goal}</span></div>
        <div className={s.questBottom}><span><Coins size={13} />{q.coins}<Zap size={13} />{q.energy}</span><button disabled={!done || claimed} onClick={() => change(c => claimQuest(c, q.id))}>{claimed ? 'Получено' : done ? 'Забрать' : 'В процессе'}{done && !claimed && <ArrowRight size={13} />}</button></div>
      </article>;
    })}</div>
    <div className={s.sectionLabel}><Sparkles size={16} />Новые места<span><Coins size={13} />{city.game.coins}</span></div>
    <div className={s.upgrades}>{UPGRADES.map(u => { const owned = city.game.upgrades.includes(u.id); return <article key={u.id}><span className={s.upgradeIcon}>{u.icon}</span><div><h3>{u.name}</h3><p>{u.description}</p><button disabled={owned || city.game.coins < u.cost} onClick={() => change(c => buyUpgrade(c, u.id))}>{owned ? <><Check size={14} />Построено</> : <><Coins size={14} />{u.cost} · {city.game.coins < u.cost ? `ещё ${u.cost - city.game.coins}` : 'Построить'}</>}</button></div></article>; })}</div>
  </>;
}
