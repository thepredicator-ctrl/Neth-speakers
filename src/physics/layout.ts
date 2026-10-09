/*
 * Neth Speakers — driver assembly layout. THE single source of truth.
 *
 * Every anchor height and radius of the driver — in SI metres — is computed
 * here from DriverParams. The 3D geometry (src/three/geometry.ts), the
 * excursion limits (tsp.ts) and the statistics readouts all consume THIS
 * module, so a change to any parameter updates the model, the render and the
 * numbers together. Nothing else in the codebase may derive its own Y/R.
 *
 * Axis convention (matches geometry.ts):
 *   +Y = forward (cone radiates toward +Y), y = 0 is the baffle/gasket plane,
 *   the motor hangs below (−Y).
 *
 * Assembly chain (who bonds to whom):
 *   cone outer edge  → surround inner edge (same radius, shared seat plane)
 *   surround outer   → frame front-flange seat (flat landing)
 *   cone inner edge  → voice-coil former top (same radius, glue lip)
 *   former           → carries the winding; winding straddles the magnetic gap
 *   spider inner     → bonded to the bare former section ABOVE the winding
 *   spider outer     → seated on the basket shelf ring
 *   former bottom    → open tube sliding over the pole, stops before back plate
 *
 * Excursion limits (one-way, metres) are GEOMETRIC hard stops:
 *   down: spider inner edge reaching the top-plate top face
 *   down: former bottom reaching the back-plate top face
 *   down/up: surround roll flattening/inverting (documented approximation,
 *            SURROUND_TRAVEL_FACTOR × rollHeight — see docs/PHYSICS.md)
 */
import type { DriverParams } from './types';
import { mm2m } from './units';

export interface DriverLayout {
  /* ---- radii (m) ---- */
  rConeIn: number;      // cone body inner radius (bonds to former outer wall)
  rConeOut: number;     // cone body outer radius (bonds to surround inner edge)
  rSurfIn: number;      // surround inner radius == rConeOut
  rSurfOut: number;     // surround outer radius (bonds to frame seat)
  rFormer: number;      // former inner radius
  rFormerOut: number;   // former outer radius (spider bond radius)
  rWindOuter: number;   // outer radius of the complete winding stack
  rPole: number;        // centre pole outer radius
  rGapInner: number;    // top-plate bore radius == rPole + gapWidth
  rTopOD: number;
  rMagOD: number;
  rMagID: number;
  rBackOD: number;
  rFrameOut: number;    // frame flange outer radius
  rSpIn: number;        // spider inner radius == rFormerOut (bonded)
  rSpOut: number;       // spider outer radius (seated on shelf)

  /* ---- axial anchors (m, y up, 0 = baffle plane) ---- */
  ySeat: number;            // surround/cone seat plane (0)
  yConeInner: number;       // cone at voice-coil junction
  yFormerTop: number;       // former top, flush under cone junction
  yFormerBottom: number;
  yWindTop: number;         // winding top
  yWindBottom: number;
  yWindC: number;           // winding centre
  yGapC: number;            // magnetic gap centre == winding centre + position
  yTopPlateTop: number;
  yTopPlateBottom: number;
  yMagTop: number;
  yMagBottom: number;
  yBackTop: number;
  yBackBottom: number;
  ySpider: number;          // spider rest plane (bond height on former)
  yShelfTop: number;        // basket shelf top face == ySpider (spider seated)
  yFrameSeat: number;       // frame flange top face (surround outer landing)
  yFrameRear: number;       // frame rear ring anchor

  /* ---- derived stats (SI) ---- */
  windH: number;         // winding height (m)
  gapH: number;          // magnetic gap height (m)
  overhang: number;      // coil overhang (m): (windH − gapH)/2, <0 = underhung
  XmaxGeo: number;       // coil-in-gap linear excursion (m, config-derived)
  XmechGeo: number;      // geometric one-way mechanical limit (m)
  maxDown: number;       // excursion capability downward (m)
  maxUp: number;         // excursion capability upward (m)
  spiderClear: number;   // rest clearance spider plane→top-plate top (m)
  formerClear: number;   // rest clearance former bottom→back plate (m)
  surroundLimit: number; // roll capability one-way (m)
  bondDrop: number;      // junction→spider bond distance (m)
  glueGap: number;       // spider bond→winding top (m)
  xmechTarget: number;   // excursion target the layout was sized for (m)
  requiredFormerH: number; // minimum former height housing bond+winding+margin (m)
  requiredMagStack: number; // minimum total magnet stack for the target (m)
}

/** Surround roll one-way capability (documented approximation). */
export const SURROUND_TRAVEL_FACTOR = 1.25;

const GLUE = 2e-3;          // spider bond → winding top curtain
const BOTTOM_MARGIN = 2e-3; // bare former below winding
const PLATE_CLEAR = 1e-3;   // min spider→plate / former→backplate clearance

/** Pure layout computation. Defensive against any parameter combination:
 *  the result always describes a buildable assembly (radii positive, motor
 *  below the cone, spider bonded on bare former, coil straddling the gap). */
export function computeLayout(d: DriverParams): DriverLayout {
  /* ---- radii ---- */
  const rConeOut = mm2m(d.cone.outerDiameter) / 2;
  const rSurfIn = rConeOut;                                    // bonded
  const rollW = mm2m(d.surround.rollWidth);
  const rSurfOut = rSurfIn + rollW;                             // bonded to seat
  const rFormer = mm2m(d.coil.formerDiameter) / 2;
  const fT = Math.max(0.1e-3, mm2m(d.coil.formerThickness));
  const rFormerOut = rFormer + fT;
  const wireD = Math.max(0.02e-3, mm2m(d.coil.wireDiameter));
  const layers = Math.max(1, Math.min(4, Math.round(d.coil.layers)));
  const rWindOuter = rFormerOut + layers * wireD;
  const rPole = mm2m(d.magnet.poleDiameter) / 2;
  const gapW = Math.max(mm2m(d.magnet.gapWidth), rWindOuter - rPole + 0.25e-3);
  const rGapInner = rPole + gapW;
  const rTopOD = Math.max(mm2m(d.magnet.topPlateDiameter) / 2, rGapInner + 1e-3);
  const rMagOD = Math.max(mm2m(d.magnet.diameter) / 2, rTopOD);
  const rMagID = Math.min(Math.max(mm2m(d.magnet.innerDiameter) / 2, rPole), rMagOD - 0.5e-3);
  const rBackOD = Math.max(mm2m(d.magnet.backPlateDiameter) / 2, rMagOD);
  const rFrameOut = rSurfOut + mm2m(6);
  const rSpIn = rFormerOut;                                     // bonded to former
  const rSpOut = Math.max(mm2m(d.spider.outerDiameter) / 2, rSpIn + 5e-3);

  /* ---- winding & gap ---- */
  const pitch = wireD * 1.08;
  const turns = Math.max(1, Math.round(d.coil.turnsPerLayer));
  const userH = d.coil.windingHeight != null ? mm2m(d.coil.windingHeight) : 0;
  const gapH = Math.max(0.4e-3, mm2m(d.magnet.topPlateThickness));
  const windHAuto = Math.min(turns * pitch, 200e-3);
  const windH = Math.max(wireD, userH > 0 ? userH : windHAuto);
  const overhang = (windH - gapH) / 2;                          // >0 overhung
  const XmaxGeo = Math.max(0, overhang);                        // one-way linear (m)

  /* ---- excursion target drives the spider-bond placement ---- */
  const surroundLimit = Math.max(0.5e-3, mm2m(d.surround.rollHeight) * SURROUND_TRAVEL_FACTOR);
  const xmechOverrideM = d.xmechOverride != null ? mm2m(d.xmechOverride) : 0;
  const xmaxOverrideM = d.xmaxOverride != null ? mm2m(d.xmaxOverride) : 0;
  const target = Math.max(
    4e-3,
    Math.min(
      Math.max(1.3 * XmaxGeo, 4e-3, xmechOverrideM, 1.15 * xmaxOverrideM),
      Math.max(surroundLimit, XmaxGeo) + 2e-3,
    ),
  );

  /* ---- axial chain, top to bottom ---- */
  const depth = Math.max(2e-3, mm2m(d.cone.depth));
  const ySeat = 0;
  const yConeInner = -depth;
  const yFormerTop = yConeInner + 0.5e-3;                       // flush junction

  const pos = mm2m(d.coil.position);
  // Spider bond drop from the cone junction; the glue curtain below it is
  // sized so that after a full down-stroke the spider plane still clears the
  // top-plate top face: spiderClear = glueGap + overhang − pos − PLATE_CLEAR.
  const bondDrop = Math.max(3e-3, GLUE - overhang - pos + PLATE_CLEAR + target);
  const glueGap = Math.max(GLUE, PLATE_CLEAR + target - overhang + pos);
  const ySpider = yFormerTop - bondDrop;

  const yWindTop = ySpider - glueGap;
  const yWindC = yWindTop - windH / 2 + pos;                    // + = toward front
  const yWindBottom = yWindTop - windH;
  const yGapC = yWindC;                                          // gap anchored to coil
  const yTopPlateTop = yGapC + gapH / 2;
  const yTopPlateBottom = yGapC - gapH / 2;

  const magN = Math.max(1, Math.round(d.magnet.count));
  const magThk = Math.max(1e-3, mm2m(d.magnet.thickness));
  const yMagTop = yTopPlateTop;
  const yMagBottom = yMagTop - magN * magThk;
  const backThk = Math.max(1e-3, mm2m(d.magnet.backPlateThickness));
  const yBackTop = yMagBottom;
  const yBackBottom = yBackTop - backThk;

  // The former must HOUSE the bond zone + winding + bottom margin. Its bottom
  // clearance to the back plate is restored by a DEEPER magnet stack (what
  // real long-throw motors do) — reported as requiredMagStack for the
  // sanitiser; the layout itself only guarantees a buildable housing.
  const requiredFormerH = bondDrop + glueGap + windH + BOTTOM_MARGIN;
  const formerH = Math.max(3e-3, mm2m(d.coil.formerHeight), requiredFormerH);
  const yFormerBottom = yFormerTop - formerH;
  const formerClear = Math.max(0, yFormerBottom - yBackTop - 0.5e-3);
  // stack depth needed so the former bottom keeps `target` clearance at the
  // back plate even at a full down-stroke:
  //   formerClear = −formerH + bondDrop + glueGap + windH/2 − pos − gapH/2
  //                 + magN·magThk − 0.5mm  ≥ target
  const requiredMagStack = Math.max(
    magN * magThk,
    formerH - bondDrop - glueGap - windH / 2 + pos + gapH / 2 + 0.5e-3 + target,
  );

  const yShelfTop = ySpider;                                     // spider seated on shelf
  const yFrameSeat = ySeat + 1.4e-3;                             // flange top face
  const yFrameRear = yBackBottom + backThk * 0.4;

  /* ---- geometric excursion limits ---- */
  const spiderClear = Math.max(0, ySpider - yTopPlateTop - PLATE_CLEAR);
  const maxDown = Math.min(spiderClear, formerClear, surroundLimit);
  const maxUp = surroundLimit;
  const XmechGeo = Math.min(maxDown, maxUp);

  return {
    rConeIn: rFormerOut, rConeOut, rSurfIn, rSurfOut,
    rFormer, rFormerOut, rWindOuter,
    rPole, rGapInner, rTopOD, rMagOD, rMagID, rBackOD, rFrameOut, rSpIn, rSpOut,
    ySeat, yConeInner, yFormerTop, yFormerBottom,
    yWindTop, yWindBottom, yWindC, yGapC,
    yTopPlateTop, yTopPlateBottom, yMagTop, yMagBottom, yBackTop, yBackBottom,
    ySpider, yShelfTop, yFrameSeat, yFrameRear,
    windH, gapH, overhang, XmaxGeo, XmechGeo, maxDown, maxUp,
    spiderClear, formerClear, surroundLimit, bondDrop, glueGap,
    xmechTarget: target, requiredFormerH, requiredMagStack,
  };
}

/* ---------------------------------------------------------------------------
 * Deformable suspension profiles (pure — unit-testable, no THREE dependency).
 * Both generators return lathe profiles [r, y] whose ENDPOINTS ARE EXACTLY
 * ATTACHED at every excursion: the inner edge rides with the coil (x), the
 * outer edge stays seated on the frame. Nothing floats, nothing detaches.
 * ------------------------------------------------------------------------- */

/**
 * Surround profile: flat inner glue tab on the cone edge, `rolls` arc(s)
 * whose bulge flattens continuously as |x| approaches the roll capability,
 * flat outer landing tab on the frame seat.
 *   inner edge == (rSurfIn, ySeat + x) exactly
 *   outer edge == (rSurfOut, yFrameSeat) exactly
 */
export function surroundProfile(
  L: DriverLayout, rollHeightM: number, rollCount: number, x: number, nPerRoll = 18,
): [number, number][] {
  const pts: [number, number][] = [];
  const rolls = Math.max(1, Math.round(rollCount));
  const span = L.rSurfOut - L.rSurfIn;
  const y0 = L.ySeat + x;                       // cone edge (moves)
  const y1 = L.yFrameSeat;                      // frame seat (fixed)
  const flat = Math.min(1, Math.abs(x) / Math.max(1e-4, rollHeightM * SURROUND_TRAVEL_FACTOR));
  // continuous squash: fully free at rest, ~8% residual bulge at the limit
  const squash = Math.max(0.08, Math.sqrt(Math.max(0, 1 - flat * flat)) - Math.max(0, flat - 0.9) * 1.2);
  const tabIn = 0.06, tabOut = 0.10;            // glue tabs (fraction of span)
  const n1 = 4, n3 = 5;
  for (let i = 0; i <= n1; i++) {               // inner flat tab (bonded to cone)
    const t = (tabIn * i) / n1;
    pts.push([L.rSurfIn + span * t, y0]);
  }
  const nMid = nPerRoll * rolls;
  for (let i = 0; i <= nMid; i++) {             // roll arc(s)
    const u = i / nMid;
    const t = tabIn + (1 - tabIn - tabOut) * u;
    const phase = u * rolls * Math.PI;          // 0..π per roll
    const r = L.rSurfIn + span * t;
    const base = y0 + (y1 - y0) * u;
    pts.push([r, base + rollHeightM * squash * Math.sin(phase)]);
  }
  for (let i = 0; i <= n3; i++) {               // outer flat landing (bonded to seat)
    const r = L.rSurfOut - span * tabOut * (1 - i / n3);
    pts.push([r, y1]);
  }
  return pts.map(([r, y]) => [Math.max(r, 1e-4), y] as [number, number]);
}

/**
 * Spider profile: corrugated disc from the former bond (inner edge rides with
 * x) to the basket shelf (outer edge fixed). Corrugation amplitude decays
 * with excursion; the ride envelope pins both endpoints exactly.
 */
export function spiderProfile(
  L: DriverLayout, corrugations: number, corrDepthM: number, x: number, n = 44,
): [number, number][] {
  const pts: [number, number][] = [];
  const corrN = Math.max(0, Math.round(corrugations));
  const span = L.rSpOut - L.rSpIn;
  const amp = corrDepthM / (1 + Math.abs(x) / (0.55 * corrDepthM + 0.4e-3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = L.rSpIn + span * t;
    const ride = x * (1 - t) * (1 - t);         // inner rides fully, outer fixed
    const env = Math.sin(t * Math.PI);          // zero at both bonds
    const y = L.ySpider + ride + amp * env * Math.sin(corrN * t * Math.PI * 2);
    pts.push([r, y]);
  }
  return pts.map(([r, y]) => [Math.max(r, 1e-4), y] as [number, number]);
}

/** Minimum former height (m) that houses bond zone + winding + bottom margin. */
export function minFormerHeightM(d: DriverParams): number {
  return computeLayout(d).requiredFormerH;
}
