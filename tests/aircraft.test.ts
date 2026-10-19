import assert from 'node:assert/strict';
import { G, SM_MIN, SM_MAX, totalMass, cgPosition, staticMargin, tailLoad, evaluate, solvePlacements, makeAircraft, type AircraftSpec } from '@/engineerle/aircraft';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);

/** A hand-built aircraft whose numbers are easy to check: datum at the nose, x aft in metres. */
const plane = (o: Partial<AircraftSpec> = {}): AircraftSpec => ({
  kind: 'aircraft', emptyMass: 1000, emptyCg: 2.95, xNp: 3.2, xAc: 2.9, mac: 1.5, xTail: 6.4, tailLimit: 2000,
  items: [
    { name: 'front seats', mass: 160, min: 2.0, max: 2.6, start: 2.0 },
    { name: 'baggage', mass: 80, min: 3.4, max: 4.4, start: 4.4 },
    { name: 'fuel', mass: 120, min: 2.4, max: 3.4, start: 3.4 },
  ],
  ...o,
});

console.log('Aircraft: centre of gravity (Raymer, Aircraft Design: A Conceptual Approach, ch. 16; Nelson, Flight Stability and Automatic Control)');
test('two 100 kg masses at 2 m and 4 m put the CG at 3 m', () => {
  const s = plane({ emptyMass: 0, emptyCg: 0, items: [{ name: 'a', mass: 100, min: 0, max: 9, start: 2 }, { name: 'b', mass: 100, min: 0, max: 9, start: 4 }] });
  near(cgPosition(s, [2, 4]), 3, 1e-12);
});
test('moving a 50 kg item 1 m aft moves the CG by 50 / total mass', () => {
  const s = plane({ items: [{ name: 'a', mass: 50, min: 0, max: 9, start: 2 }, { name: 'b', mass: 300, min: 0, max: 9, start: 3 }] });
  const before = cgPosition(s, [2, 3]), after = cgPosition(s, [3, 3]);
  near(after - before, 50 / totalMass(s), 1e-12);
});
test('the total mass is the empty mass plus every item', () => { near(totalMass(plane()), 1000 + 160 + 80 + 120, 1e-12); });

console.log('Aircraft: static margin and the tail load');
test('static margin = (x_np - x_cg) / mac: 3.2, 3.0 and 2.0 give 0.1', () => { near(staticMargin(plane({ xNp: 3.2, mac: 2 }), 3.0), 0.1, 1e-12); });
test('a CG ahead of the neutral point is stable (positive), behind it unstable (negative)', () => { assert.ok(staticMargin(plane(), 3.0) > 0 && staticMargin(plane(), 3.4) < 0); });
test('moment balance in level flight: tailLoad * (xcg - xTail) + wingLift * (xcg - xAc) = 0 with lift = weight - tail load', () => {
  for (const xcg of [2.4, 2.9, 3.0, 3.25, 3.6]) {
    const s = plane(), W = totalMass(s) * G, T = tailLoad(s, xcg), L = W - T;
    near(T * (xcg - s.xTail) + L * (xcg - s.xAc), 0, 1e-9 * W, `xcg ${xcg}`);
  }
});
test('with the CG on the wing aerodynamic centre the tail carries nothing; aft of it the tail lifts, forward of it the tail pushes down', () => {
  const s = plane();
  near(tailLoad(s, s.xAc), 0, 1e-9);
  assert.ok(tailLoad(s, s.xAc + 0.2) > 0 && tailLoad(s, s.xAc - 0.2) < 0);
});

console.log('Aircraft: judging a loading');
test('a loading inside the static-margin band and inside the tail limit solves', () => {
  const s = plane({ xNp: 3.2, xAc: 2.9, mac: 1.5 });
  // choose the CG at a static margin of 12% of mac, between the limits
  const target = s.xNp - 0.12 * s.mac;
  const sol = solvePlacements(s)!; assert.ok(sol, 'a solution exists');
  const e = evaluate(s, sol); assert.equal(e.solved, true);
  assert.ok(e.sm! >= SM_MIN && e.sm! <= SM_MAX); assert.ok(Math.abs(e.tail!) <= s.tailLimit);
  void target;
});
test('the CG forward of the band (too stable) and aft of the band (too close to the neutral point) do not solve', () => {
  // one heavy item on a long rail so the CG can be put anywhere
  const s = plane({ tailLimit: 1e9, items: [{ name: 'ballast', mass: 400, min: 1.0, max: 6.0, start: 1.0 }] });
  const fwd = evaluate(s, [1.0]); // CG 2.39 m: static margin 54 %
  const aft = evaluate(s, [3.65]); // CG 3.15 m: static margin 3.3 %
  near(fwd.sm!, (3.2 - 2.95 * 1000 / 1400 - 400 / 1400) / 1.5, 1e-9);
  assert.ok(fwd.sm! > SM_MAX && aft.sm! > 0 && aft.sm! < SM_MIN, `${fwd.sm} ${aft.sm}`);
  assert.equal(fwd.solved, false); assert.equal(aft.solved, false);
  assert.equal(fwd.outcome, 'too-stable'); assert.equal(aft.outcome, 'marginal');
  assert.equal(evaluate(s, [3.0]).solved, true); // CG 2.96... inside the band
});
test('a CG behind the neutral point is unstable and reported so', () => {
  const s = plane({ xNp: 2.7, tailLimit: 1e9 });
  const e = evaluate(s, [2.6, 4.4, 3.4]); assert.ok(e.sm! < 0, `sm ${e.sm}`); assert.equal(e.outcome, 'unstable'); assert.equal(e.solved, false);
});
test('a tail asked for more than its limit pitches the aircraft over, even with a good static margin', () => {
  const s = plane({ tailLimit: 50 });
  const e = evaluate(s, [2.6, 4.4, 3.4]);
  assert.ok(e.sm! >= SM_MIN && e.sm! <= SM_MAX, `sm ${e.sm}`);
  assert.equal(e.tailOk, false); assert.equal(e.solved, false); assert.ok(e.outcome === 'nose-up' || e.outcome === 'nose-down');
});
test('evaluate refuses wrong-length, non-finite, non-numeric and out-of-station placements without judging them', () => {
  const s = plane();
  for (const p of [[], [2.0, 3.4], [2.0, 3.4, 2.4, 1], [NaN, 3.4, 2.4], [2.0, Infinity, 2.4], [1.9, 3.4, 2.4], [2.0, 4.5, 2.4], [2.0, 3.4, 3.5], ['2' as unknown as number, 3.4, 2.4], [undefined as unknown as number, 3.4, 2.4], null as unknown as number[]]) {
    const e = evaluate(s, p); assert.ok(e.refused, `refused ${JSON.stringify(p)}`); assert.equal(e.solved, false);
  }
});
test('a placement exactly on a station limit is accepted', () => { assert.equal(evaluate(plane(), [2.0, 4.4, 3.4]).refused, undefined); });

console.log('Aircraft: the generator');
test('over 1000 seeds: 3 or 4 items, sound geometry, a solving placement exists and the starting placement does not', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const s = makeAircraft(seed);
    assert.ok(s.items.length >= 3 && s.items.length <= 4, `seed ${seed} items`);
    assert.ok(s.xNp > s.xAc && s.xTail > s.xNp && s.mac > 0 && s.emptyMass > 0 && s.tailLimit > 0, `seed ${seed} geometry`);
    for (const it of s.items) assert.ok(it.mass > 0 && it.min < it.max && it.start >= it.min && it.start <= it.max, `seed ${seed} item ${it.name}`);
    const start = evaluate(s, s.items.map((i) => i.start));
    assert.equal(start.refused, undefined); assert.equal(start.solved, false, `seed ${seed}: the start must not solve`);
    const sol = solvePlacements(s);
    assert.ok(sol, `seed ${seed}: no solving placement`);
    assert.equal(evaluate(s, sol!).solved, true, `seed ${seed}: solution does not solve`);
  }
});
test('the generator is deterministic and varies', () => {
  assert.deepEqual(makeAircraft(9), makeAircraft(9));
  assert.ok(new Set(Array.from({ length: 30 }, (_, i) => makeAircraft(i + 1).emptyMass)).size > 5);
});

console.log(`\n${passed} passed`);
