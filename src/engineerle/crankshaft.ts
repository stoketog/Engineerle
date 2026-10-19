import { rng } from './rand';

/**
 * Puzzle: the firing order of a four-stroke in-line engine.
 *
 * A four-stroke engine fires each cylinder once every two turns (720° of crank). For smooth torque the n
 * cylinders fire 720/n degrees apart, so a firing order fixes the crank throw angle of every cylinder: the
 * cylinder that fires in slot s fires at 720·s/n degrees and its throw sits at that angle taken round one
 * turn, (720·s/n) mod 360. The player chooses the order; the engine's balance follows from physics.
 *
 * Balance (Den Hartog, Mechanical Vibrations, ch. 5; Taylor, The Internal Combustion Engine, ch. 8): a piston on a
 * crank of radius r and rod of length l, turning at ω, accelerates (up to the fourth-and-higher terms)
 *     a = -r ω² (cos θ + λ cos 2θ),   λ = r / l
 * so each cylinder contributes a primary force vector of size m r ω² turning once per revolution at its throw
 * angle φ, and a secondary one of size λ m r ω² turning twice per revolution at 2φ. Summing the vectors gives
 * the net shaking force; summing them weighted by each cylinder's distance z along the shaft gives the net
 * couple that rocks the engine end to end. Residuals are reported in units of m r ω² (couples times the pitch).
 */

export interface CrankshaftSpec {
  kind: 'crankshaft';
  n: 3 | 4 | 5 | 6;
  /** Crank radius over connecting-rod length. */
  lambda: number;
  /** Distance between neighbouring cylinders (scale of the couples). */
  pitch: number;
  /** Reciprocating mass of one cylinder (kg), for display; residuals are per unit m r ω². */
  mass: number;
}

export interface Residuals {
  primaryForce: number;
  primaryCouple: number;
  secondaryForce: number;
  secondaryCouple: number;
}

const KEYS: Array<keyof Residuals> = ['primaryForce', 'primaryCouple', 'secondaryForce', 'secondaryCouple'];
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Throw angle (degrees) of each cylinder, indexed by cylinder number - 1, for a firing order given as cylinder numbers.
 * `n` defaults to the length of the order; pass it for a partly chosen order (cylinders not chosen yet stay at 0).
 */
export function throwAngles(order: number[], n = order.length): number[] {  const out = new Array<number>(n).fill(0);
  order.forEach((cyl, slot) => {
    out[cyl - 1] = ((720 * slot) / n) % 360;
  });
  return out;
}

/** Position of cylinder `i` (1-based) along the shaft from its middle, in units of the pitch. */
const zOf = (n: number, i: number) => i - (n + 1) / 2;

export function residuals(spec: Pick<CrankshaftSpec, 'n' | 'lambda' | 'pitch'>, order: number[]): Residuals {
  const n = spec.n;
  const phi = throwAngles(order).map(rad);
  let pfx = 0, pfy = 0, pcx = 0, pcy = 0, sfx = 0, sfy = 0, scx = 0, scy = 0;
  for (let i = 1; i <= n; i++) {
    const z = zOf(n, i) * spec.pitch;
    const p = phi[i - 1];
    pfx += Math.cos(p); pfy += Math.sin(p);
    pcx += z * Math.cos(p); pcy += z * Math.sin(p);
    sfx += Math.cos(2 * p); sfy += Math.sin(2 * p);
    scx += z * Math.cos(2 * p); scy += z * Math.sin(2 * p);
  }
  return {
    primaryForce: Math.hypot(pfx, pfy),
    primaryCouple: Math.hypot(pcx, pcy),
    secondaryForce: spec.lambda * Math.hypot(sfx, sfy),
    secondaryCouple: spec.lambda * Math.hypot(scx, scy),
  };
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

interface Search {
  best: Residuals;
  worst: Residuals;
  orders: number[][];
}
const cache = new Map<string, Search>();

function search(spec: Pick<CrankshaftSpec, 'n' | 'lambda' | 'pitch'>): Search {
  const key = `${spec.n}|${spec.lambda}|${spec.pitch}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const all = permutations(Array.from({ length: spec.n - 1 }, (_, i) => i + 2)).map((p) => [1, ...p]);
  const rs = all.map((o) => residuals(spec, o));
  const best = {} as Residuals, worst = {} as Residuals;
  for (const k of KEYS) {
    best[k] = Math.min(...rs.map((r) => r[k]));
    worst[k] = Math.max(...rs.map((r) => r[k]));
  }
  const orders = all.filter((_, i) => KEYS.every((k) => rs[i][k] <= best[k] + 1e-9));
  const out = { best, worst, orders };
  cache.set(key, out);
  return out;
}

/** The smallest each residual can be over every firing order (cylinder 1 first), and the orders that reach all four at once. */
export function bestResiduals(spec: Pick<CrankshaftSpec, 'n' | 'lambda' | 'pitch'>): Residuals & { orders: number[][] } {
  const s = search(spec);
  return { ...s.best, orders: s.orders };
}

export interface Evaluation {
  solved: boolean;
  /** Set when the order is not a permutation of 1..n: nothing was tested, so it is not a guess. */
  refused?: string;
  residuals: Residuals;
  /** How hard the engine shakes at once and twice engine speed, as a fraction of the worst case of that kind (0 to about lambda). */
  shake: { amp1: number; amp2: number };
}

const ZERO: Residuals = { primaryForce: 0, primaryCouple: 0, secondaryForce: 0, secondaryCouple: 0 };

export function evaluate(spec: CrankshaftSpec, order: number[]): Evaluation {
  const n = spec.n;
  const valid = order.length === n && order.every((c) => Number.isInteger(c) && c >= 1 && c <= n) && new Set(order).size === n;
  if (!valid) {
    const why = order.length !== n ? `Choose all ${n} cylinders: that is ${order.length} so far.` : `Each cylinder from 1 to ${n} must fire exactly once.`;
    return { solved: false, refused: why, residuals: ZERO, shake: { amp1: 0, amp2: 0 } };
  }
  const r = residuals(spec, order);
  const { best, worst } = search(spec);
  const solved = KEYS.every((k) => r[k] <= best[k] + Math.max(0.02, 0.02 * worst[k]));
  const cMax = Array.from({ length: n }, (_, i) => Math.abs(zOf(n, i + 1)) * spec.pitch).reduce((a, b) => a + b, 0);
  return {
    solved,
    residuals: r,
    shake: { amp1: (r.primaryForce / n + r.primaryCouple / cMax) / 2, amp2: (r.secondaryForce / n + r.secondaryCouple / cMax) / 2 },
  };
}

/** Exact piston acceleration d²x/dθ² (ω = 1) for x = r cos θ + sqrt(l² - r² sin² θ). */
export function pistonAcceleration(r: number, l: number, thetaRad: number): number {
  const s = Math.sin(thetaRad), c = Math.cos(thetaRad);
  const root = Math.sqrt(l * l - r * r * s * s);
  return -r * c - (r * r * Math.cos(2 * thetaRad)) / root - (r ** 4 * s * s * c * c) / (root * root * root);
}

/**
 * Four, five or six cylinders (three is excluded: its two firing orders are mirror images, so every guess would
 * solve it). Rod ratios and pitches vary; the answer is always one of the orders that balance as well as the
 * layout allows, and the plain 1-2-3-… order never does.
 */
export function makeCrankshaft(seed: number): CrankshaftSpec {
  const r = rng(seed);
  const sizes = [4, 5, 5, 6, 6, 6] as const;
  const lambdas = [0.2, 0.23, 0.25, 0.28, 0.3];
  const pitches = [0.9, 1, 1.1, 1.2];
  const masses = [0.45, 0.55, 0.65, 0.8];
  for (let tries = 0; tries < 50; tries++) {
    const n = sizes[Math.floor(r() * sizes.length)];
    const spec: CrankshaftSpec = { kind: 'crankshaft', n, lambda: lambdas[Math.floor(r() * lambdas.length)], pitch: pitches[Math.floor(r() * pitches.length)], mass: masses[Math.floor(r() * masses.length)] };
    if (search(spec).orders.length >= 1 && !evaluate(spec, Array.from({ length: n }, (_, i) => i + 1)).solved) return spec;
  }
  return { kind: 'crankshaft', n: 6, lambda: 0.25, pitch: 1, mass: 0.6 };
}
