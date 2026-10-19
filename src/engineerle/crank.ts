import { rng } from './rand';

/**
 * Puzzle 4: the engine that shakes.
 *
 * An in-line engine's pistons each move up and down once per turn, and the force needed to accelerate them
 * is, to first order, a vector of size m·r·ω² turning with that cylinder's crank throw. Add the vectors for
 * all cylinders and any remainder shakes the engine (the primary force); add them again weighted by their
 * distance along the crankshaft and any remainder rocks it end to end (the primary couple). Set the throw
 * angles so both sums are zero and the engine runs smooth.
 */

export const STEP = 30; // degrees between choices on the dial
export const TOL = 0.06;

export interface CrankSpec {
  kind: 'engine';
  /** Reciprocating mass of each cylinder (kg). */
  m: number[];
  /** Position of each cylinder along the crankshaft from the centre (m). */
  z: number[];
  /** A setting that balances it (degrees per throw; the first is always 0). */
  answer: number[];
}

const rad = (d: number) => (d * Math.PI) / 180;

export function vectors(spec: Pick<CrankSpec, 'm'>, angles: number[]) {
  return spec.m.map((m, i) => ({ x: m * Math.cos(rad(angles[i])), y: m * Math.sin(rad(angles[i])) }));
}

export function forceSum(spec: Pick<CrankSpec, 'm'>, angles: number[]) {
  const v = vectors(spec, angles);
  return { x: v.reduce((s, a) => s + a.x, 0), y: v.reduce((s, a) => s + a.y, 0) };
}

export function coupleSum(spec: Pick<CrankSpec, 'm' | 'z'>, angles: number[]) {
  const v = vectors(spec, angles);
  return { x: v.reduce((s, a, i) => s + a.x * spec.z[i], 0), y: v.reduce((s, a, i) => s + a.y * spec.z[i], 0) };
}

/** Unbalance as a fraction of the worst case (all throws in line): 0 is perfectly smooth. */
export function unbalance(spec: Pick<CrankSpec, 'm' | 'z'>, angles: number[]) {
  const f = forceSum(spec, angles), c = coupleSum(spec, angles);
  const fMax = spec.m.reduce((s, m) => s + m, 0);
  const cMax = spec.m.reduce((s, m, i) => s + m * Math.abs(spec.z[i]), 0);
  return { force: Math.hypot(f.x, f.y) / fMax, couple: Math.hypot(c.x, c.y) / cMax };
}

export function isSmooth(spec: Pick<CrankSpec, 'm' | 'z'>, angles: number[]): boolean {
  const u = unbalance(spec, angles);
  return u.force <= TOL && u.couple <= TOL;
}

/**
 * Dial settings (first throw fixed at 0) that balance this engine exactly. Searches multiples of `step` degrees;
 * the dial itself offers every 30°, and the checker accepts anything within tolerance.
 */
export function solutions(spec: Pick<CrankSpec, 'm' | 'z'>, limit = 64, step = 60): number[][] {
  const n = spec.m.length;
  const k = 360 / step;
  const cos = Array.from({ length: k }, (_, i) => Math.cos(rad(i * step)));
  const sin = Array.from({ length: k }, (_, i) => Math.sin(rad(i * step)));
  const idx = new Array<number>(n).fill(0);
  const out: number[][] = [];
  const rec = (i: number, fx: number, fy: number, cx: number, cy: number) => {
    if (out.length >= limit) return;
    if (i === n) {
      if (Math.abs(fx) < 1e-9 && Math.abs(fy) < 1e-9 && Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9) out.push(idx.map((v) => v * step));
      return;
    }
    for (let a = 0; a < k; a++) {
      idx[i] = a;
      const mx = spec.m[i] * cos[a], my = spec.m[i] * sin[a];
      rec(i + 1, fx + mx, fy + my, cx + mx * spec.z[i], cy + my * spec.z[i]);
    }
  };
  rec(1, spec.m[0], 0, spec.m[0] * spec.z[0], 0);
  return out;
}

export function makeEngine(seed: number): CrankSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 400; tries++) {
    const n = 4 + Math.floor(r() * 3); // 4, 5 or 6 cylinders
    const pitch = 0.9;
    const z = Array.from({ length: n }, (_, i) => Math.round((i - (n - 1) / 2) * pitch * 100) / 100);
    const masses = [1, 1.5, 2];
    const m = Array.from({ length: n }, () => masses[Math.floor(r() * masses.length)]);
    // some variety, but not all equal
    if (m.every((v) => v === m[0])) continue;
    const spec = { m, z };
    const sols = solutions(spec, 40);
    // exactly-solvable, but not trivially: the all-zero "everything in line" setting must not be a solution
    if (sols.length >= 1 && sols.length <= 30) {
      return { kind: 'engine', m, z, answer: sols[Math.floor(r() * sols.length)] };
    }
  }
  // The classic flat-plane four: always balanced.
  const m = [1, 1, 1, 1];
  const z = [-1.35, -0.45, 0.45, 1.35];
  return { kind: 'engine', m, z, answer: [0, 180, 180, 0] };
}

/**
 * How hard the engine shakes as a 0–1 value, for the animation. Real force grows with the unbalance fraction,
 * so this is proportional (with a gentle curve so small imbalances are still visible).
 */
export function shake(spec: Pick<CrankSpec, 'm' | 'z'>, angles: number[]) {
  const u = unbalance(spec, angles);
  return { force: Math.min(1, Math.sqrt(u.force) * 1.15), couple: Math.min(1, Math.sqrt(u.couple) * 1.15), raw: u };
}
