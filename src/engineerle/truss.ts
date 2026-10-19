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
  const n = t.nodes.length;
  const dof = 2 * n;
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
  const last = t.panels;
  const fixed = new Set([0, 1, 2 * last + 1]);
  const free: number[] = [];
  for (let d = 0; d < dof; d++) if (!fixed.has(d)) free.push(d);
  const Kf = free.map((r) => free.map((c) => K[r][c]));
  const ff = free.map((d) => loads[d]);
  const uf = solveDense(Kf, ff);
  const u = new Array<number>(dof).fill(0);
  free.forEach((d, i) => (u[d] = uf[i]));
  const force = t.members.map((m, i) => {
    if (skip?.has(i)) return 0;
    const dx = t.nodes[m.b].x - t.nodes[m.a].x, dy = t.nodes[m.b].y - t.nodes[m.a].y;
    const L = Math.hypot(dx, dy);
    const c = dx / L, s = dy / L;
    const ext = (u[2 * m.b] - u[2 * m.a]) * c + (u[2 * m.b + 1] - u[2 * m.a + 1]) * s;
    return (E * areas[i] * ext) / L;
  });
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
export function truckLoads(t: Truss, truck: Truck, u: number, dead = { bottom: 9000, top: 3500 }): number[] {
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
    const env = envelope(t, areas, truck);
    const up = envelope(t, areas.map((a, i) => (weak.includes(i) ? a * UPGRADE : a)), truck);
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

/* ───────────────────────── the crossing, in time ─────────────────────────
 *
 * A large-displacement ("corotational") pin-jointed truss integrated in time with a fixed step.
 *
 *  - Each member is a spring along its current direction: axial force N = E A (L - L0) / L0, with L the
 *    current length and L0 the length as built. Nothing is linearised, so a falling span keeps its geometry.
 *  - Mass is lumped at the joints: half of each member's steel plus the dead load carried there.
 *  - Damping is Rayleigh damping (mass part ALPHA, stiffness part BETA), about 5% of critical at the first mode.
 *  - The truck is a moving force (its inertia is ignored, as in the usual moving-load model) whose position
 *    depends only on the step count, so the result does not depend on the frame rate.
 *  - A member whose elastic force passes its capacity (yield in tension, Euler buckling in compression) is
 *    removed. Everything else carries on under the same integrator, which is the collapse.
 *  - Time stepping is velocity Verlet (second order and symplectic), which conserves energy over long runs.
 */

export const SIM_DT = 1 / 5000;
const RHO = 7850; // kg/m³
const ALPHA = 3; // 1/s, mass-proportional damping
const BETA = 8e-4; // s, stiffness-proportional damping
const LOAD_EVERY = 25; // steps between refreshes of the moving load (5 ms)

export interface SimOptions {
  /** Fixed step (s). */
  dt?: number;
  /** Rayleigh damping on (default) or off. */
  damping?: boolean;
  /** False leaves the truck off the bridge (only the bridge's own weight acts). */
  truck?: boolean;
  /** Truck speed in panels per second. */
  speed?: number;
  /** Where the front axle starts, in panels (negative = before the bridge). */
  start?: number;
  /** Nothing falls below this height. */
  floor?: number;
}

export type FailureMode = 'snapped' | 'buckled';

export class BridgeSim {
  readonly t: Truss;
  readonly areas: number[];
  readonly truck: Truck;
  readonly dt: number;
  readonly speed: number;
  readonly floor: number;
  readonly L0: number[];
  readonly alive: boolean[];
  readonly broken = new Map<number, FailureMode>();
  /** The members that gave way first (all in the same step); everything after is a consequence. */
  firstFailure: number[] = [];
  /** Highest utilisation each member has reached so far. */
  readonly peak: number[];
  /** Utilisation of each member right now. */
  util: number[];
  /** Axial force in each member right now (N, positive = tension; 0 once it has failed). */
  force: number[];
  /** Sim time at which the bridge first failed (s), or -1. */
  failedAt = -1;
  /** Steps taken. Everything depends on this and nothing else. */
  steps = 0;
  /** Front axle position in panels. Stops moving once the bridge has failed. */
  u: number;
  collapsed = false;

  private readonly n: number;
  private readonly rx: Float64Array;
  private readonly ry: Float64Array;
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly mass: Float64Array;
  private readonly ea: number[];
  private readonly capT: number[];
  private readonly capC: number[];
  private readonly alpha: number;
  private readonly beta: number;
  private readonly withTruck: boolean;
  private readonly u0: number;
  private ext: number[];
  private acc = 0;
  private haveAccel = false;
  private readonly fx: Float64Array;
  private readonly fy: Float64Array;
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly equilibrium: number;

  constructor(t: Truss, areasM2: number[], truck: Truck, opts: SimOptions = {}) {
    this.t = t;
    this.areas = areasM2;
    this.truck = truck;
    this.dt = opts.dt ?? SIM_DT;
    this.withTruck = opts.truck !== false;
    this.speed = opts.speed ?? (t.panels + 2 * truck.spacing + 1) / 6;
    this.floor = opts.floor ?? -8.7;
    const damping = opts.damping !== false;
    this.alpha = damping ? ALPHA : 0;
    this.beta = damping ? BETA : 0;
    this.u0 = opts.start ?? -truck.spacing - 0.5;
    this.u = this.withTruck ? this.u0 : -1e6;
    const n = (this.n = t.nodes.length);
    this.L0 = t.members.map((_, i) => memberLength(t, i));
    this.alive = t.members.map(() => true);
    this.peak = t.members.map(() => 0);
    this.util = t.members.map(() => 0);
    this.force = t.members.map(() => 0);
    this.ea = t.members.map((_, i) => E * areasM2[i]);
    this.capT = t.members.map((_, i) => capacity(areasM2[i], this.L0[i], false));
    this.capC = t.members.map((_, i) => capacity(areasM2[i], this.L0[i], true));
    this.rx = Float64Array.from(t.nodes.map((p) => p.x));
    this.ry = Float64Array.from(t.nodes.map((p) => p.y));
    this.x = Float64Array.from(this.rx);
    this.y = Float64Array.from(this.ry);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.fx = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    // mass: dead load / g at each joint plus half of each member's steel
    const dead = truckLoads(t, truck, -1e6);
    this.mass = new Float64Array(n);
    for (let i = 0; i < n; i++) this.mass[i] = -dead[2 * i + 1] / g;
    t.members.forEach((m, i) => {
      const half = (RHO * areasM2[i] * this.L0[i]) / 2;
      this.mass[m.a] += half;
      this.mass[m.b] += half;
    });
    // begin at static equilibrium under the bridge's own weight, so nothing rings at the start
    const eq = solveTruss(t, areasM2, dead);
    for (let i = 0; i < n; i++) {
      this.x[i] += eq.disp[2 * i];
      this.y[i] += eq.disp[2 * i + 1];
    }
    this.ext = this.loadsNow();
    this.equilibrium = this.totalEnergy();
  }

  get time(): number {
    return this.steps * this.dt;
  }

  private loadsNow(): number[] {
    return truckLoads(this.t, this.truck, this.u);
  }

  /** Joint displacements from the shape as built: x then y for each joint, as `solveTruss` reports them. */
  displacement(): number[] {
    const d = new Array<number>(2 * this.n);
    for (let i = 0; i < this.n; i++) {
      d[2 * i] = this.x[i] - this.rx[i];
      d[2 * i + 1] = this.y[i] - this.ry[i];
    }
    return d;
  }

  positions(): Array<{ x: number; y: number }> {
    return Array.from({ length: this.n }, (_, i) => ({ x: this.x[i], y: this.y[i] }));
  }

  kineticEnergy(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) k += 0.5 * this.mass[i] * (this.vx[i] ** 2 + this.vy[i] ** 2);
    return k;
  }

  /** Kinetic + strain energy minus the work potential of the (fixed) loads, measured from the shape as built. */
  totalEnergy(): number {
    let e = this.kineticEnergy();
    this.t.members.forEach((m, i) => {
      if (!this.alive[i]) return;
      const ext = Math.hypot(this.x[m.b] - this.x[m.a], this.y[m.b] - this.y[m.a]) - this.L0[i];
      e += (0.5 * this.ea[i] * ext * ext) / this.L0[i];
    });
    for (let i = 0; i < this.n; i++) e -= this.ext[2 * i] * (this.x[i] - this.rx[i]) + this.ext[2 * i + 1] * (this.y[i] - this.ry[i]);
    return e;
  }

  /** Energy above the static equilibrium it started from. */
  excitation(): number {
    return this.totalEnergy() - this.equilibrium;
  }

  /** Push the deck into a half-sine bend of this amplitude (m), to give it something to ring with. */
  pluck(amplitude: number) {
    const total = this.t.panels * this.t.panel;
    for (let i = 0; i < this.n; i++) this.y[i] += amplitude * Math.sin((Math.PI * this.rx[i]) / total);
    this.haveAccel = false;
  }

  /** Move time forward. Whole fixed steps only; the remainder carries to the next call. */
  advance(seconds: number) {
    this.acc += seconds / this.dt;
    const k = Math.floor(this.acc + 1e-9);
    this.acc -= k;
    for (let s = 0; s < k; s++) this.step();
  }

  /** Forces on every joint now (loads, members, damping) turned into accelerations; also tests every member for failure. */
  private accelerations() {
    const { t, n } = this;
    const fx = this.fx, fy = this.fy;
    for (let i = 0; i < n; i++) {
      fx[i] = this.ext[2 * i];
      fy[i] = this.ext[2 * i + 1];
    }
    let failed = false;
    const now: number[] = [];
    for (let k = 0; k < t.members.length; k++) {
      if (!this.alive[k]) continue;
      const m = t.members[k];
      const dx = this.x[m.b] - this.x[m.a], dy = this.y[m.b] - this.y[m.a];
      const L = Math.hypot(dx, dy);
      const ex = dx / L, ey = dy / L;
      const elastic = (this.ea[k] * (L - this.L0[k])) / this.L0[k];
      const u = Math.abs(elastic) / (elastic < 0 ? this.capC[k] : this.capT[k]);
      this.util[k] = u;
      this.force[k] = elastic;
      if (u > this.peak[k]) this.peak[k] = u;
      if (u >= 1) {
        this.alive[k] = false;
        this.force[k] = 0;
        this.broken.set(k, elastic >= 0 ? 'snapped' : 'buckled');
        now.push(k);
        failed = true;
        continue;
      }
      const rate = (this.vx[m.b] - this.vx[m.a]) * ex + (this.vy[m.b] - this.vy[m.a]) * ey;
      const N = elastic + this.beta * (this.ea[k] / this.L0[k]) * rate;
      fx[m.a] += N * ex;
      fy[m.a] += N * ey;
      fx[m.b] -= N * ex;
      fy[m.b] -= N * ey;
    }
    if (failed && !this.collapsed) {
      this.firstFailure = now;
      this.failedAt = this.steps * this.dt;
      // the truck stays where it was and its weight now rides on the joints beneath it
      this.collapsed = true;
      const withTruck = this.loadsNow();
      const without = truckLoads(t, this.truck, -1e6);
      for (let i = 0; i < n; i++) this.mass[i] += -(withTruck[2 * i + 1] - without[2 * i + 1]) / g;
    }
    for (let i = 0; i < n; i++) {
      this.ax[i] = fx[i] / this.mass[i] - this.alpha * this.vx[i];
      this.ay[i] = fy[i] / this.mass[i] - this.alpha * this.vy[i];
    }
    this.ax[0] = 0;
    this.ay[0] = 0; // pin
    this.ay[t.panels] = 0; // roller: holds the height, free to slide
    this.haveAccel = true;
  }

  private kick(h: number) {
    for (let i = 1; i < this.n; i++) {
      this.vx[i] += this.ax[i] * h;
      this.vy[i] += this.ay[i] * h;
    }
    this.vy[this.t.panels] = 0;
  }

  /** One velocity-Verlet step (second order, symplectic): half kick, drift, new forces, half kick. */
  private step() {
    const { dt, n } = this;
    if (this.withTruck && !this.collapsed) this.u = this.u0 + this.speed * this.steps * dt;
    if (this.steps % LOAD_EVERY === 0) {
      this.ext = this.loadsNow();
      this.haveAccel = false;
    }
    if (!this.haveAccel) this.accelerations();
    this.kick(dt / 2);
    for (let i = 1; i < n; i++) {
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.y[i] < this.floor) {
        this.y[i] = this.floor;
        if (this.vy[i] < 0) this.vy[i] *= -0.15;
        this.vx[i] *= 0.8;
      }
    }
    this.accelerations();
    this.kick(dt / 2);
    this.steps++;
  }
}

/** Run a pass and sample it: `samples` snapshots, `dt` seconds apart, from the start of the crossing. */
export function dynamicResponse(t: Truss, areasM2: number[], truck: Truck, dt: number, samples: number) {
  const sim = new BridgeSim(t, areasM2, truck);
  const time: number[] = [], disp: number[][] = [], maxUtil: number[] = [];
  for (let k = 0; k < samples; k++) {
    sim.advance(dt);
    time.push(sim.time);
    disp.push(sim.displacement());
    maxUtil.push(Math.max(...sim.util));
  }
  return { time, disp, maxUtil };
}
