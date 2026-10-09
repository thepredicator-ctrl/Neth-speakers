/*
 * Neth Speakers — real-time electroacoustic speaker processor (AudioWorklet).
 *
 * Runs the discrete state-space loudspeaker model sample-by-sample on the
 * actual audio stream (or test tone / sweep). The continuous-time model is
 * built and ZOH-discretized on the main thread (src/physics/*), so this file
 * is a small, stable runner:  state' = Ad·state + Bd·u
 *
 * u is the amplifier terminal voltage in volts (audio sample ±1 mapped by
 * vpeak). Outputs passed through unchanged unless "acoustic" mode is enabled,
 * in which case the far-field piston pressure estimate (linear combo of
 * states, row `cp`) replaces the audible signal — you hear what the modeled
 * speaker would radiate, not the input music.
 *
 * Nonlinear mode ("advanced"): semi-implicit (symplectic) Euler integration
 * with BL(x) droop and Kms(x) stiffening, evaluated at audio rate with
 * substeps. Documented approximation — see docs/PHYSICS.md.
 */

class SpeakerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.n = o.n || 3;
    this.Ad = new Float64Array(o.Ad || []);
    this.Bd = new Float64Array(o.Bd || []);
    this.cx = new Float64Array(o.cx || []); // displacement output row (m)
    this.cv = new Float64Array(o.cv || []); // velocity row (m/s)
    this.ci = new Float64Array(o.ci || []); // coil current row (A)
    this.cp = new Float64Array(o.cp || []); // far-field pressure row (Pa per volt·scale)
    this.state = new Float64Array(this.n);
    this.tmp = new Float64Array(this.n);

    this.vpeak = o.vpeak != null ? o.vpeak : 5.657;   // V (±) — amplifier drive
    this.vclip = o.vclip || 0;                        // V (±) — 0 = clipping off
    this.ilim = o.ilim || 0;                          // A — 0 = no current limit
    this.xmech = o.xmech != null ? o.xmech : 0.02;    // m — mechanical stop
    this.acoustic = !!o.acoustic;
    this.acousticGain = o.acousticGain != null ? o.acousticGain : 1;
    this.nl = o.nonlinear || null; // { Bl0, Kms0, Rms, Mms, Re, Le, blDrop, kmsRise, substeps }
    this.xIndex = o.xIndex != null ? o.xIndex : 1;
    this.vIndex = o.vIndex != null ? o.vIndex : 2;
    this.iIndex = o.iIndex != null ? o.iIndex : 0;

    this.lastX = 0; this.lastV = 0; this.lastI = 0;
    this.hitLimit = false; this.clipFlag = false; this.iLimFlag = false;
    this.blockCount = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(d) {
    if (!d || !d.type) return;
    if (d.type === 'system') {
      if (d.n === this.n && d.Ad) {
        this.Ad = new Float64Array(d.Ad);
        this.Bd = new Float64Array(d.Bd);
        if (d.cx) this.cx = new Float64Array(d.cx);
        if (d.cv) this.cv = new Float64Array(d.cv);
        if (d.ci) this.ci = new Float64Array(d.ci);
        if (d.cp) this.cp = new Float64Array(d.cp);
        if (d.vpeak != null) this.vpeak = d.vpeak;
        if (d.reset) this.state.fill(0);
      }
    } else if (d.type === 'params') {
      if (d.vpeak != null) this.vpeak = d.vpeak;
      if (d.vclip != null) this.vclip = d.vclip;
      if (d.ilim != null) this.ilim = d.ilim;
      if (d.xmech != null) this.xmech = d.xmech;
      if (d.acoustic != null) this.acoustic = !!d.acoustic;
      if (d.acousticGain != null) this.acousticGain = d.acousticGain;
      if (d.nonlinear !== undefined) this.nl = d.nonlinear;
    } else if (d.type === 'reset') {
      this.state.fill(0);
      this.hitLimit = false; this.clipFlag = false; this.iLimFlag = false;
    } else if (d.type === 'debug') {
      this.port.postMessage({
        type: 'debug', n: this.n, adLen: this.Ad.length, bdLen: this.Bd.length,
        ad0: Array.from(this.Ad.slice(0, 9)), bd0: Array.from(this.Bd),
        cx: Array.from(this.cx), state: Array.from(this.state),
        vpeak: this.vpeak, xIndex: this.xIndex, lastU: this.lastU, inCh: this.lastInCh,
      });
    }
  }

  stepLinear(u) {
    const { Ad, Bd, state, tmp, n } = this;
    for (let r = 0; r < n; r++) {
      let acc = Bd[r] * u;
      const off = r * n;
      for (let c = 0; c < n; c++) acc += Ad[off + c] * state[c];
      tmp[r] = acc;
    }
    state.set(tmp);
  }

  /* Semi-implicit Euler, states [i, x, v]:
   *   i' = (u − Re·i − Bl(x)·v) / Le
   *   v' = (Bl(x)·i − Rms·v − Kms(x)·x) / Mms
   *   x += dt·v      (symplectic update after velocity)            */
  stepNonlinear(u, dt) {
    const p = this.nl;
    if (!p || this.n !== 3) { this.stepLinear(u); return; }
    const sub = p.substeps || 4;
    const h = dt / sub;
    const s = this.state;
    const xmax = Math.max(1e-6, p.xmax);
    for (let k = 0; k < sub; k++) {
      const xn = s[1] / xmax;
      let bl = p.Bl0 * (1 - p.blDrop * xn * xn);
      if (bl < 0.05 * p.Bl0) bl = 0.05 * p.Bl0;
      const kk = p.Kms0 * (1 + p.kmsRise * xn * xn);
      s[0] += h * (u - p.Re * s[0] - bl * s[2]) / p.Le;
      s[2] += h * (bl * s[0] - p.Rms * s[2] - kk * s[1]) / p.Mms;
      s[1] += h * s[2];
    }
  }

  dot(row) {
    let acc = 0;
    for (let k = 0; k < this.n; k++) acc += row[k] * this.state[k];
    return acc;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const inCh = input && input.length > 0 ? input[0] : null;
    const out = outputs[0];
    const L = out[0].length;
    const dt = 1 / sampleRate;
    for (let i = 0; i < L; i++) {
      let s = inCh && inCh.length > 0 ? inCh[i] : 0;
      if (!Number.isFinite(s)) s = 0; // guard against zero-length/unconnected input quanta
      if (s > 1) s = 1; else if (s < -1) s = -1;
      let u = s * this.vpeak;
      this.clipFlag = false;
      if (this.vclip > 0 && Math.abs(u) > this.vclip) {
        u = Math.sign(u) * this.vclip;
        this.clipFlag = true;
      }
      if (this.nl && this.n === 3) this.stepNonlinear(u, dt);
      else this.stepLinear(u);
      // Self-heal: a non-finite state (bad input, hot-swap race) resets to rest.
      if (!Number.isFinite(this.state[0]) || !Number.isFinite(this.state[this.xIndex]) || !Number.isFinite(this.state[this.vIndex])) {
        this.state.fill(0);
      }

      // Mechanical stop: clamp displacement, absorb velocity into the stop.
      let x = this.dot(this.cx);
      if (Math.abs(x) > this.xmech) {
        const sg = Math.sign(x);
        this.state[this.xIndex] = sg * this.xmech;
        if (Math.sign(this.state[this.vIndex]) === sg) this.state[this.vIndex] *= -0.06;
        x = sg * this.xmech;
        this.hitLimit = true;
      }
      let cur = this.dot(this.ci);
      if (this.ilim > 0 && Math.abs(cur) > this.ilim) {
        // Current-limit model: fold drive voltage toward compliance point.
        this.iLimFlag = true;
        cur = Math.sign(cur) * this.ilim;
      }
      this.lastX = x; this.lastV = this.dot(this.cv); this.lastI = cur;
      this.lastU = u; this.lastInCh = inCh ? inCh.length : -1;

      if (this.acoustic && this.cp.length === this.n) {
        const p = this.dot(this.cp) * this.acousticGain;
        for (let ch = 0; ch < out.length; ch++) {
          const o = out[ch];
          o[i] = p > 1 ? 1 : (p < -1 ? -1 : p);
        }
      } else {
        for (let ch = 0; ch < out.length; ch++) {
          out[ch][i] = inCh && inCh.length > 0 ? inCh[i] : 0;
        }
      }
    }
    if ((this.blockCount++ & 3) === 0) {
      this.port.postMessage({
        x: this.lastX, v: this.lastV, i: this.lastI,
        t: currentTime, limit: this.hitLimit,
        clip: this.clipFlag, ilim: this.iLimFlag,
      });
      this.hitLimit = false; this.clipFlag = false; this.iLimFlag = false;
    }
    return true;
  }
}

registerProcessor('speaker-processor', SpeakerProcessor);
