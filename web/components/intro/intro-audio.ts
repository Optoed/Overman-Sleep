// Original synthesized character blips. No game recordings or external audio.
export class IntroAudio {
  private context: AudioContext | null = null;
  private enabled = false;
  private lastNote = 0;

  async enable() {
    try {
      if (!this.context) this.context = new AudioContext();
      if (this.context.state === 'suspended') await this.context.resume();
      this.enabled = this.context.state === 'running';
    } catch { this.enabled = false; }
    return this.enabled;
  }
  mute() { this.enabled = false; }
  blip(character = 0, escaped = false) {
    const context = this.context;
    if (!context || !this.enabled || context.state !== 'running') return;
    const now = context.currentTime;
    if (!escaped && now - this.lastNote < .045) return;
    this.lastNote = now;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(escaped ? 520 : 145 + character % 5 * 21, now);
    if (escaped) oscillator.frequency.exponentialRampToValueAtTime(100, now + .11);
    filter.type = 'lowpass'; filter.frequency.value = 1600;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(.022, now + .004);
    gain.gain.exponentialRampToValueAtTime(.0001, now + (escaped ? .12 : .038));
    oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
    oscillator.start(now); oscillator.stop(now + (escaped ? .13 : .045));
  }
  dispose() {
    this.enabled = false;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
}
