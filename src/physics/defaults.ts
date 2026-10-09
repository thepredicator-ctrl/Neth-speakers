/*
 * Default driver geometry, example designs and factory settings.
 * Every numeric default is a documented engineering assumption — see docs/PHYSICS.md.
 */
import type { DriverParams, EnclosureParams, AmplifierParams, AudioSettings, SimSettings } from './types';
import { clone } from '../physics/util';

export function defaultDriver(): DriverParams {
  return {
    cone: {
      outerDiameter: 220,        // 8" class cone at surround seat
      effectiveDiameter: 167,
      depth: 34,
      angleDeg: 65,
      thickness: 0.9,
      materialId: 'paper',
      mass: null,                // auto from geometry
      profile: 'straight',
      dustCapDiameter: 55,
      dustCapShape: 'dome',
      dustCapMaterialId: 'paper',
      dustCapMass: null,
      color: '#26221c',
      finish: 'matte',
    },
    surround: {
      innerDiameter: 220,
      outerDiameter: 246,
      rollCount: 1,
      rollHeight: 9,
      rollWidth: 13,
      materialId: 'rubber-butyl',
      thickness: 1.2,
      stiffness: 520,            // N/m
      damping: 0.55,             // N·s/m
    },
    spider: {
      innerDiameter: 42,
      outerDiameter: 120,
      corrugations: 9,
      corrDepth: 3.2,
      materialId: 'spider-cotton',
      thickness: 0.35,
      stiffness: 1080,           // N/m
      damping: 0.85,             // N·s/m
    },
    coil: {
      windingDiameter: 51.0,
      formerDiameter: 49.4,
      formerHeight: 26,
      formerMaterialId: 'former-kapton',
      formerThickness: 0.25,
      wireDiameter: 0.45,
      wireMaterialId: 'copper',
      layers: 4,
      turnsPerLayer: 34,
      windingHeight: null,       // auto = turns × pitch
      temperatureC: 30,
      config: 'overhung',
      position: 0,
      mass: null,
      re: null,                  // auto from winding
      le: null,                  // auto estimate
    },
    magnet: {
      materialId: 'ferrite-y30',
      count: 1,
      diameter: 120,
      innerDiameter: 52,
      thickness: 18,
      poleDiameter: 50.0,
      topPlateDiameter: 110,
      topPlateThickness: 7,      // gap height
      backPlateDiameter: 120,
      backPlateThickness: 8,
      gapWidth: 1.0,             // radial
      leakageFactor: 2.2,        // typical for ferrite ring structures (1.8–2.8)
      bl: null,
      bGap: null,
    },
    frame: {
      depth: 92,
      gasketThickness: 1.5,
      terminals: 'push',
      tinselLeads: 2,
      mountingHoles: 4,
      materialId: 'steel',
    },
    blDropAtXmech: 0.25,
    kmsRiseAtXmax: 0.6,
    rmsOverride: null,
    qmsTarget: 5.2,
    xmechOverride: null,
    xmaxOverride: null,
    vasOverride: null,
  };
}

export function defaultEnclosure(): EnclosureParams {
  return {
    type: 'sealed',
    internalWidth: 340,
    internalHeight: 380,
    internalDepth: 300,
    wallThickness: 18,
    wallMaterialId: 'mdf',
    bracingVolume: 0.6,
    damping: 'lined',
    port: { shape: 'round', diameter: 68, length: 120, count: 1, flared: true, slotWidth: 50, slotHeight: 220 },
    passive: {
      enabled: false,
      diameter: 220,
      mass: 220,          // g
      suspensionStiffness: 350,
      damping: 1.2,
    },
    driverCount: 1,
    wiring: 'parallel',
    coilWiring: 'parallel',
    driverMount: 'flush',
  };
}

export function defaultAmplifier(): AmplifierParams {
  return {
    driveMode: 'voltage',
    voltageRms: 2.83,       // "1 W into 8 Ω" reference
    powerW: 25,
    clipEnabled: false,
    clipVoltageRms: 14,
    currentLimitA: 0,
    outputImpedance: 0.05,
    bridged: false,
  };
}

export function defaultAudio(): AudioSettings {
  return {
    channel: 'sum',
    band: 'full',
    vizMode: 'enhanced',
    vizMultiplier: 8,
    volume: 0.8,
    acousticOutput: false,
  };
}

export function defaultSim(): SimSettings {
  return { mode: 'dynamic', speed: 1, running: true, paused: false };
}

/* ---------------------------------------------------------------------------
 * Example designs ("demo drivers") — immediately usable, documented examples.
 * ------------------------------------------------------------------------- */

export interface PresetDef { id: string; name: string; blurb: string; make: (base: DriverParams) => DriverParams; enclosure?: Partial<EnclosureParams> }

export const PRESETS: PresetDef[] = [
  {
    id: 'neth10', name: 'Neth-10 Classic (8″ bass-mid)',
    blurb: 'Balanced paper-cone 8″ woofer. The reference demo driver.',
    make: () => defaultDriver(),
    enclosure: { type: 'sealed', internalWidth: 340, internalHeight: 380, internalDepth: 300 },
  },
  {
    id: 'neth12sub', name: 'Neth-12 Sub (12″ long-throw)',
    blurb: 'High-excursion 12″ subwoofer: tall roll surround, 4-layer coil, big box.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 270; d.cone.effectiveDiameter = 220; d.cone.depth = 42; d.cone.thickness = 1.6;
      d.cone.dustCapDiameter = 80; d.cone.profile = 'curved'; d.cone.materialId = 'polypropylene';
      d.surround.innerDiameter = 270; d.surround.outerDiameter = 306; d.surround.rollHeight = 15; d.surround.rollWidth = 18; d.surround.stiffness = 420; d.surround.damping = 0.8;
      d.spider.innerDiameter = 62; d.spider.outerDiameter = 160; d.spider.corrugations = 11; d.spider.corrDepth = 5.5; d.spider.stiffness = 900; d.spider.damping = 1.4; d.spider.materialId = 'spider-nomex';
      d.coil.windingDiameter = 64.4; d.coil.formerDiameter = 62.6; d.coil.formerHeight = 40; d.coil.wireDiameter = 0.6; d.coil.layers = 4; d.coil.turnsPerLayer = 42; d.coil.formerMaterialId = 'former-alu';
      d.magnet.materialId = 'ferrite-y35'; d.magnet.diameter = 170; d.magnet.innerDiameter = 66; d.magnet.thickness = 25; d.magnet.poleDiameter = 63.5; d.magnet.topPlateThickness = 9; d.magnet.backPlateThickness = 12; d.magnet.backPlateDiameter = 170; d.magnet.topPlateDiameter = 160; d.magnet.gapWidth = 1.2; d.magnet.leakageFactor = 1.75;
      d.frame.depth = 130;
      d.qmsTarget = 6;
      return d;
    },
    enclosure: { type: 'ported', internalWidth: 420, internalHeight: 480, internalDepth: 400, port: { shape: 'round', diameter: 100, length: 320, count: 1, flared: true, slotWidth: 60, slotHeight: 300 }, damping: 'heavyFill' },
  },
  {
    id: 'neth65', name: 'Neth-6.5 Midbass',
    blurb: 'Compact 6.5″ midbass for 2-way systems, quick and tight.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 145; d.cone.effectiveDiameter = 118; d.cone.depth = 22; d.cone.thickness = 0.7;
      d.cone.dustCapDiameter = 38; d.cone.materialId = 'polypropylene';
      d.surround.innerDiameter = 145; d.surround.outerDiameter = 165; d.surround.rollHeight = 7; d.surround.rollWidth = 10; d.surround.stiffness = 700;
      d.spider.innerDiameter = 32; d.spider.outerDiameter = 90; d.spider.corrugations = 7; d.spider.corrDepth = 2.4; d.spider.stiffness = 1400;
      d.coil.windingDiameter = 35.5; d.coil.formerDiameter = 34.2; d.coil.formerHeight = 16; d.coil.wireDiameter = 0.35; d.coil.layers = 2; d.coil.turnsPerLayer = 38;
      d.magnet.diameter = 100; d.magnet.innerDiameter = 37; d.magnet.thickness = 15; d.magnet.poleDiameter = 35.2; d.magnet.topPlateThickness = 5; d.magnet.topPlateDiameter = 90; d.magnet.backPlateDiameter = 100; d.magnet.gapWidth = 0.9;
      d.frame.depth = 72;
      return d;
    },
    enclosure: { type: 'sealed', internalWidth: 240, internalHeight: 280, internalDepth: 220, bracingVolume: 0.3 },
  },
  {
    id: 'neth8neodym', name: 'Neth-8 Neo (8″ neodymium)',
    blurb: 'Light neodymium motor 8″ — higher efficiency, lower mass.',
    make: (b) => {
      const d = clone(b);
      d.cone.materialId = 'carbonfiber'; d.cone.thickness = 0.6; d.cone.color = '#1d2126';
      d.coil.wireMaterialId = 'ccaw'; d.coil.wireDiameter = 0.4; d.coil.layers = 2; d.coil.turnsPerLayer = 40;
      d.magnet.materialId = 'neodymium-n42'; d.magnet.diameter = 100; d.magnet.innerDiameter = 53; d.magnet.thickness = 8; d.magnet.poleDiameter = 50.5; d.magnet.topPlateThickness = 6; d.magnet.topPlateDiameter = 92; d.magnet.backPlateThickness = 8; d.magnet.leakageFactor = 1.35;
      d.surround.materialId = 'rubber-nbr';
      d.qmsTarget = 4.5;
      return d;
    },
    enclosure: { type: 'sealed', internalWidth: 300, internalHeight: 340, internalDepth: 260 },
  },
  {
    id: 'neth18pr', name: 'Neth-18 PR Sub (18″ + passive radiator)',
    blurb: 'Very low tuning without a long port: 18″ active + 18″ passive radiator.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 380; d.cone.effectiveDiameter = 330; d.cone.depth = 52; d.cone.thickness = 2.2; d.cone.materialId = 'polypropylene'; d.cone.dustCapDiameter = 110;
      d.surround.innerDiameter = 380; d.surround.outerDiameter = 420; d.surround.rollHeight = 18; d.surround.rollWidth = 20; d.surround.stiffness = 350; d.surround.damping = 1.0;
      d.spider.innerDiameter = 80; d.spider.outerDiameter = 220; d.spider.corrugations = 12; d.spider.corrDepth = 7; d.spider.stiffness = 750; d.spider.damping = 2.0;
      d.coil.windingDiameter = 79.5; d.coil.formerDiameter = 77.5; d.coil.formerHeight = 50; d.coil.wireDiameter = 0.7; d.coil.layers = 4; d.coil.turnsPerLayer = 44;
      d.magnet.materialId = 'ferrite-y35'; d.magnet.diameter = 220; d.magnet.innerDiameter = 82; d.magnet.thickness = 30; d.magnet.poleDiameter = 78.5; d.magnet.topPlateThickness = 11; d.magnet.topPlateDiameter = 210; d.magnet.backPlateDiameter = 220; d.magnet.backPlateThickness = 16; d.magnet.gapWidth = 1.4; d.magnet.leakageFactor = 1.8;
      d.frame.depth = 170;
      d.qmsTarget = 6.5;
      return d;
    },
    enclosure: {
      type: 'passiveRadiator', internalWidth: 520, internalHeight: 620, internalDepth: 460,
      passive: { enabled: true, diameter: 330, mass: 420, suspensionStiffness: 280, damping: 1.6 },
      damping: 'heavyFill', bracingVolume: 1.6,
    },
  },
];

export function presetById(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function applyPreset(id: string): { driver: DriverParams; enclosure?: Partial<EnclosureParams> } {
  const p = presetById(id) ?? PRESETS[0];
  return { driver: p.make(defaultDriver()), enclosure: p.enclosure };
}
