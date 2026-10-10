/*
 * Global application store (zustand).
 * Owns the design state (driver / enclosure / amplifier / audio / sim),
 * derives the physics, and pushes updates into the audio engine so the same
 * model powers 3D, audio playback, sweeps and plots.
 */
import { create } from 'zustand';
import type { DriverParams, EnclosureParams, AmplifierParams, AudioSettings, SimSettings, TSParams, MaterialDef } from './physics/types';
import { defaultDriver, defaultEnclosure, defaultAmplifier, defaultAudio, defaultSim, applyPreset, PRESETS } from './physics/defaults';
import { computeTS } from './physics/tsp';
import { computeWinding, type WindingResult } from './physics/winding';
import { computeMagnet, type MagnetResult } from './physics/magnet';
import { computeEnclosure } from './physics/freqresp';
import { buildSystem, wiringInfo, type SystemModel } from './physics/stateSpace';
import { computeAmp, suggestedDriveW, type AmpResult } from './physics/amplifier';
import { MATERIALS } from './physics/materials';
import { engine, type EngineSnapshot } from './audio/engine';
import { mm2m, L2m3 } from './physics/units';
import {
  sanitizeDriver, sanitizeEnclosure, sanitizeAmplifier, sanitizeAudio, sanitizeSim,
} from './physics/validate';
import type { ProjectRecord } from './storage/project';
import * as db from './storage/db';

export interface Derived {
  ts: TSParams;
  winding: WindingResult;
  magnet: MagnetResult;
  sys: SystemModel | null;
  amp: AmpResult;
  encLitres: ReturnType<typeof computeEnclosure> | null;
  driverDisplacementL: number;
}

export interface Workspace {
  id: WorkspaceId;
}
export type WorkspaceId =
  | 'dashboard' | 'speaker' | 'sim3d' | 'audio' | 'frequency' | 'enclosure' | 'parts' | 'results' | 'projects';

interface AppState {
  driver: DriverParams;
  enclosure: EnclosureParams;
  amplifier: AmplifierParams;
  audio: AudioSettings;
  sim: SimSettings;
  customMaterials: MaterialDef[];
  projectName: string;
  currentProjectId: string | null;
  projects: ProjectRecord[];
  snapshot: EngineSnapshot;
  workspace: WorkspaceId;
  derived: Derived;
  /** True once the user edits any drive field — freezes auto drive-sync. */
  ampTouched: boolean;

  /* actions */
  setWorkspace: (w: WorkspaceId) => void;
  patchDriver: (patch: Partial<DriverParams>) => void;
  patchCone: (patch: Partial<DriverParams['cone']>) => void;
  patchSurround: (patch: Partial<DriverParams['surround']>) => void;
  patchSpider: (patch: Partial<DriverParams['spider']>) => void;
  patchCoil: (patch: Partial<DriverParams['coil']>) => void;
  patchMagnet: (patch: Partial<DriverParams['magnet']>) => void;
  patchFrame: (patch: Partial<DriverParams['frame']>) => void;
  patchEnclosure: (patch: Partial<EnclosureParams>) => void;
  patchPort: (patch: Partial<EnclosureParams['port']>) => void;
  patchPassive: (patch: Partial<EnclosureParams['passive']>) => void;
  patchAmplifier: (patch: Partial<AmplifierParams>) => void;
  patchAudio: (patch: Partial<AudioSettings>) => void;
  patchSim: (patch: Partial<SimSettings>) => void;
  applyPresetId: (id: string) => void;
  loadProjectRecord: (rec: ProjectRecord) => void;
  setProjectName: (n: string) => void;
  setCurrentProjectId: (id: string | null) => void;
  refreshProjects: () => Promise<void>;
  addCustomMaterial: (m: MaterialDef) => Promise<void>;
  removeCustomMaterial: (id: string) => Promise<void>;
  materialById: (id: string) => MaterialDef | undefined;
  recompute: () => void;
}

function computeDerived(d: DriverParams, e: EnclosureParams, a: AmplifierParams, mats: (id: string) => MaterialDef | undefined): Derived {
  const ts = computeTS(d, mats);
  const winding = computeWinding(d.coil, mats);
  const magnet = computeMagnet(d.magnet, d.coil, winding, mats);
  // driver displacement volume estimate (motor + basket below gasket)
  const driverVolL =
    (Math.PI / 4) * Math.pow(mm2m(d.magnet.diameter), 2) * mm2m(d.magnet.thickness + d.magnet.backPlateThickness + d.magnet.topPlateThickness) * 1e3 +
    (Math.PI / 4) * Math.pow(mm2m(d.cone.outerDiameter), 2) * mm2m(d.frame.depth * 0.45) * 1e3 * 0.35;
  const encLitres = computeEnclosure(e, ts, driverVolL);
  const wi = wiringInfo(ts, e.driverCount, e.wiring, e.coilWiring, 1);
  const sys = buildSystem({
    ts,
    enclosure: e,
    encResult: encLitres,
    wiring: wi,
    sourceImpedance: a.outputImpedance,
    sampleRate: 48000,
  });
    const amp = computeAmp(a, ts, wi);
    return { ts, winding, magnet, sys, amp, encLitres, driverDisplacementL: driverVolL };
}

/** Substeps for the real-time solver by simulation quality. */
export const QUALITY_SUBSTEPS: Record<SimSettings['quality'], number> = {
  precision: 8, balanced: 4, fast: 2,
};

  const materialFinder = (custom: MaterialDef[]) => (id: string): MaterialDef | undefined =>
    MATERIALS.find((m) => m.id === id) ?? custom.find((m) => m.id === id);

/** Deep-merge a partial (possibly old-version) record over the defaults so
 *  projects saved by earlier builds always load complete. */
function withDefaults<T>(base: T, patch: unknown): T {
  if (patch == null || typeof patch !== 'object') return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v !== null && typeof v === 'object' && !Array.isArray(v) && b !== null && typeof b === 'object' && !Array.isArray(b)
      ? withDefaults(b, v)
      : v;
  }
  return out as T;
}

export const useApp = create<AppState>((set, get) => {
  /** Drive level that shows the driver's rated excursion (see suggestedDriveW).
   *  Applied automatically on every driver change until the user sets drive
   *  themselves — a fresh/custom build is never left at a 2.83 V reference
   *  that moves a high-Bl sub a fraction of a millimetre. */
  const autoAmp = (driver: DriverParams): AmplifierParams | null => {
    if (get().ampTouched) return null;
    const ts = computeTS(driver, materialFinder(get().customMaterials));
    const cur = get().amplifier;
    const powerW = suggestedDriveW(ts, driver.powerHandlingW);
    // keep the user's mode/limit choices, only re-target the level
    return { ...cur, driveMode: 'power', powerW };
  };

  const pushDerived = () => {
    const { driver, enclosure, amplifier, audio, sim } = get();
    const derived = computeDerived(driver, enclosure, amplifier, materialFinder(get().customMaterials));
    set({ derived });
    // push into the audio engine
    if (derived.sys) engine.setSystem(derived.sys);
    engine.setParams({
      vpeak: derived.amp.vpeak,
      vclip: derived.amp.vclipPeak,
      ilim: derived.amp.ilim,
      xmech: mm2m(derived.ts.Xmech),
    });
    engine.setSettings(audio);
    engine.setAcoustic(audio.acousticOutput);
    if (sim.mode === 'advanced') {
      engine.setNonlinear({
        Bl0: derived.ts.Bl, Kms0: derived.ts.Kms, Rms: derived.ts.Rms, Mms: derived.ts.Mms,
        Re: derived.ts.Re, Le: Math.max(1e-6, derived.ts.Le),
        blDrop: driver.blDropAtXmech * (derived.ts.Xmech / Math.max(derived.ts.Xmax, 0.1)) ** 2,
        kmsRise: driver.kmsRiseAtXmax,
        xmax: mm2m(derived.ts.Xmax),
        substeps: QUALITY_SUBSTEPS[sim.quality] ?? 4,
      });
    } else {
      engine.setNonlinear(null);
    }
  };

  return {
    driver: sanitizeDriver(defaultDriver()),
    enclosure: sanitizeEnclosure(defaultEnclosure(), sanitizeDriver(defaultDriver())),
    // Fresh session: drive the default driver at its excursion-matched level
    // (suggestedDriveW) — never the 2.83 V measurement reference.
    amplifier: sanitizeAmplifier({
      ...defaultAmplifier(),
      driveMode: 'power',
      powerW: suggestedDriveW(
        computeTS(sanitizeDriver(defaultDriver()), materialFinder([])),
        sanitizeDriver(defaultDriver()).powerHandlingW,
      ),
    }),
    audio: defaultAudio(),
    sim: defaultSim(),
    customMaterials: [],
    projectName: 'Untitled Design',
    currentProjectId: null,
    projects: [],
    snapshot: { x: 0, v: 0, i: 0, limit: false, clip: false, sync: 'idle' },
    workspace: 'dashboard',
    ampTouched: false,
    derived: computeDerived(defaultDriver(), defaultEnclosure(), defaultAmplifier(), materialFinder([])),

    setWorkspace: (w) => set({ workspace: w }),

    // Every patch is sanitized + self-balanced: values can bend the design
    // but can never break the model.
    patchDriver: (patch) => {
      const driver = sanitizeDriver({ ...get().driver, ...patch });
      const amp = autoAmp(driver);
      set(amp ? { driver, amplifier: sanitizeAmplifier(amp) } : { driver });
      pushDerived();
    },
    patchCone: (patch) => {
      const d = sanitizeDriver({ ...get().driver, cone: { ...get().driver.cone, ...patch } });
      const amp = autoAmp(d);
      set(amp ? { driver: d, amplifier: sanitizeAmplifier(amp) } : { driver: d });
      pushDerived();
    },
    patchSurround: (patch) => { const d = get().driver; const n = sanitizeDriver({ ...d, surround: { ...d.surround, ...patch } }); const amp = autoAmp(n); set(amp ? { driver: n, amplifier: sanitizeAmplifier(amp) } : { driver: n }); pushDerived(); },
    patchSpider: (patch) => { const d = get().driver; const n = sanitizeDriver({ ...d, spider: { ...d.spider, ...patch } }); const amp = autoAmp(n); set(amp ? { driver: n, amplifier: sanitizeAmplifier(amp) } : { driver: n }); pushDerived(); },
    patchCoil: (patch) => { const d = get().driver; const n = sanitizeDriver({ ...d, coil: { ...d.coil, ...patch } }); const amp = autoAmp(n); set(amp ? { driver: n, amplifier: sanitizeAmplifier(amp) } : { driver: n }); pushDerived(); },
    patchMagnet: (patch) => { const d = get().driver; const n = sanitizeDriver({ ...d, magnet: { ...d.magnet, ...patch } }); const amp = autoAmp(n); set(amp ? { driver: n, amplifier: sanitizeAmplifier(amp) } : { driver: n }); pushDerived(); },
    patchFrame: (patch) => { const d = get().driver; const n = sanitizeDriver({ ...d, frame: { ...d.frame, ...patch } }); const amp = autoAmp(n); set(amp ? { driver: n, amplifier: sanitizeAmplifier(amp) } : { driver: n }); pushDerived(); },

    patchEnclosure: (patch) => { set({ enclosure: sanitizeEnclosure({ ...get().enclosure, ...patch }, get().driver) }); pushDerived(); },
    patchPort: (patch) => { const e = get().enclosure; set({ enclosure: sanitizeEnclosure({ ...e, port: { ...e.port, ...patch } }, get().driver) }); pushDerived(); },
    patchPassive: (patch) => { const e = get().enclosure; set({ enclosure: sanitizeEnclosure({ ...e, passive: { ...e.passive, ...patch } }, get().driver) }); pushDerived(); },

    patchAmplifier: (patch) => {
      const drivesDrive = patch.driveMode !== undefined || patch.voltageRms !== undefined || patch.powerW !== undefined;
      set({
        amplifier: sanitizeAmplifier({ ...get().amplifier, ...patch }),
        ...(drivesDrive ? { ampTouched: true } : null),
      });
      pushDerived();
    },
    patchAudio: (patch) => {
      const audio = sanitizeAudio({ ...get().audio, ...patch });
      set({ audio });
      engine.setSettings(audio);
      engine.setAcoustic(audio.acousticOutput);
    },
    patchSim: (patch) => {
      const sim = sanitizeSim({ ...get().sim, ...patch });
      set({ sim });
      if (patch.mode !== undefined || patch.quality !== undefined) pushDerived();
    },

    applyPresetId: (id) => {
      const { driver, enclosure } = applyPreset(id);
      const preset = PRESETS.find((p) => p.id === id);
      const driverS = sanitizeDriver(driver);
      // Preset amplifier blocks are explicit design intent → freeze auto-sync.
      const presetAmp = preset?.amplifier
        ? sanitizeAmplifier({ ...get().amplifier, ...preset.amplifier })
        : null;
      const auto = presetAmp ? null : autoAmp(driverS);
      set({
        driver: driverS,
        enclosure: sanitizeEnclosure({ ...get().enclosure, ...enclosure }, driverS),
        amplifier: presetAmp ?? (auto ? sanitizeAmplifier(auto) : get().amplifier),
        ...(presetAmp ? { ampTouched: true } : null),
        projectName: preset ? preset.name : get().projectName,
        currentProjectId: null,
      });
      pushDerived();
    },

    loadProjectRecord: (rec) => {
      // Merge over defaults first: projects saved by older builds (or edited
      // JSON) can lack newer fields — every value then gets a safe default.
      const driver = sanitizeDriver(withDefaults(defaultDriver(), rec.driver));
      // A saved amplifier block is explicit design intent; if the project has
      // none at all, give it the excursion-matched auto drive.
      const savedAmp = (rec as { amplifier?: unknown }).amplifier != null;
      const amp = savedAmp
        ? sanitizeAmplifier(withDefaults(defaultAmplifier(), rec.amplifier))
        : sanitizeAmplifier(autoAmp(driver) ?? get().amplifier);
      set({
        driver,
        enclosure: sanitizeEnclosure(withDefaults(defaultEnclosure(), rec.enclosure), driver),
        amplifier: amp,
        ...(savedAmp ? { ampTouched: true } : null),
        audio: sanitizeAudio(withDefaults(defaultAudio(), rec.audio)),
        sim: sanitizeSim(withDefaults(defaultSim(), rec.sim)),
        projectName: typeof rec.name === 'string' ? rec.name.slice(0, 120) : 'Untitled Design',
        currentProjectId: typeof rec.id === 'string' ? rec.id : null,
      });
      pushDerived();
    },

    setProjectName: (n) => set({ projectName: n }),
    setCurrentProjectId: (id) => set({ currentProjectId: id }),

    refreshProjects: async () => set({ projects: await db.listProjects() }),

    addCustomMaterial: async (m) => {
      const customMaterials = [...get().customMaterials.filter((x) => x.id !== m.id), m];
      set({ customMaterials });
      await db.putMaterial(m);
      pushDerived();
    },
    removeCustomMaterial: async (id) => {
      const customMaterials = get().customMaterials.filter((x) => x.id !== id);
      set({ customMaterials });
      await db.deleteMaterial(id);
      pushDerived();
    },

    materialById: (id) => materialFinder(get().customMaterials)(id),
    recompute: () => pushDerived(),
  };
});

/* Convenience selectors/hooks */
export function useSnapshotPush(): void {
  engine.onSnapshot = (s) => useApp.setState({ snapshot: s });
}
