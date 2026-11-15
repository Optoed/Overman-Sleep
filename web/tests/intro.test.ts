import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapePosition, loadingProgress, LOAD_DURATION, INTRO_STORAGE_KEY, introWasSeen, markIntroSeen } from '../lib/intro.ts';

test('cinematic loading is monotonic and stays at 99 until interaction', () => {
  let previous = 0;
  for (let time = 0; time <= LOAD_DURATION; time += 60) {
    const next = loadingProgress(time);
    assert.ok(next >= previous && next <= 99);
    previous = next;
  }
  assert.equal(loadingProgress(-100), 0);
  assert.equal(loadingProgress(LOAD_DURATION), 99);
  assert.equal(loadingProgress(100000), 99);
});

test('escaping button stays reachable on small phones, landscape and desktop', () => {
  for (const viewport of [{width:320,height:568}, {width:390,height:844}, {width:844,height:390}, {width:1440,height:900}]) {
    let previous = { x: 20, y: 180 };
    const button = { width: 248, height: 58 };
    for (let i = 0; i < 100; i++) {
      const point = escapePosition(viewport, button, { x: previous.x + 124, y: previous.y + 29 }, previous);
      assert.ok(point.x >= 18 && point.x + button.width <= viewport.width - 18);
      assert.ok(point.y >= Math.min(100, viewport.height * .18) - 1);
      assert.ok(point.y + button.height <= viewport.height - 85 + 1);
      previous = point;
    }
  }
});

test('first-visit marker is optional and blocked storage never prevents entry', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const memory = new Map<string,string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  } } });
  assert.equal(introWasSeen(), false); markIntroSeen();
  assert.equal(memory.get(INTRO_STORAGE_KEY), '1'); assert.equal(introWasSeen(), true);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('storage disabled'); } } });
  assert.doesNotThrow(markIntroSeen); assert.equal(introWasSeen(), false);
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis, 'window');
});
