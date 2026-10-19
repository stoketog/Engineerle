import { daysBetween } from '../lib/dates';
import { hashSeed } from './rand';
import { POOL, type PuzzleDef } from './registry';
import { pickDay } from './select';
import type { GraphSpec } from './graph';
import type { LeverSpec } from './lever';
import type { BridgeSpec } from './truss';
import type { CrankshaftSpec } from './crankshaft';
import type { BargeSpec } from './barge';
import type { CircuitSpec } from './circuit';
import type { PowerlineSpec } from './powerline';
import type { FilterSpec } from './rcfilter';
import type { OpampSpec } from './opamp';

export { MAX_ATTEMPTS, MAX_DAY_POINTS } from './scoring';

/** Day 1 of Engineerle. */
export const ENGINEERLE_EPOCH = '2026-10-19';

/** Every puzzle's specification. Grows with the pool. */
export type PuzzleSpec = GraphSpec | LeverSpec | BridgeSpec | CrankshaftSpec | BargeSpec | CircuitSpec | PowerlineSpec | FilterSpec | OpampSpec;

export interface DailyPuzzle {
  def: PuzzleDef;
  spec: PuzzleSpec;
}

export interface EngineerleDaily {
  dateKey: string;
  number: number;
  /** The day's five puzzles, easiest first. */
  puzzles: DailyPuzzle[];
}

export const engineerleNumber = (dateKey: string) => Math.max(1, daysBetween(ENGINEERLE_EPOCH, dateKey) + 1);

/** Everything about a day, built from the date alone: the same on every device. */
export function getEngineerleDaily(dateKey: string, pool: PuzzleDef[] = POOL): EngineerleDaily {
  const ids = pickDay(dateKey, pool);
  const puzzles = ids.map((id) => {
    const def = pool.find((p) => p.id === id)!;
    // seeded by date and puzzle, not by position, so a puzzle is the same whichever slot it lands in
    return { def, spec: def.make(hashSeed(`${dateKey}:engineerle:${id}`)) as PuzzleSpec };
  });
  return { dateKey, number: engineerleNumber(dateKey), puzzles };
}
