/*
 * Shared DSP core: discrete system runner + test-signal generators.
 * Used by the main thread (offline analysis, fallback sim, tests) and mirrors
 * the AudioWorklet implementation exactly.
 */
import { zohDiscretize } from './stateSpace';

export class SpeakerFilter {
  readonly n: number;
  readonly Ad: Float64Array;
  readonly Bd: Float64Array;
  state: Float64Array;
  private tmp: Float64Array;
  readonly dt: number;

  constructor(Ad: number[][], Bd: number[], dt: number) {
    this.n = Ad.length;
    this.Ad = new Float64Array(Ad.flat());
    this.Bd = new Float64Array(Bd);
    this.state = new Float64Array(this.n);
    this.tmp = new Float64Array(this.n);
    this.dt = dt;
  }

  reset(): void { this.state.fill(0); }

  /** Advance one sample with input voltage u. */
  step(u: number): void {
    const { Ad, Bd, state, tmp, n } = this;
    for (let r = 0; r < n; r++) {
      let acc = Bd[r] * u;
      const off = r * n;
      for (let c = 0; c < n; c++) acc += Ad[off + c] * state[c];
      tmp[r] = acc;
    }
    state.set(tmp);
  }

  get x(): number { return this.state[1]; }
  get v(): number { return this.state[2]; }
  get i(): number { return this.state[0]; }
}

/** White-ish test tone block generator (sine). */
export function sineBlock(f: number, amp: number, seconds: number, fs: number): Float64Array {
  const n = Math.round(seconds * fs);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = amp * Math.sin((2 * Math.PI * f * k) / fs);
  return out;
}

/** Gated tone burst with raised-cosine envelope. */
export function toneBurst(f: number, amp: number, cycles: number, fs: number): Float64Array {
  const n = Math.round((cycles / f) * fs);
  const ramp = Math.round(n * 0.1);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let env = 1;
    if (k < ramp) env = 0.5 - 0.5 * Math.cos((Math.PI * k) / ramp);
    if (k > n - ramp) env = 0.5 - 0.5 * Math.cos((Math.PI * (n - k)) / ramp);
    out[k] = amp * env * Math.sin((2 * Math.PI * f * k) / fs);
  }
  return out;
}

/** Logarithmic sweep (exponential chirp), normalized to amp. */
export function logSweep(f0: number, f1: number, amp: number, seconds: number, fs: number): Float64Array {
  const n = Math.round(seconds * fs);
  const out = new Float64Array(n);
  const w0 = Math.log(f0), w1 = Math.log(f1);
  const rate = (w1 - w0) / seconds;
  let phase = 0;
  for (let k = 0; k < n; k++) {
    const t = k / fs;
    const f = Math.exp(w0 + rate * t);
    phase += (2 * Math.PI * f) / fs;
    out[k] = amp * Math.sin(phase);
  }
  return out;
}

/** Linear sweep. */
export function linSweep(f0: number, f1: number, amp: number, seconds: number, fs: number): Float64Array {
  const n = Math.round(seconds * fs);
  const out = new Float64Array(n);
  let phase = 0;
  for (let k = 0; k < n; k++) {
    const t = k / fs;
    const f = f0 + ((f1 - f0) * t) / seconds;
    phase += (2 * Math.PI * f) / fs;
    out[k] = amp * Math.sin(phase);
  }
  return out;
}

/** Pink noise (Voss-McCartney approximation) and white noise. */
export function noise(amp: number, seconds: number, fs: number, pink: boolean): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  if (!pink) {
    for (let k = 0; k < n; k++) out[k] = amp * (Math.random() * 2 - 1);
    return out;
  }
  const rows = 8;
  const vals = new Float64Array(rows).fill(0);
  let counter = 0;
  for (let k = 0; k < n; k++) {
    for (let r = 0; r < rows; r++) {
      const period = 1 << r;
      if (counter % period === 0) vals[r] = Math.random() * 2 - 1;
    }
    counter++;
    let s = 0;
    for (let r = 0; r < rows; r++) s += vals[r];
    out[k] = amp * (s / rows) * 1.4;
  }
  return out;
}

export const FS_DEFAULT = 48000;
