/**
 * Points for one puzzle: round(100 × G × T).
 *   G — the guess factor: 1 for a solve on guess 1, 0.65 on guess 2, 0.35 on guess 3.
 *   T — the time factor: 1 up to the puzzle's par time, falling in a straight line to 0.4 at four times par, then flat.
 * A puzzle that is not solved scores nothing (the caller never asks).
 */
export const MAX_ATTEMPTS = 3;
export const GUESS_FACTORS = [1, 0.65, 0.35] as const;
export const POINTS_PER_PUZZLE = 100;
export const PUZZLES_PER_DAY = 5;
export const MAX_DAY_POINTS = POINTS_PER_PUZZLE * PUZZLES_PER_DAY;
export const TIME_FLOOR = 0.4;
export const FLOOR_AT_PAR_MULTIPLE = 4;

export function guessFactor(attempt: number): number {
  const n = Math.min(MAX_ATTEMPTS, Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1)));
  return GUESS_FACTORS[n - 1];
}

export function timeFactor(seconds: number, par: number): number {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (s <= par) return 1;
  const over = Math.min(1, (s - par) / (par * (FLOOR_AT_PAR_MULTIPLE - 1)));
  return 1 - (1 - TIME_FLOOR) * over;
}

export function puzzlePoints(attempt: number, seconds: number, par: number): number {
  // the small epsilon keeps exact halves (100 × 0.65 × 0.7 = 45.5) from falling to the wrong side in floating point
  return Math.round(POINTS_PER_PUZZLE * guessFactor(attempt) * timeFactor(seconds, par) + 1e-9);
}
