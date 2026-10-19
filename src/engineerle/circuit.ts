import { rng } from './rand';

/**
 * The resistor-network puzzle. A DC network with one resistor missing: pick the standard (E24) value that makes the meter read
 * the target. Node voltages come from nodal analysis (Kirchhoff's current law at each node, G·v = i, solved by Gaussian
 * elimination with partial pivoting); see Horowitz and Hill, The Art of Electronics, ch. 1, or Nilsson and Riedel, Electric
 * Circuits, ch. 4.
 */

/** The standard E24 series, one decade (IEC 60063). */
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

/** Every E24 value from 1 ohm to 9.1 megohm, ascending. */
export function ladderValues(): number[] {
  const out: number[] = [];
  for (let d = 0; d <= 6; d++) for (const e of E24) out.push(Number((e * 10 ** d).toPrecision(6)));
  return out;
}

export const MAX_OHMS = 1e7;

/** A value as it is marked on a resistor: 4.7 kΩ, 220 Ω, 1 MΩ. */
export function formatOhms(ohms: number): string {
  const f = (v: number) => String(Number(v.toPrecision(3)));
  if (ohms >= 1e6) return `${f(ohms / 1e6)} MΩ`;
  if (ohms >= 1e3) return `${f(ohms / 1e3)} kΩ`;
  return `${f(ohms)} Ω`;
}

export interface Resistor {
  a: number;
  b: number;
  ohms: number;
}
export interface Source {
  node: number;
  volts: number;
}

/**
 * Node voltages for a network of resistors and ideal voltage sources to ground. Node 0 is ground; a source fixes its node.
 * Throws when a node is not connected to a source or ground through resistors (the equations are singular).
 */
export function solveNetwork(nodes: number, resistors: Resistor[], sources: Source[]): number[] {
  const fixed = new Map<number, number>([[0, 0]]);
  for (const s of sources) fixed.set(s.node, s.volts);
  const free: number[] = [];
  for (let k = 0; k < nodes; k++) if (!fixed.has(k)) free.push(k);
  const idx = new Map(free.map((k, i) => [k, i]));
  const n = free.length;
  const G = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  for (const r of resistors) {
    if (!(r.ohms > 0) || !Number.isFinite(r.ohms)) throw new Error('A resistor needs a positive, finite resistance');
    const g = 1 / r.ohms;
    const ia = idx.get(r.a), ib = idx.get(r.b);
    if (ia !== undefined) {
      G[ia][ia] += g;
      if (ib !== undefined) G[ia][ib] -= g;
      else G[ia][n] += g * fixed.get(r.b)!;
    }
    if (ib !== undefined) {
      G[ib][ib] += g;
      if (ia !== undefined) G[ib][ia] -= g;
      else G[ib][n] += g * fixed.get(r.a)!;
    }
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(G[i][c]) > Math.abs(G[p][c])) p = i;
    if (Math.abs(G[p][c]) < 1e-18) throw new Error('A node is not connected to a source or to ground');
    [G[c], G[p]] = [G[p], G[c]];
    for (let i = c + 1; i < n; i++) {
      const f = G[i][c] / G[c][c];
      if (f === 0) continue;
      for (let j = c; j <= n; j++) G[i][j] -= f * G[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = G[i][n];
    for (let j = i + 1; j < n; j++) s -= G[i][j] * x[j];
    x[i] = s / G[i][i];
  }
  const v = new Array<number>(nodes).fill(0);
  for (const [k, volts] of fixed) v[k] = volts;
  free.forEach((k, i) => (v[k] = x[i]));
  return v;
}

/** Current through each resistor from its `a` end to its `b` end (Ohm's law). */
export const branchCurrents = (resistors: Resistor[], v: number[]) => resistors.map((r) => (v[r.a] - v[r.b]) / r.ohms);

/** Current the source delivers into the network: what leaves its node through the resistors. */
export function sourceCurrent(resistors: Resistor[], v: number[], node: number): number {
  const I = branchCurrents(resistors, v);
  let out = 0;
  resistors.forEach((r, i) => {
    if (r.a === node) out += I[i];
    if (r.b === node) out -= I[i];
  });
  return out;
}

export type Template = 'series' | 'divider' | 'bridge' | 'ladder';

/** What the meter is wired to. Currents are read in mA, voltages in V. */
export type Meter =
  | { kind: 'source' }
  | { kind: 'node'; node: number }
  | { kind: 'across'; a: number; b: number };

export interface CircuitSpec {
  kind: 'circuit';
  template: Template;
  nodes: number;
  /** Fixed resistors in the order the schematic expects; the entry at `free` is a placeholder. */
  resistors: Resistor[];
  /** Which resistor is the one to choose. */
  free: number;
  /** The supply, from ground to this node. */
  source: Source;
  meter: Meter;
  target: { value: number; unit: 'mA' | 'V' };
  /** Fractional tolerance on the reading. */
  tolerance: 0.02;
  /** The value the dial starts on. */
  initial: number;
}

/** What the meter reads with `ohms` in the free slot. */
export function measure(spec: CircuitSpec, ohms: number): number {
  const R = spec.resistors.map((r, i) => (i === spec.free ? { ...r, ohms } : r));
  const v = solveNetwork(spec.nodes, R, [spec.source]);
  const m = spec.meter;
  switch (m.kind) {
    case 'source': return sourceCurrent(R, v, spec.source.node) * 1000;
    case 'node': return v[m.node];
    case 'across': return v[m.a] - v[m.b];
  }
}

export interface Evaluation {
  solved: boolean;
  /** What the meter reads, in the target's units. */
  measured: number;
  /** Set when the value is not a usable resistance; the guess must not be counted. */
  refused?: string;
}

export function evaluate(spec: CircuitSpec, ohms: number): Evaluation {
  if (typeof ohms !== 'number' || !Number.isFinite(ohms) || ohms <= 0) return { solved: false, measured: 0, refused: 'A resistor needs a positive value.' };
  if (ohms > MAX_OHMS) return { solved: false, measured: 0, refused: 'That is more than 10 MΩ, beyond the range of the resistors in the box.' };
  const measured = measure(spec, ohms);
  return { solved: Math.abs(measured - spec.target.value) <= spec.tolerance * Math.abs(spec.target.value), measured };
}

/* ───────────────────────────── generator ───────────────────────────── */

const sig3 = (x: number) => Number(x.toPrecision(3));

export function makeCircuit(seed: number): CircuitSpec {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const all = ladderValues();
  const body = all.filter((v) => v >= 100 && v <= 1e5);
  const volts = [5, 9, 12, 15, 24];
  const templates: Template[] = ['series', 'divider', 'divider', 'ladder', 'ladder', 'bridge', 'series'];
  for (let attempt = 0; attempt < 4000; attempt++) {
    const template = pick(templates);
    const V = pick(volts);
    let nodes = 3;
    let pairs: Array<[number, number]> = [];
    let meters: Meter[] = [];
    switch (template) {
      case 'series':
        nodes = 4;
        pairs = [[1, 2], [2, 3], [3, 0]];
        meters = [{ kind: 'source' }];
        break;
      case 'divider':
        nodes = 3;
        pairs = [[1, 2], [2, 0], [2, 0]];
        meters = [{ kind: 'node', node: 2 }, { kind: 'source' }];
        break;
      case 'ladder':
        nodes = 4;
        pairs = [[1, 2], [2, 0], [2, 3], [3, 0]];
        meters = [{ kind: 'node', node: 3 }, { kind: 'source' }, { kind: 'node', node: 2 }];
        break;
      case 'bridge':
        nodes = 4;
        pairs = [[1, 2], [2, 0], [1, 3], [3, 0], [2, 3]];
        meters = [{ kind: 'across', a: 2, b: 3 }, { kind: 'across', a: 3, b: 2 }];
        break;
    }
    const resistors: Resistor[] = pairs.map(([a, b]) => ({ a, b, ohms: pick(body) }));
    const free = Math.floor(r() * (template === 'bridge' ? 4 : resistors.length));
    const answer = pick(body);
    resistors[free].ohms = answer;
    const meter = pick(meters);
    const spec: CircuitSpec = { kind: 'circuit', template, nodes, resistors, free, source: { node: 1, volts: V }, meter, target: { value: 0, unit: meter.kind === 'source' ? 'mA' : 'V' }, tolerance: 0.02, initial: 1000 };
    let m: number;
    try {
      m = measure(spec, answer);
    } catch {
      continue;
    }
    // a bridge reading must be positive on the + terminal; a current or voltage must be large enough to read
    const mag = spec.target.unit === 'mA' ? [0.1, 60] : meter.kind === 'across' ? [0.1, V] : [0.3, V * 0.96];
    if (!(m >= mag[0] && m <= mag[1])) continue;
    spec.target.value = sig3(m);
    // exactly one standard value answers it, and the starting value does not
    const hits = all.filter((v) => evaluate(spec, v).solved);
    if (hits.length !== 1 || hits[0] !== answer) continue;
    if (evaluate(spec, spec.initial).solved) continue;
    return spec;
  }
  // a plain series string: always has a unique answer
  const resistors: Resistor[] = [{ a: 1, b: 2, ohms: 1000 }, { a: 2, b: 3, ohms: 4700 }, { a: 3, b: 0, ohms: 2200 }];
  const spec: CircuitSpec = { kind: 'circuit', template: 'series', nodes: 4, resistors, free: 1, source: { node: 1, volts: 12 }, meter: { kind: 'source' }, target: { value: 0, unit: 'mA' }, tolerance: 0.02, initial: 1000 };
  spec.target.value = sig3(measure(spec, 4700));
  return spec;
}
