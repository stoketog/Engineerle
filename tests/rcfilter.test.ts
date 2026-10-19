import assert from 'node:assert/strict';
import { cutoff, gainLow, gainHigh, phaseLow, phaseHigh, toDb, stepResponse, evaluate, makeFilter, bestPair, R_VALUES, C_VALUES, type FilterSpec } from '@/engineerle/rcfilter';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const pairs = () => R_VALUES.flatMap((r) => C_VALUES.map((c) => [r, c] as const));

/** Classical fourth-order Runge-Kutta for the capacitor voltage: dv/dt = (vin(t) - v)/(RC). Independent of the formulas under test. */
function rk4Capacitor(rc: number, vin: (t: number) => number, h: number, steps: number, onStep: (t: number, v: number) => void) {
  let v = 0;
  const f = (t: number, x: number) => (vin(t) - x) / rc;
  for (let i = 0; i < steps; i++) {
    const t = i * h;
    onStep(t, v);
    const k1 = f(t, v), k2 = f(t + h / 2, v + (h / 2) * k1), k3 = f(t + h / 2, v + (h / 2) * k2), k4 = f(t + h, v + h * k3);
    v += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  }
  return v;
}
/** Steady-state amplitude and phase (degrees) of the output of the sine response, by quadrature correlation over whole periods. */
function steady(r: number, c: number, f: number, high: boolean) {
  const rc = r * c, period = 1 / f, perPeriod = Math.ceil(period / (rc / 2000)), h = period / perPeriod;
  const settle = Math.ceil((30 * rc) / period), measure = 10;
  let I = 0, Q = 0;
  rk4Capacitor(rc, (t) => Math.sin(2 * Math.PI * f * t), h, (settle + measure) * perPeriod, (t, v) => {
    if (t < settle * period - 1e-12) return;
    const out = high ? Math.sin(2 * Math.PI * f * t) - v : v;
    I += out * Math.sin(2 * Math.PI * f * t) * h; Q += out * Math.cos(2 * Math.PI * f * t) * h;
  });
  const T = measure * period;
  I *= 2 / T; Q *= 2 / T;
  return { amp: Math.hypot(I, Q), phase: (Math.atan2(Q, I) * 180) / Math.PI };
}

console.log('RC filter against the textbook (Hambley; Horowitz and Hill)');
test('the cutoff of 1 kΩ and 159.155 nF is 1 kHz: fc = 1/(2πRC)', () => near(cutoff(1000, 159.155e-9), 1000, 0.01));
test('at the cutoff a low-pass gives 1/√2, which is −3.0103 dB, and lags by 45°', () => {
  near(gainLow(1000, 1000), 1 / Math.SQRT2, 1e-12); near(toDb(gainLow(1000, 1000)), -3.0103, 1e-4); near(phaseLow(1000, 1000), -45, 1e-9);
});
test('a decade above the cutoff a low-pass is down 20.04 dB and a high-pass is within 0.05 dB of unity at ten times fc', () => {
  near(toDb(gainLow(10_000, 1000)), -20.04, 0.01);
  near(toDb(gainHigh(10_000, 1000)), -0.0432, 1e-3);
  near(toDb(gainHigh(100, 1000)), -20.04, 0.01);
});
test('a high-pass is also −3.0103 dB at the cutoff and leads by 45°; the two filters are complementary: |HL|² + |HH|² = 1', () => {
  near(toDb(gainHigh(500, 500)), -3.0103, 1e-4); near(phaseHigh(500, 500), 45, 1e-9);
  for (const f of [3, 40, 500, 7000, 1e5]) near(gainLow(f, 500) ** 2 + gainHigh(f, 500) ** 2, 1, 1e-12);
});
test('low-pass gain and phase agree with a numerical (RK4) simulation of the circuit at 10 fc, fc and fc/10', () => {
  const r = 4700, c = 33e-9, fc = cutoff(r, c);
  for (const k of [10, 1, 0.1]) {
    const s = steady(r, c, k * fc, false);
    near(s.amp / gainLow(k * fc, fc), 1, 0.005, `amp at ${k} fc`);
    near(s.phase, phaseLow(k * fc, fc), 0.3, `phase at ${k} fc`);
  }
});
test('high-pass gain and phase (output across the resistor) agree with the RK4 simulation too', () => {
  const r = 10_000, c = 100e-9, fc = cutoff(r, c);
  for (const k of [10, 1, 0.1]) {
    const s = steady(r, c, k * fc, true);
    near(s.amp / gainHigh(k * fc, fc), 1, 0.005, `amp at ${k} fc`);
    near(s.phase, phaseHigh(k * fc, fc), 0.3, `phase at ${k} fc`);
  }
});
test('after one time constant a charging capacitor is at 63.212% and this agrees with RK4 to 1e-6', () => {
  near(stepResponse(1000, 1e-6, 1e-3), 0.63212, 1e-5);
  const rc = 1000 * 1e-6; const h = rc / 2000;
  const v = rk4Capacitor(rc, () => 1, h, 2000, () => {});
  near(v, stepResponse(1000, 1e-6, rc), 1e-6);
  assert.equal(stepResponse(1000, 1e-6, 0), 0);
});

console.log('The dials');
test('R runs over the E24 values from 100 Ω to 1 MΩ and C from 1 nF to 10 µF, both ascending', () => {
  assert.equal(R_VALUES[0], 100); assert.equal(R_VALUES[R_VALUES.length - 1], 1e6); assert.ok(R_VALUES.every((v, i) => i === 0 || v > R_VALUES[i - 1]));
  assert.equal(C_VALUES[0], 1e-9); assert.equal(C_VALUES[C_VALUES.length - 1], 10e-6); assert.ok(C_VALUES.every((v, i) => i === 0 || v > C_VALUES[i - 1]));
});

console.log('Judging a choice');
const lp: FilterSpec = { kind: 'rcfilter', type: 'low', fSignal: 1000, fNoise: 20_000, maxLossDb: 1, minCutDb: 20 };
test('a low-pass is judged by the signal loss and the noise cut at the real transfer function', () => {
  const e = evaluate(lp, 1000, 47e-9);                          // fc = 3.386 kHz: signal -0.36 dB, noise -15.5 dB
  near(e.fc, 1 / (2 * Math.PI * 1000 * 47e-9), 1e-9);
  near(e.signalDb, toDb(gainLow(1000, e.fc)), 1e-12); near(e.noiseDb, toDb(gainLow(20_000, e.fc)), 1e-12);
  assert.equal(e.solved, false);
  assert.ok(evaluate(lp, 1000, 33e-9).fc > 4000 && !evaluate(lp, 1000, 33e-9).solved);
  assert.equal(evaluate(lp, 4700, 10e-9).solved, false);        // fc 3386 Hz again, other R/C, same verdict
  assert.equal(evaluate(lp, 1000, 1e-6).solved, false);         // fc 159 Hz kills the signal
});
test('a good low-pass passes: fc = 4.7 kHz keeps the 1 kHz tone within 1 dB and takes the 20 kHz noise down more than 12 dB, but 20 dB needs fc below 2 kHz', () => {
  const loose = { ...lp, minCutDb: 12 };
  assert.equal(evaluate(loose, 3300, 10e-9).solved, true);       // fc = 4.82 kHz
  assert.equal(evaluate(lp, 3300, 10e-9).solved, false);
  assert.equal(evaluate(lp, 6800, 15e-9).solved, false);         // fc = 1.56 kHz: the signal loses 1.5 dB
});
test('a high-pass keeps the high signal and cuts the low hum', () => {
  const hp: FilterSpec = { kind: 'rcfilter', type: 'high', fSignal: 2000, fNoise: 50, maxLossDb: 1, minCutDb: 20 };
  const e = evaluate(hp, 10_000, 220e-9);                        // fc = 72.3 Hz: signal -0.0, hum -4.7 dB
  near(e.signalDb, toDb(gainHigh(2000, e.fc)), 1e-12); near(e.noiseDb, toDb(gainHigh(50, e.fc)), 1e-12);
  assert.equal(e.solved, false);
  assert.equal(evaluate(hp, 10_000, 4.7e-9).fc > 3000, true);
  assert.equal(evaluate(hp, 33_000, 100e-9).solved, false);      // fc 48 Hz: hum barely cut
  assert.equal(evaluate(hp, 1000, 4.7e-6).solved, false);        // fc 33 Hz
  assert.equal(evaluate(hp, 2000, 100e-9).solved, true);         // fc 796 Hz: signal -0.64 dB, hum -24.0 dB
  assert.equal(evaluate(hp, 5000, 100e-9).solved, false);        // fc 318 Hz: hum only -16.2 dB
  assert.equal(evaluate(hp, 1000, 100e-9).solved, false);        // fc 1592 Hz: hum -30 dB but the signal loses 2.1 dB
  assert.equal(evaluate({ ...hp, maxLossDb: 3 }, 1000, 100e-9).solved, true);
});
test('a zero, negative or non-finite R or C is refused and is not a guess', () => {
  for (const [r, c] of [[0, 1e-6], [1000, 0], [-5, 1e-6], [1000, -1e-9], [NaN, 1e-6], [1000, Infinity]]) assert.ok(evaluate(lp, r, c).refused, `${r} ${c}`);
});

console.log('Generator');
test('over 1000 seeds there is a satisfying R and C in the dials, the first dial position does not satisfy it, and no choice is borderline', () => {
  const counts: Record<string, number> = { low: 0, high: 0 };
  for (let seed = 1; seed <= 1000; seed++) {
    const sp = makeFilter(seed); counts[sp.type]++;
    assert.equal(sp.kind, 'rcfilter');
    assert.ok([1, 2, 3].includes(sp.maxLossDb) && [12, 15, 20, 26, 30].includes(sp.minCutDb), `limits ${sp.maxLossDb} ${sp.minCutDb}`);
    if (sp.type === 'low') assert.ok(sp.fNoise > sp.fSignal * 7.9, `seed ${seed} noise must be well above the signal`);
    else assert.ok(sp.fSignal > sp.fNoise * 7.9, `seed ${seed} signal must be well above the hum`);
    assert.ok(sp.fSignal >= 20 && sp.fSignal <= 20_000 && sp.fNoise >= 20 && sp.fNoise <= 200_000, `freqs ${sp.fSignal} ${sp.fNoise}`);
    const good = pairs().filter(([r, c]) => evaluate(sp, r, c).solved);
    assert.ok(good.length >= 1, `seed ${seed}: nothing in the dials solves it`);
    assert.equal(evaluate(sp, R_VALUES[0], C_VALUES[0]).solved, false, `seed ${seed}: first dial position solves`);
    for (const [r, c] of pairs()) { const e = evaluate(sp, r, c); assert.ok(Math.abs(-e.signalDb - sp.maxLossDb) > 0.02 && Math.abs(-e.noiseDb - sp.minCutDb) > 0.02, `seed ${seed} ${r} ${c}: borderline`); }
    const [br, bc] = bestPair(sp); assert.ok(evaluate(sp, br, bc).solved, `seed ${seed}: bestPair`);
  }
  assert.ok(counts.low > 300 && counts.high > 300, `both kinds appear ${JSON.stringify(counts)}`);
});
test('the same seed gives the same puzzle', () => assert.deepEqual(makeFilter(11), makeFilter(11)));

console.log(`\n${passed} passed`);
