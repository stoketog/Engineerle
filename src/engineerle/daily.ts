import { daysBetween } from '../lib/dates';
import { hashSeed } from './rand';
import { byId, type PuzzleDef } from './registry';
import { ENGINEERLE_EPOCH, pickDay } from './select';
import { MAX_ATTEMPTS, MAX_DAY_POINTS } from './scoring';

export { ENGINEERLE_EPOCH, MAX_ATTEMPTS, MAX_DAY_POINTS };

export type PuzzleSpec = { kind: string };

export interface EngineerleDaily {
  dateKey: string;
  number: number;
  /** Five different puzzles, easiest first, each with the spec everyone gets today. */
  puzzles: Array<{ def: PuzzleDef; spec: PuzzleSpec }>;
}

export const engineerleNumber = (dateKey: string) => Math.max(1, daysBetween(ENGINEERLE_EPOCH, dateKey) + 1);

export function getEngineerleDaily(dateKey: string): EngineerleDaily {
  const base = hashSeed(`${dateKey}:engineerle`);
  return {
    dateKey,
    number: engineerleNumber(dateKey),
    puzzles: pickDay(dateKey).map((id, i) => {
      const def = byId(id);
      // the seed depends on the puzzle as well as the day, so the same puzzle on two days is a different instance
      return { def, spec: def.make((base ^ hashSeed(id) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0) };
    }),
  };
}
