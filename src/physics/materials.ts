/*
 * Materials & component reference database.
 *
 * Values are typical literature figures for common loudspeaker materials.
 * They are ILLUSTRATIVE defaults, not verified data for a specific commercial
 * grade — every entry carries an `illustrative` flag which the UI surfaces as
 * an "est." badge. Users can define custom materials (persisted in IndexedDB).
 */
import type { MaterialDef } from './types';

export type { MaterialDef };

export const MATERIALS: MaterialDef[] = [
  // ---- Cone diaphragms -------------------------------------------------
  { id: 'paper', name: 'Kraft paper pulp', category: 'cone', density: 480, youngs: 3.2e9, lossFactor: 0.045,
    notes: 'Classic paper cone: light, well damped, humidity sensitive.', color: '#2e2a24', illustrative: true },
  { id: 'polypropylene', name: 'Polypropylene (PP)', category: 'cone', density: 905, youngs: 1.6e9, lossFactor: 0.06,
    notes: 'Poly cone: consistent, moisture proof, moderately damped.', color: '#23262b', illustrative: true },
  { id: 'aluminium', name: 'Aluminium', category: 'cone', density: 2700, youngs: 69e9, lossFactor: 0.002,
    notes: 'Stiff, light, low damping — strong breakup modes above ~5 kHz.', color: '#b8bcc4', illustrative: false },
  { id: 'carbonfiber', name: 'Carbon fiber composite', category: 'cone', density: 1600, youngs: 35e9, lossFactor: 0.012,
    notes: 'High stiffness-to-mass woven composite.', color: '#1d2126', illustrative: true },
  { id: 'kevlar', name: 'Kevlar® composite', category: 'cone', density: 1440, youngs: 28e9, lossFactor: 0.02,
    notes: 'Aramid fiber composite, good damping/stiffness balance.', color: '#4a4d22', illustrative: true },
  { id: 'fiberglass', name: 'Glass fiber composite', category: 'cone', density: 1800, youngs: 22e9, lossFactor: 0.02,
    notes: 'Cost-effective stiff composite.', color: '#3a4038', illustrative: true },

  // ---- Surrounds --------------------------------------------------------
  { id: 'rubber-butyl', name: 'Butyl rubber', category: 'surround', density: 1100, youngs: 2.5e6, lossFactor: 0.35,
    notes: 'High damping, long life. Default for long-throw designs.', color: '#17181c', illustrative: true },
  { id: 'foam-polyether', name: 'Polyether foam', category: 'surround', density: 250, youngs: 0.5e6, lossFactor: 0.3,
    notes: 'Very compliant, light — ages faster than rubber.', color: '#2a2c30', illustrative: true },
  { id: 'rubber-nbr', name: 'NBR rubber', category: 'surround', density: 1200, youngs: 3e6, lossFactor: 0.3,
    notes: 'Nitrile rubber surround, robust.', color: '#1a1b1f', illustrative: true },
  { id: 'surround-cloth', name: 'Treated cloth', category: 'surround', density: 500, youngs: 200e6, lossFactor: 0.08,
    notes: 'Stiff linen/cloth surround for high-efficiency drivers.', color: '#5c5344', illustrative: true },

  // ---- Spiders ----------------------------------------------------------
  { id: 'spider-cotton', name: 'Impregnated cotton fabric', category: 'spider', density: 600, youngs: 500e6, lossFactor: 0.1,
    notes: 'Conventional cup spider material.', color: '#8a7a5c', illustrative: true },
  { id: 'spider-nomex', name: 'Nomex® fabric', category: 'spider', density: 450, youngs: 800e6, lossFactor: 0.08,
    notes: 'Polyamide paper spider, heat resistant.', color: '#9a8468', illustrative: true },
  { id: 'spider-glass', name: 'Glass-composite spider', category: 'spider', density: 900, youngs: 3e9, lossFactor: 0.06,
    notes: 'Stiff composite spider for high-power subwoofers.', color: '#6a705f', illustrative: true },

  // ---- Voice-coil wire ---------------------------------------------------
  { id: 'copper', name: 'Copper (Cu)', category: 'wire', density: 8960, resistivity: 1.724e-8, tempCo: 0.00393,
    notes: 'Standard winding wire, ρ20 = 1.724×10⁻⁸ Ω·m.', illustrative: false },
  { id: 'aluminium-wire', name: 'Aluminium (Al) wire', category: 'wire', density: 2700, resistivity: 2.82e-8, tempCo: 0.00403,
    notes: 'Lighter coil, ~64% higher resistivity than copper.', illustrative: false },
  { id: 'ccaw', name: 'CCAW (Cu-clad Al)', category: 'wire', density: 3700, resistivity: 3.6e-8, tempCo: 0.0040,
    notes: 'Copper-clad aluminium: light with solderable skin. Effective ρ illustrative.', illustrative: true },

  // ---- Formers -----------------------------------------------------------
  { id: 'former-alu', name: 'Aluminium former', category: 'former', density: 2700,
    notes: 'Conductive former: adds eddy-current damping, slightly raises Le.', color: '#a9adb5', illustrative: false },
  { id: 'former-kapton', name: 'Kapton® (polyimide)', category: 'former', density: 1420,
    notes: 'Non-conductive, heat tolerant former.', color: '#6b4d1e', illustrative: true },
  { id: 'former-nomex', name: 'Nomex® former', category: 'former', density: 450,
    notes: 'Paper-like polyamide former, light and non-conductive.', color: '#8a7a5f', illustrative: true },
  { id: 'former-fiberglass', name: 'Fiberglass former', category: 'former', density: 1900,
    notes: 'Glass-fibre former for high power.', color: '#5f6a5c', illustrative: true },

  // ---- Magnet materials ----------------------------------------------------
  { id: 'ferrite-y30', name: 'Ferrite Y30 (hard ferrite)', category: 'magnet', density: 4800, br: 0.395, muR: 1.1,
    notes: 'Standard ceramic magnet grade. Br ≈ 0.39–0.41 T.', color: '#43302b', illustrative: true },
  { id: 'ferrite-y35', name: 'Ferrite Y35', category: 'magnet', density: 4900, br: 0.43, muR: 1.1,
    notes: 'Higher-grade ceramic magnet.', color: '#3c2b26', illustrative: true },
  { id: 'neodymium-n42', name: 'NdFeB N42', category: 'magnet', density: 7500, br: 1.32, muR: 1.05,
    notes: 'Neodymium N42: Br ≈ 1.29–1.32 T. Temperature sensitive.', color: '#9aa0a8', illustrative: true },
  { id: 'neodymium-n52', name: 'NdFeB N52', category: 'magnet', density: 7500, br: 1.43, muR: 1.05,
    notes: 'Strongest common NdFeB grade.', color: '#a8aeb6', illustrative: true },

  // ---- Frame / structure ---------------------------------------------------
  { id: 'steel', name: 'Steel (stamped)', category: 'frame', density: 7850,
    notes: 'Stamped steel basket & motor plates.', color: '#5b6068', illustrative: false },
  { id: 'aluminium-frame', name: 'Aluminium (cast)', category: 'frame', density: 2700,
    notes: 'Cast aluminium basket.', color: '#8d929a', illustrative: false },
  { id: 'mdf', name: 'MDF 18 mm', category: 'enclosure', density: 750,
    notes: 'Standard enclosure material, good damping/cost.', color: '#7a5c3e', illustrative: true },
  { id: 'birch-ply', name: 'Birch plywood', category: 'enclosure', density: 680,
    notes: 'Stiff, light enclosure material.', color: '#a3814f', illustrative: true },
  { id: 'particleboard', name: 'Particle board', category: 'enclosure', density: 700,
    notes: 'Economy enclosure material.', color: '#6b543a', illustrative: true },
];

export const MATERIAL_MAP: Record<string, MaterialDef> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m])
);

export function materialById(id: string, custom: MaterialDef[] = []): MaterialDef | undefined {
  return MATERIAL_MAP[id] || custom.find((m) => m.id === id);
}

export const CUSTOM_MATERIAL_PREFIX = 'custom:';
