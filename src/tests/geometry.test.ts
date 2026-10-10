/*
 * Headless smoke test for the 3D geometry builder (no WebGL): the driver
 * must build into finite, non-degenerate buffers for BOTH frame styles and
 * for extreme roll heights — a NaN vertex or empty lathe would render the
 * 3D model broken/invisible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildDriver } from '../three/geometry';
import { defaultDriver } from '../physics/defaults';
import { sanitizeDriver } from '../physics/validate';
import { MATERIALS } from '../physics/materials';
import type { DriverParams } from '../physics/types';

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

const expectFiniteGeometry = (root: { children: { children?: unknown[] }[] } & Record<string, unknown>): void => {
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
  expect(meshes).toBeGreaterThan(10);   // a full driver has many parts
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
