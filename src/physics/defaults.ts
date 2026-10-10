/*
 * Default driver geometry, example designs and factory settings.
 * Every numeric default is a documented engineering assumption — see docs/PHYSICS.md.
 */
import type { DriverParams, EnclosureParams, AmplifierParams, AudioSettings, SimSettings } from './types';
import { clone } from '../physics/util';

export function defaultDriver(): DriverParams {
  return {
    cone: {
      outerDiameter: 160,        // 8" class cone body at the surround seat
      effectiveDiameter: 173,    // auto: cone body + ½ surround roll (Sd source)
      depth: 30,
      angleDeg: 65,
      thickness: 0.9,
      materialId: 'paper',
      mass: null,                // auto from geometry
      profile: 'straight',
      dustCapDiameter: 52,
      dustCapShape: 'dome',
      dustCapMaterialId: 'paper',
      dustCapMass: null,
      color: '#26221c',
      finish: 'matte',
    },
    surround: {
      innerDiameter: 160,        // bonded to the cone edge
      outerDiameter: 186,        // bonded to the frame seat (inner + 2×roll)
      rollCount: 1,
      rollHeight: 9,
      rollWidth: 13,             // ≥ 8 % of the 160 mm cone (auto-balance floor)
      materialId: 'rubber-butyl',
      thickness: 1.2,
      stiffness: 520,            // N/m
      damping: 0.55,             // N·s/m
      color: '#17181c',
    },
    spider: {
      innerDiameter: 50.6,       // bonded to the former outer wall
      outerDiameter: 120,
      corrugations: 9,
      corrDepth: 3.2,
      materialId: 'spider-cotton',
      thickness: 0.35,
      stiffness: 1080,           // N/m
      damping: 0.85,             // N·s/m
      color: '#8a7a5c',
    },
    coil: {
      windingDiameter: 51.55,    // first layer centred on the former wall
      formerDiameter: 50.6,      // slides over the 50 mm pole (+0.6 clearance)
      formerHeight: 30,
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
      painted: false,
    },
    frame: {
      depth: 92,
      gasketThickness: 1.5,
      terminals: 'push',
      tinselLeads: 2,
      mountingHoles: 4,
      materialId: 'steel',
      color: '#33363c',
      style: 'stamped',
      gasket: true,
      boot: null,               // auto: on for subwoofer-class drivers
    },
    blDropAtXmech: 0.25,
    kmsRiseAtXmax: 0.6,
    rmsOverride: null,
    qmsTarget: 5.2,
    xmechOverride: null,
    xmaxOverride: null,
    vasOverride: null,
    powerHandlingW: 150,
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
    finishColor: '#7a5c3e',
    grille: { enabled: false, color: '#141414' },
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
  return { mode: 'dynamic', speed: 1, running: true, paused: false, quality: 'precision', vizSmoothing: 0.35 };
}

/* ---------------------------------------------------------------------------
 * Example designs ("demo drivers") — immediately usable, documented examples.
 * ------------------------------------------------------------------------- */

export interface PresetDef {
  id: string; name: string; blurb: string; make: (base: DriverParams) => DriverParams;
  enclosure?: Partial<EnclosureParams>;
  amplifier?: Partial<AmplifierParams>;   // sane drive level for this design
}

export const PRESETS: PresetDef[] = [
  {
    id: 'blank', name: 'Start From Nothing (blank chassis)',
    blurb: 'A bare, unstyled baseline: raw grey pulp cone, flat cap, stamped steel basket, small ferrite motor, no boot, no trim. Nothing is copied from any reference driver — open the Parts Editor and shape every part into your own build.',
    make: (b) => {
      const d = clone(b);
      // raw, unstyled appearance — the user builds the look from here
      d.cone.materialId = 'paper'; d.cone.color = '#8d9299';
      d.cone.profile = 'straight'; d.cone.finish = 'matte';
      d.cone.dustCapShape = 'flat';
      d.surround.materialId = 'rubber-butyl'; d.surround.color = '#232629';
      d.spider.materialId = 'spider-cotton';
      d.frame.style = 'stamped'; d.frame.color = '#3b3e44'; d.frame.boot = false;
      d.magnet.materialId = 'ferrite-y30'; d.magnet.painted = false;
      return d;
    },
  },
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
      d.cone.outerDiameter = 250; d.cone.effectiveDiameter = 266; d.cone.depth = 42; d.cone.thickness = 1.6;
      d.cone.dustCapDiameter = 80; d.cone.profile = 'curved'; d.cone.materialId = 'polypropylene';
      d.surround.innerDiameter = 250; d.surround.outerDiameter = 286; d.surround.rollHeight = 15; d.surround.rollWidth = 16; d.surround.stiffness = 420; d.surround.damping = 0.8;
      d.spider.innerDiameter = 64.6; d.spider.outerDiameter = 160; d.spider.corrugations = 11; d.spider.corrDepth = 5.5; d.spider.stiffness = 900; d.spider.damping = 1.4; d.spider.materialId = 'spider-nomex';
      d.coil.windingDiameter = 65.3; d.coil.formerDiameter = 64.1; d.coil.formerHeight = 44; d.coil.wireDiameter = 0.6; d.coil.layers = 4; d.coil.turnsPerLayer = 42; d.coil.formerMaterialId = 'former-alu';
      d.magnet.materialId = 'ferrite-y35'; d.magnet.diameter = 170; d.magnet.innerDiameter = 66; d.magnet.thickness = 25; d.magnet.poleDiameter = 63.5; d.magnet.topPlateThickness = 9; d.magnet.backPlateThickness = 12; d.magnet.backPlateDiameter = 170; d.magnet.topPlateDiameter = 160; d.magnet.gapWidth = 1.2; d.magnet.leakageFactor = 1.75;
      d.frame.depth = 130;
      d.qmsTarget = 6;
      d.powerHandlingW = 400;
      return d;
    },
    enclosure: { type: 'ported', internalWidth: 420, internalHeight: 480, internalDepth: 400, port: { shape: 'round', diameter: 100, length: 320, count: 1, flared: true, slotWidth: 60, slotHeight: 300 }, damping: 'heavyFill' },
  },
  {
    id: 'neth65', name: 'Neth-6.5 Midbass',
    blurb: 'Compact 6.5″ midbass for 2-way systems, quick and tight.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 130; d.cone.effectiveDiameter = 139; d.cone.depth = 22; d.cone.thickness = 0.7;
      d.cone.dustCapDiameter = 38; d.cone.materialId = 'polypropylene';
      d.surround.innerDiameter = 130; d.surround.outerDiameter = 148; d.surround.rollHeight = 7; d.surround.rollWidth = 9; d.surround.stiffness = 700;
      d.spider.innerDiameter = 36.3; d.spider.outerDiameter = 90; d.spider.corrugations = 7; d.spider.corrDepth = 2.4; d.spider.stiffness = 1400;
      d.coil.windingDiameter = 36.75; d.coil.formerDiameter = 35.8; d.coil.formerHeight = 20; d.coil.wireDiameter = 0.35; d.coil.layers = 2; d.coil.turnsPerLayer = 38;
      d.magnet.diameter = 100; d.magnet.innerDiameter = 37; d.magnet.thickness = 15; d.magnet.poleDiameter = 35.2; d.magnet.topPlateThickness = 5; d.magnet.topPlateDiameter = 90; d.magnet.backPlateDiameter = 100; d.magnet.gapWidth = 0.9;
      d.frame.depth = 72;
      d.powerHandlingW = 120;
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
      d.powerHandlingW = 100;
      return d;
    },
    enclosure: { type: 'sealed', internalWidth: 300, internalHeight: 340, internalDepth: 260 },
  },
  {
    id: 'x12v2', name: 'Sundown X-12 v.2 D2 (12″ SPL sub)',
    blurb: 'Published-spec SPL monster: 30 mm one-way Xmax, 1500 W RMS, 3″ coil, boot motor. Series coils (3.8 Ω).',
    make: (b) => {
      const d = clone(b);
      // geometry — real X-12 v.2 proportions (12″, 3.0″ coil, vented gap)
      d.cone.outerDiameter = 240; d.cone.depth = 66; d.cone.thickness = 2.4;
      d.cone.profile = 'straight'; d.cone.materialId = 'paper'; d.cone.color = '#1c1e22';
      d.cone.dustCapDiameter = 112; d.cone.dustCapShape = 'dome'; d.cone.dustCapMass = 30;
      d.cone.mass = 170;           // g — composite cone + glass roving
      d.surround.innerDiameter = 240; d.surround.outerDiameter = 280;
      d.surround.rollHeight = 25; d.surround.rollWidth = 20;
      d.surround.stiffness = 2750; d.surround.damping = 1.5; d.surround.materialId = 'rubber-nbr';
      d.spider.innerDiameter = 72.5; d.spider.outerDiameter = 172;
      d.spider.corrugations = 12; d.spider.corrDepth = 7.5;
      d.spider.stiffness = 15800; d.spider.damping = 2.4; d.spider.materialId = 'spider-nomex';
      d.coil.formerDiameter = 71.0; d.coil.windingDiameter = 72.3; d.coil.formerHeight = 100;
      d.coil.wireDiameter = 0.55; d.coil.layers = 4; d.coil.turnsPerLayer = 40;
      d.coil.windingHeight = 72;   // → Xmax = (72 − 12)/2 = 30 mm one-way
      d.coil.formerMaterialId = 'former-alu'; d.coil.mass = 120;
      d.coil.re = 3.8;             // Ω — D2 coils in series (published Re)
      d.magnet.materialId = 'ferrite-y35';
      d.magnet.poleDiameter = 70.0; d.magnet.topPlateDiameter = 200; d.magnet.topPlateThickness = 12;
      d.magnet.diameter = 220; d.magnet.innerDiameter = 100; d.magnet.thickness = 32; d.magnet.count = 2;
      d.magnet.backPlateDiameter = 220; d.magnet.backPlateThickness = 20; d.magnet.gapWidth = 2.5;
      d.magnet.bl = 26.5;          // T·m — from published Qes/Fs/Re (self-consistent)
      d.frame.depth = 175; d.frame.style = 'diecast'; d.frame.boot = true; d.frame.tinselLeads = 4;
      d.frame.color = '#2b2e33';
      d.qmsTarget = 6.3;           // → Qms ≈ 4.9 published
      d.xmaxOverride = 30;         // mm one-way (published, 70 % Bl criterion ≈ linear here)
      d.powerHandlingW = 1500;
      return d;
    },
    enclosure: {
      type: 'ported', internalWidth: 460, internalHeight: 500, internalDepth: 320,
      port: { shape: 'round', diameter: 102, length: 330, count: 1, flared: true, slotWidth: 60, slotHeight: 300 },
      damping: 'lightFill', bracingVolume: 0.9,
    },
    amplifier: { driveMode: 'power', powerW: 900, clipEnabled: true, clipVoltageRms: 75, currentLimitA: 0 },
  },
  {
    id: 'neth15sub', name: 'Neth-15 Sub (15″ long-throw)',
    blurb: 'Serious 15″ subwoofer: 26 mm roll surround, 3.5″ coil, big ferrite motor.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 340; d.cone.depth = 52; d.cone.thickness = 2.0;
      d.cone.profile = 'curved'; d.cone.materialId = 'polypropylene'; d.cone.dustCapDiameter = 100;
      d.surround.innerDiameter = 340; d.surround.outerDiameter = 392;
      d.surround.rollHeight = 26; d.surround.rollWidth = 26;
      d.surround.stiffness = 500; d.surround.damping = 0.9; d.surround.materialId = 'rubber-butyl';
      d.spider.innerDiameter = 90.1; d.spider.outerDiameter = 230;
      d.spider.corrugations = 12; d.spider.corrDepth = 7;
      d.spider.stiffness = 850; d.spider.damping = 1.8; d.spider.materialId = 'spider-nomex';
      d.coil.formerDiameter = 89.1; d.coil.windingDiameter = 90.3; d.coil.formerHeight = 70;
      d.coil.wireDiameter = 0.6; d.coil.layers = 4; d.coil.turnsPerLayer = 44;
      d.coil.windingHeight = 50;   // → Xmax = (50 − 11)/2 = 19.5 mm one-way
      d.coil.formerMaterialId = 'former-alu'; d.coil.mass = 95;
      d.magnet.materialId = 'ferrite-y35';
      d.magnet.poleDiameter = 88; d.magnet.topPlateDiameter = 220; d.magnet.topPlateThickness = 11;
      d.magnet.diameter = 240; d.magnet.innerDiameter = 92; d.magnet.thickness = 30; d.magnet.count = 1;
      d.magnet.backPlateDiameter = 240; d.magnet.backPlateThickness = 18; d.magnet.gapWidth = 1.6;
      d.magnet.leakageFactor = 1.8;
      d.frame.depth = 200; d.frame.style = 'diecast'; d.frame.boot = true; d.frame.tinselLeads = 4;
      d.frame.color = '#2b2e33';
      d.qmsTarget = 6.2;
      d.powerHandlingW = 1000;
      return d;
    },
    enclosure: {
      type: 'ported', internalWidth: 500, internalHeight: 560, internalDepth: 450,
      port: { shape: 'round', diameter: 120, length: 340, count: 1, flared: true, slotWidth: 70, slotHeight: 350 },
      damping: 'lightFill', bracingVolume: 1.2,
    },
  },
  {
    id: 'neth18xl', name: 'Neth-18 XL (18″ SPL sub)',
    blurb: 'Competition 18″: 32 mm tall roll, 4″ coil, Xmax ≈ 33 mm one-way, 1500 W.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 400; d.cone.depth = 58; d.cone.thickness = 2.4;
      d.cone.profile = 'straight'; d.cone.materialId = 'paper'; d.cone.color = '#1c1e22';
      d.cone.dustCapDiameter = 130; d.cone.dustCapShape = 'dome'; d.cone.mass = 260;
      d.surround.innerDiameter = 400; d.surround.outerDiameter = 460;
      d.surround.rollHeight = 32; d.surround.rollWidth = 30;
      d.surround.stiffness = 1400; d.surround.damping = 1.4; d.surround.materialId = 'rubber-nbr';
      d.spider.innerDiameter = 100.1; d.spider.outerDiameter = 252;
      d.spider.corrugations = 13; d.spider.corrDepth = 8;
      d.spider.stiffness = 6000; d.spider.damping = 2.6; d.spider.materialId = 'spider-nomex';
      d.coil.formerDiameter = 99.1; d.coil.windingDiameter = 100.4; d.coil.formerHeight = 90;
      d.coil.wireDiameter = 0.65; d.coil.layers = 4; d.coil.turnsPerLayer = 46;
      d.coil.windingHeight = 80;   // → Xmax = (80 − 13)/2 ≈ 33.5 mm one-way
      d.coil.formerMaterialId = 'former-alu'; d.coil.mass = 180;
      d.magnet.materialId = 'ferrite-y35';
      d.magnet.poleDiameter = 98; d.magnet.topPlateDiameter = 240; d.magnet.topPlateThickness = 13;
      d.magnet.diameter = 260; d.magnet.innerDiameter = 102; d.magnet.thickness = 36; d.magnet.count = 1;
      d.magnet.backPlateDiameter = 260; d.magnet.backPlateThickness = 20; d.magnet.gapWidth = 1.8;
      d.magnet.leakageFactor = 1.7;
      d.frame.depth = 230; d.frame.style = 'diecast'; d.frame.boot = true; d.frame.tinselLeads = 4;
      d.frame.color = '#2b2e33';
      d.qmsTarget = 6.4;
      d.powerHandlingW = 1500;
      return d;
    },
    enclosure: {
      type: 'ported', internalWidth: 580, internalHeight: 640, internalDepth: 500,
      port: { shape: 'round', diameter: 150, length: 380, count: 2, flared: true, slotWidth: 80, slotHeight: 400 },
      damping: 'lightFill', bracingVolume: 1.8,
    },
    amplifier: { driveMode: 'power', powerW: 1200, clipEnabled: true, clipVoltageRms: 90, currentLimitA: 0 },
  },
  {
    id: 'neth21', name: 'Neth-21 Monster (21″ SPL sub)',
    blurb: 'Deck-moving 21″: 40 mm roll, 5″ coil, Xmax ≈ 40 mm one-way, 2500 W.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 480; d.cone.depth = 64; d.cone.thickness = 3.0;
      d.cone.profile = 'straight'; d.cone.materialId = 'paper'; d.cone.color = '#1b1d21';
      d.cone.dustCapDiameter = 150; d.cone.dustCapShape = 'dome'; d.cone.mass = 380;
      d.surround.innerDiameter = 480; d.surround.outerDiameter = 552;
      d.surround.rollHeight = 40; d.surround.rollWidth = 36;
      d.surround.stiffness = 1800; d.surround.damping = 1.6; d.surround.materialId = 'rubber-nbr';
      d.spider.innerDiameter = 125.1; d.spider.outerDiameter = 292;
      d.spider.corrugations = 14; d.spider.corrDepth = 9;
      d.spider.stiffness = 9000; d.spider.damping = 3.2; d.spider.materialId = 'spider-nomex';
      d.coil.formerDiameter = 124.1; d.coil.windingDiameter = 125.5; d.coil.formerHeight = 110;
      d.coil.wireDiameter = 0.8; d.coil.layers = 4; d.coil.turnsPerLayer = 46;
      d.coil.windingHeight = 96;   // → Xmax = (96 − 15)/2 ≈ 40.5 mm one-way
      d.coil.formerMaterialId = 'former-alu'; d.coil.mass = 280;
      d.magnet.materialId = 'ferrite-y35';
      d.magnet.poleDiameter = 122; d.magnet.topPlateDiameter = 280; d.magnet.topPlateThickness = 15;
      d.magnet.diameter = 300; d.magnet.innerDiameter = 128; d.magnet.thickness = 40; d.magnet.count = 1;
      d.magnet.backPlateDiameter = 300; d.magnet.backPlateThickness = 24; d.magnet.gapWidth = 2.2;
      d.magnet.leakageFactor = 1.65;
      d.frame.depth = 270; d.frame.style = 'diecast'; d.frame.boot = true; d.frame.tinselLeads = 4;
      d.frame.color = '#282b30';
      d.qmsTarget = 6.6;
      d.powerHandlingW = 2500;
      return d;
    },
    enclosure: {
      type: 'ported', internalWidth: 680, internalHeight: 760, internalDepth: 580,
      port: { shape: 'round', diameter: 200, length: 420, count: 1, flared: true, slotWidth: 100, slotHeight: 480 },
      damping: 'lightFill', bracingVolume: 2.6,
    },
    amplifier: { driveMode: 'power', powerW: 2000, clipEnabled: true, clipVoltageRms: 110, currentLimitA: 0 },
  },
  {
    id: 'neth24', name: 'Neth-24 Colossus (24″ SPL sub)',
    blurb: 'The ceiling of the app: 24″ cone, 48 mm roll surround, 6″ coil, Xmax ≈ 46 mm.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 560; d.cone.depth = 70; d.cone.thickness = 3.2;
      d.cone.profile = 'straight'; d.cone.materialId = 'paper'; d.cone.color = '#1a1c20';
      d.cone.dustCapDiameter = 180; d.cone.dustCapShape = 'dome'; d.cone.mass = 520;
      d.surround.innerDiameter = 560; d.surround.outerDiameter = 644;
      d.surround.rollHeight = 48; d.surround.rollWidth = 42;
      d.surround.stiffness = 2200; d.surround.damping = 1.8; d.surround.materialId = 'rubber-nbr';
      d.spider.innerDiameter = 155.1; d.spider.outerDiameter = 322;
      d.spider.corrugations = 15; d.spider.corrDepth = 10;
      d.spider.stiffness = 12000; d.spider.damping = 3.8; d.spider.materialId = 'spider-nomex';
      d.coil.formerDiameter = 154.1; d.coil.windingDiameter = 155.6; d.coil.formerHeight = 125;
      d.coil.wireDiameter = 0.9; d.coil.layers = 4; d.coil.turnsPerLayer = 48;
      d.coil.windingHeight = 108;  // → Xmax = (108 − 16)/2 = 46 mm one-way
      d.coil.formerMaterialId = 'former-alu'; d.coil.mass = 400;
      d.magnet.materialId = 'ferrite-y35';
      d.magnet.poleDiameter = 152; d.magnet.topPlateDiameter = 310; d.magnet.topPlateThickness = 16;
      d.magnet.diameter = 330; d.magnet.innerDiameter = 158; d.magnet.thickness = 45; d.magnet.count = 1;
      d.magnet.backPlateDiameter = 330; d.magnet.backPlateThickness = 26; d.magnet.gapWidth = 2.4;
      d.magnet.leakageFactor = 1.6;
      d.frame.depth = 300; d.frame.style = 'diecast'; d.frame.boot = true; d.frame.tinselLeads = 4;
      d.frame.color = '#26292e';
      d.qmsTarget = 6.8;
      d.powerHandlingW = 3000;
      return d;
    },
    enclosure: {
      type: 'ported', internalWidth: 800, internalHeight: 900, internalDepth: 680,
      port: { shape: 'round', diameter: 250, length: 460, count: 2, flared: true, slotWidth: 120, slotHeight: 560 },
      damping: 'lightFill', bracingVolume: 3.4,
    },
    amplifier: { driveMode: 'power', powerW: 2500, clipEnabled: true, clipVoltageRms: 130, currentLimitA: 0 },
  },
  {
    id: 'neth18pr', name: 'Neth-18 PR Sub (18″ + passive radiator)',
    blurb: 'Very low tuning without a long port: 18″ active + 18″ passive radiator.',
    make: (b) => {
      const d = clone(b);
      d.cone.outerDiameter = 360; d.cone.effectiveDiameter = 382; d.cone.depth = 52; d.cone.thickness = 2.2; d.cone.materialId = 'polypropylene'; d.cone.dustCapDiameter = 110;
      d.surround.innerDiameter = 360; d.surround.outerDiameter = 404; d.surround.rollHeight = 18; d.surround.rollWidth = 22; d.surround.stiffness = 350; d.surround.damping = 1.0;
      d.spider.innerDiameter = 79.6; d.spider.outerDiameter = 220; d.spider.corrugations = 12; d.spider.corrDepth = 7; d.spider.stiffness = 750; d.spider.damping = 2.0;
      d.coil.windingDiameter = 80.3; d.coil.formerDiameter = 79.1; d.coil.formerHeight = 60; d.coil.wireDiameter = 0.7; d.coil.layers = 4; d.coil.turnsPerLayer = 44;
      d.magnet.materialId = 'ferrite-y35'; d.magnet.diameter = 220; d.magnet.innerDiameter = 82; d.magnet.thickness = 30; d.magnet.poleDiameter = 78.5; d.magnet.topPlateThickness = 11; d.magnet.topPlateDiameter = 210; d.magnet.backPlateDiameter = 220; d.magnet.backPlateThickness = 16; d.magnet.gapWidth = 1.4; d.magnet.leakageFactor = 1.8;
      d.frame.depth = 170;
      d.qmsTarget = 6.5;
      d.powerHandlingW = 800;
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
