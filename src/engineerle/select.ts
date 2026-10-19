import { addDays, daysBetween } from '../lib/dates';
import { hashSeed, rng } from './rand';
import { POOL, type PuzzleDef } from './registry';
import { PUZZLES_PER_DAY } from './scoring';

/** Day 1 of Engineerle. */
export const ENGINEERLE_EPOCH = '2026-10-19';
const PER_DISCIPLINE = 2;

function shuffled<T>(items: T[], seed: number): T[] {
  const r = rng(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Five different puzzles from the pool for one day.
 * Rules, in the order they are given up when the pool is too small:
 *   1. never the same puzzle twice in a day,
 *   2. at most two from one discipline (relaxed last),
 *   3. not the puzzles of the two previous days, and above all not yesterday's (relaxed first).
 * Within the day they run from approachable to demanding.
 */
function pick(pool: PuzzleDef[], key: string, recent1: Set<string>, recent2: Set<string>): string[] {
  const want = Math.min(PUZZLES_PER_DAY, pool.length);
  const tier = (p: PuzzleDef) => (recent1.has(p.id) ? 2 : recent2.has(p.id) ? 1 : 0);
  const take = (order: PuzzleDef[], maxTier: number, cap: number): PuzzleDef[] => {
    const chosen: PuzzleDef[] = [];
    const count: Record<string, number> = {};
    for (const p of order) {
      if (chosen.length === want) break;
      if (tier(p) > maxTier || (count[p.discipline] ?? 0) >= cap) continue;
      chosen.push(p);
      count[p.discipline] = (count[p.discipline] ?? 0) + 1;
    }
    return chosen;
  };
  let chosen: PuzzleDef[] = [];
  // a few reshuffles so a greedy pass that dead-ends on the discipline cap does not force a repeat
  for (let k = 0; k < 24 && chosen.length < want; k++) chosen = take(shuffled(pool, hashSeed(`${key}:pick:${k}`)), 1, PER_DISCIPLINE);
  if (chosen.length < want) {
    const order = shuffled(pool, hashSeed(`${key}:pick`)).sort((a, b) => tier(a) - tier(b));
    chosen = take(order, 2, PER_DISCIPLINE);
    if (chosen.length < want) chosen = take(order, 2, Infinity);
  }
  return chosen
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.difficulty - b.p.difficulty || a.i - b.i)
    .map((x) => x.p.id);
}

/** Memoised run of days from the epoch: each day depends on the two before it, so everyone gets the same chain. */
const chains = new WeakMap<PuzzleDef[], string[][]>();

export function pickDay(dateKey: string, pool: PuzzleDef[] = POOL): string[] {
  const n = daysBetween(ENGINEERLE_EPOCH, dateKey);
  if (!(n >= 0)) return pick(pool, dateKey, new Set(), new Set()); // before day 1, or not a date at all
  let chain = chains.get(pool);
  if (!chain) chains.set(pool, (chain = []));
  for (let i = chain.length; i <= n; i++) {
    chain.push(pick(pool, addDays(ENGINEERLE_EPOCH, i), new Set(chain[i - 1] ?? []), new Set(chain[i - 2] ?? [])));
  }
  return chain[n];
}
