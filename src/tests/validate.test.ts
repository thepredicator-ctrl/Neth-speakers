/*
 * Tests for the parameter sanitization / self-balancing layer.
 * Contract: NO input — however broken — can produce an invalid design,
 * unstable simulation state or impossible geometry.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeDriver, sanitizeEnclosure, sanitizeAmplifier, sanitizeAudio, sanitizeSim, num,
} from '../physics/validate';
import { defaultDriver, defaultEnclosure, defaultAmplifier, defaultAudio, defaultSim } from '../physics/defaults';
import { computeTS } from '../physics/tsp';
import { buildSystem, wiringInfo, zohDiscretize } from '../physics/stateSpace';
import { computeEnclosure } from '../physics/freqresp';
import type { DriverParams } from '../physics/types';
import { MATERIALS } from '../physics/materials';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);
const base = (): DriverParams => JSON.parse(JSON.stringify(defaultDriver()));

describe('numeric primitive guard', () => {
  it('returns the fallback for NaN / Infinity / non-numbers', () => {
    expect(num(NaN, 0, 10, 3)).toBe(3);
    expect(num(Infinity, 0, 10, 3)).toBe(3);
    expect(num('x', 0, 10, 3)).toBe(3);
    expect(num(null, 0, 10, 3)).toBe(3);
  });

  it('clamps in-range extremes into bounds', () => {
    expect(num(-5, 0, 10, 3)).toBe(0);
    expect(num(50, 0, 10, 3)).toBe(10);
  });
});

describe('driver self-balancing', () => {
  it('keeps the surround bonded to the cone edge automatically', () => {
    const d = base();
    d.cone.outerDiameter = 300;          // cone grows…
    d.surround.innerDiameter = 100;      // …surround set absurdly small
    const s = sanitizeDriver(d);
    expect(s.surround.innerDiameter).toBe(300);
    expect(s.surround.outerDiameter).toBe(300 + 2 * s.surround.rollWidth);
  });

  it('derives surround outer diameter from inner + 2×rollWidth', () => {
    const d = base();
    d.surround.outerDiameter = 9999;
    const s = sanitizeDriver(d);
    expect(s.surround.outerDiameter).toBe(s.surround.innerDiameter + 2 * s.surround.rollWidth);
  });

  it('never lets the coil stack clip the pole: gap widens instead', () => {
    const d = base();
    d.coil.windingDiameter = 90;         // huge coil
    d.coil.layers = 4;
    d.magnet.poleDiameter = 50;
    d.magnet.topPlateDiameter = 60;      // tiny plate → gap far too small
    const s = sanitizeDriver(d);
    const coilOuterR = s.coil.windingDiameter / 2 + (s.coil.layers - 1) * s.coil.wireDiameter + s.coil.wireDiameter / 2;
    expect(s.magnet.poleDiameter / 2 + s.magnet.gapWidth).toBeGreaterThanOrEqual(coilOuterR);
    expect(s.magnet.topPlateDiameter).toBeGreaterThanOrEqual(s.magnet.poleDiameter + 2 * s.magnet.gapWidth);
  });

  it('magnet ring always covers the top plate and clears the pole', () => {
    const d = base();
    d.magnet.topPlateDiameter = 200;
    d.magnet.diameter = 100;             // smaller than the plate
    d.magnet.innerDiameter = 10;         // smaller than the pole
    d.magnet.poleDiameter = 50;
    const s = sanitizeDriver(d);
    expect(s.magnet.diameter).toBeGreaterThanOrEqual(s.magnet.topPlateDiameter);
    expect(s.magnet.innerDiameter).toBeGreaterThanOrEqual(s.magnet.poleDiameter);
  });

  it('spider inner tracks the former outer wall', () => {
    const d = base();
    d.coil.formerDiameter = 70;
    d.spider.innerDiameter = 20;
    const s = sanitizeDriver(d);
    expect(s.spider.innerDiameter).toBeCloseTo(70 + 2 * s.coil.formerThickness, 5);
  });

  it('frame depth auto-grows to house the motor stack', () => {
    const d = base();
    d.magnet.thickness = 60;
    d.magnet.count = 3;
    d.frame.depth = 30;
    const s = sanitizeDriver(d);
    expect(s.frame.depth).toBeGreaterThanOrEqual(
      (s.cone.depth + s.coil.formerHeight * 0.72 + s.magnet.topPlateThickness + 180 + s.magnet.backPlateThickness) * 0.86 - 1e-6
    );
  });

  it('winding can never exceed the former (turns auto-reduced)', () => {
    const d = base();
    d.coil.formerHeight = 10;
    d.coil.turnsPerLayer = 400;
    const s = sanitizeDriver(d);
    const windH = s.coil.turnsPerLayer * s.coil.wireDiameter * 1.08;
    expect(windH).toBeLessThanOrEqual(s.coil.formerHeight - 2.5 + 1e-9);
  });

  it('Xmax can never exceed Xmech', () => {
    const d = base();
    d.xmaxOverride = 50;
    d.xmechOverride = 10;
    const s = sanitizeDriver(d);
    const ts = computeTS(s, mats);
    expect(ts.Xmax).toBeLessThanOrEqual(ts.Xmech + 1e-9);
  });
});

describe('sanitization keeps valid designs untouched', () => {
  it('a geometrically consistent design passes through with identical T-S values', () => {
    const d = base();
    // 4-layer 50 mm coil needs ≈ 2.4 mm radial gap — make the stock design consistent
    d.magnet.gapWidth = 3;
    const a = computeTS(d, mats);
    const b = computeTS(sanitizeDriver(d), mats);
    expect(b.Fs).toBeCloseTo(a.Fs, 6);
    expect(b.Re).toBeCloseTo(a.Re, 6);
    expect(b.Bl).toBeCloseTo(a.Bl, 6);
    expect(b.Mms).toBeCloseTo(a.Mms, 9);
  });

  it('auto-widens a too-tight magnetic gap instead of clipping the coil', () => {
    const d = base();            // stock gap 1.0 mm < 4-layer stack needs
    const s = sanitizeDriver(d);
    const coilOuterR = s.coil.windingDiameter / 2 + (s.coil.layers - 1) * s.coil.wireDiameter + s.coil.wireDiameter / 2;
    expect(s.magnet.poleDiameter / 2 + s.magnet.gapWidth).toBeGreaterThanOrEqual(coilOuterR);
  });
});

describe('enclosure / amplifier / audio / sim guards', () => {
  it('port never exceeds the box interior', () => {
    const e = JSON.parse(JSON.stringify(defaultEnclosure())) as ReturnType<typeof defaultEnclosure>;
    e.internalDepth = 200;
    e.wallThickness = 18;
    e.port.length = 5000;
    const s = sanitizeEnclosure(e, defaultDriver());
    expect(s.port.length).toBeLessThanOrEqual(s.internalDepth - 2 * s.wallThickness);
  });

  it('port diameter is limited by the box face', () => {
    const e = defaultEnclosure();
    e.port.diameter = 900;
    const s = sanitizeEnclosure(e, defaultDriver());
    expect(s.port.diameter).toBeLessThanOrEqual(Math.min(s.internalWidth, s.internalHeight) * 0.7);
  });

  it('amplifier clip limit auto-raises to the drive voltage', () => {
    const a = defaultAmplifier();
    a.clipEnabled = true;
    a.voltageRms = 40;
    a.clipVoltageRms = 10;
    const s = sanitizeAmplifier(a);
    expect(s.clipVoltageRms).toBeGreaterThanOrEqual(s.voltageRms);
  });

  it('audio and sim enums survive garbage values', () => {
    const a = sanitizeAudio({ ...defaultAudio(), channel: 'XX' as never, volume: 42 });
    expect(a.channel).toBe('sum');
    expect(a.volume).toBe(1);
    const s = sanitizeSim({ ...defaultSim(), mode: 'warp' as never, quality: 'quantum' as never, speed: 100 });
    expect(s.mode).toBe('dynamic');
    expect(s.quality).toBe('precision');
    expect(s.speed).toBe(1);
  });
});

describe('NaN-proofing the whole state', () => {
  it('a state flooded with NaN still yields finite T-S and a stable system', () => {
    const d = base();
    const poison = (o: Record<string, unknown>) => {
      for (const k of Object.keys(o)) {
        const v = (o as Record<string, unknown>)[k];
        if (typeof v === 'number') (o as Record<string, unknown>)[k] = NaN;
        else if (v && typeof v === 'object') poison(v as Record<string, unknown>);
      }
    };
    poison(d as unknown as Record<string, unknown>);
    const s = sanitizeDriver(d);
    const ts = computeTS(s, mats);
    for (const v of [ts.Fs, ts.Re, ts.Bl, ts.Mms, ts.Cms, ts.Rms, ts.Sd, ts.Vas, ts.Qms, ts.Qes, ts.Qts]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    const enc = sanitizeEnclosure(defaultEnclosure(), s);
    const encResult = computeEnclosure(enc, ts, 0.9);
    const sys = buildSystem({
      ts, enclosure: enc, encResult,
      wiring: wiringInfo(ts, enc.driverCount, enc.wiring, enc.coilWiring, 1),
      sourceImpedance: 0.05, sampleRate: 48000,
    });
    // ZOH-discretize exactly as the audio engine does, then propagate 5 s of
    // free dynamics from a unit state: a stable system must stay bounded.
    const disc = zohDiscretize(sys.A, sys.B, 1 / 48000);
    const A = disc.Ad;
    const n = disc.n;
    let st: number[] = new Array(n).fill(1);
    let maxAbs = 0;
    for (let k = 0; k < 48000 * 5; k++) {
      const nx: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < n; j++) acc += A[i][j] * st[j];
        nx[i] = acc;
      }
      st = nx;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(st[i])) throw new Error(`state ${i} diverged to non-finite at step ${k}`);
        maxAbs = Math.max(maxAbs, Math.abs(st[i]));
      }
    }
    expect(maxAbs).toBeLessThan(1e4);
  });
});
