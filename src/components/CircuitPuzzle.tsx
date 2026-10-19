'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { E24, evaluate, formatOhms, type CircuitSpec } from '@/engineerle/circuit';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, type PuzzleProps, guessesLeft } from './Board';
import { useClock } from './clock';
import { Battery, Dot, Ground, Meter, Resistor, Schematic, Wire } from './schematic';

const INFO = byId('circuit');
const DECADES = [1, 10, 100, 1e3, 1e4, 1e5, 1e6];
const W = 440;

const fmtReading = (v: number, unit: string) => `${Number(v.toPrecision(3))} ${unit}`;

interface Parts {
  /** [x1, y1, x2, y2, label side] for each resistor, in spec order. */
  res: Array<[number, number, number, number, 'above' | 'below' | 'left' | 'right']>;
  wires: Array<Array<[number, number]>>;
  dots: Array<[number, number]>;
  ground: Array<[number, number]>;
  meter: { x: number; y: number; letter: string; inline?: boolean; plus?: 'left' | 'right' };
  height: number;
}

/** Where everything goes for each template. Resistors follow the order in `makeCircuit`. */
function layout(spec: CircuitSpec): Parts {
  const ammeter = spec.meter.kind === 'source';
  switch (spec.template) {
    case 'series':
      return {
        res: [[140, 60, 200, 60, 'above'], [220, 60, 280, 60, 'above'], [300, 60, 360, 60, 'above']],
        wires: [[[50, 60], [78, 60]], [[112, 60], [140, 60]], [[200, 60], [220, 60]], [[280, 60], [300, 60]], [[360, 60], [390, 60], [390, 180], [50, 180]]],
        dots: [],
        ground: [[50, 180]],
        meter: { x: 95, y: 60, letter: 'A' },
        height: 230,
      };
    case 'divider': {
      const left = ammeter ? 130 : 100;
      return {
        res: [[left, 60, left + 70, 60, 'above'], [280, 90, 280, 150, 'right'], [360, 90, 360, 150, 'right']],
        wires: [
          ammeter ? [[50, 60], [60, 60]] : [[50, 60], [left, 60]],
          [[left + 70, 60], [360, 60]], [[280, 60], [280, 90]], [[280, 150], [280, 180]], [[360, 60], [360, 90]], [[360, 150], [360, 180]], [[50, 180], [360, 180]],
          ...(ammeter ? [[[60, 60], [78, 60]], [[112, 60], [left, 60]]] as Array<Array<[number, number]>> : [[[230, 60], [230, 95]], [[230, 125], [230, 180]]] as Array<Array<[number, number]>>),
        ],
        dots: [[280, 60], [360, 60], ...(ammeter ? [] : [[230, 60] as [number, number]]), [280, 180], [360, 180]],
        ground: [[50, 180]],
        meter: ammeter ? { x: 95, y: 60, letter: 'A' } : { x: 230, y: 110, letter: 'V' },
        height: 230,
      };
    }
    case 'ladder': {
      const left = ammeter ? 130 : 100;
      const nodeA = spec.meter.kind === 'node' && spec.meter.node === 2;
      return {
        res: [[left, 60, left + 60, 60, 'above'], [190, 90, 190, 150, 'left'], [250, 60, 310, 60, 'above'], [330, 90, 330, 150, 'left']],
        wires: [
          ammeter ? [[50, 60], [60, 60]] : [[50, 60], [left, 60]],
          [[left + 60, 60], [190, 60], [250, 60]], [[190, 60], [190, 90]], [[190, 150], [190, 180]],
          [[310, 60], [330, 60], [330, 90]], [[330, 150], [330, 180]], [[50, 180], [330, 180]],
          ...(ammeter ? [[[60, 60], [78, 60]], [[112, 60], [left, 60]]] as Array<Array<[number, number]>> : []),
          ...(!ammeter && nodeA ? [[[232, 60], [232, 95]], [[232, 125], [232, 180]]] as Array<Array<[number, number]>> : []),
          ...(!ammeter && !nodeA ? [[[330, 60], [385, 60], [385, 95]], [[385, 125], [385, 180], [330, 180]]] as Array<Array<[number, number]>> : []),
        ],
        dots: [[190, 60], [330, 60], [190, 180], [330, 180], ...(nodeA && !ammeter ? [[232, 60] as [number, number], [232, 180] as [number, number]] : [])],
        ground: [[50, 180]],
        meter: ammeter ? { x: 95, y: 60, letter: 'A' } : nodeA ? { x: 232, y: 110, letter: 'V' } : { x: 385, y: 110, letter: 'V' },
        height: 230,
      };
    }
    case 'bridge': {
      const plusLeft = spec.meter.kind === 'across' && spec.meter.a === 2;
      return {
        res: [[222, 48, 138, 102, 'left'], [138, 120, 222, 174, 'left'], [238, 48, 322, 102, 'right'], [322, 120, 238, 174, 'right'], [150, 111, 310, 111, 'above']],
        wires: [[[50, 40], [230, 40]], [[230, 40], [222, 48]], [[238, 48], [230, 40]], [[50, 180], [230, 180]], [[222, 174], [230, 180]], [[238, 174], [230, 180]], [[130, 111], [150, 111]], [[310, 111], [330, 111]], [[130, 111], [138, 102]], [[130, 111], [138, 120]], [[330, 111], [322, 102]], [[330, 111], [322, 120]], [[130, 111], [96, 111], [96, 218], [215, 218]], [[245, 218], [364, 218], [364, 111], [330, 111]]],
        dots: [[230, 40], [230, 180], [130, 111], [330, 111]],
        ground: [[50, 180]],
        meter: { x: 230, y: 218, letter: 'V', inline: true, plus: plusLeft ? 'left' : 'right' },
        height: 250,
      };
    }
  }
}

export function CircuitPuzzle({ spec, record, onAttempt }: PuzzleProps<CircuitSpec>) {
  const clock = useClock();
  const { play, settings } = useSettings();
  const initial = useMemo(() => {
    const d = DECADES.findIndex((m) => spec.initial >= m && spec.initial < m * 10);
    const e = E24.findIndex((v) => Math.abs(v * DECADES[Math.max(0, d)] - spec.initial) < 1e-6);
    return { d: Math.max(0, d), e: Math.max(0, e) };
  }, [spec.initial]);
  const [dec, setDec] = useState(initial.d);
  const [e24, setE24] = useState(initial.e);
  const [shown, setShown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const raf = useRef(0);
  const done = record.done;
  const ohms = Number((E24[e24] * DECADES[dec]).toPrecision(6));
  const parts = useMemo(() => layout(spec), [spec]);
  const H = parts.height;
  const unit = spec.target.unit;

  // the right answer is wired in once the puzzle is over
  const answer = useMemo(() => {
    for (let d = 0; d < DECADES.length; d++) for (let e = 0; e < E24.length; e++) {
      const v = Number((E24[e] * DECADES[d]).toPrecision(6));
      if (evaluate(spec, v).solved) return v;
    }
    return spec.initial;
  }, [spec]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const test = () => {
    if (busy || done) return;
    const ev = evaluate(spec, ohms);
    if (ev.refused) {
      setMsg({ k: 'bad', t: `${ev.refused} This didn't use up a guess.` });
      play('wrong');
      return;
    }
    clock.hold();
    setMsg(null);
    setBusy(true);
    const attempt = record.attempts + 1;
    const finish = () => {
      setShown(ev.measured);
      setBusy(false);
      if (ev.solved) {
        setMsg({ k: 'ok', t: `The meter reads ${fmtReading(ev.measured, unit)}: within 2% of the target.` });
        play('correct');
      } else {
        const base = `The meter reads ${fmtReading(ev.measured, unit)}; the target is ${fmtReading(spec.target.value, unit)}.`;
        setMsg({ k: attempt >= MAX_ATTEMPTS ? 'bad' : 'hint', t: attempt >= MAX_ATTEMPTS ? `${base} Out of guesses. The missing resistor was ${formatOhms(answer)}.` : `${base} ${guessesLeft(attempt)}` });
        play('wrong');
      }
      onAttempt(ev.solved);
    };
    if (settings.reduceMotion) {
      finish();
      return;
    }
    // the meter settles on its reading
    play('tick');
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 900);
      const ease = 1 - (1 - t) ** 3;
      const wobble = t < 1 ? Math.sin(t * 30) * (1 - t) * 0.06 * ev.measured : 0;
      setShown(ev.measured * ease + wobble);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else finish();
    };
    raf.current = requestAnimationFrame(step);
  };

  const meterText = shown === null ? '— — —' : fmtReading(shown, unit);
  const names = spec.resistors.map((_, i) => `R${i + 1}`);
  const label = `Circuit: a ${spec.source.volts} volt supply and ${spec.resistors.length} resistors, one of them missing. The meter measures ${spec.meter.kind === 'source' ? 'the supply current' : spec.meter.kind === 'node' ? `the voltage at node ${spec.meter.node}` : 'the voltage across the middle of the bridge'}.`;
  const what = spec.meter.kind === 'source' ? 'Supply current' : spec.meter.kind === 'across' ? 'Voltage across the bridge (A − B)' : 'Voltage at the marked node';

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-circuit"
      view={
        <div className="ens-view" data-testid="circuit-view" style={{ aspectRatio: `${W} / ${H}`, minHeight: 0 }}>
          <Schematic width={W} height={H} label={label}>
            {parts.wires.map((w, i) => <Wire key={i} pts={w} />)}
            {parts.dots.map(([x, y], i) => <Dot key={i} x={x} y={y} />)}
            {parts.ground.map(([x, y], i) => <Ground key={i} x={x} y={y} />)}
            <Battery x={50} y1={spec.template === 'bridge' ? 40 : 60} y2={180} volts={spec.source.volts} />
            {parts.res.map(([x1, y1, x2, y2, side], i) => (
              <Resistor key={i} x1={x1} y1={y1} x2={x2} y2={y2} side={side} name={i === spec.free ? 'Rx' : spec.template === 'bridge' && i === 4 ? 'Rm' : names[i]} value={i === spec.free ? (done ? formatOhms(answer) : formatOhms(ohms)) : formatOhms(spec.resistors[i].ohms)} free={i === spec.free} />
            ))}
            <Meter x={parts.meter.x} y={parts.meter.y} letter={parts.meter.letter} inline={parts.meter.inline} plus={parts.meter.plus} reading={shown === null ? undefined : fmtReading(shown, unit)} testId="circuit-meter-reading" />
          </Schematic>
        </div>
      }
    >
      {!done ? (
        <p className="ens-p">
          The meter in the circuit must read <b style={{ color: 'var(--en-ink)' }} data-testid="circuit-target">{fmtReading(spec.target.value, unit)}</b> (within 2%). {what}. Choose the standard E24 value for the missing resistor Rx, then test it.
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="circuit-final">
          {record.solved ? 'Solved. ' : 'Out of guesses. '}Rx = <b className="font-mono">{formatOhms(record.solved ? ohms : answer)}</b>, which makes the meter read about {fmtReading(spec.target.value, unit)}.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="ens-card flex min-w-[10.5rem] flex-col gap-1 p-2.5" style={{ background: 'var(--en-panel2)' }} aria-label="Multimeter">
          <span className="ens-label">Multimeter</span>
          <span className="font-mono text-xl font-bold" style={{ color: 'var(--en-accent)', letterSpacing: '0.02em' }} data-testid="circuit-reading" aria-live="polite">
            {meterText}
          </span>
          <span className="ens-label">target {fmtReading(spec.target.value, unit)} ±2%</span>
        </div>
        {!done && (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="ens-label">Rx</span>
              <b className="font-mono text-lg" style={{ color: 'var(--en-ink)' }} data-testid="circuit-value">{formatOhms(ohms)}</b>
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Decade">
              {DECADES.map((m, i) => (
                <button key={m} type="button" className="ens-chip" data-on={dec === i} disabled={busy} onClick={() => { setDec(i); setShown(null); }} aria-pressed={dec === i} data-testid={`circuit-decade-${i}`}>
                  {formatOhms(m)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <span className="ens-label">E24</span>
              <input
                type="range"
                min={0}
                max={E24.length - 1}
                step={1}
                value={e24}
                disabled={busy}
                onChange={(e) => { setE24(Number(e.target.value)); setShown(null); }}
                className="ens-range flex-1"
                aria-label="E24 value within the decade"
                aria-valuetext={formatOhms(ohms)}
                data-testid="circuit-e24"
              />
            </label>
          </div>
        )}
      </div>
      {!done && (
        <div className="flex justify-end">
          <button className="ens-btn" onClick={test} disabled={busy} data-testid="circuit-test">
            {busy ? 'Measuring…' : 'Test this resistor'}
          </button>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="circuit-msg">{msg.t}</Note>}
    </Board>
  );
}
