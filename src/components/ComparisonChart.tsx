'use client';

import { BUCKETS, BUCKET_WIDTH, bucketOf, othersAverage, percentileBelow, type DayStats } from '@/engineerle/stats';
import { byId } from '@/engineerle/registry';

/** Below this many players a ranking says very little, so none is shown (the count still is). */
export const MIN_TO_RANK = 10;

export interface You {
  total: number;
  points: number[];
  ids: string[];
}

const W = 320;
const H = 168;
const PAD_X = 8;
const TOP = 26;
const BASE = 138;
const PLOT_W = W - PAD_X * 2;
const SLOT = PLOT_W / BUCKETS;

const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;

/** The sentence under the chart. The count is always there; the ranking only once enough people have played. */
export function comparisonText(stats: DayStats, total: number, mineIncluded: boolean): string {
  if (stats.n < MIN_TO_RANK) return `${players(stats.n)} today. Not enough players yet to rank you.`;
  const pct = Math.min(99, Math.max(0, Math.round(percentileBelow(stats.buckets, total))));
  return `You scored higher than ${pct}% of ${players(stats.n)} ${mineIncluded ? 'today' : 'so far today'}`;
}

/**
 * How the player did against everyone else today: a histogram of the day's totals with the player's own bar picked
 * out and a dashed line at the other players' average, then one pair of bars per puzzle. With no stats (offline,
 * slow, refused, unreadable) it says so and shows nothing else, so the results around it are never affected.
 */
export function ComparisonChart({ stats, you, mineIncluded, loading = false }: { stats: DayStats | null; you: You; mineIncluded: boolean; loading?: boolean }) {
  if (!stats) {
    return (
      <section className="mt-5" data-testid="ens-compare" data-state={loading ? 'loading' : 'unavailable'} aria-label="Daily comparison" aria-live="polite">
        {loading ? (
          <p className="ens-label" data-testid="ens-compare-loading">Loading the daily comparison…</p>
        ) : (
          <p className="ens-p" data-testid="ens-compare-fallback">The daily comparison is unavailable right now.</p>
        )}
      </section>
    );
  }

  const mine = bucketOf(you.total);
  const avg = othersAverage(stats, you.total, mineIncluded);
  const top = Math.max(1, ...stats.buckets);
  const x = (points: number) => PAD_X + (Math.min(500, Math.max(0, points)) / 500) * PLOT_W;
  const youX = PAD_X + (mine + 0.5) * SLOT;
  const text = comparisonText(stats, you.total, mineIncluded);
  const summary = `${text} ${avg === null ? '' : `The other players averaged ${Math.round(avg)} points. `}You scored ${you.total} out of 500.`;

  return (
    <section className="mt-5" data-testid="ens-compare" data-state="ready" aria-label="Daily comparison">
      <h3 className="ens-h" style={{ fontSize: '1rem' }}>How you compare today</h3>
      <p className="ens-p mt-1" data-testid="ens-compare-text">{text}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full" role="img" aria-label={summary} data-testid="ens-compare-chart" style={{ maxWidth: '100%', height: 'auto' }}>
        <line x1={PAD_X} x2={W - PAD_X} y1={BASE} y2={BASE} stroke="var(--en-line2)" strokeWidth="1" />
        {stats.buckets.map((n, i) => {
          const h = n === 0 ? 0 : Math.max(2, (n / top) * (BASE - TOP - 12));
          const you = i === mine;
          return (
            <rect
              key={i}
              data-testid={`ens-bucket-${i}`}
              data-you={you ? 'true' : 'false'}
              data-count={n}
              x={PAD_X + i * SLOT + 1}
              y={BASE - h}
              width={SLOT - 2}
              height={h}
              rx="1.5"
              fill={you ? 'var(--en-accent)' : 'var(--en-cool)'}
              opacity={you ? 1 : 0.7}
            />
          );
        })}
        {/* the player: a marker above their bar, not colour alone */}
        <path d={`M${youX - 4} ${BASE + 3} L${youX + 4} ${BASE + 3} L${youX} ${BASE - 2} Z`} fill="var(--en-accent)" />
        <text x={youX} y={BASE + 25} textAnchor={mine >= BUCKETS - 3 ? 'end' : mine <= 2 ? 'start' : 'middle'} fontSize="11" fontWeight="700" fill="var(--en-accent)" transform={mine >= BUCKETS - 3 ? `translate(${SLOT / 2} 0)` : mine <= 2 ? `translate(${-SLOT / 2} 0)` : undefined}>
          You {you.total}
        </text>
        {avg !== null && (
          <g data-testid="ens-compare-mean" data-mean={Math.round(avg)}>
            <line x1={x(avg)} x2={x(avg)} y1={TOP - 4} y2={BASE} stroke="var(--en-ink)" strokeWidth="1.5" strokeDasharray="4 3" />
            <text x={x(avg)} y={TOP - 9} textAnchor={avg > 400 ? 'end' : avg < 100 ? 'start' : 'middle'} fontSize="11" fill="var(--en-ink)">
              Others {Math.round(avg)}
            </text>
          </g>
        )}
        {[0, 100, 200, 300, 400, 500].map((v) => (
          <text key={v} x={x(v)} y={BASE + 13} textAnchor={v === 0 ? 'start' : v === 500 ? 'end' : 'middle'} fontSize="10" fill="var(--en-faint)" opacity={Math.abs(x(v) - youX) < 26 && v !== 0 && v !== 500 ? 0 : 1}>
            {v}
          </text>
        ))}
      </svg>
      <p className="ens-label mt-1">Each bar is {BUCKET_WIDTH} points wide. Dashed line: the average of everyone else.</p>

      <p className="ens-label mt-4">Puzzle by puzzle. Top bar: you. Bottom bar: the average.</p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0" aria-label="Each puzzle against the average">
        {you.ids.map((id, i) => {
          const mean = stats.perPuzzle[id]?.mean;
          const title = byId(id)?.title ?? id;
          const pts = you.points[i] ?? 0;
          return (
            <li key={id} data-testid={`ens-pp-${id}`} data-you={pts} data-avg={mean === undefined ? '' : Math.round(mean)}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <b className="min-w-0 truncate">{title}</b>
                <span className="ens-label shrink-0">You {pts} · Average {mean === undefined ? 'n/a' : Math.round(mean)}</span>
              </div>
              <div className="mt-1 flex flex-col gap-1" aria-hidden="true">
                <div style={{ height: 7, borderRadius: 4, background: 'var(--en-panel2)' }}>
                  <div style={{ width: `${Math.min(100, pts)}%`, height: '100%', borderRadius: 4, background: 'var(--en-accent)' }} />
                </div>
                <div style={{ height: 7, borderRadius: 4, background: 'var(--en-panel2)' }}>
                  <div style={{ width: `${mean === undefined ? 0 : Math.min(100, mean)}%`, height: '100%', borderRadius: 4, background: 'var(--en-cool)' }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
