/* 3D Simulator — live physical cone motion, free-angle orbit, exploded/section, excursion HUD.
   Side panel reorganised into four tabs: Drive · View · Motion · Stats. */
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { Viewport3D, physicalDispMm } from '../components/Viewport3D';
import { Section, Btn, Param, Sel, Badge, XBar } from '../components/ui';
import { useExcursionStats } from '../components/useExcursionStats';
import { engine } from '../audio/engine';

type TabId = 'drive' | 'view' | 'motion' | 'stats';
const TABS: { id: TabId; label: string }[] = [
  { id: 'drive', label: 'Drive' },
  { id: 'view', label: 'View' },
  { id: 'motion', label: 'Motion' },
  { id: 'stats', label: 'Stats' },
];

export function Simulator3D() {
  const ts = useApp((s) => s.derived.ts);
  const snapshot = useApp((s) => s.snapshot);
  const audio = useApp((s) => s.audio);
  const patchAudio = useApp((s) => s.patchAudio);
  const sim = useApp((s) => s.sim);
  const patchSim = useApp((s) => s.patchSim);
  const amplifier = useApp((s) => s.amplifier);
  const patchAmplifier = useApp((s) => s.patchAmplifier);
  const amp = useApp((s) => s.derived.amp);
  const [tab, setTab] = useState<TabId>('drive');
  const [recenterN, setRecenterN] = useState(0);
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
  const driver = useApp((s) => s.driver);
  const xmaxDrive = useApp((s) => s.derived.xmaxDriveW);
  const driveActive = live.mm !== 0;

  return (
    <div className="ws no-scroll" style={{ height: '100%' }}>
      <div className="split" style={{ flex: 1 }}>
        <div className="side">
          <div className="side-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'drive' ? (
            <>
              <Section title="Drive (amplifier)">
                <p className="note" style={{ marginTop: 0 }}>
                  Applies to <b>music playback AND test tones</b>. Drive defaults to the burst level
                  that reaches <b>Xmax at 40 Hz</b> through the real model — the excursion this driver
                  was built for. That level is typically far beyond the continuous rating (back-EMF),
                  which is exactly how bench excursion demos work: short bursts, not sustained power.
                </p>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <Btn small onClick={() => patchAmplifier({ driveMode: 'voltage', voltageRms: 2.83 })}>2.83 V ref</Btn>
                  <Btn small onClick={() => patchAmplifier({ driveMode: 'power', powerW: xmaxDrive, clipEnabled: false, currentLimitA: 0 })} title="Burst level that brings a −3 dB 40 Hz tone to one-way Xmax through the real model">Match Xmax (burst)</Btn>
                  <Btn small onClick={() => patchAmplifier({ driveMode: 'power', powerW: Math.max(1, Math.round(driver.powerHandlingW / 2)) })}>½ rated</Btn>
                  <Btn small onClick={() => patchAmplifier({ driveMode: 'power', powerW: driver.powerHandlingW })}>Rated {driver.powerHandlingW} W</Btn>
                </div>
                {amplifier.driveMode === 'voltage' ? (
                  <Param
                    label="Drive voltage" value={amplifier.voltageRms} min={0.1} max={100000} step={0.1} digits={1} unit="Vrms" badge="user"
                    onChange={(v) => patchAmplifier({ driveMode: 'voltage', voltageRms: v })}
                  />
                ) : (
                  <Param
                    label="Drive power" value={amplifier.powerW} min={0.5} max={100000000} step={1} digits={0} unit="W" badge="user"
                    onChange={(v) => patchAmplifier({ driveMode: 'power', powerW: v })}
                  />
                )}
                <div className="note mono">
                  → {amp.vpeak.toFixed(1)} V peak (±) · {amp.estimatedPowerW.toFixed(0)} W RMS into {amp.nominalImpedanceLabel}
                  {driveActive ? '' : ' · idle — play a tone or file'}
                </div>
                <p className="note">
                  The cone motion comes from the electro-mechanical model driven sample-by-sample by the actual
                  signal — never a canned animation. At 2.83 V (lab reference) a high-Bl subwoofer moves only a
                  fraction of a millimetre — that is real physics, not a bug. Cone travel is always clamped at
                  the geometric mechanical limit, so the view can never over-travel.
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
                <div className="row" style={{ marginTop: 8 }}>
                  <Btn small ghost onClick={() => { engine.setPlaybackRate(0.15); patchSim({ speed: 0.15 }); }}>Slow-mo 0.15×</Btn>
                  <Btn small ghost onClick={() => { engine.setPlaybackRate(1); patchSim({ speed: 1 }); }}>Real-time 1×</Btn>
                </div>
                <Param label="Slow motion" value={sim.speed} min={0.05} max={1} step={0.05} digits={2} unit="×" onChange={(v) => { patchSim({ speed: v }); engine.setPlaybackRate(v); }} hint="Slows file playback rate (pitch shifts) — true slow motion" />
                <div className="note mono">tone −3 dBFS → ±{(amp.vpeak * 0.708).toFixed(1)} V at the coil</div>
              </Section>
            </>
          ) : null}

          {tab === 'view' ? (
            <>
              <Section title="Camera — free angle">
                <p className="note" style={{ marginTop: 0 }}>
                  <b>Drag</b> to orbit to any angle · <b>Scroll / pinch</b> to zoom · <b>Right-drag / two-finger</b> to pan.
                  The view is fully free — no fixed presets.
                </p>
                <div className="row">
                  <Btn small onClick={() => setRecenterN((n) => n + 1)}>Recenter</Btn>
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
            </>
          ) : null}

          {tab === 'motion' ? (
            <>
              <Section title="Cone Flex & Rock">
                <p className="note" style={{ marginTop: 0 }}>
                  The diaphragm is a flexible body, not a piston. At deep excursion it <b>rocks</b> — one side
                  of the cone and surround leads the stroke while the other lags, and the leading side keeps
                  drifting around the rim. While music plays, breakup waves crawl across the cone and the
                  surround rolls with them; near the travel limit the rubber buckles into wrinkles. All of it
                  is driven by the real displacement signal, and it dies to rest with the music.
                </p>
                <Param
                  label="Flex & rock gain" value={sim.flexGain} min={0} max={2} step={0.05} digits={2} unit="×" badge="user"
                  onChange={(v) => patchSim({ flexGain: v })}
                  hint="Scales the cone/surround flex, breakup waves and rocking mode. 1× = physical estimate, 0 = pure rigid piston."
                />
                <Param label="Display smoothing" value={sim.vizSmoothing} min={0} max={0.9} step={0.05} digits={2} unit="" onChange={(v) => patchSim({ vizSmoothing: v })} hint="Smooths the RENDERED motion only — measured values stay unfiltered" />
              </Section>

              <Section title="Solver">
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
                <p className="note">The linear model is solved by exact ZOH discretization at the hardware sample rate — stable for any parameter combination. Quality only affects nonlinear substep depth.</p>
              </Section>
            </>
          ) : null}

          {tab === 'stats' ? (
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
              <div className="stat-rows">
                <div className="stat-row"><span>Surround roll height</span><b>{driver.surround.rollHeight.toFixed(0)} mm</b></div>
                <div className="stat-row"><span>Roll capability (one-way)</span><b>≈ {(driver.surround.rollHeight * 1.25).toFixed(0)} mm</b></div>
                <div className="stat-row"><span>Mechanical limit ±Xmech</span><b>{ts.Xmech.toFixed(1)} mm</b></div>
              </div>
            </Section>
          ) : null}
        </div>

        <div className="main-area">
          <Viewport3D
            showEnclosure={false}
            viewRequest={{ v: 'recenter', n: recenterN }}
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
