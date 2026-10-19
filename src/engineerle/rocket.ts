import { rng } from './rand';

/**
 * Puzzle: rocket staging.
 *
 * The Tsiolkovsky rocket equation (Sutton and Biblarz, Rocket Propulsion Elements, eq. 4-19; Wertz and Larson, SMAD):
 *     Δv = Isp · g0 · ln(m0 / mf),    g0 = 9.80665 m/s²
 * For two stages in series, stage 1 burns with the whole upper stage and payload on top of it, is dropped, and then
 * stage 2 burns on its own. The structure of a stage is taken as a fixed fraction σ of that stage's propellant
 * (so the structural coefficient ε = σ / (1 + σ) is about 0.07 to 0.10, in the range of real stages). With P the
 * total propellant and `split` the fraction put in stage 1:
 *     m0₁ = payload + (1+σ₂)·(1−split)·P + (1+σ₁)·split·P      mf₁ = m0₁ − split·P
 *     m0₂ = payload + (1+σ₂)·(1−split)·P                       mf₂ = payload + σ₂·(1−split)·P
 *     Δv  = Isp₁ g0 ln(m0₁/mf₁) + Isp₂ g0 ln(m0₂/mf₂)
 * For identical stages the optimum has equal stage mass ratios, which puts split* = 1 / (1 + √(payload / M0)) with
 * M0 = payload + (1+σ)·P (checked in the tests). The required Δv of 9.3 to 9.6 km/s is low-Earth orbit's ≈7.8 km/s
 * plus the usual allowance for gravity and drag losses.
 */

export const G0 = 9.80665;

export const deltaV = (isp: number, m0: number, mf: number) => isp * G0 * Math.log(m0 / mf);

export interface RocketSpec {
  kind: 'rocket';
  /** Total propellant, both stages (kg). */
  propellant: number;
  /** Structural mass of each stage as a fraction of that stage's propellant. */
  sigma1: number;
  sigma2: number;
  isp1: number;
  isp2: number;
  payload: number;
  /** Δv to reach orbit including gravity and drag losses (m/s). */
  required: number;
}

export interface Breakdown { m0_1: number; mf_1: number; m0_2: number; mf_2: number; dv1: number; dv2: number }

export function stageBreakdown(spec: RocketSpec, split: number): Breakdown {
  const p1 = split * spec.propellant, p2 = (1 - split) * spec.propellant;
  const m0_2 = spec.payload + (1 + spec.sigma2) * p2;
  const mf_2 = spec.payload + spec.sigma2 * p2;
  const m0_1 = m0_2 + (1 + spec.sigma1) * p1;
  const mf_1 = m0_1 - p1;
  return { m0_1, mf_1, m0_2, mf_2, dv1: deltaV(spec.isp1, m0_1, mf_1), dv2: deltaV(spec.isp2, m0_2, mf_2) };
}

export function twoStageDeltaV(spec: RocketSpec, split: number): number {
  const b = stageBreakdown(spec, split);
  return b.dv1 + b.dv2;
}

export function bestSplit(spec: RocketSpec): { split: number; dv: number } {
  let split = 0, dv = -Infinity;
  for (let i = 0; i <= 1000; i++) {
    const v = twoStageDeltaV(spec, i / 1000);
    if (v > dv) { dv = v; split = i / 1000; }
  }
  return { split, dv };
}

export interface Evaluation {
  solved: boolean;
  dv?: number;
  /** m/s still missing (0 when orbit is reached). */
  shortfall?: number;
  breakdown?: Breakdown;
  refused?: string;
}

export function evaluate(spec: RocketSpec, split: number): Evaluation {
  if (typeof split !== 'number' || !Number.isFinite(split) || split < 0 || split > 1) return { solved: false, refused: 'Put between none and all of the propellant in the first stage.' };
  const breakdown = stageBreakdown(spec, split);
  const dv = breakdown.dv1 + breakdown.dv2;
  return { solved: dv >= spec.required, dv, shortfall: Math.max(0, spec.required - dv), breakdown };
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export function makeRocket(seed: number): RocketSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 200; tries++) {
    const base: RocketSpec = {
      kind: 'rocket',
      propellant: pick(r, [80_000, 120_000, 160_000, 200_000, 300_000, 400_000, 500_000]),
      sigma1: 0.08 + 0.005 * Math.floor(r() * 9),
      sigma2: 0.08 + 0.005 * Math.floor(r() * 9),
      isp1: 280 + 5 * Math.floor(r() * 13),
      isp2: 330 + 5 * Math.floor(r() * 27),
      payload: 1,
      required: 9300 + 50 * Math.floor(r() * 7),
    };
    base.sigma1 = Number(base.sigma1.toFixed(3)); base.sigma2 = Number(base.sigma2.toFixed(3));
    const margin = pick(r, [60, 100, 150, 200]);
    // the heaviest payload whose best split still clears the requirement by `margin`
    let lo = 1, hi = base.propellant / 5;
    if (bestSplit({ ...base, payload: lo }).dv < base.required + margin) continue;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (bestSplit({ ...base, payload: mid }).dv >= base.required + margin) lo = mid; else hi = mid;
    }
    const spec = { ...base, payload: Math.floor(lo / 10) * 10 };
    if (spec.payload < 100 || bestSplit(spec).dv < spec.required + 50) continue;
    if (evaluate(spec, 0.05).solved || evaluate(spec, 0.95).solved) continue;
    let n = 0;
    for (let i = 5; i <= 95; i++) if (evaluate(spec, i / 100).solved) n++;
    if (n < 3 || n > 40) continue;
    return spec;
  }
  return { kind: 'rocket', propellant: 200_000, sigma1: 0.1, sigma2: 0.1, isp1: 310, isp2: 400, payload: 3000, required: 9400 };
}
