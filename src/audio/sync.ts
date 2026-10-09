/*
 * Playback clock / sync logic (pure, testable).
 *
 * Tracks playback position against the AudioContext clock so the cone
 * simulation stays synchronized across play / pause / resume / seek.
 */
export class SyncClock {
  private startCtxTime = 0;   // ctx.currentTime when playback (re)started
  private startOffset = 0;    // buffer offset at (re)start (s)
  private playing = false;
  private rate = 1;
  /** latest displacement message from the worklet */
  sample: { x: number; v: number; t: number } | null = null;

  play(ctxTime: number, offset: number, rate = 1): void {
    this.startCtxTime = ctxTime;
    this.startOffset = Math.max(0, offset);
    this.playing = true;
    this.rate = Math.max(0.01, rate);
  }

  pause(ctxTime: number): number {
    const off = this.offset(ctxTime);
    this.playing = false;
    this.startOffset = off;
    return off;
  }

  seek(ctxTime: number, offset: number): void {
    if (this.playing) this.play(ctxTime, offset, this.rate);
    else this.startOffset = Math.max(0, offset);
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.01, rate);
  }

  get isPlaying(): boolean { return this.playing; }

  offset(ctxTime: number): number {
    if (!this.playing) return this.startOffset;
    return this.startOffset + (ctxTime - this.startCtxTime) * this.rate;
  }

  /** Feed the latest worklet displacement message. */
  pushSample(x: number, v: number, t: number): void {
    this.sample = { x, v, t };
  }

  /**
   * Render-time displacement: extrapolate from the newest worklet message
   * using velocity — keeps the cone smooth between message arrivals and
   * inherently locked to the audio clock (same timebase). The horizon is
   * ~2 worklet message periods (~10.7 ms apart): long enough to bridge
   * jitter, short enough that velocity extrapolation cannot visibly
   * overshoot the true trajectory at low frequencies. The engine further
   * clamps the result to the mechanical envelope.
   */
  renderDisplacement(ctxTime: number, dtMax = 0.022): number {
    if (!this.sample) return 0;
    const dt = Math.min(Math.max(ctxTime - this.sample.t, 0), dtMax);
    return this.sample.x + this.sample.v * dt;
  }

  /** Sync health: false if no message for too long while playing. */
  healthy(ctxTime: number, window = 0.5): boolean {
    if (!this.sample) return false;
    if (!this.playing) return true;
    return ctxTime - this.sample.t < window;
  }
}
