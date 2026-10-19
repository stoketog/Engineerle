import { rng } from './rand';

/**
 * Puzzle 3: the bridge that fails.
 *
 * A Warren truss of pin-jointed steel members carries a truck across. Member forces come from a real
 * direct-stiffness (finite element) solution; each member can fail by yielding in tension or by Euler
 * buckling in compression. Some members were under-sized: find them and give them the heavier section.
 */

export const E = 200e9; // Pa
export const YIELD = 250e6; // Pa
/** Thin-walled square tube: second moment of area = 2/3 A². */
export const I_FACTOR = 2 / 3;
export const UPGRADE = 2;
const g = 9.81;
export const GRAVITY = g;
/** The drawing exaggerates real displacements by this factor so a few millimetres of sag can be seen. */
export const SAG = 30;
/** The bridge's own weight on each bottom and top joint (N). */
export const DEAD = { bottom: 9000, top: 3500 };

export interface Truss {
  panels: number;
  panel: number;
  height: number;
  nodes: Array<{ x: number; y: number }>;
  members: Array<{ a: number; b: number; kind: 'bottom' | 'top' | 'diag' }>;
}

export function buildTruss(panels: number, panel = 4, height = 4): Truss {
  const nodes: Truss['nodes'] = [];
  for (let i = 0; i <= panels; i++) nodes.push({ x: i * panel, y: 0 });
  for (let i = 0; i < panels; i++) nodes.push({ x: (i + 0.5) * panel, y: height });
  const top = (i: number) => panels + 1 + i;
  const members: Truss['members'] = [];
  for (let i = 0; i < panels; i++) members.push({ a: i, b: i + 1, kind: 'bottom' });
  for (let i = 0; i < panels - 1; i++) members.push({ a: top(i), b: top(i + 1), kind: 'top' });
  for (let i = 0; i < panels; i++) {
    members.push({ a: i, b: top(i), kind: 'diag' });
    members.push({ a: top(i), b: i + 1, kind: 'diag' });
  }
  return { panels, panel, height, nodes, members };
}

export const memberLength = (t: Truss, i: number) => {
  const m = t.members[i];
  return Math.hypot(t.nodes[m.b].x - t.nodes[m.a].x, t.nodes[m.b].y - t.nodes[m.a].y);
};

/** Gaussian elimination with partial pivoting on a dense system. */
function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-18) throw new Error('mechanism');
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/** LU factorisation with partial pivoting, for solving many right-hand sides against one matrix. */
interface Lu {
  lu: number[][];
  piv: number[];
}
function luFactor(A: number[][]): Lu {
  const n = A.length;
  const lu = A.map((r) => r.slice());
  const piv = Array.from({ length: n }, (_, i) => i);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(lu[r][c]) > Math.abs(lu[p][c])) p = r;
    if (Math.abs(lu[p][c]) < 1e-18) throw new Error('mechanism');
    if (p !== c) {
      [lu[c], lu[p]] = [lu[p], lu[c]];
      [piv[c], piv[p]] = [piv[p], piv[c]];
    }
    for (let r = c + 1; r < n; r++) {
      const f = (lu[r][c] /= lu[c][c]);
      if (!f) continue;
      for (let k = c + 1; k < n; k++) lu[r][k] -= f * lu[c][k];
    }
  }
  return { lu, piv };
}
function luSolve({ lu, piv }: Lu, b: number[]): number[] {
  const n = b.length;
  const x = piv.map((p) => b[p]);
  for (let r = 1; r < n; r++) {
    let sum = x[r];
    for (let k = 0; k < r; k++) sum -= lu[r][k] * x[k];
    x[r] = sum;
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = x[r];
    for (let k = r + 1; k < n; k++) sum -= lu[r][k] * x[k];
    x[r] = sum / lu[r][r];
  }
  return x;
}

/** Global stiffness matrix (N/m), two freedoms per joint. Members in `skip` are left out. */
function assembleK(t: Truss, areas: number[], skip?: Set<number>): number[][] {
  const dof = 2 * t.nodes.length;
  const K = Array.from({ length: dof }, () => new Array<number>(dof).fill(0));
  t.members.forEach((m, i) => {
    if (skip?.has(i)) return;
    const dx = t.nodes[m.b].x - t.nodes[m.a].x, dy = t.nodes[m.b].y - t.nodes[m.a].y;
    const L = Math.hypot(dx, dy);
    const c = dx / L, s = dy / L;
    const k = (E * areas[i]) / L;
    const idx = [2 * m.a, 2 * m.a + 1, 2 * m.b, 2 * m.b + 1];
    const v = [-c, -s, c, s];
    for (let p = 0; p < 4; p++) for (let q = 0; q < 4; q++) K[idx[p]][idx[q]] += k * v[p] * v[q];
  });
  return K;
}

/** The freedoms that can move: everything except the pin at joint 0 and the roller under the last bottom joint. */
function freeDofs(t: Truss): number[] {
  const fixed = new Set([0, 1, 2 * t.panels + 1]);
  const free: number[] = [];
  for (let d = 0; d < 2 * t.nodes.length; d++) if (!fixed.has(d)) free.push(d);
  return free;
}

/** Axial force in every member (N, + tension) for joint displacements `u`. */
function axialForces(t: Truss, areas: number[], u: number[], skip?: Set<number>): number[] {
  return t.members.map((m, i) => {
    if (skip?.has(i)) return 0;
    const dx = t.nodes[m.b].x - t.nodes[m.a].x, dy = t.nodes[m.b].y - t.nodes[m.a].y;
    const L = Math.hypot(dx, dy);
    const ext = ((u[2 * m.b] - u[2 * m.a]) * dx + (u[2 * m.b + 1] - u[2 * m.a + 1]) * dy) / L;
    return (E * areas[i] * ext) / L;
  });
}

export interface Solution {
  /** Axial force in each member (N, positive = tension). */
  force: number[];
  /** Joint displacements (m): x then y per node. */
  disp: number[];
  /** Vertical reactions at the two supports (N). */
  reactions: [number, number];
}

/**
 * Solve the truss. `areas` are in m². `loads` has two entries per node (x, y) in N.
 * Supports: a pin at the first bottom joint, a roller at the last.
 */
export function solveTruss(t: Truss, areas: number[], loads: number[], skip?: Set<number>): Solution {
  const dof = 2 * t.nodes.length;
  const K = assembleK(t, areas, skip);
  const last = t.panels;
  const free = freeDofs(t);
  const Kf = free.map((r) => free.map((c) => K[r][c]));
  const uf = solveDense(Kf, free.map((d) => loads[d]));
  const u = new Array<number>(dof).fill(0);
  free.forEach((d, i) => (u[d] = uf[i]));
  const force = axialForces(t, areas, u, skip);
  // reactions: R = K u − f at the fixed freedoms
  const react = (d: number) => {
    let r = -loads[d];
    for (let c = 0; c < dof; c++) r += K[d][c] * u[c];
    return r;
  };
  return { force, disp: u, reactions: [react(1), react(2 * last + 1)] };
}

export interface Truck {
  /** Total weight (N). */
  weight: number;
  /** Axle spacing in panel lengths. */
  spacing: number;
  /** Share of the weight on the front axle. */
  front: number;
}

/** Nodal loads for a truck whose front axle is at deck position `u` (in panels), plus the bridge's own weight. */
export function truckLoads(t: Truss, truck: Truck, u: number, dead = DEAD): number[] {
  const n = t.nodes.length;
  const f = new Array<number>(2 * n).fill(0);
  for (let i = 0; i <= t.panels; i++) f[2 * i + 1] -= dead.bottom;
  for (let i = 0; i < t.panels; i++) f[2 * (t.panels + 1 + i) + 1] -= dead.top;
  const axle = (pos: number, w: number) => {
    if (pos < 0 || pos > t.panels) return;
    const i = Math.min(t.panels - 1, Math.floor(pos));
    const a = pos - i;
    f[2 * i + 1] -= w * (1 - a);
    f[2 * (i + 1) + 1] -= w * a;
  };
  axle(u, truck.weight * truck.front);
  axle(u - truck.spacing, truck.weight * (1 - truck.front));
  return f;
}

/** How much force a member can carry. */
export function capacity(area: number, length: number, compression: boolean): number {
  const yieldCap = YIELD * area;
  if (!compression) return yieldCap;
  const euler = (Math.PI ** 2 * E * I_FACTOR * area * area) / (length * length);
  return Math.min(yieldCap, euler);
}

/** Force as a fraction of capacity (above 1 the member fails). */
export function utilisation(force: number, area: number, length: number): number {
  return Math.abs(force) / capacity(area, length, force < 0);
}

/* ───────────────────────────── the moving load, dynamically ───────────────────────────── */

/** Fixed time step for everything that moves (s). The animation advances in whole steps, so it looks the same at any frame rate. */
export const DYN_STEP = 1 / 240;

export interface DynamicsOptions {
  /** Damping ratio of the first mode (Rayleigh, stiffness-proportional). Real steel bridges sit around 0.01 to 0.05. */
  zeta?: number;
  dead?: { bottom: number; top: number };
}

/**
 * The truss as a lumped-mass vibrating structure, M u'' + C u' + K u = f(t).
 *
 * - K is the same finite-element stiffness matrix the static solver uses.
 * - M is lumped at the joints from the bridge's own weight (weight / g).
 * - C = beta K with beta = 2 zeta / omega1, so the first mode has exactly the damping ratio asked for and
 *   higher modes are damped more.
 * - Time stepping is the Newmark average-acceleration method (the trapezoidal rule): second-order accurate,
 *   stable at any step, and it adds no damping of its own, so the energy bookkeeping is exact.
 * - The truck is a moving force (the usual idealisation when the bridge is the thing being studied).
 *
 * It starts at rest in the shape the bridge's own weight gives it.
 */
export class Dynamics {
  readonly free: number[];
  /** Mass at every freedom (kg). */
  readonly mass: number[];
  /** First natural frequency (rad/s) and its shape (largest entry 1). */
  readonly omega1: number;
  readonly mode1: number[];
  readonly dt: number;
  u: number[];
  v: number[];
  a: number[];
  time = 0;
  /** Work done on the structure by the loads so far (J). */
  work = 0;
  private readonly t: Truss;
  private readonly areas: number[];
  private readonly Kf: number[][];
  private readonly beta: number;
  private readonly lu: Lu;
  private readonly mf: number[];
  private last: number[];

  constructor(t: Truss, areas: number[], dt = DYN_STEP, opts: DynamicsOptions = {}) {
    const dead = opts.dead ?? DEAD;
    const zeta = opts.zeta ?? 0.05;
    this.t = t;
    this.areas = areas;
    this.dt = dt;
    const nn = t.nodes.length;
    this.mass = new Array<number>(2 * nn).fill(0);
    for (let i = 0; i < nn; i++) {
      const m = (i <= t.panels ? dead.bottom : dead.top) / g;
      this.mass[2 * i] = m;
      this.mass[2 * i + 1] = m;
    }
    this.free = freeDofs(t);
    const K = assembleK(t, areas);
    this.Kf = this.free.map((r) => this.free.map((c) => K[r][c]));
    this.mf = this.free.map((d) => this.mass[d]);
    // first mode: inverse iteration on K x = lambda M x
    const kLu = luFactor(this.Kf);
    let x = this.free.map(() => 1);
    let lambda = 0;
    for (let it = 0; it < 400; it++) {
      const y = luSolve(kLu, x.map((xi, i) => xi * this.mf[i]));
      const big = Math.max(...y.map(Math.abs));
      const nx = y.map((yi) => yi / big);
      const kx = this.Kf.map((row) => row.reduce((acc, kij, j) => acc + kij * nx[j], 0));
      const num = nx.reduce((acc, xi, i) => acc + xi * kx[i], 0);
      const den = nx.reduce((acc, xi, i) => acc + xi * xi * this.mf[i], 0);
      const next = num / den;
      x = nx;
      if (Math.abs(next - lambda) <= 1e-13 * next) {
        lambda = next;
        break;
      }
      lambda = next;
    }
    this.omega1 = Math.sqrt(lambda);
    this.mode1 = new Array<number>(2 * nn).fill(0);
    this.free.forEach((d, i) => (this.mode1[d] = x[i]));
    this.beta = (2 * zeta) / this.omega1;
    // effective stiffness for Newmark (beta_N = 1/4, gamma = 1/2): (1 + 2 beta / dt) K + 4 M / dt^2
    const kScale = 1 + (2 * this.beta) / dt;
    this.lu = luFactor(this.Kf.map((row, i) => row.map((v, j) => kScale * v + (i === j ? (4 * this.mf[i]) / (dt * dt) : 0))));
    // start at rest under the bridge's own weight
    const f0 = truckLoads(t, { weight: 0, spacing: 1, front: 0.5 }, -99, dead);
    const u0 = luSolve(kLu, this.free.map((d) => f0[d]));
    this.u = new Array<number>(2 * nn).fill(0);
    this.free.forEach((d, i) => (this.u[d] = u0[i]));
    this.v = new Array<number>(2 * nn).fill(0);
    this.a = new Array<number>(2 * nn).fill(0);
    this.last = f0;
  }

  /** Advance one step under the loads at the end of the step (N, two per joint, own weight included). */
  step(loads: number[]) {
    const { free, dt, mf, beta } = this;
    const un = free.map((d) => this.u[d]), vn = free.map((d) => this.v[d]), an = free.map((d) => this.a[d]);
    // rhs = f + M (4 u/dt^2 + 4 v/dt + a) + C (2 u/dt + v)
    const w = un.map((x, i) => (2 * x) / dt + vn[i]);
    const cw = this.Kf.map((row) => beta * row.reduce((acc, kij, j) => acc + kij * w[j], 0));
    const rhs = free.map((d, i) => loads[d] + mf[i] * ((4 * un[i]) / (dt * dt) + (4 * vn[i]) / dt + an[i]) + cw[i]);
    const un1 = luSolve(this.lu, rhs);
    let work = 0;
    free.forEach((d, i) => {
      const a1 = (4 * (un1[i] - un[i])) / (dt * dt) - (4 * vn[i]) / dt - an[i];
      const v1 = vn[i] + 0.5 * dt * (an[i] + a1);
      this.u[d] = un1[i];
      this.v[d] = v1;
      this.a[d] = a1;
      work += 0.5 * (this.last[d] + loads[d]) * (un1[i] - un[i]);
    });
    this.work += work;
    this.last = loads;
    this.time += dt;
  }

  /** Axial force in each member for the present shape (N, + tension). */
  force(): number[] {
    return axialForces(this.t, this.areas, this.u);
  }

  energy() {
    let kinetic = 0, strain = 0;
    this.free.forEach((d, i) => {
      kinetic += 0.5 * this.mf[i] * this.v[d] * this.v[d];
      strain += 0.5 * this.u[d] * this.Kf[i].reduce((acc, kij, j) => acc + kij * this.u[this.free[j]], 0);
    });
    return { kinetic, strain };
  }
}

/** The truck rolls at this speed (deck panels per second). */
export const crossingSpeed = (t: Truss, truck: Truck) => (t.panels + 2 * truck.spacing + 1) / 6;
/** Front axle position when the crossing starts, and when it is over (deck panels). */
export const crossingStart = (truck: Truck) => -truck.spacing - 0.5;
export const crossingEnd = (t: Truss, truck: Truck) => t.panels + truck.spacing + 0.5;

/** The loads at step n of a crossing (n counts from 1). Shared by the animation and the headless run so they agree exactly. */
export function crossingLoads(t: Truss, truck: Truck, n: number, dt = DYN_STEP): number[] {
  return truckLoads(t, truck, crossingStart(truck) + crossingSpeed(t, truck) * n * dt);
}

export interface DynamicRun {
  time: number[];
  /** Joint displacements at each step. */
  disp: number[][];
  /** Highest utilisation of any member at each step. */
  maxUtil: number[];
}

/** Run the truck over the bridge for `steps` steps of `dt` seconds. */
export function dynamicResponse(t: Truss, areas: number[], truck: Truck, dt: number, steps: number): DynamicRun {
  const d = new Dynamics(t, areas, dt);
  const lens = t.members.map((_, i) => memberLength(t, i));
  const out: DynamicRun = { time: [], disp: [], maxUtil: [] };
  for (let n = 1; n <= steps; n++) {
    d.step(crossingLoads(t, truck, n, dt));
    out.time.push(d.time);
    out.disp.push(d.u.slice());
    const f = d.force();
    out.maxUtil.push(Math.max(...f.map((x, i) => utilisation(x, areas[i], lens[i]))));
  }
  return out;
}

export interface Crossing {
  /** Highest utilisation of each member over the whole crossing, as if nothing gave way. */
  peak: number[];
  /** Members that went over capacity at some point. */
  failed: number[];
  ok: boolean;
  /** The step at which something first gave way, and what gave way, or null. */
  first: { step: number; members: number[] } | null;
}

/** A whole crossing, headless. `areasCm2` are the section areas in cm². */
export function crossBridge(t: Truss, areasCm2: number[], truck: Truck, dt = DYN_STEP): Crossing {
  const areas = areasCm2.map(toM2);
  const lens = t.members.map((_, i) => memberLength(t, i));
  const d = new Dynamics(t, areas, dt);
  const peak = new Array<number>(t.members.length).fill(0);
  let first: Crossing['first'] = null;
  const steps = Math.ceil((crossingEnd(t, truck) - crossingStart(truck)) / (crossingSpeed(t, truck) * dt));
  for (let n = 1; n <= steps; n++) {
    d.step(crossingLoads(t, truck, n, dt));
    const f = d.force();
    const over: number[] = [];
    f.forEach((x, i) => {
      const u = utilisation(x, areas[i], lens[i]);
      peak[i] = Math.max(peak[i], u);
      if (u > 1) over.push(i);
    });
    if (over.length && !first) first = { step: n, members: over };
  }
  const failed = peak.map((u, i) => (u > 1 ? i : -1)).filter((i) => i >= 0);
  return { peak, failed, ok: failed.length === 0, first };
}

export interface BridgeSpec {
  kind: 'bridge';
  panels: number;
  /** Cross-section of every member as built (cm²). */
  areas: number[];
  truck: Truck;
  /** How many members may be given the heavier section. */
  budget: number;
  /** The members that must be strengthened (the answer). */
  weak: number[];
}

export const toM2 = (cm2: number) => cm2 * 1e-4;
export const SCAN_STEP = 0.1;

/** Highest utilisation of each member as the truck crosses. */
export function envelope(t: Truss, areasCm2: number[], truck: Truck): number[] {
  const areas = areasCm2.map(toM2);
  const worst = new Array<number>(t.members.length).fill(0);
  const lens = t.members.map((_, i) => memberLength(t, i));
  for (let u = 0; u <= t.panels + truck.spacing + 1e-9; u += SCAN_STEP) {
    const sol = solveTruss(t, areas, truckLoads(t, truck, u));
    sol.force.forEach((f, i) => (worst[i] = Math.max(worst[i], utilisation(f, areas[i], lens[i]))));
  }
  return worst;
}

/** Demand: the largest tension and compression each member sees (N), independent of its size (the truss is determinate). */
export function demands(t: Truss, truck: Truck) {
  const areas = t.members.map(() => toM2(20));
  const tens = new Array<number>(t.members.length).fill(0), comp = new Array<number>(t.members.length).fill(0);
  for (let u = 0; u <= t.panels + truck.spacing + 1e-9; u += SCAN_STEP) {
    const sol = solveTruss(t, areas, truckLoads(t, truck, u));
    sol.force.forEach((f, i) => {
      if (f > 0) tens[i] = Math.max(tens[i], f);
      else comp[i] = Math.max(comp[i], -f);
    });
  }
  return { tens, comp };
}

/** Smallest area (cm², whole numbers) at which `utilisation` is at most `target` for the given demands. */
function areaFor(tens: number, comp: number, length: number, target: number): number {
  for (let a = 4; a < 400; a++) {
    const A = toM2(a);
    const u = Math.max(tens / capacity(A, length, false), comp ? comp / capacity(A, length, true) : 0);
    if (u <= target) return a;
  }
  return 400;
}

export function makeBridge(seed: number): BridgeSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 40; tries++) {
    const panels = 5 + Math.floor(r() * 3); // 5, 6 or 7
    const t = buildTruss(panels);
    const truck: Truck = { weight: (240 + Math.floor(r() * 5) * 20) * 1000, spacing: 0.7, front: 0.4 };
    const { tens, comp } = demands(t, truck);
    const lens = t.members.map((_, i) => memberLength(t, i));
    const demand = t.members.map((_, i) => Math.max(tens[i], comp[i]));
    const order = demand.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0]);
    // candidates: the half of the members that work hardest, chosen at random
    const pool = order.slice(0, Math.ceil(order.length * 0.5)).map((o) => o[1]);
    const k = 2 + Math.floor(r() * 2); // 2 or 3 weak members
    const weak: number[] = [];
    while (weak.length < k) {
      const c = pool[Math.floor(r() * pool.length)];
      if (!weak.includes(c)) weak.push(c);
    }
    const areas = t.members.map((_, i) => {
      const util = weak.includes(i) ? 1.15 + r() * 0.45 : 0.4 + r() * 0.4;
      return areaFor(tens[i], comp[i], lens[i], util);
    });
    // check: the weak ones fail as built, and pass once upgraded; nobody else fails
    const env = crossBridge(t, areas, truck).peak;
    const up = crossBridge(t, areas.map((a, i) => (weak.includes(i) ? a * UPGRADE : a)), truck).peak;
    const okWeak = weak.every((i) => env[i] > 1.02 && up[i] <= 0.98);
    const okRest = env.every((u, i) => weak.includes(i) || u <= 0.9);
    if (okWeak && okRest) return { kind: 'bridge', panels, areas, truck, budget: k, weak: weak.sort((a, b) => a - b) };
  }
  // a fixed, valid bridge as a last resort
  const t = buildTruss(6);
  const truck: Truck = { weight: 260000, spacing: 0.7, front: 0.4 };
  const { tens, comp } = demands(t, truck);
  const lens = t.members.map((_, i) => memberLength(t, i));
  const demand = t.members.map((_, i) => Math.max(tens[i], comp[i]));
  const weak = demand.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 2).map((o) => o[1]).sort((a, b) => a - b);
  const areas = t.members.map((_, i) => areaFor(tens[i], comp[i], lens[i], weak.includes(i) ? 1.3 : 0.6));
  return { kind: 'bridge', panels: 6, areas, truck, budget: weak.length, weak };
}

/* ───────────────────────────── the collapse ───────────────────────────── */

/** The collapse always advances in whole steps of this length, so it is the same at any frame rate. */
export const COLLAPSE_STEP = 1 / 240;
/** Fraction of its speed a joint loses per second (water, friction, joint slop). */
const DRAG = 0.8;
const ITERATIONS = 16;

export interface Collapse {
  pos: Array<{ x: number; y: number }>;
  alive: boolean[];
  /** The river surface: nothing falls below this. */
  floor: number;
  /** Time not yet used up by a whole step. */
  carry: number;
  advance(): void;
}

/**
 * A Verlet particle model of the failed bridge: joints are particles, intact members are rigid links, the
 * broken ones are gone, and gravity does the rest. It starts from the shape that is on screen (the real
 * displacements times `sag`), and each link's rest length is its length in that shape, so nothing is
 * stretched or squeezed at the first frame.
 */
export function startCollapse(t: Truss, broken: Set<number>, disp: number[], extra: Array<{ node: number; mass: number }> = [], floor = -14, sag = SAG): Collapse {
  const n = t.nodes.length;
  const pos = t.nodes.map((p, i) => ({ x: p.x + disp[2 * i] * sag, y: p.y + disp[2 * i + 1] * sag }));
  const prev = pos.map((p) => ({ ...p }));
  const mass = new Array<number>(n).fill(1);
  for (const e of extra) mass[e.node] += e.mass;
  const alive = t.members.map((_, i) => !broken.has(i));
  const rest = t.members.map((m) => Math.hypot(pos[m.b].x - pos[m.a].x, pos[m.b].y - pos[m.a].y));
  const x0 = pos[0].x, y0 = pos[0].y;
  const roller = t.panels;
  const rollerX = pos[roller].x, rollerY = pos[roller].y;
  const h = COLLAPSE_STEP;
  const keep = Math.exp(-DRAG * h);
  const c: Collapse = {
    pos,
    alive,
    floor,
    carry: 0,
    advance() {
      for (let i = 0; i < n; i++) {
        if (i === 0) continue;
        const p = pos[i], q = prev[i];
        const vx = (p.x - q.x) * keep, vy = (p.y - q.y) * keep;
        q.x = p.x;
        q.y = p.y;
        p.x += vx;
        p.y += vy - g * h * h;
      }
      for (let it = 0; it < ITERATIONS; it++) {
        t.members.forEach((m, k) => {
          if (!alive[k]) return;
          const a = pos[m.a], b = pos[m.b];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-9;
          const diff = (d - rest[k]) / d;
          const wa = m.a === 0 ? 0 : 1 / mass[m.a], wb = m.b === 0 ? 0 : 1 / mass[m.b];
          const ws = wa + wb;
          if (!ws) return;
          a.x += (dx * diff * wa) / ws;
          a.y += (dy * diff * wa) / ws;
          b.x -= (dx * diff * wb) / ws;
          b.y -= (dy * diff * wb) / ws;
        });
        // the roller sits on its pad and holds its joint up (inelastically: it kills the downward speed), but only
        // while the joint is still over the pad; once the span drags it inward past the edge it falls with the rest
        const r = pos[roller];
        if (r.x >= rollerX - 0.02 && r.y < rollerY) {
          r.y = rollerY;
          prev[roller].y = rollerY;
        }
        pos[0].x = x0;
        pos[0].y = y0;
        pos.forEach((p, i) => {
          if (p.y < floor) {
            p.y = floor;
            prev[i].x = p.x - (p.x - prev[i].x) * 0.3;
          }
        });
      }
    },
  };
  return c;
}

/** Advance the collapse by `dt` seconds of real time, in whole fixed steps (leftover time carries to the next call). */
export function stepCollapse(c: Collapse, dt: number) {
  c.carry += dt;
  while (c.carry >= COLLAPSE_STEP - 1e-9) {
    c.advance();
    c.carry -= COLLAPSE_STEP;
  }
}
