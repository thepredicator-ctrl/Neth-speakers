/*
 * Smoke tests for UNLIMITED ("as crazy as possible") builds.
 * Contract: the sanitiser must keep extreme designs FINITE and BUILDABLE —
 * the layout always describes a coherent assembly, Xmax ≤ Xmech, and the
 * deformable suspension profiles stay exact-attachment at every excursion.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeDriver } from '../physics/validate';
import { computeLayout, surroundProfile, spiderProfile, SURROUND_TRAVEL_FACTOR } from '../physics/layout';
import { computeTS } from '../physics/tsp';
import { defaultDriver } from '../physics/defaults';
import { MATERIALS } from '../physics/materials';
import type { DriverParams } from '../physics/types';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);
const base = (): DriverParams => JSON.parse(JSON.stringify(defaultDriver()));

describe('unlimited crazy builds stay buildable', () => {
  it('a 2 m monster cone with a 400 mm roll and 300 mm Xmax stays coherent', () => {
    const d = base();
    d.cone.outerDiameter = 2000;
    d.cone.depth = 400;
    d.surround.rollHeight = 400;
    d.surround.rollWidth = 250;
    d.coil.formerDiameter = 300;
    d.coil.windingDiameter = 305;
    d.coil.formerHeight = 400;
    d.coil.turnsPerLayer = 300;
    d.magnet.poleDiameter = 290;
    d.magnet.topPlateDiameter = 1200;
    d.magnet.topPlateThickness = 80;
    d.magnet.diameter = 1400;
    d.magnet.thickness = 150;
    d.magnet.count = 4;
    d.magnet.backPlateThickness = 100;
    d.frame.depth = 900;
    d.xmaxOverride = 300;
    d.xmechOverride = 600;
    const s = sanitizeDriver(d);
    // Xmax respects its ceiling and never exceeds Xmech
    expect(s.xmaxOverride).toBeLessThanOrEqual(300);
    const ts = computeTS(s, mats);
    expect(Number.isFinite(ts.Xmax)).toBe(true);
    expect(Number.isFinite(ts.Xmech)).toBe(true);
    expect(ts.Xmax).toBeLessThanOrEqual(ts.Xmech + 1e-9);
    // layout is a buildable assembly (all radii/heights finite + ordered)
    const L = computeLayout(s);
    for (const v of [L.rFrameOut, L.rSurfOut, L.yFormerBottom, L.yBackBottom, L.surroundLimit]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(L.yBackBottom).toBeLessThan(L.yTopPlateTop);
    expect(L.surroundLimit).toBeCloseTo(400 * SURROUND_TRAVEL_FACTOR * 1e-3, 6);
  });

  it('a 400 mm-tall roll keeps its profile attached at the full stroke', () => {
    const d = base();
    d.cone.outerDiameter = 560;
    d.surround.rollHeight = 400;
    d.surround.rollWidth = 120;
    d.xmaxOverride = 250;
    d.xmechOverride = 500;
    const s = sanitizeDriver(d);
    const L = computeLayout(s);
    for (const x of [0, L.surroundLimit, -L.surroundLimit]) {
      const prof = surroundProfile(L, 0.4, 1, x);
      // inner edge rides with the cone exactly; outer edge stays seated
      expect(prof[0][0]).toBeCloseTo(L.rSurfIn, 9);
      expect(prof[0][1]).toBeCloseTo(L.ySeat + x, 9);
      expect(prof[prof.length - 1][0]).toBeCloseTo(L.rSurfOut, 9);
      expect(prof[prof.length - 1][1]).toBeCloseTo(L.yFrameSeat, 9);
      // monotone radii (lathe-safe) even at the crazy stroke
      for (let i = 1; i < prof.length; i++) {
        expect(prof[i][0]).toBeGreaterThanOrEqual(prof[i - 1][0] - 1e-9);
      }
    }
    const sp = spiderProfile(L, 12, 0.01, L.maxDown);
    expect(sp[0][1]).toBeCloseTo(L.ySpider + L.maxDown, 9);
    expect(sp[sp.length - 1][1]).toBeCloseTo(L.ySpider, 9);
  });
});
