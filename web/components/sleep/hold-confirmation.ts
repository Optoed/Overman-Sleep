/** One uninterrupted input owns a gesture. Times must come from performance.now(). */
export class HoldConfirmation {
  private owner: string | null = null;
  private started = 0;
  private completed = false;
  begin(input: string, now: number): boolean {
    if (this.owner !== null) return false;
    this.owner = input;
    this.started = now;
    this.completed = false;
    return true;
  }
  owns(input: string): boolean { return this.owner === input; }
  cancel(input?: string): boolean {
    if (input !== undefined && !this.owns(input)) return false;
    this.owner = null;
    this.completed = false;
    return true;
  }
  progress(now: number): number {
    return this.owner === null ? 0 : Math.max(0, Math.min(1, (now - this.started) / 3000));
  }
  complete(now: number): boolean {
    if (this.owner === null || this.completed || now - this.started < 3000) return false;
    this.completed = true;
    return true;
  }
}
