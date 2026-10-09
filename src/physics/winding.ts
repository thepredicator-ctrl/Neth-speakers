/*
 * Voice-coil winding calculator.
 *
 * Estimates wire length, DC resistance, winding height and mass from winding
 * geometry, wire diameter, material resistivity and temperature. These are
 * GEOMETRIC ESTIMATES: real coils have insulation build, bonding layers,
 * non-perfect packing and lead lengths — labeled as estimates in the UI.
 */
import type { VoiceCoilParams } from './types';
import type { MaterialDef } from './materials';
import { mm2m } from './units';

export interface WindingResult {
  pitch: number;              // m per turn incl. insulation allowance
  windingHeight: number;      // m (from turns × pitch unless user-overridden)
  totalTurns: number;
  wireLength: number;         // m
  meanWindingDiameter: number;// m (centre of winding stack)
  Re20: number;               // Ω at 20 °C
  Re: number;                 // Ω at coil.temperatureC
  wireMass: number;           // kg
  formerMass: number;         // kg
  coilMass: number;           // kg (wire + former)
  conductorArea: number;      // m²
  currentDensityAt1W: number; // A/mm² at 1 W into Re (readout aid)
  userWindingHeight: boolean;
}

export const INSULATION_FACTOR = 1.08; // dia. build allowance for single-build wire

export function computeWinding(c: VoiceCoilParams, mats: (id: string) => MaterialDef | undefined): WindingResult {
  const wire = mats(c.wireMaterialId);
  const former = mats(c.formerMaterialId);
  const rho = wire?.resistivity ?? 1.724e-8;
  const alpha = wire?.tempCo ?? 0.00393;
  const wireD = Math.max(0.02e-3, mm2m(c.wireDiameter));
  const dIns = wireD * INSULATION_FACTOR;
  const pitch = dIns;
  const layers = Math.max(1, Math.min(4, Math.round(c.layers)));
  const turnsPerLayer = Math.max(1, Math.round(c.turnsPerLayer));

  const windingHeightCalc = turnsPerLayer * pitch;
  const userH = c.windingHeight != null && c.windingHeight > 0;
  const windingHeight = userH ? mm2m(c.windingHeight as number) : windingHeightCalc;

  // Mean diameter per layer: first layer sits centred at windingDiameter,
  // each successive layer adds one wire diameter (centre-to-centre pitch).
  const d0 = mm2m(c.windingDiameter);
  let length = 0;
  let dSum = 0;
  for (let k = 0; k < layers; k++) {
    const dk = d0 + 2 * k * dIns * 0.5 * 2; // layer centres spaced by ~1 wire dia
    length += Math.PI * dk * turnsPerLayer;
    dSum += dk;
  }
  const meanD = dSum / layers;

  const area = (Math.PI / 4) * wireD * wireD;
  const Re20 = (rho * length) / area;
  const Re = Re20 * (1 + alpha * (c.temperatureC - 20));

  const wireMass = (wire?.density ?? 8960) * area * length;
  // Former tube mass: π·D_mean·h·t
  const fD = mm2m(c.formerDiameter);
  const fH = mm2m(c.formerHeight);
  const fT = Math.max(0.02e-3, mm2m(c.formerThickness));
  const formerMass = (former?.density ?? 1420) * Math.PI * (fD + fT) * fH * fT;

  const totalTurns = layers * turnsPerLayer;
  const iAt1W = Math.sqrt(1 / Math.max(Re, 0.01));

  return {
    pitch,
    windingHeight,
    totalTurns,
    wireLength: length,
    meanWindingDiameter: meanD,
    Re20,
    Re,
    wireMass,
    formerMass,
    coilMass: wireMass + formerMass,
    conductorArea: area,
    currentDensityAt1W: iAt1W / (area * 1e6),
    userWindingHeight: userH,
  };
}



