/*
 * Oval / square piston shape tests — physics AND geometry.
 *
 * A cone shape ('round' | 'oval' | 'square') must behave like a real shaped
 * driver end-to-end:
 *   1. area math — the superellipse/ellipse piston area and its round
 *      equivalent are exact
 *   2. Sd auto-sync — sanitizeDriver derives effectiveDiameter from the
 *      SHAPED piston (cone + ½ roll through the shape map), so SPL and Vd
 *      always match the drawn geometry
 *   3. legacy projects — missing shape fields sanitize to round with no
 *      change in behaviour
 *   4. PR shapes — the enclosure physics uses the shaped PR area (N radiators
 *      aggregate), and an oval/square PR tunes differently from a round one
 *   5. 3D smoke — buildDriver/buildEnclosure produce finite geometry for
 *      shaped builds, including full-stroke deformation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  pistonAreaMm2, equivalentDiameterMm, shapeRadialFactor,
  superellipseAreaFactor, SQUARE_N,
} from '../physics/shape';
import { defaultDriver, defaultEnclosure } from '../physics/defaults';
import { sanitizeDriver, sanitizeEnclosure } from '../physics/validate';
import { computeTS } from '../physics/tsp';
import { computeEnclosure } from '../physics/freqresp';
import { MATERIALS } from '../physics/materials';
import { buildDriver, buildEnclosure } from '../three/geometry';
import type { DriverParams, EnclosureParams } from '../physics/types';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);
const base0 = (): DriverParams => JSON.parse(JSON.stringify(defaultDriver()));
const baseEnc = (): EnclosureParams => JSON.parse(JSON.stringify(defaultEnclosure()));

describe('piston shape math', () => {
  it('round piston: area = π/4·d², equivalent diameter = d', () => {
    const d = 300;
    expect(pistonAreaMm2('round', d, d)).toBeCloseTo((Math.PI / 4) * d * d, 6);
    expect(equivalentDiameterMm('round', d, d)).toBeCloseTo(d, 9);
  });

  it('oval piston: area = π/4·d1·d2, equivalent = sqrt(d1·d2)', () => {
    const d1 = 230, d2 = 150;
    expect(pistonAreaMm2('oval', d1, d2)).toBeCloseTo((Math.PI / 4) * d1 * d2, 6);
    expect(equivalentDiameterMm('oval', d1, d2)).toBeCloseTo(Math.sqrt(d1 * d2), 9);
    // clamped to round when minor ≥ major
    expect(pistonAreaMm2('oval', d1, d1 + 50)).toBeCloseTo((Math.PI / 4) * d1 * d1, 6);
  });

  it('square piston: superellipse area slightly under the bounding square', () => {
    const d = 380;
    const area = pistonAreaMm2('square', d, d);
    expect(area).toBeGreaterThan(0.9 * d * d);
    expect(area).toBeLessThan(d * d);
    expect(area).toBeCloseTo(superellipseAreaFactor(SQUARE_N) * d * d, 4);
    // corners bulge: radius factor between the apothem (1) and the diagonal (√2)
    expect(shapeRadialFactor(0, SQUARE_N)).toBeCloseTo(1, 9);
    expect(shapeRadialFactor(Math.PI / 4, SQUARE_N)).toBeGreaterThan(1.05);
    expect(shapeRadialFactor(Math.PI / 4, SQUARE_N)).toBeLessThan(Math.SQRT2);
    // n → 2 recovers the circle
    expect(shapeRadialFactor(Math.PI / 4, 2)).toBeCloseTo(1, 9);
  });

  it('shaped areas rank oval(0.72) < round < square at the same major Ø', () => {
    const d = 400;
    const oval = pistonAreaMm2('oval', d, d * 0.72);
    const round = pistonAreaMm2('round', d, d);
    const square = pistonAreaMm2('square', d, d);
    expect(oval).toBeLessThan(round);
    expect(round).toBeLessThan(square);
  });
});

describe('sanitizeDriver shape sync', () => {
  it('oval: effective diameter is the round-equivalent of the shaped piston', () => {
    const d = base0();
    d.cone.outerDiameter = 230;
    d.cone.minorDiameter = 150;
    d.surround.rollWidth = 20;          // above the 8 % auto-balance floor
    d.cone.shape = 'oval';
    const s = sanitizeDriver(d);
    const d1 = 230 + 20, d2 = 150 + 20;
    expect(s.cone.shape).toBe('oval');
    expect(s.cone.effectiveDiameter).toBeCloseTo(Math.sqrt(d1 * d2), 6);
  });

  it('square: effective diameter exceeds the round one (corners carry area)', () => {
    const d = base0();
    d.cone.outerDiameter = 380;
    d.surround.rollWidth = 20;
    const round = sanitizeDriver(d);
    const sq = sanitizeDriver({ ...d, cone: { ...d.cone, shape: 'square' } });
    expect(sq.cone.shape).toBe('square');
    expect(sq.cone.effectiveDiameter).toBeGreaterThan(round.cone.effectiveDiameter);
    expect(sq.cone.effectiveDiameter / round.cone.effectiveDiameter).toBeLessThan(1.2);
  });

  it('legacy projects without a shape field sanitize to round, unchanged', () => {
    const d = base0();
    const c = d.cone as unknown as Record<string, unknown>;
    delete c.shape;
    delete c.minorDiameter;
    const s = sanitizeDriver(d);
    expect(s.cone.shape).toBe('round');
    const ref = sanitizeDriver(base0());
    expect(s.cone.effectiveDiameter).toBeCloseTo(ref.cone.effectiveDiameter, 9);
  });

  it('oval minor axis can never exceed the major axis', () => {
    const d = base0();
    d.cone.outerDiameter = 200;
    d.cone.minorDiameter = 900;
    d.cone.shape = 'oval';
    const s = sanitizeDriver(d);
    expect(s.cone.minorDiameter).toBeLessThanOrEqual(200);
  });
});

describe('shaped passive radiators', () => {
  it('sanitizer fills/repairs PR shape fields', () => {
    const d = sanitizeDriver(base0());
    const e = baseEnc();
    (e as unknown as { passive: Record<string, unknown> }).passive = {
      enabled: true, diameter: 300, mass: 400, suspensionStiffness: 250, damping: 1,
      shape: 'banana', minorDiameter: 5000,
    };
    const s = sanitizeEnclosure(e, d);
    expect(s.passive.shape).toBe('round');              // invalid → round
    expect(s.passive.minorDiameter).toBeLessThanOrEqual(s.passive.diameter);
  });

  it('PR area and tuning use the shaped area (N radiators aggregate)', () => {
    const d = sanitizeDriver(base0());
    const ts = computeTS(d, mats);
    const mk = (shape: 'round' | 'oval' | 'square'): EnclosureParams => sanitizeEnclosure({
      ...baseEnc(),
      type: 'passiveRadiator',
      internalWidth: 450, internalHeight: 520, internalDepth: 400,
      passive: {
        ...baseEnc().passive,
        enabled: true, diameter: 300, count: 2,
        shape, minorDiameter: 220,
        mass: 350, suspensionStiffness: 200, damping: 0.8,
      },
    }, d);
    const round = computeEnclosure(mk('round'), ts, 2.5);
    const oval = computeEnclosure(mk('oval'), ts, 2.5);
    const square = computeEnclosure(mk('square'), ts, 2.5);
    const roundA = (Math.PI / 4) * 300 * 300 * 2 * 1e-6;
    const ovalA = (Math.PI / 4) * 300 * 220 * 2 * 1e-6;
    expect(round.prArea).toBeCloseTo(roundA, 9);
    expect(oval.prArea).toBeCloseTo(ovalA, 9);
    expect(oval.prArea).toBeLessThan(round.prArea);
    expect(square.prArea).toBeGreaterThan(round.prArea);
    expect(square.prArea).toBeLessThan((2 * 300 * 300) * 1e-6); // under the bounding square
    // smaller PR area → less box stiffness referred to the PR → lower tuning
    expect(oval.Fb!).toBeLessThan(round.Fb!);
  });
});

/* ------------------------------------------------------------------------ */
/* 3D smoke: shaped drivers and shaped PR cabinets build finite geometry    */
/* ------------------------------------------------------------------------ */

/** Minimal canvas 2D stub — enough for the procedural textures. */
function stubCanvas(): void {
  const absorb = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      return () => undefined;
    },
    set: () => true,
  });
  const makeCanvas = () => ({
    width: 256, height: 256,
    getContext: () => absorb,
  });
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : {}),
  };
}

function expectFiniteGeometry(root: unknown, minMeshes = 10): void {
  let meshes = 0;
  const walk = (o: { children?: unknown[] } & Record<string, unknown>): void => {
    const kids = o.children as ({ children?: unknown[] } & Record<string, unknown>)[] | undefined;
    if (!kids) return;
    for (const c of kids) {
      const pos = (c as { geometry?: { getAttribute?: (a: string) => { array?: Float32Array | number[] } } }).geometry?.getAttribute?.('position');
      if (pos?.array) {
        meshes++;
        const arr = pos.array as ArrayLike<number>;
        expect(arr.length).toBeGreaterThan(0);
        for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) {
            throw new Error(`non-finite vertex ${arr[i]} at index ${i}`);
          }
        }
      }
      walk(c);
    }
  };
  walk(root as { children?: unknown[] } & Record<string, unknown>);
  expect(meshes).toBeGreaterThan(minMeshes - 1);
}

describe('shaped 3D builds (headless smoke)', () => {
  beforeAll(() => stubCanvas());

  it('oval and square drivers build finite geometry and deform at full stroke', () => {
    for (const shape of ['oval', 'square'] as const) {
      const raw = base0();
      raw.cone.shape = shape;
      raw.cone.outerDiameter = 320;
      raw.cone.minorDiameter = 210;
      raw.cone.depth = 60;
      raw.surround.rollHeight = 26;
      raw.surround.rollWidth = 24;
      const d = sanitizeDriver(raw);
      const g = buildDriver(d, mats, 'med');
      expectFiniteGeometry(g.group);
      g.deform(g.limits.up);
      g.deform(-g.limits.down);
      g.deform(0);
      expectFiniteGeometry(g.group);
      g.dispose();
    }
  });

  it('oval and square PRs mount on the side walls with finite buffers', () => {
    const d = sanitizeDriver(base0());
    for (const shape of ['oval', 'square'] as const) {
      const e = sanitizeEnclosure({
        ...baseEnc(),
        type: 'passiveRadiator',
        internalWidth: 520, internalHeight: 620, internalDepth: 460,
        passive: {
          ...baseEnc().passive,
          enabled: true, diameter: 330, shape, minorDiameter: 240,
          count: 2, mass: 420, suspensionStiffness: 280, damping: 1.6,
        },
      }, d);
      const g = buildEnclosure(e, d, 'med');
      const tags: string[] = [];
      g.group.children.forEach((c) => {
        const pr = (c.userData as { pr?: { wall?: string } }).pr;
        if (pr?.wall) tags.push(pr.wall);
      });
      expect(tags).toEqual(['right', 'left']);
      g.setPrDisplacement(g.prTravel);
      g.setPrDisplacement(-g.prTravel);
      expectFiniteGeometry(g.group, 3);
      g.dispose();
    }
  });
});
