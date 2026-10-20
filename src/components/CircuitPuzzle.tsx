'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { LAYOUTS, dialValues, evaluate, type CircuitSpec } from '@/engineerle/circuit';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps } from './Board';

const INFO = byId('resistor')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;

export const fmtOhms = (o: number) => (o >= 1e6 ? `${Number((o / 1e6).toPrecision(3))} MΩ` : o >= 1e3 ? `${Number((o / 1e3).toPrecision(3))} kΩ` : `${Number(o.toPrecision(3))} Ω`);
const fmtReading = (spec: CircuitSpec, v: number) => {
  if (spec.target.kind === 'voltage') return `${Number(v.toPrecision(3))} V`;
  return Math.abs(v) < 1 ? `${Number((v * 1000).toPrecision(3))} µA` : `${Number(v.toPrecision(3))} mA`;
};

/** A resistor symbol between two points: lead, zigzag, lead. */
function zigzag(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const a = 0.3 * L, b = 0.7 * L, teeth = 6, amp = 6;
  let d = `M${x1},${y1} L${x1 + ux * a},${y1 + uy * a}`;
  for (let i = 0; i < teeth; i++) {
    const t = a + ((i + 0.5) / teeth) * (b - a);
    const sgn = i % 2 ? 1 : -1;
    d += ` L${x1 + ux * t + nx * amp * sgn},${y1 + uy * t + ny * amp * sgn}`;
  }
  d += ` L${x1 + ux * b},${y1 + uy * b} L${x2},${y2}`;
  return d;
}

function Schematic({ spec, ohms }: { spec: CircuitSpec; ohms: number }) {
  const lay = LAYOUTS[spec.topology];
  const P = lay.pos;
  const probe = spec.target.kind === 'voltage' ? P.find((p) => p.node === (spec.target as { node: number }).node) : undefined;
  const ink = 'var(--en-ink)', mute = 'var(--en-mute)', accent = 'var(--en-accent)';
  const [s0, s1] = lay.source;
  const bx = P[s0].x, by = (P[s0].y + P[s1].y) / 2;
  return (
    <svg viewBox="0 0 320 190" className="absolute inset-0 h-full w-full" role="img" aria-label={`Schematic: a ${spec.source.volts} volt supply and ${spec.resistors.length} resistors`} data-testid="circuit-schematic">
      <g fill="none" stroke={ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {lay.wires.map(([a, b], i) => <line key={`w${i}`} x1={P[a].x} y1={P[a].y} x2={P[b].x} y2={P[b].y} />)}
        {/* the supply: wires with a gap for the cell */}
        <line x1={P[s0].x} y1={P[s0].y} x2={bx} y2={by - 6} />
        <line x1={bx} y1={by + 6} x2={P[s1].x} y2={P[s1].y} />
        <line x1={bx - 11} y1={by - 6} x2={bx + 11} y2={by - 6} />
        <line x1={bx - 6} y1={by + 6} x2={bx + 6} y2={by + 6} />
        {lay.grounds.map((g) => (
          <g key={`g${g}`}>
            <line x1={P[g].x} y1={P[g].y} x2={P[g].x} y2={P[g].y + 8} />
            <line x1={P[g].x - 12} y1={P[g].y + 8} x2={P[g].x + 12} y2={P[g].y + 8} />
            <line x1={P[g].x - 8} y1={P[g].y + 13} x2={P[g].x + 8} y2={P[g].y + 13} />
            <line x1={P[g].x - 4} y1={P[g].y + 18} x2={P[g].x + 4} y2={P[g].y + 18} />
          </g>
        ))}
        {spec.resistors.map((r, i) => {
          const [ia, ib] = lay.res[i];
          const free = i === spec.free;
          return <path key={`r${i}`} d={zigzag(P[ia].x, P[ia].y, P[ib].x, P[ib].y)} stroke={free ? accent : ink} strokeWidth={free ? 2.4 : 1.8} />;
        })}
      </g>
      {P.filter((p) => p.node !== 0).map((p, i) => <circle key={`n${i}`} cx={p.x} cy={p.y} r="3" fill={ink} />)}
      <text x={bx - 16} y={by + 4} textAnchor="end" fontSize="11" fontWeight="700" fill={ink} fontFamily="var(--font-mono)">{spec.source.volts} V</text>
      <text x={bx + 14} y={by - 8} fontSize="10" fill={mute}>+</text>
      {spec.resistors.map((r, i) => {
        const [ia, ib] = lay.res[i];
        const mx = (P[ia].x + P[ib].x) / 2, my = (P[ia].y + P[ib].y) / 2;
        const dx = P[ib].x - P[ia].x, dy = P[ib].y - P[ia].y, L = Math.hypot(dx, dy);
        const nx = -dy / L, ny = dx / L;
        // labels sit on the side away from the middle of the sheet
        const free = i === spec.free;
        const label = free ? `X = ${fmtOhms(ohms)}` : fmtOhms(r.ohms);
        let side = (mx - 160) * nx + (my - 95) * ny >= 0 ? 1 : -1;
        // keep the label on the sheet: if it would run off the right edge, put it on the other side
        if (Math.abs(nx) > 0.5 && nx * side > 0 && mx + 17 + label.length * 7 > 316) side = -side;
        const lx = mx + nx * 17 * side, ly = my + ny * 17 * side;
        const anchor = Math.abs(nx) > 0.5 ? (nx * side > 0 ? 'start' : 'end') : 'middle';
        return (
          <text key={`l${i}`} x={lx} y={ly + 3} textAnchor={anchor} fontSize="11" fontWeight="700" fontFamily="var(--font-mono)" fill={free ? accent : mute} data-testid={free ? 'circuit-free' : undefined}>
            {label}
          </text>
        );
      })}
      {probe && (
        <g>
          <line x1={probe.x} y1={probe.y} x2={probe.x + 14} y2={probe.y - 22} stroke={accent} strokeWidth="1.4" />
          <circle cx={probe.x + 14} cy={probe.y - 26} r="9" fill="var(--en-panel)" stroke={accent} strokeWidth="1.6" />
          <text x={probe.x + 14} y={probe.y - 22.5} textAnchor="middle" fontSize="11" fontWeight="800" fill={accent}>V</text>
        </g>
      )}
      {spec.target.kind === 'current' && (() => {
        const t = spec.target;
        const [ia, ib] = lay.res[t.resistor];
        const from = t.reverse ? ib : ia, to = t.reverse ? ia : ib;
        const ax = P[from].x + (P[to].x - P[from].x) * 0.82, ay = P[from].y + (P[to].y - P[from].y) * 0.82;
        const mx = (P[ia].x + P[ib].x) / 2, my = (P[ia].y + P[ib].y) / 2;
        const ddx = P[ib].x - P[ia].x, ddy = P[ib].y - P[ia].y, LL = Math.hypot(ddx, ddy);
        const nx = -ddy / LL, ny = ddx / LL;
        const side = (mx - 160) * nx + (my - 95) * ny >= 0 ? 1 : -1;
        const ang = (Math.atan2(P[to].y - P[from].y, P[to].x - P[from].x) * 180) / Math.PI;
        return (
          <g>
            <g transform={`translate(${ax},${ay}) rotate(${ang})`}><path d="M-6,-5 L5,0 L-6,5 Z" fill={accent} /></g>
            <circle cx={mx - nx * 20 * side} cy={my - ny * 20 * side} r="8.5" fill="var(--en-panel)" stroke={accent} strokeWidth="1.6" />
            <text x={mx - nx * 20 * side} y={my - ny * 20 * side + 3.5} textAnchor="middle" fontSize="11" fontWeight="800" fill={accent}>A</text>
          </g>
        );
      })()}
    </svg>
  );
}

export function CircuitPuzzle({ spec, record, onAttempt }: PuzzleProps<CircuitSpec>) {
  const { play, settings } = useSettings();
  const dial = useMemo(() => dialValues(), []);
  const start = Math.max(0, dial.findIndex((v) => v >= spec.initial));
  const [idx, setIdx] = useState(start);
  const [reading, setReading] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);
  const done = record.done;
  const mountedSolved = useRef(record.solved);
  // Mounted already solved (opened again, or after a reload)? Then the dial is back at its start and the only honest thing to show is a setting that works.
  const mine = record.solved && !mountedSolved.current;
  const latest = useRef({ spec, record, onAttempt, play });
  latest.current = { spec, record, onAttempt, play };
  const ohms = dial[idx];
  const answer = useMemo(() => dial.find((o) => evaluate(spec, o).solved) ?? spec.initial, [dial, spec]);
  useEffect(() => () => window.clearInterval(timer.current), []);

  const verdict = (solved: boolean, measured: number) => {
    const L = latest.current;
    const attempt = L.record.attempts + 1;
    setReading(measured);
    if (solved) {
      setMsg({ k: 'ok', t: `The meter reads ${fmtReading(L.spec, measured)}: inside the 2% window.` });
      L.play('correct');
    } else {
      setMsg({
        k: attempt >= MAX_ATTEMPTS ? 'bad' : 'warn',
        t: attempt >= MAX_ATTEMPTS ? `Out of guesses. The meter read ${fmtReading(L.spec, measured)}. ${fmtOhms(answer)} in that place gives the target.` : `The meter reads ${fmtReading(L.spec, measured)}. ${plural(MAX_ATTEMPTS - attempt)}.`,
      });
      L.play('wrong');
    }
    setBusy(false);
    L.onAttempt(solved);
  };

  const test = () => {
    if (busy || done) return;
    const ev = evaluate(spec, ohms);
    if (ev.refused) {
      setMsg({ k: 'warn', t: ev.refused });
      play('wrong');
      return;
    }
    setMsg(null);
    setBusy(true);
    if (settings.reduceMotion) {
      verdict(ev.solved, ev.measured);
      return;
    }
    // the meter's display settles on its reading
    let n = 0;
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      n++;
      const k = 1 - Math.exp(-n / 5);
      setReading(ev.measured * k + (n < 12 ? Math.sin(n * 7) * Math.abs(ev.measured) * 0.04 * (1 - k) : 0));
      if (n >= 14) {
        window.clearInterval(timer.current);
        verdict(ev.solved, ev.measured);
      }
    }, 80);
  };

  const unit = spec.target.kind === 'voltage' ? 'V' : 'mA';
  const goal = spec.target.kind === 'voltage' ? `${spec.target.value} V` : spec.target.value < 1 ? `${Number((spec.target.value * 1000).toPrecision(3))} µA` : `${spec.target.value} mA`;
  const what = spec.target.kind === 'voltage' ? 'the voltage at the marked node' : 'the current through the marked resistor';
  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-circuit"
      view={
        <div className="ens-view" data-testid="circuit-view">
          <Schematic spec={spec} ohms={done && !mine ? answer : ohms} />
          <div className="ens-readout">{spec.topology} · {spec.source.volts} V supply</div>
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="circuit-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}A resistor of <b className="font-mono">{fmtOhms(mine ? ohms : answer)}</b> in the dashed place makes {what} read {goal}.
        </div>
      ) : (
        <p className="ens-p">
          Pick the standard resistor for the dashed place so {what} reads <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{goal} ± {Math.round(spec.tolerance * 100)}%</b>.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="ens-meter-lcd" data-testid="circuit-meter" aria-live="polite" aria-label="Multimeter">
          <span className="ens-label">{spec.target.kind === 'voltage' ? 'DC volts' : 'DC current'}</span>
          <b className="font-mono" data-testid="circuit-reading">{reading === null ? `-.-- ${unit}` : fmtReading(spec, reading)}</b>
        </div>
        {!done && (
          <button className="ens-btn" onClick={test} disabled={busy} data-testid="circuit-test">
            {busy ? 'Measuring…' : 'Test the circuit'}
          </button>
        )}
      </div>
      {!done && (
        <div className="flex items-center gap-2">
          <button className="ens-chip" onClick={() => { play('snap'); setIdx((i) => Math.max(0, i - 1)); }} disabled={busy || idx === 0} data-testid="circuit-dec" aria-label="Previous standard value">−</button>
          <label className="flex-1">
            <span className="sr-only">Resistance, standard E24 values</span>
            <input
              className="ens-range"
              type="range"
              min={0}
              max={dial.length - 1}
              step={1}
              value={idx}
              disabled={busy}
              onChange={(e) => setIdx(Number(e.target.value))}
              aria-valuetext={fmtOhms(ohms)}
              data-testid="circuit-dial"
              data-silent
            />
          </label>
          <button className="ens-chip" onClick={() => { play('snap'); setIdx((i) => Math.min(dial.length - 1, i + 1)); }} disabled={busy || idx === dial.length - 1} data-testid="circuit-inc" aria-label="Next standard value">+</button>
          <b className="w-20 text-right font-mono text-sm" style={{ color: 'var(--en-accent)' }} data-testid="circuit-value">{fmtOhms(ohms)}</b>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="circuit-msg">{msg.t}</Note>}
    </Board>
  );
}
