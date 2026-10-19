import { rng } from './rand';

/**
 * Puzzle 5: the lopsided barge.
 *
 * A box-hulled barge carries deck cargo that was loaded off-centre. Four ballast tanks (fore and aft, port and
 * starboard) can be filled to bring her upright. The hydrostatics are the textbook wall-sided ones:
 *   draft T = Δ / (ρ L B),   KB = T/2,   BM = I/∇ = B²/(12 T),   GM = KB + BM − KG
 *   heel:  tan θ (GM + ½ BM tan²θ) = y_G        (y_G = sideways offset of the centre of gravity)
 *   trim:  tan ψ = x_G / GM_L,   GM_L = KB + L²/(12 T) − KG
 */

export const RHO = 1.025; // t/m³ (sea water)
export const PUMP_STEP = 5;
export const LEVEL_HEEL = 1; // degrees
export const LEVEL_TRIM = 0.3; // degrees
export const MIN_GM = 0.5; // m
export const MIN_FREEBOARD = 0.3; // m

export interface Cargo {
  m: number; // tonnes
  x: number; // metres forward of amidships
  y: number; // metres to starboard of the centreline
  kg: number; // centre height above the keel
}

export interface Tank {
  x: number;
  y: number;
  /** Plan area (m²). */
  area: number;
  cap: number; // tonnes
}

export interface BargeSpec {
  kind: 'barge';
  L: number;
  B: number;
  D: number;
  light: { m: number; kg: number };
  cargo: Cargo[];
  /** Order: fore-port, fore-starboard, aft-port, aft-starboard. */
  tanks: [Tank, Tank, Tank, Tank];
  pumpMax: number;
}

export interface BargeState {
  mass: number;
  draft: number;
  kg: number;
  xg: number;
  yg: number;
  gmT: number;
  gmL: number;
  /** Degrees, positive = starboard side down. */
  heel: number;
  /** Degrees, positive = bow down. */
  trim: number;
  draftBow: number;
  draftStern: number;
  /** Smallest freeboard at the deck edge (m). */
  freeboard: number;
  pumped: number;
  stable: boolean;
  level: boolean;
}

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

export const tankCentre = (tk: Tank, w: number) => 0.25 + w / (2 * RHO * tk.area);

export function bargeState(s: BargeSpec, w: readonly number[]): BargeState {
  let mass = s.light.m, mx = 0, my = 0, mz = s.light.m * s.light.kg;
  for (const c of s.cargo) {
    mass += c.m;
    mx += c.m * c.x;
    my += c.m * c.y;
    mz += c.m * c.kg;
  }
  let pumped = 0;
  s.tanks.forEach((tk, i) => {
    const q = w[i] ?? 0;
    pumped += q;
    mass += q;
    mx += q * tk.x;
    my += q * tk.y;
    mz += q * tankCentre(tk, q);
  });
  const xg = mx / mass, yg = my / mass, kg = mz / mass;
  const draft = mass / (RHO * s.L * s.B);
  const kb = draft / 2;
  const bmT = (s.B * s.B) / (12 * draft);
  const bmL = (s.L * s.L) / (12 * draft);
  const gmT = kb + bmT - kg, gmL = kb + bmL - kg;
  const stable = gmT > 0;
  // solve the heel equation by bisection on [-40°, 40°] (monotonic while GM > 0)
  let heel = 0;
  if (stable) {
    const f = (th: number) => Math.tan(th) * (gmT + 0.5 * bmT * Math.tan(th) ** 2) - yg;
    let lo = -rad(40), hi = rad(40);
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid;
      else lo = mid;
    }
    heel = deg((lo + hi) / 2);
  }
  const trim = gmL > 0 ? deg(Math.atan(xg / gmL)) : 0;
  const dT = Math.tan(rad(trim)) * (s.L / 2);
  const draftBow = draft + dT, draftStern = draft - dT;
  const dH = Math.tan(rad(heel)) * (s.B / 2);
  const worstDraft = Math.max(draftBow, draftStern) + Math.abs(dH);
  const freeboard = s.D - worstDraft;
  const level = stable && Math.abs(heel) <= LEVEL_HEEL && Math.abs(trim) <= LEVEL_TRIM;
  return { mass, draft, kg, xg, yg, gmT, gmL, heel, trim, draftBow, draftStern, freeboard, pumped, stable, level };
}

/** True when the pumping respects the tank sizes and the pump budget. */
export function withinLimits(s: BargeSpec, w: readonly number[]): boolean {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    if (w[i] < 0 || w[i] > s.tanks[i].cap + 1e-9) return false;
    total += w[i];
  }
  return total <= s.pumpMax + 1e-9;
}

/** A launch succeeds when she floats level, stays stable and keeps her deck dry. */
export function isSolved(s: BargeSpec, w: readonly number[]): boolean {
  if (!withinLimits(s, w)) return false;
  const st = bargeState(s, w);
  return st.level && st.gmT >= MIN_GM && st.freeboard >= MIN_FREEBOARD;
}

export function solutions(s: BargeSpec, step = 10, limit = 200): number[][] {
  const out: number[][] = [];
  const n = s.tanks.map((t) => Math.floor(t.cap / step));
  for (let a = 0; a <= n[0]; a++)
    for (let b = 0; b <= n[1]; b++)
      for (let c = 0; c <= n[2]; c++)
        for (let d = 0; d <= n[3]; d++) {
          const w = [a * step, b * step, c * step, d * step];
          if (w[0] + w[1] + w[2] + w[3] > s.pumpMax) continue;
          if (isSolved(s, w)) {
            out.push(w);
            if (out.length >= limit) return out;
          }
        }
  return out;
}

const makeTanks = (): BargeSpec['tanks'] => {
  const t = (x: number, y: number): Tank => ({ x, y, area: 32, cap: 110 });
  return [t(14, -4), t(14, 4), t(-14, -4), t(-14, 4)];
};

const X = [-16, -12, -8, -4, 0, 4, 8, 12, 16];
const Y = [-4.5, -3, -1.5, 0, 1.5, 3, 4.5];
const M = [60, 80, 100, 120, 150];

export function makeBarge(seed: number): BargeSpec {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  for (let tries = 0; tries < 200; tries++) {
    const n = 3 + Math.floor(r() * 2);
    const cargo: Cargo[] = [];
    while (cargo.length < n) {
      const c = { m: pick(M), x: pick(X), y: pick(Y), kg: r() < 0.4 ? 7 : 5.5 };
      if (!cargo.some((o) => Math.abs(o.x - c.x) < 4 && Math.abs(o.y - c.y) < 3)) cargo.push(c);
    }
    const spec: BargeSpec = {
      kind: 'barge',
      L: 40,
      B: 12,
      D: 4,
      light: { m: 600, kg: 2.2 },
      cargo,
      tanks: makeTanks(),
      pumpMax: 200,
    };
    const bare = bargeState(spec, [0, 0, 0, 0]);
    if (!bare.stable || Math.abs(bare.heel) < 3 || Math.abs(bare.heel) > 14) continue;
    if (Math.abs(bare.trim) < 0.35) continue;
    if (bare.freeboard < 0.8) continue;
    const sol = solutions(spec, 10, 80);
    if (sol.length < 1 || sol.length > 60) continue;
    const least = Math.min(...sol.map((w) => w[0] + w[1] + w[2] + w[3]));
    if (least < 60) continue;
    return spec;
  }
  // a fixed, valid barge as a last resort
  const spec: BargeSpec = {
    kind: 'barge',
    L: 40,
    B: 12,
    D: 4,
    light: { m: 600, kg: 2.2 },
    cargo: [
      { m: 150, x: 8, y: 4.5, kg: 5.5 },
      { m: 120, x: 12, y: 1.5, kg: 5.5 },
      { m: 100, x: -4, y: 3, kg: 7 },
    ],
    tanks: makeTanks(),
    pumpMax: 220,
  };
  return spec;
}
