/*
 * Passive-radiator (and box) validation tests.
 *
 * The PR is a real 5th state in the coupled electro-mechano-acoustic model:
 *   state = [ i, x_d, v_d, x_pr, v_pr ]
 * These tests pin the PR physics that the 3D with-box test view and the
 * Enclosure Designer rely on:
 *   1. sealed regression — 3 states, no PR row
 *   2. PR system — 5 states, cpr output row selects x_pr
 *   3. quasi-static volume conservation: x_pr/x_d → (Sd/Spr)·Krr/(Krr+Kpr)
 *   4. the cone-excursion notch (system tuning) lands at the analytic Fb
 *   5. the auto-tune mass solver Mpr = (Krr+Kpr)/(2πFb)² retunes the notch
 *   6. PR leverage: at Fb the PR stroke is several × the cone stroke
 */
import { describe, it, expect } from 'vitest';
import { computeTS } from '../physics/tsp';
import { defaultDriver, defaultEnclosure } from '../physics/defaults';
import { buildSystem, wiringInfo } from '../physics/stateSpace';
import { computeEnclosure, responseOverGrid } from '../physics/freqresp';
import { sanitizeEnclosure } from '../physics/validate';
import { MATERIALS } from '../physics/materials';
import type { DriverParams, EnclosureParams } from '../physics/types';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);
const driver = (): DriverParams => defaultDriver();

/** A mid-size PR box: ~90 L net, 250 mm PR, light suspension. */
function prBox(overrides: Partial<EnclosureParams['passive']> = {}): EnclosureParams {
  return {
    ...defaultEnclosure(),
    type: 'passiveRadiator',
    internalWidth: 450,
    internalHeight: 520,
    internalDepth: 400,
    passive: {
      ...defaultEnclosure().passive,
      enabled: true,
      diameter: 250,
      mass: 350,
      suspensionStiffness: 200,
      damping: 0.8,
      ...overrides,
    },
  };
}

function prSystem(d: DriverParams, enc: EnclosureParams) {
  const ts = computeTS(d, mats);
  const res = computeEnclosure(enc, ts, 2.5);
  const sys = buildSystem({
    ts, enclosure: enc, encResult: res,
    wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1),
    sourceImpedance: 0, sampleRate: 48000,
  });
  return { ts, res, sys };
}

describe('enclosure system shape', () => {
  it('sealed box stays a 3-state system with no PR row (regression)', () => {
    const enc: EnclosureParams = { ...defaultEnclosure(), type: 'sealed' };
    const { sys } = prSystem(driver(), enc);
    expect(sys.n).toBe(3);
    expect(sys.cpr).toBeNull();
    expect(sys.meta.prMass).toBe(0);
  });

  it('PR box is a 5-state system and cpr selects the PR displacement state', () => {
    const { sys } = prSystem(driver(), prBox());
    expect(sys.n).toBe(5);
    expect(sys.cpr).not.toBeNull();
    expect(sys.cpr!.length).toBe(5);
    expect(sys.cpr![3]).toBe(1);       // x_pr is state #4
    expect(sys.meta.prMass).toBeCloseTo(0.35, 5);  // 350 g
    expect(sys.meta.prArea).toBeCloseTo(Math.PI * 0.125 * 0.125, 6);
  });

  it('ported box is 5-state with a port row, no PR mass', () => {
    const enc: EnclosureParams = {
      ...defaultEnclosure(), type: 'ported',
      port: { shape: 'round', diameter: 100, length: 320, count: 1, flared: true, slotWidth: 60, slotHeight: 300 },
    };
    const { sys, res } = prSystem(driver(), enc);
    expect(sys.n).toBe(5);
    expect(sys.cpr![3]).toBe(1);
    expect(res.portArea).toBeGreaterThan(0);
    expect(sys.meta.prMass).toBe(0);
  });
});

describe('passive-radiator physics', () => {
  it('quasi-statically the PR follows volume conservation: x_pr/x_d → (Sd/Spr)·Krr/(Krr+Kpr)', () => {
    const { ts, res, sys } = prSystem(driver(), prBox());
    // well below BOTH coupled resonances the pair moves as an incompressible
    // plug — the ratio must equal the closed-form volume-conservation value
    const f = [0.5, 1, 2];
    const pr = responseOverGrid(sys.A, sys.B, sys.cpr!, f);
    const cone = responseOverGrid(sys.A, sys.B, sys.cx, f);
    const Spr = res.prArea;
    const Krr = (1.204 * 343 * 343 * Spr * Spr) / res.VbEffM3;
    const expected = (ts.Sd / Spr) * (Krr / (Krr + 200));
    for (let i = 0; i < f.length; i++) {
      const ratio = pr.mag[i] / cone.mag[i];
      expect(ratio).toBeGreaterThan(expected * 0.85);
      expect(ratio).toBeLessThan(expected * 1.15);
    }
  });

  it('the cone-excursion notch (system tuning) lands at the analytic Fb', () => {
    const { res, sys } = prSystem(driver(), prBox());
    expect(res.Fb).not.toBeNull();
    const f: number[] = [];
    for (let hz = 10; hz <= 90; hz += 0.25) f.push(hz);
    const cone = responseOverGrid(sys.A, sys.B, sys.cx, f);
    let idx = 0, min = Infinity;
    cone.mag.forEach((m, i) => { if (m < min) { min = m; idx = i; } });
    const notch = f[idx];
    expect(Math.abs(notch - res.Fb!) / res.Fb!).toBeLessThan(0.10);
  });

  it('auto-tune mass solver Mpr=(Krr+Kpr)/(2πFb)² retunes the notch to the target', () => {
    const target = 24;   // Hz
    const { ts, res } = prSystem(driver(), prBox());
    const Spr = res.prArea;
    const Krr = (1.204 * 343 * 343 * Spr * Spr) / res.VbEffM3;
    const massG = ((Krr + 200) / Math.pow(2 * Math.PI * target, 2)) * 1000;
    const { sys, res: res2 } = prSystem(driver(), prBox({ mass: Math.round(massG) }));
    // tuning formula reproduces the target…
    expect(Math.abs(res2.Fb! - target) / target).toBeLessThan(0.03);
    // …and the ACTUAL model notch confirms it
    const f: number[] = [];
    for (let hz = 8; hz <= 60; hz += 0.2) f.push(hz);
    const cone = responseOverGrid(sys.A, sys.B, sys.cx, f);
    let idx = 0, min = Infinity;
    cone.mag.forEach((m, i) => { if (m < min) { min = m; idx = i; } });
    expect(Math.abs(f[idx] - target) / target).toBeLessThan(0.10);
    void ts;
  });

  it('PR leverage: at Fb the PR stroke is at least 3× the cone stroke', () => {
    const { res, sys } = prSystem(driver(), prBox());
    const f = [res.Fb! * 0.98, res.Fb!, res.Fb! * 1.02];
    const pr = responseOverGrid(sys.A, sys.B, sys.cpr!, f);
    const cone = responseOverGrid(sys.A, sys.B, sys.cx, f);
    for (let i = 0; i < f.length; i++) {
      expect(pr.mag[i] / cone.mag[i]).toBeGreaterThan(3);
    }
  });

  it('below Fb the PR takes over: PR stroke ≥2× above tuning while the cone notches', () => {
    const { res, sys } = prSystem(driver(), prBox());
    const fb = res.Fb!;
    const f = [fb * 1.5, fb * 0.7];
    const pr = responseOverGrid(sys.A, sys.B, sys.cpr!, f);
    const cone = responseOverGrid(sys.A, sys.B, sys.cx, f);
    // PR radiates mostly below/around tuning…
    expect(pr.mag[1]).toBeGreaterThan(pr.mag[0] * 2);
    // …and the cone unloads: its stroke at Fb collapses vs the passband
    const wide = responseOverGrid(sys.A, sys.B, sys.cx, [fb * 3, fb]);
    expect(wide.mag[1]).toBeLessThan(wide.mag[0] * 0.6);
  });

  it('PR damping keeps the tuning peak finite (no numerical blowup)', () => {
    const { res, sys } = prSystem(driver(), prBox());
    const pr = responseOverGrid(sys.A, sys.B, sys.cpr!, [res.Fb!]);
    expect(Number.isFinite(pr.mag[0])).toBe(true);
    expect(pr.mag[0]).toBeLessThan(1);   // m per volt — sane scale
  });
});

describe('multi-PR count (side-wall radiators)', () => {
  it('N identical PRs aggregate: area, mass, stiffness and damping all × N', () => {
    const one = prSystem(driver(), prBox());
    const two = prSystem(driver(), prBox({ count: 2 }));
    expect(two.res.prArea).toBeCloseTo(one.res.prArea * 2, 9);
    expect(two.res.prMass).toBeCloseTo(one.res.prMass * 2, 9);
    expect(two.res.prStiffness).toBeCloseTo(one.res.prStiffness * 2, 6);
    expect(two.res.prDamping).toBeCloseTo(one.res.prDamping * 2, 6);
    // system shape unchanged — still the 5-state PR model
    expect(two.sys.n).toBe(5);
    expect(two.sys.cpr![3]).toBe(1);
  });

  it('counted PRs keep a finite, sensible tuning and the notch tracks Fb', () => {
    const { res, sys } = prSystem(driver(), prBox({ count: 3 }));
    expect(res.Fb).not.toBeNull();
    expect(Number.isFinite(res.Fb!)).toBe(true);
    const f: number[] = [];
    for (let hz = 8; hz <= 90; hz += 0.25) f.push(hz);
    const cone = responseOverGrid(sys.A, sys.B, sys.cx, f);
    let idx = 0, min = Infinity;
    cone.mag.forEach((m, i) => { if (m < min) { min = m; idx = i; } });
    expect(Math.abs(f[idx] - res.Fb!) / res.Fb!).toBeLessThan(0.10);
  });

  it('the auto-tune solver stays exact when the mass is split over N radiators', () => {
    const target = 22;   // Hz
    const { res } = prSystem(driver(), prBox({ count: 2 }));
    const Spr = res.prArea;
    const Krr = (1.204 * 343 * 343 * Spr * Spr) / res.VbEffM3;
    const perPrG = ((Krr + 2 * 200) / Math.pow(2 * Math.PI * target, 2)) * 1000 / 2;
    const { res: res2 } = prSystem(driver(), prBox({ count: 2, mass: Math.round(perPrG) }));
    expect(Math.abs(res2.Fb! - target) / target).toBeLessThan(0.03);
  });

  it('sanitizeEnclosure clamps the count to 1–4 and defaults to 1', () => {
    const base = prBox();
    expect(sanitizeEnclosure({ ...base, passive: { ...base.passive, count: 99 } }, driver()).passive.count).toBe(4);
    expect(sanitizeEnclosure({ ...base, passive: { ...base.passive, count: 0 } }, driver()).passive.count).toBe(1);
    const withoutCount = { ...base.passive };
    delete withoutCount.count;
    expect(sanitizeEnclosure({ ...base, passive: withoutCount }, driver()).passive.count).toBe(1);
  });
});
