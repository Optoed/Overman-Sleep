import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechPages, conversationView, bubblePosition } from '../components/room/conversation';
import { RoomRenderBudget } from '../components/room/room-render-budget';
import { canStand } from '../components/room/room-collision';
import { roomProvider, providerReply } from '../lib/room-provider';

test('overhead dialogue pages retain all words and bound very long unbroken input', () => {
  const text = 'Это важная мысль, которую хочется обсудить спокойно. '.repeat(15).trim();
  const pages = speechPages(text); assert.ok(pages.length > 1); assert.equal(pages.join(' '), text); assert.ok(pages.every(p => p.length <= 170));
  assert.ok(speechPages('я'.repeat(400)).every(p => p.length <= 170)); assert.deepEqual(speechPages(''), ['']);
});
test('conversation camera never approaches through furniture and subtitles stay in frame', () => {
  const from = { x: 0, z: 3.1 }; const target = conversationView(from, { x: .8, z: -2.7 }); assert.ok(canStand(target.x, target.z)); assert.ok(target.z < from.z);
  const obstructed = { x: -2.5, z: 0 }; assert.deepEqual(conversationView(obstructed, { x: -2.5, z: -5 }), obstructed);
  for (const x of [-500, 0, 195, 900]) { const point = bubblePosition(x, 330, 390, 844, 354, 180); assert.ok(point.x >= 191 && point.x <= 199); assert.ok(point.y >= 242 && point.y <= 649); }
});
test('adaptive pixel budget ignores isolated stalls and only reduces after sustained slow rendering', () => {
  const fast = new RoomRenderBudget(2); for (let i = 0; i < 500; i++) assert.equal(fast.sample(i === 40 ? 900 : 16.7), null); assert.equal(fast.scale, 1.5);
  const slow = new RoomRenderBudget(2); let reductions = 0; for (let i = 0; i < 1500; i++) if (slow.sample(38) !== null) reductions++;
  assert.ok(reductions > 0); assert.equal(slow.scale, .8);
});
test('external provider is server-configured, redirects disabled and key stays in request header', async () => {
  const keys = ['ROOM_AI_ENABLED', 'ROOM_AI_CHAT_URL', 'ROOM_AI_MODEL', 'ROOM_AI_KEY', 'ROOM_AI_LABEL'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]])); const oldFetch = globalThis.fetch;
  try {
    process.env.ROOM_AI_ENABLED = '1'; process.env.ROOM_AI_MODEL = 'unit-test-model'; process.env.ROOM_AI_KEY = 'test-secret-not-real'; process.env.ROOM_AI_CHAT_URL = 'https://provider.example/v1/chat/completions';
    const provider = roomProvider(); assert.ok(provider); assert.equal(provider.kind, 'compatible');
    globalThis.fetch = (async (url, init) => { assert.equal(url, process.env.ROOM_AI_CHAT_URL); assert.equal(init?.redirect, 'error'); assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-secret-not-real'); assert.ok(!String(init?.body).includes('test-secret-not-real')); return Response.json({ choices: [{ message: { content: 'Давай разберём это вместе.' } }] }); }) as typeof fetch;
    assert.equal(await providerReply(provider, { resident: 'ally', input: 'Привет', entries: [], history: [] }, new AbortController().signal), 'Давай разберём это вместе.');
    process.env.ROOM_AI_CHAT_URL = 'http://public.example/chat'; assert.equal(roomProvider(), null);
    process.env.ROOM_AI_CHAT_URL = 'https://name:secret@provider.example/chat'; assert.equal(roomProvider(), null);
    process.env.ROOM_AI_CHAT_URL = 'https://provider.example/chat'; delete process.env.ROOM_AI_KEY; assert.equal(roomProvider(), null);
  } finally { globalThis.fetch = oldFetch; for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});
