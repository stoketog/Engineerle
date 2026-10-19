'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, loadSettings, resolveTheme, saveSettings, type Settings } from '@/lib/settings';
import { sfx, type SfxName } from '@/lib/sfx';

interface SettingsApi {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  /** Play a sound effect (does nothing while muted or before the page has been touched). */
  play: (name: SfxName, arg?: number) => void;
}

const Ctx = createContext<SettingsApi>({ settings: DEFAULT_SETTINGS, set: () => {}, play: () => {} });

export const useSettings = () => useContext(Ctx);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => setSettings(loadSettings()), []);

  // theme, motion and performance flags live on <html> so plain CSS can follow them
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveTheme(settings.theme);
      root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';
      root.dataset.perf = settings.lowCpu ? 'low' : 'full';
    };
    apply();
    if (settings.theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, settings.reduceMotion, settings.lowCpu]);

  useEffect(() => {
    sfx.setVolume(settings.volume / 100);
    sfx.setMuted(settings.muted);
  }, [settings.volume, settings.muted]);

  // the first touch unlocks audio; every button press gets a soft tap
  useEffect(() => {
    const unlock = () => sfx.unlock();
    const tap = (e: Event) => {
      sfx.unlock();
      const el = (e.target as HTMLElement | null)?.closest?.('button, a, [role="button"], [role="tab"]');
      if (el && !el.hasAttribute('data-silent') && !(el as HTMLButtonElement).disabled) sfx.play('tap');
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('click', tap, true);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('click', tap, true);
    };
  }, []);

  const set = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const play = useCallback((name: SfxName, arg?: number) => sfx.play(name, arg), []);
  const value = useMemo(() => ({ settings, set, play }), [settings, set, play]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
