import { addDays } from '../lib/dates';
import { engineerleNumber } from './daily';
import { pickDay } from './select';
import { byId } from './registry';
import { MAX_ATTEMPTS, MAX_DAY_POINTS, PUZZLES_PER_DAY, puzzlePoints } from './scoring';

/** Saved progress for Engineerle. Stored on this device only. */

export interface PuzzleRecord {
  /** Which puzzle this is (its id in the pool). */
  id: string;
  /** Guesses used so far. */
  attempts: number;
  solved: boolean;
  /** True once solved or out of attempts. */
  done: boolean;
  points: number;
  /** Seconds spent on it so far; stops when the puzzle is done. */
  seconds: number;
}

export interface DayRecord {
  puzzles: PuzzleRecord[];
}

export interface EngineerleStore {
  v: 2;
  days: Record<string, DayRecord>;
}

const KEY = 'engineerle:v2:progress';
const COUNT = PUZZLES_PER_DAY;
/** An hour per puzzle is far beyond any real attempt; a damaged value cannot push the clock past it. */
const MAX_SECONDS = 3600 * 24;

export const emptyPuzzle = (id: string): PuzzleRecord => ({ id, attempts: 0, solved: false, done: false, points: 0, seconds: 0 });
export const emptyDay = (dateKey: string): DayRecord => ({ puzzles: pickDay(dateKey).map(emptyPuzzle) });
export const emptyStore = (): EngineerleStore => ({ v: 2, days: {} });

const defaultPar = (id: string) => byId(id).parSeconds;

/** Points are recomputed from attempts and seconds on load, so an edited save cannot raise a score. */
function cleanPuzzle(id: string, p: unknown, par: (id: string) => number): PuzzleRecord {
  const o = (p ?? {}) as Partial<PuzzleRecord>;
  if (o.id !== undefined && o.id !== id) return emptyPuzzle(id);
  const attempts = Math.min(MAX_ATTEMPTS, Math.max(0, Math.floor(Number(o.attempts) || 0)));
  const seconds = Math.min(MAX_SECONDS, Math.max(0, Number(o.seconds) || 0));
  const solved = o.solved === true && attempts >= 1;
  const done = solved || attempts >= MAX_ATTEMPTS;
  return { id, attempts, solved, done, points: solved ? puzzlePoints(attempts, seconds, par(id)) : 0, seconds };
}

export function sanitise(raw: unknown, par: (id: string) => number = defaultPar): EngineerleStore {
  const out = emptyStore();
  const o = raw as Partial<EngineerleStore> | null;
  if (!o || typeof o !== 'object' || o.v !== 2) return out;
  const days = o.days;
  if (!days || typeof days !== 'object') return out;
  for (const [k, d] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const list = Array.isArray((d as DayRecord)?.puzzles) ? (d as DayRecord).puzzles : [];
    out.days[k] = { puzzles: pickDay(k).map((id, i) => cleanPuzzle(id, list[i], par)) };
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

export const getDay = (s: EngineerleStore, dateKey: string): DayRecord => s.days[dateKey] ?? emptyDay(dateKey);

/** Records one guess and scores it if it solved the puzzle. Returns a new store; a puzzle that is already done is left alone. */
export function recordAttempt(s: EngineerleStore, dateKey: string, index: number, solved: boolean, par: number): EngineerleStore {
  const day = getDay(s, dateKey);
  const cur = day.puzzles[index];
  if (!cur || cur.done) return s;
  const attempts = cur.attempts + 1;
  const next: PuzzleRecord = {
    ...cur,
    attempts,
    solved,
    done: solved || attempts >= MAX_ATTEMPTS,
    points: solved ? puzzlePoints(attempts, cur.seconds, par) : 0,
  };
  const puzzles = day.puzzles.map((p, i) => (i === index ? next : p));
  return { ...s, days: { ...s.days, [dateKey]: { puzzles } } };
}

/** Adds time to a puzzle's clock. Ignored once the puzzle is done; never lets the total go below zero. */
export function addSeconds(s: EngineerleStore, dateKey: string, index: number, delta: number): EngineerleStore {
  const day = getDay(s, dateKey);
  const cur = day.puzzles[index];
  if (!cur || cur.done) return s;
  const d = Number.isFinite(delta) ? delta : 0;
  const seconds = Math.min(MAX_SECONDS, Math.max(0, cur.seconds + d));
  if (seconds === cur.seconds) return s;
  const puzzles = day.puzzles.map((p, i) => (i === index ? { ...p, seconds } : p));
  return { ...s, days: { ...s.days, [dateKey]: { puzzles } } };
}

export const dayDone = (d: DayRecord) => d.puzzles.every((p) => p.done);
export const dayPoints = (d: DayRecord) => d.puzzles.reduce((n, p) => n + p.points, 0);
export const daySolved = (d: DayRecord) => d.puzzles.filter((p) => p.solved).length;

/** Consecutive finished days ending today (or yesterday, if today is still in progress). */
export function streak(s: EngineerleStore, today: string): number {
  let key = dayDone(getDay(s, today)) ? today : addDays(today, -1);
  let n = 0;
  while (s.days[key] && dayDone(s.days[key])) {
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
  for (const d of Object.values(s.days)) {
    if (!dayDone(d)) continue;
    played++;
    solved += daySolved(d);
    const p = dayPoints(d);
    points += p;
    best = Math.max(best, p);
    if (daySolved(d) === COUNT) perfect++;
  }
  return { played, solved, points, best, perfect };
}

export const square = (p: PuzzleRecord) => (!p.solved ? '⬛' : p.attempts === 1 ? '🟩' : p.attempts === 2 ? '🟨' : '🟧');

export function shareText(dateKey: string, d: DayRecord, url = ''): string {
  const head = `Engineerle #${engineerleNumber(dateKey)}  ${dayPoints(d)}/${MAX_DAY_POINTS}`;
  const row = d.puzzles.map(square).join('');
  return [head, row, url].filter(Boolean).join('\n');
}
