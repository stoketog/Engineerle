import { rng } from './rand';

/**
 * Puzzle: the orbit transfer.
 *
 * Two-body motion about the Earth, μ = 398600.4418 km³/s² (Curtis, Orbital Mechanics for Engineering Students;
 * Vallado, Fundamentals of Astrodynamics and Applications). The vis-viva equation gives the speed anywhere on an
 * orbit of semi-major axis a:  v² = μ (2/r − 1/a).  A Hohmann transfer between circles r1 < r2 is the ellipse
 * with a = (r1 + r2) / 2, touching both: burn Δv1 at its periapsis r1, coast half the period
 *     t = π √(a³ / μ),
 * then burn Δv2 at its apoapsis r2 to circularise:
 *     Δv1 = √(μ/r1) (√(2 r2/(r1+r2)) − 1),   Δv2 = √(μ/r2) (1 − √(2 r1/(r1+r2))).
 * For a rendezvous the target must lead the craft by  π (1 − √(((r1+r2)/(2 r2))³))  at the moment of the first burn.
 * The player fires one prograde burn at periapsis; the apoapsis it reaches follows from the new orbital energy
 * ε = v²/2 − μ/r1, a = −μ/(2ε), r_apo = 2a − r1 (ε ≥ 0 is an escape). The tests confirm this against an RK4 integration.
 * Distances are in km, speeds in km/s, except the player's burn, which is in m/s.
 */

export const MU = 398600.4418;
/** The most the stage can deliver, m/s. Beyond it a guess is refused, not tested. */
export const MAX_BURN = 20_000;

export const visViva = (r: number, a: number) => Math.sqrt(MU * (2 / r - 1 / a));

export const hohmann = (r1: number, r2: number) => {
  const a = (r1 + r2) / 2;
  return {
    dv1: Math.sqrt(MU / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1),
    dv2: Math.sqrt(MU / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2))),
    time: Math.PI * Math.sqrt(a ** 3 / MU),
  };
};

/** How far ahead (radians) the target must be at the first burn for the craft to meet it at apoapsis. */
export const leadAngle = (r1: number, r2: number) => Math.PI * (1 - Math.sqrt(((r1 + r2) / (2 * r2)) ** 3));

export interface State { x: number; y: number; vx: number; vy: number }

const accel = (x: number, y: number): [number, number] => {
  const r = Math.hypot(x, y), k = -MU / (r * r * r);
  return [k * x, k * y];
};

/** `steps` fixed steps of `dt` seconds of the two-body problem, fourth-order Runge-Kutta. */
export function propagate(state: State, dt: number, steps: number): State {
  let { x, y, vx, vy } = state;
  for (let i = 0; i < steps; i++) {
    const [a1x, a1y] = accel(x, y);
    const k1 = { x: vx, y: vy, vx: a1x, vy: a1y };
    const [a2x, a2y] = accel(x + 0.5 * dt * k1.x, y + 0.5 * dt * k1.y);
    const k2 = { x: vx + 0.5 * dt * k1.vx, y: vy + 0.5 * dt * k1.vy, vx: a2x, vy: a2y };
    const [a3x, a3y] = accel(x + 0.5 * dt * k2.x, y + 0.5 * dt * k2.y);
    const k3 = { x: vx + 0.5 * dt * k2.vx, y: vy + 0.5 * dt * k2.vy, vx: a3x, vy: a3y };
    const [a4x, a4y] = accel(x + dt * k3.x, y + dt * k3.y);
    const k4 = { x: vx + dt * k3.vx, y: vy + dt * k3.vy, vx: a4x, vy: a4y };
    x += (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x);
    y += (dt / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y);
    vx += (dt / 6) * (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx);
    vy += (dt / 6) * (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy);
  }
  return { x, y, vx, vy };
}

/** A circular orbit of radius r, starting on the +x axis and going anticlockwise. */
export const circularState = (r: number): State => ({ x: r, y: 0, vx: 0, vy: Math.sqrt(MU / r) });

/** The state just after a prograde burn of `dvMs` m/s at the start of a circular orbit of radius r1. */
export const afterBurn = (r1: number, dvMs: number): State => ({ x: r1, y: 0, vx: 0, vy: Math.sqrt(MU / r1) + dvMs / 1000 });

/** Fly the burn numerically to the far side and return the largest radius reached (Infinity if it never turns round). */
export function apoapsisByPropagation(r1: number, dvMs: number): number {
  const s0 = afterBurn(r1, dvMs);
  const eps = (s0.vx ** 2 + s0.vy ** 2) / 2 - MU / r1;
  if (eps >= 0) return Infinity;
  const a = -MU / (2 * eps);
  const dt = (2 * Math.PI * Math.sqrt(a ** 3 / MU)) / 4000;
  let s = s0, prev = 0;
  for (let i = 0; i < 4400; i++) {
    const n = propagate(s, dt, 1);
    const rv = n.x * n.vx + n.y * n.vy;
    if (rv < 0 && prev >= 0 && i > 0) {
      let lo = 0, hi = dt;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        const m = propagate(s, mid, 1);
        if (m.x * m.vx + m.y * m.vy > 0) lo = mid; else hi = mid;
      }
      const p = propagate(s, lo, 1);
      return Math.hypot(p.x, p.y);
    }
    prev = rv;
    s = n;
  }
  return Math.hypot(s0.x, s0.y);
}

export interface OrbitSpec {
  kind: 'orbit';
  /** Radius of the starting circular orbit (km from the Earth's centre). */
  r1: number;
  /** Radius the transfer must reach at its apoapsis. */
  r2: number;
  /** Allowed error of the apoapsis radius, as a fraction of r2. */
  tolerance: number;
}

export interface Evaluation {
  solved: boolean;
  /** Apoapsis radius reached (km); undefined for an escape. */
  apoapsis?: number;
  escapes?: boolean;
  refused?: string;
}

export function evaluate(spec: OrbitSpec, dvMs: number): Evaluation {
  if (typeof dvMs !== 'number' || !Number.isFinite(dvMs) || dvMs < 0 || dvMs > MAX_BURN) return { solved: false, refused: 'Enter a burn between 0 and 20,000 m/s.' };
  const v = Math.sqrt(MU / spec.r1) + dvMs / 1000;
  const eps = v * v / 2 - MU / spec.r1;
  if (eps >= 0) return { solved: false, escapes: true };
  const a = -MU / (2 * eps);
  const apoapsis = 2 * a - spec.r1;
  return { solved: Math.abs(apoapsis - spec.r2) <= spec.tolerance * spec.r2, apoapsis };
}

/** Positions (km) along the path after the burn: n+1 points from the burn to apoapsis, or a fixed stretch if it escapes. */
export function trajectory(spec: OrbitSpec, dvMs: number, n: number): Array<{ x: number; y: number }> {
  const s0 = afterBurn(spec.r1, dvMs);
  const ev = evaluate(spec, dvMs);
  const eps = (s0.vx ** 2 + s0.vy ** 2) / 2 - MU / spec.r1;
  let tEnd: number;
  if (ev.escapes || ev.apoapsis === undefined) tEnd = (2 * Math.PI * Math.sqrt(spec.r1 ** 3 / MU)) * 1.5;
  else {
    const a = -MU / (2 * eps);
    tEnd = Math.PI * Math.sqrt(a ** 3 / MU); // periapsis to apoapsis: half the period
  }
  const sub = 8, dt = tEnd / (n * sub);
  const pts = [{ x: s0.x, y: s0.y }];
  let s = s0;
  for (let i = 0; i < n; i++) {
    s = propagate(s, dt, sub);
    pts.push({ x: s.x, y: s.y });
  }
  return pts;
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export function makeOrbit(seed: number): OrbitSpec {
  const r = rng(seed);
  return {
    kind: 'orbit',
    r1: 6578 + Math.floor(r() * 923),
    r2: pick(r, [8000, 9500, 12000, 15000, 20000, 26560, 29600, 35000, 42164]),
    tolerance: 0.01,
  };
}
