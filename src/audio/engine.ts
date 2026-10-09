/*
 * Neth Speakers — audio engine.
 *
 * Pipeline (real-time):
 *   [file | tone | sweep | noise | mic]
 *     → band filter (bass/mid/treble experiments, optional)
 *     → channel select (L / R / sum)
 *     → SpeakerProcessor (AudioWorklet): runs the ZOH-discretized
 *       electro-mechanical state-space model on EVERY sample of the actual
 *       audio, producing physical cone displacement / velocity / current.
 *     → analyser (spectrum) + gain (volume) → destination
 *
 * The worklet posts {x, v, i, t} snapshots to the main thread (~94 Hz); the
 * SyncClock extrapolates them against the AudioContext clock so the rendered
 * cone motion stays locked to playback across play/pause/seek.
 *
 * Fallback (no AudioWorklet): a ScriptProcessorNode feeds the same discrete
 * filter on the main thread. Slightly higher latency; labeled in the UI.
 */
import { SyncClock } from './sync';
import { zohDiscretize, type SystemModel } from '../physics/stateSpace';
import type { AudioSettings } from '../physics/types';
import { isSafariLike } from '../utils/platform';
export type SourceKind = 'none' | 'file' | 'tone' | 'mic';

export interface EngineSnapshot {
  x: number;       // m displacement
  v: number;       // m/s
  i: number;       // A
  limit: boolean;  // excursion beyond Xmech
  clip: boolean;
  sync: 'ok' | 'stale' | 'idle';
}

export interface DecodedTrack {
  name: string;
  buffer: AudioBuffer;
  duration: number;
  peaksL: Float32Array;  // min/max pairs per bucket → 2× length
  peaksR: Float32Array;
  buckets: number;
}

const PEAK_BUCKETS = 1600;

/** Read a File to ArrayBuffer — uses file.arrayBuffer() where available and
 *  falls back to FileReader for older iOS/Safari versions. */
async function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(new Error(fr.error?.message || 'Could not read the file'));
    fr.readAsArrayBuffer(file);
  });
}

/** decodeAudioData that works on every engine: older Safari only supports the
 *  callback form (promise version added in Safari 14.1). Both paths resolve
 *  the same promise; double-settling is harmless. */
function decodeCompat(ctx: BaseAudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (b: AudioBuffer) => { if (!settled) { settled = true; resolve(b); } };
    const fail = (e: unknown) => { if (!settled) { settled = true; reject(e instanceof Error ? e : new Error('decode failed')); } };
    try {
      const ret = ctx.decodeAudioData(buf, ok, fail) as unknown;
      if (ret && typeof (ret as Promise<AudioBuffer>).then === 'function') {
        (ret as Promise<AudioBuffer>).then(ok, fail);
      }
    } catch (e) {
      fail(e);
    }
  });
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;   // fallback path
  private bandNodes: { hp: BiquadFilterNode; lp: BiquadFilterNode } | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private chGainL: GainNode | null = null;
  private chGainR: GainNode | null = null;
  private inBus: GainNode | null = null;      // sources connect here
  private mediaStream: MediaStream | null = null;

  private source: AudioBufferSourceNode | null = null;
  private osc: OscillatorNode | null = null;
  private track: DecodedTrack | null = null;

  sync = new SyncClock();
  private settings: AudioSettings | null = null;
  private vpeak = 5.657;
  private vclip = 0;
  private ilim = 0;
  private xmech = 0.02;
  private system: SystemModel | null = null;
  private systemN = 0;

  mode: SourceKind = 'none';
  workletReady = false;
  usingFallback = false;
  onSnapshot: ((s: EngineSnapshot) => void) | null = null;

  /** Resume the context; never throws. Returns true when running. */
  async resumeSafely(): Promise<boolean> {
    if (!this.ctx) return false;
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
    } catch { /* gesture/permission restrictions — retried on next gesture */ }
    return this.ctx.state === 'running';
  }

  /** One-shot global gesture listener: browsers create the AudioContext
   *  'suspended' unless a gesture is in progress. The first tap anywhere
   *  unlocks audio — the user never has to understand why it was silent. */
  private autoResumeInstalled = false;
  private installAutoResume(): void {
    if (this.autoResumeInstalled) return;
    this.autoResumeInstalled = true;
    const kick = () => {
      if (this.ctx && this.ctx.state !== 'running') void this.resumeSafely();
    };
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener('pointerdown', kick, opts);
    window.addEventListener('keydown', kick, opts);
    window.addEventListener('touchstart', kick, opts);
  }

  /** Diagnostics for the UI status chip. */
  status(): { ctxState: string; worklet: boolean; fallback: boolean; sampleRate: number } {
    return {
      ctxState: this.ctx?.state ?? 'none',
      worklet: this.workletReady,
      fallback: this.usingFallback,
      sampleRate: this.ctx?.sampleRate ?? 0,
    };
  }

  // rolling displacement history for the Audio Lab timeline (decimated)
  private hist: Float32Array = new Float32Array(2048);
  private histIdx = 0;
  private histCount = 0;
  private msgCount = 0;

  async ensure(): Promise<boolean> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.resumeSafely();
      return this.workletReady || this.usingFallback;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.installAutoResume();
    if (ctx.state === 'suspended') await this.resumeSafely();
    this.master = ctx.createGain();
    this.master.gain.value = this.settings?.volume ?? 0.8;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;

    this.inBus = ctx.createGain();
    // band filters (bypassable via band === 'full')
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 20; hp.Q.value = 0.707;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.707;
    this.bandNodes = { hp, lp };
    this.inBus.connect(hp); hp.connect(lp);

    // channel selection bus
    this.splitter = ctx.createChannelSplitter(2);
    this.chGainL = ctx.createGain();
    this.chGainR = ctx.createGain();
    lp.connect(this.splitter);
    this.splitter.connect(this.chGainL, 0);
    this.splitter.connect(this.chGainR, 1);

    let ok = false;
    try {
      // BASE_URL keeps the worklet URL correct under any deploy base:
      // '/' for local/dev/root hosting, '/Neth-speakers/' on GitHub Pages.
      await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}speaker-worklet.js`);
      this.workletReady = true;
      ok = true;
    } catch {
      this.usingFallback = true;
      ok = true;
    }
    return ok;
  }

  private buildSimNode(): boolean {
    if (!this.ctx || !this.master || !this.analyser || !this.chGainL || !this.chGainR) return false;
    this.disconnectSimNode();
    if (this.workletReady) {
      // Discretize for THIS context's actual hardware rate (may be 44.1k/48k/96k).
      const disc = zohDiscretize(this.system!.A, this.system!.B, 1 / this.ctx.sampleRate);
      const opts: AudioWorkletNodeOptions = {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          n: disc.n,
          Ad: new Float64Array(disc.Ad.flat()),
          Bd: new Float64Array(disc.Bd),
          cx: this.system ? new Float64Array(this.system.cx) : [],
          cv: this.system ? new Float64Array(this.system.cv) : [],
          ci: this.system ? new Float64Array(this.system.ci) : [],
          cp: this.system ? new Float64Array(this.system.cp) : [],
          vpeak: this.vpeak, vclip: this.vclip, ilim: this.ilim, xmech: this.xmech,
          acoustic: this.settings?.acousticOutput ?? false,
          acousticGain: 0.28,
          xIndex: this.system?.xIndex ?? 1,
          vIndex: this.system?.vIndex ?? 2,
          iIndex: this.system?.iIndex ?? 0,
          nonlinear: null,
        },
      };
      const node = new AudioWorkletNode(this.ctx, 'speaker-processor', opts);
      node.port.onmessage = (e) => this.onWorkletMsg(e.data);
      this.chGainL.connect(node);
      this.chGainR.connect(node);
      node.connect(this.analyser);
      this.analyser.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.worklet = node;
      return true;
    }
    // Fallback: ScriptProcessor runs the same discrete filter on main thread.
    const sp = this.ctx.createScriptProcessor(1024, 1, 1);
    const { Ad, Bd } = zohDiscretize(this.system?.A ?? [[0, 0, 0], [0, 0, 1], [0, 0, 0]], this.system?.B ?? [1, 0, 0], 1 / this.ctx.sampleRate);
    const n = Ad.length;
    const Adf = new Float64Array(Ad.flat());
    const Bdf = new Float64Array(Bd);
    const state = new Float64Array(n);
    const tmp = new Float64Array(n);
    sp.onaudioprocess = (ev) => {
      const inp = ev.inputBuffer.getChannelData(0);
      for (let k = 0; k < inp.length; k++) {
        let u = inp[k] * this.vpeak;
        if (this.vclip > 0) u = Math.max(-this.vclip, Math.min(this.vclip, u));
        for (let r = 0; r < n; r++) {
          let acc = Bdf[r] * u;
          const off = r * n;
          for (let c = 0; c < n; c++) acc += Adf[off + c] * state[c];
          tmp[r] = acc;
        }
        state.set(tmp);
        this.sync.pushSample(state[1], state[2], this.ctx!.currentTime);
      }
    };
    this.chGainL.connect(sp);
    this.chGainR.connect(sp);
    sp.connect(this.master); // via analyser path
    this.scriptNode = sp;
    return true;
  }

  private disconnectSimNode(): void {
    if (this.worklet) { try { this.worklet.port.onmessage = null; this.worklet.disconnect(); } catch { /* */ } this.worklet = null; }
    if (this.scriptNode) { try { this.scriptNode.onaudioprocess = null; this.scriptNode.disconnect(); } catch { /* */ } this.scriptNode = null; }
  }

  private onWorkletMsg(d: { x: number; v: number; i: number; t: number; limit: boolean; clip: boolean; ilim: boolean }): void {
    if (!this.ctx) return;
    this.sync.pushSample(d.x, d.v, d.t);
    // decimate into history (~1 sample per message)
    this.hist[this.histIdx] = d.x;
    this.histIdx = (this.histIdx + 1) % this.hist.length;
    this.histCount = Math.min(this.histCount + 1, this.hist.length);
    if ((this.msgCount++ & 1) === 0 && this.onSnapshot) {
      const syncState: EngineSnapshot['sync'] =
        this.mode === 'none' ? 'idle' : (this.sync.healthy(this.ctx.currentTime) ? 'ok' : 'stale');
      this.onSnapshot({ x: d.x, v: d.v, i: d.i, limit: d.limit, clip: d.clip || d.ilim, sync: syncState });
    }
  }

  /* ---------------- configuration ---------------- */

  setSystem(sys: SystemModel, force = false): void {
    if (!sys) return;
    const changed = !this.system || this.system.n !== sys.n || force;
    this.system = sys;
    if (!this.ctx) return;
    if (this.worklet && !changed && this.workletReady && this.ctx) {
      // hot-swap matrices of the same dimension (re-discretized at hw rate)
      const disc = zohDiscretize(sys.A, sys.B, 1 / this.ctx.sampleRate);
      this.worklet.port.postMessage({
        type: 'system', n: sys.n,
        Ad: new Float64Array(disc.Ad.flat()),
        Bd: new Float64Array(disc.Bd),
        cx: new Float64Array(sys.cx),
        cv: new Float64Array(sys.cv),
        ci: new Float64Array(sys.ci),
        cp: new Float64Array(sys.cp),
        vpeak: this.vpeak, reset: false,
      });
    } else if (this.workletReady || this.usingFallback) {
      const wasPlaying = this.mode === 'file' && this.source;
      this.buildSimNode();
      if (wasPlaying) { /* node rebuilt; source graph persists */ }
    }
  }

  setParams(p: { vpeak?: number; vclip?: number; ilim?: number; xmech?: number }): void {
    if (p.vpeak != null) this.vpeak = p.vpeak;
    if (p.vclip != null) this.vclip = p.vclip;
    if (p.ilim != null) this.ilim = p.ilim;
    if (p.xmech != null) this.xmech = p.xmech;
    if (this.worklet) this.worklet.port.postMessage({ type: 'params', ...p });
  }

  setAcoustic(on: boolean): void {
    if (this.worklet) this.worklet.port.postMessage({ type: 'params', acoustic: on });
  }

  setNonlinear(nl: { Bl0: number; Kms0: number; Rms: number; Mms: number; Re: number; Le: number; blDrop: number; kmsRise: number; xmax: number; substeps: number } | null): void {
    if (this.worklet) this.worklet.port.postMessage({ type: 'params', nonlinear: nl });
  }

  resetSim(): void {
    this.sync.sample = null;
    if (this.worklet) this.worklet.port.postMessage({ type: 'reset' });
  }

  setSettings(s: AudioSettings): void {
    this.settings = s;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(s.volume, this.ctx.currentTime, 0.02);
    if (this.bandNodes) {
      const { hp, lp } = this.bandNodes;
      const now = this.ctx?.currentTime ?? 0;
      if (s.band === 'full') { hp.frequency.setTargetAtTime(10, now, 0.02); lp.frequency.setTargetAtTime(20000, now, 0.02); }
      else if (s.band === 'bass') { hp.frequency.setTargetAtTime(10, now, 0.02); lp.frequency.setTargetAtTime(140, now, 0.02); }
      else if (s.band === 'mid') { hp.frequency.setTargetAtTime(140, now, 0.02); lp.frequency.setTargetAtTime(2000, now, 0.02); }
      else { hp.frequency.setTargetAtTime(2000, now, 0.02); lp.frequency.setTargetAtTime(20000, now, 0.02); }
    }
    if (this.chGainL && this.chGainR && this.ctx) {
      const now = this.ctx.currentTime;
      const l = s.channel === 'R' ? 0 : 1;
      const r = s.channel === 'L' ? 0 : 1;
      this.chGainL.gain.setTargetAtTime(l, now, 0.02);
      this.chGainR.gain.setTargetAtTime(r, now, 0.02);
    }
  }

  /* ---------------- sources ---------------- */

  get inputBus(): GainNode | null { return this.inBus; }

  async decodeFile(file: File): Promise<DecodedTrack> {
    await this.ensure();
    if (!this.ctx) throw new Error('AudioContext unavailable');
    const raw = await fileToArrayBuffer(file);
    // Decode chain: live context → fresh OfflineAudioContext. Some browsers
    // refuse decodeAudioData on a suspended/context-limited instance; the
    // offline fallback recovers without any user-visible state. The callback
    // form of decodeAudioData is used because older Safari rejects promises.
    let buffer: AudioBuffer;
    try {
      buffer = await decodeCompat(this.ctx, raw.slice(0));
    } catch (e1) {
      try {
        const OC = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
        const off = new OC(2, 44100, 44100);
        buffer = await decodeCompat(off, raw.slice(0));
      } catch {
        const kind = (file.type || '').replace('audio/', '') || file.name.split('.').pop() || 'audio';
        const safariHint = isSafariLike()
          ? ' Safari cannot decode OGG/Opus or WMA — use MP3, M4A/AAC, WAV or FLAC.'
          : ' Try MP3, WAV, M4A, OGG or FLAC — or re-encode the file at 44.1/48 kHz.';
        throw new Error(
          `This browser could not decode the ${kind.toUpperCase()} file (unsupported codec or damaged data).${safariHint}`
        );
      }
    }
    if (!buffer || !(buffer.duration > 0)) {
      throw new Error('Decoded audio is empty — the file may be corrupt.');
    }
    const buckets = PEAK_BUCKETS;
    const peaksL = new Float32Array(buckets * 2);
    const peaksR = new Float32Array(buckets * 2);
    const L = buffer.getChannelData(0);
    const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
    const step = Math.max(1, Math.floor(L.length / buckets));
    for (let b = 0; b < buckets; b++) {
      let mnL = 1, mxL = -1, mnR = 1, mxR = -1;
      const s0 = b * step, s1 = Math.min(L.length, s0 + step);
      const stride = Math.max(1, Math.floor(step / 64));
      for (let s = s0; s < s1; s += stride) {
        const lv = L[s], rv = R[s];
        if (lv < mnL) mnL = lv; if (lv > mxL) mxL = lv;
        if (rv < mnR) mnR = rv; if (rv > mxR) mxR = rv;
      }
      peaksL[b * 2] = mnL; peaksL[b * 2 + 1] = mxL;
      peaksR[b * 2] = mnR; peaksR[b * 2 + 1] = mxR;
    }
    this.track = { name: file.name, buffer, duration: buffer.duration, peaksL, peaksR, buckets };
    return this.track;
  }

  get currentTrack(): DecodedTrack | null { return this.track; }

  async playTrack(offset: number, loop: { start: number; end: number } | null): Promise<void> {
    await this.ensure();
    if (!this.ctx || !this.track || !this.inBus) return;
    this.stopSources();
    this.buildSimNode();
    const src = this.ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.playbackRate.value = this.playbackRate;
    if (loop && loop.end - loop.start > 0.05) {
      src.loop = true;
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
    }
    src.connect(this.inBus);
    src.onended = () => { if (!this.source?.loop) { this.mode = 'file'; this.source = null; } };
    src.start(0, Math.max(0, Math.min(offset, this.track.duration - 0.01)));
    this.source = src;
    this.mode = 'file';
    this.sync.play(this.ctx.currentTime, offset, this.playbackRate);
  }

  playbackRate = 1;

  /** Play a one-shot buffer (sweeps, noise, bursts) through the simulation node. */
  async playBufferOnce(buf: AudioBuffer, onEnded?: () => void): Promise<void> {
    await this.ensure();
    if (!this.ctx || !this.inBus) return;
    this.stopSources();
    this.buildSimNode();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.playbackRate;
    src.connect(this.inBus);
    src.onended = () => {
      if (this.source === src) this.source = null;
      onEnded?.();
    };
    src.start();
    this.source = src;
    this.mode = 'file';
    this.sync.play(this.ctx.currentTime, 0, this.playbackRate);
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.05, rate);
    if (this.source) this.source.playbackRate.value = this.playbackRate;
    this.sync.setRate(this.playbackRate);
  }

  async startTone(freq: number, ampDb = -6): Promise<void> {
    await this.ensure();
    if (!this.ctx || !this.inBus) return;
    this.stopSources();
    this.buildSimNode();
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const g = this.ctx.createGain();
    const amp = Math.pow(10, ampDb / 20);
    g.gain.value = amp;
    osc.frequency.value = freq;
    osc.connect(g); g.connect(this.inBus);
    osc.start();
    this.osc = osc;
    this.mode = 'tone';
    this.sync.play(this.ctx.currentTime, 0, 1);
  }

  setToneFrequency(f: number): void {
    if (this.osc && this.ctx) this.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.01);
  }

  stopTone(): void {
    this.stopSources();
    this.mode = 'none';
  }

  async startMic(): Promise<boolean> {
    await this.ensure();
    if (!this.ctx || !this.inBus) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      this.mediaStream = stream;
      this.stopSources();
      this.buildSimNode();
      const mic = this.ctx.createMediaStreamSource(stream);
      mic.connect(this.inBus);
      this.mode = 'mic';
      this.sync.play(this.ctx.currentTime, 0, 1);
      return true;
    } catch { return false; }
  }

  stopMic(): void {
    if (this.mediaStream) { this.mediaStream.getTracks().forEach((t) => t.stop()); this.mediaStream = null; }
    this.stopSources();
    this.mode = 'none';
  }

  private stopSources(): void {
    if (this.source) { try { this.source.onended = null; this.source.stop(); } catch { /* */ } this.source = null; }
    if (this.osc) { try { this.osc.stop(); } catch { /* */ } this.osc = null; }
  }

  /* ---------------- transport ---------------- */

  pause(): void {
    if (!this.ctx) return;
    if (this.source) {
      const off = this.sync.offset(this.ctx.currentTime);
      try { this.source.onended = null; this.source.stop(); } catch { /* */ }
      this.source = null;
      this.pausedOffset = off;
      this.sync.pause(this.ctx.currentTime);
    } else {
      this.sync.pause(this.ctx.currentTime);
    }
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  private pausedOffset = 0;

  async resume(): Promise<void> {
    if (!this.ctx) return;
    await this.ctx.resume();
    if (this.track && this.pausedOffset > 0 && !this.source) {
      await this.playTrack(this.pausedOffset, this.loopRegion);
    }
    this.sync.play(this.ctx.currentTime, this.sync.offset(this.ctx.currentTime), this.playbackRate);
  }

  seek(t: number): void {
    if (!this.ctx) return;
    if (this.track && this.mode === 'file') {
      this.pausedOffset = t;
      if (this.sync.isPlaying || this.source) void this.playTrack(t, this.loopRegion);
      else this.sync.seek(this.ctx.currentTime, t);
    } else {
      this.sync.seek(this.ctx.currentTime, t);
    }
  }

  stop(): void {
    this.stopSources();
    this.pausedOffset = 0;
    if (this.ctx) this.sync.pause(this.ctx.currentTime);
    this.resetSim();
  }

  loopRegion: { start: number; end: number } | null = null;

  position(): number {
    if (!this.ctx) return 0;
    return this.sync.offset(this.ctx.currentTime);
  }

  /* ---------------- analysis ---------------- */

  spectrum(out: Uint8Array): void {
    if (!this.analyser) { out.fill(0); return; }
    this.analyser.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
  }

  displacementHistory(): { data: Float32Array; count: number; head: number } {
    return { data: this.hist, count: this.histCount, head: this.histIdx };
  }

  /** Render-time displacement (extrapolated to the audio clock's now). */
  renderDisplacement(): number {
    if (!this.ctx) return 0;
    return this.sync.renderDisplacement(this.ctx.currentTime);
  }

  dispose(): void {
    this.stopSources();
    this.disconnectSimNode();
    this.stopMic();
    if (this.master) { try { this.master.disconnect(); } catch { /* */ } }
    if (this.ctx) { void this.ctx.close(); this.ctx = null; }
  }
}

export const engine = new AudioEngine();
