import { rng } from './rand';

/**
 * The four-stroke crankshaft puzzle.
 *
 * A four-stroke cylinder fires once every 720° of crank rotation, and an n-cylinder engine fires its cylinders at an even
 * interval of 720°/n. The player chooses the firing order. The cylinder in firing slot s fires at 720·s/n degrees, and since
 * a piston goes up and down once per 360° of crank, its crank throw sits at φ = (720·s/n) mod 360 from cylinder 1's.
 *
 * Reciprocating piston acceleration is, to the usual order of approximation, m·r·ω²·(cos θ + λ·cos 2θ), λ = r/l, so each
 * cylinder contributes a primary vector of size m at angle φ and a secondary vector of size λm at angle 2φ. Summing them
 * gives the unbalanced shaking force; weighting each by its distance z along the crankshaft from the engine's centre
 * gives the unbalanced rocking couple. (Hannah and Stephens, Mechanics of Machines; Norton, Design of Machinery §12.)
 * Everything is in units of m·r·ω² (couples times the cylinder pitch).
 */

export interface CrankshaftSpec {
  kind: 'crankshaft';
  /** In-line cylinders, numbered 1..n from the front. */
  n: 3 | 4 | 5 | 6;
  /** Crank radius over connecting-rod length, r/l. */
  lambda: number;
  /** Distance between neighbouring cylinders (m). */
  pitch: number;
  /** Reciprocating mass of each piston and the small end of its rod (kg). */
  mass: number;
}

export interface Residuals {
  primaryForce: number;
  primaryCouple: number;
  secondaryForce: number;
  secondaryCouple: number;
}

const KEYS = ['primaryForce', 'primaryCouple', 'secondaryForce', 'secondaryCouple'] as const;
const rad = (d: number) => (d * Math.PI) / 180;

/** Throw angle (degrees) of each cylinder, indexed by cylinder number − 1, for a firing order. */
export function throwAngles(order: number[]): number[] {
  const n = order.length;
  const out = new Array<number>(n).fill(0);
  order.forEach((cyl, slot) => {
    out[cyl - 1] = ((720 * slot) / n) % 360;
  });
  return out;
}

/** Is this a firing order for an n-cylinder engine: each of 1..n exactly once? */
export function isFiringOrder(order: unknown, n: number): order is number[] {
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set<number>();
  for (const c of order) {
    if (!Number.isInteger(c) || c < 1 || c > n || seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}

/** Position of cylinder i (0-based) along the crank from the engine's centre, in pitches. */
const zOf = (i: number, n: number) => i - (n - 1) / 2;

export interface Vec {
  x: number;
  y: number;
}

/**
 * The four vector sums behind the residuals, each as a 2-D vector so the phase is kept for the animation:
 * primary force Σ e^{jφ}, primary couple Σ z e^{jφ}, secondary force λ Σ e^{2jφ}, secondary couple λ Σ z e^{2jφ}
 * (couples times the pitch). The real part of each, multiplied by e^{jθ} (or e^{2jθ}), is the force or couple at crank angle θ.
 */
export function shakeVectors(spec: Pick<CrankshaftSpec, 'n' | 'lambda' | 'pitch'>, order: number[]): Record<'f1' | 'c1' | 'f2' | 'c2', Vec> {
  const n = spec.n;
  const phi = throwAngles(order).map(rad);
  const sum = (harmonic: 1 | 2, weight: number, scale: number): Vec => {
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      const w = weight ? zOf(i, n) : 1;
      x += w * Math.cos(harmonic * phi[i]);
      y += w * Math.sin(harmonic * phi[i]);
    }
    return { x: x * scale, y: y * scale };
  };
  return {
    f1: sum(1, 0, 1),
    c1: sum(1, 1, spec.pitch),
    f2: sum(2, 0, spec.lambda),
    c2: sum(2, 1, spec.lambda * spec.pitch),
  };
}

/** Unbalanced forces and couples for a firing order. Assumes a valid order. */
export function residuals(spec: Pick<CrankshaftSpec, 'n' | 'lambda' | 'pitch'>, order: number[]): Residuals {
  const v = shakeVectors(spec, order);
  const mag = (a: Vec) => Math.hypot(a.x, a.y);
  return { primaryForce: mag(v.f1), primaryCouple: mag(v.c1), secondaryForce: mag(v.f2), secondaryCouple: mag(v.c2) };
}

/** Every firing order with cylinder 1 first (the cycle has no start, so this loses nothing). */
function allOrders(n: number): number[][] {
  const out: number[][] = [];
  const rec = (cur: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(cur);
      return;
    }
    for (let i = 0; i < rest.length; i++) rec([...cur, rest[i]], rest.filter((_, j) => j !== i));
  };
  rec([1], Array.from({ length: n - 1 }, (_, i) => i + 2));
  return out;
}

export interface Best extends Residuals {
  /** Every firing order that is as good as the best, with cylinder 1 first. */
  orders: number[][];
  /** How far a residual may sit from the best and still count as solved, per component. */
  tolerance: Residuals;
  /** The worst each residual gets over all orders. */
  worst: Residuals;
}

const bestCache = new Map<string, Best>();

/**
 * The best a firing order can do, by exhaustive search. Primary balance matters most, so orders are ranked by primary
 * force, then primary couple, then secondary force, then secondary couple. An order is as good as the best when every
 * residual is within max(0.02, 2% of that residual's worst case) of the best order's.
 */
export function bestResiduals(spec: Pick<CrankshaftSpec, 'n' | 'lambda' | 'pitch'>): Best {
  const id = `${spec.n}|${spec.lambda}|${spec.pitch}`;
  const hit = bestCache.get(id);
  if (hit) return hit;
  const all = allOrders(spec.n).map((order) => ({ order, r: residuals(spec, order) }));
  const worst = { primaryForce: 0, primaryCouple: 0, secondaryForce: 0, secondaryCouple: 0 };
  for (const { r } of all) for (const k of KEYS) worst[k] = Math.max(worst[k], r[k]);
  const tolerance = { primaryForce: 0, primaryCouple: 0, secondaryForce: 0, secondaryCouple: 0 };
  for (const k of KEYS) tolerance[k] = Math.max(0.02, 0.02 * worst[k]);
  // rank lexicographically, treating differences inside the tolerance as ties
  let champion = all[0].r;
  for (const { r } of all) {
    for (const k of KEYS) {
      if (r[k] < champion[k] - tolerance[k]) {
        champion = r;
        break;
      }
      if (r[k] > champion[k] + tolerance[k]) break;
    }
  }
  const orders = all.filter(({ r }) => KEYS.every((k) => Math.abs(r[k] - champion[k]) <= tolerance[k])).map((x) => x.order);
  const best: Best = { ...champion, orders, tolerance, worst };
  bestCache.set(id, best);
  return best;
}

export interface Evaluation {
  solved: boolean;
  /** Set when the order is not a firing order at all; the guess must not be counted. */
  refused?: string;
  residuals: Residuals;
  /** How hard the engine shakes at engine speed and at twice engine speed, 0..1 (1 is every throw in line). */
  shake: { amp1: number; amp2: number };
}

const ZERO: Residuals = { primaryForce: 0, primaryCouple: 0, secondaryForce: 0, secondaryCouple: 0 };

export function evaluate(spec: CrankshaftSpec, order: number[]): Evaluation {
  if (!isFiringOrder(order, spec.n)) {
    return { solved: false, refused: `A firing order uses each of the ${spec.n} cylinders exactly once.`, residuals: ZERO, shake: { amp1: 0, amp2: 0 } };
  }
  const r = residuals(spec, order);
  const b = bestResiduals(spec);
  const solved = KEYS.every((k) => Math.abs(r[k] - b[k]) <= b.tolerance[k]);
  // normalise by the worst case, every throw in line: n pistons, and couples weighted by their distance from the centre
  let zsum = 0;
  for (let i = 0; i < spec.n; i++) zsum += Math.abs(zOf(i, spec.n));
  const f = spec.n, c = zsum * spec.pitch;
  return {
    solved,
    residuals: r,
    shake: {
      amp1: Math.min(1, Math.hypot(r.primaryForce / f, r.primaryCouple / c)),
      amp2: Math.min(1, Math.hypot(r.secondaryForce / f, r.secondaryCouple / c)),
    },
  };
}

/**
 * Exact piston acceleration: the second derivative with respect to crank angle (ω = 1) of
 * x = r cos θ + √(l² − r² sin²θ), the distance from the crank centre to the piston pin.
 */
export function pistonAcceleration(r: number, l: number, thetaRad: number): number {
  const s = Math.sin(thetaRad), c = Math.cos(thetaRad);
  const u = Math.sqrt(l * l - r * r * s * s);
  return -r * c - r * r * ((c * c - s * s) / u + (r * r * s * s * c * c) / (u * u * u));
}

/**
 * A day's engine. Three-cylinder engines are left out: both of their firing orders are mirror images with identical
 * balance, so there is nothing to choose. The rest are in-line fours, fives and sixes with a realistic r/l, pitch and piston mass.
 */
export function makeCrankshaft(seed: number): CrankshaftSpec {
  const r = rng(seed);
  const n = ([4, 5, 6] as const)[Math.floor(r() * 3)];
  const lambda = Math.round((0.24 + r() * 0.12) * 100) / 100; // r/l between 0.24 and 0.36
  const pitch = Math.round((0.085 + r() * 0.04) * 1000) / 1000;
  const mass = Math.round((0.35 + r() * 0.55) * 20) / 20;
  return { kind: 'crankshaft', n, lambda, pitch, mass };
}
