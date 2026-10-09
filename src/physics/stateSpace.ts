/*
 * Continuous-time state-space model of a moving-coil driver in an enclosure.
 *
 * One linear engine covers sealed, ported (bass-reflex) and passive-radiator
 * systems — the same matrices power real-time audio simulation (ZOH-discretized
 * in the AudioWorklet), frequency-response curves, impedance plots and the
 * time-domain verification sweeps.
 *
 * State vector (ported):  [ i, x_d, v_d, x_p, v_p ]
 *   i   — voice-coil current (A)
 *   x_d — cone displacement (m), + = forward (out of magnet)
 *   v_d — cone velocity (m/s)
 *   x_p — port air displacement (m)  / passive-radiator displacement
 *   v_p — port air velocity (m/s)    / passive-radiator velocity
 * Sealed / free-air drop the last two states.
 *
 * Physics (per unit conventions: +x out of the motor, box pressure + = compression):
 *   L_e·di/dt = u − (R_e+R_s)·i − Bl·v_d
 *   M_ms·dv_d/dt = Bl·i − R_ms·v_d − K_ms·x_d − S_d·p
 *   p = (ρ0·c²/V_b)·(S_d·x_d − S_p·x_p)          [box acoustic pressure]
 *   M_p·dv_p/dt = S_p·p − R_p·v_p                [port air mass]
 *   M_pr·dv_pr/dt = S_pr·p − R_pr·v_pr − K_pr·x_pr   [passive radiator]
 */
import type { EnclosureParams, TSParams } from './types';
import { RHO0, C_SOUND, mm2m, L2m3 } from './units';
import { expm } from './linalg';

export interface SystemModel {
  A: number[][];         // n×n
  B: number[];           // n (input = terminal voltage, V)
  n: number;
  states: string[];
  xIndex: number; vIndex: number; iIndex: number;
  cx: number[];          // displacement output row (m)
  cv: number[];          // velocity row (m/s)
  ci: number[];          // current row (A)
  cpr: number[] | null;  // port / passive-radiator displacement row (m), null if none
  cp: number[];          // far-field pressure row: p(r=1m) = cp·state  (Pa/scale)
  splScale: number;      // total radiation scale (driver count × wiring)
  dt: number;            // native sample time used for discretization
  meta: {
    Vb: number;          // m³ net
    Kb: number;          // N/m box stiffness seen by cone
    portArea: number;    // m² (0 for sealed)
    portMass: number;    // kg
    prArea: number; prMass: number; prStiffness: number;
  };
}

export interface WiringInfo {
  perDriverVoltageFactor: number; // k_w: voltage each driver sees (series: 1/n)
  splScale: number;               // n·k_w (coherent radiation sum)
  rsEff: number;                  // source impedance seen per driver electrical model
  loadImpedance: number;          // nominal total load (Re based, for power calc)
}

export function wiringInfo(ts: TSParams, count: number, wiring: 'parallel' | 'series', coilWiring: 'parallel' | 'series', coils: number): WiringInfo {
  const n = Math.max(1, Math.round(count));
  // Dual voice coils folded into effective per-driver electrical values:
  // parallel coils: Re/2, Le/2, Bl unchanged. Series: Re·2, Le·2, Bl·2 (same current, both gaps).
  let Re = ts.Re, Bl = ts.Bl;
  if (coils === 2) {
    if (coilWiring === 'parallel') Re = ts.Re / 2;
    else Bl = ts.Bl * 2;
  }
  const loadPerDriver = Re;
  const loadTotal = wiring === 'parallel' ? loadPerDriver / n : loadPerDriver * n;
  const perDriverVoltageFactor = wiring === 'parallel' ? 1 : 1 / n;
  const rsEff = wiring === 'parallel' ? n : 1 / n;
  void rsEff;
  return {
    perDriverVoltageFactor,
    splScale: n * perDriverVoltageFactor,
    rsEff: wiring === 'parallel' ? 0 : 0, // source impedance handled at amplifier level (Rs added to Re branch)
    loadImpedance: loadTotal,
  };
}

export interface BuildOptions {
  ts: TSParams;
  enclosure: EnclosureParams | null;  // null = free air (Speaker Lab)
  encResult: EnclosureResultLite | null;
  wiring: WiringInfo;
  sourceImpedance: number;            // Ω amplifier output impedance (per channel)
  sampleRate: number;
}

export interface EnclosureResultLite {
  VbEffM3: number;      // m³ — fill-adjusted effective net volume
  portArea: number;     // m² total
  portLengthEff: number;// m incl. end correction
  portMass: number;     // kg
  portDamping: number;  // N·s/m
  prArea: number; prMass: number; prStiffness: number; prDamping: number;
}

export function buildSystem(o: BuildOptions): SystemModel {
  const { ts, enclosure, encResult, wiring } = o;
  const Rs = Math.max(0, o.sourceImpedance);

  const Le = Math.max(1e-6, ts.Le);
  const Re = Math.max(0.1, ts.Re) + Rs;
  const Bl = Math.max(1e-4, ts.Bl);
  const Mms = Math.max(1e-6, ts.Mms);
  const Rms = Math.max(1e-6, ts.Rms);
  const Kms = Math.max(1, ts.Kms);

  const isPorted = enclosure != null && enclosure.type === 'ported' && encResult != null && encResult.portArea > 0;
  const isPR = enclosure != null && enclosure.type === 'passiveRadiator' && encResult != null && encResult.prArea > 0;
  const sealedOrBox = enclosure != null && encResult != null;

  // Box stiffness seen by the cone (referred to cone area)
  const Vb = sealedOrBox ? Math.max(1e-7, encResult!.VbEffM3) : Infinity;
  const Cb = Vb === Infinity ? 0 : Vb / (RHO0 * C_SOUND * C_SOUND); // box compliance (m⁵/N... acoustic)
  const Kb = Vb === Infinity ? 0 : (RHO0 * C_SOUND * C_SOUND * ts.Sd * ts.Sd) / Vb;

  const Sp = isPorted ? encResult!.portArea : 0;
  const Kcp = Vb === Infinity || Sp === 0 ? 0 : (RHO0 * C_SOUND * C_SOUND * ts.Sd * Sp) / Vb; // cone↔port coupling
  const Kpp = Vb === Infinity || Sp === 0 ? 0 : (RHO0 * C_SOUND * C_SOUND * Sp * Sp) / Vb;

  const Spr = isPR ? encResult!.prArea : 0;
  const Kcr = Vb === Infinity || Spr === 0 ? 0 : (RHO0 * C_SOUND * C_SOUND * ts.Sd * Spr) / Vb;
  const Krr = Vb === Infinity || Spr === 0 ? 0 : (RHO0 * C_SOUND * C_SOUND * Spr * Spr) / Vb;

  const n = isPorted || isPR ? 5 : 3;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const B = new Array(n).fill(0);
  const kw = wiring.perDriverVoltageFactor;

  // State layout: [i, x_d, v_d, (x_p, v_p)]
  // Row 0 — electrical: i' = (kw·u − (Re+Rs)·i − Bl·v_d)/Le
  A[0][0] = -Re / Le;
  A[0][2] = -Bl / Le;
  B[0] = kw / Le;

  // Row 1 — kinematic: x_d' = v_d
  A[1][2] = 1;

  // Row 2 — cone force: v_d' = (Bl·i − Rms·v_d − (Kms+Kb)·x_d + K·x_p)/Mms
  A[2][0] = Bl / Mms;
  A[2][1] = -(Kms + Kb) / Mms;
  A[2][2] = -Rms / Mms;
  if (isPorted) A[2][3] = Kcp / Mms;
  if (isPR) A[2][3] = Kcr / Mms;

  if (isPorted) {
    // Row 3 — kinematic: x_p' = v_p
    A[3][4] = 1;
    // Row 4 — port air mass: v_p' = (Kcp·x_d − Kpp·x_p − Rp·v_p)/Mp
    const Mp = Math.max(1e-9, encResult!.portMass);
    const Rp = Math.max(1e-9, encResult!.portDamping);
    A[4][1] = (RHO0 * C_SOUND * C_SOUND * Sp * ts.Sd) / Vb / Mp;
    A[4][3] = -Kpp / Mp;
    A[4][4] = -Rp / Mp;
  } else if (isPR) {
    // Row 3 — kinematic: x_pr' = v_pr
    A[3][4] = 1;
    // Row 4 — passive radiator: v_pr' = (Kcr·x_d − (Krr+K_pr)·x_pr − R_pr·v_pr)/M_pr
    const Mpr = Math.max(1e-6, encResult!.prMass);
    const Rpr = Math.max(1e-9, encResult!.prDamping);
    const Kpr = Math.max(0, encResult!.prStiffness);
    A[4][1] = (RHO0 * C_SOUND * C_SOUND * Spr * ts.Sd) / Vb / Mpr;
    A[4][3] = -(Krr + Kpr) / Mpr;
    A[4][4] = -Rpr / Mpr;
  }

  const states = isPorted || isPR
    ? ['current (A)', 'cone x (m)', 'cone v (m/s)', (isPorted ? 'port x (m)' : 'PR x (m)'), (isPorted ? 'port v (m/s)' : 'PR v (m/s)')]
    : ['current (A)', 'cone x (m)', 'cone v (m/s)'];

  // Output rows
  const cx = new Array(n).fill(0); cx[1] = 1;
  const cv = new Array(n).fill(0); cv[2] = 1;
  const ci = new Array(n).fill(0); ci[0] = 1;
  const cpr = isPorted || isPR ? (() => { const r = new Array(n).fill(0); r[3] = 1; return r; })() : null;

  // Far-field pressure row (piston, on-axis, r = 1 m, infinite baffle):
  //   p ≈ (ρ0 / 2π r)·d/dt(U) = (ρ0/2π)·(Sd·a_d − Sp·a_p)
  // Built DIRECTLY from the A rows so every coupling term is included:
  //   a_d = A[2]·state (incl. the Kcp/Mms·x_p box-pressure coupling — the old
  //   hand-written row silently omitted it), a_p = A[4]·state.
  // SIGN NOTE: the state variable x_p is positive when port/PR air moves INTO
  // the box (the convention that makes cone-out ↔ port-in quasi-statically
  // short the box pressure). Outward-radiated flow is therefore −x_p, so the
  // port/PR acceleration enters with a NEGATIVE sign. Wrong sign ⇒ cone+port
  // add below Fb (shallow ~4 dB/oct rolloff) and a non-physical cancellation
  // notch above tuning; correct sign ⇒ textbook 24 dB/oct 4th-order rolloff.
  const cp = new Array(n).fill(0);
  {
    const K = RHO0 / (2 * Math.PI);
    const aPort = isPorted ? Sp : isPR ? Spr : 0;
    for (let j = 0; j < n; j++) {
      const coneTerm = ts.Sd * A[2][j];
      cp[j] = aPort > 0 ? K * (coneTerm - aPort * A[4][j]) : K * coneTerm;
    }
  }

  return {
    A, B, n, states,
    xIndex: 1, vIndex: 2, iIndex: 0,
    cx, cv, ci, cpr, cp,
    splScale: wiring.splScale,
    dt: 1 / o.sampleRate,
    meta: {
      Vb: Vb === Infinity ? 0 : Vb,
      Kb,
      portArea: Sp,
      portMass: isPorted ? encResult!.portMass : 0,
      prArea: Spr,
      prMass: isPR ? encResult!.prMass : 0,
      prStiffness: isPR ? encResult!.prStiffness : 0,
    },
  };
}

export interface DiscreteSystem {
  Ad: number[][];
  Bd: number[];
  n: number;
}

/** Zero-Order-Hold discretization via the block matrix exponential:
 *  exp([[A,B],[0,0]]·dt) = [[Ad, Bd],[0, I]] */
export function zohDiscretize(A: number[][], B: number[], dt: number): DiscreteSystem {
  const n = A.length;
  const M: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A[i][j] * dt;
    M[i][n] = B[i] * dt;
  }
  const E = expm(M);
  const Ad: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => E[i][j]));
  const Bd = Array.from({ length: n }, (_, i) => E[i][n]);
  return { Ad, Bd, n };
}

void mm2m; void L2m3;
