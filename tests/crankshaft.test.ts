import assert from 'node:assert/strict';
import { throwAngles, residuals, bestResiduals, evaluate, makeCrankshaft, pistonAcceleration, type CrankshaftSpec } from '@/engineerle/crankshaft';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);
const spec = (n: 3 | 4 | 5 | 6, lambda = 0.25): CrankshaftSpec => ({ kind: 'crankshaft', n, lambda, pitch: 1, mass: 1 });
const perms = <T,>(a: T[]): T[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

console.log('Crankshaft: throw angles from the firing order');
test('the throw angle is the firing angle (720 x slot / n) taken round one turn', () => {
  assert.deepEqual(throwAngles([1, 3, 4, 2]), [0, 180, 180, 0]);
  assert.deepEqual(throwAngles([1, 5, 3, 6, 2, 4]), [0, 120, 240, 240, 120, 0]);
  assert.deepEqual(throwAngles([1, 2, 4, 5, 3]), [0, 144, 216, 288, 72]);
});
test('a partly chosen order places the chosen throws and leaves the rest at zero', () => {
  assert.deepEqual(throwAngles([1, 3], 4), [0, 0, 180, 0]);
  assert.deepEqual(throwAngles([], 5), [0, 0, 0, 0, 0]);
});
test('every four-cylinder firing order fires every 180 degrees of the 720 degree cycle', () => {
  for (const p of perms([2, 3, 4])) {
    const order = [1, ...p];
    const firing = order.map((_, slot) => (720 * slot) / 4);
    assert.deepEqual(firing, [0, 180, 360, 540]);
    const t = throwAngles(order);
    order.forEach((c, slot) => near(((t[c - 1] - firing[slot]) % 360 + 360) % 360, 0, 1e-9, `cylinder ${c}`));
  }
});

console.log('Crankshaft: textbook balance');
test('in-line six 1-5-3-6-2-4 is balanced in every force and couple; 1-2-3-4-5-6 rocks', () => {
  const r = residuals(spec(6), [1, 5, 3, 6, 2, 4]);
  for (const v of Object.values(r)) near(v, 0, 1e-9);
  assert.ok(residuals(spec(6), [1, 2, 3, 4, 5, 6]).primaryCouple > 1);
});
test('in-line four 1-3-4-2 has only the secondary force, 4 x lambda', () => {
  const r = residuals(spec(4), [1, 3, 4, 2]);
  near(r.primaryForce, 0); near(r.primaryCouple, 0); near(r.secondaryCouple, 0);
  near(r.secondaryForce, 4 * 0.25);
  near(residuals(spec(4), [1, 2, 3, 4]).primaryCouple, 2);
});
test('in-line five has no net forces but rocks end to end', () => {
  const r = residuals(spec(5), [1, 2, 4, 5, 3]);
  near(r.primaryForce, 0); near(r.secondaryForce, 0);
  // textbook straight-five (Heisler; Wikipedia engine-balance table): primary couple 0.449, secondary couple 4.98 x lambda
  near(r.primaryCouple, 0.449, 1e-3, 'primary couple'); near(r.secondaryCouple / 0.25, 4.98, 0.01, 'secondary couple / lambda');
});
test('in-line three has no net forces but a primary couple', () => {
  const r = residuals(spec(3), [1, 2, 3]);
  near(r.primaryForce, 0); near(r.secondaryForce, 0);
  assert.ok(r.primaryCouple > 1);
});

console.log('Crankshaft: against the exact piston motion');
test('pistonAcceleration is the exact second derivative of r cos t + sqrt(l^2 - r^2 sin^2 t)', () => {
  const x = (r: number, l: number, t: number) => r * Math.cos(t) + Math.sqrt(l * l - r * r * Math.sin(t) * Math.sin(t));
  for (const [r, l] of [[1, 4], [1, 3.3], [0.04, 0.15]]) {
    for (let t = 0.1; t < 6.2; t += 0.37) {
      const h = 1e-4;
      near(pistonAcceleration(r, l, t), (x(r, l, t + h) - 2 * x(r, l, t) + x(r, l, t - h)) / (h * h), 2e-5 * Math.max(1, r), `r=${r} l=${l} t=${t}`);
    }
  }
  near(pistonAcceleration(1, 4, 0), -1.25, 1e-12);
});
test('the first and second harmonics of the summed piston accelerations match the residuals', () => {
  const N = 4096;
  const harmonics = (n: number, lambda: number, order: number[], weight: (c: number) => number) => {
    const phi = throwAngles(order).map((d) => (d * Math.PI) / 180);
    const h = [0, 0];
    for (const k of [1, 2]) {
      let re = 0, im = 0;
      for (let s = 0; s < N; s++) {
        const th = (2 * Math.PI * s) / N;
        let f = 0;
        for (let c = 1; c <= n; c++) f += weight(c) * pistonAcceleration(1, 1 / lambda, th - phi[c - 1]);
        re += f * Math.cos(k * th); im += f * Math.sin(k * th);
      }
      h[k - 1] = (2 / N) * Math.hypot(re, im);
    }
    return h;
  };
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let rep = 0; rep < 24; rep++) {
    const n = (3 + (rep % 4)) as 3 | 4 | 5 | 6;
    const order = [1, ...perms(range(n).slice(1))[Math.floor(rnd() * perms(range(n).slice(1)).length)]];
    for (const lambda of [0.1, 0.25]) {
      const sp = spec(n, lambda);
      const r = residuals(sp, order);
      const f = harmonics(n, lambda, order, () => 1);
      const c = harmonics(n, lambda, order, (cyl) => cyl - (n + 1) / 2);
      // the exact motion adds a lambda^2/4 correction to the second harmonic (the "higher harmonics" of the textbook series)
      const tol2 = lambda === 0.1 ? 5e-3 : 0.03;
      near(f[0], r.primaryForce, 5e-3, `n=${n} ${order} primary force`);
      near(c[0], r.primaryCouple, 5e-3, `n=${n} ${order} primary couple`);
      near(f[1], r.secondaryForce, tol2, `n=${n} ${order} lambda=${lambda} secondary force`);
      near(c[1], r.secondaryCouple, tol2, `n=${n} ${order} lambda=${lambda} secondary couple`);
    }
  }
});

console.log('Crankshaft: the best firing orders');
test('bestResiduals finds the textbook orders and rejects the naive one', () => {
  const b4 = bestResiduals(spec(4)).orders.map((o) => o.join('-'));
  assert.ok(b4.includes('1-3-4-2') && b4.includes('1-2-4-3') && !b4.includes('1-2-3-4'), b4.join(' '));
  const b6 = bestResiduals(spec(6)).orders.map((o) => o.join('-'));
  assert.ok(b6.includes('1-5-3-6-2-4') && b6.includes('1-4-2-6-3-5') && !b6.includes('1-2-3-4-5-6'), b6.join(' '));
  near(bestResiduals(spec(6)).primaryCouple, 0); near(bestResiduals(spec(4)).secondaryForce, 1);
});

console.log('Crankshaft: checking a guess');
test('a best order solves; the naive one does not; the shake grows with the unbalance', () => {
  const sp = spec(4);
  assert.equal(evaluate(sp, [1, 3, 4, 2]).solved, true);
  assert.equal(evaluate(sp, [1, 2, 4, 3]).solved, true);
  const bad = evaluate(sp, [1, 2, 3, 4]);
  assert.equal(bad.solved, false);
  assert.ok(bad.shake.amp1 > evaluate(sp, [1, 3, 4, 2]).shake.amp1 + 0.1);
  assert.ok(evaluate(sp, [1, 3, 4, 2]).shake.amp2 > 0, 'a good four still shakes at twice engine speed');
});
test('anything that is not a permutation of 1..n is refused, not scored', () => {
  const sp = spec(5);
  for (const o of [[1, 2, 3, 4], [1, 2, 3, 4, 4], [1, 2, 3, 4, 6], [0, 1, 2, 3, 4], [1, 2, 3, 4, 2.5], [], [1, 2, 3, 4, 5, 5]]) {
    const e = evaluate(sp, o);
    assert.equal(e.solved, false, o.join());
    assert.ok(typeof e.refused === 'string' && e.refused.length > 0, `refused: ${o.join()}`);
  }
  assert.equal(evaluate(sp, [1, 2, 3, 4, 5]).refused, undefined);
});
test('every seed makes an engine with a real solution that the naive order does not give', () => {
  for (let s = 1; s <= 1000; s++) {
    const sp = makeCrankshaft(s * 7919);
    assert.ok(sp.n >= 3 && sp.n <= 6, `n ${sp.n}`);
    assert.ok(bestResiduals(sp).orders.length >= 1, `seed ${s}`);
    if (sp.n >= 4) assert.equal(evaluate(sp, range(sp.n)).solved, false, `seed ${s} n=${sp.n}: 1-2-3-.. already solves it`);
    const best = bestResiduals(sp).orders[0];
    assert.equal(evaluate(sp, best).solved, true);
  }
});

console.log(`\n${passed} passed`);
