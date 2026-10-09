/* Small dense linear algebra + complex helpers for the speaker model.
 * Matrix sizes here are ≤ 7×7, so direct implementations are fast enough. */

export type Mat = number[][];
export type Vec = number[];

export const zeros = (n: number): Mat => Array.from({ length: n }, () => new Array(n).fill(0));

export function matMul(A: Mat, B: Mat): Mat {
  const n = A.length, m = B[0].length, k = B.length;
  const C: Mat = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) C[i][j] += a * B[p][j];
    }
  return C;
}

export function identity(n: number): Mat {
  const I = zeros(n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

/** Matrix exponential via scaling-and-squaring with a Taylor series. */
export function expm(A: Mat): Mat {
  const n = A.length;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    let rowAbs = 0;
    for (let j = 0; j < n; j++) rowAbs += Math.abs(A[i][j]);
    norm = Math.max(norm, rowAbs);
  }
  const s = Math.max(0, Math.ceil(Math.log2(Math.max(norm, 1e-16))) + 1);
  const As = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) As[i][j] = A[i][j] / Math.pow(2, s);

  let E = identity(n);
  let term = identity(n);
  for (let k = 1; k <= 18; k++) {
    term = matMul(term, As);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) term[i][j] /= k;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) E[i][j] += term[i][j];
  }
  for (let q = 0; q < s; q++) E = matMul(E, E);
  return E;
}

/* ---------------- Complex helpers ---------------- */
export interface Cx { re: number; im: number }
export const cplx = (re: number, im = 0): Cx => ({ re, im });
export const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im || 1e-300;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const cabs = (a: Cx) => Math.hypot(a.re, a.im);
export const carg = (a: Cx) => Math.atan2(a.im, a.re);
