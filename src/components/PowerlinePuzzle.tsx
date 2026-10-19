'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { evaluate, lineState, solvingRatios, type LineState, type PowerlineSpec } from '@/engineerle/powerline';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps, guessesLeft } from './Board';
import { useClock } from './clock';

const INFO = byId('powerline');
const W = 440, H = 220;

const sig = (x: number, d = 3) => Number(x.toPrecision(d));
export const fmtV = (v: number) => (Math.abs(v) >= 1000 ? `${sig(v / 1000)} kV` : `${sig(v)} V`);
export const fmtA = (a: number) => (a >= 1000 ? `${sig(a / 1000)} kA` : `${sig(a)} A`);
export const fmtW = (w: number) => (w >= 1e6 ? `${sig(w / 1e6)} MW` : w >= 1000 ? `${sig(w / 1000)} kW` : `${sig(w)} W`);
const fmtPct = (p: number) => `${sig(p, p < 10 ? 2 : 3)}%`;

/** The line from the transformer over three pylons to the town. */
const WIRE = 'M132 98 L184 66 Q217 84 250 66 Q283 84 316 66 L378 108';

function Pylon({ x }: { x: number }) {
  return (
    <g stroke="var(--en-mute)" strokeWidth="1.6" fill="none">
      <path d={`M${x - 14} 176 L${x} 66 L${x + 14} 176 M${x - 9} 134 L${x + 9} 134 M${x - 6} 104 L${x + 6} 104 M${x - 9} 134 L${x + 6} 104 M${x + 9} 134 L${x - 6} 104`} />
      <path d={`M${x - 11} 76 L${x + 11} 76`} />
    </g>
  );
}

function Scene({ spec, ratio, state, phase, hot }: { spec: PowerlineSpec; ratio: number | null; state: LineState | null; phase: number; hot: boolean }) {
  const iMax = spec.power / spec.vGen;
  const width = state ? 2 + 3.2 * Math.min(1, Math.sqrt(state.iLine / iMax)) : 2.4;
  const heat = state ? Math.min(1, state.lossPct / 20) : 0;
  const colour = state ? `hsl(${48 - heat * 48}, 95%, ${58 - heat * 8}%)` : 'var(--en-ink)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: '100%', height: '100%', display: 'block' }} fontFamily="var(--font-mono, ui-monospace, monospace)"
      aria-label={`Generator of ${fmtV(spec.vGen)} sending ${fmtW(spec.power)} through a transformer and a line of ${spec.lineOhms} ohms to a town`}>
      <line x1="10" y1="176" x2={W - 10} y2="176" stroke="var(--en-line2)" strokeWidth="1.4" />
      {[184, 250, 316].map((x) => <Pylon key={x} x={x} />)}
      {/* generator */}
      <g stroke="var(--en-ink)" strokeWidth="1.8" fill="none">
        <circle cx="44" cy="120" r="24" />
        <path d="M32 120 q6 -12 12 0 t12 0" />
        <path d="M68 120 L84 120" />
      </g>
      <text x="44" y="162" textAnchor="middle" fontSize="11" fill="var(--en-mute)">{fmtV(spec.vGen)}</text>
      {/* transformer: two linked windings */}
      <g stroke="var(--en-ink)" strokeWidth="1.8" fill="none">
        <path d="M68 120 L84 120" />
        <circle cx="96" cy="120" r="14" />
        <circle cx="114" cy="120" r="14" />
        <path d="M128 120 L132 120 L132 98" />
      </g>
      <text x="105" y="90" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--en-accent)">{ratio === null ? '1 : ?' : `1 : ${ratio}`}</text>
      {/* the line */}
      <path d={WIRE} fill="none" stroke="var(--en-line2)" strokeWidth={width + 3} strokeLinecap="round" strokeLinejoin="round" opacity={state ? 0.35 : 0} />
      <path d={WIRE} fill="none" stroke={colour} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={hot ? { filter: `drop-shadow(0 0 ${3 + heat * 8}px ${colour})` } : undefined} />
      {state && hot && <path d={WIRE} fill="none" stroke="var(--en-bg, #07182d)" strokeWidth={width + 0.5} strokeLinecap="butt" strokeDasharray="1.5 10" strokeDashoffset={-phase * 11.5 * 6} opacity="0.9" />}
      <text x="250" y="50" textAnchor="middle" fontSize="11" fill="var(--en-mute)">line {sig(spec.lineOhms)} Ω</text>
      {/* the town */}
      <g stroke="var(--en-ink)" strokeWidth="1.8" fill="none">
        <path d="M378 176 L378 126 L396 112 L414 126 L414 176 M370 176 L422 176 M392 176 L392 150 L400 150 L400 176" />
      </g>
      <text x="398" y="196" textAnchor="middle" fontSize="11" fill="var(--en-mute)">{fmtW(spec.power)}</text>
      {state && <text x="398" y="102" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--en-accent)">{fmtV(Math.max(0, state.vLoad))}</text>}
    </svg>
  );
}

export function PowerlinePuzzle({ spec, record, onAttempt }: PuzzleProps<PowerlineSpec>) {
  const clock = useClock();
  const { play, settings } = useSettings();
  const [ratio, setRatio] = useState<number | null>(null);
  const [shown, setShown] = useState<{ ratio: number; state: LineState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const raf = useRef(0);
  const done = record.done;
  const answers = useMemo(() => solvingRatios(spec), [spec]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const verdict = (ratioPicked: number) => {
    const ev = evaluate(spec, ratioPicked);
    const s = ev.state;
    if (ev.solved) return `The line carries ${fmtA(s.iLine)} at ${fmtV(s.vLine)} and loses ${fmtPct(s.lossPct)} (${fmtW(s.lossW)}), inside the ${sig(spec.maxLossPct)}% budget, and the insulators hold.`;
    if (s.vLoad <= 0) return `${fmtV(s.vLine)} would need ${fmtA(s.iLine)} in the line, and ${fmtA(s.iLine)} through ${sig(spec.lineOhms)} Ω drops ${fmtV(s.iLine * spec.lineOhms)}, more than the line has: no power reaches the town.`;
    if (ev.reason === 'voltage') return `${fmtV(s.vLine)} is more than the ${fmtV(spec.vMax)} the insulators are rated for: the line flashes over to the pylons.`;
    return `The line carries ${fmtA(s.iLine)} and loses ${fmtPct(s.lossPct)} (${fmtW(s.lossW)}) as heat, more than the ${sig(spec.maxLossPct)}% budget.`;
  };

  const test = () => {
    if (busy || done || ratio === null) return;
    const ev = evaluate(spec, ratio);
    if (ev.refused) { setMsg({ k: 'bad', t: `${ev.refused} This didn't use up a guess.` }); play('wrong'); return; }
    clock.hold();
    setMsg(null);
    setBusy(true);
    const attempt = record.attempts + 1;
    const picked = ratio;
    const finish = () => {
      setShown({ ratio: picked, state: ev.state });
      setBusy(false);
      const base = verdict(picked);
      if (ev.solved) { setMsg({ k: 'ok', t: base }); play('correct'); }
      else {
        const out = attempt >= MAX_ATTEMPTS;
        setMsg({ k: out ? 'bad' : 'hint', t: out ? `${base} Out of guesses. A ratio of ${answers.map((a) => `1:${a}`).join(' or ')} would have worked.` : `${base} ${guessesLeft(attempt)}` });
        play('wrong');
      }
      onAttempt(ev.solved);
    };
    if (settings.reduceMotion) { finish(); return; }
    play('tick');
    setShown({ ratio: picked, state: lineState(spec, picked) });
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 1300);
      setPhase(t);
      if (t < 1) raf.current = requestAnimationFrame(step); else finish();
    };
    raf.current = requestAnimationFrame(step);
  };

  const s = shown?.state ?? null;
  const label = `Power line: ${fmtW(spec.power)} from a ${fmtV(spec.vGen)} generator over a ${sig(spec.lineOhms)} ohm line`;

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-powerline"
      view={
        <div className="ens-view" data-testid="power-view" style={{ aspectRatio: `${W} / ${H}`, minHeight: 0 }} aria-label={label}>
          <Scene spec={spec} ratio={busy || shown ? shown?.ratio ?? ratio : ratio} state={s} phase={phase} hot={busy || !!s} />
        </div>
      }
    >
      {!done ? (
        <p className="ens-p" data-testid="power-brief">
          Send <b style={{ color: 'var(--en-ink)' }}>{fmtW(spec.power)}</b> from a <b style={{ color: 'var(--en-ink)' }}>{fmtV(spec.vGen)}</b> generator along a line whose total resistance is <b style={{ color: 'var(--en-ink)' }}>{sig(spec.lineOhms)} Ω</b>. The line may waste at most <b style={{ color: 'var(--en-ink)' }}>{sig(spec.maxLossPct)}%</b> of the power as heat, and its insulators are rated for <b style={{ color: 'var(--en-ink)' }}>{fmtV(spec.vMax)}</b>. Choose the transformer ratio, then transmit.
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="power-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}A step-up ratio of {answers.map((a) => `1:${a}`).join(', ')} keeps the loss within {sig(spec.maxLossPct)}% and the line inside {fmtV(spec.vMax)}. Loss is I²R, and I = P/V, so a higher voltage cuts the loss with the square of the ratio.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="ens-card flex min-w-[10.5rem] flex-col gap-1 p-2.5" style={{ background: 'var(--en-panel2)' }} aria-label="Line readings" aria-live="polite">
          <span className="ens-label">Line readings</span>
          <span className="font-mono text-sm font-bold" style={{ color: 'var(--en-accent)' }} data-testid="power-reading">
            {s ? `${fmtV(s.vLine)} · ${fmtA(s.iLine)}` : '— — —'}
          </span>
          <span className="font-mono text-xs" style={{ color: 'var(--en-mute)' }} data-testid="power-loss">{s ? (s.vLoad <= 0 ? `drop ${fmtV(s.iLine * spec.lineOhms)} · overloaded` : `loss ${fmtPct(s.lossPct)} · ${fmtW(s.lossW)}`) : `budget ${sig(spec.maxLossPct)}%`}</span>
        </div>
        {!done && (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="ens-label">Step-up transformer 1 : n</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Turns ratio">
              {spec.ratios.map((r) => (
                <button key={r} type="button" className="ens-chip" data-on={ratio === r} disabled={busy} onClick={() => { setRatio(r); }} aria-pressed={ratio === r} data-testid={`power-ratio-${r}`}>
                  1:{r}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {!done && (
        <div className="flex justify-end">
          <button className="ens-btn" onClick={test} disabled={busy || ratio === null} data-testid="power-test">
            {busy ? 'Transmitting…' : 'Transmit'}
          </button>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="power-msg">{msg.t}</Note>}
    </Board>
  );
}
