'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { R_DIAL, bandwidth, bestPair, closedLoopGain, evaluate, maxSwing, type OpampSpec } from '@/engineerle/opamp';
import { formatOhms } from '@/engineerle/circuit';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps, guessesLeft } from './Board';
import { useClock } from './clock';
import { fmtHz } from './RcFilterPuzzle';
import { Dot, Ground, Resistor, Schematic, Wire } from './schematic';

const INFO = byId('opamp');
const W = 440, H = 230;
const SC = { x0: 228, x1: 432 };
const IN = { top: 14, bottom: 104 }, OUT = { top: 120, bottom: 216 };
const N = 600;

const sig = (x: number, d = 3) => Number(x.toPrecision(d));
const fmtV = (v: number) => (Math.abs(v) < 1 ? `${sig(v * 1000)} mV` : `${sig(v)} V`);
const fmtGain = (g: number) => `${g < 0 ? '−' : ''}${sig(Math.abs(g))}`;

export function OpampPuzzle({ spec, record, onAttempt }: PuzzleProps<OpampSpec>) {
  const clock = useClock();
  const { play, settings } = useSettings();
  const [fi, setFi] = useState(0);
  const [gi, setGi] = useState(0);
  const [shown, setShown] = useState<{ rf: number; rg: number } | null>(null);
  const [reveal, setReveal] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const raf = useRef(0);
  const done = record.done;
  const rf = R_DIAL[fi], rg = R_DIAL[gi];
  const inv = spec.mode === 'inverting';
  const answer = useMemo(() => bestPair(spec), [spec]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const T = 3 / spec.f;
  const vmax = maxSwing(spec);
  const px = (i: number) => SC.x0 + ((SC.x1 - SC.x0) * i) / (N - 1);
  const cur = shown ? evaluate(spec, shown.rf, shown.rg) : null;
  const outScale = cur ? (cur.clipped ? 1.4 * vmax : 1.6 * Math.max(spec.target, cur.amplitude)) : 1.6 * spec.target;
  const cyIn = (IN.top + IN.bottom) / 2, cyOut = (OUT.top + OUT.bottom) / 2;
  const kIn = ((IN.bottom - IN.top) / 2) * 0.64 / spec.vin;
  const kOut = ((OUT.bottom - OUT.top) / 2) / outScale;

  const inputPts = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i < N; i++) pts.push(`${px(i).toFixed(1)},${(cyIn - kIn * spec.vin * Math.sin(2 * Math.PI * spec.f * ((T * i) / (N - 1)))).toFixed(1)}`);
    return pts.join(' ');
  }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const outputPts = useMemo(() => {
    if (!cur || !shown) return '';
    const g = cur.gain, bw = cur.bandwidth;
    const phi = -Math.atan(spec.f / bw) + (g < 0 ? Math.PI : 0);
    const pts: string[] = [];
    for (let i = 0; i < N; i++) {
      const v = (Math.abs(g) * spec.vin / Math.sqrt(1 + (spec.f / bw) ** 2)) * Math.sin(2 * Math.PI * spec.f * ((T * i) / (N - 1)) + phi);
      const y = cyOut - kOut * Math.max(-vmax, Math.min(vmax, v));
      pts.push(`${px(i).toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [cur, shown, spec, kOut]); // eslint-disable-line react-hooks/exhaustive-deps

  const describe = (e: ReturnType<typeof evaluate>) => {
    const parts = [`Gain ${fmtGain(e.gain)}, bandwidth ${fmtHz(e.bandwidth)}. The output peaks at ${fmtV(e.amplitude)}; the target is ${fmtV(spec.target)} ±${sig(spec.tolerance * 100)}%.`];
    if (e.clipped) parts.push(`It wants to reach ${fmtV(e.ideal)} but clips at ±${fmtV(vmax)}, 1.5 V inside the rails.`);
    if (e.overBandwidth) parts.push(`The ${fmtHz(spec.f)} tone is above the stage's ${fmtHz(e.bandwidth)} bandwidth.`);
    return parts.join(' ');
  };

  const run = () => {
    if (busy || done) return;
    const ev = evaluate(spec, rf, rg);
    if (ev.refused) { setMsg({ k: 'bad', t: `${ev.refused} This didn't use up a guess.` }); play('wrong'); return; }
    clock.hold();
    setMsg(null);
    setBusy(true);
    const attempt = record.attempts + 1;
    setShown({ rf, rg });
    const finish = () => {
      setReveal(1);
      setBusy(false);
      const base = describe(ev);
      if (ev.solved) { setMsg({ k: 'ok', t: base }); play('correct'); }
      else {
        const out = attempt >= MAX_ATTEMPTS;
        setMsg({ k: out ? 'bad' : 'hint', t: out ? `${base} Out of guesses. Rf = ${formatOhms(answer[0])} with Rg = ${formatOhms(answer[1])} would have worked.` : `${base} ${guessesLeft(attempt)}` });
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

  const label = `${inv ? 'Inverting' : 'Non-inverting'} op-amp amplifier with feedback resistor Rf and resistor Rg. The input is a ${fmtV(spec.vin)} peak tone at ${fmtHz(spec.f)}.`;
  const dialGain = closedLoopGain(spec.mode, rf, rg);
  const shownAnswer = done ? (record.solved && shown ? ([shown.rf, shown.rg] as const) : answer) : null;
  const clipId = 'op-clip';

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-opamp"
      view={
        <div className="ens-view" data-testid="op-view" style={{ aspectRatio: `${W} / ${H}`, minHeight: 0 }}>
          <Schematic width={W} height={H} label={label}>
            <defs><clipPath id={clipId}><rect x={SC.x0} y={OUT.top} width={(SC.x1 - SC.x0) * reveal} height={OUT.bottom - OUT.top} /></clipPath></defs>
            {/* the amplifier */}
            <path d="M118 64 L118 156 L186 110 Z" />
            <text x="124" y="88" fontSize="14" fill="var(--en-ink)" stroke="none">−</text>
            <text x="124" y="144" fontSize="14" fill="var(--en-ink)" stroke="none">+</text>
            <Wire pts={[[118, 84], [100, 84]]} />
            <Dot x={100} y={84} />
            <Wire pts={[[100, 84], [100, 40]]} />
            <Resistor x1={100} y1={40} x2={196} y2={40} name="Rf" value={formatOhms(rf)} free side="above" />
            <Wire pts={[[196, 40], [206, 40], [206, 110], [186, 110]]} />
            <Dot x={206} y={110} />
            <circle cx={206} cy={110} r={3} />
            <text x={206} y={130} textAnchor="middle" fontSize="11" fill="var(--en-mute)" stroke="none">out</text>
            {inv ? (
              <>
                <circle cx={16} cy={84} r={3} fill="var(--en-panel, transparent)" />
                <text x={16} y={70} textAnchor="middle" fontSize="11" fill="var(--en-mute)" stroke="none">in</text>
                <Resistor x1={19} y1={84} x2={100} y2={84} name="Rg" value={formatOhms(rg)} free side="below" />
                <Wire pts={[[118, 136], [100, 136], [100, 160]]} />
                <Ground x={100} y={160} />
              </>
            ) : (
              <>
                <Resistor x1={100} y1={84} x2={48} y2={84} name="Rg" value={formatOhms(rg)} free side="above" />
                <Wire pts={[[48, 84], [40, 84], [40, 110]]} />
                <Ground x={40} y={110} />
                <circle cx={16} cy={136} r={3} fill="var(--en-panel, transparent)" />
                <text x={16} y={156} textAnchor="middle" fontSize="11" fill="var(--en-mute)" stroke="none">in</text>
                <Wire pts={[[19, 136], [118, 136]]} />
              </>
            )}
            {/* the scope */}
            {[IN, OUT].map((p, i) => (
              <g key={i}>
                <rect x={SC.x0} y={p.top} width={SC.x1 - SC.x0} height={p.bottom - p.top} stroke="var(--en-line2)" strokeWidth="1" />
                <line x1={SC.x0} y1={(p.top + p.bottom) / 2} x2={SC.x1} y2={(p.top + p.bottom) / 2} stroke="var(--en-line)" strokeWidth="1" strokeDasharray="3 4" />
                <text x={SC.x0 + 4} y={p.top + 11} fontSize="10" fill="var(--en-mute)" stroke="none">{i === 0 ? `INPUT  peak ${fmtV(spec.vin)}` : 'OUTPUT'}</text>
              </g>
            ))}
            <polyline points={inputPts} stroke="var(--en-mute)" strokeWidth="1.6" />
            {[1, -1].map((s) => <line key={s} x1={SC.x0} x2={SC.x1} y1={cyOut - s * kOut * spec.target} y2={cyOut - s * kOut * spec.target} stroke="var(--en-line2)" strokeWidth="1.1" strokeDasharray="4 4" />)}
            {cur && cur.clipped && [1, -1].map((s) => <line key={`r${s}`} x1={SC.x0} x2={SC.x1} y1={cyOut - s * kOut * vmax} y2={cyOut - s * kOut * vmax} stroke="var(--en-bad, #e86a6a)" strokeWidth="1" strokeDasharray="2 3" />)}
            {shown && <g clipPath={`url(#${clipId})`}><polyline points={outputPts} stroke="var(--en-accent)" strokeWidth="1.9" /></g>}
            <text x={SC.x1 - 4} y={OUT.top + 11} textAnchor="end" fontSize="10" fill="var(--en-line2)" stroke="none">dashed: target ±{fmtV(spec.target)}</text>
            <text x={SC.x1 - 4} y={OUT.bottom - 4} textAnchor="end" fontSize="10" fill="var(--en-mute)" stroke="none">limit ±{fmtV(vmax)}</text>
          </Schematic>
        </div>
      }
    >
      {!done ? (
        <p className="ens-p" data-testid="op-brief">
          A <b style={{ color: 'var(--en-ink)' }}>{inv ? 'inverting' : 'non-inverting'}</b> amplifier on a <b style={{ color: 'var(--en-ink)' }}>±{spec.supply} V</b> supply with a <b style={{ color: 'var(--en-ink)' }}>{fmtHz(spec.gbw)}</b> gain-bandwidth product. The input is a <b style={{ color: 'var(--en-ink)' }}>{fmtV(spec.vin)}</b> peak tone at <b style={{ color: 'var(--en-ink)' }}>{fmtHz(spec.f)}</b>. Choose Rf and Rg so the output peaks at <b style={{ color: 'var(--en-ink)' }}>{fmtV(spec.target)}</b> (within {sig(spec.tolerance * 100)}%), without clipping and with the tone inside the stage's bandwidth.
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="op-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}Rf = {formatOhms(shownAnswer![0])} and Rg = {formatOhms(shownAnswer![1])}: gain {fmtGain(closedLoopGain(spec.mode, shownAnswer![0], shownAnswer![1]))}, bandwidth GBW/(1 + Rf/Rg) = {fmtHz(bandwidth(spec.gbw, closedLoopGain(spec.mode, shownAnswer![0], shownAnswer![1])))}.
        </div>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="ens-card flex min-w-[10.5rem] flex-col gap-1 p-2.5" style={{ background: 'var(--en-panel2)' }} aria-label="Amplifier readings" aria-live="polite">
          <span className="ens-label">Gain</span>
          <span className="font-mono text-xl font-bold" style={{ color: 'var(--en-accent)' }} data-testid="op-reading">{fmtGain(dialGain)}</span>
          <span className="font-mono text-xs" style={{ color: 'var(--en-mute)' }} data-testid="op-peak">{cur ? `output peak ${fmtV(cur.amplitude)}` : 'not run yet'}</span>
        </div>
        {!done && (
          <div className="flex min-w-[15rem] flex-1 flex-col gap-2">
            <label className="flex items-center gap-2">
              <span className="ens-label w-5">Rf</span>
              <input type="range" min={0} max={R_DIAL.length - 1} step={1} value={fi} disabled={busy} onChange={(e) => setFi(Number(e.target.value))} className="ens-range flex-1" aria-label="Feedback resistor Rf" aria-valuetext={formatOhms(rf)} data-testid="op-rf" />
              <b className="w-[4.5rem] text-right font-mono text-sm" style={{ color: 'var(--en-ink)' }} data-testid="op-rf-value">{formatOhms(rf)}</b>
            </label>
            <label className="flex items-center gap-2">
              <span className="ens-label w-5">Rg</span>
              <input type="range" min={0} max={R_DIAL.length - 1} step={1} value={gi} disabled={busy} onChange={(e) => setGi(Number(e.target.value))} className="ens-range flex-1" aria-label="Resistor Rg" aria-valuetext={formatOhms(rg)} data-testid="op-rg" />
              <b className="w-[4.5rem] text-right font-mono text-sm" style={{ color: 'var(--en-ink)' }} data-testid="op-rg-value">{formatOhms(rg)}</b>
            </label>
          </div>
        )}
      </div>
      {!done && (
        <div className="flex justify-end">
          <button className="ens-btn" onClick={run} disabled={busy} data-testid="op-run">{busy ? 'Running…' : 'Run the amplifier'}</button>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="op-msg">{msg.t}</Note>}
    </Board>
  );
}
