/* Shared UI primitives: buttons, sliders with numeric input, badges, sections. */
import React, { useState } from 'react';

export function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; active?: boolean; small?: boolean }) {
  const { variant = 'default', active, small, className = '', ...rest } = props;
  const cls = ['btn', variant !== 'default' ? variant : '', active ? 'active' : '', small ? 'small' : '', className].filter(Boolean).join(' ');
  return <button className={cls} {...rest} />;
}

export function Section(props: { title: string; children: React.ReactNode; right?: React.ReactNode; collapsible?: boolean }) {
  const { title, children, right, collapsible = false } = props;
  const [open, setOpen] = useState(true);
  return (
    <div className="card fadein">
      <h3>
        {collapsible ? (
          <button className="btn ghost small" style={{ padding: '0 4px' }} onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'}
          </button>
        ) : null}
        {title}
        <span className="rule" />
        {right}
      </h3>
      {(open || !collapsible) ? children : null}
    </div>
  );
}

export function Badge(props: { kind: 'est' | 'user' | 'warn' | 'ok'; children: React.ReactNode; title?: string }) {
  return <span className={`badge ${props.kind}`} title={props.title}>{props.children}</span>;
}

/** Slider + numeric input pair with unit label. */
export function Param(props: {
  label: string;
  value: number;
  min: number; max: number; step?: number;
  unit?: string;
  digits?: number;
  badge?: 'est' | 'user' | 'warn' | 'ok' | null;
  badgeTitle?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const { label, value, min, max, step = (max - min) / 200, unit = '', digits = 1, badge, badgeTitle, onChange, disabled, hint } = props;
  const fill = ((Math.min(Math.max(value, min), max) - min) / (max - min)) * 100;
  const [txt, setTxt] = useState<string | null>(null);
  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (Number.isFinite(v)) onChange(Math.min(Math.max(v, min), Math.min(max, 1e9)));
    setTxt(null);
  };
  return (
    <div className="param" title={hint}>
      <label>{label}</label>
      <input
        type="range" className="slider" min={min} max={max} step={step} value={value} disabled={disabled}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        type="number" className="num" value={txt ?? stripNum(value, digits)}
        min={min} max={max} step={step} disabled={disabled}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
      />
      <span className="unit">{unit}</span>
      {badge ? <Badge kind={badge} title={badgeTitle}>{badge === 'est' ? 'EST' : badge === 'user' ? 'USER' : badge.toUpperCase()}</Badge> : null}
    </div>
  );
}

function stripNum(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(digits);
  return s;
}

export function Sel<T extends string>(props: {
  label: string; value: T; options: { value: T; label: string }[];
  onChange: (v: T) => void; hint?: string;
}) {
  return (
    <div className="param" title={props.hint}>
      <label>{props.label}</label>
      <div className="flex1" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)} style={{ width: 160 }}>
          {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

export function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="param" title={props.hint}>
      <label>{props.label}</label>
      <div className="flex1" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn small active={props.value} onClick={() => props.onChange(!props.value)}>
          {props.value ? 'ON' : 'OFF'}
        </Btn>
      </div>
    </div>
  );
}

export function Readout(props: { k: string; v: string; unit?: string; acc?: boolean; badge?: React.ReactNode }) {
  return (
    <div className={`readout${props.acc ? ' acc' : ''}`}>
      <div className="k"><span>{props.k}</span>{props.badge}</div>
      <div className="v">{props.v}{props.unit ? <small>{props.unit}</small> : null}</div>
    </div>
  );
}

/** Horizontal excursion bar with ±Xmax zones and a live needle. */
export function XBar(props: { xMm: number; xmax: number; xmech: number }) {
  const { xMm, xmax, xmech } = props;
  const half = Math.max(xmech, Math.abs(xMm), xmax) * 1.05;
  const pos = ((xMm + half) / (2 * half)) * 100;
  const zl = ((-xmech + half) / (2 * half)) * 100;
  const zw = ((2 * xmech) / (2 * half)) * 100;
  return (
    <div className="xbar">
      <div className="zone-max" style={{ left: `${zl}%`, width: `${zw}%` }} title="±mechanical limit" />
      <div className="zero" style={{ left: '50%' }} />
      <div className="needle" style={{ left: `calc(${Math.min(99.5, Math.max(0.5, pos))}% - 1.5px)` }} />
    </div>
  );
}

export function FileDrop(props: { onFile: (f: File) => void; label: string; accept?: string }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) props.onFile(f);
      }}
    >
      <input type="file" accept={props.accept} style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onFile(f); }} />
      {props.label}
    </label>
  );
}
