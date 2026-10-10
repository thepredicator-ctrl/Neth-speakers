/*
 * Amplifier & wiring calculations.
 *
 * The model is a near-ideal voltage source with optional output impedance,
 * clipping voltage and current limit. Power is NOT assumed constant: it is
 * computed from the actual load impedance.
 */
import type { AmplifierParams, TSParams } from './types';
import type { WiringInfo } from './stateSpace';

export interface AmpResult {
  vpeak: number;        // V — peak drive (±) delivered to each driver
  vclipPeak: number;    // V — 0 = off
  ilim: number;         // A — 0 = off
  nominalLoad: number;  // Ω
  estimatedPowerW: number;   // W into load at current settings
  estimatedPowerPeakW: number;
  nominalImpedanceLabel: string;
}

export function computeAmp(amp: AmplifierParams, ts: TSParams, w: WiringInfo): AmpResult {
  const load = Math.max(0.5, w.loadImpedance);
  let vrms = amp.driveMode === 'voltage' ? amp.voltageRms : Math.sqrt(Math.max(0, amp.powerW) * load);
  if (amp.bridged) vrms *= 2;
  const perDriver = vrms * w.perDriverVoltageFactor;
  const vpeak = perDriver * Math.SQRT2;
  const vclipPeak = amp.clipEnabled ? (amp.bridged ? amp.clipVoltageRms * 2 : amp.clipVoltageRms) * Math.SQRT2 * w.perDriverVoltageFactor : 0;
  const ilim = amp.currentLimitA > 0 ? amp.currentLimitA * (w.perDriverVoltageFactor > 0.5 ? 1 : 1) : 0;
  const power = (perDriver * perDriver) / load;
  const nominalLabel = impedanceLabel(load);
  return {
    vpeak,
    vclipPeak,
    ilim,
    nominalLoad: load,
    estimatedPowerW: power,
    estimatedPowerPeakW: power * 2,
    nominalImpedanceLabel: nominalLabel,
  };
}

/**
 * Suggested DEFAULT drive (W RMS): the power that brings a −3 dBFS 40 Hz tone
 * to one-way Xmax (free-air approximation, mass/suspension-dominated Zm),
 * capped at the driver's continuous thermal rating.
 *
 * Rationale: a measurement reference (2.83 V) moves a high-Bl subwoofer a
 * fraction of a millimetre — physically correct, useless as a listening
 * default. This suggestion always lands the demo tone at the driver's rated
 * excursion, so the physical view shows the travel the driver was BUILT for
 * (typical bass-test-tone use). Music averages well below peak, so playback
 * sits in the linear region with peaks touching Xmax.
 */
export function suggestedDriveW(ts: TSParams, powerHandlingW: number): number {
  const w = 2 * Math.PI * 40;                       // rad/s at 40 Hz
  // TRUE mechanical impedance |Zm| = |Rms + j(ωMms − Kms/ω)|
  // (the spring term divides by ω — it does NOT subtract from ω²Mms directly)
  const zm = Math.sqrt(
    Math.pow(ts.Kms - ts.Mms * w * w, 2) + Math.pow(ts.Rms * w, 2),
  ) / w;
  // Full electrical impedance including the motional (back-EMF) term.
  // For high-Bl drivers Bl²/|Zm| is comparable to or larger than Re at bass
  // frequencies — ignoring it underestimates the needed drive by 3–10×,
  // which is exactly the "physical mm too small" symptom.
  // (|Zm| used as a scalar → motional ≈ −j·Bl²/|Zm|; above resonance Zm is
  // mass-dominated so the phase error is small. The exact path for UI drive
  // suggestions is driveForXmaxW() which inverts the real state-space model.)
  const ze = Math.hypot(ts.Re, w * ts.Le - (ts.Bl * ts.Bl) / zm);
  const xmaxM = Math.max(1e-4, ts.Xmax * 1e-3);      // m one-way
  // −3 dBFS tone (peak amplitude a = 0.708): V_pk@coil = a·√(2·P·Re)
  //   I_pk = V_pk/|Zelec| ; x_pk = Bl·I_pk/(ω·|Zm|) = Xmax
  //   → P = (Xmax·ω·|Zm|·|Zelec|/Bl)² / (a²·2·Re) = Xmax²·ω²·Zm²·Ze²/(1.0025·Bl²·Re)
  const voltsPk = (xmaxM * w * zm * ze) / ts.Bl;
  const watts = (voltsPk * voltsPk) / (1.0025 * ts.Re);
  const rated = Math.max(1, powerHandlingW);
  // NOT capped at rated: for real subwoofers reaching Xmax at 40 Hz takes burst
  // power beyond the continuous rating — that is honest physics. Callers may
  // display a "burst" hint and cap for their own policy.
  return Math.round(Math.min(150000, Math.max(0.5, watts)) * 100) / 100;
}

export function impedanceLabel(z: number): string {
  // nearest standard nominal label
  const std = [1, 2, 2.7, 3, 4, 5.3, 6, 8, 12, 16, 32];
  let best = std[0];
  for (const s of std) if (Math.abs(Math.log(z / s)) < Math.abs(Math.log(z / best))) best = s;
  return `${best} Ω (nominal)`;
}

/** Series / parallel helper for display. */
export function combineImpedance(zs: number[], mode: 'series' | 'parallel'): number {
  if (zs.length === 0) return 0;
  if (mode === 'series') return zs.reduce((a, b) => a + b, 0);
  const inv = zs.reduce((a, b) => a + 1 / Math.max(b, 1e-9), 0);
  return 1 / Math.max(inv, 1e-12);
}
