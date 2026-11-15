import { canStand } from './room-collision';

/** Keep subtitles small enough to sit above a character on a phone. */
export function speechPages(text: string, limit = 170): string[] {
  const words = text.trim().split(/\s+/); const pages: string[] = []; let page = '';
  for (const word of words) {
    if ((page + ' ' + word).trim().length > limit && page) { pages.push(page); page = ''; }
    if (word.length > limit) { if (page) { pages.push(page); page = ''; } for (let i = 0; i < word.length; i += limit) pages.push(word.slice(i, i + limit)); }
    else page = page ? `${page} ${word}` : word;
  }
  if (page) pages.push(page); return pages.length ? pages : [''];
}
/** Approach only when the whole line to the viewpoint is clear of furniture. */
export function conversationView(from: { x: number; z: number }, person: { x: number; z: number }) {
  const dx = from.x - person.x, dz = from.z - person.z, distance = Math.hypot(dx, dz);
  if (distance < 2.35) return from;
  const to = { x: person.x + dx / distance * 2.35, z: person.z + dz / distance * 2.35 };
  for (let t = 0; t <= 1; t += .025) if (!canStand(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) return from;
  return to;
}
export function bubblePosition(x: number, y: number, width: number, height: number, bubbleWidth: number, bubbleHeight: number) {
  return { x: Math.max(bubbleWidth / 2 + 14, Math.min(width - bubbleWidth / 2 - 14, x)), y: Math.max(bubbleHeight + 62, Math.min(height - 195, y)) };
}
