# Engineerle Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Engineerle into a pool of 13 physics puzzles with five different ones each day, a timer-and-guess score of up to 100 per puzzle, no hints, a corrected four-stroke crankshaft puzzle, a rebuilt bridge, and an end-of-day comparison against all players.

**Architecture:** Each puzzle is a pure model module (`src/engineerle/<id>.ts`: `make(seed)` and pure evaluation) plus a React component, registered once in `src/engineerle/registry.ts`. Daily selection, scoring, timer and store know only the registry. Other players' results go to Supabase through two RPC functions called with plain `fetch` (no new npm dependency).

**Tech Stack:** TypeScript, React 19, Three.js r186, Next.js static export, Tailwind v4, Supabase (Postgres + RPC), Playwright e2e, `tsx` for unit tests.

**Spec:** `docs/superpowers/specs/2026-10-19-engineerle-expansion-design.md`

## Global Constraints

- Three guesses per puzzle. Points for a solve = `round(100 * G * T)`; `G` = 1.00 / 0.65 / 0.35 for the 1st / 2nd / 3rd guess; `T` = 1.0 up to the puzzle's par time, linear down to 0.4 at 4 x par, then 0.4. A failed puzzle scores 0. Day maximum 500.
- No hint text anywhere: no "Hint:", no per-member failure labels, no unlockable instruments. The answer appears only once the puzzle is finished.
- Five distinct puzzles per day; at most two from one discipline; puzzles used in the previous two days are skipped while enough others remain; same date gives the same set; ordered by ascending difficulty.
- Par seconds: bridge 150, barge 150, lever 90, crankshaft 150, gear 90, resistor 90, powerline 90, waveform 60, rc 90, opamp 90, rocket 120, orbit 150, aircraft 120. Difficulty 1: waveform, lever, resistor, powerline, gear. Difficulty 2: rc, opamp, aircraft, barge, rocket. Difficulty 3: bridge, crankshaft, orbit.
- Storage key `engineerle:v2:progress`; old v1 data is ignored (reset). Settings key `engineerle:v1:settings` unchanged.
- Determinism: generators use `rng` and `hashSeed` from `src/engineerle/rand.ts` only (never `Math.random`).
- Obscura link default `https://obscura-navy-omega.vercel.app`.
- Stats privacy: one row per device per day holding only a random device id, day number, five puzzle ids, points, guesses, seconds, total. The table is not readable by the anonymous role; only the two RPC functions are.
- Run tests with `npx tsx tests/<name>.test.ts`; browser tests with `node scripts/build.mjs && npx tsx tests/e2e.ts`. Typecheck with the scratchpad `tsconfig.en.json` (see Task 0).

## Review Focus

- Laptop sleeps or tab is hidden mid-puzzle: elapsed seconds must not jump by hours (clamp each tick; pause when hidden). Pinned in Task 3.
- Corrupt, old (v1) or missing localStorage: app loads with a clean day, no exception. Pinned in Task 2.
- Stats service slow, down, or returning garbage: results screen still renders the player's own results; no unhandled rejection; the submit is retried later and never creates a second row. Pinned in Tasks 14 and 15.
- Numeric inputs that are empty, zero, negative, NaN or enormous (0 ohm resistor, negative tooth count, gain of 1e9): refused with a plain message without using a guess. Pinned in every puzzle task's evaluation tests.
- Fewer eligible puzzles than the selection rules need, or a date far in the past or future: selection still returns five distinct puzzles. Pinned in Task 2.

---

### Task 0: Tooling and branch hygiene

**Files:** Modify `package.json` (test script), `tests/` (new test files are added by later tasks).

- [ ] **Step 1:** In `package.json` set `"test"` to run every `tests/*.test.ts` in sequence (`tsx tests/engineerle.test.ts && tsx tests/pool.test.ts ...` is replaced by a small `scripts/run-tests.mjs` that runs each file matching `tests/*.test.ts` and exits non-zero on the first failure).
- [ ] **Step 2:** Create `scripts/run-tests.mjs`; run `npm test`; expected: the existing 20 tests pass.
- [ ] **Step 3:** Commit `chore: run every unit test file`.

### Task 1: Bridge physics rebuild

**Files:** Modify `src/engineerle/truss.ts` (`truckLoads`, `startCollapse`, new `dynamicResponse`), `src/components/BridgePuzzle.tsx`. Test: `tests/truss.test.ts`.

**Interfaces:**
- Produces: `truckLoads(t: Truss, truck: Truck, u: number): number[]` sharing the wheel loads between the two nearest bottom nodes by linear interpolation (continuous in `u`); `dynamicResponse(t: Truss, areas: number[], truck: Truck, dt: number, steps: number): { time: number[]; disp: number[][]; maxUtil: number[] }` using lumped masses, Rayleigh damping (zeta 0.05 at the first mode) and a fixed step; `startCollapse(...)` and `stepCollapse(c: Collapse, dt: number)` run on a fixed 1/240 s step with accumulated frame time, with failed members removed from stiffness.
- Consumes: `buildTruss`, `solveTruss`, `capacity`, `utilisation` (unchanged).

- [ ] **Step 1: Find the causes.** Reproduce the jank in the browser, record which of these happens (truck load jumping between nodes, collapse stepped by frame time, stiff members vibrating at rest) and write the finding in the commit message.
- [ ] **Step 2: Write failing tests** in `tests/truss.test.ts`:
  - `truckLoads` summed over nodes equals the truck weight at every `u` in 0..1 sampled at 200 points, and no node's load changes by more than 5% of the weight between consecutive samples.
  - Two-bar symmetric truss (pin-pin, apex load `P`): member force `P / (2 sin(alpha))` within 1e-9 of `solveTruss`.
  - Euler: `capacity(area, length, true)` for a long slender member equals `pi^2 * E * I / L^2` with `I = I_FACTOR * area^2` within 1e-6 relative (pinned-pinned, K = 1).
  - Method of joints on a 3-panel Warren truss under a single mid-span load: every member force within 1e-6 of the hand-solved values listed in the test.
  - `dynamicResponse` with half `dt` gives peak deflection within 1%; total energy (kinetic + strain) never exceeds the initial plus work done by 1e-6; after 10 s of rest the velocity norm is below 1e-6.
  - A collapse started from an overloaded member is identical (node positions within 1e-9) when run as 240 steps of 1/240 s or as 60 frames of 1/60 s.
- [ ] **Step 3:** Run `npx tsx tests/truss.test.ts`; expected FAIL on the missing exports.
- [ ] **Step 4:** Implement per Interfaces. `dynamicResponse` integrates `M u'' + C u' + K u = f(t)` with semi-implicit Euler on the reduced system; collapse removes a member's stiffness when `utilisation >= 1` and continues the same integrator under gravity with a ground plane.
- [ ] **Step 5:** Update `BridgePuzzle.tsx` to drive the truck at constant speed from `truckLoads`, play `dynamicResponse` frames for the pass, and run `stepCollapse` with a fixed-step accumulator. Remove the per-member "broke" labels (`data-hit`) and the member-failure wording; keep the visible collapse. Run all tests; capture screenshots of a pass and a collapse and inspect them.
- [ ] **Step 6:** Commit `fix: bridge truck load, damping and fixed-step collapse`; push.

### Task 2: Registry, daily selection, scoring, store v2

**Files:** Create `src/engineerle/registry.ts`, `src/engineerle/select.ts`, `src/engineerle/scoring.ts`. Modify `src/engineerle/daily.ts`, `src/engineerle/store.ts`. Test: `tests/pool.test.ts`, `tests/scoring.test.ts`, extend `tests/engineerle.test.ts` (store).

**Interfaces:**
- Produces:
  - `type Discipline = 'structures' | 'mechanical' | 'electrical' | 'electronics' | 'aerospace'`
  - `interface PuzzleDef { id: string; discipline: Discipline; difficulty: 1 | 2 | 3; tab: string; title: string; brief: string; parSeconds: number; make(seed: number): { kind: string } }`
  - `const POOL: PuzzleDef[]` (starts with the four existing puzzles that survive: bridge, barge, lever, waveform (the old graph, id `waveform`); later tasks append)
  - `pickDay(dateKey: string, pool?: PuzzleDef[]): string[]` (five ids)
  - `getEngineerleDaily(dateKey: string): { dateKey: string; number: number; puzzles: Array<{ def: PuzzleDef; spec: { kind: string } }> }`
  - `guessFactor(attempt: number): number`, `timeFactor(seconds: number, par: number): number`, `puzzlePoints(attempt: number, seconds: number, par: number): number`
  - Store v2: `PuzzleRecord { id: string; attempts: number; solved: boolean; done: boolean; points: number; seconds: number }`; `recordAttempt(s, dateKey, index, solved, par): EngineerleStore`; `addSeconds(s, dateKey, index, delta): EngineerleStore`; `getDay` builds the day's records from `getEngineerleDaily`.
- Consumes: `hashSeed`, `rng`, `daysBetween`.

- [ ] **Step 1: Write failing tests.**
  - `scoring`: `puzzlePoints(1, 0, 90) === 100`; `puzzlePoints(1, 90, 90) === 100`; `puzzlePoints(1, 360, 90) === 40`; `puzzlePoints(1, 9999, 90) === 40`; `puzzlePoints(2, 90, 90) === 65`; `puzzlePoints(3, 360, 90) === 14`; `timeFactor(225, 90) === 0.7`; `puzzlePoints(0, ...)` and `puzzlePoints(4, ...)` clamp to attempts 1 and 3.
  - `pool` (over 400 consecutive dates from 2026-10-19 with the full POOL once it has 13 entries, and with a 6-entry test pool): five distinct ids; no discipline appears more than twice; no id in the previous two days' sets when the pool has at least 11 puzzles; sorted by non-decreasing difficulty; same date returns identical ids on repeated calls; every pool id appears at least once in the 400 days; a pool of exactly five returns those five; a date in 1999 and one in 2200 still return five distinct ids.
  - `store`: `sanitise` on `null`, `'x'`, `{v: 1, days: {...}}`, `{v: 2, days: {'2026-10-19': {puzzles: [{attempts: 99, seconds: -5}]}}}` returns a valid v2 store with attempts clamped to 3 and seconds clamped to >= 0; `recordAttempt` solving on guess 2 at 225 s of a par-90 puzzle stores `points === round(100 * 0.65 * 0.7) === 46`; `addSeconds` accumulates and never goes negative; a store round-trips through `JSON.stringify`.
- [ ] **Step 2:** Run the three files; expected FAIL.
- [ ] **Step 3:** Implement. `pickDay` shuffles the pool with a seeded `rng(hashSeed(dateKey + ':pick'))`, then takes puzzles in that order subject to the rules, relaxing "previous two days" first and "two per discipline" last when the pool is too small; the previous days' sets come from recursively picking the prior two dates with relaxation off (depth-limited, no unbounded recursion). Bump the storage key to `engineerle:v2:progress`.
- [ ] **Step 4:** Update `EngineerleApp.tsx`, `Board.tsx`, `store.ts` consumers to the new shapes (puzzle list from `daily.puzzles`, tab labels from `def.tab`) so the app compiles and the four surviving puzzles still play. Run `npm test` and the e2e suite (update the existing e2e expectations that assumed a fixed order or 100/65/35 points).
- [ ] **Step 5:** Commit `feat: puzzle pool, daily selection, timed scoring, store v2`; push.

### Task 3: Timer, par display, hint removal

**Files:** Create `src/hooks/useStopwatch.ts`. Modify `src/components/Board.tsx` (timer and par shown in the header), `src/components/EngineerleApp.tsx`, `GraphPuzzle.tsx`, `LeverPuzzle.tsx`, `BargePuzzle.tsx`, `BridgePuzzle.tsx` (remove hint notes). Test: `tests/stopwatch.test.ts` (pure helper), e2e.

**Interfaces:**
- Produces: `nextElapsed(prev: number, deltaMs: number, visible: boolean): number` (pure: adds `min(deltaMs, 2000) / 1000` only when visible, else `prev`); `useStopwatch(running: boolean, initialSeconds: number, onSave: (seconds: number) => void): number` (ticks every 250 ms, saves at most once per second and on `visibilitychange` and `pagehide`).

- [ ] **Step 1: Failing tests.** `nextElapsed(10, 250, true) === 10.25`; `nextElapsed(10, 3_600_000, true) === 12` (sleep clamp); `nextElapsed(10, 250, false) === 10`; e2e: timer text advances while a puzzle is open, does not advance for a puzzle already solved, survives reload within 2 s of the reload value; no element on any puzzle page contains the text `Hint`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement `nextElapsed` and `useStopwatch`; the timer starts when a puzzle is first shown and stops when its record is `done`. Remove every hint string (graph hints, lever tips naming a direction, bridge member-name wording); a wrong guess shows only the physical outcome plus guesses left.
- [ ] **Step 4:** Run unit tests, typecheck, e2e. Commit `feat: timer and par, remove hints`; push.

### Task 4: Crankshaft (four-stroke) replaces Engine

**Files:** Create `src/engineerle/crankshaft.ts`, `src/components/CrankshaftPuzzle.tsx`. Delete `src/engineerle/crank.ts`, `src/components/EnginePuzzle.tsx` once unused. Test: `tests/crankshaft.test.ts`.

**Interfaces:**
- Produces:
  - `interface CrankshaftSpec { kind: 'crankshaft'; n: 3 | 4 | 5 | 6; lambda: number; pitch: number; mass: number }`
  - `throwAngles(order: number[]): number[]` where `order` lists cylinder numbers (1-based) in firing order; entry `i` of the result is cylinder `i+1`'s throw angle in degrees, `(720 * slot / n) mod 360`
  - `residuals(spec: CrankshaftSpec, order: number[]): { primaryForce: number; primaryCouple: number; secondaryForce: number; secondaryCouple: number }` in units of `m r w^2` (couples in `m r w^2` times `pitch`)
  - `bestResiduals(spec): { primaryForce: number; primaryCouple: number; secondaryForce: number; secondaryCouple: number; orders: number[][] }` by exhaustive search (cylinder 1 fixed first)
  - `evaluate(spec, order): { solved: boolean; residuals: ...; shake: { amp1: number; amp2: number } }`; solved when every residual is within `max(0.02, 2% of the worst case)` of the best
  - `makeCrankshaft(seed: number): CrankshaftSpec`
  - `pistonAcceleration(r: number, l: number, thetaRad: number): number` exact, `d2/dtheta2` of `r cos t + sqrt(l^2 - r^2 sin^2 t)` with `w = 1`

- [ ] **Step 1: Write failing tests** (cylinders numbered along the crank, `pitch = 1`, `lambda = 0.25` unless stated):
  - `throwAngles([1,3,4,2])` equals `[0,180,180,0]`; `throwAngles([1,5,3,6,2,4])` equals `[0,120,240,240,120,0]`; `throwAngles([1,2,4,5,3])` equals `[0,144,288,72,216]` (5 cylinders: slots 0..4 at 144 degree spacing, mod 360).
  - Even firing: for every permutation of 4 cylinders the firing angles `720*slot/4` are 0,180,360,540 (spacing exactly 180).
  - In-line 6, order 1-5-3-6-2-4: all four residuals below 1e-9; order 1-2-3-4-5-6: primary couple greater than 1.
  - In-line 4, order 1-3-4-2: primaryForce and primaryCouple below 1e-9; secondaryForce equals `4 * lambda` within 1e-9; secondaryCouple below 1e-9. Order 1-2-3-4: primaryCouple equals 2 within 1e-9.
  - In-line 5, order 1-2-4-5-3: primaryForce and secondaryForce below 1e-9; primaryCouple and secondaryCouple above 0.5.
  - In-line 3, order 1-2-3: primaryForce and secondaryForce below 1e-9; primaryCouple above 1.
  - Independent numeric check: for `n` in 3..6 and a random order, sum `pistonAcceleration` (with `r = 1`, `l = 1/lambda`) over cylinders at 4096 crank angles, take the first and second harmonic amplitudes by DFT, and compare to `residuals` primary and secondary force magnitudes: difference below 5e-3 (higher harmonics are the cause of the small gap). Repeat with each cylinder weighted by `z` for couples.
  - `bestResiduals` for n=4 has `orders` containing `[1,3,4,2]` and `[1,2,4,3]` and not `[1,2,3,4]`; for n=6 contains `[1,5,3,6,2,4]` and `[1,4,2,6,3,5]`.
  - `evaluate` rejects an `order` that is not a permutation of 1..n (duplicates, missing, out of range, non-integers) with `solved: false` and a `refused` reason, and the UI must not count that as a guess.
  - `makeCrankshaft(seed)` over 1000 seeds returns `n` in 3..6 and `bestResiduals(...).orders.length >= 1` and the identity order is not already solved for n >= 4.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement. Primary vector for cylinder `i` has magnitude `mass` at angle `phi_i`; secondary has magnitude `lambda * mass` at `2 * phi_i`; couples weight by `z_i = (i - (n + 1) / 2) * pitch`.
- [ ] **Step 4:** UI: 3D crankshaft turning with the real throw angles; the player taps cylinders in firing order (testids `crank-cyl-1..n`, `crank-reset`, `crank-run`); on run, the block shakes at 1x and 2x in proportion to `amp1`, `amp2` for 2 s, then reports solved or the physical outcome (no instrument gauges, no hints). Par 150 s. Register in `POOL` (discipline `mechanical`, difficulty 3).
- [ ] **Step 5:** Add e2e: refused order uses no guess; a best order solves; a poor order shakes and uses one guess. Run everything; commit `feat: four-stroke crankshaft puzzle replaces engine`; push.

### Task 5: Waveform (oscilloscope skin of the curve puzzle)

**Files:** Modify `src/engineerle/graph.ts` (add `makeWaveform(seed)` producing `kind: 'waveform'` specs: `A sin(2 pi f t + p) + c` with `A` 0.5-5 V, `f` 50 Hz-5 kHz, `p` multiples of 15 degrees, `c` 0 or multiples of 0.5 V), `src/components/GraphPuzzle.tsx` (scope graticule, volts/div and time/div labels, green phosphor trace, variable `t`). Test: extend `tests/engineerle.test.ts`.

**Interfaces:** Produces `makeWaveform(seed: number): GraphSpec`; `checkGraph` unchanged and accepts `sin`, `pi`, `t` as the variable.

- [ ] **Step 1: Failing tests.** `checkGraph(makeWaveform(s), spec.answer).solved` for 500 seeds; `A sin(2 pi f t) ` with phase off by 15 degrees fails; equivalent forms (`A*sin(2*pi*f*t+p)` vs `A sin(p + 2 pi f t)`) both pass; empty, `t +`, `1/0` and `sin(` are refused (no guess used).
- [ ] **Step 2-4:** Run to fail, implement, run to pass. Register `waveform` (electronics, difficulty 1, par 60) replacing the old `graph` entry; the old `graph` family generator stays available but is not in `POOL`.
- [ ] **Step 5:** e2e solve path; commit `feat: waveform puzzle`; push.

### Task 6: Resistor network

**Files:** Create `src/engineerle/circuit.ts`, `src/components/CircuitPuzzle.tsx`. Test: `tests/circuit.test.ts`.

**Interfaces:**
- Produces: `const E24: number[]` (the 24 standard values per decade, 1.0 to 9.1); `solveNetwork(nodes: number, resistors: Array<{ a: number; b: number; ohms: number }>, sources: Array<{ node: number; volts: number }>): number[]` (node voltages, node 0 is ground, by nodal analysis with Gaussian elimination); `makeCircuit(seed: number): CircuitSpec` where the spec gives a network with one free resistor slot, a target (`current` through a marked branch in mA or `voltage` at a marked node), and a tolerance of 2%; `evaluate(spec, ohms: number): { solved: boolean; measured: number; refused?: string }`.

- [ ] **Step 1: Failing tests.** 9 V across 1 kohm + 2 kohm gives 3 mA and node voltage 6 V at the junction (`solveNetwork` within 1e-9); 1 kohm parallel 1 kohm across 10 V draws 20 mA; a balanced Wheatstone bridge (all 1 kohm, 10 V) has 0 V between its middle nodes within 1e-9; KCL: net current at every non-source node below 1e-9 for 200 random networks; KVL: sum of drops around the outer loop equals the source within 1e-9; `evaluate` refuses `0`, negative, `NaN`, `Infinity` and values above 10 Mohm; `makeCircuit` over 1000 seeds yields a target met by at least one `E24` value and not met by the initial value.
- [ ] **Step 2-4:** Run to fail, implement, run to pass.
- [ ] **Step 5:** UI: schematic drawn with SVG on the drafting board, a resistor dial that snaps through E24 values across decades, and a simulated multimeter reading appearing after Test. Register (electrical, difficulty 1, par 90). e2e; commit `feat: resistor network puzzle`; push.

### Task 7: Power line and transformer

**Files:** Create `src/engineerle/powerline.ts`, `src/components/PowerlinePuzzle.tsx`. Test: `tests/powerline.test.ts`.

**Interfaces:** Produces `lineState(spec: PowerlineSpec, ratio: number): { vLine: number; iLine: number; lossW: number; lossPct: number; vLoad: number; efficiency: number }`; `makePowerline(seed): PowerlineSpec` (`power` 20-500 kW, `vGen` 400-11000 V, `lineOhms` 1-20, `maxLossPct` 2-8, `ratios` selectable from a fixed list 1, 2, 5, 10, 20, 25, 50, 100); `evaluate(spec, ratio)`.

- [ ] **Step 1: Failing tests.** 100 kW at 10 kV through 5 ohm: `iLine === 10`, `lossW === 500`, `lossPct === 0.5`; same load at 1 kV: `iLine === 100`, `lossW === 50000`, `lossPct === 50`; ideal transformer: `vLine = vGen * ratio`, `iLine = power / vLine`; `vLoad = vLine - iLine * lineOhms`; power conservation `power = lossW + delivered` within 1e-9; `evaluate` refuses ratio `0`, negative, `NaN`; over 1000 seeds a solving ratio exists in the list and ratio 1 never solves.
- [ ] **Steps 2-5:** as Task 6 (UI: pylons and a line with glowing current, a tap-selected ratio, a "transmit" run showing the load voltage and loss). Register (electrical, difficulty 1, par 90). Commit `feat: power line puzzle`; push.

### Task 8: RC filter

**Files:** Create `src/engineerle/rcfilter.ts`, `src/components/RcFilterPuzzle.tsx`. Test: `tests/rcfilter.test.ts`.

**Interfaces:** Produces `cutoff(r: number, c: number): number` (`1 / (2 pi r c)`); `gainLow(f: number, fc: number): number` (`1 / sqrt(1 + (f/fc)^2)`); `gainHigh`; `phaseLow(f, fc): number` (degrees); `stepResponse(r, c, t): number` (`1 - e^(-t/(rc))`); `makeFilter(seed): FilterSpec` (wanted frequency, noise frequency, required passband loss limit in dB and noise attenuation in dB, kind low or high pass); `evaluate(spec, r: number, c: number)` with R from `E24` decades 100 ohm to 1 Mohm and C from a list 1 nF to 10 uF.

- [ ] **Step 1: Failing tests.** `cutoff(1000, 159.155e-9)` is 1000 Hz within 0.01; `gainLow(fc, fc)` is `1/sqrt(2)` within 1e-12, i.e. -3.0103 dB; phase at `fc` is -45 degrees within 1e-9; `gainLow(10 * fc, fc)` is -20.04 dB within 0.01; independent time-domain check: integrate `dv/dt = (vin - v) / (rc)` with RK4 (step `rc/2000`) for a sine at 10 fc and compare steady-state amplitude to `gainLow` within 0.5%; `stepResponse(r, c, r * c)` is `0.63212` within 1e-5 and matches the RK4 result within 1e-6; `evaluate` refuses non-positive or non-finite R or C; `makeFilter` yields specs with at least one satisfying (R, C) pair in the dial lists and not satisfied by the first dial position, over 1000 seeds.
- [ ] **Steps 2-5:** UI: scope with the noisy input and the filtered output computed from the real transfer function; R and C dials; Run shows the output trace. Register (electronics, difficulty 2, par 90). Commit `feat: RC filter puzzle`; push.

### Task 9: Op-amp amplifier

**Files:** Create `src/engineerle/opamp.ts`, `src/components/OpampPuzzle.tsx`. Test: `tests/opamp.test.ts`.

**Interfaces:** Produces `closedLoopGain(mode: 'inverting' | 'non-inverting', rf: number, rg: number): number` (`-rf/rg` or `1 + rf/rg`); `bandwidth(gbw: number, gain: number): number` (`gbw / |gain|`, non-inverting uses `|gain|`, inverting uses `1 + |gain|`); `output(spec, gain, vin: number, f: number): number` (single-pole magnitude, clipped to `+/- (supply - 1.5)` V); `makeOpamp(seed): OpampSpec` (mode, input amplitude, input frequency, GBW, supply, target output amplitude, tolerance 5%); `evaluate(spec, rf, rg)`.

- [ ] **Step 1: Failing tests.** `closedLoopGain('inverting', 10e3, 1e3) === -10`; `closedLoopGain('non-inverting', 9e3, 1e3) === 10`; non-inverting 10x with 1 MHz GBW has 100 kHz bandwidth; at the bandwidth frequency the magnitude is `gain / sqrt(2)` within 1e-9; a 0.5 V peak input with gain 30 on a +/-12 V supply clips at 10.5 V; `evaluate` refuses `rg = 0`, negative or `NaN` resistors; over 1000 seeds there is a pair of resistor values from the E24 dial lists reaching the target within tolerance without clipping or exceeding the bandwidth, and the first dial position does not.
- [ ] **Steps 2-5:** UI: schematic plus scope showing input and output (clipping drawn flat). Register (electronics, difficulty 2, par 90). Commit `feat: op-amp puzzle`; push.

### Task 10: Rocket staging

**Files:** Create `src/engineerle/rocket.ts`, `src/components/RocketPuzzle.tsx`. Test: `tests/rocket.test.ts`.

**Interfaces:** Produces `deltaV(isp: number, m0: number, mf: number): number` (`isp * 9.80665 * ln(m0/mf)`, m/s); `twoStageDeltaV(spec: RocketSpec, split: number): number` (`split` is the fraction of propellant in stage 1; structural mass is a fixed fraction of each stage's propellant; stage 2 mass is dropped between burns); `bestSplit(spec): { split: number; dv: number }` by scanning 0.001 steps; `makeRocket(seed): RocketSpec` (total propellant, structural fractions 0.08-0.12, Isp 280-340 s stage 1 and 330-460 s stage 2, payload mass, required delta-v 9300-9600 m/s stated as including losses); `evaluate(spec, split)` solved when `twoStageDeltaV >= required` (so a range of splits wins).

- [ ] **Step 1: Failing tests.** `deltaV(300, Math.E, 1)` equals `300 * 9.80665` within 1e-9 (mass ratio e gives exactly `isp * g0`); doubling the mass ratio adds `isp * g0 * ln 2`; a one-stage `twoStageDeltaV` limit (split 1 with no stage-2 propellant) equals the single-stage rocket equation; for identical stages with identical Isp the best split is where both stages give equal delta-v, matching the closed form within 0.005; brute force over 10000 splits never beats `bestSplit` by more than 1 m/s; `evaluate` refuses a split outside 0..1 or `NaN`; over 1000 seeds `bestSplit(spec).dv >= required + 50` and split 0.5 either solves or does not, whichever the generator says, but the extremes 0.05 and 0.95 never solve.
- [ ] **Steps 2-5:** UI: 3D two-stage rocket on a pad with a propellant slider; Launch plays the ascent with staging and reports orbit reached or the shortfall in m/s (the physical result, not a hint). Register (aerospace, difficulty 2, par 120). Commit `feat: rocket staging puzzle`; push.

### Task 11: Orbit transfer

**Files:** Create `src/engineerle/orbit.ts`, `src/components/OrbitPuzzle.tsx`. Test: `tests/orbit.test.ts`.

**Interfaces:** Produces `MU = 398600.4418` (km^3/s^2); `visViva(r: number, a: number): number`; `hohmann(r1: number, r2: number): { dv1: number; dv2: number; time: number }`; `leadAngle(r1: number, r2: number): number` (`pi * (1 - sqrt(((r1 + r2) / (2 * r2))^3))`, radians); `propagate(state: { x: number; y: number; vx: number; vy: number }, dt: number, steps: number): State` (RK4 two-body); `makeOrbit(seed): OrbitSpec` (start radius 6578-7500 km, target 8000-42164 km, burn tolerance 1%); `evaluate(spec, dv1: number)` propagates the burn to apoapsis and solved when the apoapsis radius is within 1% of the target.

- [ ] **Step 1: Failing tests.** Circular speed `visViva(r, r) === sqrt(MU / r)`; for r1 = 6678.137 and r2 = 42164: `dv1`, `dv2` and `time` agree with an independent RK4 propagation (burn `dv1` at periapsis, find the apoapsis radius and the half-period) within 1e-4 relative; apoapsis from the propagator equals `r2` within 0.1 km; total energy conserved over 10 orbits within 1e-9 relative; `leadAngle(r1, r2)` agrees within 1e-4 rad with the angle by which a target in the outer circular orbit advances... (test measures: after `time`, target true-anomaly gain is `pi - leadAngle`); `evaluate` refuses non-finite or negative burns; a burn of 0 does not solve.
- [ ] **Steps 2-5:** UI: 3D Earth and orbits; the player sets the burn in m/s and fires at periapsis; the spacecraft follows the real path (accelerated time) and the achieved apoapsis is shown as a result of the guess. Register (aerospace, difficulty 3, par 150). Commit `feat: orbit transfer puzzle`; push.

### Task 12: Aircraft balance

**Files:** Create `src/engineerle/aircraft.ts`, `src/components/AircraftPuzzle.tsx`. Test: `tests/aircraft.test.ts`.

**Interfaces:** Produces `cgPosition(spec: AircraftSpec, placements: number[]): number` (mass-weighted position, m, from the datum); `staticMargin(spec, xcg: number): number` (`(x_np - xcg) / mac`); `tailLoad(spec, xcg: number): number` (moment balance about the wing aerodynamic centre in level flight); `makeAircraft(seed): AircraftSpec` (empty mass and CG, neutral point, mean aerodynamic chord, three or four movable items with allowed stations, safe static margin 5%-20%); `evaluate(spec, placements)` solved when the static margin lies in the safe band and the tail load magnitude is within the tail's limit.

- [ ] **Step 1: Failing tests.** Two 100 kg masses at 2 m and 4 m give a CG of 3 m; moving a 50 kg item 1 m aft moves the CG by `50 / total` m; `staticMargin` with `x_np = 3.2`, `xcg = 3.0`, `mac = 2.0` is exactly 0.1; moment balance: `tailLoad * tailArm + wingLift * (xcg - xac) = 0` holds within 1e-9 with lift equal to weight minus tail load; CG forward of the band and aft of the band do not solve; over 1000 seeds some placement solves and the starting placement does not; `evaluate` refuses placements outside the allowed stations or non-finite values.
- [ ] **Steps 2-5:** UI: 3D aircraft with sliding cargo and fuel stations; Weigh and Fly shows the CG on a loading diagram and whether the aircraft trims or pitches over. Register (aerospace, difficulty 2, par 120). Commit `feat: aircraft balance puzzle`; push.

### Task 13: Gear train

**Files:** Create `src/engineerle/gears.ts`, `src/components/GearPuzzle.tsx`. Test: `tests/gears.test.ts`.

**Interfaces:** Produces `trainRatio(teeth: Array<{ driver: number; driven: number }>): number` (product of driven over driver per mesh); `outputRpm(input: number, teeth): number` (sign gives direction: each external mesh flips it); `outputTorque(inputTorque: number, teeth, efficiency = 0.98): number`; `makeGears(seed): GearSpec` (input rpm 600-3000, target output rpm and direction, compound train of two or three meshes, tooth counts selectable 17-80, fixed module so centre distance `m * (z1 + z2) / 2` must fit the housing); `evaluate(spec, teeth)` solved when output speed is within 1% and direction matches and every mesh has at least 17 teeth and the centre distances fit.

- [ ] **Step 1: Failing tests.** 20 driver / 60 driven gives ratio 3 and 1500 rpm in becomes -500 rpm (reversed); two meshes restore direction; ratio is the product of stage ratios; torque times speed is conserved apart from the 2% loss within 1e-9; a 12-tooth pinion is refused; `evaluate` refuses non-integers, zero, negatives and counts above 80; over 1000 seeds a solving set exists and the initial set does not.
- [ ] **Steps 2-5:** UI: 3D meshed gears that turn at the true ratio when Run is pressed with the output rpm and direction shown after the run. Register (mechanical, difficulty 1, par 90). Commit `feat: gear train puzzle`; push.

### Task 14: Supabase backend and stats client

**Files:** Create `src/engineerle/stats.ts`, `supabase/migrations/20261019_engineerle_stats.sql`. Test: `tests/stats.test.ts`.

**Interfaces:**
- Produces: `deviceId(): string` (random UUID in `engineerle:v2:device`); `interface DayResult { day: number; ids: string[]; points: number[]; guesses: number[]; seconds: number[]; total: number }`; `submitResult(r: DayResult): Promise<'sent' | 'queued' | 'skipped'>` (retries later by keeping a pending marker in storage; never sends twice for a day); `interface DayStats { n: number; mean: number; buckets: number[]; perPuzzle: Record<string, { n: number; mean: number }> }` with 20 buckets of 25 points covering 0-500; `fetchDayStats(day: number): Promise<DayStats | null>` (null on any network, HTTP or shape error, with a 5 s timeout); `percentileBelow(buckets: number[], total: number): number` (share of players strictly below the player's bucket plus half the player's bucket).
- Database: table `engineerle_results(day int, device uuid, ids text[], points int[], guesses int[], seconds int[], total int, created_at timestamptz default now(), primary key (day, device))` with RLS enabled and no policies; `engineerle_submit(...)` and `engineerle_day_stats(p_day int)` as `security definer` functions with `set search_path = ''`, granted to `anon`. `engineerle_submit` rejects `total > 500`, any points outside 0-100, arrays not of length 5, seconds outside 0-86400, and `ids` not matching `^[a-z]{2,20}$`, and ignores a second row for the same (day, device). Config via `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 1: Failing tests** (fetch mocked): `fetchDayStats` returns `null` on a thrown fetch, a 500, malformed JSON and a body missing `buckets`; returns parsed stats on a good body; times out at 5 s; `submitResult` returns `'queued'` when fetch throws and `'sent'` on the retry, and `'skipped'` the second time for the same day; `percentileBelow([0,0,5,5,0...], bucketOfPlayer)` equals 62.5 for a hand-worked example in the test (10 players, 5 in a lower bucket, 5 in the player's bucket).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement the client with `fetch` to `${url}/rest/v1/rpc/<name>`.
- [ ] **Step 4: Create the Supabase project and migration** with the connected Supabase tools (the owner has approved Supabase): list organisations, confirm cost with `get_cost`-style info if offered, create the project, apply the migration, run `get_advisors` for security and fix any warning, then test the RPCs with `execute_sql` (a valid row is accepted, a duplicate is ignored, `total = 600` is rejected, a direct `select` on the table as `anon` returns nothing). Record the project URL and publishable key; tell the owner to add both as the two `NEXT_PUBLIC_` variables in the Vercel project.
- [ ] **Step 5:** Commit `feat: stats client and Supabase schema`; push.

### Task 15: Results comparison graph

**Files:** Create `src/components/ComparisonChart.tsx`. Modify `src/components/EngineerleApp.tsx` (Summary). Test: e2e with `page.route('**/rest/v1/rpc/**')` mocked.

**Interfaces:** Consumes `fetchDayStats`, `submitResult`, `percentileBelow`. Produces `<ComparisonChart stats={DayStats | null} you={{ total: number; points: number[]; ids: string[] }} />`: an SVG histogram of 20 buckets with the player's bucket highlighted, a dashed mean line, text "You scored higher than X% of N players today" (N shown always; percentile hidden when N < 10 with the text "Not enough players yet to rank you"), and per-puzzle paired bars (you and the average, labelled by puzzle title). When `stats` is null the section shows "The daily comparison is unavailable right now." and nothing else.

- [ ] **Step 1: Failing e2e.** With a mocked good response: chart renders, the player's bucket has `data-you="true"`, mean line present, text shows N and the percentile; with N = 3: ranking hidden; with HTTP 500, then network abort, then malformed JSON: the fallback text shows and the rest of the results (score, squares, share button) still work; the submit is sent once per day (second reload does not post again); dark, light and phone width render without horizontal scroll.
- [ ] **Step 2-4:** Run to fail, implement, run to pass. Submission happens when the fifth puzzle becomes done, in the background; the chart refreshes after the stats arrive.
- [ ] **Step 5:** Commit `feat: daily comparison graph`; push.

### Task 16: Documentation and final verification

**Files:** Modify `README.md`; the spec's status line.

- [ ] **Step 1:** Update the README: the pool and how to add a puzzle (one model file, one component, one registry entry, tests), the scoring formula, no hints, Supabase setup (the two environment variables and the migration), and the physics references (Norton, *Design of Machinery*; Taylor, *The Internal-Combustion Engine in Theory and Practice*; Stone, *Introduction to Internal Combustion Engines*; Heywood, *Internal Combustion Engine Fundamentals*; Beer and Johnston, *Mechanics of Materials*; Hibbeler, *Structural Analysis*; Sedra and Smith, *Microelectronic Circuits*; Vallado, *Fundamentals of Astrodynamics and Applications*; Anderson, *Introduction to Flight*; Biran, *Ship Hydrostatics and Stability*).
- [ ] **Step 2:** Run the full check: `npm test`, typecheck, `node scripts/build.mjs`, full e2e. Expected: every test passes with zero failures, including the 1000-seed generator tests.
- [ ] **Step 3:** Open the finished site in the browser at dark, light, Low CPU, no-WebGL and phone width and inspect one screenshot per puzzle.
- [ ] **Step 4:** Commit `docs: expansion documentation`; push; report to the owner what was verified and what was not (Vercel build, audio).
