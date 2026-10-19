import { addDays } from '../lib/dates';
import { ATTEMPT_POINTS, MAX_ATTEMPTS, PUZZLES, engineerleNumber } from './daily';

/** Saved progress for Engineerle. Stored on this device only. */

export interface PuzzleRecord {
  /** Guesses used so far. */
  attempts: number;
  solved: boolean;
  /** True once solved or out of attempts. */
  done: boolean;
  points: number;
}

export interface DayRecord {
  puzzles: PuzzleRecord[];
}

export interface EngineerleStore {
  v: 1;
  days: Record<string, DayRecord>;
}

const KEY = 'engineerle:v1:progress';
const COUNT = PUZZLES.length;

export const emptyPuzzle = (): PuzzleRecord => ({ attempts: 0, solved: false, done: false, points: 0 });
export const emptyDay = (): DayRecord => ({ puzzles: PUZZLES.map(emptyPuzzle) });
export const emptyStore = (): EngineerleStore => ({ v: 1, days: {} });

export const pointsFor = (attempt: number) => ATTEMPT_POINTS[Math.min(ATTEMPT_POINTS.length, Math.max(1, attempt)) - 1];

function cleanPuzzle(p: unknown): PuzzleRecord {
  const o = (p ?? {}) as Partial<PuzzleRecord>;
  const attempts = Math.min(MAX_ATTEMPTS, Math.max(0, Math.floor(Number(o.attempts) || 0)));
  const solved = o.solved === true && attempts >= 1;
  const done = solved || attempts >= MAX_ATTEMPTS;
  return { attempts, solved, done, points: solved ? pointsFor(attempts) : 0 };
}

export function sanitise(raw: unknown): EngineerleStore {
  const out = emptyStore();
  const days = (raw as Partial<EngineerleStore> | null)?.days;
  if (!days || typeof days !== 'object') return out;
  for (const [k, d] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const list = Array.isArray((d as DayRecord)?.puzzles) ? (d as DayRecord).puzzles : [];
    out.days[k] = { puzzles: PUZZLES.map((_, i) => cleanPuzzle(list[i])) };
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

export const getDay = (s: EngineerleStore, dateKey: string): DayRecord => s.days[dateKey] ?? emptyDay();

/** Records one guess. Returns a new store; a puzzle that is already done is left alone. */
export function recordAttempt(s: EngineerleStore, dateKey: string, index: number, solved: boolean): EngineerleStore {
  const day = getDay(s, dateKey);
  const cur = day.puzzles[index];
  if (!cur || cur.done) return s;
  const attempts = cur.attempts + 1;
  const next: PuzzleRecord = {
    attempts,
    solved,
    done: solved || attempts >= MAX_ATTEMPTS,
    points: solved ? pointsFor(attempts) : 0,
  };
  const puzzles = day.puzzles.map((p, i) => (i === index ? next : p));
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
  const head = `Engineerle #${engineerleNumber(dateKey)}  ${dayPoints(d)}/${ATTEMPT_POINTS[0] * COUNT}`;
  const row = d.puzzles.map(square).join('');
  return [head, row, url].filter(Boolean).join('\n');
}
