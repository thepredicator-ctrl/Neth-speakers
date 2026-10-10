/* Small shared utilities. */

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch == null) return base;
  if (Array.isArray(base)) return (Array.isArray(patch) ? patch : base) as T;
  if (typeof base === 'object' && typeof patch === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const b = (base as Record<string, unknown>)[k];
      out[k] = b !== undefined && typeof b === 'object' && b !== null && !Array.isArray(b)
        ? deepMerge(b, v)
        : v;
    }
    return out as T;
  }
  return (patch as T) ?? base;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
