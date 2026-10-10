/*
 * Flexible-body visualisation math — the high-excursion + live-drive contract.
 *
 * Pure functions from layout.ts (consumed per-vertex by src/three/geometry.ts):
 *   1. surround wrinkling is ZERO at rest and below 55 % of the roll
 *      capability, deepens monotonically toward the limit and never exceeds
 *      9 % of the roll height — the bonded tabs can never wrinkle because
 *      geometry.ts applies it inside a zero-at-tabs envelope,
 *   2. the crease count follows the rim circumference / roll wavelength,
 *   3. every big-cone preset (15"…24") ships a surround whose capability
 *      (1.25 × rollHeight) covers the design Xmax, with layout limits that
 *      actually deliver it,
 *   4. the rocking/tilt mode is a bounded angular field: the rim cap never
 *      tears the assembly, the lift is zero on the axis, maximum on the rim,
 *      and the beat modulation keeps it alive instead of a static list.
 */
import { describe, it, expect } from 'vitest';
import { surroundWrinkleAmp, surroundWrinkleCount, computeLayout,
         rockRimCapM, rockLiftY, rockBeat } from '../physics/layout';
import { sanitizeDriver } from '../physics/validate';
import { computeTS } from '../physics/tsp';
import { applyPreset } from '../physics/defaults';
import { MATERIALS } from '../physics/materials';

describe('surround wrinkle amplitude', () => {
  const limit = 0.05;      // 50 mm one-way roll capability
  const rollH = 0.04;      // 40 mm crest height

  it('is zero at rest and below 55 % of the roll capability', () => {
    expect(surroundWrinkleAmp(0, limit, rollH)).toBe(0);
    expect(surroundWrinkleAmp(0.02, limit, rollH)).toBe(0);       // 40 %
    expect(surroundWrinkleAmp(0.0274, limit, rollH)).toBe(0);     // ~55 %
  });

  it('deepens monotonically with |x| past the buckle threshold', () => {
    let prev = 0;
    for (let f = 0.6; f <= 1.001; f += 0.05) {
      const a = surroundWrinkleAmp(f * limit, limit, rollH);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it('caps at 9 % of the roll height at the limit and is sign-symmetric', () => {
    expect(surroundWrinkleAmp(limit, limit, rollH)).toBeCloseTo(rollH * 0.09, 12);
    expect(surroundWrinkleAmp(-limit, limit, rollH))
      .toBeCloseTo(surroundWrinkleAmp(limit, limit, rollH), 12);
    // beyond the limit it does not keep growing
    expect(surroundWrinkleAmp(2 * limit, limit, rollH)).toBeCloseTo(rollH * 0.09, 12);
  });

  it('deeper buckles on taller rolls (40 mm roll vs 9 mm roll at the limit)', () => {
    expect(surroundWrinkleAmp(limit, limit, 0.048))
      .toBeGreaterThan(surroundWrinkleAmp(limit, limit, 0.009));
  });
});

describe('surround wrinkle count', () => {
  it('follows rim circumference and clamps to 7..26', () => {
    expect(surroundWrinkleCount(0.02, 0.012)).toBe(7);    // tiny roll → floor
    expect(surroundWrinkleCount(1.5, 0.01)).toBe(26);     // huge rim → ceiling
  });

  it('same roll height, bigger rim → more creases', () => {
    expect(surroundWrinkleCount(0.24, 0.01))
      .toBeGreaterThan(surroundWrinkleCount(0.08, 0.01));
  });

  it('taller rolls crease into fewer, deeper folds (wavelength grows)', () => {
    expect(surroundWrinkleCount(0.15, 0.048))
      .toBeLessThan(surroundWrinkleCount(0.15, 0.009));
  });
});

describe('big-cone presets deliver their spec excursion (15"..24")', () => {
  const mats = (id: string) => MATERIALS.find((m) => m.id === id);
  for (const id of ['neth15sub', 'neth18xl', 'neth21', 'neth24']) {
    it(`${id}: surround capability ≥ Xmax and the layout delivers it`, () => {
      const { driver } = applyPreset(id);
      const s = sanitizeDriver(driver);
      const L = computeLayout(s);
      const ts = computeTS(s, mats);
      // the roll can physically travel the design Xmax (no silent crushing)
      expect(s.surround.rollHeight * 1.25).toBeGreaterThanOrEqual(ts.Xmax * 1e-3 - 1e-9);
      expect(L.maxUp).toBeGreaterThanOrEqual(ts.Xmax * 1e-3 - 1e-9);
      expect(L.maxDown).toBeGreaterThanOrEqual(ts.Xmax * 1e-3 * 0.95);
      // all of these are long-throw subwoofers, not bookshelf drivers
      expect(ts.Xmax).toBeGreaterThan(18);
      // Sd / Vd stay consistent with the drawn geometry
      expect(ts.Vd).toBeCloseTo(ts.Sd * (ts.Xmax * 1e-3), 12);
      // tall rolls stay inside the sanctioned envelope (≤ 110 mm crest)
      expect(s.surround.rollHeight).toBeLessThanOrEqual(110);
      // SPL-class rolls ship with real headroom: crest ≥ 1.3 × Xmax
      expect(s.surround.rollHeight).toBeGreaterThanOrEqual(1.3 * ts.Xmax - 0.05);
    });
  }
});

describe('cone rock / tilt field (one side leads, the other lags)', () => {
  it('rim cap is bounded by Xmech share, roll crest and an absolute ceiling', () => {
    expect(rockRimCapM(0.06, 0.04)).toBeCloseTo(0.0132, 9);   // 22 % of 60 mm
    expect(rockRimCapM(0.2, 0.01)).toBeCloseTo(0.0045, 9);    // roll-bound: 45 % of 10 mm
    expect(rockRimCapM(1.0, 0.2)).toBeLessThanOrEqual(0.018); // absolute ceiling 18 mm
    expect(rockRimCapM(0, 0)).toBe(0);
  });

  it('lift is zero on the tilt axis and maximal on the rim, scaled by r/rRef', () => {
    const cap = rockRimCapM(0.05, 0.03);
    // on the axis (θ == axis): zero — bonds on the diameter stay put laterally
    expect(rockLiftY(0.12, 0.4, 0.4, cap, 0.12)).toBeCloseTo(cap, 12);
    expect(rockLiftY(0.12, 0.4 + Math.PI, 0.4, cap, 0.12)).toBeCloseTo(-cap, 12);
    // quarter way to the axis: cos(π/2) = 0
    expect(rockLiftY(0.12, 0.4 + Math.PI / 2, 0.4, cap, 0.12)).toBeCloseTo(0, 12);
    // at the centre the lift is exactly zero (dust-cap apex never swings)
    expect(rockLiftY(0, 1.0, 0.4, cap, 0.12)).toBe(0);
    // inner bond (former wall) gets proportionally less than the rim
    const inner = rockLiftY(0.03, 0.4, 0.4, cap, 0.12);
    expect(inner).toBeCloseTo(cap * 0.03 / 0.12, 12);
  });

  it('coherence: cone rim and surround inner edge share the same radius → same lift', () => {
    // geometry.ts relies on rSurfIn == rConeOut and rSpIn == rFormerOut so
    // the seesaw never tears a bond; this is the invariant it consumes.
    const { driver } = applyPreset('neth18xl');
    const s = sanitizeDriver(driver);
    const L = computeLayout(s);
    expect(L.rSurfIn).toBe(L.rConeOut);
    expect(L.rSpIn).toBe(L.rFormerOut);
    const cap = rockRimCapM(Math.max(L.maxUp, L.maxDown), s.surround.rollHeight * 1e-3);
    expect(rockLiftY(L.rSurfIn, 0.7, 0.7, cap, L.rConeOut))
      .toBeCloseTo(rockLiftY(L.rConeOut, 0.7, 0.7, cap, L.rConeOut), 12);
  });

  it('beat modulation stays in 0.4..1.0 — the rock breathes, never static, never wild', () => {
    for (let i = 0; i < 200; i++) {
      const b = rockBeat(i * 0.137);
      expect(b).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(b).toBeLessThanOrEqual(1.0 + 1e-9);
    }
  });
});
