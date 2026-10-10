/* Speaker Lab — design overview, key Thiele–Small readouts, quick edits. */
import React, { useMemo, useState } from 'react';
import { useApp } from '../store';
import { Section, Btn, Readout, Badge, Param, Sel } from '../components/ui';
import { Plot } from '../components/Plot';
import { Viewport3D } from '../components/Viewport3D';
import { PRESETS } from '../physics/defaults';
import { responseOverGrid, impedanceCurve } from '../physics/freqresp';
import { logspace } from '../physics/units';

export function SpeakerLab() {
  const driver = useApp((s) => s.driver);
  const ts = useApp((s) => s.derived.ts);
  const amp = useApp((s) => s.derived.amp);
  const applyPresetId = useApp((s) => s.applyPresetId);
  const patchCone = useApp((s) => s.patchCone);
  const patchCoil = useApp((s) => s.patchCoil);
  const patchMagnet = useApp((s) => s.patchMagnet);
  const patchDriver = useApp((s) => s.patchDriver);
  const [cursor, setCursor] = useState<number | null>(null);
  const [showCurves, setShowCurves] = useState(true);

  const curves = useMemo(() => {
    const f = logspace(12, 24000, 240);
    const sys = useApp.getState().derived.sys;
    if (!sys) return null;
    // SPL row (far-field piston @1m) driven at 2.83 V — cp has units Pa/V
    const spl = responseOverGrid(sys.A, sys.B, sys.cp, f);
    const vRef = 2.83;
    const splDb = spl.mag.map((m) => 20 * Math.log10(Math.max(m * vRef * sys.splScale, 1e-12) / 2e-5));
    const imp = impedanceCurve(ts, f, null, null, 0);
    const exc = responseOverGrid(sys.A, sys.B, sys.cx, f);
    return {
      f,
      splDb,
      imp: imp.mag,
      excMm: exc.mag.map((m) => m * vRef * 1000),
    };
  }, [ts, driver, amp]);

  return (
    <div className="ws">
      <div className="split">
        <div className="side">
          <Section title="Demo Drivers & Presets">
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              {PRESETS.map((p) => (
                <Btn key={p.id} onClick={() => applyPresetId(p.id)} title={p.blurb}>
                  {p.name}
                </Btn>
              ))}
            </div>
            <p className="note" style={{ marginBottom: 0 }}>
              Presets load complete example designs. Edit anything below or in the Parts Editor — every value feeds
              the physics engine live.
            </p>
          </Section>

          <Section title="Quick Dimensions">
            <Param label="Cone outer Ø" value={driver.cone.outerDiameter} min={20} max={800} unit="mm" digits={1} onChange={(v) => patchCone({ outerDiameter: v })} hint="Cone body at the surround seat. Sd follows automatically: piston extends to half the surround roll." />
            <Param label="Cone depth" value={driver.cone.depth} min={2} max={120} unit="mm" digits={1} onChange={(v) => patchCone({ depth: v })} />
            <Param label="Winding Ø" value={driver.coil.windingDiameter} min={8} max={200} unit="mm" digits={1} onChange={(v) => patchCoil({ windingDiameter: v })} />
            <Param label="Gap height" value={driver.magnet.topPlateThickness} min={1} max={30} unit="mm" digits={1} onChange={(v) => patchMagnet({ topPlateThickness: v })} />
            <Param label="Wire Ø" value={driver.coil.wireDiameter} min={0.1} max={1.2} unit="mm" digits={2} onChange={(v) => patchCoil({ wireDiameter: v })} />
            <Param label="Power handling" value={driver.powerHandlingW} min={1} max={5000} step={5} digits={0} unit="W (cont.)" badge="user" onChange={(v) => patchDriver({ powerHandlingW: v })} hint="Continuous thermal rating — used by the Max SPL thermal limit and the Dashboard thermal gauge" />
          </Section>

          <Section title="Status">
            <div className="row" style={{ gap: 6 }}>
              <Badge kind="est" title="Values derived from geometry via documented approximations — see docs/PHYSICS.md">Estimates labeled EST</Badge>
              <Badge kind="user" title="User-entered overrides">Overrides labeled USER</Badge>
            </div>
            <p className="note">
              Free-air analysis here. Enclosure response lives in the Enclosure Designer; the same state-space model
              drives both.
            </p>
          </Section>
        </div>

        <div className="main-area">
          <Section
            title="Thiele–Small Parameters (free air)"
            right={<Btn small ghost active={showCurves} onClick={() => setShowCurves(!showCurves)}>{showCurves ? 'Hide curves' : 'Show curves'}</Btn>}
          >
            <div className="readout-grid">
              <Readout k="Fs" v={ts.Fs.toFixed(1)} unit="Hz" badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Qms" v={ts.Qms.toFixed(2)} badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Qes" v={ts.Qes.toFixed(2)} badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Qts" v={ts.Qts.toFixed(3)} acc />
              <Readout k="Vas" v={ts.Vas.toFixed(1)} unit="L" badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Re" v={ts.Re.toFixed(2)} unit="Ω" badge={driver.coil.re != null ? <Badge kind="user">USER</Badge> : <Badge kind="est">EST</Badge>} />
              <Readout k="Le" v={(ts.Le * 1000).toFixed(2)} unit="mH" badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Bl" v={ts.Bl.toFixed(2)} unit="T·m" badge={driver.magnet.bl != null ? <Badge kind="user">USER</Badge> : <Badge kind="est">EST</Badge>} />
              <Readout k="B in gap" v={ts.Bgap.toFixed(2)} unit="T" badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Sd" v={(ts.Sd * 1e4).toFixed(1)} unit="cm²" />
              <Readout k="Effective Ø" v={`${(ts.Sd > 0 ? 2 * Math.sqrt(ts.Sd / Math.PI) * 1e3 : 0).toFixed(1)}`} unit="mm (auto)" />
              <Readout k="Vd = Sd·Xmax" v={(ts.Vd * 1e6).toFixed(0)} unit="cm³ one-way" acc />
              <Readout k="Xmax" v={ts.Xmax.toFixed(1)} unit="mm one-way" acc />
              <Readout k="Xmax p-p" v={ts.XmaxPP.toFixed(1)} unit="mm peak-to-peak" />
              <Readout k="Xmech" v={ts.Xmech.toFixed(1)} unit="mm one-way" />
              <Readout k="Excursion envelope" v={`−${ts.maxExcDown.toFixed(1)} / +${ts.maxExcUp.toFixed(1)}`} unit="mm (geometry)" />
              <Readout k="Winding / gap" v={`${ts.windH.toFixed(1)} / ${ts.gapH.toFixed(1)}`} unit="mm height" />
              <Readout k="Coil overhang" v={ts.coilOverhang.toFixed(2)} unit={`mm (${driver.coil.config})`} />
              <Readout k="Mms" v={(ts.Mms * 1000).toFixed(1)} unit="g" badge={driver.cone.mass != null || driver.coil.mass != null ? <Badge kind="user">USER</Badge> : <Badge kind="est">EST</Badge>} />
              <Readout k="Cms" v={(ts.Cms * 1000).toFixed(3)} unit="mm/N" />
              <Readout k="Rms" v={ts.Rms.toFixed(2)} unit="N·s/m" />
              <Readout k="η₀" v={(ts.eta0 * 100).toFixed(2)} unit="%" badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Sensitivity" v={ts.sens.toFixed(1)} unit="dB@1W/1m" acc />
              <Readout k="Power handling" v={driver.powerHandlingW.toFixed(0)} unit="W continuous" />
              <Readout k="Wire length" v={ts.wireLength.toFixed(1)} unit="m" badge={<Badge kind="est">EST</Badge>} />
              <Readout k="Turns" v={`${ts.turnsTotal}`} unit={`(${ts.turnsInGap} in gap)`} />
              <Readout k="Load / power" v={`${amp.nominalLoad.toFixed(1)}Ω · ${amp.estimatedPowerW.toFixed(1)}W`} />
            </div>
          </Section>

          {showCurves && curves ? (
            <div className="grid2">
              <Section title="Predicted SPL — 2.83 V, half-space piston @1m">
                <Plot
                  height={200} xLog yLabel="dB"
                  series={[{ name: 'SPL (rel)', color: '#35c8dc', points: curves.f.map((f, i) => [f, curves.splDb[i]] as [number, number]) }]}
                  cursorFreq={cursor} onCursor={setCursor}
                />
                <p className="note">
                  Far-field piston estimate (infinite baffle, on-axis, no baffle-step or breakup) — an engineering
                  prediction, not a microphone measurement. Absolute level anchored to the η₀ sensitivity formula.
                </p>
              </Section>
              <Section title="Impedance & Excursion — free air">
                <Plot
                  height={200} xLog yLabel="|Z| (Ω)"
                  series={[
                    { name: '|Z|', color: '#9b7bff', points: curves.f.map((f, i) => [f, curves.imp[i]] as [number, number]) },
                    { name: 'X @2.83V (mm)', color: '#ff7a1a', points: curves.f.map((f, i) => [f, curves.excMm[i]] as [number, number]), axis: 'right' },
                  ]}
                  refLines={[{ y: ts.Xmax, color: 'rgba(255,77,77,0.7)', label: '±Xmax' }]}
                  cursorFreq={cursor} onCursor={setCursor}
                />
                <p className="note">Impedance peak = free-air resonance. Orange curve: one-way cone excursion at 2.83 V RMS.</p>
              </Section>
            </div>
          ) : null}

          <Section title="Live 3D Preview" right={<span className="note">displacement follows the audio engine</span>}>
            <Viewport3D compact showEnclosure={false} hudExtras={<span>Drag to orbit · scroll to zoom</span>} />
          </Section>
        </div>
      </div>
    </div>
  );
}
