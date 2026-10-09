/*
 * Assembly invariant tests — the mechanical-coherence contract.
 *
 * For every shipped driver (default + presets) and for deliberately broken
 * / legacy parameter sets, after sanitization:
 *   1. every component is attached to exactly the component it bonds to,
 *   2. the coil straddles the magnetic gap and fits inside it radially,
 *   3. the geometric excursion limits exist, are ordered (Xmax ≤ Xmech) and
 *      keep every moving part clear of the stationary ones,
 *   4. the suspension profiles stay attached at their endpoints for ANY
 *      excursion within (and beyond) the envelope,
 *   5. Vd = Sd × Xmax (one-way) holds exactly.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeDriver } from '../physics/validate';
import { computeLayout, surroundProfile, spiderProfile } from '../physics/layout';
import { computeTS } from '../physics/tsp';
import { defaultDriver, PRESETS, applyPreset } from '../physics/defaults';
import type { DriverParams } from '../physics/types';
import { MATERIALS } from '../physics/materials';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);

function cases(): { name: string; d: DriverParams }[] {
  const list = [{ name: 'default', d: defaultDriver() as DriverParams }];
  for (const p of PRESETS) {
    const { driver } = applyPreset(p.id);
    list.push({ name: p.id, d: driver });
  }
  // legacy project saved by an older build (pre-layout conventions)
  const legacy = defaultDriver();
  legacy.cone.outerDiameter = 220; legacy.cone.effectiveDiameter = 167;
  legacy.coil.formerDiameter = 49.4; legacy.coil.windingDiameter = 51.0;
  legacy.spider.innerDiameter = 80;              // floating spider bug input
  list.push({ name: 'legacy-8inch', d: legacy });
  // underhung configuration
  const uh = defaultDriver();
  uh.coil.config = 'underhung';
  uh.coil.turnsPerLayer = 12;
  list.push({ name: 'underhung', d: uh });
  return list;
}

describe('assembly invariants (all drivers)', () => {
  for (const c of cases()) {
    describe(c.name, () => {
      const s = sanitizeDriver(c.d);
      const L = computeLayout(s);
      const ts = computeTS(s, mats);

      it('surround is bonded to the cone edge and the frame seat', () => {
        expect(L.rSurfIn).toBeCloseTo(L.rConeOut, 12);
        expect(s.surround.innerDiameter).toBeCloseTo(s.cone.outerDiameter, 9);
        expect(s.surround.outerDiameter).toBeCloseTo(s.surround.innerDiameter + 2 * s.surround.rollWidth, 9);
      });

      it('spider is bonded to the former wall and seated on the shelf', () => {
        expect(L.rSpIn).toBeCloseTo(L.rFormerOut, 12);
        expect(s.spider.innerDiameter).toBeCloseTo(s.coil.formerDiameter + 2 * s.coil.formerThickness, 9);
        expect(L.yShelfTop).toBeCloseTo(L.ySpider, 12);
      });

      it('cone inner edge meets the former top', () => {
        expect(L.rConeIn).toBeCloseTo(L.rFormerOut, 12);
        expect(L.yFormerTop).toBeCloseTo(L.yConeInner + 0.5e-3, 12);
      });

      it('winding is centred on the magnetic gap and fits inside it', () => {
        expect(L.yGapC).toBeCloseTo(L.yWindC, 12);           // gap anchored to coil
        expect(L.rWindOuter).toBeLessThanOrEqual(L.rGapInner - 0.1e-3);
        expect(L.rFormer).toBeGreaterThanOrEqual(L.rPole + 0.25e-3); // former slides over pole
      });

      it('spider rests above the top plate with real clearance', () => {
        expect(L.spiderClear).toBeGreaterThan(0);
        expect(L.ySpider).toBeGreaterThan(L.yTopPlateTop);
        // spider down-clearance covers (almost) the full linear excursion
        expect(L.spiderClear).toBeGreaterThanOrEqual(ts.Xmax * 1e-3 * 0.95);
      });

      it('former bottom clears the back plate over the linear stroke', () => {
        expect(L.formerClear).toBeGreaterThan(0);
        expect(L.formerClear).toBeGreaterThanOrEqual(ts.Xmax * 1e-3 * 0.9);
      });

      it('excursion limits are positive and ordered', () => {
        expect(L.maxDown).toBeGreaterThan(0);
        expect(L.maxUp).toBeGreaterThan(0);
        expect(ts.Xmech).toBeGreaterThanOrEqual(ts.Xmax - 1e-9);
        expect(ts.XmaxPP).toBeCloseTo(2 * ts.Xmax, 12);
      });

      it('Vd = Sd × Xmax exactly (one-way convention)', () => {
        expect(ts.Vd).toBeCloseTo(ts.Sd * (ts.Xmax * 1e-3), 12);
        expect(ts.Vd).toBeGreaterThan(0);
      });

      it('Sd agrees with the drawn geometry (piston to half the surround)', () => {
        const deff = s.cone.outerDiameter + s.surround.rollWidth;
        expect(s.cone.effectiveDiameter).toBeCloseTo(deff, 9);
      });

      it('suspension endpoints stay attached at every excursion', () => {
        const xs = [0, L.XmaxGeo, -L.XmaxGeo, L.XmechGeo, -L.XmechGeo, L.maxUp * 2, -L.maxDown * 2];
        for (const x of xs) {
          const sp = surroundProfile(L, s.surround.rollHeight * 1e-3, s.surround.rollCount, x);
          expect(sp[0][0]).toBeCloseTo(L.rSurfIn, 12);
          expect(sp[0][1]).toBeCloseTo(L.ySeat + x, 12);       // rides with the cone
          expect(sp[sp.length - 1][0]).toBeCloseTo(L.rSurfOut, 12);
          expect(sp[sp.length - 1][1]).toBeCloseTo(L.yFrameSeat, 12); // seated on frame
          const st = spiderProfile(L, s.spider.corrugations, s.spider.corrDepth * 1e-3, x);
          expect(st[0][0]).toBeCloseTo(L.rSpIn, 12);
          expect(st[0][1]).toBeCloseTo(L.ySpider + x, 12);     // rides with the former
          expect(st[st.length - 1][0]).toBeCloseTo(L.rSpOut, 12);
          expect(st[st.length - 1][1]).toBeCloseTo(L.ySpider, 12);    // fixed on shelf
          // lathe-safe radii: monotone non-decreasing, positive
          for (let i = 1; i < sp.length; i++) expect(sp[i][0]).toBeGreaterThanOrEqual(sp[i - 1][0] - 1e-9);
          for (let i = 1; i < st.length; i++) expect(st[i][0]).toBeGreaterThanOrEqual(st[i - 1][0] - 1e-9);
        }
      });

      it('3D visual envelope matches the geometric limits', () => {
        // the scene clamps rendered displacement to ±(limits) — these must
        // be the same numbers the physics uses for the hard stop.
        expect(L.maxUp).toBeGreaterThan(0);
        expect(L.maxDown).toBeGreaterThan(0);
        expect(L.XmechGeo).toBeCloseTo(Math.min(L.maxDown, L.maxUp), 12);
      });

      it('dust dome is seated on the cone shoulder (no floating cap)', () => {
        // shoulder plane lies ON the straight cone body line
        const slope = (L.ySeat - L.yConeInner) / (L.rConeOut - L.rConeIn);
        expect(L.yShoulder).toBeCloseTo(L.ySeat - (L.rConeOut - L.rShoulder) * slope, 9);
        // dome edge lands exactly on the shoulder, dome rises above it
        expect(L.rCap).toBeLessThan(L.rShoulder);
        expect(L.capH).toBeGreaterThan(0);
        // shoulder is inside the cone body span
        expect(L.rShoulder).toBeGreaterThan(L.rConeIn);
        expect(L.rShoulder).toBeLessThan(L.rConeOut);
      });

      it('motor boot clears the stack and the legs land on the rim', () => {
        expect(L.rBoot).toBeGreaterThanOrEqual(Math.max(L.rMagOD, L.rBackOD) / 2 + 1e-3);
        expect(L.rLegFoot).toBeLessThanOrEqual(L.rBoot + 1e-9);
        expect(L.yBootTop).toBeLessThan(L.yTopPlateBottom + 1e-9);
        expect(L.yBootBottom).toBeLessThan(L.yBackBottom);
        expect(L.yLegFoot).toBeLessThan(L.yShelfTop);          // feet sit below the shelf, on the motor rim
      });
    });
  }
});

describe('auto-balance repairs broken inputs into coherent assemblies', () => {
  it('a user giant spider inner diameter is re-bonded to the former', () => {
    const d = defaultDriver();
    d.spider.innerDiameter = 120;                 // floating-spider bug input
    const s = sanitizeDriver(d);
    expect(s.spider.innerDiameter).toBeCloseTo(s.coil.formerDiameter + 2 * s.coil.formerThickness, 9);
  });

  it('a former smaller than the pole is re-sized to a sliding fit', () => {
    const d = defaultDriver();
    d.coil.formerDiameter = 30;                   // pole is 50 mm
    const s = sanitizeDriver(d);
    expect(s.coil.formerDiameter).toBeGreaterThanOrEqual(s.magnet.poleDiameter + 0.6 - 1e-9);
  });

  it('Xmax requested beyond the surround capability bends the roll, not the physics', () => {
    const d = defaultDriver();
    d.xmaxOverride = 20;                          // stock roll (9 mm) can do ~11 mm
    const s = sanitizeDriver(d);
    // surround roll grown so the geometry can actually deliver 20 mm
    expect(s.surround.rollHeight * 1.25).toBeGreaterThanOrEqual(20 - 1e-6);
  });
});

describe('Sundown X-12 v.2 D2 preset — published-spec contract', () => {
  const s = sanitizeDriver(applyPreset('x12v2').driver);
  const ts = computeTS(s, mats);
  const L = computeLayout(s);

  it('Xmax is the published 30 mm one-way (and the geometry delivers it)', () => {
    expect(ts.Xmax).toBeGreaterThanOrEqual(29.8);
    expect(ts.Xmax).toBeLessThanOrEqual(30.2);
    expect(ts.Xmech).toBeGreaterThanOrEqual(ts.Xmax);
    expect(L.maxUp).toBeGreaterThanOrEqual(ts.Xmax * 1e-3 - 1e-9);
    expect(L.maxDown).toBeGreaterThanOrEqual(ts.Xmax * 1e-3 - 1e-9);
  });

  it('electrical + small-signal specs land on the published sheet', () => {
    expect(ts.Re).toBeCloseTo(3.8, 1);           // D2 series
    expect(ts.Bl).toBeCloseTo(26.5, 1);
    expect(ts.Fs).toBeGreaterThan(30);           // published 36.1 Hz (geometry-derived, ±15 %)
    expect(ts.Fs).toBeLessThan(42);
    expect(ts.Qts).toBeGreaterThan(0.33);
    expect(ts.Qts).toBeLessThan(0.5);            // published 0.41
    expect(ts.sens).toBeGreaterThan(82);          // published 84.4 dB / 1W / 1m
    expect(ts.sens).toBeLessThan(87);
  });

  it('Vd matches Sd × 30 mm and the peak-to-peak travel is 60 mm', () => {
    expect(ts.Vd).toBeCloseTo(ts.Sd * 0.030, 12);
    expect(ts.XmaxPP).toBeCloseTo(60, 9);
  });

  it('excursion at rated power is real movement, not a thumbnail', () => {
    // 900 W into ~3.8 Ω → ~58.6 Vrms → 82.9 Vpeak; at 36 Hz near Fs the
    // linear model must predict excursion comparable to the 30 mm Xmax.
    const vpeak = Math.sqrt(900 * 3.8) * Math.SQRT2;
    const w = 2 * Math.PI * 36.1;
    // quasi-static peak: x ≈ Bl·V /(√((K−Mω²)² + (Rω)²)) · 1/Re ... use the
    // standard force-factor form with the model's own parameters:
    const k = ts.Kms - ts.Mms * w * w;
    const c = ts.Rms;
    const xpk = (ts.Bl * vpeak / ts.Re) / Math.sqrt(k * k + c * c * w * w);
    expect(xpk * 1e3).toBeGreaterThan(15);       // tens of mm, not 1–2 mm
  });
});
