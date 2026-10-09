/*
 * Dashboard — the mission-control view: hero metrics with health gauges,
 * rule-based design review, what-if drive controls and the master curves
 * (SPL + Max SPL ceiling, excursion headroom, group delay).
 */
import React, { useMemo } from 'react';
import { useApp } from '../store';
import { Section, Btn, Badge } from '../components/ui';
import { Plot } from '../components/Plot';
import {
  systemCurves, maxSplCurve, hd3Estimate, designReview, f3OfCurve, type AdviceItem,
} from '../physics/analysis';
import { logspace } from '../physics/units';

export function Dashboard() {
  const driver = useApp((s) => s.driver);
  const enc = useApp((s) => s.enclosure);
  const amplifier = useApp((s) => s.amplifier);
  const amp = useApp((s) => s.derived.amp);
  const ts = useApp((s) => s.derived.ts);
  const sys = useApp((s) => s.derived.sys);
  const encRes = useApp((s) => s.derived.encLitres);
  const patchAmplifier = useApp((s) => s.patchAmplifier);
  const patchEnclosure = useApp((s) => s.patchEnclosure);
  const setWorkspace = useApp((s) => s.setWorkspace);

  const vRef = amp.vpeak / Math.SQRT2;

  const analysis = useMemo(() => {
    if (!sys) return null;
    const f = logspace(12, 1000, 260);
    const drive = {
      vRef,
      clipV: amplifier.clipEnabled ? amplifier.clipVoltageRms : null,
      thermalW: driver.powerHandlingW,
      loadOhms: amp.nominalLoad,
    };
    const curves = systemCurves(sys, ts, enc, encRes, f, drive);
    const splMax = maxSplCurve(curves, ts, drive);
    const hd3 = hd3Estimate(curves, ts, driver);
    const review = designReview({
      ts, enclosure: enc, encRes: encRes ?? null,
      curves, maxSpl: splMax, hd3,
      ampPowerW: amp.estimatedPowerW,
      powerHandlingW: driver.powerHandlingW,
      driverCount: enc.driverCount,
    });
    return { f, curves, splMax, hd3, review };
  }, [sys, ts, enc, encRes, vRef, amplifier.clipEnabled, amplifier.clipVoltageRms, driver, amp.nominalLoad, amp.estimatedPowerW]);

  if (!analysis) return <div className="ws"><p className="note">Building model…</p></div>;

  const { curves, splMax, hd3, review } = analysis;

  /* ---- hero metrics ---- */
  const bassIdx: number[] = [];
  for (let i = 0; i < curves.f.length; i++) if (curves.f[i] >= 20 && curves.f[i] <= 200) bassIdx.push(i);
  const maxExc = bassIdx.length ? Math.max(...bassIdx.map((i) => curves.excMm[i])) : 0;
  const headroom = maxExc > 0.01 ? ts.Xmax / maxExc : 99;
  const vmaxPort = curves.portUm && encRes?.Fb
    ? Math.max(...bassIdx.map((i) => curves.portUm![i]))
    : null;
  const hd3Peak = bassIdx.length ? Math.max(...bassIdx.map((i) => hd3[i])) : 0;
  const gdPeak = bassIdx.length ? Math.max(...bassIdx.map((i) => curves.gdMs[i])) : 0;
  const splPeak = Math.max(...splMax.dbMax.filter(Number.isFinite));
  const f3 = f3OfCurve(curves.f, curves.splDb);

  const thermalRatio = amp.estimatedPowerW / Math.max(1, driver.powerHandlingW);

  /* what-if drive control */
  const vStep = (mult: number) => {
    if (amplifier.driveMode === 'power') patchAmplifier({ powerW: Math.max(0.1, amplifier.powerW * mult) });
    else patchAmplifier({ voltageRms: Math.max(0.1, amplifier.voltageRms * mult) });
  };

  /* what-if box volume control (keeps aspect ratio) */
  const volStep = (mult: number) => {
    patchEnclosure({
      internalWidth: Math.round(Math.min(2600, Math.max(60, enc.internalWidth * mult))),
      internalHeight: Math.round(Math.min(2600, Math.max(60, enc.internalHeight * mult))),
      internalDepth: Math.round(Math.min(2600, Math.max(60, enc.internalDepth * mult))),
    });
  };

  /* what-if tuning control: adjust port length via inverse Helmholtz */
  const tuneStep = (mult: number) => {
    if (enc.type !== 'ported' || !encRes?.Fb) return;
    const targetFb = encRes.Fb * mult;
    const r2 = Math.sqrt(encRes.portArea / Math.PI);
    const corr = enc.port.flared ? 0.85 * r2 * 2 : 0.732 * r2 * 2;
    const Leff = Math.pow(343 / (2 * Math.PI * targetFb), 2) * (encRes.portArea / Math.max(1e-6, encRes.VbEffM3));
    const L = Math.min(enc.internalDepth - 2 * enc.wallThickness, Math.max(20, (Leff - corr) * 1000));
    patchEnclosure({ port: { ...enc.port, length: Math.round(L) } });
  };

  const worst = review.reduce((a, r) => {
    const rank = { ok: 0, info: 1, warn: 2, bad: 3 } as const;
    return rank[r.severity] > rank[a] ? r.severity : a;
  }, 'ok' as AdviceItem['severity']);
  const verdict = worst === 'bad' ? { t: 'NEEDS WORK', k: 'warn' as const } : worst === 'warn' ? { t: 'REVIEW ADVISED', k: 'warn' as const } : { t: 'DESIGN SOUND', k: 'ok' as const };

  return (
    <div className="ws">
      {/* ---- verdict strip ---- */}
      <div className="verdict-strip">
        <Badge kind={verdict.k}>{verdict.t}</Badge>
        <span className="note">
          {enc.type === 'sealed' ? 'Sealed' : enc.type === 'ported' ? 'Ported' : 'Passive-radiator'} · {enc.driverCount}× ·{' '}
          {amp.estimatedPowerW.toFixed(1)} W into {amp.nominalLoad.toFixed(1)} Ω · rated drive {vRef.toFixed(2)} Vrms
        </span>
        <span className="spacer flex1" />
        <div className="row" style={{ gap: 6 }}>
          <span className="note">what-if drive:</span>
          <Btn small ghost onClick={() => vStep(1 / 1.414)}>−½ stop</Btn>
          <Btn small ghost onClick={() => vStep(1.414)}>+½ stop</Btn>
        </div>
      </div>

      {/* ---- hero metric cards ---- */}
      <div className="hero-grid">
        <Hero label="SENSITIVITY" value={ts.sens.toFixed(1)} unit="dB/2.83V/1m" pct={(ts.sens - 75) / 25} zones={[[0.28, 'bad'], [0.55, 'warn'], [1, 'ok']]} />
        <Hero label="MAX SPL PEAK" value={Number.isFinite(splPeak) ? splPeak.toFixed(0) : '—'} unit="dB @1m rated" pct={(splPeak - 80) / 45} zones={[[0.33, 'bad'], [0.56, 'warn'], [1, 'ok']]} />
        <Hero label="F3 (in box)" value={f3 ? f3.toFixed(1) : '—'} unit="Hz" pct={f3 ? Math.max(0, (90 - f3) / 70) : 0} zones={[[0.35, 'ok'], [0.7, 'warn'], [1, 'bad']]} invert />
        <Hero label="EXCURSION HEADROOM" value={headroom >= 9.9 ? '∞' : `${headroom.toFixed(2)}×`} unit="Xmax / peak demand" pct={Math.min(1, headroom / 3)} zones={[[0.25, 'bad'], [0.5, 'warn'], [1, 'ok']]} />
        {vmaxPort != null
          ? <Hero label="PORT VELOCITY" value={vmaxPort.toFixed(1)} unit="m/s at Fb" pct={vmaxPort / 30} zones={[[0.56, 'ok'], [0.9, 'warn'], [1, 'bad']]} invert />
          : <Hero label="PORT VELOCITY" value="—" unit="no port (sealed/PR)" pct={0} zones={[[1, 'ok']]} invert />}
        <Hero label="3RD HARMONIC" value={hd3Peak >= 0.05 ? hd3Peak.toFixed(1) : '<0.1'} unit="% est. peak bass" pct={hd3Peak / 10} zones={[[0.2, 'ok'], [0.8, 'warn'], [1, 'bad']]} invert />
        <Hero label="GROUP DELAY" value={gdPeak.toFixed(1)} unit="ms peak bass" pct={gdPeak / 40} zones={[[0.25, 'ok'], [0.62, 'warn'], [1, 'bad']]} invert />
        <Hero label="THERMAL LOAD" value={`${(thermalRatio * 100).toFixed(0)}%`} unit={`${amp.estimatedPowerW.toFixed(0)} / ${driver.powerHandlingW} W`} pct={thermalRatio} zones={[[0.7, 'ok'], [1, 'warn'], [1.01, 'bad']]} invert />
      </div>

      <div className="split">
        {/* ---- design review ---- */}
        <div className="side" style={{ maxWidth: 420 }}>
          <Section title="Design Review" right={<Badge kind="est">RULE-BASED</Badge>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {review.map((r, i) => (
                <div key={i} className={`advice advice-${r.severity}`}>
                  <div className="advice-head">
                    <span className={`sev-dot ${r.severity}`} />
                    <b>{r.title}</b>
                  </div>
                  <p className="note" style={{ margin: '4px 0 0' }}>{r.detail}</p>
                  {r.severity === 'warn' || r.severity === 'bad' ? (
                    <Btn small ghost style={{ marginTop: 6 }} onClick={() => setWorkspace(r.category === 'enclosure' ? 'enclosure' : r.category === 'amp' ? 'audio' : 'speaker')}>
                      Open {r.category === 'enclosure' ? 'Enclosure Designer' : r.category === 'amp' ? 'Audio Lab' : 'Speaker Lab'} →
                    </Btn>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>

          <Section title="What-if Box">
            <div className="row" style={{ gap: 6 }}>
              <Btn small ghost onClick={() => volStep(1 / 1.15)}>Vol −15%</Btn>
              <Btn small ghost onClick={() => volStep(1.15)}>Vol +15%</Btn>
            </div>
            {enc.type === 'ported' ? (
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <Btn small ghost onClick={() => tuneStep(1 / 1.06)}>Tune −6%</Btn>
                <Btn small ghost onClick={() => tuneStep(1.06)}>Tune +6%</Btn>
                <span className="note mono">{encRes?.Fb ? `${encRes.Fb.toFixed(1)} Hz` : ''}</span>
              </div>
            ) : null}
            <p className="note" style={{ marginBottom: 0 }}>
              Every change re-runs the full model — gauges and review update live.
            </p>
          </Section>
        </div>

        {/* ---- master curves ---- */}
        <div className="main-area">
          <Section title="SPL vs hard limits — rated drive, half-space piston @1 m">
            <Plot
              height={230} xLog yLabel="dB SPL"
              series={[
                { name: 'SPL (drive)', color: '#35c8dc', points: curves.f.map((f, i) => [f, curves.splDb[i]] as [number, number]), width: 2 },
                { name: 'Max SPL (all limits)', color: '#ff7a1a', points: splMax.f.map((f, i) => [f, splMax.dbMax[i]] as [number, number]), dash: [6, 4], width: 1.8 },
                { name: 'excursion limit', color: 'rgba(255,77,77,0.55)', points: splMax.f.map((f, i) => [f, splMax.byExcursion[i]] as [number, number]), dash: [3, 4], width: 1 },
                { name: 'thermal limit', color: 'rgba(255,209,102,0.55)', points: splMax.f.map((f, i) => [f, splMax.byThermal[i]] as [number, number]), dash: [3, 4], width: 1 },
              ]}
              csvName="dashboard-maxspl"
            />
            <p className="note">
              The orange ceiling is what this speaker can physically deliver: excursion (red), thermal (yellow) and
              amplifier clip (not drawn) — whichever is lowest at each frequency. The gap between cyan and orange is
              headroom you are leaving on the table at this drive level.
            </p>
          </Section>

          <div className="grid2">
            <Section title="Excursion vs Xmax (rated drive)">
              <Plot
                height={185} xLog yLabel="mm"
                series={[{ name: 'peak x', color: '#ff7a1a', points: curves.f.map((f, i) => [f, curves.excMm[i]] as [number, number]) }]}
                refLines={[{ y: ts.Xmax, color: 'rgba(255,77,77,0.7)', label: '+Xmax' }, { y: -ts.Xmax, color: 'rgba(255,77,77,0.5)', label: '−Xmax' }]}
                csvName="dashboard-excursion"
              />
            </Section>
            <Section title="Group delay (bass)" right={vmaxPort != null ? <Btn small ghost onClick={() => volStep(1)}>box ±</Btn> : undefined}>
              <Plot
                height={185} xLog yLabel="ms"
                series={[{ name: 'τg', color: '#9b7bff', points: curves.f.map((f, i) => [f, curves.gdMs[i]] as [number, number]) }]}
                refLines={[{ y: 25, color: 'rgba(255,209,102,0.5)', label: 'audible 25 ms' }]}
                csvName="dashboard-gd"
              />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero(props: {
  label: string; value: string; unit: string;
  pct: number; zones: [number, 'ok' | 'warn' | 'bad'][]; invert?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, props.pct));
  // zone coloring: find zone containing pct (zones are [upperBound, color])
  let color = 'ok';
  for (const [to, c] of props.zones) {
    if (pct <= to + 0.0001) { color = c; break; }
  }
  const markerColor = color === 'ok' ? '#4fd07a' : color === 'warn' ? '#ffd166' : '#ff4d4d';
  const fill = props.invert ? markerColor : markerColor;
  return (
    <div className="hero-card">
      <div className="hero-label">{props.label}</div>
      <div className="hero-value">{props.value}<small>{props.unit}</small></div>
      <div className="gauge">
        <div className="gauge-fill" style={{ width: `${pct * 100}%`, background: fill }} />
        {props.zones.map(([to], i) => (
          <div key={i} className="gauge-tick" style={{ left: `${Math.min(100, to * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}
