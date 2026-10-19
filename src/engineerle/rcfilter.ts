import { rng } from './rand';
import { E24 } from './circuit';

/**
 * Puzzle: the RC filter.
 *
 * A first-order RC network, driven through R with the output across C (low-pass) or across R (high-pass), has
 *     fc = 1 / (2π R C)
 *     |H_low|  = 1 / √(1 + (f/fc)²)           phase = −atan(f/fc)
 *     |H_high| = (f/fc) / √(1 + (f/fc)²)      phase = +atan(fc/f)
 * and a step response 1 − e^(−t/RC). Choose R and C so a wanted tone passes with little loss while a noise tone
 * is knocked down by enough decibels. Verified in tests against an RK4 time-domain simulation of dv/dt = (vin − v)/RC.
 */

export const R_VALUES: number[] = (() => {
  const out: number[] = [];
  for (let d = 2; d <= 5; d++) for (const v of E24) out.push(Math.round(v * 10 ** d * 1000) / 1000);
  out.push(1_000_000);
  return out;
})();
/** 1 nF to 10 µF in the E6 series. */
export const C_VALUES = [1e-9, 2.2e-9, 4.7e-9, 10e-9, 22e-9, 47e-9, 100e-9, 220e-9, 470e-9, 1e-6, 2.2e-6, 4.7e-6, 10e-6];
export const MAX_R = 10_000_000;
export const MAX_C = 1e-3;

export const cutoff = (r: number, c: number) => 1 / (2 * Math.PI * r * c);
export const gainLow = (f: number, fc: number) => 1 / Math.sqrt(1 + (f / fc) ** 2);
export const gainHigh = (f: number, fc: number) => (f / fc) / Math.sqrt(1 + (f / fc) ** 2);
export const phaseLow = (f: number, fc: number) => -(Math.atan(f / fc) * 180) / Math.PI;
export const phaseHigh = (f: number, fc: number) => (Math.atan(fc / f) * 180) / Math.PI;
export const stepResponse = (r: number, c: number, t: number) => 1 - Math.exp(-t / (r * c));
export const dB = (gain: number) => 20 * Math.log10(gain);

export interface FilterSpec {
  kind: 'rcfilter';
  /** Low-pass keeps the wanted tone below the noise; high-pass keeps it above. */
  type: 'low' | 'high';
  fWanted: number;
  fNoise: number;
  /** The wanted tone may lose at most this many dB. */
  maxPassLossDb: number;
  /** The noise tone must be down at least this many dB. */
  minNoiseAttenDb: number;
}

export interface Response {
  fc: number;
  gainWanted: number;
  gainNoise: number;
  phaseWanted: number;
  phaseNoise: number;
}

export function response(spec: FilterSpec, r: number, c: number): Response {
  const fc = cutoff(r, c);
  const g = spec.type === 'low' ? gainLow : gainHigh;
  const ph = spec.type === 'low' ? phaseLow : phaseHigh;
  return { fc, gainWanted: g(spec.fWanted, fc), gainNoise: g(spec.fNoise, fc), phaseWanted: ph(spec.fWanted, fc), phaseNoise: ph(spec.fNoise, fc) };
}

export interface Evaluation {
  solved: boolean;
  fc?: number;
  /** Loss of the wanted tone and attenuation of the noise, both in positive dB. */
  wantedLossDb?: number;
  noiseAttenDb?: number;
  /** Set when R or C cannot be built: nothing was tested, so it is not a guess. */
  refused?: string;
}

export function evaluate(spec: FilterSpec, r: number, c: number): Evaluation {
  const bad = (v: number, max: number) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > max;
  if (bad(r, MAX_R) || bad(c, MAX_C)) return { solved: false, refused: 'Choose a resistance up to 10 MΩ and a capacitance up to 1 mF, both above zero.' };
  const h = response(spec, r, c);
  const wantedLossDb = -dB(h.gainWanted), noiseAttenDb = -dB(h.gainNoise);
  return { solved: wantedLossDb <= spec.maxPassLossDb + 1e-9 && noiseAttenDb >= spec.minNoiseAttenDb - 1e-9, fc: h.fc, wantedLossDb, noiseAttenDb };
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export function makeFilter(seed: number): FilterSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 500; tries++) {
    const type: 'low' | 'high' = r() < 0.5 ? 'low' : 'high';
    const factor = pick(r, [8, 10, 16, 20, 25, 32, 40]);
    let fWanted: number, fNoise: number;
    if (type === 'low') {
      fWanted = pick(r, [100, 200, 300, 500, 1000, 2000, 3000, 5000, 10_000]);
      fNoise = fWanted * factor;
    } else {
      fNoise = pick(r, [50, 60, 100, 120, 200, 500]);
      fWanted = fNoise * factor;
    }
    if (Math.max(fWanted, fNoise) > 50_000) continue;
    const spec: FilterSpec = { kind: 'rcfilter', type, fWanted, fNoise, maxPassLossDb: pick(r, [1, 2, 3]), minNoiseAttenDb: pick(r, [14, 20, 26, 30]) };
    let n = 0, lo = Infinity, hi = 0;
    for (const rv of R_VALUES) for (const cv of C_VALUES) if (evaluate(spec, rv, cv).solved) { n++; const fc = cutoff(rv, cv); lo = Math.min(lo, fc); hi = Math.max(hi, fc); }
    if (n < 3 || hi / lo < 1.2) continue;
    if (evaluate(spec, R_VALUES[0], C_VALUES[0]).solved) continue;
    return spec;
  }
  return { kind: 'rcfilter', type: 'low', fWanted: 1000, fNoise: 20_000, maxPassLossDb: 3, minNoiseAttenDb: 20 };
}
