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
   * Render-time displacement from the newest worklet message.
   *
   * The velocity extrapolation horizon is deliberately TINY (~3 ms): its only
   * job is to bridge jitter between the ~10.7 ms worklet messages. Bridges
   * that span a full message period phase-advance the cone by up to v·Δt —
   * tens of millimetres on a high-excursion subwoofer at low frequencies —
   * which visually pins the readout to the mechanical rail while the model is
   * nowhere near it. A few milliseconds of constant display latency is
   * invisible (the Web Audio output path adds more); amplitude distortion is
   * not. The engine additionally clamps the result to the mechanical envelope.
   */
  renderDisplacement(ctxTime: number, dtMax = 0.003): number {
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
