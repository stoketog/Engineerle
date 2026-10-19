import assert from 'node:assert/strict';
import { throwAngles, residuals, bestResiduals, evaluate, makeCrankshaft, pistonAcceleration, type CrankshaftSpec } from '@/engineerle/crankshaft';
import { rng } from '@/engineerle/rand';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const spec = (n: 3 | 4 | 5 | 6, lambda = 0.25): CrankshaftSpec => ({ kind: 'crankshaft', n, lambda, pitch: 1, mass: 1 });
const identity = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const perms = (n: number): number[][] => {
  const out: number[][] = [];
  const rec = (cur: number[], rest: number[]) => { if (!rest.length) { out.push(cur); return; } rest.forEach((x, i) => rec([...cur, x], rest.filter((_, j) => j !== i))); };
  rec([1], identity(n).slice(1));
  return out;
};

console.log('Firing order to crank throws (four-stroke: the cycle takes 720 degrees)');
test('throw angle of the cylinder in firing slot s is (720 s / n) mod 360', () => {
  assert.deepEqual(throwAngles([1, 3, 4, 2]), [0, 180, 180, 0]);
  assert.deepEqual(throwAngles([1, 5, 3, 6, 2, 4]), [0, 120, 240, 240, 120, 0]);
  assert.deepEqual(throwAngles([1, 2, 4, 5, 3]), [0, 144, 216, 288, 72]);
  assert.deepEqual(throwAngles([1, 2, 3]), [0, 240, 120]);
});
test('whatever the order, the cylinders fire at even 720/n intervals', () => {
  for (const n of [3, 4, 5, 6]) for (const o of perms(n)) {
    const fire = o.map((c, s) => ({ c, a: (720 * s) / n }));
    fire.forEach((f, s) => near(f.a, (720 * s) / n, 1e-12));
    const gaps = fire.map((f, s) => (fire[(s + 1) % n].a - f.a + 720) % 720);
    gaps.forEach((g) => near(g, 720 / n, 1e-9, `${o}`));
  }
});

console.log('Textbook balance of in-line engines');
test('in-line 6, 1-5-3-6-2-4: all four residuals vanish; 1-2-3-4-5-6 rocks end to end', () => {
  const r = residuals(spec(6), [1, 5, 3, 6, 2, 4]);
  for (const v of Object.values(r)) assert.ok(v < 1e-9, JSON.stringify(r));
  assert.ok(residuals(spec(6), identity(6)).primaryCouple > 1);
});
test('in-line 4, 1-3-4-2: primary balanced, secondary force 4 lambda; 1-2-3-4 has primary couple 2', () => {
  const r = residuals(spec(4), [1, 3, 4, 2]);
  assert.ok(r.primaryForce < 1e-9 && r.primaryCouple < 1e-9 && r.secondaryCouple < 1e-9, JSON.stringify(r));
  near(r.secondaryForce, 4 * 0.25, 1e-9);
  near(residuals(spec(4, 0.3), [1, 3, 4, 2]).secondaryForce, 4 * 0.3, 1e-9);
  near(residuals(spec(4), identity(4)).primaryCouple, 2, 1e-9);
});
test('in-line 5, 1-2-4-5-3: forces balance, couples do not (and are the least of any order)', () => {
  const r = residuals(spec(5), [1, 2, 4, 5, 3]);
  assert.ok(r.primaryForce < 1e-9 && r.secondaryForce < 1e-9, JSON.stringify(r));
  assert.ok(r.primaryCouple > 0.4 && r.secondaryCouple > 0.1, JSON.stringify(r));
  const least = Math.min(...perms(5).map((o) => residuals(spec(5), o).primaryCouple));
  near(r.primaryCouple, least, 1e-9);
});
test('in-line 3: forces balance, a primary couple remains', () => {
  const r = residuals(spec(3), [1, 2, 3]);
  assert.ok(r.primaryForce < 1e-9 && r.secondaryForce < 1e-9 && r.primaryCouple > 1, JSON.stringify(r));
});
test('couples scale with the cylinder pitch', () => {
  near(residuals({ ...spec(4), pitch: 2.5 }, identity(4)).primaryCouple, 5, 1e-9);
});

console.log('Checked against the real slider-crank motion');
test('pistonAcceleration is the exact second derivative of x = r cos t + sqrt(l^2 - r^2 sin^2 t)', () => {
  const x = (r: number, l: number, t: number) => r * Math.cos(t) + Math.sqrt(l * l - r * r * Math.sin(t) ** 2);
  const h = 1e-4;
  for (const [r, l] of [[1, 4], [1, 3.2], [0.045, 0.15]]) for (let k = 0; k < 24; k++) {
    const t = (k * Math.PI) / 12 + 0.07;
    const fd = (x(r, l, t + h) - 2 * x(r, l, t) + x(r, l, t - h)) / (h * h);
    near(pistonAcceleration(r, l, t), fd, 2e-5 * Math.max(1, r), `r=${r} l=${l} t=${t}`);
  }
  near(pistonAcceleration(1, 4, 0), -(1 + 1 / 4) * 1 - 0, 0.03); // top dead centre: about -(1 + lambda)
});
function dft(f: (t: number) => number, harmonic: number, N = 4096) {
  let re = 0, im = 0;
  for (let k = 0; k < N; k++) { const t = (2 * Math.PI * k) / N, v = f(t); re += v * Math.cos(harmonic * t); im += v * Math.sin(harmonic * t); }
  return Math.hypot(re, im) * (2 / N);
}
test('summing real piston accelerations around the crank gives the primary and secondary vector sums', () => {
  const r = rng(77);
  for (let trial = 0; trial < 40; trial++) {
    const n = (3 + Math.floor(r() * 4)) as 3 | 4 | 5 | 6;
    const lambda = 0.2 + r() * 0.15;
    const l = 1 / lambda;
    const order = identity(n).slice(1).sort(() => r() - 0.5);
    order.unshift(1);
    const phi = throwAngles(order).map((d) => (d * Math.PI) / 180);
    const s = spec(n, lambda);
    const res = residuals(s, order);
    const z = (i: number) => i - (n - 1) / 2;
    // force: sum over cylinders of the true acceleration, each at its own throw angle
    const F = (t: number) => phi.reduce((sum, p) => sum + pistonAcceleration(1, l, t + p), 0);
    const C = (t: number) => phi.reduce((sum, p, i) => sum + z(i) * pistonAcceleration(1, l, t + p), 0);
    // the first harmonic of a piston is exactly r; the second is lambda plus a small correction from the next term of the series
    const c1 = dft((t) => pistonAcceleration(1, l, t), 1), c2 = dft((t) => pistonAcceleration(1, l, t), 2);
    near(c1, 1, 1e-9, 'first harmonic of one piston');
    assert.ok(c2 >= lambda && c2 <= lambda * (1 + lambda * lambda / 4 * 1.2), `c2 ${c2} vs lambda ${lambda}`);
    near(dft(F, 1), res.primaryForce, 1e-9, `primary force n=${n} ${order}`);
    near(dft(C, 1), res.primaryCouple, 1e-9, `primary couple n=${n} ${order}`);
    near(dft(F, 2), (c2 / lambda) * res.secondaryForce, 1e-9, `secondary force n=${n} ${order}`);
    near(dft(C, 2), (c2 / lambda) * res.secondaryCouple, 1e-9, `secondary couple n=${n} ${order}`);
    // and the textbook secondary (lambda only) is within the series remainder
    assert.ok(Math.abs(dft(F, 2) - res.secondaryForce) <= n * lambda ** 3 / 4 * 1.2 + 1e-9, `textbook secondary force n=${n}`);
  }
});

console.log('Best order and the puzzle');
const key = (o: number[]) => o.join('-');
test('bestResiduals finds the textbook orders and rejects the rest', () => {
  const b4 = bestResiduals(spec(4)).orders.map(key);
  assert.ok(b4.includes('1-3-4-2') && b4.includes('1-2-4-3') && !b4.includes('1-2-3-4'), b4.join());
  const b6 = bestResiduals(spec(6)).orders.map(key);
  assert.ok(b6.includes('1-5-3-6-2-4') && b6.includes('1-4-2-6-3-5') && !b6.includes('1-2-3-4-5-6'), b6.join());
  const b5 = bestResiduals(spec(5)).orders.map(key);
  assert.ok(b5.includes('1-2-4-5-3') && b5.includes('1-3-5-4-2'), b5.join());
  assert.equal(bestResiduals(spec(5)).orders.length, 2);
});
test('an order solves exactly when its primary couple is as low as any order can make it (independent brute force)', () => {
  for (const n of [4, 5, 6] as const) {
    const s = spec(n), all = perms(n);
    const pcs = all.map((o) => residuals(s, o).primaryCouple);
    const least = Math.min(...pcs), worst = Math.max(...pcs);
    const tol = Math.max(0.02, 0.02 * worst);
    all.forEach((o, i) => assert.equal(evaluate(s, o).solved, pcs[i] <= least + tol, `n=${n} ${key(o)} pc=${pcs[i]}`));
    assert.equal(evaluate(s, all[0]).solved, pcs[0] <= least + tol);
  }
});
test('evaluate refuses anything that is not a firing order and says so', () => {
  const s = spec(4);
  for (const bad of [[1, 1, 2, 3], [1, 2, 3], [1, 2, 3, 5], [1, 2.5, 3, 4], [0, 1, 2, 3], [1, 2, 3, 4, 5], [], null as unknown as number[]]) {
    const e = evaluate(s, bad);
    assert.equal(e.solved, false);
    assert.ok(typeof e.refused === 'string' && e.refused.length > 0, JSON.stringify(bad));
  }
  assert.equal(evaluate(s, [1, 3, 4, 2]).refused, undefined);
});
test('a poor order shakes, a best order shakes least', () => {
  const s = spec(6);
  const bad = evaluate(s, identity(6)), good = evaluate(s, [1, 5, 3, 6, 2, 4]);
  assert.ok(!bad.solved && good.solved);
  assert.ok(bad.shake.amp1 > 0.2 && good.shake.amp1 < 1e-9 && good.shake.amp2 < 1e-9, JSON.stringify([bad.shake, good.shake]));
  const four = evaluate(spec(4), [1, 3, 4, 2]);
  assert.ok(four.solved && four.shake.amp1 < 1e-9 && four.shake.amp2 > 0.2, 'the best four still shakes at twice engine speed');
});
test('makeCrankshaft always builds a solvable puzzle that is not already solved', () => {
  const seen = new Set<number>();
  for (let seed = 1; seed <= 1000; seed++) {
    const s = makeCrankshaft(seed * 2654435761 >>> 0);
    assert.equal(s.kind, 'crankshaft');
    assert.ok(s.n >= 3 && s.n <= 6 && Number.isInteger(s.n));
    assert.ok(s.lambda > 0.15 && s.lambda < 0.45 && s.pitch > 0 && s.mass > 0);
    const b = bestResiduals(s);
    assert.ok(b.orders.length >= 1, `seed ${seed}`);
    if (s.n >= 4) assert.ok(!evaluate(s, identity(s.n)).solved, `identity solves n=${s.n} seed ${seed}`);
    seen.add(s.n);
  }
  assert.ok(seen.has(4) && seen.has(5) && seen.has(6), [...seen].join());
  const a = makeCrankshaft(5), b = makeCrankshaft(5);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

console.log(`\n${passed} passed`);
