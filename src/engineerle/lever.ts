import { rng } from './rand';

/**
 * Puzzle 2: find the fulcrum.
 *
 * A uniform plank rests on a movable fulcrum and carries several loads on hooks that hang below it, like
 * a balance scale. Gravity gives a torque about the fulcrum; the hanging loads give a restoring torque, so
 * the plank settles at a tilt that grows with the out-of-balance moment. It counts as balanced when it
 * settles within a few degrees of level.
 */

export const G = 9.81;
export const BEAM_LEN = 10;
/** Hooks hang this far below the plank (m). */
export const HOOK = 1.3;
export const LEVEL_DEG = 5;

export interface Load {
  /** kg */
  m: number;
  /** Position along the plank from its centre (m, + is right). */
  x: number;
}

export interface LeverSpec {
  kind: 'lever';
  /** Plank mass (kg), uniform. */
  beam: number;
  loads: Load[];
  /** The fulcrum position that balances it exactly (m from the plank's centre). */
  answer: number;
  /** The fulcrum can be set between these positions. */
  min: number;
  max: number;
}

/** Moment of the whole plank and its loads about a fulcrum at `p` (kg·m; positive = right side heavier). */
export function moment(spec: Pick<LeverSpec, 'beam' | 'loads'>, p: number): number {
  let d = spec.beam * (0 - p);
  for (const l of spec.loads) d += l.m * (l.x - p);
  return d;
}

/** Sum of mass·hook-height: the restoring stiffness divided by g (kg·m). */
export function hookStiffness(spec: Pick<LeverSpec, 'loads'>): number {
  return spec.loads.reduce((s, l) => s + l.m * HOOK, 0);
}

/** Where the plank settles (degrees; positive = tilted with its right end down). */
export function settleAngle(spec: Pick<LeverSpec, 'beam' | 'loads'>, p: number): number {
  const D = moment(spec, p);
  const H = hookStiffness(spec);
  // D cosθ + H sinθ = 0  →  tanθ = −D/H, with the right end down for D > 0
  return (Math.atan2(D, H) * 180) / Math.PI;
}

export function isLevel(spec: Pick<LeverSpec, 'beam' | 'loads'>, p: number): boolean {
  return Math.abs(settleAngle(spec, p)) <= LEVEL_DEG;
}

/** Equilibrium fulcrum position: the centre of mass of the plank and its loads. */
export function balancePoint(spec: Pick<LeverSpec, 'beam' | 'loads'>): number {
  const M = spec.beam + spec.loads.reduce((s, l) => s + l.m, 0);
  return spec.loads.reduce((s, l) => s + l.m * l.x, 0) / M;
}

/** Total moment of inertia about the fulcrum (kg·m²), for the swing animation. */
export function inertia(spec: Pick<LeverSpec, 'beam' | 'loads'>, p: number): number {
  let I = (spec.beam * BEAM_LEN * BEAM_LEN) / 12 + spec.beam * p * p;
  for (const l of spec.loads) I += l.m * ((l.x - p) ** 2 + HOOK * HOOK);
  return I;
}

/** The tolerance in metres either side of the balance point (for display and tests). */
export function tolerance(spec: Pick<LeverSpec, 'beam' | 'loads'>): number {
  const H = hookStiffness(spec);
  const M = spec.beam + spec.loads.reduce((s, l) => s + l.m, 0);
  return (H * Math.tan((LEVEL_DEG * Math.PI) / 180)) / M;
}

export function makeLever(seed: number): LeverSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 200; tries++) {
    const n = 3 + Math.floor(r() * 2); // 3 or 4 loads
    const loads: Load[] = [];
    const used = new Set<number>();
    for (let i = 0; i < n; i++) {
      let x = 0;
      do x = Math.round((r() * 8.6 - 4.3) * 2) / 2; while (used.has(x) || Math.abs(x) < 0.5);
      used.add(x);
      loads.push({ m: 5 * (2 + Math.floor(r() * 11)), x });
    }
    const left = loads.some((l) => l.x < 0), right = loads.some((l) => l.x > 0);
    if (!left || !right) continue;
    const beam = 5 * (2 + Math.floor(r() * 4));
    const spec = { beam, loads };
    const p = balancePoint(spec);
    if (Math.abs(p) < 0.6 || Math.abs(p) > 3.2) continue;
    // the nearest slider notch must still be inside the level band
    const notch = Math.round(p * 20) / 20;
    if (!isLevel(spec, notch)) continue;
    // and an obvious guess (the middle, or the heaviest load) must not already work
    if (isLevel(spec, 0)) continue;
    return { kind: 'lever', beam, loads: loads.sort((a, b) => a.x - b.x), answer: Math.round(p * 1000) / 1000, min: -4.5, max: 4.5 };
  }
  // fall back to a fixed, valid puzzle
  const loads = [{ m: 40, x: -4 }, { m: 10, x: 3 }, { m: 15, x: 4.5 }];
  const spec = { beam: 10, loads };
  return { kind: 'lever', beam: 10, loads, answer: balancePoint(spec), min: -4.5, max: 4.5 };
}
