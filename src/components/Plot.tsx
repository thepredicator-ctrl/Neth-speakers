/*
 * Canvas engineering plot: log/linear axes, multi-series, hover cursor with
 * value readout, horizontal reference lines, shaded limit bands and CSV export.
 * Zero dependencies, HiDPI-aware.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface Series {
  name: string;
  color: string;
  points: [number, number][];
  dash?: number[];
  width?: number;
  axis?: 'left' | 'right';
  dots?: boolean;
}

export interface PlotRefLine { y: number; color: string; label?: string; dash?: number[] }
export interface PlotBand { from: number; to: number; color: string }

export function Plot(props: {
  series: Series[];
  height?: number;
  xLog?: boolean;
  xLabel?: string;
  yLabel?: string;
  yLabel2?: string;
  xMin?: number; xMax?: number;
  yMin?: number; yMax?: number;
  refLines?: PlotRefLine[];
  bands?: PlotBand[];
  cursorFreq?: number | null;
  onCursor?: (x: number | null) => void;
  csvName?: string;
  showLegend?: boolean;
}) {
  const {
    series, height = 220, xLog = true, xLabel = 'Frequency (Hz)', yLabel = '',
    yLabel2, xMin, xMax, yMin, yMax, refLines = [], bands = [], cursorFreq, onCursor, csvName,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: height });
  const [hover, setHover] = useState<{ px: number; x: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: height }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: height });
    return () => ro.disconnect();
  }, [height]);

  const bounds = useMemo(() => {
    let x0 = xMin ?? Infinity, x1 = xMax ?? -Infinity;
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) {
      for (const s of series) for (const [x] of s.points) {
        if (!Number.isFinite(x)) continue;
        if (!xMin && x < x0) x0 = x;
        if (!xMax && x > x1) x1 = x;
      }
    }
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 === x1) { x0 = 10; x1 = 20000; }
    let y0 = yMin ?? Infinity, y1 = yMax ?? -Infinity;
    if (yMin == null || yMax == null) {
      for (const s of series) {
        if (s.axis === 'right' && yLabel2 == null) continue;
        for (const [, y] of s.points) {
          if (!Number.isFinite(y)) continue;
          if (yMin == null && y < y0) y0 = y;
          if (yMax == null && y > y1) y1 = y;
        }
      }
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) { y0 = 0; y1 = 1; }
      const pad = (y1 - y0) * 0.08 || 1;
      if (yMin == null) y0 -= pad;
      if (yMax == null) y1 += pad;
    }
    return { x0, x1, y0, y1 };
  }, [series, xMin, xMax, yMin, yMax, yLabel2]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h);
  }, [size, series, bounds, refLines, bands, hover, cursorFreq, xLog]);

  const M = { l: 56, r: yLabel2 ? 52 : 14, t: 10, b: 30 };

  const xToPx = (x: number, w: number): number => {
    const { x0, x1 } = bounds;
    if (xLog) {
      const l0 = Math.log10(Math.max(x0, 1e-6)), l1 = Math.log10(Math.max(x1, 1e-5));
      return M.l + ((Math.log10(Math.max(x, 1e-6)) - l0) / (l1 - l0)) * (w - M.l - M.r);
    }
    return M.l + ((x - x0) / (x1 - x0)) * (w - M.l - M.r);
  };
  const yToPx = (y: number, h: number, right = false): number => {
    const { y0, y1 } = bounds;
    if (right) return yLabel2 ? M.t + (1 - (y - y0) / (y1 - y0)) * (h - M.t - M.b) : h - M.b;
    return M.t + (1 - (y - y0) / (y1 - y0)) * (h - M.t - M.b);
  };

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h);
    // plot area background
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(M.l, M.t, w - M.l - M.r, h - M.t - M.b);

    // bands
    for (const b of bands) {
      const x0 = xToPx(b.from, w), x1 = xToPx(b.to, w);
      ctx.fillStyle = b.color;
      ctx.fillRect(x0, M.t, x1 - x0, h - M.t - M.b);
    }

    // grid + ticks
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const { x0, x1, y0, y1 } = bounds;
    const xt = xLog ? logTicks(x0, x1) : linTicks(x0, x1);
    for (const [v, lbl] of xt) {
      const px = xToPx(v, w);
      ctx.strokeStyle = '#1c2028';
      ctx.beginPath(); ctx.moveTo(px, M.t); ctx.lineTo(px, h - M.b); ctx.stroke();
      ctx.fillStyle = '#6d7480';
      ctx.fillText(lbl, px, h - M.b + 5);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const [v, lbl] of linTicks(y0, y1, 5)) {
      const py = yToPx(v, h);
      ctx.strokeStyle = '#1c2028';
      ctx.beginPath(); ctx.moveTo(M.l, py); ctx.lineTo(w - M.r, py); ctx.stroke();
      ctx.fillStyle = '#6d7480';
      ctx.fillText(lbl, M.l - 6, py);
    }

    // ref lines
    for (const r of refLines) {
      const py = yToPx(r.y, h);
      ctx.strokeStyle = r.color;
      ctx.setLineDash(r.dash ?? [5, 4]);
      ctx.beginPath(); ctx.moveTo(M.l, py); ctx.lineTo(w - M.r, py); ctx.stroke();
      ctx.setLineDash([]);
      if (r.label) {
        ctx.fillStyle = r.color;
        ctx.textAlign = 'left';
        ctx.fillText(r.label, M.l + 5, py - 8);
        ctx.textAlign = 'right';
      }
    }

    // series
    for (const s of series) {
      if (s.points.length === 0) continue;
      const right = s.axis === 'right' && !!yLabel2;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 1.6;
      ctx.setLineDash(s.dash ?? []);
      ctx.beginPath();
      let started = false;
      for (const [x, y] of s.points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
        const px = xToPx(x, w), py = yToPx(y, h, right);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.dots) {
        ctx.fillStyle = s.color;
        for (const [x, y] of s.points) {
          const px = xToPx(x, w), py = yToPx(y, h, right);
          ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // cursor (hover or external)
    const cx = cursorFreq != null ? xToPx(cursorFreq, w) : hover ? hover.px : null;
    if (cx != null) {
      ctx.strokeStyle = 'rgba(255,122,26,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, M.t); ctx.lineTo(cx, h - M.b); ctx.stroke();
    }

    // axis labels
    ctx.fillStyle = '#a7aeb9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(xLabel, (M.l + w - M.r) / 2, h - 1);
    if (yLabel) {
      ctx.save();
      ctx.translate(11, (M.t + h - M.b) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
    if (yLabel2) {
      ctx.save();
      ctx.translate(w - 9, (M.t + h - M.b) / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText(yLabel2, 0, 0);
      ctx.restore();
    }

    // hover tooltip
    if (hover) {
      const fx = hover.x;
      ctx.font = '10.5px ui-monospace, Menlo, monospace';
      let ty = M.t + 8;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const lines: [string, string][] = [];
      for (const s of series) {
        const pt = nearest(s.points, fx, xLog);
        if (pt) lines.push([s.name, fmtVal(pt[1])]);
      }
      const bw = Math.max(...lines.map(([n]) => n.length * 6.2 + 40), 120);
      ctx.fillStyle = 'rgba(13,15,20,0.88)';
      ctx.strokeStyle = '#313744';
      const bx = Math.min(cx + 10, w - M.r - bw - 4);
      roundRect(ctx, bx, M.t + 4, bw, 14 + lines.length * 14, 6);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#a7aeb9';
      ctx.fillText(`${xLog && fx >= 1000 ? `${(fx / 1000).toFixed(2)}k` : fx.toFixed(fx < 100 ? 1 : 0)} Hz`, bx + 8, ty);
      ty += 15;
      for (const [n, v] of lines) {
        const s = series.find((q) => q.name === n)!;
        ctx.fillStyle = s.color;
        ctx.fillRect(bx + 8, ty + 4, 10, 2.5);
        ctx.fillStyle = '#e9ebf0';
        ctx.fillText(`${n}: ${v}`, bx + 24, ty);
        ty += 14;
      }
    }
  }

  const nearest = (pts: [number, number][], x: number, log: boolean): [number, number] | null => {
    if (pts.length === 0) return null;
    const tr = log ? (v: number) => Math.log10(Math.max(v, 1e-9)) : (v: number) => v;
    let best = pts[0], bd = Infinity;
    for (const p of pts) {
      const d = Math.abs(tr(p[0]) - tr(x));
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  const fmtVal = (v: number): string => {
    const a = Math.abs(v);
    if (a >= 10000 || (a < 0.01 && a > 0)) return v.toExponential(2);
    return v.toFixed(a >= 100 ? 1 : a >= 1 ? 2 : 4);
  };

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const exportCsv = (): void => {
    const rows: string[] = [];
    const header = ['x', ...series.map((s) => s.name)];
    rows.push(header.join(','));
    const allX = new Set<number>();
    for (const s of series) for (const [x] of s.points) allX.add(x);
    const xs = [...allX].sort((a, b) => a - b);
    for (const x of xs) {
      const vals = series.map((s) => {
        const p = nearest(s.points, x, xLog);
        return p ? p[1].toPrecision(6) : '';
      });
      rows.push([x.toPrecision(6), ...vals].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName ?? 'neth-speakers-plot'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: size.h, display: 'block', borderRadius: 10, border: '1px solid var(--line)', background: '#0d0f14' }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          if (px < M.l || px > rect.width - M.r) { setHover(null); onCursor?.(null); return; }
          const { x0, x1 } = bounds;
          const frac = (px - M.l) / (rect.width - M.l - M.r);
          const x = xLog ? Math.pow(10, Math.log10(x0) + frac * (Math.log10(x1) - Math.log10(x0))) : x0 + frac * (x1 - x0);
          setHover({ px, x });
          onCursor?.(x);
        }}
        onMouseLeave={() => { setHover(null); onCursor?.(null); }}
      />
      <div style={{ position: 'absolute', top: 4, right: 8, display: 'flex', gap: 8 }}>
        {csvName ? <button className="btn ghost small" onClick={exportCsv} title="Export CSV">CSV</button> : null}
      </div>
      {props.showLegend !== false && series.length > 1 ? (
        <div className="plot-legend">
          {series.map((s) => (
            <span key={s.name}><span className="sw" style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function logTicks(x0: number, x1: number): [number, string][] {
  const out: [number, string][] = [];
  const d = Math.log10(x1) - Math.log10(x0);
  const step = d > 5 ? 1 : d > 3 ? 0.5 : 0.25;
  const start = Math.ceil(Math.log10(x0) / step) * step;
  for (let l = start; l <= Math.log10(x1) + 1e-9; l += step) {
    const v = Math.pow(10, l);
    const lbl = v >= 1000 ? `${Math.round(v / 100) / 10}k` : v >= 100 ? v.toFixed(0) : v >= 10 ? (Math.round(v * 10) / 10).toFixed(0) : v.toFixed(step < 0.3 ? 1 : 0);
    out.push([v, `${lbl}`]);
  }
  return out;
}

function linTicks(x0: number, x1: number, n = 6): [number, string][] {
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) return [[x0, '0']];
  const span = x1 - x0;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.ceil(x0 / step) * step;
  const out: [number, string][] = [];
  for (let v = start; v <= x1 + 1e-9; v += step) {
    out.push([v, step >= 1 ? v.toFixed(0) : v.toPrecision(2)]);
  }
  return out;
}
