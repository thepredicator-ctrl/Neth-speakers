/* Audio Lab — upload MP3, waveform, transport, spectrum, amplifier, synced cone. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { engine, type DecodedTrack } from '../audio/engine';
import { Section, Btn, Param, Sel, Badge, FileDrop, XBar } from '../components/ui';
import { Plot } from '../components/Plot';
import { Viewport3D, physicalDispMm } from '../components/Viewport3D';

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioLab() {
  const audio = useApp((s) => s.audio);
  const patchAudio = useApp((s) => s.patchAudio);
  const amplifier = useApp((s) => s.amplifier);
  const patchAmplifier = useApp((s) => s.patchAmplifier);
  const amp = useApp((s) => s.derived.amp);
  const ts = useApp((s) => s.derived.ts);
  const snapshot = useApp((s) => s.snapshot);

  const [track, setTrack] = useState<DecodedTrack | null>(engine.currentTrack);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [loop, setLoop] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [eng, setEng] = useState(engine.status());
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [hist, setHist] = useState<[number, number][]>([]);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const loopRef = useRef<{ start: number; end: number } | null>(null);

  /* ---- load file ---- */
  const loadFile = useCallback(async (f: File) => {
    setErr(null);
    try {
      const t = await engine.decodeFile(f);
      setTrack({ ...t });
    } catch (e) {
      setErr(`Could not decode audio: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /* ---- transport ---- */
  const play = async () => {
    await engine.ensure();
    if (!track) return;
    if (playing) { engine.pause(); setPlaying(false); return; }
    if (pos >= track.duration - 0.05) setPos(0);
    await engine.playTrack(pos >= track.duration - 0.05 ? 0 : pos, loop ? loopRef.current : null);
    setPlaying(true);
  };
  const stop = () => { engine.stop(); setPlaying(false); setPos(0); };
  const seek = (t: number) => {
    setPos(t);
    engine.seek(t);
  };

  /* ---- animation: playhead, spectrum, displacement history ---- */
  useEffect(() => {
    let last = 0;
    let histLast = 0;
    const tick = (t: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const p = engine.position();
      if (engine.currentTrack) {
        setPos((old) => (Math.abs(old - p) > 0.05 ? p : old));
      }
      setEng((old) => {
        const s = engine.status();
        return old.ctxState === s.ctxState && old.worklet === s.worklet && old.fallback === s.fallback ? old : s;
      });
      drawSpectrum();
      if (t - histLast > 100) {
        histLast = t;
        const h = engine.displacementHistory();
        const pts: [number, number][] = [];
        for (let i = 0; i < h.count; i++) {
          const idx = (h.head - h.count + i + h.data.length * 2) % h.data.length;
          pts.push([i, h.data[idx] * 1000]);
        }
        setHist(pts.length ? pts : [[0, 0]]);
      }
      void last;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /* ---- waveform drawing ---- */
  useEffect(() => {
    const c = waveRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!track) {
      ctx.fillStyle = '#6d7480';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No track loaded', w / 2, h / 2);
      return;
    }
    const dur = track.duration;
    const x0 = cursorX != null ? 0 : 0;
    void x0;
    // zoom window: if cursorX set, show 4-second window around it
    let win = { s: 0, e: dur };
    if (cursorX != null) {
      const c0 = Math.max(0, Math.min(dur - 4, cursorX - 2));
      win = { s: c0, e: Math.min(dur, c0 + 4) };
    }
    const b0 = Math.floor((win.s / dur) * track.buckets);
    const b1 = Math.ceil((win.e / dur) * track.buckets);
    const drawCh = (peaks: Float32Array, color: string, yOff: number, yH: number) => {
      ctx.fillStyle = color;
      for (let x = 0; x < w; x++) {
        const b = b0 + Math.floor(((b1 - b0) * x) / w);
        const mn = peaks[b * 2], mx = peaks[b * 2 + 1];
        const y1 = yOff + yH / 2 - mx * (yH / 2 - 1);
        const y2 = yOff + yH / 2 - mn * (yH / 2 - 1);
        ctx.fillRect(x, Math.min(y1, y2), 1, Math.max(1, y2 - y1));
      }
    };
    drawCh(track.peaksL, 'rgba(255,122,26,0.85)', 2, h / 2 - 4);
    drawCh(track.peaksR, 'rgba(53,200,220,0.75)', h / 2 + 2, h / 2 - 4);
    // playhead
    const px = ((pos - win.s) / (win.e - win.s)) * w;
    if (px >= 0 && px <= w) {
      ctx.fillStyle = '#e9ebf0';
      ctx.fillRect(px, 0, 1.5, h);
    }
    // loop region
    if (loopRef.current) {
      const lx0 = ((loopRef.current.start - win.s) / (win.e - win.s)) * w;
      const lx1 = ((loopRef.current.end - win.s) / (win.e - win.s)) * w;
      ctx.fillStyle = 'rgba(79,208,122,0.12)';
      ctx.fillRect(lx0, 0, lx1 - lx0, h);
      ctx.strokeStyle = 'rgba(79,208,122,0.6)';
      ctx.strokeRect(lx0, 0, lx1 - lx0, h);
    }
  }, [track, pos, cursorX]);

  /* ---- spectrum ---- */
  const specBuf = useRef(new Uint8Array(1024));
  const drawSpectrum = () => {
    const c = specRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    engine.spectrum(specBuf.current);
    const n = 96;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const bin = Math.floor(Math.pow(t, 2.1) * 420) + 1;
      const v = specBuf.current[Math.min(bin, specBuf.current.length - 1)] / 255;
      const bh = v * (h - 6);
      const hue = 22 + t * 30;
      ctx.fillStyle = `hsl(${hue} 90% ${28 + v * 30}%)`;
      ctx.fillRect((i / n) * w, h - bh - 2, w / n - 1.5, bh);
    }
  };

  const overLimit = Math.abs(snapshot.x) * 1000 > ts.Xmax;

  return (
    <div className="ws">
      <div className="split">
        <div className="side">
          <Section title="Audio Source">
            <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <Badge kind={eng.ctxState === 'running' ? 'ok' : eng.ctxState === 'suspended' ? 'warn' : 'est'}>
                AUDIO {eng.ctxState === 'running' ? 'RUNNING' : eng.ctxState === 'suspended' ? 'SUSPENDED' : 'OFF'}
              </Badge>
              <Badge kind={eng.fallback ? 'warn' : eng.worklet ? 'ok' : 'est'}>
                {eng.fallback ? 'COMPAT MODE' : eng.worklet ? 'WORKLET DSP' : '—'}
              </Badge>
              {eng.sampleRate > 0 ? <Badge kind="est">{Math.round(eng.sampleRate / 1000)} kHz</Badge> : null}
              {eng.ctxState === 'suspended' ? (
                <Btn small variant="primary" onClick={async () => { await engine.resumeSafely(); setEng(engine.status()); }}>
                  Enable audio
                </Btn>
              ) : null}
            </div>
            {!track ? (
              <FileDrop onFile={loadFile} accept="audio/*" label="Drop MP3/WAV/OGG/FLAC here — or click to browse. Files stay on your device." />
            ) : (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="flex1">
                    <b style={{ fontSize: 13 }}>{track.name}</b>
                    <div className="note mono">{fmtTime(track.duration)} · {track.buffer.sampleRate / 1000} kHz · {track.buffer.numberOfChannels} ch</div>
                  </div>
                  <Btn small ghost onClick={() => { stop(); setTrack(null); }}>Clear</Btn>
                </div>
                <FileDrop onFile={loadFile} accept="audio/*" label="Replace track…" />
              </>
            )}
            {err ? <div className="warnbox" style={{ marginTop: 8 }}>{err}</div> : null}
          </Section>

          <Section title="Transport">
            <div className="row">
              <Btn variant="primary" onClick={play} disabled={!track}>{playing ? '⏸ Pause' : '▶ Play'}</Btn>
              <Btn onClick={stop} disabled={!track}>⏹ Stop</Btn>
              <Btn active={loop} onClick={() => {
                const next = !loop;
                setLoop(next);
                loopRef.current = next && track ? { start: Math.max(0, pos - 0.5), end: Math.min(track.duration, pos + 4) } : null;
                engine.loopRegion = loopRef.current;
                if (playing && track) void engine.playTrack(pos, loopRef.current);
              }} title="Loop a 4.5 s region starting at the playhead">Loop 4s</Btn>
            </div>
            <Param label="Volume" value={audio.volume} min={0} max={1} step={0.01} digits={2} unit="" onChange={(v) => patchAudio({ volume: v })} />
            <Param label="Position" value={pos} min={0} max={track?.duration ?? 1} step={0.1} digits={1} unit="s" onChange={seek} disabled={!track} />
          </Section>

          <Section title="Amplifier & Wiring" right={<Badge kind="est">{amp.nominalImpedanceLabel}</Badge>}>
            <Sel
              label="Drive mode" value={amplifier.driveMode}
              options={[{ value: 'voltage', label: 'Voltage (RMS)' }, { value: 'power', label: 'Power into load' }]}
              onChange={(v) => patchAmplifier({ driveMode: v as typeof amplifier.driveMode })}
            />
            {amplifier.driveMode === 'voltage' ? (
              <Param label="Output voltage" value={amplifier.voltageRms} min={0.1} max={60} step={0.1} digits={2} unit="Vrms" badge="user" onChange={(v) => patchAmplifier({ voltageRms: v })} />
            ) : (
              <Param label="Output power" value={amplifier.powerW} min={0.1} max={1000} step={0.5} digits={1} unit="W" badge="user" onChange={(v) => patchAmplifier({ powerW: v })} hint="Power is converted to drive voltage via the ACTUAL load impedance" />
            )}
            <div className="note mono" style={{ margin: '2px 0 8px' }}>
              → {amp.vpeak.toFixed(2)} V peak (±) · P = {amp.estimatedPowerW.toFixed(2)} W RMS / {amp.estimatedPowerPeakW.toFixed(1)} W peak
            </div>
            <Param label="Clip limit" value={amplifier.clipVoltageRms} min={1} max={100} step={0.5} digits={1} unit="Vrms" onChange={(v) => patchAmplifier({ clipVoltageRms: v })} disabled={!amplifier.clipEnabled} />
            <Param label="Current limit" value={amplifier.currentLimitA} min={0} max={30} step={0.1} digits={1} unit="A (0=off)" onChange={(v) => patchAmplifier({ currentLimitA: v })} />
            <Param label="Output impedance" value={amplifier.outputImpedance} min={0} max={2} step={0.01} digits={2} unit="Ω" onChange={(v) => patchAmplifier({ outputImpedance: v })} />
            <Sel
              label="Simulation channel" value={audio.channel}
              options={[{ value: 'L', label: 'Left' }, { value: 'R', label: 'Right' }, { value: 'sum', label: 'Mono sum' }]}
              onChange={(v) => patchAudio({ channel: v as typeof audio.channel })}
            />
            <Sel
              label="Band" value={audio.band}
              options={[{ value: 'full', label: 'Full range' }, { value: 'bass', label: 'Bass (<140 Hz)' }, { value: 'mid', label: 'Mid (140–2k)' }, { value: 'treble', label: 'Treble (>2 kHz)' }]}
              onChange={(v) => patchAudio({ band: v as typeof audio.band })}
              hint="Frequency-selective simulation for driver experiments"
            />
          </Section>

          <Section title="Cone Visualization">
            <Sel
              label="Display mode" value={audio.vizMode}
              options={[{ value: 'physical', label: 'Physical (true mm)' }, { value: 'enhanced', label: 'Enhanced (multiplied)' }]}
              onChange={(v) => patchAudio({ vizMode: v as typeof audio.vizMode })}
            />
            {audio.vizMode === 'enhanced' ? (
              <Param label="Visualization ×" value={audio.vizMultiplier} min={1} max={60} step={1} digits={0} unit="×" badge="user" onChange={(v) => patchAudio({ vizMultiplier: v })} />
            ) : null}
            <div className="row" style={{ marginTop: 6 }}>
              <Badge kind={snapshot.sync === 'ok' ? 'ok' : snapshot.sync === 'stale' ? 'warn' : 'est'}>
                SYNC {snapshot.sync === 'ok' ? 'LOCKED' : snapshot.sync === 'stale' ? 'STALE — RESET SIM' : 'IDLE'}
              </Badge>
              <Btn small ghost onClick={() => engine.resetSim()}>Reset simulation</Btn>
            </div>
            <p className="note">
              Displacement comes from the ZOH-discretized state-space model applied to every sample of the actual
              signal inside an AudioWorklet — signed, so positive drives the cone forward.
            </p>
          </Section>
        </div>

        <div className="main-area">
          <Section title={`Waveform — ${cursorX != null ? 'zoomed (click legend "fit" to reset: reload view)' : 'click to zoom, click again near edge to fit'}`}>
            <div className="wave-wrap">
              <canvas
                ref={waveRef} className="wave"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const frac = (e.clientX - rect.left) / rect.width;
                  if (!track) return;
                  if (cursorX == null) setCursorX(frac * track.duration);
                  else setCursorX(null);
                }}
              />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span className="note mono">{fmtTime(pos)} / {track ? fmtTime(track.duration) : '—'}</span>
              <span className="note">L (orange) · R (cyan)</span>
            </div>
          </Section>

          <Section title="Spectrum Analyzer">
            <canvas ref={specRef} className="spec" />
          </Section>

          <div className="grid2" style={{ flex: 1, minHeight: 300 }}>
            <Section title="Cone Displacement — rolling window (actual mm)">
              <Plot
                height={190} xLog={false} xLabel="history" yLabel="x (mm)"
                series={[{ name: 'x', color: '#ff7a1a', points: hist }]}
                refLines={[{ y: ts.Xmax, color: 'rgba(255,77,77,0.6)', label: '+Xmax' }, { y: -ts.Xmax, color: 'rgba(255,77,77,0.6)', label: '−Xmax' }]}
                csvName="displacement-history"
              />
              <div className="row" style={{ marginTop: 8 }}>
                <span className="mono" style={{ fontSize: 15 }}>x = {snapshot.x * 1000 >= 0 ? '+' : ''}{(snapshot.x * 1000).toFixed(3)} mm</span>
                <span className="note">v = {(snapshot.v * 1000).toFixed(1)} mm/s · I = {snapshot.i.toFixed(2)} A</span>
                {snapshot.clip ? <Badge kind="warn">CLIP</Badge> : null}
                {overLimit ? <Badge kind="warn">EXCURSION</Badge> : null}
              </div>
            </Section>
            <Section title="Live Driver">
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Viewport3D compact showEnclosure={false} hudExtras={
                  <>
                    <span>{physicalDispMm().toFixed(3)} mm</span>
                    <div className="flex1"><XBar xMm={physicalDispMm()} xmax={ts.Xmax} xmech={ts.Xmech} /></div>
                  </>
                } />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
