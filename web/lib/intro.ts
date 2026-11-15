export const INTRO_STORAGE_KEY = 'overman.intro.seen.v1';
export const LOAD_DURATION = 7600;
export const STALL_DURATION = 3000;
export const MAX_ESCAPES = 6;

export function loadingProgress(elapsed: number): number {
  if (elapsed >= LOAD_DURATION) return 99;
  const time = Math.max(0, elapsed) / LOAD_DURATION;
  return Math.min(98, Math.floor(99 * (1 - Math.pow(1 - time, 1.65))));
}

export type Point = { x: number; y: number };
export function escapePosition(viewport: { width: number; height: number }, button: { width: number; height: number },
  pointer: Point, previous?: Point, random = Math.random): Point {
  // Keep clear of the sound/skip controls and browser safe-area edges.
  const left = 18;
  const top = Math.min(100, viewport.height * .18);
  const right = Math.max(left, viewport.width - button.width - 18);
  const bottom = Math.max(top, viewport.height - button.height - 85);
  let winner = { x: left, y: top }, best = -Infinity;
  for (let i = 0; i < 24; i++) {
    const candidate = { x: left + random() * (right - left), y: top + random() * (bottom - top) };
    const fromPointer = Math.hypot(candidate.x + button.width / 2 - pointer.x, candidate.y + button.height / 2 - pointer.y);
    const fromPrevious = previous ? Math.hypot(candidate.x - previous.x, candidate.y - previous.y) : 0;
    const score = fromPointer + fromPrevious * .3;
    if (score > best) { best = score; winner = candidate; }
  }
  return { x: Math.round(winner.x), y: Math.round(winner.y) };
}

export function introWasSeen(): boolean {
  try { return window.localStorage.getItem(INTRO_STORAGE_KEY) === '1'; } catch { return false; }
}
export function markIntroSeen() {
  try { window.localStorage.setItem(INTRO_STORAGE_KEY, '1'); } catch { /* Private browsing must not block entry. */ }
}
