'use client';

import { useEffect, useRef, useState } from 'react';

/** Longest single gap that counts as play time: a sleeping laptop or a throttled tab must not run the clock up. */
const MAX_GAP_MS = 2000;

/** Pure step of the clock: adds the gap (capped) in seconds, only while the page is visible. */
export function nextElapsed(prev: number, deltaMs: number, visible: boolean): number {
  if (!visible || !(deltaMs > 0)) return prev;
  return prev + Math.min(deltaMs, MAX_GAP_MS) / 1000;
}

/**
 * Seconds spent on a puzzle. Ticks every 250 ms while `running` and the page is visible, starting from
 * `initialSeconds`; reports the total at most once a second, and straight away when the page is hidden or closed.
 */
export function useStopwatch(running: boolean, initialSeconds: number, onSave: (seconds: number) => void): number {
  const [seconds, setSeconds] = useState(initialSeconds);
  const elapsed = useRef(initialSeconds);
  const saved = useRef(initialSeconds);
  const lastSave = useRef(0);
  const save = useRef(onSave);
  save.current = onSave;

  useEffect(() => {
    if (!running) return;
    const flush = () => {
      if (elapsed.current > saved.current) {
        saved.current = elapsed.current;
        lastSave.current = Date.now();
        save.current(elapsed.current);
      }
    };
    let last = performance.now();
    const visible = () => document.visibilityState !== 'hidden';
    const id = window.setInterval(() => {
      const now = performance.now();
      elapsed.current = nextElapsed(elapsed.current, now - last, visible());
      last = now;
      setSeconds(elapsed.current);
      if (Date.now() - lastSave.current >= 1000) flush();
    }, 250);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
      last = performance.now();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [running]);

  return seconds;
}
