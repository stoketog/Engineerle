import { rng } from './rand';

/**
 * Puzzle: the resistor network.
 *
 * Choose a standard (E24) resistor so a marked node sits at a target voltage, or a marked branch carries a
 * target current. The network is solved by nodal analysis: Kirchhoff's current law at every unknown node gives
 * G v = i, with G built from the conductances 1/R. Verified in tests against series/parallel closed forms, the
 * balanced Wheatstone bridge, KCL at every node and KVL around a loop.
 */

/** The 24 preferred values per decade of the E24 series (5% resistors). */
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

export const MAX_OHMS = 10_000_000;

export interface Resistor {
  a: number;
  b: number;
  ohms: number;
}

/**
 * Node voltages of a resistor network. Node 0 is ground; each source holds its node at the given voltage above
 * ground. Throws if any part of the circuit has no connection to a source or to ground.
 */
export function solveNetwork(nodes: number, resistors: Resistor[], sources: Array<{ node: number; volts: number }>): number[] {
  const known = new Array<number | null>(nodes).fill(null);
  known[0] = 0;
  for (const s of sources) {
    if (!(s.node > 0 && s.node < nodes)) throw new Error('A source must sit on a node other than ground');
    known[s.node] = s.volts;
  }
  const unknown: number[] = [];
  const index = new Array<number>(nodes).fill(-1);
  for (let i = 0; i < nodes; i++) if (known[i] === null) { index[i] = unknown.length; unknown.push(i); }
  const m = unknown.length;
  const G = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0)); // last column is the right-hand side
  for (const r of resistors) {
    if (!(r.ohms > 0) || !Number.isFinite(r.ohms)) throw new Error('A resistor must have a positive, finite resistance');
    const g = 1 / r.ohms;
    const ia = index[r.a], ib = index[r.b];
    if (ia >= 0) { G[ia][ia] += g; if (ib >= 0) G[ia][ib] -= g; else G[ia][m] += g * (known[r.b] as number); }
    if (ib >= 0) { G[ib][ib] += g; if (ia >= 0) G[ib][ia] -= g; else G[ib][m] += g * (known[r.a] as number); }
  }
  const scale = Math.max(0, ...G.map((row, i) => row[i]));
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(G[r][c]) > Math.abs(G[p][c])) p = r;
    if (Math.abs(G[p][c]) <= 1e-12 * scale || scale === 0) throw new Error('Part of the circuit is not connected to the supply');
    [G[c], G[p]] = [G[p], G[c]];
    for (let r = c + 1; r < m; r++) {
      const f = G[r][c] / G[c][c];
      if (f === 0) continue;
      for (let k = c; k <= m; k++) G[r][k] -= f * G[c][k];
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = G[r][m];
    for (let k = r + 1; k < m; k++) s -= G[r][k] * x[k];
    x[r] = s / G[r][r];
  }
  return known.map((k, i) => (k !== null ? k : x[index[i]]));
}

/* ───────────────────────────── the puzzle ───────────────────────────── */

export type Topology = 'divider' | 'shunt' | 'ladder' | 'bridge';

export interface CircuitSpec {
  kind: 'circuit';
  topology: Topology;
  nodes: number;
  resistors: Resistor[];
  /** Index in `resistors` of the one to choose (its `ohms` is a placeholder). */
  free: number;
  source: { node: number; volts: number };
  /**
   * `value` is positive: volts for a voltage target, milliamps for a current target. A current is read from the
   * resistor's `a` end to its `b` end, or the other way round when `reverse` is set (so the target stays positive).
   */
  target: { kind: 'voltage'; node: number; value: number } | { kind: 'current'; resistor: number; value: number; reverse?: boolean };
  /** Relative tolerance on the target (0.02 = 2%). */
  tolerance: number;
  /** Where the dial starts, in ohms. */
  initial: number;
}

/** Every position of the dial: the E24 values from 10 ohms up to 1 megohm. */
export function dialValues(): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 5; d++) for (const v of E24) out.push(Math.round(v * 10 ** d * 1000) / 1000);
  out.push(1_000_000);
  return out;
}

/** The meter reading (volts, or milliamps for a current target) with the free resistor set to `ohms`. */
export function measure(spec: CircuitSpec, ohms: number): number {
  const res = spec.resistors.map((r, i) => (i === spec.free ? { ...r, ohms } : r));
  const v = solveNetwork(spec.nodes, res, [spec.source]);
  if (spec.target.kind === 'voltage') return v[spec.target.node];
  const r = res[spec.target.resistor];
  return ((spec.target.reverse ? v[r.b] - v[r.a] : v[r.a] - v[r.b]) / r.ohms) * 1000;
}

export interface Evaluation {
  solved: boolean;
  measured: number;
  /** Set when the value cannot be built (nothing was tested, so it is not a guess). */
  refused?: string;
}

export function evaluate(spec: CircuitSpec, ohms: number): Evaluation {
  if (typeof ohms !== 'number' || !Number.isFinite(ohms) || ohms <= 0 || ohms > MAX_OHMS) {
    return { solved: false, measured: NaN, refused: 'Choose a resistance above zero, up to 10 MΩ.' };
  }
  const measured = measure(spec, ohms);
  return { solved: Math.abs(measured - spec.target.value) <= spec.tolerance * Math.abs(spec.target.value), measured };
}

/** The schematic: where each node sits on a 320 x 190 sheet (several points can be ground). */
export interface Layout {
  pos: Array<{ x: number; y: number; node: number }>;
  /** For each resistor, the two points (indices into `pos`) it joins. */
  res: Array<[number, number]>;
  /** The supply, from its top point to its bottom (ground) point. */
  source: [number, number];
  /** Plain wires. */
  wires: Array<[number, number]>;
  /** Points where a ground symbol is drawn. */
  grounds: number[];
}

export const LAYOUTS: Record<Topology, Layout> = {
  divider: {
    pos: [{ x: 65, y: 40, node: 1 }, { x: 195, y: 40, node: 2 }, { x: 65, y: 150, node: 0 }, { x: 195, y: 150, node: 0 }],
    res: [[0, 1], [1, 3]],
    source: [0, 2],
    wires: [[2, 3]],
    grounds: [3],
  },
  shunt: {
    pos: [{ x: 65, y: 40, node: 1 }, { x: 155, y: 40, node: 2 }, { x: 65, y: 150, node: 0 }, { x: 155, y: 150, node: 0 }, { x: 245, y: 40, node: 2 }, { x: 245, y: 150, node: 0 }],
    res: [[0, 1], [1, 3], [4, 5]],
    source: [0, 2],
    wires: [[1, 4], [2, 3], [3, 5]],
    grounds: [5],
  },
  ladder: {
    pos: [{ x: 65, y: 40, node: 1 }, { x: 145, y: 40, node: 2 }, { x: 255, y: 40, node: 3 }, { x: 65, y: 150, node: 0 }, { x: 145, y: 150, node: 0 }, { x: 255, y: 150, node: 0 }],
    res: [[0, 1], [1, 4], [1, 2], [2, 5]],
    source: [0, 3],
    wires: [[3, 4], [4, 5]],
    grounds: [5],
  },
  bridge: {
    pos: [{ x: 60, y: 95, node: 1 }, { x: 110, y: 95, node: 1 }, { x: 195, y: 35, node: 2 }, { x: 195, y: 155, node: 3 }, { x: 285, y: 95, node: 0 }, { x: 60, y: 175, node: 0 }],
    res: [[1, 2], [1, 3], [2, 4], [3, 4], [2, 3]],
    source: [0, 5],
    wires: [[0, 1]],
    grounds: [4, 5],
  },
};

const pickFrom = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const sig3 = (v: number) => Number(v.toPrecision(3));

interface Template {
  topology: Topology;
  nodes: number;
  /** [a, b] for each resistor, in order. */
  wiring: Array<[number, number]>;
  /** Which resistors may be the free one. */
  freeChoices: number[];
  targets: Array<{ kind: 'voltage'; node: number } | { kind: 'current'; resistor: number }>;
}

const TEMPLATES: Template[] = [
  { topology: 'divider', nodes: 3, wiring: [[1, 2], [2, 0]], freeChoices: [0, 1], targets: [{ kind: 'voltage', node: 2 }, { kind: 'current', resistor: 0 }] },
  { topology: 'shunt', nodes: 3, wiring: [[1, 2], [2, 0], [2, 0]], freeChoices: [0, 1, 2], targets: [{ kind: 'voltage', node: 2 }, { kind: 'current', resistor: 0 }] },
  { topology: 'ladder', nodes: 4, wiring: [[1, 2], [2, 0], [2, 3], [3, 0]], freeChoices: [0, 1, 2, 3], targets: [{ kind: 'voltage', node: 3 }, { kind: 'current', resistor: 2 }] },
  { topology: 'bridge', nodes: 4, wiring: [[1, 2], [1, 3], [2, 0], [3, 0], [2, 3]], freeChoices: [0, 1, 2, 3], targets: [{ kind: 'voltage', node: 3 }, { kind: 'current', resistor: 4 }] },
];

/**
 * A network with one free slot and a target met by a few E24 values (never by the starting one). The target is the
 * reading with a hidden E24 value in the slot, rounded to three figures, so at least that value always works.
 */
export function makeCircuit(seed: number): CircuitSpec {
  const r = rng(seed);
  const dial = dialValues();
  for (let tries = 0; tries < 400; tries++) {
    const tpl = pickFrom(r, TEMPLATES);
    const fixed = () => Math.round(pickFrom(r, E24) * 10 ** (2 + Math.floor(r() * 3)) * 1000) / 1000; // 100 ohm to 91 k
    const free = pickFrom(r, tpl.freeChoices);
    const resistors: Resistor[] = tpl.wiring.map(([a, b], i) => ({ a, b, ohms: i === free ? 1000 : fixed() }));
    const volts = pickFrom(r, [3.3, 5, 9, 12, 15, 24]);
    const t = pickFrom(r, tpl.targets);
    const hidden = Math.round(pickFrom(r, E24) * 10 ** (2 + Math.floor(r() * 3)) * 1000) / 1000;
    const probe: CircuitSpec = { kind: 'circuit', topology: tpl.topology, nodes: tpl.nodes, resistors, free, source: { node: 1, volts }, target: { ...t, value: 0 } as CircuitSpec['target'], tolerance: 0.02, initial: 1000 };
    const raw = measure(probe, hidden);
    const reverse = t.kind === 'current' && raw < 0;
    const value = sig3(Math.abs(raw));
    const minimum = t.kind === 'voltage' ? 0.2 : 0.05; // volts, milliamps: big enough to read
    if (!(Math.abs(value) >= minimum)) continue;
    const spec: CircuitSpec = { ...probe, target: (t.kind === 'current' ? { ...t, value, reverse } : { ...t, value }) as CircuitSpec['target'] };
    const good = dial.filter((o) => evaluate(spec, o).solved);
    if (good.length < 1 || good.length > 3) continue;
    const far = dial.filter((o) => Math.abs(measure(spec, o) - value) > 0.15 * Math.abs(value) && o >= 100 && o <= 100_000);
    if (!far.length) continue;
    return { ...spec, initial: pickFrom(r, far) };
  }
  // a plain divider that always works: 9 V, 1 k on top, choose the bottom for 3 V
  return {
    kind: 'circuit', topology: 'divider', nodes: 3, resistors: [{ a: 1, b: 2, ohms: 2000 }, { a: 2, b: 0, ohms: 1000 }], free: 1,
    source: { node: 1, volts: 9 }, target: { kind: 'voltage', node: 2, value: 3 }, tolerance: 0.02, initial: 10_000,
  };
}
