/*
 * Frequency-domain evaluation of the linear speaker model.
 *
 * All transfer functions come from the state-space model:
 *   H(jω) = C·(jωI − A)⁻¹·B
 * which is exact for the linear system. Electrical impedance is computed
 * analytically per enclosure topology (motional impedance reflected through
 * the motor coupling Bl²).
 */
import type { EnclosureParams, TSParams } from './types';
import { cplx, cmul, cdiv, csub, cabs, carg, type Cx } from './linalg';
import { RHO0, C_SOUND, mm2m, L2m3 } from './units';
import { zohDiscretize } from './stateSpace';

export interface FreqCurve {
  f: number[];        // Hz
  mag: number[];      // output magnitude (per unit defined below)
  phase: number[];    // rad
}

/** Evaluate C·(jωI−A)⁻¹·B over a frequency grid. */
export function responseOverGrid(
  A: number[][], B: number[], C: number[], f: number[]
): FreqCurve {
  const n = A.length;
  const mag: number[] = new Array(f.length);
  const phase: number[] = new Array(f.length);
  for (let k = 0; k < f.length; k++) {
    const w = 2 * Math.PI * f[k];
    // M = jωI − A
    const M: Cx[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => cplx((i === j ? w : 0) - A[i][j], i === j ? 0 : 0))
    );
    // complex jω on diagonal: (jωI − A) means diagonal jω − A[i][i]
    for (let i = 0; i < n; i++) M[i][i] = cplx(-A[i][i], w);
    // Gaussian elimination solve (no explicit inverse)
    const y = solveComplex(M, B.map((b) => cplx(b)));
    let h = cplx(0);
    for (let i = 0; i < n; i++) h = cadd(h, cmul(cplx(C[i]), y[i]));
    mag[k] = cabs(h);
    phase[k] = carg(h);
  }
  return { f, mag, phase };
}

function cadd(a: Cx, b: Cx): Cx { return { re: a.re + b.re, im: a.im + b.im }; }

/** Solve M·y = b (complex, small dense) by Gaussian elimination with pivoting. */
export function solveComplex(M: Cx[][], b: Cx[]): Cx[] {
  const n = b.length;
  const W = M.map((r) => r.slice());
  const y = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col, best = cabs(W[col][col]);
    for (let r = col + 1; r < n; r++) {
      const m = cabs(W[r][col]);
      if (m > best) { best = m; piv = r; }
    }
    if (piv !== col) { const t = W[col]; W[col] = W[piv]; W[piv] = t; const t2 = y[col]; y[col] = y[piv]; y[piv] = t2; }
    const d = W[col][col];
    if (cabs(d) < 1e-300) { y[col] = cplx(0); continue; }
    for (let r = col + 1; r < n; r++) {
      const fac = cdiv(W[r][col], d);
      if (cabs(fac) === 0) continue;
      for (let j = col; j < n; j++) W[r][j] = csub(W[r][j], cmul(fac, W[col][j]));
      y[r] = csub(y[r], cmul(fac, y[col]));
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let acc = y[i];
    for (let j = i + 1; j < n; j++) acc = csub(acc, cmul(W[i][j], y[j]));
    y[i] = cdiv(acc, W[i][i]);
  }
  return y;
}

/* ---------------------------------------------------------------------------
 * Electrical impedance (analytic, per topology)
 * ------------------------------------------------------------------------- */

export interface EnclosureResultLite {
  VbEffM3: number;      // m³ — fill-adjusted effective net volume
  portArea: number; portLengthEff: number;
  portMass: number; portDamping: number;
  prArea: number; prMass: number; prStiffness: number; prDamping: number;
}

export function impedanceAt(
  ts: TSParams, f: number,
  enclosure: EnclosureParams | null, enc: EnclosureResultLite | null,
  sourceImpedance = 0, coilWiringFactorRe = 1, coilWiringFactorBl = 1
): Cx {
  const w = 2 * Math.PI * f;
  const jw = cplx(0, w);
  const Re = ts.Re * coilWiringFactorRe + sourceImpedance;
  const Le = Math.max(1e-6, ts.Le);
  const ZmBase = cadd3(
    cmul(jw, cplx(ts.Mms)),
    cplx(ts.Rms),
    cdiv(cplx(ts.Kms), jw) // stiffness impedance K/(jω) = 1/(jω·Cms)
  );
  let Zmech = ZmBase;
  if (enclosure && enc) {
    const Vb = Math.max(1e-7, enc.VbEffM3);
    // Box stiffness referred to cone: Kb = ρc²Sd²/Vb → compliance Cb_c = Vb/(ρc²Sd²)
    const CbC = Vb / (RHO0 * C_SOUND * C_SOUND * ts.Sd * ts.Sd);
    const ZboxC = cdiv(cplx(1), cmul(jw, cplx(CbC))); // 1/(jω·C_box) = K_box/(jω)
    if (enclosure.type === 'sealed') {
      Zmech = cadd(ZmBase, ZboxC);
    } else if (enclosure.type === 'ported' && enc.portArea > 0) {
      const Sp = enc.portArea;
      const Zcc = cdiv(cplx(1), cmul(jw, cplx(CbC))); // = 1/(jω CbC)
      const KcpC = (RHO0 * C_SOUND * C_SOUND * ts.Sd * Sp) / Vb;
      const Zcp = cdiv(cplx(KcpC), jw);
      const Zpp = cdiv(cplx((RHO0 * C_SOUND * C_SOUND * Sp * Sp) / Vb), jw);
      const Zp2 = cadd3(cmul(jw, cplx(enc.portMass)), cplx(enc.portDamping), Zpp);
      const Zd = cadd(ZmBase, Zcc);
      const det = csub(cmul(Zd, Zp2), cmul(Zcp, Zcp));
      // v_d/F = Zp2/det
      Zmech = cdiv(Zp2, det);
    } else if (enclosure.type === 'passiveRadiator' && enc.prArea > 0) {
      const Spr = enc.prArea;
      const CbC = Vb / (RHO0 * C_SOUND * C_SOUND * ts.Sd * ts.Sd);
      const Zcc = cdiv(cplx(1), cmul(jw, cplx(CbC)));
      const KcpC = (RHO0 * C_SOUND * C_SOUND * ts.Sd * Spr) / Vb;
      const Zcp = cdiv(cplx(KcpC), jw);
      const Zpp = cdiv(cplx((RHO0 * C_SOUND * C_SOUND * Spr * Spr) / Vb), jw);
      const Zp2 = cadd4(
        cmul(jw, cplx(enc.prMass)), cplx(enc.prDamping),
        cdiv(cplx(enc.prStiffness), jw), Zpp
      );
      const Zd = cadd(ZmBase, Zcc);
      const det = csub(cmul(Zd, Zp2), cmul(Zcp, Zcp));
      Zmech = cdiv(Zp2, det);
    }
  }
  const Zmot = cdiv(cplx(ts.Bl * ts.Bl * coilWiringFactorBl * coilWiringFactorBl), Zmech);
  return cadd3(cplx(Re), cmul(jw, cplx(Le)), Zmot);
}

function cadd3(a: Cx, b: Cx, c: Cx): Cx { return { re: a.re + b.re + c.re, im: a.im + b.im + c.im }; }
function cadd4(a: Cx, b: Cx, c: Cx, d: Cx): Cx { return { re: a.re + b.re + c.re + d.re, im: a.im + b.im + c.im + d.im }; }

export interface ImpedanceCurve { f: number[]; re: number[]; im: number[]; mag: number[]; phase: number[] }

export function impedanceCurve(
  ts: TSParams, f: number[], enclosure: EnclosureParams | null, enc: EnclosureResultLite | null,
  sourceImpedance = 0
): ImpedanceCurve {
  const re: number[] = [], im: number[] = [], mag: number[] = [], phase: number[] = [];
  for (const fr of f) {
    const Z = impedanceAt(ts, fr, enclosure, enc, sourceImpedance);
    re.push(Z.re); im.push(Z.im);
    mag.push(cabs(Z));
    phase.push((Math.atan2(Z.im, Z.re) * 180) / Math.PI);
  }
  return { f, re, im, mag, phase };
}

/* ---------------------------------------------------------------------------
 * Enclosure results: net volume, port tuning, port mass, damping
 * ------------------------------------------------------------------------- */

export const FILL_FACTORS: Record<EnclosureParams['damping'], number> = {
  none: 1.0,
  lightFill: 1.05,
  lined: 1.10,
  heavyFill: 1.16,
};

export function computeEnclosure(
  enc: EnclosureParams, ts: TSParams, driverDisplacementL: number
): EnclosureResultLite & {
  VbGross: number; VbNet: number; VbEff: number;   // litres
  Fb: number | null;                               // Helmholtz / PR tuning (Hz)
  portEndCorrection: number; portSpeedAtRated: number | null;
  portVolumeL: number;
  warnings: string[];
} {
  const gross = (enc.internalWidth * enc.internalHeight * enc.internalDepth) / 1e6; // mm³ → litres
  const portV = enc.port.shape === 'round'
    ? (Math.PI / 4) * Math.pow(mm2m(enc.port.diameter), 2) * mm2m(enc.port.length) * Math.max(1, enc.port.count) * 1e3
    : (mm2m(enc.port.slotWidth) * mm2m(enc.port.slotHeight) * mm2m(enc.port.length) * Math.max(1, enc.port.count)) * 1e3;
  const prV = enc.passive.enabled && enc.type === 'passiveRadiator'
    ? Math.max(0.05, 0.35 * (Math.PI / 4) * Math.pow(mm2m(enc.passive.diameter), 3) * 1e3)
    : 0;
  const subtractPort = enc.type === 'ported' ? portV : 0;
  const subtractPr = enc.type === 'passiveRadiator' ? prV : 0;
  const netL = Math.max(0.5, gross - driverDisplacementL - subtractPort - subtractPr - Math.max(0, enc.bracingVolume));
  const fill = FILL_FACTORS[enc.damping] ?? 1;
  const effL = netL * fill;

  const VbNet = netL; // litres

  let portArea = 0, portLengthEff = 0, portMass = 0, portDamping = 0.03;
  let endCorr = 0;
  // NOTE: port viscous damping ≈ 0.03 N·s/m → Qp ≈ 15–30, matching measured
  // port losses. The old 1.2 N·s/m behaved like a large box leak and wiped
  // out the Helmholtz resonance entirely (no Fb shoulder, no cone unloading).
  if (enc.port.shape === 'round') {
    const r = mm2m(enc.port.diameter) / 2;
    portArea = Math.PI * r * r * Math.max(1, enc.port.count);
    endCorr = enc.port.flared ? 0.85 * r * 2 : 0.732 * r * 2; // two ends
    portLengthEff = mm2m(enc.port.length) + endCorr;
  } else {
    const a = mm2m(enc.port.slotWidth), b = mm2m(enc.port.slotHeight);
    portArea = a * b * Math.max(1, enc.port.count);
    const rEq = Math.sqrt(portArea / Math.max(1, enc.port.count) / Math.PI);
    endCorr = 0.732 * rEq * 2;
    portLengthEff = mm2m(enc.port.length) + endCorr;
  }
  portMass = RHO0 * portArea * portLengthEff;

  // PR
  let prArea = 0, prMass = 0, prStiffness = 0, prDamping = 0.8;
  if (enc.type === 'passiveRadiator' && enc.passive.enabled) {
    prArea = (Math.PI / 4) * Math.pow(mm2m(enc.passive.diameter), 2);
    prMass = Math.max(1e-3, enc.passive.mass * 1e-3);
    prStiffness = Math.max(0, enc.passive.suspensionStiffness);
    prDamping = Math.max(0.05, enc.passive.damping);
  }

  // Tuning
  let Fb: number | null = null;
  const warnings: string[] = [];
  if (enc.type === 'ported' && portArea > 0 && portLengthEff > 0) {
    Fb = (C_SOUND / (2 * Math.PI)) * Math.sqrt(portArea / (L2m3(effL) * portLengthEff));
    if (Fb < 15 || Fb > 120) warnings.push(`Port tuning ${Fb.toFixed(1)} Hz is outside the usual 15–120 Hz range.`);
    // air speed estimate at rated power: U = Sd·v_d at Fb (from velocity response)
  }
  if (enc.type === 'passiveRadiator' && prArea > 0 && prMass > 0) {
    // approximate: PR mass against box compliance (series with its own suspension)
    const CbPR = L2m3(effL) / (RHO0 * C_SOUND * C_SOUND * prArea * prArea);
    const Cpr = prStiffness > 0 ? 1 / prStiffness : 0;
    const Cseries = Cpr > 0 ? (CbPR * Cpr) / (CbPR + Cpr) : CbPR;
    Fb = 1 / (2 * Math.PI * Math.sqrt(prMass * Cseries));
  }

  return {
    VbNet, VbEff: effL,
    VbEffM3: effL * 1e-3,
    VbGross: gross,
    Fb,
    portArea, portLengthEff, portMass, portDamping,
    prArea, prMass, prStiffness, prDamping,
    portEndCorrection: endCorr,
    portSpeedAtRated: null,
    portVolumeL: portV,
    warnings,
  };
}

/* ---------------------------------------------------------------------------
 * Time-domain utilities (validation & tests, main-thread)
 * ------------------------------------------------------------------------- */

/** Run the ZOH-discretized system over a sample array; returns displacement per sample. */
export function runDiscrete(
  A: number[][], B: number[], u: Float32Array | Float64Array | number[]
): { x: Float64Array; v: Float64Array; i: Float64Array } {
  const { Ad, Bd, n } = zohDiscretize(A, B, 1 / 48000);
  const state = new Float64Array(n);
  const tmp = new Float64Array(n);
  const x = new Float64Array(u.length);
  const v = new Float64Array(u.length);
  const i = new Float64Array(u.length);
  for (let k = 0; k < u.length; k++) {
    for (let r = 0; r < n; r++) {
      let acc = Bd[r] * u[k];
      for (let c = 0; c < n; c++) acc += Ad[r][c] * state[c];
      tmp[r] = acc;
    }
    state.set(tmp);
    x[k] = state[1]; v[k] = state[2]; i[k] = state[0];
  }
  return { x, v, i };
}

/** Steady-state |x/u| magnitude via coherent demodulation of the last 60% of a run. */
export function steadyStateMag(u: Float64Array | number[], x: Float64Array, f: number, fs: number): number {
  const start = Math.floor(u.length * 0.4);
  const w = (2 * Math.PI * f) / fs;
  let cre = 0, cim = 0, ure = 0, uim = 0;
  for (let k = start; k < u.length; k++) {
    cre += x[k] * Math.cos(w * k);
    cim -= x[k] * Math.sin(w * k);
    ure += u[k] * Math.cos(w * k);
    uim -= u[k] * Math.sin(w * k);
  }
  return Math.hypot(cre, cim) / Math.max(1e-30, Math.hypot(ure, uim));
}

void mm2m;
