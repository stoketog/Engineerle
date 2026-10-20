'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { C_VALUES, R_VALUES, cutoff, evaluate, type Evaluation, type FilterSpec } from '@/engineerle/rcfilter';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps } from './Board';
import { fmtOhms } from './CircuitPuzzle';

const INFO = byId('rcfilter')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;
const W = 320, H = 194, PAD = 8;
const NOISE_AMP = 0.7;

export const fmtFarads = (c: number) => (c >= 1e-6 ? `${Number((c * 1e6).toPrecision(3))} µF` : `${Number((c * 1e9).toPrecision(3))} nF`);
export const fmtHz = (f: number) => (f >= 1e3 ? `${Number((f / 1e3).toPrecision(3))} kHz` : `${Number(f.toPrecision(3))} Hz`);
const db1 = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} dB`;
const minus = (x: number) => (Math.round(x * 10) / 10 === 0 ? '0.0' : `−${(Math.round(x * 10) / 10).toFixed(1)}`);

/** Points of  A sin(2π f t + φ) summed over the two tones, across `T` seconds. */
function trace(T: number, tones: Array<{ f: number; amp: number; phase: number }>, n = 960): string {
  const pw = W - 2 * PAD, ph = H - 2 * PAD;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = (T * i) / n;
    let v = 0;
    for (const k of tones) v += k.amp * Math.sin(2 * Math.PI * k.f * t + (k.phase * Math.PI) / 180);
    const x = PAD + (pw * i) / n, y = PAD + ph / 2 - (v / 2) * (ph / 2);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)},${Math.max(PAD, Math.min(H - PAD, y)).toFixed(1)}`;
  }
  return d;
}

function Scope({ spec, shown, drawing }: { spec: FilterSpec; shown: Evaluation | null; drawing: boolean }) {
  const T = 2 / Math.min(spec.fWanted, spec.fNoise); // two cycles of the slower tone
  const input = useMemo(() => trace(T, [{ f: spec.fWanted, amp: 1, phase: 0 }, { f: spec.fNoise, amp: NOISE_AMP, phase: 0 }]), [spec, T]);
  const out = useMemo(() => {
    if (!shown || shown.fc === undefined) return null;
    const fc = shown.fc;
    const lowGain = (f: number) => 1 / Math.sqrt(1 + (f / fc) ** 2);
    const highGain = (f: number) => f / fc / Math.sqrt(1 + (f / fc) ** 2);
    const gain = spec.type === 'low' ? lowGain : highGain;
    const phase = (f: number) => (spec.type === 'low' ? -(Math.atan(f / fc) * 180) / Math.PI : (Math.atan(fc / f) * 180) / Math.PI);
    return trace(T, [{ f: spec.fWanted, amp: gain(spec.fWanted), phase: phase(spec.fWanted) }, { f: spec.fNoise, amp: NOISE_AMP * gain(spec.fNoise), phase: phase(spec.fNoise) }]);
  }, [shown, spec, T]);
  const pw = W - 2 * PAD, ph = H - 2 * PAD;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Oscilloscope: the noisy input in grey and the filtered output in green" data-testid="rc-scope">
      <rect width={W} height={H} fill="#04140d" />
      <g stroke="rgba(90,255,160,0.16)" strokeWidth="1">
        {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={PAD + (pw * i) / 10} y1={PAD} x2={PAD + (pw * i) / 10} y2={H - PAD} />)}
        {Array.from({ length: 9 }, (_, j) => <line key={`h${j}`} x1={PAD} y1={PAD + (ph * j) / 8} x2={W - PAD} y2={PAD + (ph * j) / 8} />)}
      </g>
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="rgba(120,255,170,0.5)" strokeWidth="1.2" />
      <path d={input} fill="none" stroke="rgba(216,255,232,0.4)" strokeWidth="1.1" strokeLinejoin="round" />
      {out && (
        <path d={out} fill="none" stroke="#5dff9f" strokeWidth="2" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px #5dff9f)' }} pathLength={1} strokeDasharray="1" strokeDashoffset={drawing ? 1 : 0} className={drawing ? 'ens-draw' : undefined} />
      )}
    </svg>
  );
}

function Mini({ type }: { type: 'low' | 'high' }) {
  // vin -- R -- out -- C -- gnd   (low-pass)    vin -- C -- out -- R -- gnd   (high-pass)
  const first = type === 'low' ? 'R' : 'C', second = type === 'low' ? 'C' : 'R';
  return (
    <svg viewBox="0 0 150 54" width="150" height="54" role="img" aria-label={`${type}-pass: input, then ${first} in series, the output across ${second} to ground`} data-testid="rc-mini">
      <g fill="none" stroke="var(--en-ink)" strokeWidth="1.5" strokeLinecap="round">
        <line x1="4" y1="14" x2="30" y2="14" />
        {first === 'R' ? <path d="M30,14 l4,0 l3,-6 l6,12 l6,-12 l6,12 l3,-6 l4,0" /> : <g><line x1="30" y1="14" x2="42" y2="14" /><line x1="42" y1="5" x2="42" y2="23" /><line x1="48" y1="5" x2="48" y2="23" /><line x1="48" y1="14" x2="62" y2="14" /></g>}
        <line x1="62" y1="14" x2="100" y2="14" />
        <line x1="100" y1="14" x2="100" y2="22" />
        {second === 'C' ? <g><line x1="92" y1="22" x2="108" y2="22" /><line x1="92" y1="28" x2="108" y2="28" /><line x1="100" y1="28" x2="100" y2="40" /></g> : <path d="M100,22 l0,3 l-5,3 l10,6 l-10,6 l10,6 l-5,3 l0,3" transform="scale(1,0.62) translate(0,9)" />}
        <line x1="92" y1="44" x2="108" y2="44" /><line x1="95" y1="48" x2="105" y2="48" />
        <line x1="100" y1="14" x2="130" y2="14" />
      </g>
      <circle cx="100" cy="14" r="2.5" fill="var(--en-ink)" />
      <text x="4" y="30" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--en-mute)">in</text>
      <text x="132" y="17" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--en-accent)">out</text>
      <text x="40" y="38" fontSize="10" fontWeight="800" fontFamily="var(--font-mono)" fill="var(--en-accent)">{first}</text>
      <text x="112" y="30" fontSize="10" fontWeight="800" fontFamily="var(--font-mono)" fill="var(--en-accent)">{second}</text>
    </svg>
  );
}

export function RcFilterPuzzle({ spec, record, onAttempt }: PuzzleProps<FilterSpec>) {
  const { play, settings } = useSettings();
  const start = useMemo(() => {
    const mid: [number, number] = [48, 6];
    return evaluate(spec, R_VALUES[mid[0]], C_VALUES[mid[1]]).solved ? ([0, 0] as [number, number]) : mid;
  }, [spec]);
  const [ri, setRi] = useState(start[0]);
  const [ci, setCi] = useState(start[1]);
  const [shown, setShown] = useState<Evaluation | null>(null);
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
  const r = R_VALUES[ri], c = C_VALUES[ci];

  // one pair that works, nearest the middle of what works (shown only when the puzzle is over)
  const example = useMemo(() => {
    const good: Array<[number, number, number]> = [];
    for (const rv of R_VALUES) for (const cv of C_VALUES) if (evaluate(spec, rv, cv).solved) good.push([rv, cv, cutoff(rv, cv)]);
    const lo = Math.min(...good.map((g) => g[2])), hi = Math.max(...good.map((g) => g[2]));
    const mid = Math.sqrt(lo * hi);
    return good.sort((a, b) => Math.abs(Math.log(a[2] / mid)) - Math.abs(Math.log(b[2] / mid)))[0];
  }, [spec]);

  const verdict = (ev: Evaluation) => {
    const L = latest.current;
    const attempt = L.record.attempts + 1;
    const facts = `The wanted ${fmtHz(L.spec.fWanted)} tone loses ${db1(ev.wantedLossDb!)} and the ${fmtHz(L.spec.fNoise)} noise is down ${db1(ev.noiseAttenDb!)}.`;
    if (ev.solved) {
      setMsg({ k: 'ok', t: `${facts} Clean.` });
      L.play('correct');
    } else {
      const last = attempt >= MAX_ATTEMPTS;
      setMsg({ k: last ? 'bad' : 'warn', t: last ? `${facts} Out of guesses. ${fmtOhms(example[0])} with ${fmtFarads(example[1])} would do it.` : `${facts} ${plural(MAX_ATTEMPTS - attempt)}.` });
      L.play('wrong');
    }
    setDrawing(false);
    L.onAttempt(ev.solved);
  };

  const run = () => {
    if (drawing || done) return;
    const ev = evaluate(spec, r, c);
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
    setDrawing(true);
    timer.current = window.setTimeout(() => {
      setDrawing(false);
      verdict(ev);
    }, 1500);
  };

  const finalShown = done && !mine ? null : shown;
  const st = shown && !drawing ? shown : null;
  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-rcfilter"
      view={
        <div className="ens-view" data-testid="rc-view">
          <Scope spec={spec} shown={finalShown} drawing={drawing} />
          <div className="ens-readout">grey: input · green: output</div>
          {st && (
            <div className="ens-readout r" data-testid="rc-result">
              {fmtHz(spec.fWanted)}: {minus(st.wantedLossDb!)} dB
              <br />
              {fmtHz(spec.fNoise)}: {minus(st.noiseAttenDb!)} dB
            </div>
          )}
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="rc-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}
          {mine ? `R = ${fmtOhms(r)} and C = ${fmtFarads(c)}` : `For instance R = ${fmtOhms(example[0])} and C = ${fmtFarads(example[1])}`} give a cutoff of{' '}
          <b className="font-mono">{fmtHz(mine ? cutoff(r, c) : example[2])}</b>.
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="ens-p min-w-0 flex-1">
            A {spec.type}-pass RC filter. Let the <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtHz(spec.fWanted)}</b> tone through with at most{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.maxPassLossDb} dB</b> loss, and knock the <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtHz(spec.fNoise)}</b> noise down by at least{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.minNoiseAttenDb} dB</b>.
          </p>
          <Mini type={spec.type} />
        </div>
      )}
      {!done && (
        <div className="flex flex-col gap-1">
          {(
            [
              ['R', ri, setRi, R_VALUES.length, fmtOhms(r), 'rc-r', 'Resistance'],
              ['C', ci, setCi, C_VALUES.length, fmtFarads(c), 'rc-c', 'Capacitance'],
            ] as const
          ).map(([name, idx, set, len, label, id, aria]) => (
            <div key={id} className="flex items-center gap-2">
              <b className="w-4 font-mono text-sm" style={{ color: 'var(--en-ink)' }}>{name}</b>
              <label className="flex-1">
                <span className="sr-only">{aria}</span>
                <input className="ens-range" type="range" min={0} max={len - 1} step={1} value={idx} disabled={drawing} onChange={(e) => set(Number(e.target.value))} aria-valuetext={label} data-testid={id} data-silent />
              </label>
              <b className="w-20 text-right font-mono text-sm" style={{ color: 'var(--en-accent)' }} data-testid={`${id}-value`}>{label}</b>
            </div>
          ))}
          <div className="flex justify-end">
            <button className="ens-btn" onClick={run} disabled={drawing} data-testid="rc-run">
              {drawing ? 'Running…' : 'Run the signal through'}
            </button>
          </div>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="rc-msg">{msg.t}</Note>}
    </Board>
  );
}
