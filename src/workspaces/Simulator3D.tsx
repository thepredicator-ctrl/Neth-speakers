/* 3D Simulator — live physical cone motion, views, exploded/section, excursion HUD. */
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { Viewport3D, physicalDispMm, type ViewName } from '../components/Viewport3D';
import { Section, Btn, Param, Sel, Badge, XBar } from '../components/ui';
import { useExcursionStats } from '../components/useExcursionStats';
import { engine } from '../audio/engine';

export function Simulator3D() {
  const ts = useApp((s) => s.derived.ts);
  const snapshot = useApp((s) => s.snapshot);
  const audio = useApp((s) => s.audio);
  const patchAudio = useApp((s) => s.patchAudio);
  const sim = useApp((s) => s.sim);
  const patchSim = useApp((s) => s.patchSim);
  const [view, setView] = useState<ViewName>('persp');
  const [viewN, setViewN] = useState(0);
  const [exploded, setExploded] = useState(0);
  const [section, setSection] = useState<number | null>(null);
  const [quality, setQuality] = useState<'low' | 'med' | 'high'>('med');
  const [live, setLive] = useState({ mm: 0, limit: false, fps: 0 });
  const { stats: exc, reset: resetExc } = useExcursionStats();
  const rafRef = useRef(0);

  // HUD refresh at ~30fps (React state), while the 3D itself runs at 60fps
  useEffect(() => {
    const tick = () => {
      setLive({ mm: physicalDispMm(), limit: useApp.getState().snapshot.limit, fps: 0 });
      rafRef.current = requestAnimationFrame(throttle30);
    };
    let last = 0;
    const throttle30 = (t: number) => {
      if (t - last < 33) { rafRef.current = requestAnimationFrame(throttle30); return; }
      last = t;
      tick();
    };
    rafRef.current = requestAnimationFrame(throttle30);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const overLimit = Math.abs(live.mm) > ts.Xmax;
  const overMech = Math.abs(live.mm) > ts.Xmech * 0.98;

  return (
    <div className="ws no-scroll" style={{ height: '100%' }}>
      <div className="split" style={{ flex: 1 }}>
        <div className="side">
          <Section title="Camera">
            <div className="row">
              {(['persp', 'front', 'side', 'rear'] as ViewName[]).map((v) => (
                <Btn key={v} small active={view === v} onClick={() => { setView(v); setViewN((n) => n + 1); }}>
                  {v === 'persp' ? 'Perspective' : v === 'front' ? 'Front' : v === 'side' ? 'Side' : 'Rear'}
                </Btn>
              ))}
            </div>
          </Section>

          <Section title="Visualization">
            <Param label="Exploded view" value={exploded} min={0} max={1} step={0.01} digits={2} onChange={setExploded} />
            <Param label="Section angle" value={section ?? 0} min={0} max={180} step={1} digits={0} unit="°" onChange={(v) => setSection(v > 0 ? v : null)} hint="Cross-section clip plane; 0 = off" />
            <Sel label="Quality" value={quality} options={[{ value: 'low', label: 'Low (mobile)' }, { value: 'med', label: 'Medium' }, { value: 'high', label: 'High' }]} onChange={(v) => setQuality(v as typeof quality)} />
            <Sel
              label="Display mode" value={audio.vizMode}
              options={[{ value: 'physical', label: 'Physical (true mm)' }, { value: 'enhanced', label: 'Enhanced (multiplied)' }]}
              onChange={(v) => patchAudio({ vizMode: v as typeof audio.vizMode })}
              hint="Enhanced multiplies the DISPLAYED motion only — the true value is always shown in the HUD"
            />
            {audio.vizMode === 'enhanced' ? (
              <Param label="Visualization ×" value={audio.vizMultiplier} min={1} max={60} step={1} digits={0} unit="×" badge="user" onChange={(v) => patchAudio({ vizMultiplier: v })} />
            ) : null}
          </Section>

          <Section title="Simulation Settings">
            <Sel
              label="Solver quality" value={sim.quality}
              options={[{ value: 'precision', label: 'Precision (8 substeps)' }, { value: 'balanced', label: 'Balanced (4)' }, { value: 'fast', label: 'Fast (2)' }]}
              onChange={(v) => patchSim({ quality: v as typeof sim.quality })}
              hint="Substeps per audio sample in the real-time model. Precision is the default — the linear ZOH core is exact and unconditionally stable at any setting."
            />
            <Sel
              label="Model mode" value={sim.mode}
              options={[{ value: 'idealized', label: 'Idealized' }, { value: 'thieleSmall', label: 'Thiele-Small' }, { value: 'dynamic', label: 'Dynamic (recommended)' }, { value: 'advanced', label: 'Advanced (nonlinear)' }]}
              onChange={(v) => patchSim({ mode: v as typeof sim.mode })}
            />
            <Param label="Display smoothing" value={sim.vizSmoothing} min={0} max={0.9} step={0.05} digits={2} unit="" onChange={(v) => patchSim({ vizSmoothing: v })} hint="Smooths the RENDERED motion only — measured values stay unfiltered" />
            <p className="note">The linear model is solved by exact ZOH discretization at the hardware sample rate — stable for any parameter combination. Quality only affects nonlinear substep depth.</p>
          </Section>

          <Section title="Excursion Statistics (from the model)">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <Badge kind="est">PEAK (session) {exc.peak.toFixed(2)} mm</Badge>
              <Badge kind="est">TRAVEL p-p {exc.p2p.toFixed(2)} mm</Badge>
              <Badge kind={exc.max >= 0 ? 'ok' : 'est'}>max +{exc.max.toFixed(2)}</Badge>
              <Badge kind={exc.min <= 0 ? 'ok' : 'est'}>min {exc.min.toFixed(2)} mm</Badge>
              <Btn small ghost onClick={resetExc}>Reset stats</Btn>
            </div>
            <p className="note">
              Xmax {ts.Xmax.toFixed(1)} mm and Xmax p-p {ts.XmaxPP.toFixed(1)} mm are the LINEAR limits
              (one-way / peak-to-peak); Vd = Sd·Xmax = {(ts.Vd * 1e6).toFixed(0)} cm³. Peak and travel above are
              measured from the simulated displacement itself — never from an animation value.
            </p>
          </Section>

          <Section title="Test Signal">
            <div className="row">
              {[20, 40, 60, 120].map((f) => (
                <Btn key={f} small onClick={() => { void engine.ensure().then(() => engine.startTone(f, -3)); patchSim({ running: true, paused: false }); }}>
                  {f} Hz
                </Btn>
              ))}
              <Btn small onClick={() => engine.stopTone()}>Stop</Btn>
            </div>
            <p className="note">
              The cone motion comes from the electro-mechanical model driven sample-by-sample by the actual signal —
              never a canned animation.
            </p>
          </Section>

          <Section title="Playback Speed">
            <Param label="Slow motion" value={sim.speed} min={0.05} max={1} step={0.05} digits={2} unit="×" onChange={(v) => { patchSim({ speed: v }); engine.setPlaybackRate(v); }} hint="Slows file playback rate (pitch shifts) — true slow motion" />
            <div className="row">
              <Btn small onClick={() => { engine.setPlaybackRate(1); patchSim({ speed: 1 }); }}>Reset 1×</Btn>
            </div>
          </Section>
        </div>

        <div className="main-area">
          <Viewport3D
            showEnclosure={false}
            viewRequest={{ v: view, n: viewN }}
            exploded={exploded}
            section={section}
            quality={quality}
            overlay={
              <>
                <Badge kind={overMech ? 'warn' : overLimit ? 'warn' : 'ok'}>{overMech ? 'MECHANICAL LIMIT' : overLimit ? 'BEYOND Xmax' : 'WITHIN Xmax'}</Badge>
                <Badge kind="est">DISPLAY {audio.vizMode === 'enhanced' ? `×${audio.vizMultiplier}` : '×1 (physical)'}</Badge>
              </>
            }
            hudExtras={
              <>
                <span style={{ minWidth: 150 }}>x = {live.mm >= 0 ? '+' : ''}{live.mm.toFixed(3)} mm</span>
                <div className="flex1" style={{ maxWidth: 420 }}>
                  <XBar xMm={live.mm} xmax={ts.Xmax} xmech={ts.Xmech} />
                </div>
                <span className={overMech ? 'flash acc-txt' : ''}>±Xmax {ts.Xmax.toFixed(1)} · ±Xmech {ts.Xmech.toFixed(1)} mm</span>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
