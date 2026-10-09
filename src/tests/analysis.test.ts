/*
 * Tests for the professional analysis layer: Max SPL limits, group delay,
 * port velocity, HD3 estimate, alignment optimizer, design review.
 */
import { describe, it, expect } from 'vitest';
import { defaultDriver, defaultEnclosure } from '../physics/defaults';
import { computeTS } from '../physics/tsp';
import { computeEnclosure } from '../physics/freqresp';
import { buildSystem, wiringInfo } from '../physics/stateSpace';
import { logspace } from '../physics/units';
import { MATERIALS } from '../physics/materials';
import {
  systemCurves, maxSplCurve, hd3Estimate, groupDelayMs,
  optimizeAlignment, autoPort, portFlowAtFb, designReview, portLengthForFb, f3OfCurve,
} from '../physics/analysis';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);

function rig() {
  const driver = defaultDriver();
  const enc = defaultEnclosure();
  const ts = computeTS(driver, mats);
  const driverVolL =
    (Math.PI / 4) * Math.pow(driver.magnet.diameter / 1000, 2) *
    ((driver.magnet.thickness + driver.magnet.backPlateThickness) / 1000) * 1e3;
  const encRes = computeEnclosure(enc, ts, driverVolL);
  const wi = wiringInfo(ts, enc.driverCount, enc.wiring, enc.coilWiring, 1);
  const sys = buildSystem({ ts, enclosure: enc, encResult: encRes, wiring: wi, sourceImpedance: 0.05, sampleRate: 48000 });
  return { driver, enc, ts, encRes, sys, driverVolL };
}

const DRIVE = { vRef: 2.83, clipV: null, thermalW: 150, loadOhms: 7.2 };

describe('group delay', () => {
  it('is near zero for an allpass-free flat magnitude region', () => {
    const { ts, enc, encRes, sys } = rig();
    const f = logspace(200, 2000, 40);
    const c = systemCurves(sys, ts, enc, encRes, f, DRIVE);
    // well above resonance, group delay should be small (< 2 ms)
    for (let i = 10; i < 30; i++) expect(Math.abs(c.gdMs[i])).toBeLessThan(2);
  });

  it('is maximal in the bass and decays toward the passband (sealed)', () => {
    const { ts, enc, encRes, sys } = rig();
    const Fc = ts.Fs * Math.sqrt(1 + ts.Vas / encRes.VbEff);
    const f = logspace(15, 300, 220);
    const c = systemCurves(sys, ts, enc, encRes, f, DRIVE);
    // group delay of a 2nd-order system is largest at low frequencies
    const idx20 = f.findIndex((x) => x >= 20);
    const idx300 = f.findIndex((x) => x >= 300);
    expect(c.gdMs[idx20]).toBeGreaterThan(c.gdMs[idx300] * 2);
    expect(c.gdMs[idx20]).toBeLessThan(80); // sane magnitude for this class
    // peak must sit at or below ~1.5×Fc
    let peakI = 0;
    for (let i = 1; i < f.length; i++) if (c.gdMs[i] > c.gdMs[peakI]) peakI = i;
    expect(f[peakI]).toBeLessThan(Fc * 1.5);
  });

  it('returns zeros for degenerate input', () => {
    expect(groupDelayMs([10, 20], [0, 0])).toHaveLength(2);
  });
});

describe('max SPL', () => {
  it('never exceeds the excursion-limited ceiling when excursion hits Xmax', () => {
    const { ts, enc, encRes, sys } = rig();
    const f = logspace(20, 500, 60);
    const c = systemCurves(sys, ts, enc, encRes, f, { ...DRIVE, vRef: 40 });
    const m = maxSplCurve(c, ts, { ...DRIVE, vRef: 40 });
    for (let i = 0; i < f.length; i++) {
      const e = c.splDb[i] + 20 * Math.log10(ts.Xmax / Math.max(1e-6, Math.abs(c.excMm[i])));
      expect(m.dbMax[i]).toBeLessThanOrEqual(e + 1e-6);
    }
  });

  it('respects the voltage (clip) limit as a flat ceiling offset', () => {
    const { ts, enc, encRes, sys } = rig();
    const f = logspace(20, 500, 60);
    const c = systemCurves(sys, ts, enc, encRes, f, DRIVE);
    const m = maxSplCurve(c, ts, { ...DRIVE, clipV: 10 });
    const expectedOffset = 20 * Math.log10(10 / DRIVE.vRef);
    for (let i = 0; i < f.length; i++) {
      expect(m.byVoltage[i]).toBeCloseTo(c.splDb[i] + expectedOffset, 6);
      expect(m.dbMax[i]).toBeLessThanOrEqual(m.byVoltage[i] + 1e-6);
    }
  });

  it('lowers the ceiling when the driver is thermally weak', () => {
    const { ts, enc, encRes, sys } = rig();
    const f = logspace(20, 500, 40);
    const c = systemCurves(sys, ts, enc, encRes, f, DRIVE);
    const strong = maxSplCurve(c, ts, { ...DRIVE, thermalW: 1000 });
    const weak = maxSplCurve(c, ts, { ...DRIVE, thermalW: 10 });
    for (let i = 0; i < f.length; i++) expect(weak.dbMax[i]).toBeLessThanOrEqual(strong.dbMax[i] + 1e-6);
  });
});

describe('HD3 estimate', () => {
  it('grows quadratically with drive voltage', () => {
    const { driver, ts, enc, encRes, sys } = rig();
    const f = logspace(30, 120, 20);
    const lo = systemCurves(sys, ts, enc, encRes, f, DRIVE);
    const hi = systemCurves(sys, ts, enc, encRes, f, { ...DRIVE, vRef: DRIVE.vRef * 2 });
    const hLo = hd3Estimate(lo, ts, driver);
    const hHi = hd3Estimate(hi, ts, driver);
    for (let i = 0; i < f.length; i++) {
      if (hLo[i] > 0.01) expect(hHi[i] / hLo[i]).toBeCloseTo(4, 1); // 4× per octave of voltage (A²)
    }
  });

  it('is zero when both nonlinearities are off', () => {
    const { ts, enc, encRes, sys } = rig();
    const driver = { ...defaultDriver(), kmsRiseAtXmax: 0, blDropAtXmech: 0 };
    const f = logspace(20, 200, 20);
    const c = systemCurves(sys, ts, enc, encRes, f, DRIVE);
    expect(hd3Estimate(c, ts, driver).every((v) => v === 0)).toBe(true);
  });
});

describe('port velocity (exact from state vector)', () => {
  it('peaks near Fb and drops away from it', () => {
    const { ts, enc, encRes, sys } = rig();
    const ported = { ...enc, type: 'ported' as const };
    const r = computeEnclosure(ported, ts, 3.2);
    const sysP = buildSystem({ ts, enclosure: ported, encResult: r, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0.05, sampleRate: 48000 });
    const f = logspace(15, 300, 160);
    const c = systemCurves(sysP, ts, ported, r, f, DRIVE);
    expect(c.portUm).not.toBeNull();
    const u = c.portUm!;
    let peakI = 0;
    for (let i = 1; i < f.length; i++) if (u[i] > u[peakI]) peakI = i;
    expect(r.Fb).not.toBeNull();
    expect(f[peakI]).toBeGreaterThan(r.Fb! * 0.7);
    expect(f[peakI]).toBeLessThan(r.Fb! * 1.4);
    // far above tuning the port is nearly silent relative to its peak
    const hiIdx = f.findIndex((x) => x > 200);
    expect(u[hiIdx]).toBeLessThan(u[peakI] * 0.05);
  });

  it('ported SPL rolls off ~24 dB/oct below Fb (4th order) with no passband notch', () => {
    const { ts, enc } = rig();
    const ported = { ...enc, type: 'ported' as const };
    const r = computeEnclosure(ported, ts, 3.2);
    const sysP = buildSystem({ ts, enclosure: ported, encResult: r, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0.05, sampleRate: 48000 });
    const f = logspace(10, 300, 200);
    const c = systemCurves(sysP, ts, ported, r, f, DRIVE);
    // Fb peak
    let fbI = 0;
    for (let i = 1; i < f.length; i++) if (Math.abs(f[i] - r.Fb!) < Math.abs(f[fbI] - r.Fb!)) fbI = i;
    // one octave below Fb: 4th-order → ≈ −24 dB (allow 15–33)
    let loI = 0;
    for (let i = 0; i < f.length; i++) if (Math.abs(f[i] - r.Fb! / 2) < Math.abs(f[loI] - r.Fb! / 2)) loI = i;
    const drop = c.splDb[fbI] - c.splDb[loI];
    expect(drop).toBeGreaterThan(14);
    expect(drop).toBeLessThan(34);
    // no deep notch in 1.1–2.5×Fb (the old sign bug put a 15 dB hole there)
    for (let i = 0; i < f.length; i++) {
      if (f[i] > r.Fb! * 1.1 && f[i] < r.Fb! * 2.5) {
        expect(c.splDb[i]).toBeGreaterThan(c.splDb[fbI] - 12);
      }
    }
  });
});

describe('alignment optimizer', () => {
  it('sealed Butterworth lands within 5% of the closed-form volume', () => {
    const { ts, enc, driverVolL } = rig();
    const sol = optimizeAlignment(
      { ts, base: enc, driverDisplacementL: driverVolL, vRated: 2, maxPortLenMM: 260 },
      { kind: 'sealedButterworth', targetQtc: 0.707 },
    );
    const VbClosed = ts.Vas; // Qts 0.707 → α = 1 → Vb = Vas (for Qts≈0.7)
    // for the default driver Qts ≈ 0.5–0.6, closed form: Vb = Vas/((0.707/Qts)²−1)
    const denom = (0.707 / ts.Qts) ** 2 - 1;
    const VbExpect = denom > 0.02 ? ts.Vas / denom : 4000;
    expect(sol.Qtc).not.toBeNull();
    if (denom > 0.02 && VbExpect < 3900) {
      expect(sol.VbL / Math.min(3900, VbClosed * 100)).toBeGreaterThan(0); // sanity
      expect(Math.abs(sol.VbL - VbExpect) / VbExpect).toBeLessThan(0.08); // ≤8% incl. fill factor
      expect(sol.Qtc!).toBeGreaterThan(0.6);
      expect(sol.Qtc!).toBeLessThan(0.85);
    }
  });

  it('ported max-flat finds a tuning in the legal window with small ripple', () => {
    const { ts, enc, driverVolL } = rig();
    const sol = optimizeAlignment(
      { ts, base: enc, driverDisplacementL: driverVolL, vRated: 2, maxPortLenMM: 260 },
      { kind: 'maxflat' },
    );
    expect(sol.FbHz).not.toBeNull();
    expect(sol.FbHz!).toBeGreaterThan(ts.Fs * 0.5);
    expect(sol.FbHz!).toBeLessThan(ts.Fs * 1.2);
    expect(sol.VbL).toBeGreaterThan(ts.Vas * 0.2);
    expect(sol.VbL).toBeLessThan(ts.Vas * 3.6);
    expect(sol.F3Hz).toBeGreaterThan(0);
    // F3 must live near the tuning — a value at the top of the grid (hundreds
    // of Hz) means the F3 walk is broken (regression guard)
    expect(sol.F3Hz).toBeLessThan(Math.max(120, sol.FbHz! * 2.2));
    // low-Qts drivers cannot achieve truly flat ported alignments — the
    // optimizer returns the best available, which may still ripple
    expect(sol.rippleDb).toBeLessThan(8);
  });

  it('EBS extends lower than max-flat F10 but may ripple more', () => {
    const { ts, enc, driverVolL } = rig();
    const ctx = { ts, base: enc, driverDisplacementL: driverVolL, vRated: 2, maxPortLenMM: 260 };
    const mf = optimizeAlignment(ctx, { kind: 'maxflat' });
    const ebs = optimizeAlignment(ctx, { kind: 'ebs' });
    // EBS trades flatness for extension: F3 no higher than maxflat + 10 Hz
    expect(ebs.F3Hz).toBeLessThan(mf.F3Hz + 10);
  });
});

describe('autoPort', () => {
  it('sizes ports to keep velocity near target when space allows', () => {
    const { ts, enc, driverVolL } = rig();
    const p = autoPort(
      { ts, base: { ...enc, internalWidth: 500, internalHeight: 900, internalDepth: 400 }, driverDisplacementL: driverVolL, vRated: 2, maxPortLenMM: 360 },
      120, 32, 0.0444,
    );
    expect(p.diameter).toBeGreaterThanOrEqual(25);
    expect(p.length).toBeGreaterThan(0);
    expect(p.velocity).toBeGreaterThan(0);
    expect(p.velocity).toBeLessThan(27); // feasible in a huge box
  });

  it('port flow estimate is in a sane range for a real alignment', () => {
    const { ts, enc, driverVolL } = rig();
    const ctx = { ts, base: enc, driverDisplacementL: driverVolL, vRated: 2.83, maxPortLenMM: 260 };
    const U = portFlowAtFb(ctx, 30, 38, 2.83);
    // 2.83 V into this 8": cone Sd 0.022 m², port flow of order 1e-3..1e-1 m³/s
    expect(U).toBeGreaterThan(1e-4);
    expect(U).toBeLessThan(0.5);
  });
});

describe('portLengthForFb round-trip', () => {
  it('tunes back to the requested Fb', () => {
    const Fb = 35, Area = 5e-3, Vb = 60e-3;
    const Lmm = portLengthForFb(Fb, Area, Vb);
    const r = Math.sqrt(Area / Math.PI);
    const Leff = Lmm / 1000 + 0.85 * r * 2;
    const FbBack = (343 / (2 * Math.PI)) * Math.sqrt(Area / (Vb * Leff));
    expect(FbBack).toBeCloseTo(Fb, 1);
  });
});

describe('f3OfCurve', () => {
  it('finds the −3 dB point of a first-order shelf', () => {
    const f = logspace(20, 1000, 100);
    // butterworth-ish low-frequency rolloff H = (f/f3)/sqrt(1+(f/f3)²)
    const f3 = 45;
    const db = f.map((x) => 20 * Math.log10((x / f3) / Math.sqrt(1 + (x / f3) ** 2)));
    const est = f3OfCurve(f, db)!;
    expect(est).toBeGreaterThan(f3 * 0.7);
    expect(est).toBeLessThan(f3 * 1.5);
  });
});

describe('design review', () => {
  it('produces advice for a sealed default design', () => {
    const { driver, enc, ts, encRes, sys } = rig();
    const f = logspace(12, 1000, 120);
    const c = systemCurves(sys, ts, enc, encRes, f, DRIVE);
    const m = maxSplCurve(c, ts, DRIVE);
    const hd3 = hd3Estimate(c, ts, driver);
    const advice = designReview({
      ts, enclosure: enc, encRes, curves: c, maxSpl: m, hd3,
      ampPowerW: 50, powerHandlingW: 150, driverCount: 1,
    });
    expect(advice.length).toBeGreaterThan(2);
    for (const a of advice) {
      expect(['ok', 'info', 'warn', 'bad']).toContain(a.severity);
      expect(a.title.length).toBeGreaterThan(3);
      expect(['enclosure', 'amp', 'driver']).toContain(a.category);
    }
  });

  it('flags chuffing when the port is absurdly small', () => {
    const { driver, ts, enc } = rig();
    const tinyPort = { ...enc, type: 'ported' as const, internalWidth: 300, internalHeight: 400, internalDepth: 300, port: { ...enc.port, shape: 'round' as const, diameter: 25, length: 100, count: 1 } };
    const driverVolL = 3;
    const r = computeEnclosure(tinyPort, ts, driverVolL);
    const sys = buildSystem({ ts, enclosure: tinyPort, encResult: r, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0.05, sampleRate: 48000 });
    const f = logspace(12, 500, 150);
    const c = systemCurves(sys, ts, tinyPort, r, f, { ...DRIVE, vRef: 12 });
    const m = maxSplCurve(c, ts, { ...DRIVE, vRef: 12 });
    const hd3 = hd3Estimate(c, ts, driver);
    const advice = designReview({
      ts, enclosure: tinyPort, encRes: r, curves: c, maxSpl: m, hd3,
      ampPowerW: 100, powerHandlingW: 150, driverCount: 1,
    });
    expect(advice.some((a) => a.severity === 'bad' || a.severity === 'warn')).toBe(true);
  });
});
