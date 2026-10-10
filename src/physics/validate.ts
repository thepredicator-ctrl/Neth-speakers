/*
 * Neth Speakers — parameter sanitization & self-balancing.
 *
 * EVERY value entering the design state passes through here. Guarantees:
 *   1. No NaN/Infinity can ever reach the physics, the UI or the 3D model.
 *   2. Every number is clamped to a physically plausible range.
 *   3. Interdependent values are automatically re-balanced so the model stays
 *      buildable: the surround always lands on the cone edge, the coil always
 *      fits the magnetic gap, the magnet always covers the top plate, the
 *      spider always bonds to the former, the frame always houses the motor,
 *      the port always fits inside the box.
 *
 * The result is a design in which it is impossible to produce a broken or
 * diverging simulation by editing values — extreme edits bend the design
 * instead of breaking it.
 */
import type {
  DriverParams, EnclosureParams, AmplifierParams, AudioSettings, SimSettings,
  ConeParams, SurroundParams, SpiderParams, VoiceCoilParams, MagnetParams, FrameParams,
} from './types';
import { computeLayout, minFormerHeightM } from './layout';

/* ------------------------------------------------------------------ */
/* primitive helpers                                                   */
/* ------------------------------------------------------------------ */

/** Finite number within [min,max]; falls back on NaN/null/undefined. */
export function num(v: unknown, min: number, max: number, fallback: number): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Integer within [min,max]. */
export function int(v: unknown, min: number, max: number, fallback: number): number {
  return Math.round(num(v, min, max, fallback));
}

/** Finite string-coercible or pass-through (colors etc.). */
export function str<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function hexColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

/** Overridable: null (=auto) or a sane positive number. */
export function ovr(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/* ------------------------------------------------------------------ */
/* driver                                                              */
/* ------------------------------------------------------------------ */

export function sanitizeCone(c: ConeParams): ConeParams {
  const outer = num(c.outerDiameter, 25, 800, 220);
  return {
    ...c,
    outerDiameter: outer,
    // effective radiating diameter is AUTO-TRACKED in sanitizeDriver
    // (cone body + half the surround roll); this clamp is a defensive bound.
    effectiveDiameter: clamp(num(c.effectiveDiameter, outer * 0.4, outer * 1.5, outer), 12, 760),
    depth: num(c.depth, 2, 150, 34),
    angleDeg: num(c.angleDeg, 5, 89, 65),
    thickness: num(c.thickness, 0.05, 10, 0.9),
    mass: ovr(c.mass, 0.1, 500),
    dustCapDiameter: clamp(num(c.dustCapDiameter, 0, outer * 0.75, 55), 0, 600),
    dustCapMass: ovr(c.dustCapMass, 0.05, 200),
    color: hexColor(c.color, '#26221c'),
  };
}

export function sanitizeSurround(s: SurroundParams, coneOuter?: number): SurroundParams {
  const inner = coneOuter != null ? coneOuter : num(s.innerDiameter, 20, 820, 220);
  // rollWidth up to 70 mm: 21"/24" SPL subs run 36–45 mm half-rolls
  const rollWidth = num(s.rollWidth, 2, 70, 13);
  return {
    ...s,
    // AUTO-BALANCE: the surround inner edge always bonds to the cone edge,
    // and the outer edge always lands at inner + 2×rollWidth.
    innerDiameter: inner,
    outerDiameter: inner + 2 * rollWidth,
    rollCount: int(s.rollCount, 1, 2, 1),
    // rollHeight up to 110 mm: monster/SPL builds (18"–24" and beyond) ship
    // 32–60 mm rolls; the roll capability is 1.25 × rollHeight (layout.ts) so
    // a 48 mm roll supports ~60 mm one-way travel, a 110 mm roll ~137 mm.
    rollHeight: num(s.rollHeight, 0.5, 110, 9),
    rollWidth,
    thickness: num(s.thickness, 0.05, 5, 1.2),
    stiffness: num(s.stiffness, 1, 200000, 520),
    damping: num(s.damping, 0.001, 200, 0.55),
    color: hexColor((s as { color?: unknown }).color, '#17181c'),
  };
}

export function sanitizeSpider(sp: SpiderParams, coilFormerOuterMM?: number, topPlateDiamMM?: number): SpiderParams {
  // AUTO-BALANCE: the spider inner edge is BONDED to the former outer wall —
  // the diameters are identical, so the bond can never float or overlap.
  const inner = coilFormerOuterMM != null ? coilFormerOuterMM : num(sp.innerDiameter, 8, 400, 42);
  let outer = num(sp.outerDiameter, inner + 10, 700, Math.max(inner + 40, 120));
  if (topPlateDiamMM != null) outer = clamp(outer, inner + 10, Math.max(inner + 10, topPlateDiamMM + 12));
  return {
    ...sp,
    innerDiameter: inner,
    outerDiameter: outer,
    corrugations: int(sp.corrugations, 0, 24, 9),
    corrDepth: num(sp.corrDepth, 0.2, 20, 3.2),
    thickness: num(sp.thickness, 0.02, 3, 0.35),
    stiffness: num(sp.stiffness, 10, 1000000, 1080),
    damping: num(sp.damping, 0.001, 500, 0.85),
    color: hexColor((sp as { color?: unknown }).color, '#8a7a5c'),
  };
}

export function sanitizeCoil(c: VoiceCoilParams, poleDiameterMM?: number): VoiceCoilParams {
  const wireD = num(c.wireDiameter, 0.05, 3, 0.45);
  const fT = num(c.formerThickness, 0.05, 5, 0.25);
  // AUTO-BALANCE: the former is a tube sliding over the centre pole — its ID
  // always clears the pole OD by a 0.3 mm radial sliding gap per side.
  const minFormerID = poleDiameterMM != null ? poleDiameterMM + 0.6 : 5;
  const formerD = Math.max(num(c.formerDiameter, 5, 300, 49.4), minFormerID);
  const layers = int(c.layers, 1, 4, 4);
  // AUTO-BALANCE: the first winding layer sits ON the former — winding
  // diameter can never be smaller than former OD + 2×thickness + wire.
  const minWind = formerD + 2 * fT + wireD;
  const windingD = Math.max(num(c.windingDiameter, 5, 320, 51), minWind);
  // winding height must leave glue margin on the former
  const formerH = num(c.formerHeight, 3, 150, 26);
  const turnsPerLayer = int(c.turnsPerLayer, 1, 400, 34);
  const maxTurnsFromHeight = Math.max(1, Math.floor((formerH - 3) / (wireD * 1.08)));
  const tpl = Math.min(turnsPerLayer, maxTurnsFromHeight);
  return {
    ...c,
    windingDiameter: windingD,
    formerDiameter: formerD,
    formerHeight: formerH,
    formerThickness: fT,
    wireDiameter: wireD,
    layers,
    turnsPerLayer: tpl,
    windingHeight: ovr(c.windingHeight, 1, formerH * 0.98),
    temperatureC: num(c.temperatureC, -20, 250, 30),
    position: num(c.position, -formerH / 2, formerH / 2, 0),
    mass: ovr(c.mass, 0.1, 300),
    re: ovr(c.re, 0.1, 200),
    le: ovr(c.le, 0.001, 20),
  };
}

export function sanitizeMagnet(m: MagnetParams, coilOuterMM?: number): MagnetParams {
  const pole = num(m.poleDiameter, 4, 260, 50);
  const tpt = num(m.topPlateThickness, 0.5, 40, 7);
  // AUTO-BALANCE: the coil stack (incl. all layers + air clearance) must fit
  // the gap. Widen the top plate (gap) if the coil grew instead of crushing
  // the coil into the pole. gapWidth is RADIAL: coil outer radius − pole radius.
  const gapNeedMM = coilOuterMM != null ? coilOuterMM - pole / 2 + 0.35 : num(m.gapWidth, 0.2, 20, 1);
  const gapWidth = Math.max(num(m.gapWidth, 0.2, 20, 1), gapNeedMM);
  const topPlate = Math.max(num(m.topPlateDiameter, pole + 2 * gapWidth, 600, 110), pole + 2 * gapWidth);
  // magnet ring must cover the top plate and clear the pole
  const magD = Math.max(num(m.diameter, topPlate, 800, 120), topPlate);
  const inner = clamp(num(m.innerDiameter, 5, magD - 2, 52), pole, magD - 2);
  const backD = Math.max(num(m.backPlateDiameter, magD, 800, magD), magD);
  return {
    ...m,
    poleDiameter: pole,
    gapWidth,
    topPlateDiameter: topPlate,
    topPlateThickness: tpt,
    diameter: magD,
    innerDiameter: inner,
    thickness: num(m.thickness, 2, 80, 18),
    count: int(m.count, 1, 6, 1),
    backPlateDiameter: backD,
    backPlateThickness: num(m.backPlateThickness, 2, 60, 8),
    leakageFactor: num(m.leakageFactor, 1, 6, 2.2),
    bl: ovr(m.bl, 0.05, 80),
    bGap: ovr(m.bGap, 0.02, 3),
    painted: (m as { painted?: unknown }).painted === true,
  };
}

export function sanitizeFrame(f: FrameParams, minDepthMM?: number): FrameParams {
  // AUTO-BALANCE: the frame always houses the full moving motor stack.
  const depth = minDepthMM != null
    ? Math.max(num(f.depth, 10, 500, 92), minDepthMM)
    : num(f.depth, 10, 500, 92);
  return {
    ...f,
    depth,
    gasketThickness: num(f.gasketThickness, 0, 8, 1.5),
    terminals: str(f.terminals, ['push', 'solder', 'spring'] as const, 'push'),
    tinselLeads: int(f.tinselLeads, 2, 4, 2),
    mountingHoles: int(f.mountingHoles, 0, 8, 4),
    color: hexColor((f as { color?: unknown }).color, '#33363c'),
    style: str((f as { style?: unknown }).style, ['stamped', 'diecast'] as const, 'stamped'),
    gasket: (f as { gasket?: unknown }).gasket !== false,
    // tri-state: true/false = user choice, null = auto (subwoofer class, layout.ts)
    boot: (f as { boot?: unknown }).boot === true
      ? true
      : (f as { boot?: unknown }).boot === false
        ? false
        : null,
  };
}

/** Minimum frame depth that can house cone + coil + magnet stack. */
export function minFrameDepthMM(d: DriverParams): number {
  return (
    d.cone.depth +
    d.coil.formerHeight * 0.72 +
    d.magnet.topPlateThickness +
    d.magnet.thickness * Math.max(1, d.magnet.count) +
    d.magnet.backPlateThickness
  ) * 0.86;
}

export function sanitizeDriver(d: DriverParams): DriverParams {
  const cone = sanitizeCone(d.cone);
  const surround = sanitizeSurround(d.surround, cone.outerDiameter);
  // sanitize the pole value first: the former ID depends on it (sliding fit)
  const poleSafe = num(d.magnet.poleDiameter, 4, 260, 50);
  let coil = sanitizeCoil(d.coil, poleSafe);
  // outer radius of the complete winding stack (mm)
  const coilOuterMM =
    coil.windingDiameter / 2 + (coil.layers - 1) * coil.wireDiameter + coil.wireDiameter / 2;
  let magnet = sanitizeMagnet(d.magnet, coilOuterMM);
  const spider = sanitizeSpider(d.spider, coil.formerDiameter + 2 * coil.formerThickness, magnet.topPlateDiameter);

  // AUTO-BALANCE: the surround STRIP must be proportionate to the cone. A
  // big cone on a skinny ribbon looks broken and cannot carry a tall roll —
  // real subwoofer-class surrounds run ≈ 8 % of the cone diameter (X-12:
  // 20/240, 18" XL: 32/400, 24": 45/560). Grow the strip to match; a
  // deliberate wider choice is never shrunk.
  const rollWidthMin = Math.min(70, 0.08 * cone.outerDiameter);
  if (surround.rollWidth < rollWidthMin) {
    surround.rollWidth = rollWidthMin;
    surround.outerDiameter = surround.innerDiameter + 2 * surround.rollWidth;
  }

  // AUTO-BALANCE: the roll must CARRY the full linear excursion with real
  // headroom — a surround that bottoms out exactly at Xmax is how real
  // drivers get torn surrounds. SPL builds run the roll crest at ≈ 1.3 ×
  // Xmax (capability 1.25 × 1.3 ≈ 1.6 × Xmax one-way). It must also keep
  // crest body in proportion to the strip: a 40 mm-wide ribbon with a 9 mm
  // crest reads as a flat gasket, not a roll. Floor: ½ × roll width.
  // NOTE: rollHeight drives NO electrical stat — Sd comes from the strip
  // width, Xmax from the coil/gap — so a taller roll only widens the
  // mechanical envelope (more Xmech headroom), exactly like reality.
  const windHMM = (coil.windingHeight != null ? coil.windingHeight
    : coil.turnsPerLayer * coil.wireDiameter * 1.08);
  const xmaxCalcMM = coil.config === 'overhung'
    ? Math.max(0, (windHMM - magnet.topPlateThickness) / 2)
    : Math.max(0, (magnet.topPlateThickness - windHMM) / 2);
  const xmaxOvrMM = d.xmaxOverride != null ? (ovr(d.xmaxOverride, 0.05, 60) ?? 0) : 0;
  const xmaxTargetMM = Math.max(xmaxCalcMM, xmaxOvrMM);
  const rollHeightMin = Math.max(1.3 * xmaxTargetMM, 0.5 * surround.rollWidth);
  if (rollHeightMin > surround.rollHeight) {
    surround.rollHeight = Math.min(110, rollHeightMin);
  }

  // AUTO-BALANCE: the effective radiating diameter is DERIVED from the drawn
  // geometry — cone body + half the surround roll (piston extends to the
  // middle of the surround). Sd can never contradict the 3D model.
  cone.effectiveDiameter = clamp(
    cone.outerDiameter + surround.rollWidth,
    cone.outerDiameter * 0.5,
    cone.outerDiameter * 1.5,
  );

  // AUTO-BALANCE: converge the assembly — the former must house the bond and
  // winding, and the magnet stack must be deep enough that the former bottom
  // never reaches the back plate within the excursion target (what real
  // long-throw motors do). Both converge in one pass; loop for safety.
  let pre: DriverParams = { ...d, cone, surround, coil, magnet, spider };
  for (let i = 0; i < 3; i++) {
    const L = computeLayout(pre);
    let changed = false;
    const minFH = L.requiredFormerH * 1e3;
    if (coil.formerHeight < minFH - 1e-9) {
      coil = { ...coil, formerHeight: Math.min(300, minFH) };
      changed = true;
    }
    const needStack = L.requiredMagStack * 1e3;
    const curStack = magnet.thickness * Math.max(1, Math.round(magnet.count));
    if (curStack < needStack - 1e-9) {
      let count = Math.max(1, Math.round(magnet.count));
      let total = needStack;
      let thk: number;
      if (total / count <= 80) {
        thk = total / count;
      } else {
        count = Math.min(6, Math.ceil(total / 80));
        thk = Math.min(80, total / count);
      }
      magnet = { ...magnet, thickness: num(thk, 2, 80, magnet.thickness), count: int(count, 1, 6, magnet.count) };
      changed = true;
    }
    pre = { ...d, cone, surround, coil, magnet, spider };
    if (!changed) break;
  }

  const frame = sanitizeFrame(d.frame, minFrameDepthMM(pre));
  const out: DriverParams = {
    ...pre,
    frame,
    blDropAtXmech: num(d.blDropAtXmech, 0, 0.9, 0.25),
    kmsRiseAtXmax: num(d.kmsRiseAtXmax, 0, 3, 0.6),
    rmsOverride: ovr(d.rmsOverride, 0.01, 100),
    qmsTarget: num(d.qmsTarget, 0.3, 25, 5.2),
    xmechOverride: ovr(d.xmechOverride, 0.2, 120),
    xmaxOverride: ovr(d.xmaxOverride, 0.05, 60),
    vasOverride: ovr(d.vasOverride, 0.1, 5000),
    powerHandlingW: num((d as { powerHandlingW?: unknown }).powerHandlingW, 1, 10000, 150),
  };
  // AUTO-BALANCE: linear excursion can never exceed the mechanical limit.
  if (out.xmaxOverride != null && out.xmechOverride != null) {
    out.xmaxOverride = Math.min(out.xmaxOverride, out.xmechOverride);
  }
  // final layout sanity (defensive): recompute with the balanced set
  computeLayout(out);
  return out;
}

/* ------------------------------------------------------------------ */
/* enclosure                                                           */
/* ------------------------------------------------------------------ */

export function sanitizeEnclosure(e: EnclosureParams, d: DriverParams): EnclosureParams {
  const minDim = 40;
  const W = num(e.internalWidth, minDim, 3000, 340);
  const H = num(e.internalHeight, minDim, 3000, 380);
  const D = num(e.internalDepth, minDim, 3000, 300);
  const wall = clamp(num(e.wallThickness, 6, 60, 18), 6, Math.min(W, H, D) / 4);
  // AUTO-BALANCE: the port must physically fit inside the box depth.
  const portLen = clamp(num(e.port.length, 5, Math.max(5, D - 2 * wall), 120), 5, 2000);
  const portDia = clamp(num(e.port.diameter, 8, Math.min(W, H) * 0.7, 68), 8, 500);
  const prDia = clamp(
    num(e.passive.diameter, 30, Math.max(30, Math.min(W, H) * 0.95), 220),
    30, 800,
  );
  return {
    ...e,
    type: str(e.type, ['sealed', 'ported', 'passiveRadiator'] as const, 'sealed'),
    internalWidth: W,
    internalHeight: H,
    internalDepth: D,
    wallThickness: wall,
    bracingVolume: num(e.bracingVolume, 0, 100, 0.6),
    damping: str(e.damping, ['none', 'lightFill', 'lined', 'heavyFill'] as const, 'lined'),
    port: {
      ...e.port,
      shape: str(e.port.shape, ['round', 'slot'] as const, 'round'),
      diameter: portDia,
      length: portLen,
      count: int(e.port.count, 1, 4, 1),
      slotWidth: num(e.port.slotWidth, 10, Math.max(10, W * 0.9), 50),
      slotHeight: num(e.port.slotHeight, 10, Math.max(10, H * 0.9), 220),
      flared: e.port.flared !== false,
    },
    passive: {
      ...e.passive,
      enabled: e.passive.enabled === true,
      diameter: prDia,
      mass: num(e.passive.mass, 5, 5000, 220),
      suspensionStiffness: num(e.passive.suspensionStiffness, 10, 100000, 350),
      damping: num(e.passive.damping, 0.01, 500, 1.2),
    },
    driverCount: int(e.driverCount, 1, 8, 1),
    wiring: str(e.wiring, ['parallel', 'series'] as const, 'parallel'),
    coilWiring: str(e.coilWiring, ['parallel', 'series'] as const, 'parallel'),
    driverMount: str(e.driverMount, ['flush', 'surface'] as const, 'flush'),
    // appearance
    finishColor: hexColor((e as { finishColor?: unknown }).finishColor, '#7a5c3e'),
    grille: {
      enabled: (e as { grille?: { enabled?: boolean } }).grille?.enabled === true,
      color: hexColor((e as { grille?: { color?: unknown } }).grille?.color, '#141414'),
    },
  };
}

/* ------------------------------------------------------------------ */
/* amplifier / audio / sim                                             */
/* ------------------------------------------------------------------ */

export function sanitizeAmplifier(a: AmplifierParams): AmplifierParams {
  // Bounds reach bench-burst territory ON PURPOSE: reaching Xmax at 40 Hz with
  // a high-Bl driver takes far more than the continuous thermal rating (the
  // motional/back-EMF impedance Bl²/Zm self-limits current). Short bass-test
  // bursts at 10–100 kW equivalents are exactly how excursion is demonstrated;
  // clamping here silently amputated the "physical mm" for long-throw drivers.
  const vRms = num(a.voltageRms, 0.05, 600, 2.83);
  const clip = a.clipEnabled ? Math.max(num(a.clipVoltageRms, 0.1, 900, 14), vRms) : num(a.clipVoltageRms, 0.1, 900, 14);
  return {
    driveMode: str(a.driveMode, ['voltage', 'power'] as const, 'voltage'),
    voltageRms: vRms,
    powerW: num(a.powerW, 0.01, 150000, 25),
    clipEnabled: a.clipEnabled === true,
    clipVoltageRms: clip,
    currentLimitA: num(a.currentLimitA, 0, 1000, 0),
    outputImpedance: num(a.outputImpedance, 0, 8, 0.05),
    bridged: a.bridged === true,
  };
}

export function sanitizeAudio(a: AudioSettings): AudioSettings {
  return {
    channel: str(a.channel, ['L', 'R', 'sum'] as const, 'sum'),
    band: str(a.band, ['full', 'bass', 'mid', 'treble'] as const, 'full'),
    vizMode: str(a.vizMode, ['physical', 'enhanced'] as const, 'enhanced'),
    vizMultiplier: num(a.vizMultiplier, 1, 100, 8),
    volume: num(a.volume, 0, 1, 0.8),
    acousticOutput: a.acousticOutput === true,
  };
}

export function sanitizeSim(s: SimSettings): SimSettings {
  return {
    mode: str(s.mode, ['idealized', 'thieleSmall', 'dynamic', 'advanced'] as const, 'dynamic'),
    speed: num(s.speed, 0.05, 1, 1),
    running: s.running !== false,
    paused: s.paused === true,
    quality: str((s as { quality?: unknown }).quality, ['precision', 'balanced', 'fast'] as const, 'precision'),
    vizSmoothing: num((s as { vizSmoothing?: unknown }).vizSmoothing, 0, 0.95, 0.35),
    flexGain: num((s as { flexGain?: unknown }).flexGain, 0, 2, 1),
  };
}
