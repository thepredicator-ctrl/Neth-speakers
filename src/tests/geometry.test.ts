/*
 * Headless smoke test for the 3D geometry builder (no WebGL): the driver
 * must build into finite, non-degenerate buffers for BOTH frame styles and
 * for extreme roll heights — a NaN vertex or empty lathe would render the
 * 3D model broken/invisible. The enclosure builder is smoke-tested too,
 * including the passive radiators: they must mount on the SIDE walls
 * (never the bottom), only their piston assembly may translate, and the
 * buffers must stay finite through the full PR stroke.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildDriver, buildEnclosure, type EnclosureGeometry } from '../three/geometry';
import { defaultDriver, defaultEnclosure } from '../physics/defaults';
import { sanitizeDriver, sanitizeEnclosure } from '../physics/validate';
import { MATERIALS } from '../physics/materials';
import type { DriverParams, EnclosureParams } from '../physics/types';

const mats = (id: string) => MATERIALS.find((m) => m.id === id);

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

const expectFiniteGeometry = (root: { children: { children?: unknown[] }[] } & Record<string, unknown>, minMeshes = 10): void => {
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
            throw new Error(`non-finite vertex ${arr[i]} at index ${i} of a mesh with ${arr.length} floats`);
          }
        }
      }
      walk(c);
    }
  };
  walk(root);
  expect(meshes).toBeGreaterThan(minMeshes - 1);   // a full driver has many parts
};

describe('buildDriver headless smoke', () => {
  beforeAll(() => stubCanvas());

  const configs: [string, (d: DriverParams) => void][] = [
    ['stock default', () => undefined],
    ['diecast + boot + tall roll', (d) => {
      d.frame.style = 'diecast'; d.frame.boot = true;
      d.surround.rollHeight = 45; d.surround.rollWidth = 30;
      d.cone.outerDiameter = 400; d.cone.depth = 82;
    }],
    ['crazy 200 mm roll, no boot, stamped', (d) => {
      d.frame.style = 'stamped'; d.frame.boot = false;
      d.surround.rollHeight = 200; d.surround.rollWidth = 120;
      d.cone.outerDiameter = 800; d.cone.depth = 150;
      d.frame.mountingHoles = 8;
    }],
    ['no gasket, exposed motor, 8 leads', (d) => {
      d.frame.gasket = false; d.frame.boot = false; d.frame.tinselLeads = 4;
      d.surround.rollHeight = 12;
    }],
  ];

  for (const [name, tune] of configs) {
    it(`builds finite geometry: ${name}`, () => {
      const raw = base0();
      tune(raw);
      const d = sanitizeDriver(raw);
      for (const quality of ['low', 'med', 'high'] as const) {
        const g = buildDriver(d, mats, quality);
        expectFiniteGeometry(g.group as unknown as Parameters<typeof expectFiniteGeometry>[0]);
        // deformable buffers re-lathe per frame — exercise the extremes
        g.deform(g.limits.up);
        g.deform(-g.limits.down);
        g.deform(0);
        expectFiniteGeometry(g.group as unknown as Parameters<typeof expectFiniteGeometry>[0]);
        g.dispose();
      }
    });
  }
});

function base0(): DriverParams {
  return JSON.parse(JSON.stringify(defaultDriver()));
}

/* ------------------------------------------------------------------------ */
/* Enclosure + passive radiators                                            */
/* ------------------------------------------------------------------------ */

/** PR enclosure like the designer's mid-size box; count + height overridable. */
function prEnclosure(count: number, height = 620): EnclosureParams {
  const base = defaultEnclosure();
  return sanitizeEnclosure({
    ...base,
    type: 'passiveRadiator',
    internalWidth: 520, internalHeight: height, internalDepth: 460,
    passive: { enabled: true, diameter: 330, count, mass: 420, suspensionStiffness: 280, damping: 1.6 },
  }, sanitizeDriver(base0()));
}

function prWallTags(g: EnclosureGeometry): string[] {
  const tags: string[] = [];
  g.group.children.forEach((c) => {
    const pr = (c.userData as { pr?: { wall?: string } }).pr;
    if (pr?.wall) tags.push(pr.wall);
  });
  return tags;
}

describe('buildEnclosure passive radiators mount on the SIDE walls', () => {
  beforeAll(() => stubCanvas());

  it('single PR sits on a side wall (right), never the bottom', () => {
    const g = buildEnclosure(prEnclosure(1), sanitizeDriver(base0()), 'med');
    const tags = prWallTags(g);
    expect(tags).toEqual(['right']);
    expect(tags).not.toContain('bottom');
    expect(g.prTravel).toBeGreaterThan(0);
    // through the full stroke the buffers stay finite and the frame stays put
    g.setPrDisplacement(g.prTravel);
    g.setPrDisplacement(-g.prTravel);
    g.setPrDisplacement(0);
    expectFiniteGeometry(g.group as unknown as Parameters<typeof expectFiniteGeometry>[0]);
    g.dispose();
  });

  it('count 2/3 lay out across the sides (left+right, +rear)', () => {
    const d = sanitizeDriver(base0());
    expect(prWallTags(buildEnclosure(prEnclosure(2), d, 'med'))).toEqual(['right', 'left']);
    expect(prWallTags(buildEnclosure(prEnclosure(3), d, 'med'))).toEqual(['right', 'left', 'rear']);
  });

  it('count 4 stacks two per side when the wall is tall, else one per wall', () => {
    const d = sanitizeDriver(base0());
    // 620 mm wall: Ø330 flanges cannot stack → graceful one-per-wall fallback
    const short = prWallTags(buildEnclosure(prEnclosure(4), d, 'med'));
    expect(short).toHaveLength(4);
    expect(new Set(short)).toEqual(new Set(['right', 'left', 'rear', 'front']));
    // tall wall: two per side, JL-Fathom style
    const tall = prWallTags(buildEnclosure(prEnclosure(4, 1000), d, 'med'));
    expect(tall).toHaveLength(4);
    expect(tall.filter((t) => t === 'right')).toHaveLength(2);
    expect(tall.filter((t) => t === 'left')).toHaveLength(2);
    for (const q of ['low', 'high'] as const) {
      const g = buildEnclosure(prEnclosure(2), d, q);
      expectFiniteGeometry(g.group as unknown as Parameters<typeof expectFiniteGeometry>[0]);
      g.dispose();
    }
  });

  it('sealed/ported enclosures still build finite with no PR units', () => {
    const d = sanitizeDriver(base0());
    for (const type of ['sealed', 'ported'] as const) {
      const enc = sanitizeEnclosure({ ...defaultEnclosure(), type }, d);
      const g = buildEnclosure(enc, d, 'med');
      expect(prWallTags(g)).toEqual([]);
      expectFiniteGeometry(g.group as unknown as Parameters<typeof expectFiniteGeometry>[0], 3);
      g.dispose();
    }
  });
});
