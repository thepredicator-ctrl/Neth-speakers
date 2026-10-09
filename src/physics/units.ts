/* Unit conversion helpers. Internals are SI; UI uses engineering units. */

export const MM = 0.001;
export const G = 0.001;
export const RHO0 = 1.204;   // kg/m³ air @ 20°C, 1 atm
export const C_SOUND = 343;  // m/s
export const MU0 = 4e-7 * Math.PI;

export const mm2m = (v: number) => v * 1e-3;
export const m2mm = (v: number) => v * 1e3;
export const g2kg = (v: number) => v * 1e-3;
export const kg2g = (v: number) => v * 1e3;
export const L2m3 = (v: number) => v * 1e-3;
export const m32L = (v: number) => v * 1e3;
export const in2mm = (v: number) => v * 25.4;
export const mm2in = (v: number) => v / 25.4;
export const c2k = (c: number) => c + 273.15;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Safe numeric guard: returns fallback for NaN/±Infinity. */
export const num = (v: number, fallback = 0) =>
  Number.isFinite(v) ? v : fallback;

export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const a = Math.abs(value);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return value.toExponential(digits - 1);
  return value.toFixed(digits);
}

export function fmtSI(value: number, unit: string, digits = 2): string {
  const a = Math.abs(value);
  if (!Number.isFinite(value)) return `— ${unit}`;
  if (a >= 1e6) return `${(value / 1e6).toFixed(digits)} M${unit}`;
  if (a >= 1e3) return `${(value / 1e3).toFixed(digits)} k${unit}`;
  if (a >= 1) return `${value.toFixed(digits)} ${unit}`;
  if (a >= 1e-3) return `${(value * 1e3).toFixed(digits)} m${unit}`;
  if (a >= 1e-6) return `${(value * 1e6).toFixed(digits)} µ${unit}`;
  return `${(value * 1e9).toFixed(digits)} n${unit}`;
}

export const dbFromRatio = (r: number) => 20 * Math.log10(Math.max(r, 1e-12));

export function linspace(a: number, b: number, n: number): number[] {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1);
  return out;
}

export function logspace(f0: number, f1: number, n: number): number[] {
  const l0 = Math.log10(f0), l1 = Math.log10(f1);
  return linspace(l0, l1, n).map((l) => Math.pow(10, l));
}
