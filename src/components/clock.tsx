'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useStopwatch } from '@/hooks/useStopwatch';
import type { PuzzleRecord } from '@/engineerle/store';

interface Clock {
  /** Seconds on this puzzle so far. */
  seconds: number;
  par: number;
  /** Stop the clock now: the player has submitted a guess and is watching it play out. It restarts when the guess is scored. */
  hold: () => void;
}

const ClockContext = createContext<Clock>({ seconds: 0, par: 0, hold: () => {} });
export const useClock = () => useContext(ClockContext);

/**
 * Runs one puzzle's clock. It starts when the puzzle is first shown, runs only while the page is visible, and stops when the
 * puzzle is finished. Time spent watching a submitted guess play out (a truck crossing, a barge settling) is not charged.
 */
export function PuzzleClock({ record, par, onSave, live, children }: { record: PuzzleRecord; par: number; onSave: (seconds: number) => void; live: MutableRefObject<number>; children: ReactNode }) {
  const [held, setHeld] = useState(false);
  // a scored guess releases the hold
  const attempts = useRef(record.attempts);
  useEffect(() => {
    if (record.attempts !== attempts.current) {
      attempts.current = record.attempts;
      setHeld(false);
    }
  }, [record.attempts]);
  const seconds = useStopwatch(!record.done && !held, record.seconds, onSave, live);
  const hold = useCallback(() => setHeld(true), []);
  const value = useMemo(() => ({ seconds: record.done ? record.seconds : seconds, par, hold }), [record.done, record.seconds, seconds, par, hold]);
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}
