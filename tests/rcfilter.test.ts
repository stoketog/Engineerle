import assert from 'node:assert/strict';
import { cutoff, gainLow, gainHigh, phaseLow, phaseHigh, stepResponse, makeFilter, evaluate, R_VALUES, C_VALUES, dB, type FilterSpec } from '@/engineerle/rcfilter';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);

console.log('RC filter: the transfer function');
test('fc = 1 / (2 pi R C)', () => {
  near(cutoff(1000, 159.155e-9), 1000, 0.01);
  near(cutoff(10_000, 1e-6), 15.9155, 1e-3);
});
test('at the cutoff the gain is 1/sqrt(2) (-3.0103 dB) and the phase is -45 degrees (low) or +45 (high)', () => {
  near(gainLow(500, 500), 1 / Math.SQRT2, 1e-12); near(dB(gainLow(500, 500)), -3.0103, 1e-4);
  near(gainHigh(500, 500), 1 / Math.SQRT2, 1e-12);
  near(phaseLow(500, 500), -45, 1e-9); near(phaseHigh(500, 500), 45, 1e-9);
});
test('a decade above the cutoff a low-pass is down 20.04 dB; a decade below, a high-pass is', () => {
  near(dB(gainLow(10_000, 1000)), -20.0432, 0.01);
  near(dB(gainHigh(100, 1000)), -20.0432, 0.01);
  near(gainLow(0, 1000), 1, 1e-12); near(gainHigh(1e9, 1000), 1, 1e-9);
});
test('low-pass and high-pass gains are complementary: |HL|^2 + |HH|^2 = 1', () => {
  for (const f of [1, 30, 100, 999, 1000, 4000, 1e5]) near(gainLow(f, 1000) ** 2 + gainHigh(f, 1000) ** 2, 1, 1e-12);
});

console.log('RC filter: against a time-domain simulation');
/** dv/dt = (vin - v)/RC by RK4; returns the capacitor voltage at each step. */
function simulate(rc: number, vin: (t: number) => number, h: number, steps: number): number[] {
  const out: number[] = [0];
  let v = 0, t = 0;
  const f = (tt: number, vv: number) => (vin(tt) - vv) / rc;
  for (let i = 0; i < steps; i++) {
    const k1 = f(t, v), k2 = f(t + h / 2, v + (h / 2) * k1), k3 = f(t + h / 2, v + (h / 2) * k2), k4 = f(t + h, v + h * k3);
    v += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    t += h;
    out.push(v);
  }
  return out;
}
test('the steady-state amplitude of a sine at 10 fc matches gainLow within 0.5% (and gainHigh for the resistor voltage)', () => {
  for (const [r, c] of [[1000, 159.155e-9], [4700, 100e-9], [22_000, 10e-9]]) {
    const rc = r * c, fc = cutoff(r, c), f = 10 * fc, h = rc / 2000;
    const steps = Math.round((60 * rc) / h);
    const vin = (t: number) => Math.sin(2 * Math.PI * f * t);
    const v = simulate(rc, vin, h, steps);
    const tail = v.slice(Math.floor(v.length * 0.8));
    const ampLow = (Math.max(...tail) - Math.min(...tail)) / 2;
    near(ampLow / gainLow(f, fc), 1, 0.005, `low-pass R=${r} C=${c}`);
    const resistor = v.map((vc, i) => vin(i * h) - vc).slice(Math.floor(v.length * 0.8));
    const ampHigh = (Math.max(...resistor) - Math.min(...resistor)) / 2;
    near(ampHigh / gainHigh(f, fc), 1, 0.005, `high-pass R=${r} C=${c}`);
  }
});
test('the step response is 1 - e^(-t/RC): 63.212% after one time constant, and the simulation agrees to 1e-6', () => {
  near(stepResponse(1000, 1e-6, 1e-3), 0.63212, 1e-5);
  const r = 2200, c = 470e-9, rc = r * c, h = rc / 2000;
  const v = simulate(rc, () => 1, h, 6000);
  for (const k of [500, 2000, 4000, 6000]) near(v[k], stepResponse(r, c, k * h), 1e-6, `t=${k * h}`);
  near(stepResponse(r, c, 0), 0, 1e-15); assert.ok(stepResponse(r, c, 50 * rc) > 0.999999);
});

console.log('RC filter: checking a guess');
test('evaluate refuses zero, negative, NaN, infinite and enormous R or C (not a guess)', () => {
  const spec = makeFilter(4);
  for (const [r, c] of [[0, 1e-7], [-1000, 1e-7], [1000, 0], [1000, -1e-9], [NaN, 1e-7], [1000, NaN], [Infinity, 1e-7], [1000, Infinity], [1e12, 1e-7], [1000, 100]]) {
    const e = evaluate(spec, r, c);
    assert.equal(e.solved, false, `${r} ${c}`);
    assert.ok(typeof e.refused === 'string' && e.refused.length > 0, `refused ${r} ${c}`);
  }
  assert.equal(evaluate(spec, 1000, 1e-7).refused, undefined);
});
test('the dial lists are 100 ohm to 1 megohm (E24) and 1 nF to 10 uF', () => {
  assert.equal(R_VALUES[0], 100); assert.equal(R_VALUES[R_VALUES.length - 1], 1_000_000); assert.equal(R_VALUES.length, 4 * 24 + 1);
  assert.equal(C_VALUES[0], 1e-9); assert.equal(C_VALUES[C_VALUES.length - 1], 10e-6);
  assert.ok(R_VALUES.every((v, i) => i === 0 || v > R_VALUES[i - 1]) && C_VALUES.every((v, i) => i === 0 || v > C_VALUES[i - 1]));
});
test('every seed gives a filter that some (R, C) pair solves and the first dial position does not', () => {
  const kinds = new Set<string>();
  for (let s = 1; s <= 1000; s++) {
    const sp: FilterSpec = makeFilter(s * 4093);
    kinds.add(sp.type);
    const good: Array<[number, number]> = [];
    for (const r of R_VALUES) for (const c of C_VALUES) if (evaluate(sp, r, c).solved) good.push([r, c]);
    assert.ok(good.length >= 1, `seed ${s}: no solution`);
    assert.equal(evaluate(sp, R_VALUES[0], C_VALUES[0]).solved, false, `seed ${s}: first dial position solves`);
    assert.ok(sp.fWanted >= 20 && sp.fWanted <= 50_000 && sp.fNoise >= 20 && sp.fNoise <= 50_000, `frequencies ${sp.fWanted} ${sp.fNoise}`);
    if (sp.type === 'low') assert.ok(sp.fNoise > sp.fWanted); else assert.ok(sp.fNoise < sp.fWanted);
  }
  assert.deepEqual([...kinds].sort(), ['high', 'low']);
});

console.log(`\n${passed} passed`);
