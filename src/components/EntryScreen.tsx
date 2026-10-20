'use client';

import { useEffect, useState } from 'react';
import { DISCIPLINE_NAMES } from '@/engineerle/registry';
import type { DailyPuzzle } from '@/engineerle/daily';
import { MAX_DAY_POINTS } from '@/engineerle/daily';
import { dayDone, dayPoints, square, type DayRecord } from '@/engineerle/store';
import { formatCountdown, msUntilNextDay, prettyDate } from '@/lib/dates';
import { withSettings } from '@/lib/settings';
import { OBSCURA_URL } from '@/lib/sites';
import { useSettings } from '@/hooks/useSettings';
import { EngineerleMark, EngineerleWord } from './Logo';

const LEVEL = ['Easy', 'Medium', 'Hard'] as const;

/**
 * The first thing a player sees: the day's drawing sheet. The title block says which sheet it is, the parts list is the
 * day's five puzzles by discipline (never by name, that would spoil them), and one button starts, resumes or opens the results.
 */
export function EntryScreen({ dateKey, number, puzzles, day, streakDays, onStart, onHelp }: { dateKey: string; number: number; puzzles: DailyPuzzle[]; day: DayRecord; streakDays: number; onStart: () => void; onHelp: () => void }) {
  const { settings } = useSettings();
  const finished = dayDone(day);
  const done = day.puzzles.filter((p) => p.done).length;
  const state = finished ? 'done' : done > 0 || day.puzzles.some((p) => p.attempts > 0) ? 'continue' : 'new';
  const [left, setLeft] = useState(msUntilNextDay());
  useEffect(() => {
    if (!finished) return;
    const id = window.setInterval(() => setLeft(msUntilNextDay()), 1000);
    return () => window.clearInterval(id);
  }, [finished]);

  return (
    <section className="ens-entry" data-testid="ens-entry" data-state={state} aria-label="Engineerle, today's drawing">
      <div className="ens-entry-hero">
        <EngineerleMark size={84} animate />
        <h1 className="ens-entry-title" data-testid="ens-entry-title">
          <EngineerleWord className="ens-word-xl" />
        </h1>
        <p className="ens-entry-lede">Five engineering puzzles. The same five for everyone, every day, each one with real physics behind it.</p>
      </div>

      <div className="ens-tb" data-testid="ens-entry-sheet">
        <dl className="ens-tb-head">
          <div data-testid="ens-entry-date">
            <dt>Drawing</dt>
            <dd>No. {number}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{prettyDate(dateKey)}</dd>
          </div>
          <div data-testid="ens-entry-streak">
            <dt>Streak</dt>
            <dd>{streakDays} {streakDays === 1 ? 'day' : 'days'}</dd>
          </div>
        </dl>
        <ol className="ens-tb-parts" aria-label="Today's five puzzles">
          {puzzles.map(({ def }, i) => {
            const r = day.puzzles[i];
            return (
              <li key={def.id} data-testid={`ens-entry-row-${i}`} data-state={r.solved ? 'solved' : r.done ? 'failed' : 'open'}>
                <span className="ens-tb-no">{i + 1}</span>
                <span className="ens-tb-name">
                  <b>{DISCIPLINE_NAMES[def.discipline]}</b>
                  <small>{LEVEL[def.difficulty - 1]}</small>
                </span>
                <span className="ens-tb-level" aria-hidden>
                  {[1, 2, 3].map((n) => <i key={n} data-on={n <= def.difficulty} />)}
                </span>
                <span className="ens-tb-state" aria-label={r.done ? (r.solved ? `solved for ${r.points} points` : 'not solved') : r.attempts ? `${r.attempts} guesses used` : 'not started'}>
                  {r.done || r.attempts ? square(r) : '⬜'}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="ens-tb-foot">
          {finished ? <>Signed off with <b className="font-mono">{dayPoints(day)}</b> of {MAX_DAY_POINTS}</> : done > 0 ? <>{done} of 5 done</> : <>Up to {MAX_DAY_POINTS} points</>}
        </p>
      </div>

      <button className="ens-btn ens-entry-go" onClick={onStart} data-testid="ens-start">
        {state === 'new' ? "Start today's drawing" : state === 'continue' ? 'Continue the drawing' : 'See your results'}
      </button>
      {finished ? (
        <p className="ens-entry-rules" data-testid="ens-entry-rules">
          Next puzzles in <b className="font-mono">{formatCountdown(left)}</b>
        </p>
      ) : (
        <p className="ens-entry-rules" data-testid="ens-entry-rules">
          Three guesses on each. A clock runs while you work. No hints.
        </p>
      )}
      <div className="ens-entry-more">
        <button className="ens-ghost" onClick={onHelp} data-testid="ens-entry-help">How it works</button>
        <a className="ens-ghost" href={withSettings(OBSCURA_URL, settings)} data-testid="ens-entry-obscura" data-silent>Play Obscura</a>
      </div>
    </section>
  );
}
