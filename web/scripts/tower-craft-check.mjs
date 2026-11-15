import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), { chromium } = require(process.env.ROOM_PLAYWRIGHT_PACKAGE || 'playwright');
const out = resolve('../docs/graphics/craft'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], samples = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3000/?demo=1');
  await page.locator('[data-scene-status="ready"]').waitFor({ timeout: 60000 });
  for (const stage of [0, 4, 12, 24]) {
    await page.getByRole('button', { name: /Посмотреть развитие башни/ }).click();
    await page.getByRole('button', { name: stage === 0 ? 'Начало' : `${stage} ${stage === 4 || stage === 24 ? 'этажа' : 'этажей'}`, exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Подняться к вершине' }).click();
    await page.getByRole('button', { name: 'Приблизить', exact: true }).click({ clickCount: 3, delay: 200 });
    await page.waitForTimeout(2200);
    for (const weather of ['sun', 'sunset', 'rain']) {
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByLabel('Погода', { exact: true }).selectOption(weather);
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await page.waitForTimeout(1800);
      await page.screenshot({ path: resolve(out, `top-${stage}-${weather}.png`) });
    }
    await page.getByRole('button', { name: 'Спуститься к острову' }).click();
    await page.getByRole('button', { name: 'Приблизить', exact: true }).click({ clickCount: 4, delay: 200 });
    await page.waitForTimeout(1800); await page.screenshot({ path: resolve(out, `island-${stage}.png`) });
    const stats = await page.locator('[data-scene-status="ready"]').evaluate(e => ({ ...e.dataset }));
    assert.equal(stats.sceneNavViolations, '0'); samples.push({ stage, stats });
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'checks.json'), JSON.stringify({ errors, samples }, null, 2));
  console.log(JSON.stringify({ errors, samples }, null, 2));
} finally { await browser.close(); }
