# Engineerle

Five engineering puzzles a day, the same for everyone, each with real physics behind it. Today's five are drawn from a
pool of thirteen across structures, mechanical, electrical, electronics and aerospace engineering, never more than two
from one discipline, easiest first, avoiding recent days.

| Discipline | Puzzles |
| --- | --- |
| Structures and fluids | the failing bridge (truss FEM, buckling and yield), level the barge (hydrostatics) |
| Mechanical | find the pivot, smooth running (four-stroke firing order), gear the output |
| Electrical | pick the resistor (nodal analysis), send it down the line (I²R loss and insulator limit) |
| Electronics | read the scope, tame the noise (RC filter), set the gain (op-amp) |
| Aerospace | split the stages (two-stage Tsiolkovsky), reach the high orbit (Hohmann transfer), load the aircraft (CG and static margin) |

## Playing and scoring

Three guesses on each puzzle, a clock that runs only while a puzzle is open and the page is visible, and **no hints**: a
wrong guess says what physically happened (the meter reads, the bridge collapses, the orbit tops out at this height),
never what to change.

A puzzle is worth `round(100 · G · T)`:

- `G` is 1, 0.65 or 0.35 for a solve on the first, second or third guess;
- `T` is 1 up to the puzzle's par time, then falls in a straight line to 0.4 at four times par.

A day is worth 500 at most. At the end the results show a histogram of everyone's totals with your own bar picked out,
the average of the other players, your percentile (once ten people have played) and each puzzle against its average.

## Run it

```bash
npm install
npm run dev            # Next.js dev server
npm run build          # static export (output: 'export')
npm test               # physics, generator and stats tests (every generator is checked over 1000 seeds)
npm run typecheck
NEXT_PUBLIC_SUPABASE_URL=https://stats.test NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_test npm run build:static && npm run test:e2e
```

`npm run build:static` is a Next-free esbuild + Tailwind build of the same components, used for fast local and CI
browser tests (Playwright + Chromium). The e2e build points the stats service at `https://stats.test`, which the tests
mock, so no real project is ever called. Vercel uses the normal Next.js build.

Set `NEXT_PUBLIC_OBSCURA_URL` (build time) to point the Obscura links at its own domain.

## Daily statistics (Supabase)

Progress, streaks and settings live in the browser (`localStorage`). Only the finished day is sent anywhere, to a small
Supabase project, so the results screen can compare you with everyone else.

1. Create a Supabase project and apply `supabase/migrations/20261019_engineerle_stats.sql`. It creates
   `engineerle_results` with row level security on and no policies (the browser cannot read or write the table) and two
   functions the browser may call: `engineerle_submit` (checks every field, one row per device per day) and
   `engineerle_day_stats` (counts, mean, 20 buckets, per-puzzle means).
2. Add two environment variables in Vercel (or `.env.local`):
   `NEXT_PUBLIC_SUPABASE_URL` (the project URL) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key).
3. With either unset the game works as before and the results screen says the comparison is unavailable.

What is sent: the day number, a random device id made on first use, the five puzzle ids, points, guesses and seconds.
Nothing that identifies a person. Submissions are anonymous, so a determined person can post a made-up score within the
allowed ranges; that is accepted for a daily game. If the service is down the result is kept and sent on the next visit,
never twice.

## Adding a puzzle

1. `src/engineerle/<name>.ts`: the physics, `evaluate(spec, guess)`, and `make<Name>(seed)` that returns a solvable
   spec. Put the maths in pure functions.
2. `tests/<name>.test.ts`: check the physics against a worked textbook example, the edge inputs (empty, zero,
   negative, NaN, enormous), and that 1000 seeds all produce a puzzle that is solvable but not already solved.
3. `src/components/<Name>Puzzle.tsx`: the view and the input. It reports a guess with `onAttempt(solved)`.
4. One entry in `POOL` in `src/engineerle/registry.ts` (id, discipline, difficulty, tab, title, par seconds) **with `since` set to a future date (`'YYYY-MM-DD'`, the first day it may appear)**: days are chosen only from puzzles active on that date, so adding a puzzle never changes a day players have already seen or saved. Retire one with `until`, never by deleting it; the spec
   type in the union in `daily.ts`, and a case in the switch in `EngineerleApp.tsx`.
5. A solver in `tests/e2e.ts`.

## Layout

| Path | What |
| --- | --- |
| `src/engineerle/` | Pure physics and generators, `registry.ts` (the pool), `select.ts` (the daily five), `scoring.ts`, `store.ts` (saved progress), `stats.ts` (the stats client) |
| `src/components/` | The app, one component per puzzle, `ComparisonChart`, the shared 3D `Stage`, sidebar, settings, modals |
| `src/lib/` | Settings and the cross-site hand-off, sound effects (synthesised, no audio files), dates |
| `supabase/migrations/` | The stats schema |
| `tests/` | One test file per model plus `e2e.ts` (browser) |

The 3D stage uses a perspective camera, and falls back to a fixed oblique 2.5D view in Low CPU mode or on software
renderers. With no WebGL at all the puzzles still run.

## References for the physics

- Norton, *Design of Machinery* (gears, crank balance).
- Taylor, *The Internal-Combustion Engine in Theory and Practice*; Stone, *Introduction to Internal Combustion
  Engines*; Heywood, *Internal Combustion Engine Fundamentals* (firing order, primary and secondary forces and couples).
- Beer and Johnston, *Mechanics of Materials*; Hibbeler, *Structural Analysis* (trusses, buckling, yield).
- Sedra and Smith, *Microelectronic Circuits* (op-amps, RC filters, nodal analysis).
- Vallado, *Fundamentals of Astrodynamics and Applications* (vis-viva, Hohmann transfer).
- Anderson, *Introduction to Flight* (centre of gravity, static margin, tail load, the rocket equation).
- Biran, *Ship Hydrostatics and Stability* (the barge).
