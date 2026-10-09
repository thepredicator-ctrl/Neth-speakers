/*
 * Thiele–Small parameter computation.
 *
 * Combines geometry-driven estimates (winding, magnetic circuit, masses,
 * suspension stiffness) with user overrides, then derives the classic
 * small-signal parameters:
 *
 *   Fs  = 1 / (2π·√(Mms·Cms))
 *   Qms = 2π·Fs·Mms / Rms
 *   Qes = 2π·Fs·Mms·Re / Bl²
 *   Qts = Qms·Qes / (Qms + Qes)
 *   Vas = ρ0·c²·Sd²·Cms
 *   η0  = ρ0·Bl²·Sd² / (2π·c·Re·Mms²)     (reference efficiency)
 *   SPL ≈ 112.02 + 10·log10(η0)           (1 W / 1 m, half-space, mass region)
 *
 * Xmax (one-way linear excursion):
 *   overhung : (gap height − winding height) / 2
 *   underhung: (winding height − gap height) / 2
 */
import type { DriverParams, TSParams } from './types';
import { computeWinding } from './winding';
import { computeMagnet, estimateLe } from './magnet';
import { RHO0, C_SOUND, mm2m, g2kg, clamp } from './units';
import type { MaterialDef } from './materials';

export function computeTS(p: DriverParams, mats: (id: string) => MaterialDef | undefined): TSParams {
  const w = computeWinding(p.coil, mats);
  const mag = computeMagnet(p.magnet, p.coil, w, mats);

  // --- Sd -----------------------------------------------------------------
  const Sd = (Math.PI / 4) * Math.pow(mm2m(p.cone.effectiveDiameter), 2);
  const aEff = Math.sqrt(Sd / Math.PI);

  // --- Masses -------------------------------------------------------------
  const coneMat = mats(p.cone.materialId);
  const dustMat = mats(p.cone.dustCapMaterialId);
  const surrMat = mats(p.surround.materialId);
  const spiderMat = mats(p.spider.materialId);

  const rIn = mm2m(p.coil.windingDiameter) / 2 + mm2m(p.coil.formerThickness);
  const rOut = mm2m(p.cone.outerDiameter) / 2;
  const depth = Math.max(0.5e-3, mm2m(p.cone.depth));
  const tCone = Math.max(0.05e-3, mm2m(p.cone.thickness));
  const slant = Math.sqrt(Math.pow(rOut - rIn, 2) + depth * depth);
  const coneArea = Math.PI * (rIn + rOut) * slant;
  const coneMassCalc = (coneMat?.density ?? 480) * coneArea * tCone;

  const capR = mm2m(p.cone.dustCapDiameter) / 2;
  const capArea = p.cone.dustCapShape === 'flat'
    ? Math.PI * capR * capR
    : Math.PI * capR * capR * 1.42; // shallow dome area factor
  const capMassCalc = (dustMat?.density ?? 550) * capArea * Math.max(0.2e-3, mm2m(p.cone.thickness));

  const surrMassCalc =
    (surrMat?.density ?? 1100) *
    (Math.PI * (mm2m(p.surround.innerDiameter) + mm2m(p.surround.rollWidth * 2)) * mm2m(p.surround.rollWidth) * 3.1) *
    Math.max(0.1e-3, mm2m(p.surround.thickness));

  const spiderMassCalc =
    (spiderMat?.density ?? 600) *
    (Math.PI * (mm2m(p.spider.innerDiameter) + mm2m(p.spider.outerDiameter)) / 2 * 2 * Math.PI *
      (mm2m(p.spider.outerDiameter) - mm2m(p.spider.innerDiameter)) / 2 * 1.6) *
    Math.max(0.05e-3, mm2m(p.spider.thickness));

  const airLoad = (8 / 3) * RHO0 * Math.pow(aEff, 3); // one side, baffled piston (low-freq)

  const mParts = {
    cone: p.cone.mass != null ? g2kg(p.cone.mass) : coneMassCalc,
    dustCap: p.cone.dustCapMass != null ? g2kg(p.cone.dustCapMass) : capMassCalc,
    coil: p.coil.mass != null ? g2kg(p.coil.mass) : w.coilMass,
    surround: surrMassCalc / 2,   // half of surround moves with cone (textbook rule)
    spider: spiderMassCalc / 3,   // inner third effectively moves
    air: airLoad,
  };
  const Mms = p.coil.mass != null || p.cone.mass != null
    ? mParts.cone + mParts.dustCap + mParts.coil + mParts.surround + mParts.spider + mParts.air
    : mParts.cone + mParts.dustCap + mParts.coil + mParts.surround + mParts.spider + mParts.air;

  // --- Suspension ----------------------------------------------------------
  const Kspider = Math.max(1, p.spider.stiffness);
  const Ksurround = Math.max(0.1, p.surround.stiffness);
  const Kms = Kspider + Ksurround;
  const Cms = 1 / Kms;

  const Fs = 1 / (2 * Math.PI * Math.sqrt(Mms * Cms));

  // --- Electrical ----------------------------------------------------------
  const Re = p.coil.re != null ? p.coil.re : w.Re;
  const LeEst = p.coil.le != null ? p.coil.le * 1e-3 : estimateLe(p.magnet, w, mag.turnsInGap);
  const Bl = p.magnet.bl != null ? p.magnet.bl : mag.Bl;
  const Bgap = p.magnet.bGap != null ? p.magnet.bGap : mag.Bgap;

  // --- Damping -------------------------------------------------------------
  const Rms = p.rmsOverride != null && p.rmsOverride > 0
    ? p.rmsOverride
    : p.surround.damping + p.spider.damping + defaultRms(Fs, Mms, p.qmsTarget);

  // --- Q factors ------------------------------------------------------------
  const Qms = (2 * Math.PI * Fs * Mms) / Rms;
  const Qes = (2 * Math.PI * Fs * Mms * Re) / (Bl * Bl);
  const Qts = (Qms * Qes) / (Qms + Qes);
  const Vas = RHO0 * C_SOUND * C_SOUND * Sd * Sd * Cms * 1e3; // litres

  // --- Excursion limits ------------------------------------------------------
  const gapH = mm2m(p.magnet.topPlateThickness);
  const windH = w.windingHeight;
  // Overhung: winding TALLER than gap → Xmax = (h_coil − h_gap)/2
  // Underhung: winding SHORTER than gap → Xmax = (h_gap − h_coil)/2
  const xmaxCalc = p.coil.config === 'overhung'
    ? Math.max(0, (windH - gapH) / 2)
    : Math.max(0, (gapH - windH) / 2);
  const Xmax = p.xmaxOverride != null ? p.xmaxOverride : clamp(xmaxCalc * 1e3, 0, 100);
  const XmechDefault = Math.max(Xmax * 2.5, 1);
  const Xmech = p.xmechOverride != null ? p.xmechOverride : XmechDefault;

  // --- Efficiency & sensitivity ------------------------------------------------
  const eta0 = (RHO0 * Bl * Bl * Sd * Sd) / (2 * Math.PI * C_SOUND * Re * Mms * Mms);
  const sens = 112.02 + 10 * Math.log10(Math.max(eta0, 1e-9));

  const VasOut = p.vasOverride != null ? p.vasOverride : Vas;

  return {
    Sd, Mms, Cms, Kms, Rms, Bl, Re, Le: LeEst, Bgap,
    Fs, Qms, Qes, Qts, Vas: VasOut,
    Xmax, Xmech,
    eta0, sens,
    wireLength: w.wireLength,
    turnsTotal: w.totalTurns,
    turnsInGap: mag.turnsInGap,
    airLoadMass: airLoad,
    mmsParts: mParts,
  };
}

/** Default mechanical resistance from a target mechanical Q (default Qms ≈ 5). */
export function defaultRms(fs: number, mms: number, qmsTarget = 5): number {
  const q = clamp(qmsTarget, 0.5, 20);
  return (2 * Math.PI * fs * mms) / q;
}
