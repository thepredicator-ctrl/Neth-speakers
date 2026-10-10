/* Enclosure Designer — sealed / ported / passive-radiator design with cutaway 3D. */
import React, { useMemo, useState } from 'react';
import { useApp } from '../store';
import { Section, Btn, Param, Sel, Badge, Readout, Toggle } from '../components/ui';
import { Plot } from '../components/Plot';
import { Viewport3D } from '../components/Viewport3D';
import { Viewport3D as _V } from '../components/Viewport3D';
import { responseOverGrid, computeEnclosure } from '../physics/freqresp';
import { buildSystem, wiringInfo } from '../physics/stateSpace';
import { logspace, C_SOUND, RHO0 } from '../physics/units';
import { computeAmp } from '../physics/amplifier';
import { optimizeAlignment, autoPort, portFlowAtFb, type AlignSolution } from '../physics/analysis';

export function EnclosureDesigner() {
  const driver = useApp((s) => s.driver);
  const enc = useApp((s) => s.enclosure);
  const patchEnclosure = useApp((s) => s.patchEnclosure);
  const patchPort = useApp((s) => s.patchPort);
  const patchPassive = useApp((s) => s.patchPassive);
  const amplifier = useApp((s) => s.amplifier);
  const ts = useApp((s) => s.derived.ts);
  const drvL = useApp((s) => s.derived.driverDisplacementL);
  const amp = useApp((s) => s.derived.amp);
  const [wallOpacity, setWallOpacity] = useState(0.16);
  const [section, setSection] = useState<number>(35);
  const [cursor, setCursor] = useState<number | null>(null);
  const [wizard, setWizard] = useState<AlignSolution | null>(null);
  const [wizardBusy, setWizardBusy] = useState(false);

  const res = useApp((s) => s.derived.encLitres);

  /* ---- comparison curves: current type + the two alternatives ---- */
  const curves = useMemo(() => {
    const f = logspace(10, 1000, 260);
    const mk = (type: typeof enc.type) => {
      const e = { ...enc, type };
      const r = computeEnclosure(e, ts, drvL);
      const sys = buildSystem({
        ts, enclosure: e, encResult: r,
        wiring: wiringInfo(ts, e.driverCount, e.wiring, e.coilWiring, 1),
        sourceImpedance: amplifier.outputImpedance, sampleRate: 48000,
      });
      const spl = responseOverGrid(sys.A, sys.B, sys.cp, f);
      const exc = responseOverGrid(sys.A, sys.B, sys.cx, f);
      const vRef = amp.vpeak / Math.SQRT2;
      return {
        splDb: spl.mag.map((m) => 20 * Math.log10(Math.max(m * vRef * sys.splScale, 1e-12) / 2e-5)),
        excMm: exc.mag.map((m) => m * vRef * 1000),
        Fb: r.Fb,
      };
    };
    return { f, current: mk(enc.type), sealed: mk('sealed'), ported: mk('ported'), pr: mk('passiveRadiator') };
  }, [ts, enc, drvL, amplifier.outputImpedance, amp.vpeak, driver]);

  const colorFor: Record<string, string> = { sealed: '#35c8dc', ported: '#ff7a1a', passiveRadiator: '#9b7bff' };

  /* port air speed at Fb under rated voltage */
  const portSpeed = useMemo(() => {
    if (enc.type !== 'ported' || !res || res.portArea <= 0) return null;
    const sys = useApp.getState().derived.sys;
    if (!sys) return null;
    const f = res.Fb ?? 40;
    const grid = responseOverGrid(sys.A, sys.B, sys.cv, [f]);
    const vCone = grid.mag[0] * (amp.vpeak / Math.SQRT2); // m/s rms
    const u = Math.abs(vCone * ts.Sd) / res.portArea; // crude: port velocity ≈ Sd·v/Sp near Fb
    return u;
  }, [res, ts.Sd, amp.vpeak, enc.type]);

  const wiring = useMemo(() => {
    const n = Math.max(1, Math.round(enc.driverCount));
    const series = enc.wiring === 'series';
    const perDriver = series ? 1 / n : 1;
    return { n, series, perDriver };
  }, [enc.driverCount, enc.wiring]);

  /* ---- Box Wizard: numeric alignment search on the real model ---- */
  const runWizard = (kind: 'sealedButterworth' | 'maxflat' | 'ebs') => {
    setWizardBusy(true);
    setTimeout(() => {
      try {
        const sol = optimizeAlignment({
          ts, base: enc, driverDisplacementL: drvL, vRated: amp.vpeak / Math.SQRT2,
          maxPortLenMM: enc.internalDepth - 2 * enc.wallThickness,
        }, { kind, targetQtc: 0.707 });
        // port volume flow at the proposed Fb from the exact state model
        let port: AlignSolution['port'] | undefined;
        if (sol.FbHz != null) {
          const wctx = { ts, base: enc, driverDisplacementL: drvL, vRated: amp.vpeak / Math.SQRT2, maxPortLenMM: enc.internalDepth - 2 * enc.wallThickness };
          const U = portFlowAtFb(wctx, sol.VbL, sol.FbHz, amp.vpeak / Math.SQRT2);
          port = autoPort(wctx, sol.VbL, sol.FbHz, U);
        }
        // apply everything in one patch so sanitization sees consistent dims
        patchEnclosure({
          type: kind === 'sealedButterworth' ? 'sealed' : 'ported',
          internalWidth: Math.round(sol.internal.w),
          internalHeight: Math.round(sol.internal.h),
          internalDepth: Math.round(sol.internal.d),
          ...(port ? { port: { ...enc.port, shape: port.shape, diameter: port.diameter, length: port.length, count: port.count, flared: port.flared, slotWidth: port.slotWidth, slotHeight: port.slotHeight } } : {}),
        });
        setWizard({ ...sol, port });
      } finally {
        setWizardBusy(false);
      }
    }, 30);
  };

  return (
    <div className="ws no-scroll" style={{ height: '100%' }}>
      <div className="split" style={{ flex: 1 }}>
        <div className="side">
          <Section title="Box Wizard — Auto-Align" right={wizardBusy ? <Badge kind="est">SEARCHING…</Badge> : undefined}>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <Btn variant="primary" disabled={wizardBusy} onClick={() => runWizard('maxflat')} title="Searches volume+tuning for the flattest passband, then deepest F3">
                ◎ Ported · Max-Flat alignment
              </Btn>
              <Btn disabled={wizardBusy} onClick={() => runWizard('ebs')} title="Allows a small shelf to reach the lowest possible extension">
                ↓ Ported · EBS (deep extension)
              </Btn>
              <Btn disabled={wizardBusy} onClick={() => runWizard('sealedButterworth')} title="Closed-form Qtc = 0.707 Butterworth box">
                ◯ Sealed · Butterworth Qtc 0.707
              </Btn>
            </div>
            {wizard ? (
              <div className="card" style={{ marginTop: 8, background: 'var(--panel2)' }}>
                <div className="readout-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Readout k="Box (net target)" v={wizard.VbL.toFixed(1)} unit="L" acc />
                  {wizard.FbHz != null ? <Readout k="Tuning Fb" v={wizard.FbHz.toFixed(1)} unit="Hz" acc /> : <Readout k="Qtc" v={wizard.Qtc?.toFixed(2) ?? '—'} acc />}
                  <Readout k="Predicted F3" v={wizard.F3Hz.toFixed(1)} unit="Hz" />
                  <Readout k="Ripple" v={wizard.rippleDb.toFixed(2)} unit="dB" />
                  {wizard.port ? <Readout k="Port" v={wizard.port.shape === 'round' ? `${wizard.port.count}×Ø${wizard.port.diameter} · L${wizard.port.length}` : `slot ${wizard.port.slotWidth}×${wizard.port.slotHeight} · L${wizard.port.length}`} unit="mm" /> : null}
                  {wizard.port ? <Readout k="Port velocity ≈" v={wizard.port.velocity != null ? wizard.port.velocity.toFixed(1) : '—'} unit="m/s" /> : null}
                </div>
                {wizard.port && wizard.port.velocity != null && wizard.port.velocity > 17 ? <div className="warnbox" style={{ marginTop: 6 }}>Port velocity {wizard.port.velocity.toFixed(0)} m/s above 17 — box too small for this driver at rated power; accept the biggest box the search allows.</div> : null}
                <p className="note" style={{ margin: '6px 0 0' }}>{wizard.notes[0]}. Internal dims scaled from the current aspect ratio.</p>
              </div>
            ) : (
              <p className="note" style={{ marginBottom: 0 }}>
                The wizard searches hundreds of volume/tuning combinations <b>against the actual state-space response</b> —
                no lookup tables — then sizes the port to keep air speed under the chuffing threshold at rated power.
              </p>
            )}
          </Section>

          <Section title="Enclosure Type">
            <div className="tabs">
              {(['sealed', 'ported', 'passiveRadiator'] as const).map((t) => (
                <button key={t} className={enc.type === t ? 'active' : ''} onClick={() => patchEnclosure({ type: t })}>
                  {t === 'sealed' ? 'Sealed' : t === 'ported' ? 'Ported' : 'Passive Radiator'}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Box Dimensions">
            <Param label="Internal width" value={enc.internalWidth} min={80} max={1200} unit="mm" onChange={(v) => patchEnclosure({ internalWidth: v })} />
            <Param label="Internal height" value={enc.internalHeight} min={80} max={1400} unit="mm" onChange={(v) => patchEnclosure({ internalHeight: v })} />
            <Param label="Internal depth" value={enc.internalDepth} min={60} max={1000} unit="mm" onChange={(v) => patchEnclosure({ internalDepth: v })} />
            <Param label="Wall thickness" value={enc.wallThickness} min={9} max={40} step={0.5} digits={1} unit="mm" onChange={(v) => patchEnclosure({ wallThickness: v })} />
            <Sel label="Wall material" value={enc.wallMaterialId} options={[{ value: 'mdf', label: 'MDF' }, { value: 'birch-ply', label: 'Birch plywood' }, { value: 'particleboard', label: 'Particle board' }]} onChange={(v) => patchEnclosure({ wallMaterialId: v })} />
            <Param label="Bracing volume" value={enc.bracingVolume} min={0} max={8} step={0.1} digits={1} unit="L" onChange={(v) => patchEnclosure({ bracingVolume: v })} />
            <Sel
              label="Damping fill" value={enc.damping}
              options={[{ value: 'none', label: 'None' }, { value: 'lightFill', label: 'Light fill' }, { value: 'lined', label: 'Lined walls' }, { value: 'heavyFill', label: 'Heavy fill' }]}
              onChange={(v) => patchEnclosure({ damping: v as typeof enc.damping })}
              hint="Fill makes the box behave acoustically larger (isothermal effect)"
            />
            <div className="param"><label>Finish color</label>
              <input type="color" value={enc.finishColor} onChange={(e) => patchEnclosure({ finishColor: e.target.value })} style={{ width: 60, height: 28, border: '1px solid var(--line)', background: 'none', borderRadius: 6 }} />
            </div>
            <Toggle label="Front grille" value={enc.grille.enabled} onChange={(v) => patchEnclosure({ grille: { ...enc.grille, enabled: v } })} hint="Visual only — see-through mesh disc + frame ring" />
            {enc.grille.enabled ? (
              <div className="param"><label>Grille color</label>
                <input type="color" value={enc.grille.color} onChange={(e) => patchEnclosure({ grille: { ...enc.grille, color: e.target.value } })} style={{ width: 60, height: 28, border: '1px solid var(--line)', background: 'none', borderRadius: 6 }} />
              </div>
            ) : null}
          </Section>

          {enc.type === 'ported' ? (
            <Section title="Port">
              <Sel label="Shape" value={enc.port.shape} options={[{ value: 'round', label: 'Round' }, { value: 'slot', label: 'Slot' }]} onChange={(v) => patchPort({ shape: v as typeof enc.port.shape })} />
              {enc.port.shape === 'round' ? (
                <>
                  <Param label="Port diameter" value={enc.port.diameter} min={20} max={250} unit="mm" onChange={(v) => patchPort({ diameter: v })} />
                  <Param label="Flared ends" value={enc.port.flared ? 1 : 0} min={0} max={1} step={1} digits={0} unit="" onChange={(v) => patchPort({ flared: v > 0.5 })} />
                </>
              ) : (
                <>
                  <Param label="Slot width" value={enc.port.slotWidth} min={20} max={400} unit="mm" onChange={(v) => patchPort({ slotWidth: v })} />
                  <Param label="Slot height" value={enc.port.slotHeight} min={20} max={500} unit="mm" onChange={(v) => patchPort({ slotHeight: v })} />
                </>
              )}
              <Param label="Port length" value={enc.port.length} min={20} max={800} unit="mm" onChange={(v) => patchPort({ length: v })} />
              <Param label="Number of ports" value={enc.port.count} min={1} max={4} step={1} digits={0} onChange={(v) => patchPort({ count: Math.round(v) })} />
              {portSpeed != null ? (
                <div className={`row${portSpeed > 27 ? ' flash' : ''}`} style={{ marginTop: 4 }}>
                  <Badge kind={portSpeed > 27 ? 'warn' : portSpeed > 17 ? 'warn' : 'ok'}>
                    AIR SPEED ≈ {portSpeed.toFixed(1)} m/s {portSpeed > 27 ? '— CHUFFING RISK' : portSpeed > 17 ? '— audible noise possible' : '— OK'}
                  </Badge>
                </div>
              ) : null}
            </Section>
          ) : null}

          {enc.type === 'passiveRadiator' ? (
            <Section title="Passive Radiator">
              <Param label="Enabled" value={enc.passive.enabled ? 1 : 0} min={0} max={1} step={1} digits={0} unit="" onChange={(v) => patchPassive({ enabled: v > 0.5 })} />
              <Param label="Effective Ø" value={enc.passive.diameter} min={60} max={450} unit="mm" onChange={(v) => patchPassive({ diameter: v })} />
              <Param label="Moving mass" value={enc.passive.mass} min={20} max={2000} step={5} digits={0} unit="g" badge="user" onChange={(v) => patchPassive({ mass: v })} />
              <Param label="Suspension stiffness" value={enc.passive.suspensionStiffness} min={0} max={3000} step={10} digits={0} unit="N/m" onChange={(v) => patchPassive({ suspensionStiffness: v })} />
              <Param label="Damping" value={enc.passive.damping} min={0.05} max={6} step={0.05} digits={2} unit="N·s/m" onChange={(v) => patchPassive({ damping: v })} />
            </Section>
          ) : null}

          <Section title="Drivers & Wiring">
            <Param label="Identical drivers" value={enc.driverCount} min={1} max={4} step={1} digits={0} onChange={(v) => patchEnclosure({ driverCount: Math.round(v) })} />
            <Sel label="Driver wiring" value={enc.wiring} options={[{ value: 'parallel', label: 'Parallel (+SPL)' }, { value: 'series', label: 'Series (same SPL)' }]} onChange={(v) => patchEnclosure({ wiring: v as typeof enc.wiring })} />
            <Sel label="Voice coils" value={enc.coilWiring} options={[{ value: 'parallel', label: 'Single / coils parallel' }, { value: 'series', label: 'Coils in series' }]} onChange={(v) => patchEnclosure({ coilWiring: v as typeof enc.coilWiring })} />
            <WiringDiagram n={wiring.n} series={wiring.series} load={amp.nominalLoad} />
          </Section>
        </div>

        <div className="main-area">
          <div className="row" style={{ alignItems: 'stretch', flex: 1, minHeight: 320 }}>
            <div className="flex1" style={{ display: 'flex', flexDirection: 'column' }}>
              <Viewport3D
                showEnclosure wallOpacity={wallOpacity} section={section}
                hudExtras={<span>Cutaway — drag to orbit</span>}
              />
              <div className="card" style={{ marginTop: 10 }}>
                <Param label="Wall transparency" value={1 - wallOpacity} min={0} max={0.95} step={0.01} digits={2} unit="" onChange={(v) => setWallOpacity(1 - v)} />
                <Param label="Section angle" value={section} min={0} max={180} step={1} digits={0} unit="°" onChange={setSection} />
              </div>
            </div>
            <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
              <Section title="Computed">
                <div className="readout-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Readout k="Gross volume" v={res?.VbGross.toFixed(1) ?? '—'} unit="L" />
                  <Readout k="Net volume" v={res?.VbNet.toFixed(1) ?? '—'} unit="L" />
                  <Readout k="Driver displacement" v={drvL.toFixed(2)} unit="L" badge={<Badge kind="est">EST</Badge>} />
                  <Readout k="Effective volume" v={res?.VbEff.toFixed(1) ?? '—'} unit="L" />
                  {enc.type === 'sealed' ? (
                    <>
                      <Readout k="Fc (system)" v={((ts.Fs * Math.sqrt(1 + ts.Vas / (res?.VbEff ?? ts.Vas)))).toFixed(1)} unit="Hz" acc />
                      <Readout k="Qtc" v={(ts.Qts * Math.sqrt(1 + ts.Vas / (res?.VbEff ?? ts.Vas))).toFixed(2)} acc />
                    </>
                  ) : (
                    <Readout k="Tuning Fb" v={res?.Fb?.toFixed(1) ?? '—'} unit="Hz" acc />
                  )}
                  {enc.type === 'ported' ? (
                    <>
                      <Readout k="Port area" v={((res?.portArea ?? 0) * 1e4).toFixed(1)} unit="cm²" />
                      <Readout k="L_eff (end corr.)" v={((res?.portLengthEff ?? 0) * 1000).toFixed(0)} unit="mm" badge={<Badge kind="est">EST</Badge>} />
                      <Readout k="Port air mass" v={((res?.portMass ?? 0) * 1000).toFixed(1)} unit="g" />
                      <Readout k="Port volume" v={res?.portVolumeL.toFixed(2) ?? '—'} unit="L" />
                    </>
                  ) : null}
                </div>
                {res?.warnings.map((w, i) => <div key={i} className="warnbox" style={{ marginTop: 8 }}>{w}</div>)}
                <p className="note" style={{ marginBottom: 0 }}>
                  End correction: flared ≈ 0.85·r per end, plain ≈ 0.73·r. Fill factor converts to an effective
                  (acoustically larger) volume.
                </p>
              </Section>
              <Section title="F3 estimate">
                <Readout k="−3 dB point (current design)" v={f3Of(curves.current.splDb, curves.f)?.toFixed(1) ?? '—'} unit="Hz" acc />
              </Section>
            </div>
          </div>

          <Section title="System Response Comparison (same driver, 2.83 V)">
            <Plot
              height={210} xLog yLabel="dB SPL"
              series={[
                { name: `Current (${enc.type})`, color: colorFor[enc.type], points: curves.f.map((f, i) => [f, curves.current.splDb[i]] as [number, number]), width: 2.2 },
                { name: 'Sealed', color: colorFor.sealed, points: curves.f.map((f, i) => [f, curves.sealed.splDb[i]] as [number, number]), dash: [5, 4] },
                { name: 'Ported', color: colorFor.ported, points: curves.f.map((f, i) => [f, curves.ported.splDb[i]] as [number, number]), dash: [5, 4] },
                { name: 'Passive radiator', color: colorFor.passiveRadiator, points: curves.f.map((f, i) => [f, curves.pr.splDb[i]] as [number, number]), dash: [5, 4] },
              ]}
              cursorFreq={cursor} onCursor={setCursor}
              csvName="enclosure-comparison"
            />
            <p className="note">Sealed rolls off at −12 dB/oct below Fc; ported/PR extend low-end but unload the driver below Fb (excursion rises — check the excursion plot in Frequency Lab).</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function f3Of(db: number[], f: number[]): number | null {
  if (db.length === 0) return null;
  // reference: level at 200 Hz (passband for sub/bass designs)
  let refIdx = 0;
  for (let i = 0; i < f.length; i++) if (f[i] <= 200) refIdx = i;
  const ref = db[refIdx];
  // walk DOWN from 200 Hz; F3 = the last frequency still above (ref − 3 dB)
  for (let i = refIdx; i > 0; i--) {
    if (db[i] >= ref - 3) return f[i];
  }
  return f[0];
}

function WiringDiagram(props: { n: number; series: boolean; load: number }) {
  const { n, series, load } = props;
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    cells.push(
      <svg key={i} width="44" height="56" viewBox="0 0 44 56">
        <circle cx="22" cy="28" r="15" fill="none" stroke="#6d7480" strokeWidth="2" />
        <circle cx="22" cy="28" r="7" fill="none" stroke="#ff7a1a" strokeWidth="2" />
        <line x1="22" y1="13" x2="22" y2="0" stroke="#6d7480" strokeWidth="2" />
        <line x1="22" y1="43" x2="22" y2="56" stroke="#6d7480" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div className="note" style={{ marginBottom: 4 }}>Wiring diagram — {n} driver{n > 1 ? 's' : ''} {series ? 'in series' : 'in parallel'}</div>
      <div className="row" style={{ alignItems: 'center', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
        <span className="mono dim" style={{ fontSize: 16 }}>AMP</span>
        <span className="mono acc-txt">→</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>{cells}</div>
        <span className="mono acc-txt">→</span>
        <span className="mono dim">load {load.toFixed(1)}Ω</span>
      </div>
      <div className="note" style={{ marginTop: 4 }}>
        {n > 1 && !series ? 'Parallel: each driver sees full voltage → SPL +20·log₁₀(n) vs single.' : ''}
        {n > 1 && series ? 'Series: each driver sees u/n → total SPL equals a single driver (voltage drive).' : ''}
      </div>
    </div>
  );
}

void computeAmp; void C_SOUND; void RHO0; void _V;
