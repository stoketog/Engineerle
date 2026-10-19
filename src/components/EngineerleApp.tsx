'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { MAX_DAY_POINTS, getEngineerleDaily, type DailyPuzzle } from '@/engineerle/daily';
import type { GraphSpec } from '@/engineerle/graph';
import type { LeverSpec } from '@/engineerle/lever';
import type { BridgeSpec } from '@/engineerle/truss';
import type { CrankshaftSpec } from '@/engineerle/crankshaft';
import type { BargeSpec } from '@/engineerle/barge';
import type { CircuitSpec } from '@/engineerle/circuit';
import type { PowerlineSpec } from '@/engineerle/powerline';
import { addSeconds, dayDone, dayPoints, daySolved, emptyStore, getDay, loadStore, recordAttempt, saveStore, shareText, square, streak, totals, type EngineerleStore, type PuzzleRecord } from '@/engineerle/store';
import { formatCountdown, msUntilNextDay, prettyDate, toDateKey } from '@/lib/dates';
import { useSettings } from '@/hooks/useSettings';
import { useStopwatch } from '@/hooks/useStopwatch';
import { OBSCURA_URL } from '@/lib/sites';
import { withSettings } from '@/lib/settings';
import { IconChart, IconHelp, IconMenu } from './Icons';
import { Modal } from './Modal';
import { SettingsModal } from './SettingsModal';
import { Sidebar } from './Sidebar';
import { EngineerleMark, EngineerleWord } from './Logo';
import { GraphPuzzle } from './GraphPuzzle';
import { LeverPuzzle } from './LeverPuzzle';
import { BridgePuzzle } from './BridgePuzzle';
import { CrankshaftPuzzle } from './CrankshaftPuzzle';
import { BargePuzzle } from './BargePuzzle';
import { CircuitPuzzle } from './CircuitPuzzle';
import { PowerlinePuzzle } from './PowerlinePuzzle';

const SEEN = 'engineerle:v1:help-seen';

function useToday() {
  const [key, setKey] = useState(() => toDateKey(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setKey((k) => (toDateKey(new Date()) === k ? k : toDateKey(new Date()))), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return key;
}

export default function EngineerleApp() {
  const { play, settings } = useSettings();
  const dateKey = useToday();
  const [store, setStore] = useState<EngineerleStore>(emptyStore);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(0);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<null | 'help' | 'stats' | 'settings'>(null);
  const daily = useMemo(() => getEngineerleDaily(dateKey), [dateKey]);
  const day = getDay(store, dateKey);
  const finished = dayDone(day);

  useEffect(() => {
    setStore(loadStore());
    setReady(true);
    try {
      if (!window.localStorage.getItem(SEEN)) setModal('help');
    } catch {
      /* no storage */
    }
  }, []);
  // open on the first puzzle that is not finished
  useEffect(() => {
    if (!ready) return;
    const first = getDay(loadStore(), dateKey).puzzles.findIndex((p) => !p.done);
    setTab(first < 0 ? 5 : first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dateKey]);

  const closeHelp = () => {
    setModal(null);
    try {
      window.localStorage.setItem(SEEN, '1');
    } catch {
      /* no storage */
    }
  };

  // the running clock of the puzzle on screen, so a guess is scored on the exact time, not the last saved second
  const live = useRef<{ index: number; seconds: number } | null>(null);
  const saveSeconds = useCallback(
    (index: number, seconds: number) => {
      setStore((prev) => {
        const next = addSeconds(prev, dateKey, index, seconds - getDay(prev, dateKey).puzzles[index].seconds);
        if (next !== prev) saveStore(next);
        return next;
      });
    },
    [dateKey],
  );

  const attempt = useCallback(
    (index: number, solved: boolean) => {
      const par = daily.puzzles[index]?.def.parSeconds ?? 90;
      setStore((prev) => {
        const l = live.current;
        const timed = l && l.index === index ? addSeconds(prev, dateKey, index, l.seconds - getDay(prev, dateKey).puzzles[index].seconds) : prev;
        const next = recordAttempt(timed, dateKey, index, solved, par);
        if (next !== prev) {
          saveStore(next);
          const rec = getDay(next, dateKey).puzzles[index];
          if (rec.done) {
            window.setTimeout(() => play(rec.solved ? 'solved' : 'failed'), 450);
            if (dayDone(getDay(next, dateKey))) window.setTimeout(() => play('finish'), 1400);
          }
        }
        return next;
      });
    },
    [dateKey, play, daily],
  );

  const puzzle = (i: number) => {
    const rec = day.puzzles[i];
    const p = daily.puzzles[i];
    const key = `${dateKey}-${p.def.id}`;
    const common = { record: rec, onAttempt: (s: boolean) => attempt(i, s) };
    switch (p.def.id) {
      case 'waveform': return <GraphPuzzle key={key} spec={p.spec as GraphSpec} {...common} />;
      case 'lever': return <LeverPuzzle key={key} spec={p.spec as LeverSpec} {...common} />;
      case 'bridge': return <BridgePuzzle key={key} spec={p.spec as BridgeSpec} {...common} />;
      case 'crankshaft': return <CrankshaftPuzzle key={key} spec={p.spec as CrankshaftSpec} {...common} />;
      case 'barge': return <BargePuzzle key={key} spec={p.spec as BargeSpec} {...common} />;
      case 'resistor': return <CircuitPuzzle key={key} spec={p.spec as CircuitSpec} {...common} />;
      case 'powerline': return <PowerlinePuzzle key={key} spec={p.spec as PowerlineSpec} {...common} />;
      default: return null;
    }
  };

  const goto = (i: number) => {
    play('tap');
    setTab(i);
    document.querySelector('[data-testid="ens-scroll"]')?.scrollTo({ top: 0 });
  };

  return (
    <div className="ens" data-testid="ens-scroll" data-reduce={settings.reduceMotion}>
      <div className="ens-paper" aria-hidden />
      <div className="ens-sheet">
        <header className="ens-head">
          <button className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)} data-testid="menu-btn">
            <IconMenu size={18} />
          </button>
          <span className="flex items-center gap-2.5" style={{ color: 'var(--en-ink)' }} data-testid="ens-logo">
            <EngineerleMark size={30} />
            <EngineerleWord />
          </span>
          <div className="flex items-center gap-2">
            <button className="icon-btn" aria-label="Statistics" onClick={() => setModal('stats')} data-testid="ens-stats-btn">
              <IconChart size={17} />
            </button>
            <button className="icon-btn" aria-label="How to play" onClick={() => setModal('help')} data-testid="ens-help-btn">
              <IconHelp size={17} />
            </button>
          </div>
        </header>

        <p className="ens-p mb-2 mt-1 text-center" data-testid="ens-date">
          No. {daily.number} · {prettyDate(dateKey)}
        </p>

        <nav className="ens-tabs mb-3" aria-label="Today's five puzzles">
          {daily.puzzles.map(({ def: p }, i) => {
            const r = day.puzzles[i];
            return (
              <button
                key={p.id}
                className="ens-tab"
                data-on={tab === i}
                data-state={r.solved ? 'solved' : r.done ? 'failed' : 'open'}
                data-tries={r.attempts}
                aria-current={tab === i ? 'page' : undefined}
                aria-label={`${i + 1}. ${p.title}${r.solved ? ', solved' : r.done ? ', not solved' : r.attempts ? `, ${r.attempts} guesses used` : ''}`}
                onClick={() => goto(i)}
                data-testid={`ens-tab-${i}`}
              >
                <small>{i + 1}</small>
                <span>{p.tab}</span>
                <i />
              </button>
            );
          })}
        </nav>

        {!ready ? (
          <div className="ens-card grid h-64 place-items-center" aria-busy>
            <EngineerleMark size={48} />
          </div>
        ) : tab < 5 ? (
          <>
            <PuzzleClock
              key={`clock-${dateKey}-${daily.puzzles[tab].def.id}`}
              index={tab}
              par={daily.puzzles[tab].def.parSeconds}
              record={day.puzzles[tab]}
              paused={modal !== null || menu}
              live={live}
              onSave={saveSeconds}
            />
            {puzzle(tab)}
            {day.puzzles[tab].done && (
              <div className="mt-3 flex justify-end ens-fade">
                {tab < 4 ? (
                  <button className="ens-btn" onClick={() => goto(tab + 1)} data-testid="ens-next">
                    Next puzzle
                  </button>
                ) : (
                  <button className="ens-btn" onClick={() => goto(5)} data-testid="ens-next">
                    {finished ? 'See your results' : 'Back to the unfinished ones'}
                  </button>
                )}
              </div>
            )}
            {finished && tab < 5 && (
              <div className="mt-2 flex justify-end">
                <button className="ens-ghost" onClick={() => goto(5)} data-testid="ens-results-link">
                  Today&apos;s results
                </button>
              </div>
            )}
          </>
        ) : (
          <Summary dateKey={dateKey} number={daily.number} puzzles={daily.puzzles} store={store} onGo={goto} />
        )}
      </div>

      {menu && (
        <Sidebar
          onStats={() => setModal('stats')}
          onHelp={() => setModal('help')}
          onSettings={() => setModal('settings')}
          onClose={() => setMenu(false)}
        />
      )}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'help' && <EngineerleHelp onClose={closeHelp} />}
      {modal === 'stats' && <EngineerleStats store={store} today={dateKey} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ───────────────────────────── timer ───────────────────────────── */

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Time spent on this puzzle against its par. Runs only while the puzzle is open and unfinished. */
function PuzzleClock({ index, par, record, paused, live, onSave }: { index: number; par: number; record: PuzzleRecord; paused: boolean; live: MutableRefObject<{ index: number; seconds: number } | null>; onSave: (index: number, seconds: number) => void }) {
  const seconds = useStopwatch(!record.done && !paused, record.seconds, (sec) => onSave(index, sec));
  useEffect(() => {
    live.current = { index, seconds };
    return () => {
      if (live.current?.index === index) live.current = null;
    };
  }, [live, index, seconds]);
  const shown = record.done ? record.seconds : seconds;
  return (
    <div className="ens-clock" data-testid="ens-clock" data-state={record.done ? 'done' : paused ? 'paused' : 'running'}>
      <span className="ens-label">Time</span>
      <b className="font-mono" data-testid="ens-timer" data-seconds={Math.floor(shown)}>{formatClock(shown)}</b>
      <span className="ens-label" data-testid="ens-par">Par {formatClock(par)}</span>
    </div>
  );
}

/* ───────────────────────────── results ───────────────────────────── */

function Summary({ dateKey, number, puzzles, store, onGo }: { dateKey: string; number: number; puzzles: DailyPuzzle[]; store: EngineerleStore; onGo: (i: number) => void }) {
  const { settings } = useSettings();
  const day = getDay(store, dateKey);
  const finished = dayDone(day);
  const [left, setLeft] = useState(msUntilNextDay());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setLeft(msUntilNextDay()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const pts = dayPoints(day);
  const text = shareText(dateKey, day, typeof window !== 'undefined' ? window.location.origin : '');
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* cancelled: fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy your result', text);
    }
  };
  return (
    <section className="ens-card ens-fade p-4 sm:p-5" data-testid="ens-summary" aria-label="Today's results">
      <h2 className="ens-h">{finished ? 'Drawing signed off' : 'Still on the board'}</h2>
      <p className="ens-p">Engineerle No. {number}</p>
      <div className="my-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-4xl font-bold leading-none" style={{ color: 'var(--en-ink)' }} data-testid="ens-points">
            {pts}
            <span className="text-lg font-semibold" style={{ color: 'var(--en-faint)' }}> / {MAX_DAY_POINTS}</span>
          </p>
          <p className="ens-label mt-1">{daySolved(day)} of 5 solved</p>
        </div>
        <div className="ens-result" aria-label="Your results" data-testid="ens-squares">
          {day.puzzles.map((p, i) => (
            <span key={i}>{p.done || p.attempts ? square(p) : '⬜'}</span>
          ))}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col p-0" style={{ borderTop: '1px solid var(--en-line)' }}>
        {puzzles.map(({ def: p }, i) => {
          const r = day.puzzles[i];
          return (
            <li key={p.id} style={{ borderBottom: '1px solid var(--en-line)' }}>
              <button className="flex w-full items-center gap-3 py-2.5 text-left" style={{ background: 'transparent', border: 0, color: 'var(--en-ink)', cursor: 'pointer' }} onClick={() => onGo(i)}>
                <span className="w-6 text-lg">{r.done || r.attempts ? square(r) : '⬜'}</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-sm">{p.title}</b>
                  <span className="ens-label">{r.solved ? `Solved on guess ${r.attempts}` : r.done ? 'Not solved' : r.attempts ? `${r.attempts} guesses used` : 'Not started'}</span>
                </span>
                <b className="font-mono text-sm">{r.points}</b>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="ens-label">
          Next puzzles in <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{formatCountdown(left)}</b>
        </p>
        <div className="flex gap-2">
          <a className="ens-ghost" href={withSettings(OBSCURA_URL, settings)} data-testid="ens-to-obscura" data-silent>
            Play Obscura
          </a>
          <button className="ens-btn" onClick={share} disabled={!finished} data-testid="ens-share">
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── help and stats ───────────────────────────── */

function EngineerleHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play Engineerle" onClose={onClose} testId="ens-help-modal">
      <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--color-mist-300)' }}>
        <p>Five engineering puzzles a day, the same for everyone. Each has real physics behind it, so you can work the answer out rather than guess.</p>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          <li><b className="text-white">Curve.</b> Read the graph and type the equation. The dots are points it passes through exactly.</li>
          <li><b className="text-white">Lever.</b> Slide the pivot under a loaded plank so it hangs level when released.</li>
          <li><b className="text-white">Bridge.</b> Pick the members that are too thin, then send the truck over. Squeezed members buckle, stretched ones snap.</li>
          <li><b className="text-white">Firing order.</b> A four-stroke fires one cylinder after another, evenly spaced. Choose the order that makes the engine run smooth.</li>
          <li><b className="text-white">Barge.</b> Balance her with ballast so she floats upright and level.</li>
        </ol>
        <p>You get three guesses on each, and a clock runs while a puzzle is open. A puzzle is worth up to 100 points: all of them for a first-guess solve inside its par time, less for a second or third guess and for every second over par. There are no hints.</p>
        <button className="btn-primary mt-1" onClick={onClose} data-testid="ens-help-ok">Start</button>
      </div>
    </Modal>
  );
}

function EngineerleStats({ store, today, onClose }: { store: EngineerleStore; today: string; onClose: () => void }) {
  const t = totals(store);
  const s = streak(store, today);
  const cell = (label: string, v: string | number) => (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
      <p className="font-mono text-2xl font-bold text-white">{v}</p>
      <p className="text-xs text-mist-500">{label}</p>
    </div>
  );
  return (
    <Modal title="Engineerle statistics" onClose={onClose} testId="ens-stats-modal">
      <div className="grid grid-cols-3 gap-2">
        {cell('Days played', t.played)}
        {cell('Day streak', s)}
        {cell('Perfect days', t.perfect)}
        {cell('Puzzles solved', t.solved)}
        {cell('Best day', t.best)}
        {cell('Total points', t.points)}
      </div>
      {t.played === 0 && <p className="mt-4 text-center text-sm text-mist-500">Finish a day&apos;s five puzzles to see your numbers here.</p>}
    </Modal>
  );
}
