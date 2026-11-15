export type Obstacle = { x: number; z: number; w: number; d: number };
export const OBSTACLES: Obstacle[] = [
  { x: -2.5, z: -2.5, w: 2.9, d: 1.25 }, // desk
  { x: -4.55, z: -.3, w: .7, d: 3.4 }, // bookcase
  { x: 3.25, z: -2.5, w: 2.15, d: 1.25 }, // sofa
  { x: 2.6, z: -.9, w: 1.3, d: .75 }, // tea table
  { x: -3.4, z: 1.5, w: .65, d: .65 },
  { x: 2.5, z: .7, w: .65, d: .65 },
  { x: .8, z: -2.7, w: .65, d: .65 },
];
export function canStand(x: number, z: number) {
  const r = .27;
  return Math.abs(x) < 4.7 - r && Math.abs(z) < 3.7 - r && !OBSTACLES.some(o => Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r);
}
export function movePlayer(x: number, z: number, dx: number, dz: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .1));
  for (let i = 0; i < steps; i++) { if (canStand(x + dx / steps, z)) x += dx / steps; if (canStand(x, z + dz / steps)) z += dz / steps; }
  return { x, z };
}
