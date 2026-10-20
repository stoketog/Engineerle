'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { RF_VALUES, RG_VALUES, clipLimit, closedLoopGain, evaluate, linearOutput, phaseDeg, type Evaluation, type OpampSpec } from '@/engineerle/opamp';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps } from './Board';
import { fmtOhms } from './CircuitPuzzle';
import { fmtHz } from './RcFilterPuzzle';

const INFO = byId('opamp')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;
const W = 320, H = 194, PAD = 8;
const fmtV = (v: number) => (v < 1 ? `${Number((v * 1000).toPrecision(3))} mV` : `${Number(v.toPrecision(3))} V`);
const fmtGain = (g: number) => `${g < 0 ? '−' : '+'}${Number(Math.abs(g).toPrecision(3))}`;

/** Nice volts-per-division that fits `peak` inside four divisions. */
function niceDiv(peak: number): number {
  const raw = peak / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function Scope({ spec, shown, drawing }: { spec: OpampSpec; shown: { gain: number; ev: Evaluation } | null; drawing: boolean }) {
  const pw = W - 2 * PAD, ph = H - 2 * PAD, mid = H / 2, half = ph / 2;
  const T = 3 / spec.f; // three cycles
  const limit = clipLimit(spec.supply);
  const outDiv = niceDiv(Math.max(limit * 1.08, spec.target * 1.1));
  const inDiv = niceDiv(spec.vin * 1.15);
  const yOut = (v: number) => mid - (v / (4 * outDiv)) * half;
  const yIn = (v: number) => mid - (v / (4 * inDiv)) * half;
  const path = (f: (t: number) => number, y: (v: number) => number) => {
    const n = 720;
    let d = '';
    for (let i = 0; i <= n; i++) d += `${i ? 'L' : 'M'}${(PAD + (pw * i) / n).toFixed(1)},${y(f((T * i) / n)).toFixed(1)}`;
    return d;
  };
  const input = useMemo(() => path((t) => spec.vin * Math.sin(2 * Math.PI * spec.f * t), yIn), [spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = useMemo(() => {
    if (!shown) return null;
    const amp = linearOutput(spec, shown.gain, spec.vin, spec.f);
    const ph = (phaseDeg(spec.mode, spec.gbw, shown.gain, spec.f) * Math.PI) / 180;
    // the unclipped sine, then the rails cut its tops flat
    return path((t) => Math.max(-limit, Math.min(limit, amp * Math.sin(2 * Math.PI * spec.f * t + ph))), yOut);
  }, [shown, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Oscilloscope: the input in grey, the amplifier output in green, with the target band and the supply limits dashed" data-testid="op-scope">
      <rect width={W} height={H} fill="#04140d" />
      <g stroke="rgba(90,255,160,0.16)" strokeWidth="1">
        {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={PAD + (pw * i) / 10} y1={PAD} x2={PAD + (pw * i) / 10} y2={H - PAD} />)}
        {Array.from({ length: 9 }, (_, j) => <line key={`h${j}`} x1={PAD} y1={PAD + (ph * j) / 8} x2={W - PAD} y2={PAD + (ph * j) / 8} />)}
      </g>
      <line x1={PAD} y1={mid} x2={W - PAD} y2={mid} stroke="rgba(120,255,170,0.5)" strokeWidth="1.2" />
      {/* what the output must reach, and the swing the rails allow */}
      <g stroke="#ffb454" strokeWidth="1" strokeDasharray="4 3" opacity="0.85">
        <line x1={PAD} y1={yOut(spec.target)} x2={W - PAD} y2={yOut(spec.target)} />
        <line x1={PAD} y1={yOut(-spec.target)} x2={W - PAD} y2={yOut(-spec.target)} />
      </g>
      <g stroke="#ff6a6a" strokeWidth="1" strokeDasharray="1 3" opacity="0.8">
        <line x1={PAD} y1={yOut(limit)} x2={W - PAD} y2={yOut(limit)} />
        <line x1={PAD} y1={yOut(-limit)} x2={W - PAD} y2={yOut(-limit)} />
      </g>
      <path d={input} fill="none" stroke="rgba(216,255,232,0.55)" strokeWidth="1.1" strokeLinejoin="round" />
      {out && (
        <path d={out} fill="none" stroke="#5dff9f" strokeWidth="2" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px #5dff9f)' }} pathLength={1} strokeDasharray="1" strokeDashoffset={drawing ? 1 : 0} className={drawing ? 'ens-draw' : undefined} />
      )}
      <text x={W - PAD - 2} y={H - PAD - 3} textAnchor="end" fontSize="7.5" fontFamily="var(--font-mono)" fill="rgba(216,255,232,0.7)">
        in {fmtV(inDiv)}/div · out {fmtV(outDiv)}/div
      </text>
    </svg>
  );
}

function Schematic({ mode }: { mode: 'inverting' | 'non-inverting' }) {
  const inv = mode === 'inverting';
  const zig = (x: number, y: number, vertical = false) => {
    const d = `M${x},${y} l4,0 l3,-5 l6,10 l6,-10 l6,10 l3,-5 l4,0`;
    return <path d={d} transform={vertical ? `rotate(90 ${x} ${y})` : undefined} />;
  };
  return (
    <svg viewBox="0 0 200 104" width="200" height="104" role="img" aria-label={`${mode} amplifier: ${inv ? 'input through Rg to the minus input, Rf from the output back to it, plus input grounded' : 'input to the plus input, Rf from the output back to minus, Rg from minus to ground'}`} data-testid="op-schematic">
      <g fill="none" stroke="var(--en-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M90,20 L90,80 L150,50 Z" />
        <line x1="150" y1="50" x2="190" y2="50" />
        {inv ? (
          <g>
            <line x1="6" y1="35" x2="14" y2="35" />{zig(14, 35)}<line x1="42" y1="35" x2="90" y2="35" />
            <path d="M70,35 L70,12 L92,12" />{zig(92, 12)}<path d="M120,12 L168,12 L168,50" />
            <path d="M90,65 L70,65 L70,92" /><line x1="62" y1="92" x2="78" y2="92" /><line x1="65" y1="96" x2="75" y2="96" />
          </g>
        ) : (
          <g>
            <line x1="6" y1="35" x2="90" y2="35" />
            <path d="M90,65 L70,65 L70,88 L92,88" />{zig(92, 88)}<path d="M120,88 L168,88 L168,50" />
            <path d="M70,65 L38,65 L38,70" />{zig(38, 70, true)}<line x1="38" y1="98" x2="38" y2="100" /><line x1="30" y1="100" x2="46" y2="100" />
          </g>
        )}
      </g>
      <circle cx="70" cy={inv ? 35 : 65} r="2.5" fill="var(--en-ink)" />
      <g fontFamily="var(--font-mono)" fontSize="9" fontWeight="700">
        <text x="95" y="39" fill="var(--en-mute)">{inv ? '−' : '+'}</text>
        <text x="95" y="68" fill="var(--en-mute)">{inv ? '+' : '−'}</text>
        <text x="2" y="28" fill="var(--en-mute)">in</text>
        <text x="174" y="44" fill="var(--en-accent)">out</text>
        <text x="100" y={inv ? 8 : 100} fill="var(--en-accent)" fontWeight="800">Rf</text>
        <text x={inv ? 22 : 46} y={inv ? 28 : 84} fill="var(--en-accent)" fontWeight="800">Rg</text>
      </g>
    </svg>
  );
}

export function OpampPuzzle({ spec, record, onAttempt }: PuzzleProps<OpampSpec>) {
  const { play, settings } = useSettings();
  const [fi, setFi] = useState(0), [gi, setGi] = useState(0);
  const [shown, setShown] = useState<{ gain: number; ev: Evaluation } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const timer = useRef(0);
  const done = record.done;
  const mountedSolved = useRef(record.solved);
  // Mounted already solved (opened again, or after a reload)? Then the dial is back at its start and the only honest thing to show is a setting that works.
  const mine = record.solved && !mountedSolved.current;
  const latest = useRef({ spec, record, onAttempt, play });
  latest.current = { spec, record, onAttempt, play };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const rf = RF_VALUES[fi], rg = RG_VALUES[gi];

  // a pair that works, shown only when the puzzle is over
  const example = useMemo(() => {
    let best: [number, number] | null = null, bestErr = Infinity;
    for (const a of RF_VALUES) for (const b of RG_VALUES) {
      const e = evaluate(spec, a, b);
      if (e.solved && Math.abs(e.vout! - spec.target) < bestErr) { best = [a, b]; bestErr = Math.abs(e.vout! - spec.target); }
    }
    return best ?? [RF_VALUES[0], RG_VALUES[0]];
  }, [spec]);

  const verdict = (ev: Evaluation) => {
    const L = latest.current;
    const attempt = L.record.attempts + 1;
    const s = L.spec;
    let facts: string;
    if (ev.clipped) facts = `Gain ${fmtGain(ev.gain!)}: the output wants to swing past the rails and is clipped flat at ±${fmtV(clipLimit(s.supply))}.`;
    else if (!ev.bwOk) facts = `Gain ${fmtGain(ev.gain!)} leaves a bandwidth of only ${fmtHz(ev.bw!)}, below the ${fmtHz(s.f)} signal, so the output is rolled off to ${fmtV(ev.vout!)}.`;
    else facts = `Gain ${fmtGain(ev.gain!)}: the output peaks at ${fmtV(ev.vout!)} (bandwidth ${fmtHz(ev.bw!)}).`;
    if (ev.solved) {
      setMsg({ k: 'ok', t: `${facts} On target.` });
      L.play('correct');
    } else {
      const last = attempt >= MAX_ATTEMPTS;
      setMsg({ k: last ? 'bad' : 'warn', t: last ? `${facts} Out of guesses. Rf = ${fmtOhms(example[0])} with Rg = ${fmtOhms(example[1])} would do it.` : `${facts} ${plural(MAX_ATTEMPTS - attempt)}.` });
      L.play('wrong');
    }
    setDrawing(false);
    L.onAttempt(ev.solved);
  };

  const run = () => {
    if (drawing || done) return;
    const ev = evaluate(spec, rf, rg);
    if (ev.refused) {
      setMsg({ k: 'warn', t: ev.refused });
      play('wrong');
      return;
    }
    setMsg(null);
    setShown({ gain: ev.gain!, ev });
    if (settings.reduceMotion) {
      verdict(ev);
      return;
    }
    setDrawing(true);
    timer.current = window.setTimeout(() => verdict(ev), 1500);
  };

  const st = shown && !drawing ? shown.ev : null;
  const exGain = closedLoopGain(spec.mode, example[0], example[1]);
  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-opamp"
      view={
        <div className="ens-view" data-testid="op-view">
          <Scope spec={spec} shown={done && !mine ? null : shown} drawing={drawing} />
          <div className="ens-readout">grey: input · green: output · amber: target · red: rails</div>
          {st && (
            <div className="ens-readout r" data-testid="op-result">
              gain {fmtGain(st.gain!)}
              <br />
              out {fmtV(st.vout!)} pk
            </div>
          )}
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="op-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}
          {mine ? `Rf = ${fmtOhms(rf)} and Rg = ${fmtOhms(rg)}` : `For instance Rf = ${fmtOhms(example[0])} and Rg = ${fmtOhms(example[1])}`} give a gain of{' '}
          <b className="font-mono">{fmtGain(mine ? closedLoopGain(spec.mode, rf, rg) : exGain)}</b>.
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="ens-p min-w-0 flex-1">
            {spec.mode === 'inverting' ? 'An' : 'A'} {spec.mode} amplifier on ±{spec.supply} V rails, op-amp GBW {Number((spec.gbw / 1e6).toPrecision(3))} MHz. The input is{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtV(spec.vin)}</b> peak at <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtHz(spec.f)}</b>. Make the output peak{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtV(spec.target)}</b> within {Math.round(spec.tolerance * 100)}%, unclipped.
          </p>
          <Schematic mode={spec.mode} />
        </div>
      )}
      {!done && (
        <div className="flex flex-col gap-1">
          {(
            [
              ['Rf', fi, setFi, RF_VALUES.length, fmtOhms(rf), 'op-rf', 'Feedback resistance'],
              ['Rg', gi, setGi, RG_VALUES.length, fmtOhms(rg), 'op-rg', 'Input resistance'],
            ] as const
          ).map(([name, idx, set, len, label, id, aria]) => (
            <div key={id} className="flex items-center gap-2">
              <b className="w-5 font-mono text-sm" style={{ color: 'var(--en-ink)' }}>{name}</b>
              <label className="flex-1">
                <span className="sr-only">{aria}</span>
                <input className="ens-range" type="range" min={0} max={len - 1} step={1} value={idx} disabled={drawing} onChange={(e) => set(Number(e.target.value))} aria-valuetext={label} data-testid={id} data-silent />
              </label>
              <b className="w-20 text-right font-mono text-sm" style={{ color: 'var(--en-accent)' }} data-testid={`${id}-value`}>{label}</b>
            </div>
          ))}
          <div className="flex justify-end">
            <button className="ens-btn" onClick={run} disabled={drawing} data-testid="op-run">
              {drawing ? 'Running…' : 'Apply the signal'}
            </button>
          </div>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="op-msg">{msg.t}</Note>}
    </Board>
  );
}
