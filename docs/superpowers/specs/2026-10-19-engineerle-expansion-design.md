# Engineerle expansion: a wider pool, honest physics, timed scoring, daily comparison

Status: built and verified (see README.md). Approved by the owner (pool selection and Supabase confirmed 2026-10-19). Not yet verified: the Vercel build and the live Supabase call from a browser.

## 1. What is being asked for

Said by the owner:

- Fix the bridge puzzle's physics ("a little janky").
- Cover more engineering disciplines (Aerospace, Mechanical, Electrical, Electronics and so on), five new challenges a day.
- First round must be reliable; every calculation must check out against real textbook physics.
- The engine puzzle is wrong for a four-stroke engine.
- Add a timer. Each puzzle scores up to 100 depending on time and number of guesses.
- No hints.
- After all five, show a graph of where the player placed against the daily average of all other players.
- Obscura's address is `https://obscura-navy-omega.vercel.app` (done).

Assumptions and confirmations:

- Confirmed: each day has five different puzzles drawn from a pool of any size.
- The day's maximum stays 500 (5 x 100).
- Players are anonymous. No accounts.
- Scores are computed in the browser, so a determined player can fake one. That is acceptable for a casual daily game and is stated on the results graph ("based on N players").

## 2. Where all players' scores live (decided: Supabase)

The site is static and has no server, so there is nowhere to collect other players' results. Options:

1. **Supabase (chosen).** A small Postgres table plus one read-only function that returns the day's histogram, mean and per-puzzle averages. Works from a static site. Free tier is plenty. I can create it with the connected Supabase tools once you say yes (it creates a project in your Supabase account).
2. **Cloudflare Worker + D1.** Same idea, a bit more code, also free-tier friendly.
3. **Build the graph now against a stub and plug in the backend later.** Ships sooner, but the graph shows no real players until the backend exists, and I will not invent fake players.

Data stored (option 1): a random device id, the day number, five puzzle ids, points, guesses and seconds per puzzle, and the total. Nothing personal. One row per device per day (first submission wins). Row-level security: anonymous clients may insert one row and may only read through the aggregate function, never the table.

## 3. The design

### 3.1 Daily set: five different puzzles from one big pool

The pool can be as large as we like. Each day takes **five different puzzles** from the whole pool, seeded from the date, so everyone sees the same five and the set changes every day.

Selection rules (all tested):

- Five distinct puzzles, never the same puzzle twice in a day.
- At most two from the same discipline, so a day is never five circuits.
- Puzzles used in the previous two days are skipped while enough others remain, so days do not feel repeated.
- Same date gives the same set on every device.
- Order within the day runs from the more approachable to the more demanding, using each puzzle's difficulty rating.

Round 1 pool (13 puzzles, so 1,287 possible five-puzzle days before any repeat):

| Discipline | Puzzles |
| --- | --- |
| Structures and Fluids | Bridge (physics rebuilt), Barge |
| Mechanical | Lever, Crankshaft (replaces the old Engine), Gear train (new) |
| Electrical | Resistor network (new), Power line and transformer (new) |
| Electronics | Waveform (the old Curve, drawn as an oscilloscope), RC filter (new), Op-amp (new) |
| Aerospace | Rocket staging (new), Orbit transfer (new), Aircraft balance (new) |

Adding a puzzle later means writing one module and registering it; the selection, scoring, timer, store and results screen need no changes.

### 3.2 Puzzle module interface

Every puzzle is a module with: `id`, `discipline`, `difficulty`, `tab`, `title`, `brief`, `parSeconds`, `make(seed)` (builds a solvable spec), `evaluate(spec, answer)` (pure, returns solved or not plus the physical outcome to display), and a UI component. The app, store, scoring, timer and results screen know nothing about any specific puzzle.

### 3.3 Scoring and timer

- A timer starts when a puzzle is first opened, runs only while the page is visible, stops when the puzzle is solved or out of guesses, and is saved every second so reloading does not reset it.
- Three guesses. Points for a solve = `round(100 x G x T)`.
  - `G` = 1.00, 0.65, 0.35 for a solve on the 1st, 2nd, 3rd guess.
  - `T` = 1.0 up to the puzzle's par time, falling in a straight line to 0.4 at four times par, then staying at 0.4.
  - A solve is therefore worth between 14 and 100. Failing is 0.
- Par time is shown on each puzzle. The results screen shows guesses, time and points for each.

### 3.4 No hints

Removed: every "Hint: ..." line, the per-member "this one broke" labels on the bridge, the engine's unlocked polygons, and any message that names what to change. What stays is the physical result of a guess: the lever tips, the bridge falls, the engine shakes, the barge lists, the circuit reads a current. The answer is shown only when the puzzle is finished.

### 3.5 Bridge physics (fix first)

I will find the root causes before changing anything. Likely ones: the truck's weight jumping between nodes instead of being shared along the deck, and a collapse stepped with frame time rather than a fixed step. The rebuilt behaviour:

- The truck moves at constant speed; its load is shared between the two nearest nodes by linear interpolation.
- Static response from the existing finite-element solve, plus a damped dynamic response so the deck settles instead of snapping.
- A member that exceeds its yield or Euler buckling load is removed from the stiffness matrix and the structure continues under a fixed-timestep, lumped-mass simulation, so collapse is progressive and frame-rate independent.
- Acceptance: a simple truss checked by hand (method of joints) against the solver; Euler load against `pi^2 E I / L^2`; results unchanged when the step size is halved; total energy never grows; no jitter at rest. I will also inspect rendered frames.

### 3.6 Crankshaft (replaces Engine). Why the old one was wrong, and the new model

The old puzzle chose arbitrary throw angles on a 360 degree dial. A four-stroke engine completes one cycle in 720 degrees of crank rotation, fires each cylinder once per cycle, and wants evenly spaced firing (every 720/N degrees). The old model had no firing order, no 720 degree cycle, and ignored the second-order (2x speed) shaking caused by the connecting rod's angle.

New model, in-line engine with N = 3, 4, 5 or 6 cylinders, equal reciprocating mass m, crank radius r, rod length l, lambda = r/l:

- The player chooses the **firing order**. Cylinder i is given firing slot s_i; it fires at cycle angle 720 x s_i / N, so firing is even by construction. Its crank throw angle is forced: phi_i = (720 x s_i / N) mod 360.
- Reciprocating inertia force of cylinder i along its axis, exact to second order: `F_i = -m r w^2 [cos(theta + phi_i) + lambda cos 2(theta + phi_i)]`.
- Net primary force is the vector sum of `m r w^2` at angle phi_i; secondary force is the vector sum of `lambda m r w^2` at angle 2 phi_i. Couples are the same sums weighted by each cylinder's position z_i along the crankshaft.
- The engine's four residuals (primary force, primary couple, secondary force, secondary couple) are compared with the best any firing order can achieve. The puzzle is solved when the player's order matches that best (within tolerance), so layouts that cannot be perfect (an in-line 4 always keeps a secondary force) are still fair.
- Textbook facts the tests must reproduce: in-line 3 has no primary or secondary force but has rocking couples; in-line 4 (0,180,180,0) has no primary force or couple and a secondary force of 4 lambda m r w^2; in-line 5 has no primary or secondary force but both couples; in-line 6 (three-plane crank, orders 1-5-3-6-2-4 and 1-4-2-6-3-5) is balanced in all four.
- The 3D rig shows the crankshaft turning with the real throw angles and the engine block shaking at 1x and 2x speed in proportion to the residuals.

References: Norton, *Design of Machinery* (balancing and engine dynamics); Taylor, *The Internal-Combustion Engine in Theory and Practice*; Stone, *Introduction to Internal Combustion Engines*; Heywood, *Internal Combustion Engine Fundamentals*.

### 3.7 The new puzzles (formulas I will implement and test)

- **Gear train (Mechanical).** Pick tooth counts so a compound train gives a target output speed and direction. Ratio = product of driven/driver teeth, direction flips at each mesh, torque scales inversely with speed, minimum 17 teeth (20 degree pressure angle, no undercutting), matching module so meshing gears share a centre distance.
- **Resistor network (Electrical).** Choose a standard (E24) resistor so a branch carries a target current or a node sits at a target voltage. Solved with nodal analysis (KCL), verified against closed-form series and parallel results and against KVL around every loop.
- **Power line and transformer (Electrical).** Choose the step-up ratio so line loss is below a target while delivering a given power. `I = P/V`, loss `= I^2 R`, ideal transformer `V2/V1 = N2/N1`, `I2/I1 = N1/N2`, efficiency, voltage at the load.
- **Waveform (Electronics).** The existing graph puzzle drawn as an oscilloscope trace: write the equation of a sine wave (amplitude, frequency, phase, offset) or a simple combination. Uses the existing safe expression parser and equivalence check.
- **RC filter (Electronics).** Choose R and C so a low-pass (or high-pass) filter passes a wanted frequency and attenuates noise by a target amount. `fc = 1/(2 pi R C)`, `|H| = 1/sqrt(1 + (f/fc)^2)`, phase `= -atan(f/fc)`; checked against a time-domain step response `1 - e^(-t/RC)`.
- **Op-amp (Electronics).** Choose the resistors for an inverting or non-inverting amplifier so the output hits a target gain without clipping at the supply rails and within the gain-bandwidth limit. Inverting `-Rf/Rin`, non-inverting `1 + Rf/Rg`, bandwidth `GBW/gain`.
- **Rocket staging (Aerospace).** Split a fixed propellant load between two stages to reach orbital speed. Tsiolkovsky `dv = Isp g0 ln(m0/mf)` per stage with stage masses dropped between burns; the required delta-v includes a stated gravity and drag budget (about 9.4 km/s to low Earth orbit). Optimal split checked by brute force.
- **Orbit transfer (Aerospace).** Choose the burn to move between circular orbits (Hohmann transfer) or the phasing angle for a rendezvous. Vis-viva `v = sqrt(mu (2/r - 1/a))`, transfer time `pi sqrt(a^3/mu)`, lead angle `pi (1 - sqrt(((r1 + r2)/(2 r2))^3))`; checked against a numerical two-body integration.
- **Aircraft balance (Aerospace).** Place fuel and cargo so the centre of gravity lands inside the safe range of the mean chord, with the tail load needed to trim. Moment balance about the centre of gravity and static margin `(x_np - x_cg)/c`.

Each of these is 2D or 3D to suit it; circuits and filters are diagrams with animated scope traces, the rest are 3D scenes using the existing stage.

### 3.8 Results screen: you against everyone

After the fifth puzzle: a histogram of today's totals with your score marked and the mean line, "you scored higher than X% of N players", and a per-puzzle bar pair (you against the average). With too few players (under 10) the graph still shows, labelled with the player count. If the backend cannot be reached the screen shows your own results and says the comparison is unavailable.

## 4. Testing ("all the calculations check out")

- **Independent checks for every model**, not just self-consistency: exact slider-crank kinematics differentiated numerically against the series used (engine); method of joints and the Euler formula (truss); numerical integration of buoyancy for a box hull (barge); nodal solution against series/parallel formulas (circuit); time-domain simulation against `1 - e^(-t/RC)` (filter); two-body integration against Hohmann formulas (orbit); brute-force search against the closed form (rocket staging).
- **Generator property tests** over a thousand seeds per puzzle: every generated puzzle is solvable, the starting state is not already solved, and the checker accepts every valid answer and rejects near misses.
- **Scoring and timer tests**: the guess and time table, par boundary, floor, pause while hidden, reload persistence.
- **Daily selection tests**: five distinct puzzles, at most two per discipline, recent days skipped, same date gives the same set, and a long run of dates uses every puzzle in the pool.
- **Browser tests** for each puzzle's solve path, timer display, no hint text anywhere, the results graph with the stats service mocked, offline fallback, dark and light, Low CPU, no WebGL, phone width.

## 5. Build order (each step pushed and tested before the next)

1. Bridge physics.
2. Puzzle registry, daily selection, timer and scoring, hints removed, store version 2 (existing saved progress is reset: Engineerle launched today and the five puzzles for today change).
3. Crankshaft.
4. Electrical and Electronics puzzles.
5. Aerospace puzzles.
6. Gear train.
7. Stats backend and the results graph (after the decision in section 2).
8. README, final full verification.
