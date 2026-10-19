/**
 * A small, safe maths-expression parser for the graph puzzle: no eval, just a recursive-descent parser.
 * Accepts what people actually type: "2x^2 - 3", "y = 3sin(2x)+1", "(x-1)(x+2)", "2^x", "e^(0.5x)", "x²", "|x|".
 */

export type Fn = (x: number) => number;

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs, cbrt: Math.cbrt, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

function normalise(src: string): string {
  let s = src.toLowerCase().trim();
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => '^(' + [...m].map((c) => SUPERSCRIPT[c]).join('') + ')');
  s = s.replace(/[×·∙]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/\*\*/g, '^').replace(/\s+/g, ' ');
  // drop a leading "y =" or "f(x) ="
  s = s.replace(/^\s*(y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\))\s*=\s*/, '');
  return s;
}

function tokenise(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error('Bad number');
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      let word = s.slice(i, j);
      // "2xsin" style runs: split a run of letters into known pieces (xx, xsin(x), xe, pix)
      while (word.length) {
        const known = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x'].sort((a, b) => b.length - a.length).find((k) => word.startsWith(k));
        if (!known) throw new Error(`Unknown "${word}"`);
        out.push({ t: 'id', v: known });
        word = word.slice(known.length);
      }
      i = j;
      continue;
    }
    if ('+-*/^()|'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

/** Parse an expression in x. Throws an Error with a short, readable message when it can't be read. */
export function parseExpr(src: string): Fn {
  const toks = tokenise(normalise(src));
  if (!toks.length) throw new Error('Type an equation');
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;

  type Node = (x: number) => number;
  const startsAtom = () => {
    const k = peek();
    if (!k) return false;
    return k.t === 'num' || k.t === 'id' || (k.t === 'op' && (k.v === '(' || k.v === '|'));
  };

  function expr(): Node {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const plus = (toks[p++] as { v: string }).v === '+';
      const l = left, r = term();
      left = plus ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return left;
  }
  function term(): Node {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const mul = (toks[p++] as { v: string }).v === '*';
        const l = left, r = unary();
        left = mul ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
      } else if (startsAtom() && !isOp('|')) {
        // implicit multiplication: 2x, 3(x+1), x sin(x), (x-1)(x+2)
        const l = left, r = unary();
        left = (x) => l(x) * r(x);
      } else break;
    }
    return left;
  }
  function unary(): Node {
    if (isOp('-')) { p++; const v = unary(); return (x) => -v(x); }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power(): Node {
    const base = atom();
    if (isOp('^')) {
      p++;
      const exp = unary(); // right-associative, and allows 2^-x
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }
  function atom(): Node {
    const k = toks[p++];
    if (!k) throw new Error('The equation ends too soon');
    if (k.t === 'num') return () => k.v;
    if (k.t === 'op') {
      if (k.v === '(') {
        const v = expr();
        if (!isOp(')')) throw new Error('Missing )');
        p++;
        return v;
      }
      if (k.v === '|') {
        const v = expr();
        if (!isOp('|')) throw new Error('Missing |');
        p++;
        return (x) => Math.abs(v(x));
      }
      throw new Error(`Unexpected "${k.v}"`);
    }
    if (k.v === 'x') return (x) => x;
    if (k.v in CONSTS) return () => CONSTS[k.v];
    const fn = FUNCS[k.v];
    if (!fn) throw new Error(`Unknown "${k.v}"`);
    // function call: sin(x), or sin x / sin 2x (argument binds tighter than * but takes a power)
    let arg: Node;
    if (isOp('(')) {
      p++;
      arg = expr();
      if (!isOp(')')) throw new Error('Missing )');
      p++;
    } else {
      arg = power();
    }
    // sin(x)^2 reads as (sin x)^2
    return (x) => fn(arg(x));
  }

  const f = expr();
  if (p < toks.length) throw new Error(`Unexpected "${(toks[p] as { v: string | number }).v}"`);
  return f;
}

/** Sample a function; non-finite values become NaN. */
export function sample(f: Fn, xmin: number, xmax: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = f(xmin + ((xmax - xmin) * i) / (n - 1));
    out.push(Number.isFinite(v) ? v : NaN);
  }
  return out;
}
