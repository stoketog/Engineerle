import { rng } from './rand';
import { parseExpr, sample, type Fn } from './expr';

/**
 * Read the equation off the graph. Two skins share this module: the plain curve puzzle (in x) and the oscilloscope
 * waveform (a sine in t, with a volts-per-division and time-per-division graticule).
 */

export type GraphFamily = 'quadratic' | 'cubic' | 'sine' | 'exponential' | 'rational' | 'abs-shift' | 'waveform';

export interface GraphSpec {
  kind: 'graph' | 'waveform';
  family: GraphFamily;
  /** Coefficients, meaning depends on the family (see `graphFn`). */
  c: number[];
  /** Waveforms only: the scope settings, volts per division and seconds per division. The screen is 10 by 8 divisions. */
  scope?: { vdiv: number; tdiv: number };
  /** The answer as the setter would write it (shown on a miss, never to be matched literally). */
  answer: string;
  view: { xmin: number; xmax: number; ymin: number; ymax: number };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));
const sgn = (n: number) => (n < 0 ? ` - ${fmt(-n)}` : ` + ${fmt(n)}`);

export function graphFn(s: GraphSpec): Fn {
  const c = s.c;
  switch (s.family) {
    case 'quadratic': return (x) => c[0] * (x - c[1]) ** 2 + c[2];
    case 'cubic': return (x) => c[0] * (x - c[1]) * (x - c[2]) * (x - c[3]);
    case 'sine': return (x) => c[0] * Math.sin(c[1] * x) + c[2];
    case 'exponential': return (x) => c[0] * c[1] ** x + c[2];
    case 'rational': return (x) => c[0] / (x - c[1]) + c[2];
    case 'abs-shift': return (x) => c[0] * Math.abs(x - c[1]) + c[2];
    // amplitude (V), frequency (Hz), phase (rad), offset (V); x is time in seconds
    case 'waveform': return (t) => c[0] * Math.sin(2 * Math.PI * c[1] * t + c[2]) + c[3];
  }
}

/** The phase k·15° written as a short fraction of pi, e.g. 5 -> "5 pi/12", 6 -> "pi/2". */
function phaseText(k: number): string {
  if (k === 0) return '';
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(k, 12);
  const num = k / d, den = 12 / d;
  return ` + ${num === 1 ? '' : num + ' '}pi${den === 1 ? '' : '/' + den}`;
}

/**
 * An oscilloscope trace: v(t) = A sin(2 pi f t + p) + c. A is 0.5 to 5 V in half-volt steps, f from 50 Hz to 5 kHz, p a
 * multiple of 15 degrees, c zero or a multiple of half a volt. The scope is set so the trace fits the screen with a period
 * that is a whole number of half-divisions, 2 to 5 periods across the ten divisions, and an amplitude of at least one division.
 */
export function makeWaveform(seed: number): GraphSpec {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const TDIV = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01]; // seconds per division
  const PERIOD_DIVS = [2, 2.5, 4, 5];
  const VDIV = [0.1, 0.2, 0.5, 1, 2];
  for (;;) {
    const tdiv = pick(TDIV), k = pick(PERIOD_DIVS);
    const f = Math.round(1 / (k * tdiv));
    if (f < 50 || f > 5000 || Math.abs(f * k * tdiv - 1) > 1e-9) continue;
    const A = (1 + Math.floor(r() * 10)) / 2;
    const c = pick([0, 0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]);
    // the largest volts/division that still gives the wave at least one division of amplitude and keeps it on screen
    const vdiv = [...VDIV].reverse().find((v) => A / v >= 1 && (A + Math.abs(c)) / v <= 3.8);
    if (vdiv === undefined) continue;
    const kp = Math.floor(r() * 24);
    const p = (kp * Math.PI) / 12;
    const num = (n: number) => String(Number(n.toFixed(3)));
    const answer = `${num(A)} sin(2 pi ${f} t${phaseText(kp)})${c === 0 ? '' : c < 0 ? ` - ${num(-c)}` : ` + ${num(c)}`}`;
    return {
      kind: 'waveform',
      family: 'waveform',
      c: [A, f, p, c],
      answer,
      view: { xmin: 0, xmax: 10 * tdiv, ymin: -4 * vdiv, ymax: 4 * vdiv },
      scope: { vdiv, tdiv },
    };
  }
}

export function makeGraph(seed: number): GraphSpec {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const family = pick<GraphFamily>(['quadratic', 'cubic', 'sine', 'exponential', 'rational', 'abs-shift', 'quadratic', 'sine', 'exponential']);
  let c: number[] = [];
  let answer = '';
  const view = { xmin: -8, xmax: 8, ymin: -8, ymax: 8 };
  switch (family) {
    case 'quadratic': {
      const a = pick([-2, -1, -0.5, 0.5, 1, 2]);
      const h = int(-3, 3), k = int(-4, 4);
      c = [a, h, k];
      answer = `${a === 1 ? '' : a === -1 ? '-' : fmt(a)}${h === 0 ? 'x' : `(x${h < 0 ? ` + ${fmt(-h)}` : ` - ${fmt(h)}`})`}^2${k === 0 ? '' : sgn(k)}`;
      view.ymin = Math.min(-6, k - 4); view.ymax = Math.max(6, k + 6);
      if (a < 0) { view.ymin = Math.min(-8, k - 6); view.ymax = Math.max(4, k + 3); }
      break;
    }
    case 'cubic': {
      const roots = [int(-4, -1), int(-1, 2), int(2, 4)];
      const a = pick([0.25, 0.5, -0.25, -0.5, 1, -1]);
      c = [a, ...roots];
      answer = `${fmt(a)}(x${roots[0] < 0 ? ` + ${fmt(-roots[0])}` : roots[0] > 0 ? ` - ${fmt(roots[0])}` : ''})(x${roots[1] < 0 ? ` + ${fmt(-roots[1])}` : roots[1] > 0 ? ` - ${fmt(roots[1])}` : ''})(x${roots[2] < 0 ? ` + ${fmt(-roots[2])}` : ` - ${fmt(roots[2])}`})`;
      view.ymin = -8; view.ymax = 8;
      break;
    }
    case 'sine': {
      const A = pick([1, 2, 3, 4]);
      const B = pick([0.5, 1, 1, 2]);
      const D = pick([0, 0, 1, -1, 2]);
      c = [A, B, D];
      answer = `${fmt(A)}sin(${B === 1 ? '' : fmt(B)}x)${D === 0 ? '' : sgn(D)}`;
      view.xmin = -10; view.xmax = 10; view.ymin = -7; view.ymax = 7;
      break;
    }
    case 'exponential': {
      const b = pick([2, 3, 0.5, 2]);
      const a = pick([1, 2, 0.5, -1, 3]);
      const d = pick([0, 0, -1, 1, 2]);
      c = [a, b, d];
      answer = `${a === 1 ? '' : a === -1 ? '-' : fmt(a) + '*'}${b}^x${d === 0 ? '' : sgn(d)}`;
      view.xmin = -6; view.xmax = 6; view.ymin = -4; view.ymax = 12;
      break;
    }
    case 'rational': {
      const a = pick([1, 2, -1, -2, 4]);
      const h = int(-3, 3), k = int(-3, 3);
      c = [a, h, k];
      answer = `${fmt(a)}/(x${h === 0 ? '' : h < 0 ? ` + ${fmt(-h)}` : ` - ${fmt(h)}`})${k === 0 ? '' : sgn(k)}`;
      view.xmin = -8; view.xmax = 8; view.ymin = -8; view.ymax = 8;
      break;
    }
    case 'abs-shift': {
      const a = pick([1, 2, -1, -2, 0.5]);
      const h = int(-4, 4), k = int(-4, 4);
      c = [a, h, k];
      answer = `${fmt(a)}*abs(x${h === 0 ? '' : h < 0 ? ` + ${fmt(-h)}` : ` - ${fmt(h)}`})${k === 0 ? '' : sgn(k)}`;
      view.ymin = -8; view.ymax = 8;
      break;
    }
  }
  return { kind: 'graph', family, c, answer, view };
}

export interface GraphVerdict {
  ok: boolean;
  /** Share of the sampled graph the answer lies on (0–1). */
  match: number;
  /** Set when the text could not be read. */
  error?: string;
}

/** Compare a typed equation against the target on a fixed set of sample points. */
export function checkGraph(spec: GraphSpec, text: string): GraphVerdict {
  let f: Fn;
  try {
    f = parseExpr(text, spec.kind === 'waveform' ? 't' : 'x');
  } catch (e) {
    return { ok: false, match: 0, error: (e as Error).message };
  }
  const t = graphFn(spec);
  const { xmin, xmax, ymin, ymax } = spec.view;
  const tol = 0.012 * (ymax - ymin);
  const N = 81;
  const a = sample(t, xmin, xmax, N), b = sample(f, xmin, xmax, N);
  // an expression that gives no number anywhere (1/0, ln(-1)) draws nothing: refuse it rather than count it as a miss
  if (b.every((v) => Number.isNaN(v))) return { ok: false, match: 0, error: 'That gives no values to draw' };
  let seen = 0, good = 0;
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(a[i])) continue; // the target is undefined here (an asymptote)
    seen++;
    if (!Number.isNaN(b[i]) && Math.abs(a[i] - b[i]) <= tol) good++;
  }
  const match = seen ? good / seen : 0;
  return { ok: seen > 10 && good === seen, match };
}
