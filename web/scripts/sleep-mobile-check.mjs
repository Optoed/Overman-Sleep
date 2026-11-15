import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), { chromium } = require(process.env.ROOM_PLAYWRIGHT_PACKAGE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); await page.goto('http://localhost:3000/?demo=1');
  const quick = page.getByRole('button', { name: 'Ложусь', exact: true }); await quick.waitFor();
  const box = await quick.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 844);
  await quick.click(); await page.getByRole('heading', { name: 'На сегодня достаточно.' }).waitFor(); assert.equal(await page.locator('canvas').count(), 0);
  await page.getByRole('button', { name: 'Утро', exact: true }).click(); await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); await page.getByRole('button', { name: 'Нажал случайно · отменить' }).click();
  await page.locator('[data-scene-status="ready"]').waitFor({ timeout: 60000 });
  await page.screenshot({ path: '../docs/sleep/mobile-quick-action.png', fullPage: true });
  assert.equal(await page.evaluate(() => localStorage.getItem('overman.sleep-tower.v1')), null);
  console.log('PASS: fixed mobile CTA fits viewport, starts night, opens morning form, cancels safely; personal data untouched');
} finally { await browser.close(); }
