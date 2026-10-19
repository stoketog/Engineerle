import { rng } from './rand';
import { E24 } from './circuit';

/**
 * A first-order RC filter. With the output taken across the capacitor it is a low-pass; across the resistor, a high-pass.
 * With the cutoff fc = 1/(2πRC) and the ratio x = f/fc (Hambley, Electrical Engineering, ch. 6; Horowitz and Hill,
 * The Art of Electronics, ch. 1):
 *   low-pass   |H| = 1/√(1 + x²)       phase = −arctan x
 *   high-pass  |H| = x/√(1 + x²)       phase = +arctan(1/x)
 * and the step response of the capacitor voltage is 1 − e^(−t/RC).
 */

export const cutoff = (r: number, c: number) => 1 / (2 * Math.PI * r * c);
export const gainLow = (f: number, fc: number) => 1 / Math.sqrt(1 + (f / fc) ** 2);
export const gainHigh = (f: number, fc: number) => f / fc / Math.sqrt(1 + (f / fc) ** 2);
/** Degrees. */
export const phaseLow = (f: number, fc: number) => (-Math.atan(f / fc) * 180) / Math.PI;
export const phaseHigh = (f: number, fc: number) => (Math.atan(fc / f) * 180) / Math.PI;
export const toDb = (gain: number) => 20 * Math.log10(gain);
export const stepResponse = (r: number, c: number, t: number) => 1 - Math.exp(-t / (r * c));

/** E24 resistors from 100 Ω to 910 kΩ, and 1 MΩ. */
export const R_VALUES: number[] = [...[100, 1e3, 1e4, 1e5].flatMap((d) => E24.map((e) => Number((e * d).toPrecision(6)))), 1e6];
/** Capacitors from 1 nF to 10 µF in a 1 / 2.2 / 4.7 series. */
export const C_VALUES: number[] = [...[1e-9, 1e-8, 1e-7, 1e-6].flatMap((d) => [1, 2.2, 4.7].map((e) => Number((e * d).toPrecision(6)))), 10e-6];

export interface FilterSpec {
  kind: 'rcfilter';
  type: 'low' | 'high';
  /** The tone to keep, Hz. */
  fSignal: number;
  /** The interference to remove, Hz. */
  fNoise: number;
  /** The most the signal may be reduced by, dB. */
  maxLossDb: number;
  /** The least the noise must be reduced by, dB. */
  minCutDb: number;
}

export interface FilterEvaluation {
  solved: boolean;
  fc: number;
  /** Gain at the signal frequency, dB (zero or negative). */
  signalDb: number;
  /** Gain at the noise frequency, dB (zero or negative). */
  noiseDb: number;
  /** Set when R or C is not a usable component; the guess must not be counted. */
  refused?: string;
}

const gainOf = (type: FilterSpec['type']) => (type === 'low' ? gainLow : gainHigh);

export function evaluate(spec: FilterSpec, r: number, c: number): FilterEvaluation {
  if (![r, c].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) return { solved: false, fc: 0, signalDb: 0, noiseDb: 0, refused: 'A resistor and a capacitor both need a positive value.' };
  const fc = cutoff(r, c), g = gainOf(spec.type);
  const signalDb = toDb(g(spec.fSignal, fc)), noiseDb = toDb(g(spec.fNoise, fc));
  return { solved: -signalDb <= spec.maxLossDb && -noiseDb >= spec.minCutDb, fc, signalDb, noiseDb };
}

/** The dial setting with the most room on both limits: the answer shown when the player runs out of guesses. */
export function bestPair(spec: FilterSpec): [number, number] {
  let best: [number, number] = [R_VALUES[0], C_VALUES[0]], room = -Infinity;
  for (const r of R_VALUES) for (const c of C_VALUES) {
    const e = evaluate(spec, r, c);
    const margin = Math.min(spec.maxLossDb + e.signalDb, -e.noiseDb - spec.minCutDb);
    if (margin > room + 1e-9) { room = margin; best = [r, c]; }
  }
  return best;
}

export function makeFilter(seed: number): FilterSpec {
  const rand = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const pairs = R_VALUES.flatMap((r) => C_VALUES.map((c) => [r, c] as const));
  for (let attempt = 0; attempt < 4000; attempt++) {
    const type: FilterSpec['type'] = rand() < 0.5 ? 'low' : 'high';
    let fSignal: number, fNoise: number;
    if (type === 'low') { fSignal = pick([100, 200, 250, 300, 400, 500, 800, 1000, 1500, 2000, 3000, 5000]); fNoise = fSignal * pick([8, 10, 12, 15, 20, 25, 30]); }
    else { fNoise = pick([50, 60, 100, 120, 400]); fSignal = fNoise * pick([8, 10, 15, 20, 25, 40]); }
    const spec: FilterSpec = { kind: 'rcfilter', type, fSignal, fNoise, maxLossDb: pick([1, 2, 3]), minCutDb: pick([12, 15, 20, 26, 30]) };
    let solvable = false, clear = true;
    for (const [r, c] of pairs) {
      const e = evaluate(spec, r, c);
      if (Math.abs(-e.signalDb - spec.maxLossDb) <= 0.02 || Math.abs(-e.noiseDb - spec.minCutDb) <= 0.02) { clear = false; break; }
      if (e.solved) solvable = true;
    }
    if (clear && solvable && !evaluate(spec, R_VALUES[0], C_VALUES[0]).solved) return spec;
  }
  return { kind: 'rcfilter', type: 'low', fSignal: 1000, fNoise: 20_000, maxLossDb: 1, minCutDb: 12 };
}
