'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';

/** The most one tick may add. A laptop that slept for an hour must not charge the player an hour. */
export const MAX_TICK_MS = 2000;
const TICK_MS = 250;

/** Pure step of the stopwatch: adds the tick (capped) only while the page is visible. */
export function nextElapsed(prev: number, deltaMs: number, visible: boolean): number {
  if (!visible || !Number.isFinite(deltaMs) || deltaMs <= 0) return prev;
  return prev + Math.min(deltaMs, MAX_TICK_MS) / 1000;
}

/** 0:00 style reading. Whole seconds, rounded down, so it never runs ahead of the score. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Counts seconds while `running` and the page is visible, starting from `initialSeconds`.
 * `onSave` gets the running total at most once a second, when the page is hidden or closed, and when the clock stops.
 * `live` (optional) always holds the exact current total, for a caller that needs it between saves.
 */
export function useStopwatch(running: boolean, initialSeconds: number, onSave: (seconds: number) => void, live?: MutableRefObject<number>): number {
  const [seconds, setSeconds] = useState(initialSeconds);
  const total = useRef(initialSeconds);
  const saved = useRef(initialSeconds);
  const save = useRef(onSave);
  save.current = onSave;
  if (live) live.current = total.current;

  useEffect(() => {
    if (!running) {
      // the clock stopped (solved, out of guesses, or held for a submitted guess): keep exactly what it read
      if (total.current !== saved.current) {
        saved.current = total.current;
        save.current(total.current);
      }
      return;
    }
    let last = performance.now();
    const flush = () => {
      if (total.current !== saved.current) {
        saved.current = total.current;
        save.current(total.current);
      }
    };
    const tick = () => {
      const now = performance.now();
      total.current = nextElapsed(total.current, now - last, document.visibilityState === 'visible');
      last = now;
      if (live) live.current = total.current;
      setSeconds(total.current);
      if (Math.floor(total.current) > Math.floor(saved.current)) flush();
    };
    const hide = () => {
      tick();
      flush();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') hide();
      else last = performance.now();
    };
    const id = window.setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', hide);
    return () => {
      tick();
      flush();
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return running ? seconds : total.current;
}
