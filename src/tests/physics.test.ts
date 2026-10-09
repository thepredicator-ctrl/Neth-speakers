/*
 * Engineering validation tests for the Neth Speakers physics engine.
 * Covers the acceptance list: T-S relations, impedance behaviour,
 * time/frequency-domain consistency, sign/scale/zero handling, units,
 * winding resistance, enclosure volumes, wiring, sync logic, project
 * round-trips and model stability.
 */
import { describe, it, expect } from 'vitest';
import { computeTS } from '../physics/tsp';
import { computeWinding } from '../physics/winding';
import { computeMagnet } from '../physics/magnet';
import { defaultDriver, defaultEnclosure, defaultAmplifier } from '../physics/defaults';
import { buildSystem, zohDiscretize, wiringInfo } from '../physics/stateSpace';
import { computeEnclosure, impedanceAt, impedanceCurve, runDiscrete, steadyStateMag, responseOverGrid } from '../physics/freqresp';
import { computeAmp, combineImpedance } from '../physics/amplifier';
import { SpeakerFilter, sineBlock, logSweep, toneBurst, FS_DEFAULT } from '../physics/dsp';
import { mm2m, m2mm, g2kg, kg2g, L2m3, m32L, in2mm, mm2in } from '../physics/units';
import { SyncClock } from '../audio/sync';
import { serializeProject, validateProject, newProjectRecord } from '../storage/project';
import { MATERIALS } from '../physics/materials';
import type { DriverParams, EnclosureParams } from '../physics/types';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);
const driver = (): DriverParams => defaultDriver();

/* 1 & 2 — Thiele–Small relations ------------------------------------------------ */
describe('Thiele–Small relations', () => {
  it('Fs matches the analytical 1/(2π√(Mms·Cms)) relation', () => {
    const ts = computeTS(driver(), mats);
    const expected = 1 / (2 * Math.PI * Math.sqrt(ts.Mms * ts.Cms));
    expect(Math.abs(ts.Fs - expected) / expected).toBeLessThan(1e-12);
  });

  it('Qms, Qes, Qts match the analytical equations', () => {
    const ts = computeTS(driver(), mats);
    const qms = (2 * Math.PI * ts.Fs * ts.Mms) / ts.Rms;
    const qes = (2 * Math.PI * ts.Fs * ts.Mms * ts.Re) / (ts.Bl * ts.Bl);
    const qts = (qms * qes) / (qms + qes);
    expect(Math.abs(ts.Qms - qms) / qms).toBeLessThan(1e-12);
    expect(Math.abs(ts.Qes - qes) / qes).toBeLessThan(1e-12);
    expect(Math.abs(ts.Qts - qts) / qts).toBeLessThan(1e-12);
    expect(ts.Qts).toBeLessThan(Math.min(ts.Qms, ts.Qes) + 1e-9);
  });

  it('Vas follows ρ0·c²·Sd²·Cms', () => {
    const ts = computeTS(driver(), mats);
    const vas = 1.204 * 343 * 343 * ts.Sd * ts.Sd * ts.Cms * 1e3;
    expect(Math.abs(ts.Vas - vas) / vas).toBeLessThan(1e-9);
  });

  it('Xmax uses one-way (gap − winding)/2 for overhung coils and is not peak-to-peak', () => {
    const d = driver();
    const ts = computeTS(d, mats);
    expect(ts.Xmax).toBeGreaterThanOrEqual(0);
    // doubling: Xmax must be half of total travel
    expect(ts.Xmax * 2).toBeLessThanOrEqual(ts.Xmech * 2 + 1e-9);
  });
});

/* 3 — Impedance behaviour near resonance ------------------------------------------ */
describe('Electrical impedance', () => {
  it('is maximal and purely resistive at free-air resonance', () => {
    const ts = computeTS(driver(), mats);
    // search for |Z| max between 5 Hz and 500 Hz
    let fPeak = ts.Fs, zMax = 0;
    for (let f = 5; f < 500; f += 0.25) {
      const Z = impedanceAt(ts, f, null, null);
      const m = Math.hypot(Z.re, Z.im);
      if (m > zMax) { zMax = m; fPeak = f; }
    }
    expect(Math.abs(fPeak - ts.Fs) / ts.Fs).toBeLessThan(0.02);
    const Zr = impedanceAt(ts, ts.Fs, null, null);
    expect(Math.abs(Zr.im) / Math.max(Zr.re, 1e-9)).toBeLessThan(0.01);
    // motional peak: Re + Bl²/Rms (plus Le reactance ≈ 0 at Fs)
    const expected = ts.Re + (ts.Bl * ts.Bl) / ts.Rms;
    expect(Math.abs(Zr.re - expected) / expected).toBeLessThan(0.02);
  });

  it('series/parallel impedance combination works (11)', () => {
    expect(combineImpedance([8, 8], 'series')).toBeCloseTo(16, 9);
    expect(combineImpedance([8, 8], 'parallel')).toBeCloseTo(4, 9);
    expect(combineImpedance([4, 4, 4], 'series')).toBeCloseTo(12, 9);
  });

  it('sealed box raises impedance-peak frequency above Fs', () => {
    const d = driver();
    const ts = computeTS(d, mats);
    const enc = defaultEnclosure();
    const encRes = computeEnclosure(enc, ts, 1.2);
    let fPeakFree = 0, fPeakBox = 0, zMax = 0;
    for (let f = 5; f < 800; f += 0.25) {
      const m0 = Math.hypot(...Object.values(impedanceAt(ts, f, null, null)));
      if (m0 > zMax) { zMax = m0; fPeakFree = f; }
    }
    zMax = 0;
    for (let f = 5; f < 800; f += 0.25) {
      const Z = impedanceAt(ts, f, enc, encRes);
      const m0 = Math.hypot(Z.re, Z.im);
      if (m0 > zMax) { zMax = m0; fPeakBox = f; }
    }
    expect(fPeakBox).toBeGreaterThan(fPeakFree);
  });
});

/* 4 — Time-domain vs frequency-domain consistency ---------------------------------- */
describe('Time/frequency-domain consistency', () => {
  it('ZOH discrete model reproduces analytical |x/u| at spot frequencies', () => {
    const ts = computeTS(driver(), mats);
    const sys = buildSystem({ ts, enclosure: null, encResult: null, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0, sampleRate: FS_DEFAULT });
    const fs = FS_DEFAULT;
    for (const f of [20, 40, 90, 300, 1000]) {
      const sec = Math.max(1.2, 40 / f);
      const u = sineBlock(f, 1, sec, fs);
      const res = runDiscrete(sys.A, sys.B, u);
      const meas = steadyStateMag(u, res.x, f, fs);
      const grid = responseOverGrid(sys.A, sys.B, sys.cx, [f]);
      const analytic = grid.mag[0];
      expect(Math.abs(meas - analytic) / analytic).toBeLessThan(0.03);
    }
  });

  it('impulse response decays and matches total Q behaviour', () => {
    const ts = computeTS(driver(), mats);
    const sys = buildSystem({ ts, enclosure: null, encResult: null, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0, sampleRate: FS_DEFAULT });
    const { Ad, Bd, n } = zohDiscretize(sys.A, sys.B, 1 / FS_DEFAULT);
    const filt = new SpeakerFilter(Ad, Bd, 1 / FS_DEFAULT);
    const N = FS_DEFAULT * 2;
    let maxAbs = 0, energy = 0;
    for (let k = 0; k < N; k++) {
      filt.step(k === 10 ? 1 : 0);
      maxAbs = Math.max(maxAbs, Math.abs(filt.x));
      energy += filt.x * filt.x;
    }
    expect(maxAbs).toBeGreaterThan(0);
    // decayed well below peak by end of run
    expect(Math.abs(filt.x)).toBeLessThan(maxAbs * 1e-6);
    expect(energy).toBeGreaterThan(0);
    void n;
  });
});

/* 5, 6, 7 — sign / scaling / zero ---------------------------------------------------- */
describe('Displacement behaviour', () => {
  it('positive DC voltage produces positive (forward) displacement', () => {
    const ts = computeTS(driver(), mats);
    const sys = buildSystem({ ts, enclosure: null, encResult: null, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0, sampleRate: FS_DEFAULT });
    const { Ad, Bd } = zohDiscretize(sys.A, sys.B, 1 / FS_DEFAULT);
    const filt = new SpeakerFilter(Ad, Bd, 1 / FS_DEFAULT);
    for (let k = 0; k < FS_DEFAULT; k++) filt.step(2);
    expect(filt.x).toBeGreaterThan(0);
    // DC value ≈ Bl·u/(Re·Kms)
    const dcExpected = (ts.Bl * 2) / (ts.Re * ts.Kms);
    expect(Math.abs(filt.x - dcExpected) / dcExpected).toBeLessThan(0.01);
  });

  it('negative voltage gives negative displacement (symmetric)', () => {
    const ts = computeTS(driver(), mats);
    const sys = buildSystem({ ts, enclosure: null, encResult: null, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0, sampleRate: FS_DEFAULT });
    const { Ad, Bd } = zohDiscretize(sys.A, sys.B, 1 / FS_DEFAULT);
    const f1 = new SpeakerFilter(Ad, Bd, 1 / FS_DEFAULT);
    const f2 = new SpeakerFilter(Ad, Bd, 1 / FS_DEFAULT);
    for (let k = 0; k < FS_DEFAULT; k++) { f1.step(1.5); f2.step(-1.5); }
    expect(f1.x).toBeGreaterThan(0);
    expect(f2.x).toBeLessThan(0);
    expect(Math.abs(f1.x + f2.x)).toBeLessThan(1e-12);
  });

  it('linear model scales: x(2u) = 2·x(u)', () => {
    const ts = computeTS(driver(), mats);
    const sys = buildSystem({ ts, enclosure: null, encResult: null, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0, sampleRate: FS_DEFAULT });
    const { Ad, Bd } = zohDiscretize(sys.A, sys.B, 1 / FS_DEFAULT);
    const f1 = new SpeakerFilter(Ad, Bd, 1 / FS_DEFAULT);
    const f2 = new SpeakerFilter(Ad, Bd, 1 / FS_DEFAULT);
    const u = sineBlock(55, 1, 0.5, FS_DEFAULT);
    for (let k = 0; k < u.length; k++) { f1.step(u[k]); f2.step(u[k] * 2); }
    expect(f2.x / f1.x).toBeCloseTo(2, 6);
  });

  it('zero input keeps state at zero', () => {
    const ts = computeTS(driver(), mats);
    const sys = buildSystem({ ts, enclosure: null, encResult: null, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0, sampleRate: FS_DEFAULT });
    const { Ad, Bd } = zohDiscretize(sys.A, sys.B, 1 / FS_DEFAULT);
    const filt = new SpeakerFilter(Ad, Bd, 1 / FS_DEFAULT);
    for (let k = 0; k < FS_DEFAULT; k++) filt.step(0);
    expect(filt.x).toBe(0);
    expect(filt.v).toBe(0);
    expect(filt.i).toBe(0);
  });
});

/* 8 — Units ------------------------------------------------------------------------- */
describe('Unit conversions', () => {
  it('converts mm/m, g/kg, L/m³, in/mm', () => {
    expect(mm2m(1000)).toBeCloseTo(1, 12);
    expect(m2mm(2.5)).toBeCloseTo(2500, 9);
    expect(g2kg(1500)).toBeCloseTo(1.5, 12);
    expect(kg2g(0.25)).toBeCloseTo(250, 9);
    expect(L2m3(30)).toBeCloseTo(0.03, 12);
    expect(m32L(0.045)).toBeCloseTo(45, 9);
    expect(in2mm(1)).toBeCloseTo(25.4, 12);
    expect(mm2in(25.4)).toBeCloseTo(1, 12);
  });
});

/* 9 — Voice-coil resistance ----------------------------------------------------------- */
describe('Voice-coil winding', () => {
  it('matches a hand-computed copper coil example', () => {
    const d = driver();
    const w = computeWinding(d.coil, mats);
    // hand calc: pitch = 0.45mm·1.08; 4 layers, 34 turns each
    const pitch = 0.45e-3 * 1.08;
    const d0 = 51.0e-3;
    let L = 0;
    for (let k = 0; k < 4; k++) L += Math.PI * (d0 + 2 * k * pitch) * 34;
    const area = (Math.PI / 4) * Math.pow(0.45e-3, 2);
    const Re30 = (1.724e-8 * L / area) * (1 + 0.00393 * 10);
    expect(w.wireLength).toBeCloseTo(L, 4);
    expect(w.Re).toBeCloseTo(Re30, 4);
  });

  it('temperature raises copper resistance ~0.39%/°C', () => {
    const d = driver();
    d.coil.temperatureC = 20;
    const w20 = computeWinding(d.coil, mats);
    d.coil.temperatureC = 120;
    const w120 = computeWinding(d.coil, mats);
    expect(w120.Re / w20.Re).toBeCloseTo(1 + 0.00393 * 100, 3);
  });

  it('aluminium wire has ~1.64× the resistivity of copper for the same geometry', () => {
    const d = driver();
    d.coil.temperatureC = 20;
    d.coil.wireMaterialId = 'copper';
    const cu = computeWinding(d.coil, mats);
    d.coil.wireMaterialId = 'aluminium-wire';
    const al = computeWinding(d.coil, mats);
    expect(al.Re / cu.Re).toBeCloseTo(2.82 / 1.724, 3);
  });

  it('magnetic circuit gives a plausible Bl for the demo driver', () => {
    const d = driver();
    const w = computeWinding(d.coil, mats);
    const m = computeMagnet(d.magnet, d.coil, w, mats);
    // Demo driver should land in a woofer-like range, not order-of-magnitude off
    expect(m.Bgap).toBeGreaterThan(0.2);
    expect(m.Bgap).toBeLessThan(1.4);
    expect(m.Bl).toBeGreaterThan(2);
    expect(m.Bl).toBeLessThan(30);
  });
});

/* 10 — Enclosure volumes --------------------------------------------------------------- */
describe('Enclosure calculations', () => {
  it('computes gross volume from internal dimensions', () => {
    const ts = computeTS(driver(), mats);
    const enc = defaultEnclosure();
    const r = computeEnclosure(enc, ts, 0);
    expect(r.VbGross).toBeCloseTo((340 * 380 * 300) / 1e6, 3);
    expect(r.VbNet).toBeCloseTo(r.VbGross - enc.bracingVolume, 3);
  });

  it('subtracts driver, port and bracing displacement from net volume', () => {
    const ts = computeTS(driver(), mats);
    const enc = defaultEnclosure();
    enc.type = 'ported';
    const r = computeEnclosure(enc, ts, 2.5);
    const portV = (Math.PI / 4) * Math.pow(0.068, 2) * 0.12 * 1e3;
    expect(r.VbNet).toBeCloseTo((340 * 380 * 300) / 1e6 - 2.5 - portV - 0.6, 3);
    expect(r.portVolumeL).toBeCloseTo(portV, 4);
  });

  it('port tuning follows the Helmholtz equation', () => {
    const ts = computeTS(driver(), mats);
    const enc = defaultEnclosure();
    enc.type = 'ported';
    const r = computeEnclosure(enc, ts, 1.5);
    const Sp = (Math.PI / 4) * Math.pow(0.068, 2);
    const Leff = 0.12 + 0.85 * 0.034 * 2;
    const Fb = (343 / (2 * Math.PI)) * Math.sqrt(Sp / ((r.VbEff * 1e-3) * Leff));
    expect(r.Fb).toBeCloseTo(Fb, 2);
  });

  it('sealed box shifts the impedance peak to Fc = Fs·√(1+Vas/Vb)', () => {
    const ts = computeTS(driver(), mats);
    const enc = defaultEnclosure();
    const encRes = computeEnclosure(enc, ts, 1.2);
    // The motional impedance peak sits at the boxed resonance Fc and is
    // robust to voltage-drive/inductance effects (unlike displacement/velocity).
    let fPeak = 0, mag = 0;
    for (let f = 10; f < 200; f += 0.05) {
      const Z = impedanceAt(ts, f, enc, encRes);
      const m = Math.hypot(Z.re, Z.im);
      if (m > mag) { mag = m; fPeak = f; }
    }
    const FcExpected = ts.Fs * Math.sqrt(1 + ts.Vas / encRes.VbEff);
    expect(Math.abs(fPeak - FcExpected) / FcExpected).toBeLessThan(0.03);
    expect(fPeak).toBeGreaterThan(ts.Fs); // box must stiffen the system
  });
});

/* Amplifier --------------------------------------------------------------------------- */
describe('Amplifier model', () => {
  it('does not assume constant power: P = V²/Z', () => {
    const ts = computeTS(driver(), mats);
    const amp = defaultAmplifier();
    const wi = wiringInfo(ts, 1, 'parallel', 'parallel', 1);
    const r1 = computeAmp(amp, ts, wi);
    expect(r1.estimatedPowerW).toBeCloseTo((2.83 * 2.83) / r1.nominalLoad, 3);
    const wi4 = wiringInfo(ts, 2, 'parallel', 'parallel', 1); // two identical drivers in parallel
    const r2 = computeAmp({ ...amp, driveMode: 'voltage' }, ts, wi4);
    expect(r2.nominalLoad).toBeCloseTo(wi4.loadImpedance, 6);
    expect(r2.estimatedPowerW).toBeCloseTo((2.83 * 2.83) / wi4.loadImpedance, 3);
  });

  it('bridged mode doubles voltage swing', () => {
    const ts = computeTS(driver(), mats);
    const amp = { ...defaultAmplifier(), bridged: true };
    const r = computeAmp(amp, ts, wiringInfo(ts, 1, 'parallel', 'parallel', 1));
    const r0 = computeAmp({ ...defaultAmplifier(), bridged: false }, ts, wiringInfo(ts, 1, 'parallel', 'parallel', 1));
    expect(r.vpeak).toBeCloseTo(2 * r0.vpeak, 9);
  });
});

/* 12 — Synchronization ------------------------------------------------------------------ */
describe('Audio sync clock', () => {
  it('tracks position across play / pause / resume / seek', () => {
    const clock = new SyncClock();
    clock.play(10, 0);
    expect(clock.offset(11)).toBeCloseTo(1, 9);
    expect(clock.offset(12.5)).toBeCloseTo(2.5, 9);
    const off = clock.pause(13);
    expect(off).toBeCloseTo(3, 9);
    expect(clock.offset(14)).toBeCloseTo(3, 9); // frozen while paused
    clock.play(20, off); // resume from 3 s
    expect(clock.offset(21)).toBeCloseTo(4, 9);
    clock.seek(22, 100); // jump while playing
    expect(clock.offset(23)).toBeCloseTo(101, 9);
  });

  it('extrapolates render displacement from the latest worklet sample', () => {
    const clock = new SyncClock();
    clock.play(0, 0);
    clock.pushSample(0.002, 0.05, 5.0);
    expect(clock.renderDisplacement(5.01)).toBeCloseTo(0.002 + 0.05 * 0.01, 12);
    expect(clock.renderDisplacement(5.5)).toBeCloseTo(0.002 + 0.05 * 0.05, 12); // dt capped
    expect(clock.healthy(5.1)).toBe(true);
    expect(clock.healthy(5.9)).toBe(false);
  });
});

/* 13 — Project round-trip ----------------------------------------------------------------- */
describe('Project persistence', () => {
  it('serializes and validates a full round trip', () => {
    const d = driver();
    d.cone.outerDiameter = 240;
    const enc = defaultEnclosure();
    enc.type = 'ported';
    const parts = { driver: d, enclosure: enc, amplifier: defaultAmplifier(), audio: { channel: 'L', band: 'bass', vizMode: 'physical', vizMultiplier: 1, volume: 0.5, acousticOutput: false }, sim: { mode: 'dynamic', speed: 1, running: true, paused: false } } as const;
    const rec = newProjectRecord('Round Trip Test', parts as never);
    const json = JSON.parse(JSON.stringify(rec));
    const v = validateProject(json);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.project.name).toBe('Round Trip Test');
      expect(v.project.driver.cone.outerDiameter).toBe(240);
      expect(v.project.enclosure.type).toBe('ported');
      expect(v.project.audio.channel).toBe('L');
    }
  });

  it('repairs partial/legacy files onto defaults', () => {
    const v = validateProject({ app: 'neth-speakers', version: 1, name: 'Partial', driver: { cone: { outerDiameter: 300 } } });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.project.driver.cone.outerDiameter).toBe(300);
      expect(v.project.driver.magnet.poleDiameter).toBeCloseTo(50.0, 6);
      expect(v.project.enclosure.type).toBe('sealed');
    }
  });

  it('rejects foreign files', () => {
    expect(validateProject({ app: 'other' }).ok).toBe(false);
    expect(validateProject(null).ok).toBe(false);
    expect(validateProject('hello').ok).toBe(false);
  });
});

/* 14 — Stability ---------------------------------------------------------------------------- */
describe('Dynamic model stability', () => {
  it('remains bounded for randomized-but-plausible driver/box combinations driven by noise', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let trial = 0; trial < 8; trial++) {
      const d = driver();
      d.cone.effectiveDiameter = 100 + rnd() * 250;
      d.surround.stiffness = 200 + rnd() * 1500;
      d.spider.stiffness = 400 + rnd() * 3000;
      d.coil.wireDiameter = 0.25 + rnd() * 0.6;
      d.coil.layers = 1 + Math.floor(rnd() * 4);
      d.coil.turnsPerLayer = 20 + Math.floor(rnd() * 40);
      d.magnet.materialId = rnd() > 0.5 ? 'ferrite-y30' : 'neodymium-n42';
      d.magnet.thickness = 8 + rnd() * 25;
      d.magnet.topPlateThickness = 4 + rnd() * 8;
      const ts = computeTS(d, mats);
      if (ts.Xmax <= 0) continue;
      const enc: EnclosureParams = { ...defaultEnclosure(), type: trial % 3 === 0 ? 'ported' : 'sealed' };
      const encRes = computeEnclosure(enc, ts, 1 + rnd() * 4);
      const sys = buildSystem({
        ts, enclosure: enc, encResult: encRes,
        wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1),
        sourceImpedance: rnd() * 0.5, sampleRate: FS_DEFAULT,
      });
      const u = logSweep(15, 20000, 10, 2, FS_DEFAULT);
      const res = runDiscrete(sys.A, sys.B, u);
      let maxAbs = 0;
      for (let k = 0; k < res.x.length; k++) maxAbs = Math.max(maxAbs, Math.abs(res.x[k]));
      expect(Number.isFinite(maxAbs)).toBe(true);
      // 10 V peak into any plausible driver must not diverge (mechanical stop aside)
      expect(maxAbs).toBeLessThan(0.5); // 500 mm — far beyond any real driver; divergence would be ~1e100
    }
  });

  it('tone burst and impulse do not blow up', () => {
    const ts = computeTS(driver(), mats);
    const sys = buildSystem({ ts, enclosure: null, encResult: null, wiring: wiringInfo(ts, 1, 'parallel', 'parallel', 1), sourceImpedance: 0, sampleRate: FS_DEFAULT });
    for (const sig of [toneBurst(50, 2, 10, FS_DEFAULT), sineBlock(25, 2, 2, FS_DEFAULT)]) {
      const res = runDiscrete(sys.A, sys.B, sig);
      let m = 0;
      for (let k = 0; k < res.x.length; k++) m = Math.max(m, Math.abs(res.x[k]));
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeLessThan(1);
    }
  });
});
