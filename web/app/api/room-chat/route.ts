import { boundedBody, localOrigin, validateChatInput } from '@/lib/room-ai';
import { providerReply, roomProvider } from '@/lib/room-provider';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
let running = false, windowStart = 0, attempts = 0;
export async function GET(request: Request) {
  const provider = roomProvider();
  return Response.json({ available: !!provider && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname), label: provider?.label ?? 'AI не подключён', external: provider?.kind === 'compatible' }, { headers });
}
export async function POST(request: Request) {
  if (!localOrigin(request)) return Response.json({ error: 'AI доступен только из локального кабинета на этом компьютере.' }, { status: 403, headers });
  const provider = roomProvider();
  if (!provider) return Response.json({ error: 'AI-провайдер не настроен. Подключи его в настройках сервера; локальный деморежим остаётся доступным.' }, { status: 503, headers });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Ожидается JSON.' }, { status: 415, headers });
  if (Date.now() - windowStart > 60000) { windowStart = Date.now(); attempts = 0; }
  if (running || attempts >= 8) return Response.json({ error: 'Модель занята. Подожди немного и повтори.' }, { status: 429, headers });
  attempts++;
  let value: unknown; try { value = await boundedBody(request, 120000); } catch { return Response.json({ error: 'Сообщение слишком большое или повреждено.' }, { status: 400, headers }); }
  const input = validateChatInput(value); if (!input) return Response.json({ error: 'Проверь сообщение и записи.' }, { status: 400, headers });
  if (running) return Response.json({ error: 'Модель занята. Попробуй чуть позже.' }, { status: 429, headers });
  running = true;
  const timeout = AbortSignal.timeout(45000), signal = AbortSignal.any([timeout, request.signal]);
  try {
    const text = await providerReply(provider, input, signal);
    return Response.json({ text }, { headers });
  } catch { return Response.json({ error: 'Модель не ответила. Проверь подключение провайдера или попробуй позже. Сообщение осталось в поле.' }, { status: 502, headers }); }
  finally { running = false; }
}
