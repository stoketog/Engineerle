import { addDays } from '../lib/dates';
import { byId } from './registry';
import { MAX_ATTEMPTS, MAX_DAY_POINTS, puzzlePoints } from './scoring';
import { pickDay } from './select';
import { engineerleNumber } from './daily';

/** Saved progress for Engineerle. Stored on this device only. */

export interface PuzzleRecord {
  /** Which puzzle this is (see registry.ts). */
  id: string;
  /** Guesses used so far. */
  attempts: number;
  solved: boolean;
  /** True once solved or out of attempts. */
  done: boolean;
  /** 0 until solved, then 14 to 100. */
  points: number;
  /** Time spent on the puzzle so far (s). Stops counting once it is done. */
  seconds: number;
}

export interface DayRecord {
  puzzles: PuzzleRecord[];
}

export const STORE_VERSION = 2;

export interface EngineerleStore {
  v: typeof STORE_VERSION;
  days: Record<string, DayRecord>;
}

const KEY = 'engineerle:v2:progress';
const MAX_SECONDS = 86_400;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z]{2,20}$/;

export const emptyPuzzle = (id: string): PuzzleRecord => ({ id, attempts: 0, solved: false, done: false, points: 0, seconds: 0 });
export const emptyStore = (): EngineerleStore => ({ v: STORE_VERSION, days: {} });

const clampSeconds = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(MAX_SECONDS, Math.max(0, n)) : n > 0 ? MAX_SECONDS : 0;
};

function cleanPuzzle(p: unknown, fallbackId: string): PuzzleRecord {
  const o = (p && typeof p === 'object' ? p : {}) as Partial<PuzzleRecord>;
  const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : fallbackId;
  const attempts = Math.min(MAX_ATTEMPTS, Math.max(0, Math.floor(Number(o.attempts) || 0)));
  const solved = o.solved === true && attempts >= 1;
  const done = solved || attempts >= MAX_ATTEMPTS;
  const seconds = clampSeconds(o.seconds);
  const def = byId(id);
  // points are worked out again from the guesses and the time, never trusted; a retired puzzle keeps its score
  const points = !solved ? 0 : def ? puzzlePoints(attempts, seconds, def.parSeconds) : Math.min(100, Math.max(0, Math.round(Number(o.points) || 0)));
  return { id, attempts, solved, done, points, seconds };
}

export function sanitise(raw: unknown): EngineerleStore {
  const out = emptyStore();
  const o = raw as { v?: unknown; days?: unknown } | null;
  if (!o || typeof o !== 'object' || o.v !== STORE_VERSION) return out;
  const days = o.days;
  if (!days || typeof days !== 'object' || Array.isArray(days)) return out;
  for (const [k, d] of Object.entries(days as Record<string, unknown>)) {
    if (!DATE.test(k)) continue;
    const ids = pickDay(k);
    const list = Array.isArray((d as DayRecord | null)?.puzzles) ? (d as DayRecord).puzzles : [];
    out.days[k] = { puzzles: ids.map((id, i) => cleanPuzzle(list[i], id)) };
  }
  return out;
}

export function loadStore(): EngineerleStore {
  try {
    if (typeof window === 'undefined') return emptyStore();
    const raw = window.localStorage.getItem(KEY);
    return raw ? sanitise(JSON.parse(raw)) : emptyStore();
  } catch {
    return emptyStore();
  }
}

export function saveStore(s: EngineerleStore) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress lasts for this visit */
  }
}

/** The day's records, lined up with the day's puzzles by id (progress follows the puzzle, not its position). */
export function getDay(s: EngineerleStore, dateKey: string): DayRecord {
  const stored = s.days[dateKey]?.puzzles ?? [];
  return { puzzles: pickDay(dateKey).map((id) => stored.find((p) => p.id === id) ?? emptyPuzzle(id)) };
}

const withPuzzle = (s: EngineerleStore, dateKey: string, day: DayRecord, index: number, next: PuzzleRecord): EngineerleStore => ({
  ...s,
  days: { ...s.days, [dateKey]: { puzzles: day.puzzles.map((p, i) => (i === index ? next : p)) } },
});

/** Records one guess. `par` is the puzzle's par time. Returns a new store; a puzzle that is already done is left alone. */
export function recordAttempt(s: EngineerleStore, dateKey: string, index: number, solved: boolean, par: number): EngineerleStore {
  const day = getDay(s, dateKey);
  const cur = day.puzzles[index];
  if (!cur || cur.done) return s;
  const attempts = cur.attempts + 1;
  const next: PuzzleRecord = { ...cur, attempts, solved, done: solved || attempts >= MAX_ATTEMPTS, points: solved ? puzzlePoints(attempts, cur.seconds, par) : 0 };
  return withPuzzle(s, dateKey, day, index, next);
}

/** Adds time spent on a puzzle. Time only goes up, and stops once the puzzle is done. */
export function addSeconds(s: EngineerleStore, dateKey: string, index: number, delta: number): EngineerleStore {
  if (!(delta > 0) || !Number.isFinite(delta)) return s;
  const day = getDay(s, dateKey);
  const cur = day.puzzles[index];
  if (!cur || cur.done) return s;
  return withPuzzle(s, dateKey, day, index, { ...cur, seconds: Math.min(MAX_SECONDS, cur.seconds + delta) });
}

export const dayDone = (d: DayRecord) => d.puzzles.every((p) => p.done);
export const dayPoints = (d: DayRecord) => d.puzzles.reduce((n, p) => n + p.points, 0);
/** Whole seconds spent on the day's five puzzles. */
export const dayTimeSeconds = (d: DayRecord) => Math.round(d.puzzles.reduce((n, p) => n + (Number.isFinite(p.seconds) ? p.seconds : 0), 0));
export const daySolved = (d: DayRecord) => d.puzzles.filter((p) => p.solved).length;

/** Consecutive finished days ending today (or yesterday, if today is still in progress). */
export function streak(s: EngineerleStore, today: string): number {
  let key = dayDone(getDay(s, today)) ? today : addDays(today, -1);
  let n = 0;
  while (s.days[key] && dayDone(getDay(s, key))) {
    n++;
    key = addDays(key, -1);
  }
  return n;
}

export interface Totals {
  played: number;
  solved: number;
  points: number;
  best: number;
  perfect: number;
}

export function totals(s: EngineerleStore): Totals {
  let played = 0, solved = 0, points = 0, best = 0, perfect = 0;
  for (const key of Object.keys(s.days)) {
    const d = getDay(s, key);
    if (!dayDone(d)) continue;
    played++;
    solved += daySolved(d);
    const p = dayPoints(d);
    points += p;
    best = Math.max(best, p);
    if (daySolved(d) === d.puzzles.length) perfect++;
  }
  return { played, solved, points, best, perfect };
}

export const square = (p: PuzzleRecord) => (!p.solved ? '⬛' : p.attempts === 1 ? '🟩' : p.attempts === 2 ? '🟨' : '🟧');

export function shareText(dateKey: string, d: DayRecord, url = ''): string {
  const head = `Engineerle #${engineerleNumber(dateKey)}  ${dayPoints(d)}/${MAX_DAY_POINTS}`;
  const row = d.puzzles.map(square).join('');
  return [head, row, url].filter(Boolean).join('\n');
}
