import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), { chromium } = require(process.env.ROOM_PLAYWRIGHT_PACKAGE || 'playwright');
const out = resolve('../docs/room'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let page; const errors = [], metrics = []; let expectedFailures = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => {
    if (m.type() !== 'error') return;
    if (m.text().includes('502') && m.location().url.includes('/api/room-chat')) { expectedFailures++; return; }
    if (!m.text().includes('404')) errors.push(m.text());
  });
  // Simulates the documented server boundary; never contacts a real AI provider.
  await page.route('**/api/room-chat', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, label: 'Тестовый провайдер' } });
    const request = route.request().postDataJSON();
    if (request.input === 'ошибка') return route.fulfill({ status: 502, json: { error: 'Тестовая ошибка провайдера. Сообщение не потеряно.' } });
    return route.fulfill({ json: { text: 'Ты говоришь, что боишься показывать проект. Давай отделим качество проекта от страха чужой оценки. Первый показ не обязан доказывать, что всё идеально. Он помогает понять, что стоит изменить. Что ты хотел бы узнать от человека, которому покажешь результат?' } });
  });
  await page.goto('http://localhost:3000/room?demo=1'); await page.locator('canvas[data-room-rendered="true"]').waitFor();
  await page.waitForTimeout(2200);
  metrics.push(await page.locator('canvas').evaluate(c => ({ phase: 'idle', ...c.dataset })));
  await page.screenshot({ path: resolve(out, 'upgraded-room.png'), fullPage: true });
  await page.getByRole('button', { name: 'Демо · отдельно' }).click();
  await page.getByRole('checkbox', { name: /Разрешаю передавать/ }).check();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  for (const [id, name] of [['skeptic', 'Скептик'], ['ally', 'Союзник'], ['rebel', 'Бунтарь']]) {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await page.locator(`canvas[data-focused-resident="${id}"]`).waitFor();
    await page.waitForTimeout(1300);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('dialog').evaluate(dialog => dialog.contains(document.activeElement)), true, 'Keyboard focus stays inside the conversation');
    }
    await page.getByLabel('Сообщение жителю').fill('Боюсь показывать проект.');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    const reveal = page.getByRole('button', { name: 'Показать целиком' }); if (await reveal.isVisible()) await reveal.click();
    await page.locator('[data-speech-resident] p[aria-hidden="true"]').filter({ hasText: 'Ты говоришь' }).waitFor();
    const bubble = await page.locator('[data-speech-resident]').boundingBox(); assert.ok(bubble.x >= 0 && bubble.y >= 0 && bubble.x + bubble.width <= 1440 && bubble.y + bubble.height < 760);
    await page.screenshot({ path: resolve(out, `conversation-${id}.png`) });
    metrics.push(await page.locator('canvas').evaluate(c => ({ phase: 'conversation', ...c.dataset })));
    await page.getByRole('button', { name: 'Дальше →' }).click();
    await page.getByRole('button', { name: 'История разговора' }).click();
    await page.getByRole('dialog').getByText('Боюсь показывать проект.', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Скрыть историю' }).click();
    await page.getByLabel('Сообщение жителю').fill('ошибка'); await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor(); assert.equal(await page.getByLabel('Сообщение жителю').inputValue(), 'ошибка');
    await page.keyboard.press('Escape'); await page.locator('canvas[data-focused-resident=""]').waitFor();
  }
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  page = await mobile.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3000/room?demo=1'); await page.locator('canvas[data-room-rendered="true"]').waitFor();
  await page.getByRole('button', { name: /^Союзник/ }).click(); await page.locator('canvas[data-focused-resident="ally"]').waitFor();
  const bubble = await page.locator('[data-speech-resident]').boundingBox(), input = await page.getByLabel('Сообщение жителю').boundingBox();
  assert.ok(bubble.x >= 0 && bubble.x + bubble.width <= 390 && bubble.y >= 0); assert.ok(bubble.y + bubble.height < input.y);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: resolve(out, 'conversation-mobile.png') });
  await page.getByRole('button', { name: 'Закончить разговор' }).click();
  assert.deepEqual(errors, []); assert.equal(expectedFailures, 3, 'Each simulated provider failure must be handled');
  await writeFile(resolve(out, 'conversation-check.json'), JSON.stringify({ errors, metrics, note: 'Headless Edge on this computer; mocked AI; physical-phone performance not measured.' }, null, 2));
  console.log(JSON.stringify({ errors, metrics }, null, 2));
} catch (e) { if (page && !page.isClosed()) await page.screenshot({ path: resolve(out, 'conversation-failure.png') }); throw e; }
finally { await browser.close(); }
