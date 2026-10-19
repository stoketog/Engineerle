'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { C_VALUES, R_VALUES, bestPair, evaluate, gainHigh, gainLow, phaseHigh, phaseLow, type FilterSpec } from '@/engineerle/rcfilter';
import { formatOhms } from '@/engineerle/circuit';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps, guessesLeft } from './Board';
import { useClock } from './clock';
import { Capacitor, Dot, Ground, Resistor, Schematic, Wire } from './schematic';

const INFO = byId('rcfilter');
const W = 440, H = 230;
const SC = { x0: 160, x1: 430 };
const IN = { top: 16, bottom: 108 }, OUT = { top: 122, bottom: 214 };
const N = 900;

const sig = (x: number, d = 3) => Number(x.toPrecision(d));
export const fmtHz = (f: number) => (f >= 1e6 ? `${sig(f / 1e6)} MHz` : f >= 1000 ? `${sig(f / 1000)} kHz` : `${sig(f)} Hz`);
export const fmtF = (c: number) => (c >= 1e-6 ? `${sig(c * 1e6)} µF` : c >= 1e-9 ? `${sig(c * 1e9)} nF` : `${sig(c * 1e12)} pF`);
const fmtDb = (d: number) => `${Math.abs(d) < 0.005 ? 0 : Math.round(d * 100) / 100} dB`;

/** The time axis: three periods of the signal for a low-pass; for a high-pass up to two and a half periods of the slow hum, but never more than 40 cycles of the tone. */
const windowOf = (s: FilterSpec) => (s.type === 'low' ? 3 / s.fSignal : Math.min(2.5 / s.fNoise, 40 / s.fSignal));

export function RcFilterPuzzle({ spec, record, onAttempt }: PuzzleProps<FilterSpec>) {
  const clock = useClock();
  const { play, settings } = useSettings();
  const [ri, setRi] = useState(0);
  const [ci, setCi] = useState(0);
  const [shown, setShown] = useState<{ r: number; c: number } | null>(null);
  const [reveal, setReveal] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const raf = useRef(0);
  const done = record.done;
  const r = R_VALUES[ri], c = C_VALUES[ci];
  const answer = useMemo(() => bestPair(spec), [spec]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const T = windowOf(spec);
  const gain = spec.type === 'low' ? gainLow : gainHigh;
  const phase = spec.type === 'low' ? phaseLow : phaseHigh;
  const px = (i: number) => SC.x0 + ((SC.x1 - SC.x0) * i) / (N - 1);
  const inputPts = useMemo(() => {
    const pts: string[] = []; const cy = (IN.top + IN.bottom) / 2, k = (IN.bottom - IN.top) / 4.4;
    for (let i = 0; i < N; i++) { const t = (T * i) / (N - 1); pts.push(`${px(i).toFixed(1)},${(cy - k * (Math.sin(2 * Math.PI * spec.fSignal * t) + Math.sin(2 * Math.PI * spec.fNoise * t))).toFixed(1)}`); }
    return pts.join(' ');
  }, [spec, T]); // eslint-disable-line react-hooks/exhaustive-deps
  const wantedPts = useMemo(() => {
    const pts: string[] = []; const cy = (OUT.top + OUT.bottom) / 2, k = (OUT.bottom - OUT.top) / 4.4;
    for (let i = 0; i < N; i++) { const t = (T * i) / (N - 1); pts.push(`${px(i).toFixed(1)},${(cy - k * Math.sin(2 * Math.PI * spec.fSignal * t)).toFixed(1)}`); }
    return pts.join(' ');
  }, [spec, T]); // eslint-disable-line react-hooks/exhaustive-deps
  const outputPts = useMemo(() => {
    if (!shown) return '';
    const fc = 1 / (2 * Math.PI * shown.r * shown.c);
    const gs = gain(spec.fSignal, fc), gn = gain(spec.fNoise, fc);
    const ps = (phase(spec.fSignal, fc) * Math.PI) / 180, pn = (phase(spec.fNoise, fc) * Math.PI) / 180;
    const pts: string[] = []; const cy = (OUT.top + OUT.bottom) / 2, k = (OUT.bottom - OUT.top) / 4.4;
    for (let i = 0; i < N; i++) { const t = (T * i) / (N - 1); pts.push(`${px(i).toFixed(1)},${(cy - k * (gs * Math.sin(2 * Math.PI * spec.fSignal * t + ps) + gn * Math.sin(2 * Math.PI * spec.fNoise * t + pn))).toFixed(1)}`); }
    return pts.join(' ');
  }, [shown, spec, T]); // eslint-disable-line react-hooks/exhaustive-deps

  const describe = (e: ReturnType<typeof evaluate>) => {
    const loss = -e.signalDb, cut = -e.noiseDb;
    const badSig = loss > spec.maxLossDb, badNoise = cut < spec.minCutDb;
    const head = `Cutoff ${fmtHz(e.fc)}. The ${fmtHz(spec.fSignal)} tone ${loss < 0.05 ? 'passes unchanged' : `loses ${fmtDb(loss)}`}${badSig ? ` (the limit is ${spec.maxLossDb} dB)` : ''}; the ${fmtHz(spec.fNoise)} noise is cut by ${fmtDb(cut)}${badNoise ? ` (it needs ${spec.minCutDb} dB)` : ''}.`;
    return head;
  };

  const run = () => {
    if (busy || done) return;
    const ev = evaluate(spec, r, c);
    if (ev.refused) { setMsg({ k: 'bad', t: `${ev.refused} This didn't use up a guess.` }); play('wrong'); return; }
    clock.hold();
    setMsg(null);
    setBusy(true);
    const attempt = record.attempts + 1;
    setShown({ r, c });
    const finish = () => {
      setReveal(1);
      setBusy(false);
      const base = describe(ev);
      if (ev.solved) { setMsg({ k: 'ok', t: base }); play('correct'); }
      else {
        const out = attempt >= MAX_ATTEMPTS;
        setMsg({ k: out ? 'bad' : 'hint', t: out ? `${base} Out of guesses. ${formatOhms(answer[0])} with ${fmtF(answer[1])} would have worked.` : `${base} ${guessesLeft(attempt)}` });
        play('wrong');
      }
      onAttempt(ev.solved);
    };
    if (settings.reduceMotion) { finish(); return; }
    play('tick');
    setReveal(0);
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 1100);
      setReveal(t);
      if (t < 1) raf.current = requestAnimationFrame(step); else finish();
    };
    raf.current = requestAnimationFrame(step);
  };

  const cur = shown ? evaluate(spec, shown.r, shown.c) : null;
  const low = spec.type === 'low';
  const label = `${low ? 'Low-pass' : 'High-pass'} RC filter. The input is a ${fmtHz(spec.fSignal)} tone with ${fmtHz(spec.fNoise)} noise on top; the output trace shows what comes out.`;
  const outFinal = done ? answer : null;
  const clipId = 'rc-clip';
  const cyOut = (OUT.top + OUT.bottom) / 2;

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-rcfilter"
      view={
        <div className="ens-view" data-testid="rc-view" style={{ aspectRatio: `${W} / ${H}`, minHeight: 0 }}>
          <Schematic width={W} height={H} label={label}>
            <defs><clipPath id={clipId}><rect x={SC.x0} y={OUT.top} width={(SC.x1 - SC.x0) * reveal} height={OUT.bottom - OUT.top} /></clipPath></defs>
            {/* the circuit */}
            <Wire pts={[[12, 62], [low ? 28 : 44, 62]]} />
            {low ? (
              <>
                <Resistor x1={28} y1={62} x2={92} y2={62} name="R" value={formatOhms(r)} free side="above" />
                <Wire pts={[[92, 62], [122, 62]]} />
                <Dot x={106} y={62} />
                <Wire pts={[[106, 62], [106, 100]]} />
                <Capacitor x1={106} y1={100} x2={106} y2={150} name="C" value={fmtF(c)} side="left" />
              </>
            ) : (
              <>
                <Capacitor x1={44} y1={62} x2={92} y2={62} name="C" value={fmtF(c)} side="above" />
                <Wire pts={[[92, 62], [122, 62]]} />
                <Dot x={106} y={62} />
                <Wire pts={[[106, 62], [106, 90]]} />
                <Resistor x1={106} y1={90} x2={106} y2={150} name="R" value={formatOhms(r)} free side="left" />
              </>
            )}
            <Wire pts={[[12, 170], [122, 170]]} />
            <Wire pts={[[106, 150], [106, 170]]} />
            <Dot x={106} y={170} />
            <Wire pts={[[12, 62], [12, 170]]} />
            <Ground x={12} y={170} />
            <circle cx={122} cy={62} r={3} fill="var(--en-panel, transparent)" />
            <text x={12} y={48} fontSize="11" fill="var(--en-mute)" stroke="none">in</text>
            <text x={122} y={48} textAnchor="end" fontSize="11" fill="var(--en-mute)" stroke="none">out</text>
            {/* the scope */}
            {[IN, OUT].map((p, i) => (
              <g key={i}>
                <rect x={SC.x0} y={p.top} width={SC.x1 - SC.x0} height={p.bottom - p.top} stroke="var(--en-line2)" strokeWidth="1" />
                <line x1={SC.x0} y1={(p.top + p.bottom) / 2} x2={SC.x1} y2={(p.top + p.bottom) / 2} stroke="var(--en-line)" strokeWidth="1" strokeDasharray="3 4" />
                <text x={SC.x0 + 4} y={p.top + 11} fontSize="10" fill="var(--en-mute)" stroke="none">{i === 0 ? 'INPUT' : 'OUTPUT, steady state'}</text>
              </g>
            ))}
            <polyline points={inputPts} stroke="var(--en-mute)" strokeWidth="1.4" />
            <polyline points={wantedPts} stroke="var(--en-line2)" strokeWidth="1.2" strokeDasharray="4 4" />
            {shown && <g clipPath={`url(#${clipId})`}><polyline points={outputPts} stroke="var(--en-accent)" strokeWidth="1.8" /></g>}
            <text x={SC.x1 - 4} y={OUT.bottom - 4} textAnchor="end" fontSize="10" fill="var(--en-line2)" stroke="none">dashed: the tone you want</text>
            <line x1={SC.x0} y1={cyOut} x2={SC.x0} y2={cyOut} />
          </Schematic>
        </div>
      }
    >
      {!done ? (
        <p className="ens-p" data-testid="rc-brief">
          This is a <b style={{ color: 'var(--en-ink)' }}>{low ? 'low-pass' : 'high-pass'}</b> RC filter. Keep the <b style={{ color: 'var(--en-ink)' }}>{fmtHz(spec.fSignal)}</b> tone, losing no more than <b style={{ color: 'var(--en-ink)' }}>{spec.maxLossDb} dB</b>, and cut the <b style={{ color: 'var(--en-ink)' }}>{fmtHz(spec.fNoise)}</b> noise by at least <b style={{ color: 'var(--en-ink)' }}>{spec.minCutDb} dB</b>. Choose R and C, then run it.
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="rc-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}{record.solved && cur ? `R = ${formatOhms(shown!.r)} and C = ${fmtF(shown!.c)}, a cutoff of ${fmtHz(cur.fc)}.` : `For example R = ${formatOhms(outFinal![0])} and C = ${fmtF(outFinal![1])}, a cutoff of ${fmtHz(evaluate(spec, outFinal![0], outFinal![1]).fc)}.`} The gain is {low ? '1/√(1 + (f/fc)²)' : '(f/fc)/√(1 + (f/fc)²)'} with fc = 1/(2πRC).
        </div>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="ens-card flex min-w-[10.5rem] flex-col gap-1 p-2.5" style={{ background: 'var(--en-panel2)' }} aria-label="Filter readings" aria-live="polite">
          <span className="ens-label">Cutoff</span>
          <span className="font-mono text-xl font-bold" style={{ color: 'var(--en-accent)' }} data-testid="rc-reading">{fmtHz(1 / (2 * Math.PI * r * c))}</span>
          <span className="font-mono text-xs" style={{ color: 'var(--en-mute)' }} data-testid="rc-gains">{cur ? `tone ${fmtDb(cur.signalDb)} · noise ${fmtDb(cur.noiseDb)}` : 'not run yet'}</span>
        </div>
        {!done && (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label className="flex items-center gap-2">
              <span className="ens-label w-4">R</span>
              <input type="range" min={0} max={R_VALUES.length - 1} step={1} value={ri} disabled={busy} onChange={(e) => setRi(Number(e.target.value))} className="ens-range flex-1" aria-label="Resistance" aria-valuetext={formatOhms(r)} data-testid="rc-r" />
              <b className="w-[4.5rem] text-right font-mono text-sm" style={{ color: 'var(--en-ink)' }} data-testid="rc-r-value">{formatOhms(r)}</b>
            </label>
            <label className="flex items-center gap-2">
              <span className="ens-label w-4">C</span>
              <input type="range" min={0} max={C_VALUES.length - 1} step={1} value={ci} disabled={busy} onChange={(e) => setCi(Number(e.target.value))} className="ens-range flex-1" aria-label="Capacitance" aria-valuetext={fmtF(c)} data-testid="rc-c" />
              <b className="w-[4.5rem] text-right font-mono text-sm" style={{ color: 'var(--en-ink)' }} data-testid="rc-c-value">{fmtF(c)}</b>
            </label>
          </div>
        )}
      </div>
      {!done && (
        <div className="flex justify-end">
          <button className="ens-btn" onClick={run} disabled={busy} data-testid="rc-run">{busy ? 'Running…' : 'Run the filter'}</button>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="rc-msg">{msg.t}</Note>}
    </Board>
  );
}
