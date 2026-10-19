'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkGraph, graphFn, type GraphSpec } from '@/engineerle/graph';
import { parseExpr, type Fn } from '@/engineerle/expr';
import { PUZZLES, MAX_ATTEMPTS } from '@/engineerle/daily';
import { resolveTheme } from '@/lib/settings';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps } from './Board';

const INFO = PUZZLES[0];
const M = { l: 38, r: 10, t: 10, b: 24 };
const HAND = '"Bradley Hand", "Segoe Print", "Segoe Script", "Comic Sans MS", "Marker Felt", cursive';
const KEYS: Array<[string, string]> = [['x', 'x'], ['^', '^'], ['( )', '()'], ['π', 'π'], ['√', '√('], ['sin', 'sin('], ['cos', 'cos('], ['e^', 'e^'], ['ln', 'ln('], ['|x|', '|']];

const nice = (raw: number) => {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
};
const fmt = (n: number) => String(Number(n.toFixed(2)));

interface Anim {
  t0: number;
  text: string;
  fn: Fn | null;
  ok: boolean;
  bad: number[];
}

export function GraphPuzzle({ spec, record, onAttempt }: PuzzleProps<GraphSpec>) {
  const { settings, play } = useSettings();
  const theme = resolveTheme(settings.theme);
  const view = spec.view;
  const target = useMemo(() => graphFn(spec), [spec]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pins, setPins] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const anim = useRef<Anim | null>(null);
  const pending = useRef<null | boolean>(null);
  const raf = useRef(0);
  const done = record.done;
  const preview = useMemo<Fn | null>(() => {
    try {
      return text.trim() ? parseExpr(text) : null;
    } catch {
      return null;
    }
  }, [text]);
  const state = useRef({ text, preview, pins, hover, done, theme, target, view, spec });
  state.current = { text, preview, pins, hover, done, theme, target, view, spec };

  // clean points the curve passes through exactly: a gift to read the graph by
  const lattice = useMemo(() => {
    const pts: Array<[number, number]> = [];
    for (let x = Math.ceil(view.xmin); x <= view.xmax; x++) {
      const y = target(x);
      if (Number.isFinite(y) && y >= view.ymin && y <= view.ymax && Math.abs(y - Math.round(y)) < 0.02) pts.push([x, Math.round(y)]);
    }
    return pts;
  }, [target, view]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const s = state.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const dark = s.theme === 'dark';
    const ink = dark ? '#e7f2fc' : '#0f3256';
    const mute = dark ? 'rgba(150,200,245,0.55)' : 'rgba(25,75,130,0.55)';
    const faint = dark ? 'rgba(150,200,245,0.14)' : 'rgba(25,75,130,0.14)';
    const accent = dark ? '#ff8a3d' : '#e2570a';
    const cool = dark ? '#5cc8ff' : '#0a6aa8';
    const ok = dark ? '#7be0a1' : '#137a43';
    const v = s.view;
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = (x: number) => M.l + ((x - v.xmin) / (v.xmax - v.xmin)) * pw;
    const Y = (y: number) => M.t + (1 - (y - v.ymin) / (v.ymax - v.ymin)) * ph;
    const stepX = nice((v.xmax - v.xmin) / 8), stepY = nice((v.ymax - v.ymin) / 6);

    g.font = '600 10px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    for (let x = Math.ceil(v.xmin / stepX) * stepX; x <= v.xmax + 1e-9; x += stepX) {
      g.strokeStyle = faint;
      g.beginPath();
      g.moveTo(X(x), M.t);
      g.lineTo(X(x), M.t + ph);
      g.stroke();
      g.fillStyle = mute;
      g.textAlign = 'center';
      g.fillText(fmt(x), X(x), M.t + ph + 12);
    }
    for (let y = Math.ceil(v.ymin / stepY) * stepY; y <= v.ymax + 1e-9; y += stepY) {
      g.strokeStyle = faint;
      g.beginPath();
      g.moveTo(M.l, Y(y));
      g.lineTo(M.l + pw, Y(y));
      g.stroke();
      g.fillStyle = mute;
      g.textAlign = 'right';
      g.fillText(fmt(y), M.l - 5, Y(y));
    }
    g.strokeStyle = mute;
    g.lineWidth = 1.6;
    g.beginPath();
    if (v.xmin < 0 && v.xmax > 0) {
      g.moveTo(X(0), M.t);
      g.lineTo(X(0), M.t + ph);
    }
    if (v.ymin < 0 && v.ymax > 0) {
      g.moveTo(M.l, Y(0));
      g.lineTo(M.l + pw, Y(0));
    }
    g.stroke();

    const plot = (f: Fn, color: string, width: number, dash: number[] = [], upto = v.xmax) => {
      g.save();
      g.beginPath();
      g.rect(M.l, M.t, pw, ph);
      g.clip();
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.setLineDash(dash);
      g.beginPath();
      let prev = NaN, pen = false;
      const n = Math.max(2, Math.round(pw));
      for (let i = 0; i <= n; i++) {
        const x = v.xmin + ((v.xmax - v.xmin) * i) / n;
        if (x > upto) break;
        const y = f(x);
        const jump = Number.isFinite(prev) && Math.abs(y - prev) > (v.ymax - v.ymin) * 0.9;
        if (!Number.isFinite(y) || jump) {
          pen = false;
        } else if (!pen) {
          g.moveTo(X(x), Y(y));
          pen = true;
        } else g.lineTo(X(x), Y(y));
        prev = y;
      }
      g.stroke();
      g.restore();
    };

    const a = anim.current;
    const tNow = performance.now();
    // the answer is revealed once the puzzle is done (and the animation has played)
    if (s.done && !a) plot(s.target, ok, 3);
    else plot(s.target, ink, 2.6);
    // after the animation, show how the guess compares
    // live preview while typing
    if (!a && s.preview && !s.done) plot(s.preview, accent, 2, [7, 5]);

    for (const [x, y] of lattice) {
      g.fillStyle = accent;
      g.beginPath();
      g.arc(X(x), Y(y), 3.2, 0, Math.PI * 2);
      g.fill();
    }
    // pins read the curve off at a chosen x
    for (const px of s.pins) {
      const py = s.target(px);
      if (!Number.isFinite(py) || py < v.ymin || py > v.ymax) continue;
      g.strokeStyle = cool;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(px), Y(py));
      g.lineTo(X(px), Y(0 < v.ymin ? v.ymin : 0 > v.ymax ? v.ymax : 0));
      g.moveTo(X(px), Y(py));
      g.lineTo(X(0 < v.xmin ? v.xmin : 0 > v.xmax ? v.xmax : 0), Y(py));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = cool;
      g.beginPath();
      g.arc(X(px), Y(py), 4, 0, Math.PI * 2);
      g.fill();
      const label = `(${fmt(px)}, ${fmt(py)})`;
      g.font = '600 11px ui-monospace, Menlo, monospace';
      const tw = g.measureText(label).width + 10;
      const lx = Math.min(W - tw - 4, Math.max(M.l + 2, X(px) + 8)), ly = Math.max(M.t + 12, Y(py) - 14);
      g.fillStyle = dark ? 'rgba(6,26,48,0.92)' : 'rgba(255,255,255,0.94)';
      g.fillRect(lx, ly - 9, tw, 18);
      g.fillStyle = ink;
      g.textAlign = 'left';
      g.fillText(label, lx + 5, ly);
    }
    if (s.hover !== null && !a) {
      const hx = s.hover;
      g.strokeStyle = mute;
      g.lineWidth = 1;
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(X(hx), M.t);
      g.lineTo(X(hx), M.t + ph);
      g.stroke();
      g.setLineDash([]);
      const hy = s.target(hx);
      if (Number.isFinite(hy) && hy >= v.ymin && hy <= v.ymax) {
        g.fillStyle = ink;
        g.beginPath();
        g.arc(X(hx), Y(hy), 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    if (a) {
      const t = (tNow - a.t0) / 1000;
      const writeT = Math.min(1, t / 1.5);
      // 1. the equation is written out by hand, a pencil dot following the line
      const label = `y = ${a.text.replace(/^\s*(y|f\(x\))\s*=\s*/i, '')}`;
      g.font = `600 22px ${HAND}`;
      const tw = g.measureText(label).width;
      const bx = M.l + 12, by = M.t + 34;
      g.save();
      g.fillStyle = dark ? 'rgba(6,26,48,0.88)' : 'rgba(255,255,255,0.92)';
      g.fillRect(bx - 8, by - 24, Math.min(pw - 24, tw + 22), 40);
      g.beginPath();
      g.rect(bx - 4, by - 26, tw * writeT + 8, 44);
      g.clip();
      g.fillStyle = ink;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillText(label, bx, by);
      g.restore();
      if (writeT < 1) {
        g.fillStyle = accent;
        g.beginPath();
        g.arc(bx + tw * writeT, by - 6 + Math.sin(t * 40) * 4, 3, 0, Math.PI * 2);
        g.fill();
      } else {
        // a quick underline scribble
        const u = Math.min(1, (t - 1.5) / 0.35);
        g.strokeStyle = accent;
        g.lineWidth = 2;
        g.beginPath();
        const steps = Math.round(24 * u);
        for (let i = 0; i <= steps; i++) {
          const px = bx + (tw * i) / 24, py = by + 8 + (i % 2 ? -2.5 : 2.5);
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      }
      g.textBaseline = 'middle';
      // 2. their curve is drawn across the graph
      if (a.fn && t > 1.6) {
        const p = Math.min(1, (t - 1.6) / 1.6);
        const upto = v.xmin + (v.xmax - v.xmin) * p;
        plot(a.fn, a.ok ? ok : accent, 3, [], upto);
        const yy = a.fn(upto);
        if (Number.isFinite(yy)) {
          g.fillStyle = accent;
          g.beginPath();
          g.arc(X(upto), Y(Math.min(v.ymax, Math.max(v.ymin, yy))), 4, 0, Math.PI * 2);
          g.fill();
        }
        // 3. where it leaves the target, a red band marks the miss
        if (!a.ok) {
          g.fillStyle = dark ? 'rgba(255,123,123,0.2)' : 'rgba(194,42,42,0.16)';
          for (const bx2 of a.bad) if (bx2 <= upto) g.fillRect(X(bx2) - 2, M.t, 4, ph);
        }
      }
    }
  }, [lattice]);

  // keep the canvas sharp and redrawn on size changes and state changes
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);
  useEffect(draw, [draw, text, preview, pins, hover, done, theme]);

  const finish = useCallback(
    (ok: boolean) => {
      if (pending.current === null) return;
      pending.current = null;
      anim.current = null;
      setBusy(false);
      cancelAnimationFrame(raf.current);
      onAttempt(ok);
      draw();
    },
    [onAttempt, draw],
  );
  // a guess that was still animating when the player left must still count
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const lastOk = useRef(false);
  useEffect(
    () => () => {
      if (pending.current !== null) finishRef.current(lastOk.current);
    },
    [],
  );

  const submit = () => {
    if (busy || done || !text.trim()) return;
    let fn: Fn | null = null;
    try {
      fn = parseExpr(text);
    } catch (e) {
      setMsg({ k: 'bad', t: `${(e as Error).message} — this didn't use up a guess.` });
      play('wrong');
      return;
    }
    const verdict = checkGraph(spec, text);
    const bad: number[] = [];
    const tol = 0.012 * (view.ymax - view.ymin);
    for (let i = 0; i <= 80; i++) {
      const x = view.xmin + ((view.xmax - view.xmin) * i) / 80;
      const a = target(x), b = fn(x);
      if (Number.isFinite(a) && !(Number.isFinite(b) && Math.abs(a - b) <= tol)) bad.push(x);
    }
    setMsg(null);
    setBusy(true);
    lastOk.current = verdict.ok;
    pending.current = verdict.ok;
    anim.current = { t0: performance.now(), text, fn, ok: verdict.ok, bad };
    const attemptNo = record.attempts + 1;
    const after = () => {
      if (verdict.ok) setMsg({ k: 'ok', t: 'That is the curve. Every point lines up.' });
      else {
        const pct = Math.round(verdict.match * 100);
        const hint = attemptNo === 1 ? spec.hints[0] : attemptNo === 2 ? spec.hints[1] : null;
        setMsg({ k: 'bad', t: attemptNo >= MAX_ATTEMPTS ? `Out of guesses. It was y = ${spec.answer}.` : `Your curve sits on the target for ${pct}% of the graph.${hint ? ` Hint: ${hint}` : ''}` });
      }
      finish(verdict.ok);
    };
    if (settings.reduceMotion) {
      after();
      return;
    }
    play('scribble', 1);
    const tick = () => {
      draw();
      const t = performance.now() - (anim.current?.t0 ?? 0);
      if (t > 3400) after();
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const coordOf = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const pw = r.width - M.l - M.r;
    const x = view.xmin + ((e.clientX - r.left - M.l) / pw) * (view.xmax - view.xmin);
    return Math.min(view.xmax, Math.max(view.xmin, x));
  };
  const snap = (x: number) => Math.round(x * 2) / 2;
  const insert = (s: string) => setText((t) => t + s);

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-graph"
      view={
        <div ref={box} className="ens-view" data-testid="graph-view">
          <canvas
            ref={canvas}
            aria-label="Graph of the curve. Tap to read a value."
            onPointerMove={(e) => setHover(coordOf(e))}
            onPointerLeave={() => setHover(null)}
            onPointerUp={(e) => {
              const x = snap(coordOf(e));
              setPins((p) => (p.includes(x) ? p.filter((q) => q !== x) : [...p.slice(-3), x]));
              play('snap');
            }}
          />
          {hover !== null && !busy && <div className="ens-readout r">x = {fmt(hover)}</div>}
          {!done && pins.length === 0 && hover === null && <div className="ens-readout r">Tap the graph to read it</div>}
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="graph-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}The curve is <b className="font-mono">y = {spec.answer}</b>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert a symbol">
            {KEYS.map(([label, ins]) => (
              <button key={label} className="ens-chip" type="button" data-silent onClick={() => insert(ins)} aria-label={`insert ${label}`}>
                {label}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="flex-1">
              <span className="sr-only">Equation</span>
              <input
                className="ens-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="y = …   e.g. 2x^2 - 3"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                disabled={busy}
                data-testid="graph-input"
                aria-label="Equation"
              />
            </label>
            <button className="ens-btn" type="submit" disabled={busy || !text.trim()} data-testid="graph-submit">
              Submit
            </button>
          </form>
          {text.trim() && !preview && <p className="ens-label">Not readable yet: check brackets and symbols.</p>}
          {preview && <p className="ens-label">The dashed line previews your equation.</p>}
        </>
      )}
      {msg && !done && <Note kind={msg.k} testId="graph-msg">{msg.t}</Note>}
    </Board>
  );
}
