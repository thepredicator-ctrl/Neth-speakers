/*
 * Neth Speakers — professional analysis layer.
 *
 * Everything here runs on top of the exact linear state-space model:
 *   • Max SPL curves (excursion-limited / voltage-limited / thermal-limited)
 *   • Group delay & phase (from the SPL transfer function)
 *   • Port air velocity (exact: port displacement comes straight out of the
 *     state vector — no "cone velocity × Sd/Sp" hand-waving)
 *   • 3rd-harmonic distortion estimate from the modelled Bl(x) droop and
 *     Kms(x) stiffening (quasi-static power-series — honest 3rd-order est.)
 *   • Numerical box alignment optimizer (searches the REAL system response,
 *     not lookup tables) + automatic port sizing against chuffing
 *   • Rule-based design review (scorecard advice with severities)
 */
import type { DriverParams, EnclosureParams, TSParams } from './types';
import {
  responseOverGrid, impedanceCurve, computeEnclosure, type EnclosureResultLite,
} from './freqresp';
import { buildSystem, wiringInfo, type SystemModel } from './stateSpace';
import { logspace, RHO0, C_SOUND, clamp } from './units';

/* ------------------------------------------------------------------ */
/* shared curve helper                                                 */
/* ------------------------------------------------------------------ */

export interface DriveContext {
  vRef: number;          // V rms at amplifier terminals (drive used for curves)
  clipV: number | null;  // V rms clip ceiling at terminals (null = unlimited)
  thermalW: number;      // driver continuous power handling (W)
  loadOhms: number;      // nominal load for thermal voltage conversion
}

export interface SystemCurves {
  f: number[];
  splDb: number[];       // dB SPL @1m at vRef drive (half-space piston)
  phaseRad: number[];    // SPL phase
  excMm: number[];       // one-way cone excursion (peak, mm) at vRef
  portXm: number[] | null; // port/PR displacement (peak, m) at vRef
  portUm: number[] | null; // port air velocity (rms, m/s)
  impMag: number[];
  impRe: number[];       // impedance real part (Ω)
  curA: number[];        // voice-coil current (peak, A) at vRef
  velMmS: number[];      // cone velocity (peak, mm/s) at vRef
  gdMs: number[];        // group delay (ms)
}

/** Evaluate every pro curve of the current system in one pass. */
export function systemCurves(
  sys: SystemModel, ts: TSParams,
  enclosure: EnclosureParams | null, enc: EnclosureResultLite | null,
  f: number[], drive: DriveContext,
): SystemCurves {
  const spl = responseOverGrid(sys.A, sys.B, sys.cp, f);
  const exc = responseOverGrid(sys.A, sys.B, sys.cx, f);
  const vel = responseOverGrid(sys.A, sys.B, sys.cv, f);
  const cur = responseOverGrid(sys.A, sys.B, sys.ci, f);
  const imp = impedanceCurve(ts, f, enclosure, enc, 0);
  const hasPort = sys.cpr != null && enclosure != null && enclosure.type !== 'sealed';
  const portX = hasPort ? responseOverGrid(sys.A, sys.B, sys.cpr!, f) : null;
  const splDb = spl.mag.map((m) => 20 * Math.log10(Math.max(m * drive.vRef * sys.splScale, 1e-12) / 2e-5));
  const gd = groupDelayMs(f, spl.phase);
  let portXm: number[] | null = null;
  let portUm: number[] | null = null;
  if (portX) {
    portXm = portX.mag.map((m) => m * drive.vRef);
    portUm = portX.mag.map((m, i) => (2 * Math.PI * f[i] * m * drive.vRef) / Math.SQRT2);
  }
  return {
    f, splDb, phaseRad: spl.phase,
    excMm: exc.mag.map((m) => m * drive.vRef * 1000),
    portXm, portUm,
    impMag: imp.mag,
    impRe: imp.re,
    curA: cur.mag.map((m) => m * drive.vRef),
    velMmS: vel.mag.map((m) => m * drive.vRef * 1000),
    gdMs: gd,
  };
}

/** −3 dB point against the 120–300 Hz band mean. Shared helper. */
export function f3OfCurve(f: number[], db: number[]): number | null {
  let refSum = 0, refN = 0;
  for (let i = 0; i < f.length; i++) if (f[i] >= 120 && f[i] <= 300) { refSum += db[i]; refN++; }
  if (!refN) return null;
  const ref = refSum / refN;
  // walk DOWN from the top of the passband; F3 = last frequency still above ref−3 dB
  let refIdx = 0;
  for (let i = 0; i < f.length; i++) if (f[i] <= 300) refIdx = i;
  let out = f[0];
  for (let i = refIdx; i >= 0; i--) {
    if (db[i] >= ref - 3) out = f[i];
    else break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* group delay                                                         */
/* ------------------------------------------------------------------ */

/** τg = −dφ/dω with phase unwrapping; returns ms. */
export function groupDelayMs(f: number[], phaseRad: number[]): number[] {
  const n = f.length;
  if (n < 3) return new Array(n).fill(0);
  // unwrap
  const ph: number[] = [phaseRad[0]];
  for (let i = 1; i < n; i++) {
    let d = phaseRad[i] - phaseRad[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    ph.push(ph[i - 1] + d);
  }
  const out: number[] = new Array(n);
  out[0] = out[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) {
    const dw = 2 * Math.PI * (f[i + 1] - f[i - 1]) / 2; // central difference on ω
    const dph = (ph[i + 1] - ph[i - 1]) / 2;
    out[i] = dw > 1e-9 ? (-dph / dw) * 1000 : 0;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Max SPL                                                             */
/* ------------------------------------------------------------------ */

export interface MaxSplCurve {
  f: number[];
  dbMax: number[];          // overall max achievable (min of the limits)
  byExcursion: number[];
  byVoltage: number[];
  byThermal: number[];
  limitedBy: ('excursion' | 'voltage' | 'thermal')[];
}

/**
 * Displacement/voltage/thermal-limited maximum SPL per frequency.
 * Excursion limit: SPL rises 20·log10 with voltage until |x| = Xmax.
 * Voltage limit: amplifier clip ceiling.
 * Thermal limit: driver continuous power handling → equivalent sine voltage.
 */
export function maxSplCurve(c: SystemCurves, ts: TSParams, drive: DriveContext): MaxSplCurve {
  const vThermal = Math.sqrt(Math.max(0.01, drive.thermalW) * Math.max(0.5, drive.loadOhms));
  const f: number[] = [], dbMax: number[] = [], byE: number[] = [], byV: number[] = [], byT: number[] = [];
  const lim: MaxSplCurve['limitedBy'] = [];
  const xmaxMm = Math.max(0.05, ts.Xmax);
  for (let i = 0; i < c.f.length; i++) {
    const base = c.splDb[i];
    const exc = Math.max(1e-6, Math.abs(c.excMm[i]));
    const e = base + 20 * Math.log10(xmaxMm / exc);
    const v = drive.clipV != null ? base + 20 * Math.log10(Math.max(drive.clipV, 1e-3) / drive.vRef) : Infinity;
    const t = base + 20 * Math.log10(Math.max(vThermal, 1e-3) / drive.vRef);
    const m = Math.min(e, v, t);
    f.push(c.f[i]); dbMax.push(m); byE.push(e); byV.push(v); byT.push(t);
    lim.push(v <= e && v <= t ? 'voltage' : t <= e ? 'thermal' : 'excursion');
  }
  return { f, dbMax, byExcursion: byE, byVoltage: byV, byThermal: byT, limitedBy: lim };
}

/* ------------------------------------------------------------------ */
/* 3rd-harmonic distortion estimate                                    */
/* ------------------------------------------------------------------ */

/**
 * Quasi-static HD3 estimate from the two modelled nonlinearities:
 *   Kms(x) = Kms0·(1 + k·(x/Xmax)²)  → cubic force term  → HD3 = (k/4)·(A/Xmax)²
 *   Bl(x)  = Bl0·(1 − δ·(x/Xmech)²)  → cubic force term  → HD3 = (δ/4)·(A/Xmech)²
 * A(f) = linear-model peak excursion at the current drive.
 * Only where excursion is large does this matter (near resonance) — exactly
 * where real subwoofers distort. Even-order terms are not modelled (0 here).
 */
export function hd3Estimate(c: SystemCurves, ts: TSParams, driver: DriverParams): number[] {
  const k = clamp(driver.kmsRiseAtXmax, 0, 3);
  const delta = clamp(driver.blDropAtXmech, 0, 0.9);
  const xmax = Math.max(0.05, ts.Xmax);
  const xmech = Math.max(0.3, ts.Xmech);
  return c.excMm.map((a) => {
    const A = Math.min(Math.abs(a), xmech); // clamp to mechanical travel
    const d3k = (k / 4) * (A / xmax) ** 2;
    const d3b = (delta / 4) * (A / xmech) ** 2;
    return Math.min(100, Math.sqrt(d3k * d3k + d3b * d3b) * 100);
  });
}

/* ------------------------------------------------------------------ */
/* numerical alignment optimizer                                       */
/* ------------------------------------------------------------------ */

export interface AlignGoal { kind: 'maxflat' | 'ebs' | 'sealedButterworth'; targetQtc?: number }

export interface AlignSolution {
  kind: AlignGoal['kind'];
  VbL: number;             // target NET box volume (litres)
  FbHz: number | null;     // tuning (ported) or null (sealed)
  F3Hz: number;
  rippleDb: number;        // max passband deviation from mean level
  Qtc: number | null;      // sealed only
  internal: { w: number; h: number; d: number };  // suggested internal dims (mm)
  port?: { shape: 'round' | 'slot'; diameter: number; length: number; count: number; flared: boolean; slotWidth: number; slotHeight: number; velocity?: number };
  notes: string[];
}

interface AlignCtx {
  ts: TSParams;
  base: EnclosureParams;     // current enclosure (for materials, driver count, damping…)
  driverDisplacementL: number;
  vRated: number;            // V rms for velocity check
  maxPortLenMM: number | null; // physical depth cap hint
}

/** Build a system for an arbitrary {Vb, Fb} and evaluate SPL/F3/ripple. */
function evalPortedBox(ctx: AlignCtx, VbL: number, FbHz: number): { spl: number[]; f: number[]; F3: number; ripple: number; F10: number } | null {
  const { ts } = ctx;
  const f = logspace(12, 400, 48);
  const enc: EnclosureParams = { ...ctx.base, type: 'ported' };
  const disp = ctx.driverDisplacementL;
  // port placeholder volume ~2.5% of Vb (dims solved later)
  const r = computeEnclosure({ ...enc, internalWidth: 500, internalHeight: 500, internalDepth: 500, port: { ...enc.port, diameter: 80, length: 200, count: 1 } }, ts, disp);
  // force net effective volume via a synthetic box: use bracing volume as the trim knob
  const grossNeeded = VbL + disp + r.portVolumeL + Math.max(0, enc.bracingVolume);
  const dims = dimsForVolume(enc, grossNeeded);
  const enc2: EnclosureParams = { ...enc, internalWidth: dims.w, internalHeight: dims.h, internalDepth: dims.d };
  // solve port length for exactly Fb at this volume
  const rr = computeEnclosure(enc2, ts, disp);
  if (!rr || rr.portArea <= 0) return null;
  const VbEffM3 = VbL * (rr.VbEff / Math.max(rr.VbNet, 0.001)) * 1e-3;
  const L = portLengthForFb(FbHz, rr.portArea, VbEffM3);
  if (!Number.isFinite(L) || L < 10) return null;
  const enc3: EnclosureParams = { ...enc2, port: { ...enc2.port, length: L } };
  const rrr = computeEnclosure(enc3, ts, disp);
  if (!rrr) return null;
  const wi = wiringInfo(ts, enc3.driverCount, enc3.wiring, enc3.coilWiring, 1);
  const sys = buildSystem({ ts, enclosure: enc3, encResult: rrr, wiring: wi, sourceImpedance: 0.05, sampleRate: 48000 });
  const spl = responseOverGrid(sys.A, sys.B, sys.cp, f);
  const splDb = spl.mag.map((m) => 20 * Math.log10(Math.max(m * 2.83 * sys.splScale, 1e-12) / 2e-5));
  const { F3, ripple, F10 } = f3AndRipple(f, splDb);
  return { spl: splDb, f, F3, ripple, F10 };
}

function evalSealedBox(ctx: AlignCtx, VbL: number): { F3: number; ripple: number; Qtc: number } {
  const { ts } = ctx;
  const f = logspace(12, 400, 48);
  const enc: EnclosureParams = { ...ctx.base, type: 'sealed' };
  const grossNeeded = VbL + ctx.driverDisplacementL + Math.max(0, enc.bracingVolume);
  const dims = dimsForVolume(enc, grossNeeded);
  const enc2: EnclosureParams = { ...enc, internalWidth: dims.w, internalHeight: dims.h, internalDepth: dims.d };
  const r = computeEnclosure(enc2, ts, ctx.driverDisplacementL);
  const wi = wiringInfo(ts, enc2.driverCount, enc2.wiring, enc2.coilWiring, 1);
  const sys = buildSystem({ ts, enclosure: enc2, encResult: r, wiring: wi, sourceImpedance: 0.05, sampleRate: 48000 });
  const spl = responseOverGrid(sys.A, sys.B, sys.cp, f);
  const splDb = spl.mag.map((m) => 20 * Math.log10(Math.max(m * 2.83 * sys.splScale, 1e-12) / 2e-5));
  const { F3, ripple } = f3AndRipple(f, splDb);
  const a = ts.Vas / Math.max(0.5, r.VbEff);
  return { F3, ripple, Qtc: ts.Qts * Math.sqrt(1 + a) };
}

/** F3 (−3 dB vs 120–300 Hz band mean) and passband ripple, from a coarse grid. */
function f3AndRipple(f: number[], db: number[]): { F3: number; ripple: number; F10: number } {
  let refSum = 0, refN = 0;
  for (let i = 0; i < f.length; i++) if (f[i] >= 120 && f[i] <= 300) { refSum += db[i]; refN++; }
  const ref = refN > 0 ? refSum / refN : db[db.length - 1];
  // walk DOWN from the top of the passband: F3/F10 = lowest frequency still
  // within 3 / 10 dB of the band mean (walking from the grid top would return
  // the top of the flat region instead of the bass extension).
  let refIdx = 0;
  for (let i = 0; i < f.length; i++) if (f[i] <= 300) refIdx = i;
  let F3 = f[0], F10 = f[0];
  for (let i = refIdx; i >= 0; i--) { if (db[i] >= ref - 3) F3 = f[i]; else break; }
  for (let i = refIdx; i >= 0; i--) { if (db[i] >= ref - 10) F10 = f[i]; else break; }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < f.length; i++) {
    if (f[i] >= Math.max(F3, 40) && f[i] <= 300) { mn = Math.min(mn, db[i]); mx = Math.max(mx, db[i]); }
  }
  return { F3, ripple: Number.isFinite(mn) ? mx - mn : 0, F10 };
}

/** Internal dims keeping the current aspect ratio, hitting a gross volume. */
function dimsForVolume(base: EnclosureParams, grossL: number): { w: number; h: number; d: number } {
  const curL = Math.max(0.5, (base.internalWidth * base.internalHeight * base.internalDepth) / 1e6);
  const s = Math.cbrt(clamp(grossL / curL, 0.05, 60));
  return {
    w: clamp(base.internalWidth * s, 60, 2600),
    h: clamp(base.internalHeight * s, 60, 2600),
    d: clamp(base.internalDepth * s, 60, 2600),
  };
}

/** Port length (mm) that tunes a round port to Fb: from Helmholtz + end corr. */
export function portLengthForFb(FbHz: number, portAreaM2: number, VbEffM3: number): number {
  const r = Math.sqrt(portAreaM2 / Math.PI);
  const corr = 0.85 * r * 2; // flared both ends
  const Leff = Math.pow(C_SOUND / (2 * Math.PI * Math.max(5, FbHz)), 2) * (portAreaM2 / Math.max(1e-6, VbEffM3));
  return (Leff - corr) * 1000;
}

/** Auto-size a port: velocity target first, then verify tuning & length. */
export function autoPort(
  ctx: AlignCtx, VbL: number, FbHz: number,
  uFlowM3s: number,          // m³/s rms port volume flow at Fb (from the state model)
): AlignSolution['port'] & { velocity: number } {
  const enc = ctx.base;
  const U = Math.max(1e-7, uFlowM3s); // m³/s volume velocity
  const wall = enc.wallThickness;
  const maxFace = Math.min(enc.internalWidth, enc.internalHeight) * 0.6;
  // try 1 → 4 round ports
  let best: { d: number; n: number; Sp: number; v: number } | null = null;
  for (let n = 1; n <= 4; n++) {
    const SpNeed = U / 17;                      // m² for 17 m/s
    const d = (Math.sqrt((4 * SpNeed) / (Math.PI * n)) * 1000);
    if (d > maxFace) continue;
    const L = portLengthForFb(FbHz, (Math.PI / 4) * Math.pow(d / 1000, 2) * n, VbL * 1e-3);
    const lenCap = ctx.maxPortLenMM ?? (enc.internalDepth - 2 * wall);
    if (L > lenCap) continue;
    const v = U / ((Math.PI / 4) * Math.pow(d / 1000, 2) * n);
    if (!best || Math.abs(v - 15) < Math.abs(best.v - 15)) best = { d: clamp(d, 25, maxFace), n, Sp: (Math.PI / 4) * Math.pow(d / 1000, 2) * n, v };
    if (v <= 15) break;
  }
  if (best) {
    const L = clamp(portLengthForFb(FbHz, best.Sp, VbL * 1e-3), 20, Math.max(20, (ctx.maxPortLenMM ?? enc.internalDepth - 2 * wall)));
    return { shape: 'round', diameter: Math.round(best.d), length: Math.round(L), count: best.n, flared: true, slotWidth: 60, slotHeight: 220, velocity: best.v };
  }
  // slot fallback: full-width slot under the baffle
  const sw = clamp(enc.internalWidth * 0.55, 40, enc.internalWidth * 0.9);
  const SpNeed = U / 17;
  const sh = (SpNeed / sw) * 1000 * 1e3; // mm
  const shC = clamp(sh, 20, enc.internalHeight * 0.8);
  const Sp = ((sw / 1000) * (shC / 1000));
  const L = clamp(portLengthForFb(FbHz, Sp, VbL * 1e-3), 20, Math.max(20, enc.internalDepth - 2 * wall));
  return { shape: 'slot', diameter: 80, length: Math.round(L), count: 1, flared: false, slotWidth: Math.round(sw), slotHeight: Math.round(shC), velocity: U / Sp };
}

function ts_Sd(ts: TSParams): number { return ts.Sd; }

/**
 * Port volume flow at Fb (m³/s rms) for a proposed {Vb, Fb}, evaluated on the
 * exact state-space model via the port-displacement output row. Using the
 * CONE velocity here would underestimate the flow — at tuning the cone barely
 * moves while the port carries the output.
 */
export function portFlowAtFb(ctx: AlignCtx, VbL: number, FbHz: number, vRated: number): number {
  const { ts } = ctx;
  const SpProv = 5e-3; // provisional ~Ø80 mm port
  const Lmm = portLengthForFb(FbHz, SpProv, VbL * 1e-3);
  const enc: EnclosureParams = {
    ...ctx.base, type: 'ported',
    port: { ...ctx.base.port, shape: 'round', diameter: 80, length: Math.max(20, Math.min(1200, Lmm)), count: 1, flared: true },
  };
  const portVolL = SpProv * (Math.max(20, Math.min(1200, Lmm)) / 1000) * 1000;
  const dims = dimsForVolume(ctx.base, VbL + ctx.driverDisplacementL + portVolL + Math.max(0, ctx.base.bracingVolume));
  const enc2: EnclosureParams = { ...enc, internalWidth: dims.w, internalHeight: dims.h, internalDepth: dims.d };
  const rr = computeEnclosure(enc2, ts, ctx.driverDisplacementL);
  const wi = wiringInfo(ts, enc2.driverCount, enc2.wiring, enc2.coilWiring, 1);
  const sys = buildSystem({ ts, enclosure: enc2, encResult: rr, wiring: wi, sourceImpedance: 0.05, sampleRate: 48000 });
  if (!sys.cpr) return 0;
  const resp = responseOverGrid(sys.A, sys.B, sys.cpr, [FbHz]);
  const uPort = (2 * Math.PI * FbHz * resp.mag[0] * vRated) / Math.SQRT2; // m/s rms in provisional port
  return uPort * SpProv; // m³/s rms
}

/**
 * Search alignments on the REAL system response.
 *   maxflat : minimal passband ripple, then deepest F3 (QB3-family behaviour)
 *   ebs     : deepest F10 with ≤ 2 dB shelf accepted
 *   sealedButterworth : closed-form Qtc = 0.707 box
 */
export function optimizeAlignment(ctx: AlignCtx, goal: AlignGoal): AlignSolution {
  const { ts } = ctx;
  if (goal.kind === 'sealedButterworth') {
    const qtc = goal.targetQtc ?? 0.707;
    const denom = (qtc / Math.max(0.05, ts.Qts)) ** 2 - 1;
    let VbL = denom > 0.02 ? ts.Vas / denom : 4000;
    VbL = clamp(VbL, 1, 4000);
    const ev = evalSealedBox(ctx, VbL);
    const grossNeeded = VbL + ctx.driverDisplacementL + Math.max(0, ctx.base.bracingVolume);
    const dims = dimsForVolume(ctx.base, grossNeeded);
    return {
      kind: 'sealedButterworth', VbL, FbHz: null, F3Hz: ev.F3, rippleDb: ev.ripple, Qtc: ev.Qtc,
      internal: dims,
      notes: [`Qtc ${ev.Qtc.toFixed(2)} (target ${qtc.toFixed(2)}) — closed-form α = Vas/Vb`],
    };
  }
  // ---- numeric ported search ----
  const Fs = ts.Fs;
  const vLo = 0.55 * Fs, vHi = 1.15 * Fs;
  const vbLo = Math.max(2, 0.25 * ts.Vas), vbHi = Math.min(4000, 3.5 * ts.Vas);
  const NV = 16, NF = 18;
  let best: { Vb: number; Fb: number; F3: number; ripple: number; F10: number } | null = null;
  for (let iv = 0; iv < NV; iv++) {
    const Vb = vbLo * Math.pow(vbHi / vbLo, iv / (NV - 1));
    for (let iff = 0; iff < NF; iff++) {
      const Fb = vLo * Math.pow(vHi / vLo, iff / (NF - 1));
      const ev = evalPortedBox(ctx, Vb, Fb);
      if (!ev) continue;
      if (goal.kind === 'maxflat') {
        const better = !best
          || (ev.ripple < 0.6 && (best.ripple >= 0.6 || ev.F3 > best.F3))
          || (ev.ripple < 0.6 && best.ripple < 0.6 && ev.F3 > best.F3)
          || (ev.ripple >= 0.6 && best.ripple >= 0.6 && ev.ripple < best.ripple - 0.15);
        if (better) best = { Vb, Fb, F3: ev.F3, ripple: ev.ripple, F10: ev.F10 };
      } else {
        // EBS: maximize F10, allow shelf (ripple ≤ 2.2), prefer smaller ripple on ties
        const score = ev.F10 - Math.max(0, ev.ripple - 2.2) * 80 - Math.max(0, ev.ripple - 1.2) * 12;
        const bestScore = best ? best.F10 - Math.max(0, best.ripple - 2.2) * 80 - Math.max(0, best.ripple - 1.2) * 12 : -Infinity;
        if (!best || score > bestScore) best = { Vb, Fb, F3: ev.F3, ripple: ev.ripple, F10: ev.F10 };
      }
    }
  }
  if (!best) {
    // extremely small drivers can fail the grid — fall back to a sane default
    const Vb = clamp(ts.Vas * 0.8, 2, 2000);
    const Fb = clamp(Fs * 0.85, 20, 120);
    return { kind: goal.kind, VbL: Vb, FbHz: Fb, F3Hz: Fs * 1.1, rippleDb: 1, Qtc: null, internal: dimsForVolume(ctx.base, Vb + ctx.driverDisplacementL), notes: ['Search fell back to a Vas-scaled default'] };
  }
  const grossNeeded = best.Vb + ctx.driverDisplacementL + Math.max(0, ctx.base.bracingVolume);
  const dims = dimsForVolume(ctx.base, grossNeeded);
  return {
    kind: goal.kind, VbL: best.Vb, FbHz: best.Fb, F3Hz: best.F3, rippleDb: best.ripple, Qtc: null,
    internal: dims,
    notes: [
      `Searched ${16 * 18} Vb/Fb combinations against the full state-space response`,
      `constraint window: Fb ∈ [${vLo.toFixed(1)}, ${vHi.toFixed(1)}] Hz, Vb ∈ [${vbLo.toFixed(0)}, ${vbHi.toFixed(0)}] L`,
    ],
  };
}

/* ------------------------------------------------------------------ */
/* design review (scorecard advice)                                    */
/* ------------------------------------------------------------------ */

export type Severity = 'ok' | 'info' | 'warn' | 'bad';
export interface AdviceItem { severity: Severity; title: string; detail: string; category: 'enclosure' | 'amp' | 'driver' }

export interface ReviewContext {
  ts: TSParams;
  enclosure: EnclosureParams;
  encRes: (EnclosureResultLite & { Fb: number | null; VbEff: number; VbNet: number; portArea: number }) | null;
  curves: SystemCurves;
  maxSpl: MaxSplCurve;
  hd3: number[];
  ampPowerW: number;       // estimated power into the load at current drive
  powerHandlingW: number;
  driverCount: number;
}

export function designReview(ctx: ReviewContext): AdviceItem[] {
  const out: AdviceItem[] = [];
  const { ts, enclosure: enc, encRes, curves, maxSpl, hd3 } = ctx;
  const bandIdx = (lo: number, hi: number) => {
    const idx: number[] = [];
    for (let i = 0; i < curves.f.length; i++) if (curves.f[i] >= lo && curves.f[i] <= hi) idx.push(i);
    return idx;
  };

  if (enc.type === 'sealed') {
    const a = ts.Vas / Math.max(0.5, encRes?.VbEff ?? ts.Vas);
    const Qtc = ts.Qts * Math.sqrt(1 + a);
    if (Qtc < 0.5) out.push({ severity: 'info', category: 'enclosure', title: `Overdamped box (Qtc ${Qtc.toFixed(2)})`, detail: 'Tight, gently sloping bass that starts early. Great for studio/accuracy builds; if it feels lean, a smaller box (higher Qtc) adds warmth.' });
    else if (Qtc <= 0.95) out.push({ severity: 'ok', category: 'enclosure', title: `Alignment healthy (Qtc ${Qtc.toFixed(2)})`, detail: 'Between B4 (0.707) and a slight bass emphasis — the classic sweet spot for music.' });
    else if (Qtc <= 1.2) out.push({ severity: 'info', category: 'enclosure', title: `Warm alignment (Qtc ${Qtc.toFixed(2)})`, detail: 'A small bass bump above Fc. Audibly warmer; consider more volume if you want it flatter.' });
    else out.push({ severity: 'warn', category: 'enclosure', title: `Boomy alignment (Qtc ${Qtc.toFixed(2)})`, detail: 'Strong one-note emphasis and softened transients. Enlarge the box or accept the colouration.' });
  } else if (encRes?.Fb) {
    const Fb = encRes.Fb;
    if (Fb < ts.Fs * 0.7) out.push({ severity: 'warn', category: 'enclosure', title: `Tuning ${Fb.toFixed(1)} Hz is far below Fs (${ts.Fs.toFixed(1)} Hz)`, detail: 'Below Fb the cone unloads and excursion climbs steeply. A subsonic filter at ~0.8·Fb is strongly recommended for high-power use.' });
    else if (Fb > ts.Fs * 1.1) out.push({ severity: 'info', category: 'enclosure', title: `Tuning above Fs`, detail: 'A higher-than-Fs tuning trades low extension for punch and smaller box size.' });
    // excursion below Fb
    const below = bandIdx(8, Fb);
    if (below.length) {
      const worst = Math.max(...below.map((i) => Math.abs(curves.excMm[i])));
      const ratio = worst / Math.max(0.1, ts.Xmax);
      if (ratio > 2) out.push({ severity: 'bad', category: 'enclosure', title: `Cone overtravel below Fb (${worst.toFixed(1)} mm = ${(ratio).toFixed(1)}× Xmax)`, detail: 'At full drive the cone exceeds mechanical limits under Fb. Enable the subsonic protection, retune higher, or reduce drive below Fb.' });
      else if (ratio > 1.2) out.push({ severity: 'warn', category: 'enclosure', title: `Excursion ${(ratio).toFixed(1)}× Xmax below Fb`, detail: 'Typical for ported boxes, but at rated drive expect audible distortion under Fb. A subsonic filter keeps it clean.' });
    }
    // port velocity
    if (curves.portUm) {
      const near = bandIdx(Math.max(10, Fb * 0.8), Fb * 1.25);
      const vmax = near.length ? Math.max(...near.map((i) => curves.portUm![i])) : 0;
      if (vmax > 27) out.push({ severity: 'bad', category: 'enclosure', title: `Port air speed ${vmax.toFixed(0)} m/s — chuffing likely`, detail: 'Turbulence noise becomes audible above ~17–20 m/s. Enlarge the port (more area / more ports / slot) or use flares.' });
      else if (vmax > 17) out.push({ severity: 'warn', category: 'enclosure', title: `Port air speed ${vmax.toFixed(0)} m/s`, detail: 'Above the comfort zone at rated drive — some port noise possible on bass-heavy material.' });
      else out.push({ severity: 'ok', category: 'enclosure', title: `Port air speed ${vmax.toFixed(0)} m/s`, detail: 'Below the audible-chuffing threshold at rated drive.' });
    }
  }

  // thermal
  if (ctx.ampPowerW > ctx.powerHandlingW) {
    out.push({ severity: 'warn', category: 'amp', title: `Amp delivers ${ctx.ampPowerW.toFixed(0)} W vs ${ctx.powerHandlingW.toFixed(0)} W driver rating`, detail: 'Continuous operation above the thermal rating will cook the coil. Program material rarely sustains full power — but sine waves will.' });
  } else {
    out.push({ severity: 'ok', category: 'amp', title: `Thermal headroom ${(ctx.powerHandlingW / Math.max(0.1, ctx.ampPowerW)).toFixed(1)}×`, detail: `${ctx.powerHandlingW.toFixed(0)} W rating vs ${ctx.ampPowerW.toFixed(0)} W delivered — coil heating is manageable.` });
  }

  // max SPL summary
  const splMax = Math.max(...maxSpl.dbMax.filter(Number.isFinite));
  if (Number.isFinite(splMax)) {
    const cls = splMax >= 115 ? 'PA-level output' : splMax >= 105 ? 'serious home-reference output' : splMax >= 95 ? 'comfortable domestic levels' : 'background levels only';
    out.push({ severity: 'info', category: 'driver', title: `Peak output ≈ ${splMax.toFixed(0)} dB @ 1 m`, detail: `${cls}. Limited by ${maxSpl.limitedBy[maxSpl.dbMax.indexOf(splMax)]} — see the Max SPL chart for which limit bites where.` });
  }

  // distortion
  const lowIdx = bandIdx(25, 150);
  if (lowIdx.length) {
    const h3 = Math.max(...lowIdx.map((i) => hd3[i]));
    if (h3 > 8) out.push({ severity: 'warn', category: 'driver', title: `Est. 3rd-harmonic ${h3.toFixed(1)}% in bass band`, detail: 'At rated drive the modelled Bl droop / stiffness rise produce significant distortion where excursion peaks. Higher-efficiency alignments or a bigger motor reduce it.' });
    else if (h3 > 0.05) out.push({ severity: 'info', category: 'driver', title: `Est. 3rd-harmonic ${h3.toFixed(1)}% peak (bass)`, detail: 'Quasi-static estimate from Bl(x) and Kms(x) at rated drive — real drivers add cone breakup above this band.' });
  }

  // sensitivity class
  out.push({
    severity: 'info', category: 'driver',
    title: `Sensitivity ${ts.sens.toFixed(1)} dB / 2.83 V / 1 m`,
    detail: `${ts.sens >= 90 ? 'Efficient — easy to drive loud.' : ts.sens >= 84 ? 'Typical for this driver class.' : 'Power-hungry — budget amplifier headroom accordingly.'} η₀ = ${(ts.eta0 * 100).toFixed(2)} %.`,
  });

  return out;
}
