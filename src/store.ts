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
import { computeAmp, type AmpResult } from './physics/amplifier';
import { MATERIALS } from './physics/materials';
import { engine, type EngineSnapshot } from './audio/engine';
import { mm2m, L2m3 } from './physics/units';
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
  | 'speaker' | 'sim3d' | 'audio' | 'frequency' | 'enclosure' | 'parts' | 'results' | 'projects';

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

const materialFinder = (custom: MaterialDef[]) => (id: string): MaterialDef | undefined =>
  MATERIALS.find((m) => m.id === id) ?? custom.find((m) => m.id === id);

export const useApp = create<AppState>((set, get) => {
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
        substeps: 4,
      });
    } else {
      engine.setNonlinear(null);
    }
  };

  return {
    driver: defaultDriver(),
    enclosure: defaultEnclosure(),
    amplifier: defaultAmplifier(),
    audio: defaultAudio(),
    sim: defaultSim(),
    customMaterials: [],
    projectName: 'Untitled Design',
    currentProjectId: null,
    projects: [],
    snapshot: { x: 0, v: 0, i: 0, limit: false, clip: false, sync: 'idle' },
    workspace: 'speaker',
    derived: computeDerived(defaultDriver(), defaultEnclosure(), defaultAmplifier(), materialFinder([])),

    setWorkspace: (w) => set({ workspace: w }),

    patchDriver: (patch) => { set({ driver: { ...get().driver, ...patch } }); pushDerived(); },
    patchCone: (patch) => {
      const d = get().driver;
      const cone = { ...d.cone, ...patch };
      // keep angle & depth consistent (depth wins; angle derived for display)
      cone.angleDeg = Math.atan((cone.outerDiameter / 2 - cone.dustCapDiameter / 2 - 6) / Math.max(1, cone.depth)) * (180 / Math.PI);
      set({ driver: { ...d, cone } });
      pushDerived();
    },
    patchSurround: (patch) => { const d = get().driver; set({ driver: { ...d, surround: { ...d.surround, ...patch } } }); pushDerived(); },
    patchSpider: (patch) => { const d = get().driver; set({ driver: { ...d, spider: { ...d.spider, ...patch } } }); pushDerived(); },
    patchCoil: (patch) => { const d = get().driver; set({ driver: { ...d, coil: { ...d.coil, ...patch } } }); pushDerived(); },
    patchMagnet: (patch) => { const d = get().driver; set({ driver: { ...d, magnet: { ...d.magnet, ...patch } } }); pushDerived(); },
    patchFrame: (patch) => { const d = get().driver; set({ driver: { ...d, frame: { ...d.frame, ...patch } } }); pushDerived(); },

    patchEnclosure: (patch) => { set({ enclosure: { ...get().enclosure, ...patch } }); pushDerived(); },
    patchPort: (patch) => { const e = get().enclosure; set({ enclosure: { ...e, port: { ...e.port, ...patch } } }); pushDerived(); },
    patchPassive: (patch) => { const e = get().enclosure; set({ enclosure: { ...e, passive: { ...e.passive, ...patch } } }); pushDerived(); },

    patchAmplifier: (patch) => { set({ amplifier: { ...get().amplifier, ...patch } }); pushDerived(); },
    patchAudio: (patch) => {
      const audio = { ...get().audio, ...patch };
      set({ audio });
      engine.setSettings(audio);
      engine.setAcoustic(audio.acousticOutput);
    },
    patchSim: (patch) => { set({ sim: { ...get().sim, ...patch } }); },

    applyPresetId: (id) => {
      const { driver, enclosure } = applyPreset(id);
      const preset = PRESETS.find((p) => p.id === id);
      set({
        driver,
        enclosure: { ...get().enclosure, ...enclosure },
        projectName: preset ? preset.name : get().projectName,
        currentProjectId: null,
      });
      pushDerived();
    },

    loadProjectRecord: (rec) => {
      set({
        driver: rec.driver,
        enclosure: rec.enclosure,
        amplifier: rec.amplifier,
        audio: rec.audio,
        sim: rec.sim,
        projectName: rec.name,
        currentProjectId: rec.id,
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
