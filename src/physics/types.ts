/*
 * Neth Speakers — core physical types.
 * All SI units internally (m, kg, s, N, V, A, T). UI units converted at the edge.
 */

export type ValueSource = 'calculated' | 'user';

/** A parameter that the user may override; null/undefined = use calculated estimate. */
export type Overridable = number | null;

export interface ConeParams {
  outerDiameter: number;      // mm — cone body outer diameter at surround seat
  effectiveDiameter: number;  // mm — effective radiating diameter (drives Sd)
  depth: number;              // mm — axial depth from surround seat to voice-coil junction
  angleDeg: number;           // deg — included side angle (derived from depth; edit re-syncs depth)
  thickness: number;          // mm
  materialId: string;
  mass: Overridable;          // g — null = calculate from geometry × material density
  profile: 'straight' | 'curved' | 'ribbed';
  dustCapDiameter: number;    // mm
  dustCapShape: 'dome' | 'flat' | 'inverted';
  dustCapMaterialId: string;
  dustCapMass: Overridable;   // g
  color: string;              // hex, 3D model
  finish: 'matte' | 'satin' | 'gloss';
}

export interface SurroundParams {
  innerDiameter: number;   // mm — attaches to cone edge (auto-tracked to cone)
  outerDiameter: number;   // mm — attaches to frame seat (auto: inner + 2×rollWidth)
  rollCount: number;       // 1 = half-roll, 2 = double roll
  rollHeight: number;      // mm — radial half-width of the roll arc
  rollWidth: number;       // mm — lateral (axial) width of surround
  materialId: string;
  thickness: number;       // mm
  stiffness: number;       // N/m — effective axial stiffness contribution
  damping: number;         // N·s/m — mechanical resistance contribution
  color: string;           // hex, 3D model
}

export interface SpiderParams {
  innerDiameter: number;   // mm — bonded to voice-coil former (auto-tracked)
  outerDiameter: number;   // mm — bonded to basket shelf
  corrugations: number;    // count
  corrDepth: number;       // mm — corrugation depth (sets long-throw capability)
  materialId: string;
  thickness: number;       // mm
  stiffness: number;       // N/m — primary compliance source
  damping: number;         // N·s/m
  color: string;           // hex, 3D model
}

export interface VoiceCoilParams {
  windingDiameter: number;    // mm — mean winding diameter (centre of 1st layer approx)
  formerDiameter: number;     // mm — former inner diameter
  formerHeight: number;       // mm
  formerMaterialId: string;
  formerThickness: number;    // mm
  wireDiameter: number;       // mm — bare conductor
  wireMaterialId: string;
  layers: number;             // 1..4
  turnsPerLayer: number;
  windingHeight: Overridable; // mm — null = turnsPerLayer × pitch
  temperatureC: number;       // °C — resistance temperature
  config: 'overhung' | 'underhung';
  position: number;           // mm — winding centre offset from gap centre (+ = toward front)
  mass: Overridable;          // g — null = wire + former estimate
  re: Overridable;            // Ω — null = from winding geometry
  le: Overridable;            // mH — null = estimate from gap geometry
}

export interface MagnetParams {
  materialId: string;        // ferrite / neodymium / custom (from materials DB)
  count: number;             // stacked magnets
  diameter: number;          // mm — ring OD
  innerDiameter: number;     // mm — ring ID
  thickness: number;         // mm — each
  poleDiameter: number;      // mm — centre pole OD
  topPlateDiameter: number;  // mm — top plate OD
  topPlateThickness: number; // mm — defines magnetic gap height
  backPlateDiameter: number; // mm
  backPlateThickness: number;// mm
  gapWidth: number;          // mm — radial gap (top-plate ID − pole OD) / 2
  leakageFactor: number;     // σ ≥ 1 — magnetic-circuit leakage (1 = ideal)
  bl: Overridable;           // T·m — null = magnetic-circuit estimate
  bGap: Overridable;         // T — null = estimate
  painted: boolean;          // black-painted plates/pole in 3D model
}

export interface FrameParams {
  depth: number;          // mm — overall frame depth (front flange → rear)
  gasketThickness: number;// mm
  terminals: 'push' | 'solder' | 'spring';
  tinselLeads: number;    // count
  mountingHoles: number;
  materialId: string;
  color: string;          // hex, 3D model
  style: 'stamped' | 'diecast';  // basket visual style
  gasket: boolean;        // show gasket ring
  boot: boolean | null;   // motor boot (rubber cover); null = auto (subwoofer class)
}

export interface DriverParams {
  cone: ConeParams;
  surround: SurroundParams;
  spider: SpiderParams;
  coil: VoiceCoilParams;
  magnet: MagnetParams;
  frame: FrameParams;

  /** Suspension nonlinearity (Advanced mode): BL droop fraction at Xmech. */
  blDropAtXmech: number;      // 0..0.9
  /** Suspension stiffening fraction at Xmax (Kms(x) = Kms0·(1+k·(x/Xmax)²)). */
  kmsRiseAtXmax: number;      // 0..3

  /** User overrides for derived parameters (null = use calculated estimate). */
  rmsOverride: Overridable;   // N·s/m mechanical resistance
  qmsTarget: number;          // used to derive default Rms when no override
  xmechOverride: Overridable; // mm
  xmaxOverride: Overridable;  // mm
  vasOverride: Overridable;   // litres
  powerHandlingW: number;     // W — continuous thermal (voice-coil) power rating
}

export interface EnclosurePort {
  shape: 'round' | 'slot';
  diameter: number;   // mm (round)
  length: number;     // mm
  count: number;
  flared: boolean;
  slotWidth: number;  // mm (slot)
  slotHeight: number; // mm
}

export interface EnclosurePassiveRadiator {
  enabled: boolean;
  diameter: number;   // mm — effective radiating diameter
  mass: number;       // g — moving mass
  suspensionStiffness: number; // N/m
  damping: number;    // N·s/m
}

export type DampingMaterial = 'none' | 'lightFill' | 'lined' | 'heavyFill';

export interface EnclosureParams {
  type: 'sealed' | 'ported' | 'passiveRadiator';
  internalWidth: number;   // mm
  internalHeight: number;  // mm
  internalDepth: number;   // mm
  wallThickness: number;   // mm
  wallMaterialId: string;
  bracingVolume: number;   // litres displaced by braces
  damping: DampingMaterial;
  port: EnclosurePort;
  passive: EnclosurePassiveRadiator;
  driverCount: number;     // identical drivers
  wiring: 'parallel' | 'series';      // between drivers
  coilWiring: 'parallel' | 'series';  // for dual voice coils
  driverMount: 'flush' | 'surface';
  finishColor: string;                 // cabinet finish (hex, 3D)
  grille: { enabled: boolean; color: string };  // front grille visual
}

export interface AmplifierParams {
  driveMode: 'voltage' | 'power';
  voltageRms: number;      // V — terminal RMS voltage (per driver-equivalent)
  powerW: number;          // W — nominal power into computed load
  clipEnabled: boolean;
  clipVoltageRms: number;  // V
  currentLimitA: number;   // A — 0 = unlimited
  outputImpedance: number; // Ω (source impedance)
  bridged: boolean;        // bridged pair → 2× voltage swing
}

export interface AudioSettings {
  channel: 'L' | 'R' | 'sum';
  band: 'full' | 'bass' | 'mid' | 'treble'; // frequency-selective simulation
  vizMode: 'physical' | 'enhanced';
  vizMultiplier: number;   // enhanced-mode display multiplier (actual value always shown)
  volume: number;          // 0..1
  acousticOutput: boolean; // hear modeled acoustic output instead of input
}

export interface SimSettings {
  mode: 'idealized' | 'thieleSmall' | 'dynamic' | 'advanced';
  speed: number;           // playback rate for slow motion
  running: boolean;
  paused: boolean;
  /** Solver effort for the real-time model: Precision = 8 substeps, Balanced = 4, Fast = 2. */
  quality: 'precision' | 'balanced' | 'fast';
  /** Display-only exponential smoothing of rendered displacement (0 = none). */
  vizSmoothing: number;
}

/** Completely computed Thiele–Small parameter set (SI units). */
export interface TSParams {
  Sd: number;      // m² effective piston area
  Mms: number;     // kg total moving mass
  Cms: number;     // m/N suspension compliance
  Kms: number;     // N/m suspension stiffness
  Rms: number;     // N·s/m mechanical resistance
  Bl: number;      // T·m force factor
  Re: number;      // Ω voice-coil DC resistance
  Le: number;      // H voice-coil inductance
  Bgap: number;    // T gap flux density
  Fs: number;      // Hz free-air resonance
  Qms: number;
  Qes: number;
  Qts: number;
  Vas: number;     // L equivalent compliance volume
  Xmax: number;    // mm one-way linear excursion
  Xmech: number;   // mm one-way mechanical limit
  XmaxPP: number;  // mm peak-to-peak linear travel == 2·Xmax
  Vd: number;      // m³ displacement volume == Sd × Xmax (ONE-WAY convention)
  windH: number;   // mm winding height
  gapH: number;    // mm magnetic gap height
  coilOverhang: number; // mm (windH − gapH)/2 — negative = underhung
  maxExcDown: number;   // mm geometric excursion capability downward
  maxExcUp: number;     // mm geometric excursion capability upward
  eta0: number;    // reference efficiency (0..1)
  sens: number;    // dB SPL @ 2.83V/1m (half-space piston estimate)
  wireLength: number;  // m total wire length
  turnsTotal: number;
  turnsInGap: number;
  airLoadMass: number; // kg radiation mass estimate
  mmsParts: {
    cone: number; dustCap: number; coil: number; surround: number; spider: number; air: number;
  }; // kg
}

export interface MaterialDef {
  id: string;
  name: string;
  category: 'cone' | 'surround' | 'spider' | 'wire' | 'magnet' | 'former' | 'frame' | 'enclosure' | 'custom';
  density: number;        // kg/m³
  youngs?: number;        // Pa (indicative)
  lossFactor?: number;    // damping loss factor (indicative)
  resistivity?: number;   // Ω·m (wires)
  tempCo?: number;        // 1/K (wires)
  br?: number;            // T remanence (magnets)
  muR?: number;           // relative recoil permeability (magnets)
  notes: string;
  color?: string;         // hex for 3D
  illustrative: boolean;  // true = typical literature value, not verified for a specific grade
}
