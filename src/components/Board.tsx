'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_ATTEMPTS, type PuzzleInfo } from '@/engineerle/daily';
import type { PuzzleRecord } from '@/engineerle/store';
import { resolveTheme } from '@/lib/settings';
import { useSettings } from '@/hooks/useSettings';
import { Stage, type Theme } from './stage';

export interface PuzzleProps<S> {
  spec: S;
  record: PuzzleRecord;
  /** Report one guess. Called when the puzzle's own animation has finished. */
  onAttempt: (solved: boolean) => void;
}

export function Pips({ record }: { record: PuzzleRecord }) {
  return (
    <span className="ens-pips" role="img" aria-label={`${record.attempts} of ${MAX_ATTEMPTS} guesses used`} data-testid="pips">
      {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
        <i key={i} data-s={i >= record.attempts ? 'open' : record.solved && i === record.attempts - 1 ? 'hit' : 'miss'} />
      ))}
    </span>
  );
}

export function Note({ kind, children, testId }: { kind?: 'ok' | 'bad' | 'hint'; children: ReactNode; testId?: string }) {
  return (
    <div className="ens-note ens-fade" data-k={kind} role={kind === 'bad' ? 'alert' : 'status'} data-testid={testId}>
      {children}
    </div>
  );
}

/** The frame every puzzle sits in: title, the view, then the controls under it. */
export function Board({ info, record, view, children, testId }: { info: PuzzleInfo; record: PuzzleRecord; view: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section className="ens-card ens-fade p-3 sm:p-4" data-testid={testId} aria-label={info.title}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="ens-h">{info.title}</h2>
          <p className="ens-p">{info.brief}</p>
        </div>
        <Pips record={record} />
      </div>
      {view}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** Creates a Stage on a canvas, hands it to `build`, and tidies up. Re-runs when `deps` or the performance settings change. */
export function useStage(build: (s: Stage) => void | (() => void), deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { settings } = useSettings();
  const theme: Theme = resolveTheme(settings.theme);
  const [failed, setFailed] = useState(false);
  const stage = useRef<Stage | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = new Stage(el, { lowCpu: settings.lowCpu, reduceMotion: settings.reduceMotion, theme: themeRef.current });
    setFailed(s.headless);
    stage.current = s;
    const cleanup = buildRef.current(s);
    return () => {
      if (cleanup) cleanup();
      s.dispose();
      stage.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.lowCpu, settings.reduceMotion, ...deps]);

  useEffect(() => stage.current?.setTheme(theme), [theme]);
  return { ref, failed, stage, theme, settings };
}

export function Unsupported() {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
      <p className="ens-p">This device can&apos;t draw the 3D view, but the puzzle still runs: use the controls below and read the results underneath.</p>
    </div>
  );
}
