import { rng } from './rand';

/**
 * Puzzle: aircraft balance.
 *
 * Longitudinal balance of a conventional aircraft (Raymer, Aircraft Design: A Conceptual Approach, ch. 16;
 * Nelson, Flight Stability and Automatic Control, ch. 2; Etkin and Reid, Dynamics of Flight). Stations x are measured
 * aft from the nose datum, in metres.
 *   centre of gravity   x_cg = Σ mᵢ xᵢ / Σ mᵢ
 *   static margin       SM = (x_np − x_cg) / c̄     (positive is stable; light aircraft keep it roughly 5 % to 20 %)
 * In level flight the wing lift L acts at the wing's aerodynamic centre x_ac (taken at the quarter chord of the mean
 * aerodynamic chord) and the tail load T (up is positive) at the tail's x_t, with L + T = W. Taking moments about the CG
 *   T (x_cg − x_t) + L (x_cg − x_ac) = 0   ⇒   T = W (x_cg − x_ac) / (x_t − x_ac).
 * A CG behind the wing's aerodynamic centre needs the tail to lift; ahead of it, to push down. The wing's own pitching
 * moment is left out, which is the usual first-pass simplification. The tail can only carry a limited load before the
 * elevator runs out of authority.
 */

export const G = 9.80665;
export const SM_MIN = 0.05;
export const SM_MAX = 0.2;
export const STEP = 0.05;

export interface Item { name: string; mass: number; min: number; max: number; start: number }

export interface AircraftSpec {
  kind: 'aircraft';
  emptyMass: number;
  emptyCg: number;
  /** Neutral point, wing aerodynamic centre, tail aerodynamic centre (m from the nose) and the mean aerodynamic chord (m). */
  xNp: number;
  xAc: number;
  xTail: number;
  mac: number;
  /** The most the tail can carry, either way (N). */
  tailLimit: number;
  items: Item[];
}

export const totalMass = (spec: AircraftSpec) => spec.emptyMass + spec.items.reduce((s, i) => s + i.mass, 0);

export function cgPosition(spec: AircraftSpec, placements: number[]): number {
  let moment = spec.emptyMass * spec.emptyCg, mass = spec.emptyMass;
  spec.items.forEach((it, i) => { moment += it.mass * placements[i]; mass += it.mass; });
  return moment / mass;
}

export const staticMargin = (spec: AircraftSpec, xcg: number) => (spec.xNp - xcg) / spec.mac;

/** Tail load in newtons, up positive, for level flight. */
export const tailLoad = (spec: AircraftSpec, xcg: number) => (totalMass(spec) * G * (xcg - spec.xAc)) / (spec.xTail - spec.xAc);

/** Where the CG sits as a percentage of the mean aerodynamic chord, measured from its leading edge (the AC is at 25 %). */
export const percentMac = (spec: AircraftSpec, xcg: number) => 25 + ((xcg - spec.xAc) / spec.mac) * 100;

export type Outcome = 'trims' | 'unstable' | 'marginal' | 'too-stable' | 'nose-up' | 'nose-down';

export interface Evaluation {
  solved: boolean;
  xcg?: number;
  sm?: number;
  /** Tail load in N, up positive. */
  tail?: number;
  smOk?: boolean;
  tailOk?: boolean;
  outcome?: Outcome;
  refused?: string;
}

export function evaluate(spec: AircraftSpec, placements: number[]): Evaluation {
  if (!Array.isArray(placements) || placements.length !== spec.items.length) return { solved: false, refused: 'Place every item.' };
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i], it = spec.items[i];
    if (typeof p !== 'number' || !Number.isFinite(p)) return { solved: false, refused: `Put the ${it.name.toLowerCase()} somewhere on its rail.` };
    if (p < it.min - 1e-9 || p > it.max + 1e-9) return { solved: false, refused: `The ${it.name.toLowerCase()} only fits between stations ${it.min.toFixed(2)} and ${it.max.toFixed(2)} m.` };
  }
  const xcg = cgPosition(spec, placements);
  const sm = staticMargin(spec, xcg);
  const tail = tailLoad(spec, xcg);
  const smOk = sm >= SM_MIN - 1e-12 && sm <= SM_MAX + 1e-12;
  const tailOk = Math.abs(tail) <= spec.tailLimit + 1e-9;
  let outcome: Outcome;
  if (sm < 0) outcome = 'unstable';
  else if (sm < SM_MIN) outcome = 'marginal';
  else if (!tailOk) outcome = tail > 0 ? 'nose-up' : 'nose-down';
  else if (sm > SM_MAX) outcome = 'too-stable';
  else outcome = 'trims';
  return { solved: smOk && tailOk, xcg, sm, tail, smOk, tailOk, outcome };
}

const quant = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v / STEP) * STEP));

/** The CG window that satisfies both the static-margin band and the tail limit. */
export function safeWindow(spec: AircraftSpec): [number, number] {
  const W = totalMass(spec) * G, l = spec.xTail - spec.xAc;
  const d = (spec.tailLimit * l) / W;
  return [Math.max(spec.xNp - SM_MAX * spec.mac, spec.xAc - d), Math.min(spec.xNp - SM_MIN * spec.mac, spec.xAc + d)];
}

/** A whole-grid placement that solves, or null. All items slide together along their rails until the CG lands in the window. */
export function solvePlacements(spec: AircraftSpec): number[] | null {
  const [lo, hi] = safeWindow(spec);
  if (lo > hi) return null;
  const at = (t: number) => spec.items.map((it) => quant(it.min + t * (it.max - it.min), it.min, it.max));
  const target = (lo + hi) / 2;
  let best: number[] | null = null, bestErr = Infinity;
  for (let i = 0; i <= 1000; i++) {
    const p = at(i / 1000);
    const x = cgPosition(spec, p);
    const err = Math.abs(x - target);
    if (err < bestErr) { bestErr = err; best = p; }
  }
  return best && evaluate(spec, best).solved ? best : null;
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const fix = (v: number, d = 2) => Number(v.toFixed(d));

interface Zone { name: string; mass: [number, number]; zone: [number, number] }
// stations in mean-aerodynamic-chords aft of the wing's aerodynamic centre
const ZONES: Zone[] = [
  { name: 'Pilot and front passenger', mass: [140, 200], zone: [-0.8, -0.25] },
  { name: 'Rear passengers', mass: [100, 220], zone: [0.35, 1.0] },
  { name: 'Nose baggage', mass: [20, 60], zone: [-1.7, -1.1] },
  { name: 'Aft baggage', mass: [30, 90], zone: [1.2, 2.0] },
  { name: 'Wing fuel', mass: [80, 200], zone: [-0.4, 0.4] },
  { name: 'Aft fuel tank', mass: [60, 140], zone: [0.8, 1.5] },
];

export function makeAircraft(seed: number): AircraftSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 400; tries++) {
    const k = 0.8 + r() * 0.7;
    const mac = fix(round(1.2 * k, STEP));
    const xAc = fix(round((2.0 + r()) * k, STEP));
    const xNp = fix(xAc + (0.12 + r() * 0.13) * mac);
    const xTail = fix(round(xAc + (2.3 + r() * 0.7) * mac, STEP));
    const emptyMass = Math.round((700 + r() * 900) * k / 10) * 10;
    const emptyCg = fix(xNp - (0.04 + r() * 0.3) * mac);
    const n = r() < 0.5 ? 3 : 4;
    const pool = ZONES.slice();
    const items: Item[] = [];
    while (items.length < n) {
      const z = pool.splice(Math.floor(r() * pool.length), 1)[0];
      const min = fix(round(xAc + z.zone[0] * mac, STEP)), max = fix(round(xAc + z.zone[1] * mac, STEP));
      if (!(min < max)) continue;
      items.push({ name: z.name, mass: Math.round((z.mass[0] + r() * (z.mass[1] - z.mass[0])) / 5) * 5, min, max, start: min });
    }
    const spec: AircraftSpec = { kind: 'aircraft', emptyMass, emptyCg, xNp, xAc, xTail, mac, tailLimit: 1, items };
    // the window the static margin allows, and what the rails can reach
    const lo0 = xNp - SM_MAX * mac, hi0 = xNp - SM_MIN * mac;
    const reachLo = cgPosition(spec, items.map((i) => i.min)), reachHi = cgPosition(spec, items.map((i) => i.max));
    const a = Math.max(lo0, reachLo), b = Math.min(hi0, reachHi);
    if (b - a < 0.05 * mac) continue;
    const target = a + (0.25 + 0.5 * r()) * (b - a);
    const W = totalMass(spec) * G, l = xTail - xAc;
    // the tail limit: enough for the target plus a margin, which often trims the band the static margin alone would allow
    const dNeeded = Math.abs(target - xAc) + (0.03 + r() * 0.06) * mac;
    spec.tailLimit = Math.ceil((dNeeded * W) / l / 10) * 10;
    const sol = solvePlacements(spec);
    if (!sol) continue;
    // a starting loading that does not solve
    let start: number[] | null = null;
    for (let s = 0; s < 80 && !start; s++) {
      const cand = items.map((it) => quant(it.min + r() * (it.max - it.min), it.min, it.max));
      const e = evaluate(spec, cand);
      if (!e.refused && !e.solved) start = cand;
    }
    if (!start) continue;
    items.forEach((it, i) => (it.start = fix(start![i])));
    return spec;
  }
  return {
    kind: 'aircraft', emptyMass: 1000, emptyCg: 2.6, xNp: 3.2, xAc: 2.9, xTail: 6.4, mac: 1.5, tailLimit: 2000,
    items: [{ name: 'Pilot and front passenger', mass: 160, min: 2.0, max: 2.6, start: 2.0 }, { name: 'Aft baggage', mass: 80, min: 4.4, max: 5.4, start: 5.4 }, { name: 'Wing fuel', mass: 120, min: 2.4, max: 3.4, start: 3.4 }],
  };
}
