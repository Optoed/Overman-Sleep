/** Hysteresis prevents oscillation while letting small GPUs reduce pixel fill cost. */
export class RoomRenderBudget {
  private count = 0;
  private elapsed = 0;
  private slowWindows = 0;
  scale: number;
  constructor(deviceScale: number) { this.scale = Math.min(1.5, Math.max(1, deviceScale)); }
  sample(ms: number): number | null {
    if (ms <= 0 || ms > 150) return null;
    this.count++; this.elapsed += ms;
    if (this.count < 120) return null;
    const mean = this.elapsed / this.count; this.count = 0; this.elapsed = 0;
    this.slowWindows = mean > 28 ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2 || this.scale <= .8) return null;
    this.slowWindows = 0; this.scale = Math.max(.8, this.scale - .2); return this.scale;
  }
}
