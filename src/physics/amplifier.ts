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
