/*
 * Magnetic-circuit approximation for a moving-coil motor.
 *
 * 1-D reluctance model of a permanent-magnet circuit:
 *   B_gap = Br·A_m / (σ·A_g + μr·A_m·l_g/l_m)
 *
 * where A_m = magnet cross-section, A_g = gap pole-surface area,
 * l_m = magnet axial length (stack), l_g = radial gap width, σ = leakage
 * factor (≥ 1; real ferrite structures leak heavily — 1.6…2.2 typical),
 * μr = recoil permeability of the magnet.
 *
 * Force factor Bl = B_gap × (conductor length inside the gap).
 *
 * This is an ENGINEERING APPROXIMATION (no FEM): leakage, fringing and
 * saturation of the steel are lumped into σ. UI labels these values as
 * estimates and the user can override Bl / B directly.
 */
import type { MagnetParams, VoiceCoilParams } from './types';
import type { MaterialDef } from './materials';
import { mm2m, MU0 } from './units';
import type { WindingResult } from './winding';

export interface MagnetResult {
  Bgap: number;          // T
  Bl: number;            // T·m
  gapArea: number;       // m²  (π·D_pole·h_gap)
  magnetArea: number;    // m²  (ring cross-section)
  turnsInGap: number;
  wireLengthInGap: number; // m
  utilization: number;   // fraction of total wire inside gap
  saturationWarn: boolean; // estimated steel flux above ~1.6 T
}

export function computeMagnet(
  m: MagnetParams, c: VoiceCoilParams, w: WindingResult,
  mats: (id: string) => MaterialDef | undefined
): MagnetResult {
  const mag = mats(m.materialId);
  const Br = mag?.br ?? 0.4;
  const muR = mag?.muR ?? 1.1;

  const lG = Math.max(0.05e-3, mm2m(m.gapWidth));
  const hGap = Math.max(0.5e-3, mm2m(m.topPlateThickness));
  const dPole = Math.max(2e-3, mm2m(m.poleDiameter));
  const gapArea = Math.PI * dPole * hGap;

  const lM = Math.max(0.5e-3, mm2m(m.thickness) * Math.max(1, m.count));
  const ringOD = mm2m(m.diameter);
  const ringID = mm2m(m.innerDiameter);
  const magnetArea = (Math.PI / 4) * Math.max(1e-4, ringOD * ringOD - ringID * ringID);

  const sigma = Math.max(1, m.leakageFactor);
  const denom = sigma * gapArea + muR * magnetArea * (lG / lM);
  // Iron saturation ceiling: the pole/plate steel saturates near ~1.6 T, which
  // caps the achievable gap flux regardless of magnet strength.
  const B_SAT = 1.6;
  const Bgap = Math.min((Br * magnetArea) / Math.max(denom, 1e-12), B_SAT);

  // Conductor length inside the gap.
  const turnsPerLayer = Math.max(1, Math.round(c.turnsPerLayer));
  const layers = Math.max(1, Math.min(4, Math.round(c.layers)));
  const turnsPerLayerInGap =
    c.config === 'underhung'
      ? turnsPerLayer
      : Math.min(turnsPerLayer, Math.floor(hGap / w.pitch));
  const turnsInGap = layers * turnsPerLayerInGap;
  const wireLengthInGap = Math.PI * w.meanWindingDiameter * turnsInGap;
  const Bl = Bgap * wireLengthInGap;

  // Rough saturation check: pole flux vs 1.6 T steel limit.
  const poleFlux = Bgap * gapArea;
  const poleArea = (Math.PI / 4) * dPole * dPole;
  const saturationWarn = poleFlux / Math.max(poleArea, 1e-9) > 1.6;

  return {
    Bgap, Bl, gapArea, magnetArea,
    turnsInGap, wireLengthInGap,
    utilization: w.totalTurns > 0 ? turnsInGap / w.totalTurns : 0,
    saturationWarn,
  };
}

/** Sanity estimate: air-core part of coil inductance (used for Le estimate). */
export function estimateLe(m: MagnetParams, w: WindingResult, turnsInGap: number): number {
  // Gap-dominated component: μ0·N²·A_gap / l_g  (reluctance of the gap itself)
  const lG = Math.max(0.05e-3, mm2m(m.gapWidth));
  const gapL = MU0 * turnsInGap * turnsInGap * Math.max(w.meanWindingDiameter * mm2m(m.topPlateThickness) * Math.PI, 1e-9) / lG;
  // Air-core component of the full winding (order-of-magnitude)
  const hw = Math.max(1e-3, w.windingHeight);
  const area = Math.PI * Math.pow(w.meanWindingDiameter / 2, 2);
  const airL = MU0 * w.totalTurns * w.totalTurns * area / Math.max(hw, 1e-4) * 0.65;
  return gapL * 0.35 + airL * 0.35;
}

void mm2m;
