/**
 * Engineerle scoring.
 *
 * Three guesses per puzzle. A solve is worth up to 100 points:
 *   points = round(100 x guess factor x time factor)
 * - guess factor: 1 on the first guess, 0.65 on the second, 0.35 on the third.
 * - time factor: 1 up to the puzzle's par time, then falling in a straight line to 0.4 at four times par.
 * So a solve is worth between 14 and 100. A puzzle that runs out of guesses scores 0.
 */

export const MAX_ATTEMPTS = 3;
export const GUESS_FACTORS = [1, 0.65, 0.35] as const;
export const PUZZLE_MAX = 100;
export const PUZZLES_PER_DAY = 5;
export const MAX_DAY_POINTS = PUZZLE_MAX * PUZZLES_PER_DAY;
/** The time factor never goes below this, however slow. */
export const TIME_FLOOR = 0.4;
/** The time factor reaches its floor at this many times the par time. */
export const SLOW_AT = 4;

/** Whole guesses only; anything odd counts as the first or the last. */
export function guessFactor(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.floor(attempt) : 1;
  return GUESS_FACTORS[Math.min(MAX_ATTEMPTS, Math.max(1, n)) - 1];
}

export function timeFactor(seconds: number, par: number): number {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : seconds > 0 ? Infinity : 0;
  if (!(par > 0) || !Number.isFinite(par)) return s === Infinity ? TIME_FLOOR : 1;
  if (s <= par) return 1;
  const slow = Math.min(1, (s - par) / ((SLOW_AT - 1) * par));
  return 1 - (1 - TIME_FLOOR) * slow;
}

export function puzzlePoints(attempt: number, seconds: number, par: number): number {
  // the small nudge keeps exact halves (100 x 0.65 x 0.7 = 45.5) rounding up despite binary floating point
  return Math.floor(PUZZLE_MAX * guessFactor(attempt) * timeFactor(seconds, par) + 0.5 + 1e-9);
}
