/* Frequency Lab — generator, sweeps, response curves, per-frequency readouts. */
import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { Section, Btn, Param, Sel, Badge } from '../components/ui';
import { Plot } from '../components/Plot';
import { engine } from '../audio/engine';
import { responseOverGrid, impedanceCurve, runDiscrete, steadyStateMag } from '../physics/freqresp';
import { logspace, RHO0 } from '../physics/units';
import { sineBlock, logSweep, linSweep, noise, toneBurst, FS_DEFAULT } from '../physics/dsp';

type GenMode = 'sine' | 'sweepLog' | 'sweepLin' | 'stepped' | 'multitone' | 'pinkNoise' | 'whiteNoise' | 'burst' | 'impulse';

export function FrequencyLab() {
  const ts = useApp((s) => s.derived.ts);
  const amp = useApp((s) => s.derived.amp);
  const sys = useApp((s) => s.derived.sys);
  const enclosure = useApp((s) => s.enclosure);
  const amplifier = useApp((s) => s.amplifier);

  const [mode, setMode] = useState<GenMode>('sine');
  const [freq, setFreq] = useState(50);
  const [f0, setF0] = useState(20);
  const [f1, setF1] = useState(2000);
  const [duration, setDuration] = useState(6);
  const [amplitude, setAmplitude] = useState(-12);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [verifyDots, setVerifyDots] = useState<[number, number][] | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const oscRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);

  const vRef = amp.vpeak / Math.SQRT2; // RMS terminal volts per driver

  /* ------- analytical curves (exact for the linear model) ------- */
  const curves = useMemo(() => {
    if (!sys) return null;
    const f = logspace(10, 24000, 300);
    const spl = responseOverGrid(sys.A, sys.B, sys.cp, f);
    const exc = responseOverGrid(sys.A, sys.B, sys.cx, f);
    const vel = responseOverGrid(sys.A, sys.B, sys.cv, f);
    const cur = responseOverGrid(sys.A, sys.B, sys.ci, f);
    const imp = impedanceCurve(ts, f, enclosure, useApp.getState().derived.encLitres, amplifier.outputImpedance);
    const splDb = spl.mag.map((m) => 20 * Math.log10(Math.max(m * vRef * sys.splScale, 1e-12) / 2e-5));
    return {
      f,
      splDb,
      excMm: exc.mag.map((m) => m * vRef * 1000),
      velMmS: vel.mag.map((m) => m * vRef * 1000),
      curA: cur.mag.map((m) => m * vRef),
      impMag: imp.mag,
      impPhase: imp.phase,
      powerW: imp.mag.map((m, i) => Math.pow((vRef / m), 2) * (imp.re[i] - amplifier.outputImpedance)),
    };
  }, [ts, sys, enclosure, amplifier.outputImpedance, vRef]);

  /* ------- generator ------- */
  const stopGen = () => {
    if (oscRef.current) {
      try { oscRef.current.osc.stop(); } catch { /* */ }
      oscRef.current = null;
    }
    engine.stopTone();
    setPlaying(false);
  };

  const startGen = async () => {
    setGenErr(null);
    try {
      await engine.ensure();
      stopGen();
      const ampLin = Math.pow(10, amplitude / 20);
      const ctx = engine.ctx!;
      if (mode === 'sine') {
        await engine.startTone(freq, amplitude);
        setPlaying(true);
        return;
      }
      // buffer-based sources
      const sr = ctx.sampleRate;
      let buf: AudioBuffer;
      const mk = (samples: Float32Array | Float64Array) => {
        const b = ctx.createBuffer(1, samples.length, sr);
        const d = b.getChannelData(0);
        for (let i = 0; i < samples.length; i++) d[i] = samples[i];
        return b;
      };
      if (mode === 'sweepLog') buf = mk(logSweep(f0, f1, ampLin, duration, sr));
      else if (mode === 'sweepLin') buf = mk(linSweep(f0, f1, ampLin, duration, sr));
      else if (mode === 'pinkNoise') buf = mk(noise(ampLin, duration, sr, true));
      else if (mode === 'whiteNoise') buf = mk(noise(ampLin, duration, sr, false));
      else if (mode === 'burst') buf = mk(toneBurst(freq, ampLin, 12, sr));
      else if (mode === 'impulse') {
        const n = Math.round(0.5 * sr);
        const s = new Float32Array(n);
        s[Math.round(n * 0.1)] = ampLin;
        buf = mk(s);
      } else {
        // multitone: 12 log-spaced tones, equal voltage
        const n = Math.round(duration * sr);
        const s = new Float64Array(n);
        const fts = logspace(f0, f1, 12);
        for (const ft of fts) {
          const ph = Math.random() * Math.PI * 2;
          for (let i = 0; i < n; i++) s[i] += (ampLin / 12) * Math.sqrt(12) * Math.sin((2 * Math.PI * ft * i) / sr + ph);
        }
        buf = mk(s);
      }
      void engine.ensure().then(() => engine.playBufferOnce(buf, () => setPlaying(false)));
      setPlaying(true);
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : String(e));
    }
  };

  /* ------- stepped-sine time-domain verification ------- */
  const verify = () => {
    if (!sys) return;
    setVerifying(true);
    setTimeout(() => {
      try {
        const pts: [number, number][] = [];
        const freqs = logspace(Math.max(8, f0), Math.min(20000, f1), 26);
        for (const f of freqs) {
          const sec = Math.max(1.0, 60 / f);
          const u = sineBlock(f, amp.vpeak * Math.SQRT2 / Math.max(vRef, 0.1) * 0.1, sec, FS_DEFAULT);
          const res = runDiscrete(sys.A, sys.B, u);
          const mag = steadyStateMag(u, res.x, f, FS_DEFAULT);
          pts.push([f, mag * 1000]);
        }
        setVerifyDots(pts);
      } finally {
        setVerifying(false);
      }
    }, 30);
  };

  const c = cursor ?? freq;
  const readAt = (arr: number[] | undefined): string => {
    if (!curves || !arr) return '—';
    let i = 0;
    for (let k = 0; k < curves.f.length; k++) {
      if (curves.f[k] <= c) i = k; else break;
    }
    const v = arr[i];
    if (!Number.isFinite(v)) return '—';
    return Math.abs(v) >= 1000 ? v.toExponential(2) : v.toFixed(Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 4);
  };
  const overLimit = (() => {
    if (!curves) return false;
    let i = 0;
    for (let k = 0; k < curves.f.length; k++) { if (curves.f[k] <= c) i = k; else break; }
    return curves.excMm[i] > ts.Xmax;
  })();

  return (
    <div className="ws">
      <div className="split">
        <div className="side">
          <Section title="Signal Generator">
            <Sel
              label="Mode" value={mode}
              options={[
                { value: 'sine', label: 'Sine wave' },
                { value: 'sweepLog', label: 'Log sweep' },
                { value: 'sweepLin', label: 'Linear sweep' },
                { value: 'stepped', label: 'Stepped sine (verify)' },
                { value: 'multitone', label: 'Multi-tone (12)' },
                { value: 'pinkNoise', label: 'Pink noise' },
                { value: 'whiteNoise', label: 'White noise' },
                { value: 'burst', label: 'Tone burst' },
                { value: 'impulse', label: 'Impulse' },
              ]}
              onChange={(v) => setMode(v as GenMode)}
            />
            <Param label="Frequency" value={freq} min={10} max={22000} step={0.5} digits={1} unit="Hz" badge="user" onChange={setFreq} disabled={mode === 'sweepLog' || mode === 'sweepLin'} />
            <Param label="Sweep start" value={f0} min={5} max={1000} step={1} digits={0} unit="Hz" onChange={setF0} />
            <Param label="Sweep end" value={f1} min={100} max={22000} step={10} digits={0} unit="Hz" onChange={setF1} />
            <Param label="Duration" value={duration} min={0.5} max={30} step={0.5} digits={1} unit="s" onChange={setDuration} />
            <Param label="Amplitude" value={amplitude} min={-40} max={0} step={0.5} digits={1} unit="dBFS" onChange={setAmplitude} />
            <div className="note mono">drive = {amp.vpeak.toFixed(2)} V peak (±{vRef.toFixed(2)} Vrms) per driver</div>
            <div className="row" style={{ marginTop: 8 }}>
              {!playing
                ? <Btn variant="primary" onClick={startGen}>▶ Start</Btn>
                : <Btn variant="primary" onClick={stopGen}>⏹ Stop</Btn>}
              {mode === 'stepped' || verifyDots ? (
                <Btn onClick={verify} disabled={verifying}>{verifying ? 'Simulating…' : verifyDots ? 'Re-run verify' : 'Run verify'}</Btn>
              ) : null}
            </div>
            {genErr ? <div className="warnbox" style={{ marginTop: 8 }}>{genErr}</div> : null}
            <p className="note">
              Analytical curves are exact for the linear model. “Run verify” performs an independent stepped-sine
              time-domain simulation of the same system and overlays the measured points.
            </p>
          </Section>

          <Section title="Readouts @ cursor">
            <div className="readout-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <ReadRow k="Frequency" v={c < 1000 ? `${c.toFixed(1)} Hz` : `${(c / 1000).toFixed(2)} kHz`} />
              <ReadRow k="Input V" v={`${vRef.toFixed(2)} rms`} />
              <ReadRow k="Current" v={readAt(curves?.curA)} unit="A" />
              <ReadRow k="Impedance" v={readAt(curves?.impMag)} unit="Ω" />
              <ReadRow k="Excursion" v={readAt(curves?.excMm)} unit="mm" />
              <ReadRow k="Velocity" v={readAt(curves?.velMmS)} unit="mm/s" />
              <ReadRow k="SPL" v={readAt(curves?.splDb)} unit="dB" />
              <ReadRow k="Electrical power" v={readAt(curves?.powerW)} unit="W" />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {overLimit ? <Badge kind="warn">EXCEEDS ±Xmax AT THIS FREQUENCY</Badge> : <Badge kind="ok">WITHIN EXCURSION LIMITS</Badge>}
            </div>
          </Section>
        </div>

        <div className="main-area">
          <Section title="Estimated SPL — far-field piston @ 1 m">
            <Plot
              height={210} xLog yLabel="dB SPL"
              series={[{ name: 'SPL', color: '#35c8dc', points: curves ? curves.f.map((f, i) => [f, curves.splDb[i]] as [number, number]) : [] }]}
              cursorFreq={cursor} onCursor={setCursor}
              csvName="spl-response"
            />
            <p className="note">Piston model in infinite baffle, on-axis — excludes baffle-step loss, cone breakup and room effects. Simulated prediction, not a microphone measurement.</p>
          </Section>

          <div className="grid2">
            <Section title="Impedance (mag / phase)">
              <Plot
                height={180} xLog yLabel="|Z| (Ω)"
                series={[{ name: '|Z|', color: '#9b7bff', points: curves ? curves.f.map((f, i) => [f, curves.impMag[i]] as [number, number]) : [] }]}
                cursorFreq={cursor} onCursor={setCursor}
                csvName="impedance"
              />
            </Section>
            <Section title="Cone Excursion vs frequency">
              <Plot
                height={180} xLog yLabel="mm (one-way)"
                series={[
                  { name: 'peak x', color: '#ff7a1a', points: curves ? curves.f.map((f, i) => [f, curves.excMm[i]] as [number, number]) : [] },
                  ...(verifyDots ? [{ name: 'time-domain verify', color: '#4fd07a', points: verifyDots, dots: true, width: 1 }] : []),
                ]}
                refLines={[
                  { y: ts.Xmax, color: 'rgba(255,77,77,0.7)', label: '+Xmax' },
                  { y: -ts.Xmax, color: 'rgba(255,77,77,0.7)', label: '−Xmax' },
                ]}
                cursorFreq={cursor} onCursor={setCursor}
                csvName="excursion"
              />
            </Section>
            <Section title="Voice-coil current">
              <Plot
                height={180} xLog yLabel="A (peak)"
                series={[{ name: 'I', color: '#4fd07a', points: curves ? curves.f.map((f, i) => [f, curves.curA[i]] as [number, number]) : [] }]}
                cursorFreq={cursor} onCursor={setCursor}
                csvName="current"
              />
            </Section>
            <Section title="Velocity & Power">
              <Plot
                height={180} xLog yLabel="mm/s" yLabel2="W"
                series={[
                  { name: 'cone v', color: '#ff9a44', points: curves ? curves.f.map((f, i) => [f, curves.velMmS[i]] as [number, number]) : [] },
                  { name: 'P', color: '#e05555', points: curves ? curves.f.map((f, i) => [f, curves.powerW[i]] as [number, number]) : [], axis: 'right' },
                ]}
                cursorFreq={cursor} onCursor={setCursor}
                csvName="velocity-power"
              />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadRow(props: { k: string; v: string; unit?: string }) {
  return (
    <div className="readout">
      <div className="k"><span>{props.k}</span></div>
      <div className="v" style={{ fontSize: 13.5 }}>{props.v}{props.unit ? <small>{props.unit}</small> : null}</div>
    </div>
  );
}

void RHO0;
