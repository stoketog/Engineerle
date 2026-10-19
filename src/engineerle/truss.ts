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

/* ───────────────────────────── the collapse ───────────────────────────── */

export interface Collapse {
  pos: Array<{ x: number; y: number }>;
  step(dt: number): void;
  alive: boolean[];
  /** The river surface: nothing falls below this. */
  floor: number;
}

/**
 * A Verlet particle model of the failed bridge: joints are particles, intact members are rigid links, the
 * broken ones are gone, and gravity does the rest.
 */
export function startCollapse(t: Truss, broken: Set<number>, disp: number[], extra: Array<{ node: number; mass: number }> = [], floor = -14): Collapse {
  const n = t.nodes.length;
  const pos = t.nodes.map((p, i) => ({ x: p.x + disp[2 * i] * 30, y: p.y + disp[2 * i + 1] * 30 }));
  const prev = pos.map((p) => ({ ...p }));
  const mass = new Array<number>(n).fill(1);
  for (const e of extra) mass[e.node] += e.mass;
  const alive = t.members.map((_, i) => !broken.has(i));
  const rest = t.members.map((m, i) => Math.hypot(t.nodes[m.b].x - t.nodes[m.a].x, t.nodes[m.b].y - t.nodes[m.a].y) + 0 * i);
  const pinned = new Set([0]);
  const roller = t.panels;
  const c: Collapse = {
    pos,
    alive,
    floor,
    step(dt: number) {
      const sub = 3;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (let i = 0; i < n; i++) {
          if (pinned.has(i)) continue;
          const p = pos[i], q = prev[i];
          const vx = (p.x - q.x) * 0.998, vy = (p.y - q.y) * 0.998;
          q.x = p.x;
          q.y = p.y;
          p.x += vx;
          p.y += vy - g * h * h;
          if (i === roller) p.y = Math.max(p.y, t.nodes[roller].y - 0.0); // a roller bearing holds it only if the span still stands
        }
        for (let it = 0; it < 14; it++) {
          t.members.forEach((m, k) => {
            if (!alive[k]) return;
            const a = pos[m.a], b = pos[m.b];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1e-9;
            const diff = (d - rest[k]) / d;
            const wa = pinned.has(m.a) ? 0 : 1 / mass[m.a], wb = pinned.has(m.b) ? 0 : 1 / mass[m.b];
            const ws = wa + wb;
            if (!ws) return;
            a.x += (dx * diff * wa) / ws;
            a.y += (dy * diff * wa) / ws;
            b.x -= (dx * diff * wb) / ws;
            b.y -= (dy * diff * wb) / ws;
          });
          pos.forEach((p, i) => {
            if (p.y < floor) {
              p.y = floor;
              prev[i].x = p.x - (p.x - prev[i].x) * 0.3;
            }
          });
          pos[0].x = t.nodes[0].x;
          pos[0].y = t.nodes[0].y;
        }
      }
    },
  };
  return c;
}
