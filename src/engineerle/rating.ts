/** The title a finished day earns, shown on the end screen. Pure: a total out of 500 in, a title and a line out. */

export interface Rating {
  /** The lowest total that earns this title. */
  from: number;
  title: string;
  line: string;
}

/** Lowest to highest. The first starts at 0 so every total has one; only a perfect day earns the last. */
export const RATINGS: Rating[] = [
  { from: 0, title: 'Back to the drawing board', line: 'Not today. The sheet is yours to try again tomorrow.' },
  { from: 100, title: 'Junior draughtsperson', line: 'A few lines in the right place. Keep at it.' },
  { from: 250, title: 'Design engineer', line: 'Sound work. Most of the sheet holds up.' },
  { from: 350, title: 'Senior engineer', line: 'Fast, careful and mostly first time.' },
  { from: 450, title: 'Chief engineer', line: 'Hardly a mark out of place.' },
  { from: 500, title: 'Flawless drawing', line: 'Every puzzle first guess, inside par. Sign it off.' },
];

export function ratingFor(total: number): Rating {
  const t = Number.isFinite(total) ? total : total > 0 ? 500 : 0;
  let best = RATINGS[0];
  for (const r of RATINGS) if (t >= r.from) best = r;
  return best;
}
