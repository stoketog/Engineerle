import { daysBetween } from '../lib/dates';
import { hashSeed, rng } from './rand';
import { POOL, type PuzzleDef } from './registry';
import { PUZZLES_PER_DAY } from './scoring';

/**
 * Choosing the day's five puzzles from the pool.
 *
 * Rules, in the order they give way when the pool is too small to keep them all:
 *   1. five different puzzles;
 *   2. none that was on yesterday or the day before (a roomy pool manages this; a tighter one first lets back
 *      puzzles from the day before yesterday, and only then yesterday's);
 *   3. at most two from one discipline (so a day is never five circuits).
 * The five are then put in order from approachable to demanding.
 *
 * Rule 2 needs yesterday's set, which needs the day before's, and so on. To keep every date's answer fixed for
 * ever, whatever order dates are asked for in, the calendar is cut into eras of 512 days counted from the first
 * day of the game: an era's first day has no memory, and each day after it remembers the two before. (So the
 * "not on the last two days" rule is waived for the first two days of an era, about once every 17 months.)
 */

export const ERA_DAYS = 512;
const MAX_PER_DISCIPLINE = 2;
const KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The game's first day: day 0 of the first era. */
export const FIRST_DAY = '2026-10-19';

function shuffled<T>(items: T[], seed: number): T[] {
  const r = rng(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function choose(dateKey: string, pool: PuzzleDef[], yesterday: Set<string>, dayBefore: Set<string>): string[] {
  const order = shuffled(pool, hashSeed(`${dateKey}:pick`));
  const picked: PuzzleDef[] = [];
  const perDiscipline = new Map<string, number>();
  const take = (p: PuzzleDef) => {
    picked.push(p);
    perDiscipline.set(p.discipline, (perDiscipline.get(p.discipline) ?? 0) + 1);
  };
  const open = (p: PuzzleDef) => !picked.includes(p);
  const room = (p: PuzzleDef) => (perDiscipline.get(p.discipline) ?? 0) < MAX_PER_DISCIPLINE;
  const fill = (ok: (p: PuzzleDef) => boolean) => {
    for (const p of order) if (picked.length < PUZZLES_PER_DAY && open(p) && ok(p)) take(p);
  };
  fill((p) => !yesterday.has(p.id) && !dayBefore.has(p.id) && room(p));
  fill((p) => !yesterday.has(p.id) && room(p));
  fill((p) => room(p));
  fill(() => true);
  // stable: puzzles of equal difficulty keep their shuffled order
  return picked.map((p, i) => [p, i] as const).sort((a, b) => a[0].difficulty - b[0].difficulty || a[1] - b[1]).map(([p]) => p.id);
}

const cache = new Map<string, string[]>();

/** The ids of the day's puzzles, easiest first. Fewer than five only if the pool has fewer. */
export function pickDay(dateKey: string, pool: PuzzleDef[] = POOL): string[] {
  const poolKey = pool.map((p) => p.id).join(',');
  const n = KEY.test(dateKey) ? daysBetween(FIRST_DAY, dateKey) : NaN;
  if (!Number.isFinite(n)) return choose(String(dateKey), pool, new Set(), new Set());
  const eraStart = Math.floor(n / ERA_DAYS) * ERA_DAYS;
  const at = (i: number) => dateKeyFor(i);
  const sets: string[][] = [];
  for (let i = eraStart; i <= n; i++) {
    const key = `${poolKey}|${i}`;
    let ids = cache.get(key);
    if (!ids) {
      const yesterday = new Set(i - 1 >= eraStart ? sets[sets.length - 1] : []);
      const dayBefore = new Set(i - 2 >= eraStart ? sets[sets.length - 2] : []);
      ids = choose(at(i), pool, yesterday, dayBefore);
      if (cache.size > 4096) cache.clear();
      cache.set(key, ids);
    }
    sets.push(ids);
  }
  return sets[sets.length - 1].slice();
}

function dateKeyFor(dayIndex: number): string {
  const d = new Date(Date.UTC(2026, 9, 19 + dayIndex));
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
