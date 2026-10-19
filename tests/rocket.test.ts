import assert from 'node:assert/strict';
import { G0, deltaV, twoStageDeltaV, bestSplit, makeRocket, evaluate, stageBreakdown, type RocketSpec } from '@/engineerle/rocket';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);

const spec = (o: Partial<RocketSpec> = {}): RocketSpec => ({ kind: 'rocket', propellant: 100_000, sigma1: 0.1, sigma2: 0.1, isp1: 300, isp2: 300, payload: 2000, required: 9400, ...o });

console.log('Rocket: the Tsiolkovsky equation (Sutton and Biblarz; Wertz and Larson)');
test('g0 is the standard 9.80665 m/s^2', () => { assert.equal(G0, 9.80665); });
test('a mass ratio of e gives exactly Isp * g0', () => { near(deltaV(300, Math.E, 1), 300 * 9.80665, 1e-9); });
test('doubling the mass ratio adds Isp * g0 * ln 2', () => {
  near(deltaV(320, 8, 1) - deltaV(320, 4, 1), 320 * 9.80665 * Math.LN2, 1e-9);
  near(deltaV(450, 10, 1) - deltaV(450, 5, 1), 450 * 9.80665 * Math.LN2, 1e-9);
});
test('no propellant burned gives zero delta-v', () => { near(deltaV(300, 5, 5), 0, 1e-12); });

console.log('Rocket: two stages');
test('a split of 1 (no stage-2 propellant) is the single-stage rocket equation', () => {
  const s = spec({ payload: 1500 });
  const p = s.propellant, sig = s.sigma1;
  near(twoStageDeltaV(s, 1), deltaV(s.isp1, s.payload + (1 + sig) * p, s.payload + sig * p), 1e-9);
});
test('a split of 0 (no stage-1 propellant) is the stage-2 burn alone', () => {
  const s = spec({ isp2: 420, payload: 1500 });
  near(twoStageDeltaV(s, 0), deltaV(s.isp2, s.payload + (1 + s.sigma2) * s.propellant, s.payload + s.sigma2 * s.propellant), 1e-9);
});
test('the stage breakdown adds up and the stage-1 mass includes the whole upper stage', () => {
  const s = spec({ isp1: 290, isp2: 400, sigma1: 0.09, sigma2: 0.11, payload: 1800 });
  const b = stageBreakdown(s, 0.8);
  near(b.dv1 + b.dv2, twoStageDeltaV(s, 0.8), 1e-9);
  near(b.m0_1, s.payload + (1.11) * 0.2 * s.propellant + 1.09 * 0.8 * s.propellant, 1e-6);
  near(b.mf_1, b.m0_1 - 0.8 * s.propellant, 1e-6);
  near(b.m0_2, s.payload + 1.11 * 0.2 * s.propellant, 1e-6);
  near(b.mf_2, s.payload + 0.11 * 0.2 * s.propellant, 1e-6);
});
test('identical stages and Isp: the best split matches the closed form 1 / (1 + sqrt(payload / M0)) and gives equal stage delta-v', () => {
  for (const [payload, sigma, prop] of [[2000, 0.1, 100_000], [500, 0.08, 60_000], [5000, 0.12, 300_000]] as const) {
    const s = spec({ payload, sigma1: sigma, sigma2: sigma, propellant: prop });
    const m0 = payload + (1 + sigma) * prop;
    const closed = 1 / (1 + Math.sqrt(payload / m0));
    const { split } = bestSplit(s);
    near(split, closed, 0.005, `payload ${payload}`);
    const b = stageBreakdown(s, closed);
    near(b.dv1, b.dv2, 1, 'equal stage delta-v at the optimum');
  }
});
test('brute force over 10000 splits never beats bestSplit by more than 1 m/s', () => {
  for (const s of [spec(), spec({ isp1: 285, isp2: 440, sigma1: 0.12, sigma2: 0.08, payload: 3000 }), spec({ isp1: 335, isp2: 340, payload: 800, propellant: 250_000 })]) {
    const { dv } = bestSplit(s);
    let best = 0;
    for (let i = 0; i <= 10_000; i++) best = Math.max(best, twoStageDeltaV(s, i / 10_000));
    assert.ok(best - dv <= 1, `brute ${best} vs ${dv}`);
  }
});
test('evaluate refuses a split outside 0..1, NaN, infinite or not a number, without testing it', () => {
  const s = spec();
  for (const x of [-0.01, 1.01, NaN, Infinity, -Infinity, 5, -1, undefined as unknown as number, '0.8' as unknown as number]) {
    const e = evaluate(s, x); assert.ok(e.refused, `refused ${String(x)}`); assert.equal(e.solved, false);
  }
  assert.ok(!evaluate(s, 0).refused && !evaluate(s, 1).refused);
});
test('evaluate is solved exactly when the delta-v meets the requirement, and a range of splits wins', () => {
  const s = makeRocket(3);
  let wins = 0;
  for (let i = 0; i <= 100; i++) {
    const e = evaluate(s, i / 100);
    assert.equal(e.solved, twoStageDeltaV(s, i / 100) >= s.required);
    near(e.shortfall!, Math.max(0, s.required - e.dv!), 1e-9);
    if (e.solved) wins++;
  }
  assert.ok(wins >= 3, `${wins} winning splits`);
});

console.log('Rocket: the generator');
test('over 1000 seeds: realistic numbers, best split clears the requirement by 50 m/s, 0.05 and 0.95 never solve', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const s = makeRocket(seed);
    assert.ok(s.required >= 9300 && s.required <= 9600, `seed ${seed} required ${s.required}`);
    assert.ok(s.sigma1 >= 0.08 && s.sigma1 <= 0.12 && s.sigma2 >= 0.08 && s.sigma2 <= 0.12, `seed ${seed} sigma`);
    assert.ok(s.isp1 >= 280 && s.isp1 <= 340 && s.isp2 >= 330 && s.isp2 <= 460, `seed ${seed} isp`);
    assert.ok(s.payload > 0 && s.propellant > s.payload * 5, `seed ${seed} masses`);
    const best = bestSplit(s);
    assert.ok(best.dv >= s.required + 50, `seed ${seed}: best ${best.dv} required ${s.required}`);
    assert.equal(evaluate(s, 0.05).solved, false, `seed ${seed}: 0.05`);
    assert.equal(evaluate(s, 0.95).solved, false, `seed ${seed}: 0.95`);
    assert.equal(evaluate(s, 0.5).solved, twoStageDeltaV(s, 0.5) >= s.required);
    let n = 0;
    for (let i = 5; i <= 95; i++) if (evaluate(s, i / 100).solved) n++;
    assert.ok(n >= 3, `seed ${seed}: only ${n} winning slider positions`);
  }
});
test('the generator is deterministic and varies', () => {
  assert.deepEqual(makeRocket(11), makeRocket(11));
  assert.ok(new Set(Array.from({ length: 40 }, (_, i) => makeRocket(i + 1).required)).size > 5);
});

console.log(`\n${passed} passed`);
