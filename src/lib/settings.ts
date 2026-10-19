/** Player settings: sound, theme and performance. Stored on this device only. */

export type ThemePref = 'auto' | 'dark' | 'light';

export interface Settings {
  /** Sound effects loudness, 0–100. */
  volume: number;
  muted: boolean;
  theme: ThemePref;
  /** Draws the world less often and leaves out the supporting scenery. */
  lowCpu: boolean;
  /** No animated transitions, camera moves or shaking. */
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = { volume: 70, muted: false, theme: 'dark', lowCpu: false, reduceMotion: false };

const KEY = 'engineerle:v1:settings';

export function loadSettings(): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS };
  try {
    if (typeof window === 'undefined') return base;
    adoptHandoff();
    // first visit: follow the system's motion preference
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) base.reduceMotion = true;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: typeof p.volume === 'number' ? Math.min(100, Math.max(0, Math.round(p.volume))) : base.volume,
      muted: typeof p.muted === 'boolean' ? p.muted : base.muted,
      theme: p.theme === 'auto' || p.theme === 'light' || p.theme === 'dark' ? p.theme : base.theme,
      lowCpu: typeof p.lowCpu === 'boolean' ? p.lowCpu : base.lowCpu,
      reduceMotion: typeof p.reduceMotion === 'boolean' ? p.reduceMotion : base.reduceMotion,
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit */
  }
}

/* ───────────── carrying settings between Obscura and Engineerle ─────────────
   Each site lives on its own domain, so the browser keeps their settings apart. The link from one to the other
   carries them in `?s=`, and the page it opens adopts them once and tidies the address. */

const HANDOFF = /^(\d{1,3})\.([01])\.(auto|dark|light)\.([01])\.([01])$/;

export function encodeSettings(s: Settings): string {
  return `${s.volume}.${s.muted ? 1 : 0}.${s.theme}.${s.lowCpu ? 1 : 0}.${s.reduceMotion ? 1 : 0}`;
}

export function decodeSettings(text: string | null): Settings | null {
  const m = text ? HANDOFF.exec(text) : null;
  if (!m) return null;
  return { volume: Math.min(100, Number(m[1])), muted: m[2] === '1', theme: m[3] as ThemePref, lowCpu: m[4] === '1', reduceMotion: m[5] === '1' };
}

/** A link to the other site that brings the player's settings along. */
export function withSettings(url: string, s: Settings): string {
  return `${url.replace(/\/+$/, '')}/?s=${encodeSettings(s)}`;
}

/** Save settings that arrived in the address, then remove them from it. */
export function adoptHandoff() {
  try {
    const u = new URL(window.location.href);
    const got = decodeSettings(u.searchParams.get('s'));
    if (!u.searchParams.has('s')) return;
    if (got) saveSettings(got);
    u.searchParams.delete('s');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch {
    /* no storage or history: nothing to carry */
  }
}

/** The theme actually shown, resolving 'auto' with the system preference. */
export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'auto') return pref;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
