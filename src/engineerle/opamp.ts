import { rng } from './rand';
import { E24 } from './circuit';

/**
 * Puzzle: the op-amp amplifier.
 *
 * With negative feedback and a high open-loop gain the ideal closed-loop gains are (Horowitz and Hill, The Art of
 * Electronics, ch. 4; Sedra and Smith, Microelectronic Circuits, ch. 2):
 *     inverting      Av = −Rf / Rg
 *     non-inverting  Av = 1 + Rf / Rg
 * The op-amp is a single-pole amplifier with a gain-bandwidth product GBW, so the closed-loop bandwidth is
 *     f_BW = GBW / (noise gain),   noise gain = 1 + Rf/Rg   (non-inverting: = |Av|;  inverting: = 1 + |Av|)
 * and a sine of frequency f comes out with magnitude |Av|·Vin / √(1 + (f/f_BW)²), lagging atan(f/f_BW)
 * (the inverting amplifier adds its 180°). The output cannot swing all the way to the supply: a general-purpose
 * op-amp loses about 1.5 V to each rail, so the peak is clipped at (Vsupply − 1.5) V and the top of the sine is cut flat.
 */

export const RF_VALUES: number[] = [1e3, 1e4, 1e5].flatMap((d) => E24.map((v) => Math.round(v * d)));
export const RG_VALUES: number[] = [1e2, 1e3, 1e4].flatMap((d) => E24.map((v) => Math.round(v * d)));
export const MAX_OHMS = 10_000_000;
/** Volts lost between the supply rail and the clipped peak of the output. */
export const HEADROOM = 1.5;

export type Mode = 'inverting' | 'non-inverting';

export const closedLoopGain = (mode: Mode, rf: number, rg: number) => (mode === 'inverting' ? -rf / rg : 1 + rf / rg);

/** Closed-loop −3 dB bandwidth. Pass the signal gain `gain` and the mode; the inverting amplifier's noise gain is 1 + |gain|. */
export const bandwidth = (gbw: number, gain: number, mode: Mode = 'non-inverting') => gbw / (mode === 'inverting' ? 1 + Math.abs(gain) : Math.abs(gain));

export const clipLimit = (supply: number) => supply - HEADROOM;

export interface OpampSpec {
  kind: 'opamp';
  mode: Mode;
  /** Peak input amplitude (V) and frequency (Hz). */
  vin: number;
  f: number;
  /** Gain-bandwidth product (Hz). */
  gbw: number;
  /** Each supply rail, ±V. */
  supply: number;
  /** Required peak output amplitude (V), within `tolerance` (a fraction). */
  target: number;
  tolerance: number;
}

/** The sine's peak amplitude if the output could swing without limit. */
export function linearOutput(spec: OpampSpec, gain: number, vin: number, f: number): number {
  const bw = bandwidth(spec.gbw, gain, spec.mode);
  return (Math.abs(gain) * vin) / Math.sqrt(1 + (f / bw) ** 2);
}
/** Peak output amplitude after the rails have had their say. */
export const output = (spec: OpampSpec, gain: number, vin: number, f: number) => Math.min(linearOutput(spec, gain, vin, f), clipLimit(spec.supply));

/** Output phase relative to the input, degrees. */
export function phaseDeg(mode: Mode, gbw: number, gain: number, f: number): number {
  const lag = (Math.atan(f / bandwidth(gbw, gain, mode)) * 180) / Math.PI;
  return mode === 'inverting' ? 180 - lag : -lag;
}

export interface Evaluation {
  solved: boolean;
  gain?: number;
  bw?: number;
  /** Peak output after clipping, and whether it was clipped. */
  vout?: number;
  clipped?: boolean;
  /** The signal is inside the closed-loop bandwidth. */
  bwOk?: boolean;
  refused?: string;
}

export function evaluate(spec: OpampSpec, rf: number, rg: number): Evaluation {
  const bad = (v: number) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_OHMS;
  if (bad(rf) || bad(rg)) return { solved: false, refused: 'Choose resistors above zero and up to 10 MΩ.' };
  const gain = closedLoopGain(spec.mode, rf, rg);
  const bw = bandwidth(spec.gbw, gain, spec.mode);
  const lin = linearOutput(spec, gain, spec.vin, spec.f);
  const clipped = lin > clipLimit(spec.supply);
  const vout = Math.min(lin, clipLimit(spec.supply));
  const bwOk = spec.f <= bw;
  const onTarget = Math.abs(vout - spec.target) <= spec.tolerance * spec.target + 1e-12;
  return { solved: !clipped && bwOk && onTarget, gain, bw, vout, clipped, bwOk };
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const sig3 = (x: number) => Number(x.toPrecision(3));

export function makeOpamp(seed: number): OpampSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 800; tries++) {
    const mode: Mode = r() < 0.5 ? 'inverting' : 'non-inverting';
    const gbw = pick(r, [1e6, 3e6, 10e6]);
    const supply = pick(r, [12, 15]);
    const f = pick(r, [500, 1000, 2000, 5000, 10_000, 20_000, 50_000]);
    const vin = pick(r, [0.02, 0.05, 0.1, 0.2, 0.25, 0.5]);
    const rf = pick(r, RF_VALUES), rg = pick(r, RG_VALUES);
    const base: OpampSpec = { kind: 'opamp', mode, vin, f, gbw, supply, target: 0, tolerance: 0.05 };
    const gain = closedLoopGain(mode, rf, rg);
    if (Math.abs(gain) < 2 || Math.abs(gain) > 60) continue;
    if (f > 0.6 * bandwidth(gbw, gain, mode)) continue; // a real roll-off, but not past the knee
    const out = linearOutput(base, gain, vin, f);
    if (out < 0.4 || out > 0.85 * clipLimit(supply)) continue;
    const spec = { ...base, target: sig3(out) };
    if (evaluate(spec, rf, rg).solved === false) continue;
    let n = 0;
    for (const a of RF_VALUES) for (const b of RG_VALUES) if (evaluate(spec, a, b).solved) n++;
    if (n < 3 || evaluate(spec, RF_VALUES[0], RG_VALUES[0]).solved) continue;
    return spec;
  }
  return { kind: 'opamp', mode: 'non-inverting', vin: 0.2, f: 1000, gbw: 1e6, supply: 12, target: 2.2, tolerance: 0.05 };
}
