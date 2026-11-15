import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ROOM_PLAYWRIGHT_PACKAGE || 'playwright');
const out = resolve('../docs/graphics/tower-100');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], samples = [];
try {
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3000/?demo=1&floors=100');
    await page.getByText('Башня · 100 этажей', { exact: true }).waitFor();
    await page.locator('[data-scene-status="ready"]').waitFor({ timeout: 60000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('overman.sleep-tower.v1')), null);
    for (const [view, button] of [['overview', 'Показать всю башню'], ['top', 'Подняться к вершине'], ['home', 'Спуститься к острову']]) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await page.waitForTimeout(3500);
      await page.screenshot({ path: resolve(out, `${viewport.width}-${view}.png`), fullPage: true });
      samples.push({ viewport, view, stats: await page.locator('[data-scene-status="ready"]').evaluate(el => ({ ...el.dataset })) });
    }
    await page.getByRole('button', { name: /Посмотреть развитие башни/ }).click();
    await page.getByRole('button', { name: '24 этажа', exact: true }).click();
    await page.getByText('Башня · 24 этажа', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Посмотреть развитие башни/ }).click();
    await page.getByRole('button', { name: '100 этажей', exact: true }).click();
    await page.getByText('Башня · 100 этажей', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('Башня · 100 этажей', { exact: true }).waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'checks.json'), JSON.stringify({ errors, samples }, null, 2));
  console.log(JSON.stringify({ errors, views: samples.map(({ viewport, view }) => ({ width: viewport.width, view })) }));
} finally { await browser.close(); }
