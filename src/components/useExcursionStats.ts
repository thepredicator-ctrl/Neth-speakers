/*
 * Session excursion statistics — derived from the engine's displacement
 * history ring, i.e. from the SAME model output the plots draw. There is no
 * independent animation value anywhere, so these numbers cannot disagree
 * with the physics.
 *
 *   peak : session record of max |x| (one-way, mm) since last reset
 *   p2p  : peak-to-peak travel over the current history window (mm)
 *   min/max : current window extremes (mm, signed — preserves polarity)
 */
import { useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine';

export interface ExcursionStats {
  peak: number;   // mm, one-way session record (>= 0)
  p2p: number;    // mm, current window peak-to-peak
  min: number;    // mm, signed window minimum
  max: number;    // mm, signed window maximum
}

const EMPTY: ExcursionStats = { peak: 0, p2p: 0, min: 0, max: 0 };

export function useExcursionStats(): { stats: ExcursionStats; reset: () => void } {
  const [stats, setStats] = useState<ExcursionStats>(EMPTY);
  const peakRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    let last = 0;
    const tick = (t: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (t - last < 50) return;   // 20 Hz is plenty for numeric readouts
      last = t;
      const h = engine.displacementHistory();
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < h.count; i++) {
        const idx = (h.head - h.count + i + h.data.length * 2) % h.data.length;
        const v = h.data[idx];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (!Number.isFinite(mn) || !Number.isFinite(mx)) return;
      const peak = Math.max(peakRef.current, Math.abs(mx), Math.abs(mn));
      peakRef.current = peak;
      setStats((old) => {
        const next = { peak: peak * 1000, p2p: (mx - mn) * 1000, min: mn * 1000, max: mx * 1000 };
        // skip identical frames to avoid needless re-renders
        if (Math.abs(old.peak - next.peak) < 1e-4 && Math.abs(old.p2p - next.p2p) < 1e-4
          && Math.abs(old.min - next.min) < 1e-4 && Math.abs(old.max - next.max) < 1e-4) return old;
        return next;
      });
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return {
    stats,
    reset: () => { peakRef.current = 0; setStats({ ...EMPTY }); },
  };
}
