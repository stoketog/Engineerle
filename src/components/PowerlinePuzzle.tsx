'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { evaluate, type Evaluation, type PowerlineSpec } from '@/engineerle/powerline';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps } from './Board';

const INFO = byId('powerline')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;

export const fmtPower = (w: number) => (w >= 1e6 ? `${Number((w / 1e6).toPrecision(3))} MW` : w >= 1e3 ? `${Number((w / 1e3).toPrecision(3))} kW` : `${Number(w.toPrecision(3))} W`);
export const fmtVolts = (v: number) => (v >= 1e3 ? `${Number((v / 1e3).toPrecision(3))} kV` : `${Number(v.toPrecision(3))} V`);
export const fmtAmps = (a: number) => (a >= 1e3 ? `${Number((a / 1e3).toPrecision(3))} kA` : `${Number(a.toPrecision(3))} A`);

const mix = (t: number) => {
  const a = [92, 200, 255], b = [255, 106, 61];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t)))).join(',')})`;
};

function Pylon({ x }: { x: number }) {
  return (
    <g stroke="var(--en-ink)" strokeWidth="1.4" fill="none" strokeLinecap="round">
      <path d={`M${x - 7},108 L${x},54 L${x + 7},108`} />
      <path d={`M${x - 5},90 L${x + 5},90 M${x - 3.5},72 L${x + 3.5},72 M${x - 5},90 L${x + 3.5},72 M${x + 5},90 L${x - 3.5},72`} strokeWidth="1" />
      <line x1={x - 13} y1="58" x2={x + 13} y2="58" />
      <line x1={x - 11} y1="68" x2={x + 11} y2="68" />
    </g>
  );
}

function Coils({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g stroke="var(--en-ink)" strokeWidth="1.6" fill="none">
      <circle cx={x - 7} cy={y} r="11" />
      <circle cx={x + 7} cy={y} r="11" />
      <text x={x} y={y - 18} textAnchor="middle" fontSize="11" fontWeight="800" fontFamily="var(--font-mono)" fill="var(--en-accent)" stroke="none">{label}</text>
    </g>
  );
}

function Diagram({ spec, ratio, shown, running }: { spec: PowerlineSpec; ratio: number; shown: Evaluation | null; running: boolean }) {
  const s = shown?.state;
  const heat = s ? s.lossPct / (spec.maxLossPct * 2) : 0;
  const wire = s ? mix(heat) : 'var(--en-mute)';
  const flow = s ? Math.max(0.35, 2.6 - Math.log10(1 + s.iLine) * 0.7) : 2;
  const xs = [118, 150, 182, 214];
  const wirePath = (y0: number, dy: number) => `M104,${y0} ${xs.map((x, i) => `Q${(i ? xs[i - 1] : 104) + (x - (i ? xs[i - 1] : 104)) / 2},${y0 + dy + 6} ${x},${y0}`).join(' ')} Q${(xs[3] + 240) / 2},${y0 + dy + 6} 240,${y0}`;
  return (
    <svg viewBox="0 0 320 150" className="absolute inset-0 h-full w-full" role="img" aria-label={`A generator, a step-up transformer of ratio 1 to ${ratio}, a power line on pylons, a step-down transformer and a town`} data-testid="power-diagram">
      {/* generator and step-up transformer */}
      <circle cx="26" cy="80" r="16" fill="none" stroke="var(--en-ink)" strokeWidth="1.8" />
      <text x="26" y="85" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--en-ink)">G</text>
      <text x="26" y="112" textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--en-mute)">{fmtVolts(spec.vGen)}</text>
      <line x1="42" y1="80" x2="60" y2="80" stroke="var(--en-ink)" strokeWidth="1.8" />
      <Coils x={74} y={80} label={`1 : ${ratio}`} />
      <line x1="92" y1="80" x2="104" y2="80" stroke="var(--en-ink)" strokeWidth="1.8" />
      {/* the line */}
      {xs.map((x) => <Pylon key={x} x={x} />)}
      <line x1="104" y1="80" x2="104" y2="58" stroke={wire} strokeWidth="2" />
      <path d={wirePath(58, 8)} fill="none" stroke={wire} strokeWidth={s ? 2.4 : 1.8} />
      <path d={wirePath(68, 8)} fill="none" stroke={wire} strokeWidth={s ? 2.4 : 1.8} />
      {s && (
        <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 9" opacity={Math.min(1, 0.35 + Math.log10(1 + s.iLine) * 0.22)} className={running ? 'ens-flow' : undefined} style={{ ['--flow' as string]: `${flow}s` }}>
          <path d={wirePath(58, 8)} />
          <path d={wirePath(68, 8)} />
        </g>
      )}
      {shown?.flashover && running && (
        <path d="M150,58 l-6,10 l8,2 l-7,14 l12,-16 l-8,-2 l7,-8 z" fill="#ffe14d" stroke="#fff" strokeWidth="0.8" />
      )}
      {/* step-down transformer and the town */}
      <line x1="240" y1="58" x2="240" y2="80" stroke={wire} strokeWidth="2" />
      <line x1="240" y1="80" x2="252" y2="80" stroke="var(--en-ink)" strokeWidth="1.8" />
      <Coils x={266} y={80} label={`${ratio} : 1`} />
      <line x1="284" y1="80" x2="296" y2="80" stroke="var(--en-ink)" strokeWidth="1.8" />
      <g stroke="var(--en-ink)" strokeWidth="1.6" fill="none" strokeLinejoin="round">
        <path d="M298,96 L298,82 L306,74 L314,82 L314,96 Z" />
        <path d="M298,96 L314,96" />
      </g>
      <text x="306" y="112" textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--en-mute)">{fmtPower(spec.power)}</text>
      {/* the line's own numbers */}
      <text x="160" y="132" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--en-mute)">line {spec.lineOhms} Ω</text>
    </svg>
  );
}

export function PowerlinePuzzle({ spec, record, onAttempt }: PuzzleProps<PowerlineSpec>) {
  const { play, settings } = useSettings();
  const [ratio, setRatio] = useState(spec.ratios[0]);
  const [shown, setShown] = useState<Evaluation | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const timer = useRef(0);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play });
  latest.current = { spec, record, onAttempt, play };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const answers = spec.ratios.filter((r) => evaluate(spec, r).solved);

  const verdict = (ev: Evaluation) => {
    const L = latest.current;
    const attempt = L.record.attempts + 1;
    const st = ev.state!;
    if (ev.solved) {
      setMsg({ k: 'ok', t: `Delivered ${fmtPower(L.spec.power - st.lossW)} at ${fmtVolts(st.vLoad)} on the line, with ${Number(st.lossPct.toPrecision(3))}% lost as heat.` });
      L.play('correct');
    } else {
      const why = ev.flashover
        ? `At ${fmtVolts(st.vLine)} the insulators flash over and the line trips out.`
        : `The line carries ${fmtAmps(st.iLine)} and loses ${fmtPower(st.lossW)} as heat, ${Number(st.lossPct.toPrecision(3))}% of what was sent.`;
      const last = attempt >= MAX_ATTEMPTS;
      setMsg({ k: last ? 'bad' : 'warn', t: last ? `${why} Out of guesses. A ratio of 1 : ${answers[0]} works.` : `${why} ${plural(MAX_ATTEMPTS - attempt)}.` });
      L.play('wrong');
    }
    setRunning(false);
    L.onAttempt(ev.solved);
  };

  const run = () => {
    if (running || done) return;
    const ev = evaluate(spec, ratio);
    if (ev.refused) {
      setMsg({ k: 'warn', t: ev.refused });
      play('wrong');
      return;
    }
    setMsg(null);
    setShown(ev);
    if (settings.reduceMotion) {
      verdict(ev);
      return;
    }
    setRunning(true);
    play('snap');
    timer.current = window.setTimeout(() => verdict(ev), 2200);
  };

  const st = shown?.state;
  const solvedShown = done && !record.solved ? null : shown;
  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-powerline"
      view={
        <div className="ens-view" data-testid="power-view">
          <Diagram spec={spec} ratio={done && !record.solved ? answers[0] : ratio} shown={solvedShown} running={running} />
          <div className="ens-readout">send {fmtPower(spec.power)} · generator {fmtVolts(spec.vGen)}</div>
          {st && !running && (
            <div className="ens-readout r" data-testid="power-result">
              {fmtVolts(st.vLine)} · {fmtAmps(st.iLine)}
              <br />
              lost {fmtPower(st.lossW)} ({Number(st.lossPct.toPrecision(3))}%)
              <br />
              far end {fmtVolts(st.vLoad)}
            </div>
          )}
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="power-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}A step-up ratio of <b className="font-mono">1 : {record.solved ? ratio : answers[0]}</b> keeps the loss under {spec.maxLossPct}% and the line under {fmtVolts(spec.maxVLine)}.
        </div>
      ) : (
        <p className="ens-p">
          Send <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtPower(spec.power)}</b> from a {fmtVolts(spec.vGen)} generator down a line of {spec.lineOhms} Ω. Pick the transformer ratio so the line loses no more than{' '}
          <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.maxLossPct}%</b> as heat, with the insulators rated for <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtVolts(spec.maxVLine)}</b>.
        </p>
      )}
      {!done && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Step-up ratio">
            {spec.ratios.map((r) => (
              <button key={r} className="ens-chip" role="radio" aria-checked={ratio === r} data-on={ratio === r} disabled={running} onClick={() => { play('snap'); setRatio(r); }} data-testid={`power-ratio-${r}`}>
                1 : {r}
              </button>
            ))}
          </div>
          <button className="ens-btn" onClick={run} disabled={running} data-testid="power-run">
            {running ? 'Transmitting…' : 'Transmit'}
          </button>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="power-msg">{msg.t}</Note>}
    </Board>
  );
}
