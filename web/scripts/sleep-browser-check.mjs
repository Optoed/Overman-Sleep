import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), { chromium } = require(process.env.ROOM_PLAYWRIGHT_PACKAGE || 'playwright');
const out = resolve('../docs/sleep'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], checks = []; let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'Europe/Moscow', reducedMotion: 'reduce' });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3000/?demo=1'); await page.locator('[data-scene-status="ready"]').waitFor({ timeout: 60000 });
  await page.evaluate(() => { localStorage.setItem('overman.living-tower.v1', 'personal-island-untouched'); localStorage.setItem('overman.private-room.v1', 'personal-room-untouched'); });
  for (const stage of [0, 4, 12, 24]) {
    await page.getByRole('button', { name: /Посмотреть развитие башни/ }).click();
    await page.getByRole('button', { name: stage === 0 ? 'Начало' : `${stage} ${stage === 4 || stage === 24 ? 'этажа' : 'этажей'}`, exact: true }).click();
    await page.locator('[data-scene-status="ready"]').waitFor();
    if (stage) await page.getByRole('button', { name: 'Показать всю башню' }).click();
    for (const weather of ['sun', 'sunset', 'rain']) {
      await page.getByRole('button', { name: 'Настройки', exact: true }).click(); await page.getByLabel('Погода', { exact: true }).selectOption(weather); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await page.waitForTimeout(1800); await page.screenshot({ path: resolve(out, `tower-${stage}-${weather}.png`), fullPage: true });
    }
  }
  checks.push('0/4/12/24 floors and sun/sunset/rain inspected in isolated demo');
  await page.getByRole('button', { name: /Посмотреть развитие башни/ }).click(); await page.getByRole('button', { name: 'Начало', exact: true }).click();
  await page.getByRole('button', { name: 'Ложусь спать', exact: true }).click(); await page.getByRole('heading', { name: 'На сегодня достаточно.' }).waitFor();
  assert.equal(await page.locator('canvas').count(), 0);
  await page.reload(); await page.getByRole('heading', { name: 'На сегодня достаточно.' }).waitFor();
  await page.screenshot({ path: resolve(out, 'night.png'), fullPage: true });
  await page.getByRole('button', { name: 'Нажал случайно · отменить' }).click();
  checks.push('bedtime survives reload, stops 3D rendering, can be cancelled without rewards');
  const nights = await page.evaluate(() => {
    const stamp = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return Array.from({ length: 7 }, (_, i) => { const w = new Date(); w.setDate(w.getDate() - 7 + i); w.setHours(7,30,0,0); const b = new Date(w); b.setDate(b.getDate()-1); b.setHours(23,0,0,0); return { bed: stamp(b), wake: stamp(w) }; });
  });
  for (const n of nights) {
    await page.getByRole('button', { name: 'Записать прошедшую ночь' }).click(); await page.getByLabel('Лёг в кровать').fill(n.bed); await page.getByLabel('Проснулся', { exact: true }).fill(n.wake); await page.getByLabel('Сколько примерно спал, часов').fill('8'); await page.getByRole('button', { name: 'Сохранить ночь' }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.getByText('Башня · 1 этаж', { exact: true }).waitFor();
  let saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('overman.sleep-tower.v1.demo')));
  assert.equal(saved.credits.length, 7); assert.equal(saved.garden, true); assert.equal(saved.nights.length, 7);
  await page.getByRole('button', { name: 'Исправить запись', exact: false }).click(); await page.getByLabel('Сколько примерно спал, часов').fill('30');
  await page.getByRole('button', { name: 'Сохранить ночь' }).click(); assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.getByLabel('Сколько примерно спал, часов').fill('5'); await page.getByRole('button', { name: 'Сохранить ночь' }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload(); await page.getByText('Башня · 1 этаж', { exact: true }).waitFor();
  saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('overman.sleep-tower.v1.demo'))); assert.equal(saved.credits.length, 7); assert.equal(saved.nights.length, 7); assert.equal(saved.nights[0].success, false);
  assert.equal(await page.evaluate(() => localStorage.getItem('overman.living-tower.v1')), 'personal-island-untouched'); assert.equal(await page.evaluate(() => localStorage.getItem('overman.private-room.v1')), 'personal-room-untouched');
  checks.push('seven nights unlock floor and garden; correction persists without losing/farming rewards; personal data untouched');
  await page.screenshot({ path: resolve(out, 'earned-floor.png'), fullPage: true });
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Moscow', reducedMotion: 'reduce' });
  page = await mobile.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3000/'); await page.getByRole('button', { name: 'Настроить мой режим', exact: true }).click();
  await page.getByLabel('Ложусь в', { exact: true }).fill('23:30'); await page.getByLabel('Встаю в', { exact: true }).fill('08:00'); await page.getByRole('button', { name: 'Сохранить режим' }).click();
  await page.locator('[data-scene-status="ready"]').waitFor({ timeout: 60000 }); await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Записать прошедшую ночь' }).click(); await page.screenshot({ path: resolve(out, 'mobile-morning.png') });
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); await page.reload(); await page.getByRole('button', { name: 'Ложусь спать', exact: true }).waitFor();
  const personal = await page.evaluate(() => JSON.parse(localStorage.getItem('overman.sleep-tower.v1'))); assert.equal(personal.schedule.bed, '23:30');
  checks.push('mobile setup, modal, no horizontal overflow, persisted schedule');
  await mobile.close();
  const migrated = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Moscow', reducedMotion: 'reduce' });
  const oldWorld = { ...saved.world, xp: 350 }, original = JSON.stringify(oldWorld);
  await migrated.addInitScript(raw => { if (location.origin === 'http://localhost:3000' && !localStorage.getItem('overman.living-tower.v1')) localStorage.setItem('overman.living-tower.v1', raw); }, original);
  page = await migrated.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-11T22:40:00+03:00'));
  await page.goto('http://localhost:3000/'); await page.getByText('Башня · 3 этажа', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Настроить мой режим', exact: true }).click(); await page.getByRole('button', { name: 'Сохранить режим' }).click();
  await page.getByText('До твоего времени сна 20 мин.', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('overman.living-tower.v1')), original);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('overman.sleep-tower.v1')).world.xp), 350);
  checks.push('original island migration preserves floors and exact old data; in-app bedtime reminder at 30-minute window');
  assert.deepEqual(errors, []); await writeFile(resolve(out, 'browser-check.json'), JSON.stringify({ checks, errors }, null, 2)); console.log(JSON.stringify({ checks, errors }, null, 2));
} catch(e) { if (page && !page.isClosed()) await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw e; }
finally { await browser.close(); }
