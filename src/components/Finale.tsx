'use client';

import type { ReactNode } from 'react';
import { MAX_DAY_POINTS } from '@/engineerle/daily';
import { ratingFor } from '@/engineerle/rating';
import { daySolved, dayTimeSeconds, square, type DayRecord } from '@/engineerle/store';
import { formatClock } from '@/lib/clock';
import { prettyDate } from '@/lib/dates';

/** The approval stamp: ink pressed on the sheet. */
function Stamp({ number, dateKey }: { number: number; dateKey: string }) {
  const date = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <svg className="ens-stamp" data-testid="ens-stamp" viewBox="0 0 220 108" role="img" aria-label={`Signed off, Engineerle number ${number}, ${date}`}>
      <defs>
        <filter id="ens-ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
      </defs>
      <g filter="url(#ens-ink)" fill="none" stroke="currentColor">
        <rect x="4" y="4" width="212" height="100" rx="8" strokeWidth="4" />
        <rect x="11" y="11" width="198" height="86" rx="4" strokeWidth="1.4" />
        <text x="110" y="55" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="var(--font-display)" fontWeight="700" fontSize="31" textLength="166" lengthAdjust="spacingAndGlyphs">SIGNED OFF</text>
        <line x1="30" x2="190" y1="64" y2="64" strokeWidth="1.2" />
        <text x="110" y="84" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="var(--font-mono)" fontWeight="600" fontSize="12.5">No. {number} · {date}</text>
      </g>
    </svg>
  );
}

/**
 * The end screen: shown at the top of the results once all five are done. The sheet is stamped, the player gets a title
 * for their total, and the three numbers they will want (solved, time, streak) sit in a title block like the entry screen's.
 */
export function Finale({ dateKey, number, day, points, streakDays, actions, footer }: { dateKey: string; number: number; day: DayRecord; points: number; streakDays: number; actions: ReactNode; footer: ReactNode }) {
  const rating = ratingFor(points);
  const perfect = points >= MAX_DAY_POINTS;
  return (
    <section className="ens-card ens-finale" data-testid="ens-finale" data-perfect={perfect} aria-label="Today's result">
      <Stamp number={number} dateKey={dateKey} />
      <p className="ens-finale-date">{prettyDate(dateKey)}</p>
      <h2 className="ens-finale-rating" data-testid="ens-rating">{rating.title}</h2>
      <p className="ens-finale-line">{rating.line}</p>
      <p className="ens-finale-score font-mono" data-testid="ens-points">
        {points}
        <span> / {MAX_DAY_POINTS}</span>
      </p>
      <div className="ens-result ens-finale-squares" aria-label="Your results" data-testid="ens-squares">
        {day.puzzles.map((p, i) => (
          <span key={i}>{p.done || p.attempts ? square(p) : '⬜'}</span>
        ))}
      </div>
      <dl className="ens-finale-stats">
        <div data-testid="ens-finale-solved">
          <dt>Solved</dt>
          <dd>{daySolved(day)} of 5</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd data-testid="ens-finale-time">{formatClock(dayTimeSeconds(day))}</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd data-testid="ens-finale-streak">{streakDays} {streakDays === 1 ? 'day' : 'days'}</dd>
        </div>
      </dl>
      <div className="ens-finale-actions">{actions}</div>
      <p className="ens-label ens-finale-foot">{footer}</p>
    </section>
  );
}
