import { rng } from './rand';
import { E24 } from './circuit';

/**
 * An op-amp amplifier stage with a single-pole (dominant-pole) amplifier, as in Sedra and Smith, Microelectronic Circuits,
 * ch. 2 and 9. With feedback resistor Rf and ground/input resistor Rg:
 *   inverting       gain = −Rf/Rg
 *   non-inverting   gain = 1 + Rf/Rg
 * Negative feedback trades gain for bandwidth: the closed-loop −3 dB frequency is GBW / (noise gain), and the noise gain
 * (the gain seen from the non-inverting input, 1/β) is 1 + Rf/Rg for both stages. For the inverting stage that is 1 + |gain|.
 * The magnitude at frequency f is |gain| / √(1 + (f/f₃dB)²). The output cannot swing closer than 1.5 V to either supply
 * rail (a typical bipolar op-amp), so a larger signal is clipped flat at supply − 1.5 V.
 */

/** Resistor values on the dials: E24 from 1 kΩ to 910 kΩ, and 1 MΩ. */
export const R_DIAL: number[] = [...[1e3, 1e4, 1e5].flatMap((d) => E24.map((e) => Number((e * d).toPrecision(6)))), 1e6];

/** How far inside each supply rail the output can swing, V. */
export const HEADROOM = 1.5;

export type Mode = 'inverting' | 'non-inverting';

export interface OpampSpec {
  kind: 'opamp';
  mode: Mode;
  /** Peak input voltage, V. */
  vin: number;
  /** Input frequency, Hz. */
  f: number;
  /** Gain-bandwidth product, Hz. */
  gbw: number;
  /** Each supply rail is ±supply, V. */
  supply: number;
  /** Peak output wanted, V. */
  target: number;
  /** Fractional tolerance on the output peak. */
  tolerance: number;
}

export const closedLoopGain = (mode: Mode, rf: number, rg: number) => (mode === 'inverting' ? -rf / rg : 1 + rf / rg);

/** The −3 dB bandwidth for a closed-loop gain: GBW over the noise gain. A negative gain means an inverting stage, whose noise gain is 1 + |gain|. */
export const bandwidth = (gbw: number, gain: number) => gbw / (gain < 0 ? 1 + Math.abs(gain) : Math.abs(gain));

export const maxSwing = (spec: OpampSpec) => spec.supply - HEADROOM;

/** Peak output for a peak input `vin` at frequency `f`, after the single-pole roll-off and clipping at the rails. */
export function output(spec: OpampSpec, gain: number, vin: number, f: number): number {
  const bw = bandwidth(spec.gbw, gain);
  return Math.min(unclipped(gain, vin, f, bw), maxSwing(spec));
}
const unclipped = (gain: number, vin: number, f: number, bw: number) => (Math.abs(gain) * vin) / Math.sqrt(1 + (f / bw) ** 2);

export interface OpampEvaluation {
  solved: boolean;
  gain: number;
  bandwidth: number;
  /** What the output peak would be with no rails, V. */
  ideal: number;
  /** The real output peak, V. */
  amplitude: number;
  clipped: boolean;
  overBandwidth: boolean;
  /** (amplitude − target) / target. */
  error: number;
  /** Set when a resistor is not usable; the guess must not be counted. */
  refused?: string;
}

export function evaluate(spec: OpampSpec, rf: number, rg: number): OpampEvaluation {
  const none = { solved: false, gain: 0, bandwidth: 0, ideal: 0, amplitude: 0, clipped: false, overBandwidth: false, error: 0 };
  if (typeof rg !== 'number' || !Number.isFinite(rg) || rg <= 0) return { ...none, refused: 'The resistor to ground needs a positive value.' };
  if (typeof rf !== 'number' || !Number.isFinite(rf) || rf < 0) return { ...none, refused: 'The feedback resistor cannot be negative.' };
  const gain = closedLoopGain(spec.mode, rf, rg);
  const bw = bandwidth(spec.gbw, gain);
  const ideal = unclipped(gain, spec.vin, spec.f, bw);
  const amplitude = Math.min(ideal, maxSwing(spec));
  const clipped = ideal > maxSwing(spec), overBandwidth = spec.f > bw;
  const error = (amplitude - spec.target) / spec.target;
  return { solved: !clipped && !overBandwidth && Math.abs(error) <= spec.tolerance, gain, bandwidth: bw, ideal, amplitude, clipped, overBandwidth, error };
}

/** The answer shown after a failure: the pair that lands closest on the target among those that solve it. */
export function bestPair(spec: OpampSpec): [number, number] {
  let best: [number, number] = [R_DIAL[0], R_DIAL[0]], err = Infinity;
  for (const rf of R_DIAL) for (const rg of R_DIAL) {
    const e = evaluate(spec, rf, rg);
    if (e.solved && Math.abs(e.error) < err - 1e-12) { err = Math.abs(e.error); best = [rf, rg]; }
  }
  return best;
}

const sig = (x: number, d: number) => Number(x.toPrecision(d));

export function makeOpamp(seed: number): OpampSpec {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const nearest = (x: number) => R_DIAL.reduce((b, v) => (Math.abs(Math.log(v / x)) < Math.abs(Math.log(b / x)) ? v : b));
  for (let attempt = 0; attempt < 4000; attempt++) {
    const mode: Mode = r() < 0.5 ? 'inverting' : 'non-inverting';
    const supply = pick([9, 12, 15]);
    const gbw = pick([0.5, 1, 2, 3, 10]) * 1e6;
    const vin = pick([0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1]);
    const wanted = Math.exp(Math.log(1.5) + r() * (Math.log(150) - Math.log(1.5)));
    const rg = pick(R_DIAL);
    const rf = nearest(mode === 'inverting' ? rg * wanted : rg * (wanted - 1));
    const gain = closedLoopGain(mode, rf, rg);
    const bw = bandwidth(gbw, gain);
    const f = sig(bw * pick([0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7]), 2);
    if (f < 100 || f > 200_000) continue;
    const probe: OpampSpec = { kind: 'opamp', mode, vin, f, gbw, supply, target: 1, tolerance: 0.05 };
    const amp = unclipped(gain, vin, f, bw);
    const target = sig(amp, 2);
    if (target < 0.5 || target > 0.85 * maxSwing(probe) || f > bw) continue;
    const spec: OpampSpec = { ...probe, target };
    if (!evaluate(spec, rf, rg).solved || evaluate(spec, R_DIAL[0], R_DIAL[0]).solved) continue;
    return spec;
  }
  return { kind: 'opamp', mode: 'non-inverting', vin: 0.5, f: 10_000, gbw: 1e6, supply: 12, target: 5, tolerance: 0.05 };
}
