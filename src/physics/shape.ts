/*
 * Neth Speakers — cone/piston SHAPE math (pure, unit-testable).
 *
 * Three piston shapes are supported everywhere a radiating surface exists
 * (driver cone, dust dome, surround, passive radiator):
 *   round  — surface of revolution (the classic driver)
 *   oval   — ellipse with major Ø d1 and minor Ø d2 ( automotive 6×9 class)
 *   square — rounded square (superellipse, exponent SQUARE_N; Kicker L7 class)
 *
 * The 3D model morphs a lathe of revolution into the shape: a circle of
 * radius r at angle θ maps to
 *   oval  : (r·cosθ, r·k·sinθ)          with k = d2/d1
 *   square: (r·s·cosθ, r·s·sinθ)        with s = shapeRadialFactor(θ, n)
 * where s(θ) traces the superellipse |cosθ|^n + |sinθ|^n = 1 exactly. Near
 * the voice-coil neck the morph exponent blends back to 2 (circle), so an
 * oval/square cone still bonds to the ROUND former with zero gap — exactly
 * how real shaped drivers are built.
 *
 * Physics: every downstream consumer (Sd, Vd, PR area, box coupling) reads
 * the round-EQUIVALENT diameter, defined as the circle with the same piston
 * area — so shaped pistons change SPL and tuning exactly by their real area.
 */

export type ConeShape = 'round' | 'oval' | 'square';

export const SHAPES: readonly ConeShape[] = ['round', 'oval', 'square'];

/** Superellipse exponent for 'square' pistons. 2 = circle, ∞ = sharp square.
 *  6 gives the slightly-rounded corners of a cast square subwoofer frame. */
export const SQUARE_N = 6;

/** Radial factor s(θ) of the superellipse |cosθ|^n + |sinθ|^n = 1, i.e. the
 *  radius (relative to the axis-aligned half-width) at angle θ. s(0)=1,
 *  s(π/4)=2^(1/2−1/n) → √2 as n→∞ (the square diagonal). */
export function shapeRadialFactor(theta: number, n: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}

/* Lanczos gamma (g=7) — only needed for the fixed SQUARE_N area factor, but
 * kept general so the exponent stays a documented constant, not a magic one. */
function gamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/** Area of the superellipse |x/a|^n + |y/a|^n ≤ 1 relative to the bounding
 *  square (2a)². For n=2 this is π/4; for n=6 ≈ 0.9638. */
export function superellipseAreaFactor(n: number): number {
  return Math.pow(gamma(1 + 1 / n), 2) / gamma(1 + 2 / n);
}

/** Piston area (mm²) of the MOVING surface — effective diameters already
 *  include half the surround roll for the driver, or the full radiating face
 *  for a passive radiator. `d2` is ignored for round/square. */
export function pistonAreaMm2(shape: ConeShape, d1: number, d2: number): number {
  const D1 = Math.max(1e-6, d1);
  if (shape === 'oval') {
    const D2 = Math.max(1e-6, Math.min(d2, D1));
    return (Math.PI / 4) * D1 * D2;
  }
  if (shape === 'square') {
    return superellipseAreaFactor(SQUARE_N) * D1 * D1;
  }
  return (Math.PI / 4) * D1 * D1;
}

/** Diameter (mm) of the round piston with the SAME area — the value stored
 *  in `cone.effectiveDiameter`, so Sd = π/4·d_eq² reproduces the shaped
 *  piston area exactly and nothing downstream changes. */
export function equivalentDiameterMm(shape: ConeShape, d1: number, d2: number): number {
  return 2 * Math.sqrt(pistonAreaMm2(shape, d1, d2) / Math.PI);
}
