'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkGraph, graphFn, type GraphSpec } from '@/engineerle/graph';
import { parseExpr, type Fn } from '@/engineerle/expr';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { resolveTheme } from '@/lib/settings';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps } from './Board';

const INFO = byId('waveform')!;
const MP = { l: 38, r: 10, t: 10, b: 24 };
const MS = { l: 8, r: 8, t: 8, b: 8 }; // the scope screen has no axis numbers, only its graticule
const PHOSPHOR = '#5dff9f';
const HAND = '"Bradley Hand", "Segoe Print", "Segoe Script", "Comic Sans MS", "Marker Felt", cursive';
const KEYS: Array<[string, string]> = [['x', 'x'], ['^', '^'], ['( )', '()'], ['π', 'π'], ['√', '√('], ['sin', 'sin('], ['cos', 'cos('], ['e^', 'e^'], ['ln', 'ln('], ['|x|', '|']];
const SCOPE_KEYS: Array<[string, string]> = [['t', 't'], ['π', 'π'], ['( )', '()'], ['sin', 'sin('], ['cos', 'cos('], ['°', ' deg'], ['+', ' + '], ['−', ' - '], ['×', '*'], ['÷', '/']];

const nice = (raw: number) => {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
};
const fmt = (n: number) => String(Number(n.toFixed(2)));
const fmtVolts = (v: number) => (Math.abs(v) < 1 && v !== 0 ? `${Number((v * 1000).toPrecision(3))} mV` : `${Number(v.toPrecision(3))} V`);
const fmtSeconds = (t: number) => (Math.abs(t) >= 1 ? `${Number(t.toPrecision(3))} s` : Math.abs(t) >= 1e-3 || t === 0 ? `${Number((t * 1e3).toPrecision(3))} ms` : `${Number((t * 1e6).toPrecision(3))} µs`);

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
  const scope = spec.kind === 'waveform';
  const m = scope ? MS : MP;
  const variable = scope ? 't' : 'x';
  const target = useMemo(() => graphFn(spec), [spec]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
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
      return text.trim() ? parseExpr(text, variable) : null;
    } catch {
      return null;
    }
  }, [text, variable]);
  const state = useRef({ text, preview, pins, hover, done, theme, target, view, spec, scope });
  state.current = { text, preview, pins, hover, done, theme, target, view, spec, scope };

  // clean points the curve passes through exactly: a gift to read the graph by
  const lattice = useMemo(() => {
    const pts: Array<[number, number]> = [];
    if (scope) return pts;
    for (let x = Math.ceil(view.xmin); x <= view.xmax; x++) {
      const y = target(x);
      if (Number.isFinite(y) && y >= view.ymin && y <= view.ymax && Math.abs(y - Math.round(y)) < 0.02) pts.push([x, Math.round(y)]);
    }
    return pts;
  }, [target, view, scope]);

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
    const sc = s.scope;
    const M = sc ? MS : MP;
    // a scope screen is always dark, whatever the theme
    const dark = sc || s.theme === 'dark';
    const ink = sc ? '#d8ffe8' : dark ? '#e7f2fc' : '#0f3256';
    const mute = sc ? 'rgba(120,255,170,0.55)' : dark ? 'rgba(150,200,245,0.55)' : 'rgba(25,75,130,0.55)';
    const faint = sc ? 'rgba(90,255,160,0.16)' : dark ? 'rgba(150,200,245,0.14)' : 'rgba(25,75,130,0.14)';
    const accent = sc ? '#ffb347' : dark ? '#ff8a3d' : '#e2570a';
    const cool = sc ? '#5cc8ff' : dark ? '#5cc8ff' : '#0a6aa8';
    const ok = sc ? PHOSPHOR : dark ? '#7be0a1' : '#137a43';
    const v = s.view;
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = (x: number) => M.l + ((x - v.xmin) / (v.xmax - v.xmin)) * pw;
    const Y = (y: number) => M.t + (1 - (y - v.ymin) / (v.ymax - v.ymin)) * ph;
    const stepX = nice((v.xmax - v.xmin) / 8), stepY = nice((v.ymax - v.ymin) / 6);
    if (sc) {
      g.fillStyle = '#04140d';
      g.fillRect(0, 0, W, H);
    }

    g.font = '600 10px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    if (sc) {
      // the graticule: ten divisions across, eight up, a brighter centre cross with five ticks per division
      const dx = pw / 10, dy = ph / 8;
      g.strokeStyle = faint;
      g.beginPath();
      for (let i = 0; i <= 10; i++) { g.moveTo(M.l + i * dx, M.t); g.lineTo(M.l + i * dx, M.t + ph); }
      for (let j = 0; j <= 8; j++) { g.moveTo(M.l, M.t + j * dy); g.lineTo(M.l + pw, M.t + j * dy); }
      g.stroke();
      g.strokeStyle = mute;
      g.beginPath();
      g.moveTo(M.l + 5 * dx, M.t); g.lineTo(M.l + 5 * dx, M.t + ph);
      g.moveTo(M.l, M.t + 4 * dy); g.lineTo(M.l + pw, M.t + 4 * dy);
      for (let i = 0; i <= 50; i++) { const x = M.l + (i * dx) / 5; g.moveTo(x, M.t + 4 * dy - 3); g.lineTo(x, M.t + 4 * dy + 3); }
      for (let j = 0; j <= 40; j++) { const y = M.t + (j * dy) / 5; g.moveTo(M.l + 5 * dx - 3, y); g.lineTo(M.l + 5 * dx + 3, y); }
      g.stroke();
      // the ground marker: where 0 V sits
      g.fillStyle = cool;
      g.beginPath();
      g.moveTo(M.l, M.t + 4 * dy - 5); g.lineTo(M.l + 8, M.t + 4 * dy); g.lineTo(M.l, M.t + 4 * dy + 5);
      g.fill();
    }
    if (!sc) for (let x = Math.ceil(v.xmin / stepX) * stepX; x <= v.xmax + 1e-9; x += stepX) {
      g.strokeStyle = faint;
      g.beginPath();
      g.moveTo(X(x), M.t);
      g.lineTo(X(x), M.t + ph);
      g.stroke();
      g.fillStyle = mute;
      g.textAlign = 'center';
      g.fillText(fmt(x), X(x), M.t + ph + 12);
    }
    if (!sc) for (let y = Math.ceil(v.ymin / stepY) * stepY; y <= v.ymax + 1e-9; y += stepY) {
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
    if (!sc && v.xmin < 0 && v.xmax > 0) {
      g.moveTo(X(0), M.t);
      g.lineTo(X(0), M.t + ph);
    }
    if (!sc && v.ymin < 0 && v.ymax > 0) {
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
      if (sc) {
        g.shadowColor = color;
        g.shadowBlur = 7;
      }
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
    else plot(s.target, sc ? PHOSPHOR : ink, 2.6);
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
      const label = sc ? `(${fmtSeconds(px)}, ${fmtVolts(py)})` : `(${fmt(px)}, ${fmt(py)})`;
      g.font = '600 11px ui-monospace, Menlo, monospace';
      const tw = g.measureText(label).width + 10;
      const lx = Math.min(W - tw - 4, Math.max(M.l + 2, X(px) + 8)), ly = Math.max(M.t + 12, Y(py) - 14);
      g.fillStyle = sc ? 'rgba(2,20,12,0.94)' : dark ? 'rgba(6,26,48,0.92)' : 'rgba(255,255,255,0.94)';
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
      const label = `${sc ? 'v(t)' : 'y'} = ${a.text.replace(/^\s*(y|v|[fg]\(x\)|v\(t\))\s*=\s*/i, '')}`;
      g.font = `600 22px ${HAND}`;
      const tw = g.measureText(label).width;
      const bx = M.l + 12, by = M.t + 34;
      g.save();
      g.fillStyle = sc ? 'rgba(2,20,12,0.9)' : dark ? 'rgba(6,26,48,0.88)' : 'rgba(255,255,255,0.92)';
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
    const verdict = checkGraph(spec, text);
    if (verdict.error) {
      setMsg({ k: 'bad', t: `${verdict.error} — this didn't use up a guess.` });
      play('wrong');
      return;
    }
    const fn = parseExpr(text, variable);
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
      if (verdict.ok) setMsg({ k: 'ok', t: scope ? 'That is the signal. Your trace sits exactly on the screen trace.' : 'That is the curve. Every point lines up.' });
      else {
        const left = MAX_ATTEMPTS - attemptNo;
        setMsg({ k: 'bad', t: attemptNo >= MAX_ATTEMPTS ? `Out of guesses. It was ${scope ? 'v(t)' : 'y'} = ${spec.answer}.` : `${scope ? 'Not that signal' : 'Not that curve'}. ${left} ${left === 1 ? 'guess' : 'guesses'} left.` });
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
    const pw = r.width - m.l - m.r;
    const x = view.xmin + ((e.clientX - r.left - m.l) / pw) * (view.xmax - view.xmin);
    return Math.min(view.xmax, Math.max(view.xmin, x));
  };
  const snap = (x: number) => (scope ? Math.round(x / (spec.scope!.tdiv / 5)) * (spec.scope!.tdiv / 5) : Math.round(x * 2) / 2);
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
            aria-label={scope ? "Oscilloscope screen showing a signal. Tap to place a cursor." : "Graph of the curve. Tap to read a value."}
            onPointerMove={(e) => setHover(coordOf(e))}
            onPointerLeave={() => setHover(null)}
            onPointerUp={(e) => {
              const x = snap(coordOf(e));
              setPins((p) => (p.includes(x) ? p.filter((q) => q !== x) : [...p.slice(-3), x]));
              play('snap');
            }}
          />
          {scope && spec.scope && (
            <div className="ens-readout" data-testid="scope-scales">
              {fmtVolts(spec.scope.vdiv)}/div · {fmtSeconds(spec.scope.tdiv)}/div
            </div>
          )}
          {hover !== null && !busy && <div className="ens-readout r">{scope ? `t = ${fmtSeconds(hover)}` : `x = ${fmt(hover)}`}</div>}
          {!done && pins.length === 0 && hover === null && <div className="ens-readout r">{scope ? 'Tap the trace to place a cursor' : 'Tap the graph to read it'}</div>}
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="graph-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}The {scope ? 'signal' : 'curve'} is <b className="font-mono">{scope ? 'v(t)' : 'y'} = {spec.answer}</b>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert a symbol">
            {(scope ? SCOPE_KEYS : KEYS).map(([label, ins]) => (
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
                placeholder={scope ? "v(t) = …   e.g. 2*sin(2*pi*500*t)" : "y = …   e.g. 2x^2 - 3"}
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
          {scope && !text.trim() && <p className="ens-label">t is in seconds and v in volts. Use deg for degrees: 30 deg.</p>}
          {text.trim() && !preview && <p className="ens-label">Not readable yet: check brackets and symbols.</p>}
          {preview && <p className="ens-label">The dashed line previews your equation.</p>}
        </>
      )}
      {msg && !done && <Note kind={msg.k} testId="graph-msg">{msg.t}</Note>}
    </Board>
  );
}
