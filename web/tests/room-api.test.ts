import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/room-chat/route';
const url = 'http://localhost:3000/api/room-chat';
test('local AI route refuses cross-origin and public requests and stays off without explicit configuration', async () => {
  const old = process.env.ROOM_LOCAL_AI_ENABLED; delete process.env.ROOM_LOCAL_AI_ENABLED;
  try {
    assert.equal((await (await GET(new Request(url))).json()).available, false);
    assert.equal((await POST(new Request(url, { method: 'POST', headers: { origin: 'https://other.example' } }))).status, 403);
    assert.equal((await POST(new Request(url, { method: 'POST', headers: { origin: 'http://localhost:3000' } }))).status, 503);
  } finally { if (old === undefined) delete process.env.ROOM_LOCAL_AI_ENABLED; else process.env.ROOM_LOCAL_AI_ENABLED = old; }
});
test('AI adapter validates input, uses only loopback, returns model response and handles offline failure', async () => {
  const oldEnabled = process.env.ROOM_LOCAL_AI_ENABLED, oldModel = process.env.ROOM_OLLAMA_MODEL, oldFetch = globalThis.fetch;
  process.env.ROOM_LOCAL_AI_ENABLED = '1'; process.env.ROOM_OLLAMA_MODEL = 'test-local-model';
  const request = (body: unknown) => new Request(url, { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const input = { resident: 'ally', input: 'Что дальше?', entries: [], history: [] };
    assert.equal((await POST(request({ ...input, resident: 'invalid' }))).status, 400);
    globalThis.fetch = (async (target, options) => {
      assert.equal(target, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(options?.body as string); assert.equal(body.stream, false); assert.equal(body.messages.at(-1).content, 'Что дальше?');
      return Response.json({ message: { content: 'Что для тебя сейчас важнее всего?' } });
    }) as typeof fetch;
    const response = await POST(request(input)); assert.equal(response.status, 200); assert.equal((await response.json()).text, 'Что для тебя сейчас важнее всего?');
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    assert.equal((await POST(request(input))).status, 502);
    process.env.ROOM_OLLAMA_MODEL = 'remote-cloud'; assert.equal((await POST(request(input))).status, 503);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnabled === undefined) delete process.env.ROOM_LOCAL_AI_ENABLED; else process.env.ROOM_LOCAL_AI_ENABLED = oldEnabled;
    if (oldModel === undefined) delete process.env.ROOM_OLLAMA_MODEL; else process.env.ROOM_OLLAMA_MODEL = oldModel;
  }
});
