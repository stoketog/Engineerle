import { rng } from './rand';
import { parseExpr, sample, type Fn } from './expr';

/** Puzzle 1: read the equation off the graph. */

export type GraphFamily = 'quadratic' | 'cubic' | 'sine' | 'exponential' | 'rational' | 'abs-shift';

export interface GraphSpec {
  kind: 'graph';
  family: GraphFamily;
  /** Coefficients, meaning depends on the family (see `graphFn`). */
  c: number[];
  /** The answer as the setter would write it (shown on a miss, never to be matched literally). */
  answer: string;
  view: { xmin: number; xmax: number; ymin: number; ymax: number };
  /** A key point and a family hint, revealed after the first and second misses. */
  hints: string[];
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
  }
}

export function makeGraph(seed: number): GraphSpec {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const family = pick<GraphFamily>(['quadratic', 'cubic', 'sine', 'exponential', 'rational', 'abs-shift', 'quadratic', 'sine', 'exponential']);
  let c: number[] = [];
  let answer = '';
  let hints: string[] = [];
  const view = { xmin: -8, xmax: 8, ymin: -8, ymax: 8 };
  switch (family) {
    case 'quadratic': {
      const a = pick([-2, -1, -0.5, 0.5, 1, 2]);
      const h = int(-3, 3), k = int(-4, 4);
      c = [a, h, k];
      answer = `${a === 1 ? '' : a === -1 ? '-' : fmt(a)}${h === 0 ? 'x' : `(x${h < 0 ? ` + ${fmt(-h)}` : ` - ${fmt(h)}`})`}^2${k === 0 ? '' : sgn(k)}`;
      hints = [`It is a parabola. Find its turning point first: it sits at (${h}, ${k}).`, `The turning point is (${h}, ${k}); the curve opens ${a > 0 ? 'upwards' : 'downwards'}. How steeply does it widen?`];
      view.ymin = Math.min(-6, k - 4); view.ymax = Math.max(6, k + 6);
      if (a < 0) { view.ymin = Math.min(-8, k - 6); view.ymax = Math.max(4, k + 3); }
      break;
    }
    case 'cubic': {
      const roots = [int(-4, -1), int(-1, 2), int(2, 4)];
      const a = pick([0.25, 0.5, -0.25, -0.5, 1, -1]);
      c = [a, ...roots];
      answer = `${fmt(a)}(x${roots[0] < 0 ? ` + ${fmt(-roots[0])}` : roots[0] > 0 ? ` - ${fmt(roots[0])}` : ''})(x${roots[1] < 0 ? ` + ${fmt(-roots[1])}` : roots[1] > 0 ? ` - ${fmt(roots[1])}` : ''})(x${roots[2] < 0 ? ` + ${fmt(-roots[2])}` : ` - ${fmt(roots[2])}`})`;
      hints = [`A cubic with three x-intercepts. Read them off: x = ${roots.join(', ')}.`, `The roots are ${roots.join(', ')}. One number is left: the scale in front.`];
      view.ymin = -8; view.ymax = 8;
      break;
    }
    case 'sine': {
      const A = pick([1, 2, 3, 4]);
      const B = pick([0.5, 1, 1, 2]);
      const D = pick([0, 0, 1, -1, 2]);
      c = [A, B, D];
      answer = `${fmt(A)}sin(${B === 1 ? '' : fmt(B)}x)${D === 0 ? '' : sgn(D)}`;
      hints = [`It is a wave. The midline is y = ${D} and it swings ${A} above and below it.`, `Midline y = ${D}, amplitude ${A}. Count how far along x one full cycle takes: the period is ${fmt(Number((2 * Math.PI / B).toFixed(2)))}.`];
      view.xmin = -10; view.xmax = 10; view.ymin = -7; view.ymax = 7;
      break;
    }
    case 'exponential': {
      const b = pick([2, 3, 0.5, 2]);
      const a = pick([1, 2, 0.5, -1, 3]);
      const d = pick([0, 0, -1, 1, 2]);
      c = [a, b, d];
      answer = `${a === 1 ? '' : a === -1 ? '-' : fmt(a) + '*'}${b}^x${d === 0 ? '' : sgn(d)}`;
      hints = [`It never touches y = ${d}: an exponential. It passes through (0, ${fmt(a + d)}).`, `At x = 0 it is ${fmt(a + d)}, and each step in x multiplies the distance from y = ${d} by ${b}.`];
      view.xmin = -6; view.xmax = 6; view.ymin = -4; view.ymax = 12;
      break;
    }
    case 'rational': {
      const a = pick([1, 2, -1, -2, 4]);
      const h = int(-3, 3), k = int(-3, 3);
      c = [a, h, k];
      answer = `${fmt(a)}/(x${h === 0 ? '' : h < 0 ? ` + ${fmt(-h)}` : ` - ${fmt(h)}`})${k === 0 ? '' : sgn(k)}`;
      hints = [`Two lines it never crosses: x = ${h} and y = ${k}. That is a reciprocal curve.`, `Asymptotes x = ${h}, y = ${k}. The top number sets how far the branches sit from them.`];
      view.xmin = -8; view.xmax = 8; view.ymin = -8; view.ymax = 8;
      break;
    }
    case 'abs-shift': {
      const a = pick([1, 2, -1, -2, 0.5]);
      const h = int(-4, 4), k = int(-4, 4);
      c = [a, h, k];
      answer = `${fmt(a)}*abs(x${h === 0 ? '' : h < 0 ? ` + ${fmt(-h)}` : ` - ${fmt(h)}`})${k === 0 ? '' : sgn(k)}`;
      hints = [`A sharp V (or ^): an absolute value. The corner is at (${h}, ${k}).`, `Corner at (${h}, ${k}). Read the slope of one arm: rise over run.`];
      view.ymin = -8; view.ymax = 8;
      break;
    }
  }
  return { kind: 'graph', family, c, answer, view, hints };
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
    f = parseExpr(text);
  } catch (e) {
    return { ok: false, match: 0, error: (e as Error).message };
  }
  const t = graphFn(spec);
  const { xmin, xmax, ymin, ymax } = spec.view;
  const tol = 0.012 * (ymax - ymin);
  const N = 81;
  const a = sample(t, xmin, xmax, N), b = sample(f, xmin, xmax, N);
  let seen = 0, good = 0;
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(a[i])) continue; // the target is undefined here (an asymptote)
    seen++;
    if (!Number.isNaN(b[i]) && Math.abs(a[i] - b[i]) <= tol) good++;
  }
  const match = seen ? good / seen : 0;
  return { ok: seen > 10 && good === seen, match };
}
