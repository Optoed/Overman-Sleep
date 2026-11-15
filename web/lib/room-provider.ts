import { aiMessages, type ChatInput } from './room-ai';
type Provider = { kind: 'compatible' | 'ollama'; url: string; model: string; key?: string; label: string };
export function roomProvider(): Provider | null {
  if (process.env.ROOM_AI_ENABLED === '1') {
    const model = process.env.ROOM_AI_MODEL?.trim(), key = process.env.ROOM_AI_KEY?.trim();
    if (!model || model.length > 200 || !key || !process.env.ROOM_AI_CHAT_URL) return null;
    try {
      const url = new URL(process.env.ROOM_AI_CHAT_URL);
      if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) return null;
      return { kind: 'compatible', url: url.href, model, key, label: process.env.ROOM_AI_LABEL?.slice(0, 80) || 'Твой AI-провайдер' };
    } catch { return null; }
  }
  if (process.env.ROOM_LOCAL_AI_ENABLED === '1' && process.env.ROOM_OLLAMA_MODEL && !/cloud/i.test(process.env.ROOM_OLLAMA_MODEL)) return { kind: 'ollama', url: 'http://127.0.0.1:11434/api/chat', model: process.env.ROOM_OLLAMA_MODEL, label: 'Локальная модель' };
  return null;
}
export async function providerReply(provider: Provider, input: ChatInput, signal: AbortSignal) {
  const response = await fetch(provider.url, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}) },
    body: JSON.stringify(provider.kind === 'ollama'
      ? { model: provider.model, messages: aiMessages(input), stream: false, options: { num_predict: 500 } }
      : { model: provider.model, messages: aiMessages(input), stream: false, max_tokens: 500 }),
  });
  if (!response.ok || !response.body) throw new Error('provider');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let raw = '', bytes = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 524288) { await reader.cancel(); throw new Error('response too large'); } raw += decoder.decode(part.value, { stream: true }); } raw += decoder.decode(); } finally { reader.releaseLock(); }
  const result = JSON.parse(raw);
  const text = provider.kind === 'ollama' ? result?.message?.content : result?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty');
  return text.trim().slice(0, 4000);
}
