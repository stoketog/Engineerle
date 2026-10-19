import assert from 'node:assert/strict';
import { MIN_TEETH, MAX_TEETH, trainRatio, outputRpm, outputTorque, centreDistance, evaluate, makeGears, type GearSpec, type Mesh } from '@/engineerle/gears';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);
const rel = (a: number, b: number, tol: number, m = '') => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${m} expected ${b} got ${a}`);

console.log('Gears: ratio, speed and direction (Shigley, Mechanical Engineering Design, ch. 13; Norton, Design of Machinery)');
test('a 20-tooth driver on a 60-tooth driven gear is a ratio of 3; 1500 rpm in becomes -500 rpm, reversed', () => {
  const t: Mesh[] = [{ driver: 20, driven: 60 }];
  near(trainRatio(t), 3, 1e-12); near(outputRpm(1500, t), -500, 1e-9);
});
test('two external meshes restore the direction: 20/60 then 20/40 is ratio 6, +250 rpm', () => {
  const t: Mesh[] = [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }];
  near(trainRatio(t), 6, 1e-12); near(outputRpm(1500, t), 250, 1e-9);
  assert.ok(outputRpm(1500, [...t, { driver: 30, driven: 30 }]) < 0, 'three meshes reverse again');
});
test('the train ratio is the product of the stage ratios', () => {
  const t: Mesh[] = [{ driver: 17, driven: 53 }, { driver: 41, driven: 29 }, { driver: 80, driven: 23 }];
  near(trainRatio(t), (53 / 17) * (29 / 41) * (23 / 80), 1e-12);
});
test('a speed-up train (driven smaller than driver) raises the speed', () => { assert.ok(Math.abs(outputRpm(1000, [{ driver: 60, driven: 20 }])) > 1000); });

console.log('Gears: torque and power');
test('torque times speed is conserved apart from the 2% loss per mesh, within 1e-9', () => {
  for (const t of [[{ driver: 20, driven: 60 }], [{ driver: 20, driven: 60 }, { driver: 25, driven: 70 }], [{ driver: 17, driven: 80 }, { driver: 30, driven: 18 }, { driver: 22, driven: 50 }]] as Mesh[][]) {
    const tin = 37.5, win = 1800, wout = Math.abs(outputRpm(win, t)), tout = outputTorque(tin, t);
    rel(tout * wout, Math.pow(0.98, t.length) * tin * win, 1e-9);
  }
});
test('a lossless train multiplies torque by exactly the ratio', () => { near(outputTorque(10, [{ driver: 20, driven: 60 }], 1), 30, 1e-12); });

console.log('Gears: the fit and the refusals');
const spec = (o: Partial<GearSpec> = {}): GearSpec => ({
  kind: 'gears', inputRpm: 1500, inputTorque: 20, targetRpm: 250, tolerance: 0.01, module: 2, maxCentre: [60, 50],
  start: [{ driver: 20, driven: 20 }, { driver: 20, driven: 20 }], example: [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }], ...o,
});
test('centre distance is m (z1 + z2) / 2', () => { near(centreDistance(2, { driver: 20, driven: 60 }), 80, 1e-12); near(centreDistance(1.5, { driver: 17, driven: 33 }), 37.5, 1e-12); });
test('the worked set solves when it fits, and fails when a slot is too small', () => {
  assert.equal(evaluate(spec({ maxCentre: [80, 60] }), spec().example).solved, true);
  const tight = evaluate(spec({ maxCentre: [79, 60] }), spec().example);
  assert.equal(tight.solved, false); assert.deepEqual(tight.fits, [false, true]);
});
test('a ratio within 1% solves, a ratio 2% off does not, and a wrong direction does not', () => {
  const s = spec({ maxCentre: [200, 200] });
  near(evaluate(s, [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }]).rpm!, 250, 1e-9);
  assert.equal(evaluate(s, [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }]).solved, true);
  assert.equal(evaluate(s, [{ driver: 20, driven: 60 }, { driver: 20, driven: 41 }]).solved, false, '2.5% off');
  assert.equal(evaluate({ ...s, targetRpm: -250 }, [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }]).solved, false, 'the output must turn the other way');
  const e = evaluate(s, [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }]); assert.equal(e.directionOk, true);
  const edge = evaluate({ ...s, targetRpm: 252.5 }, [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }]); assert.equal(edge.solved, true, '0.99% off');
  const out = evaluate({ ...s, targetRpm: 253 }, [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }]); assert.equal(out.solved, false, '1.2% off');
});
test('a 12-tooth pinion is refused (it would undercut), and so are counts above 80', () => {
  assert.equal(MIN_TEETH, 17); assert.equal(MAX_TEETH, 80);
  for (const bad of [{ driver: 12, driven: 40 }, { driver: 16, driven: 40 }, { driver: 20, driven: 81 }, { driver: 20, driven: 200 }]) {
    const e = evaluate(spec(), [bad, { driver: 20, driven: 40 }]); assert.ok(e.refused, JSON.stringify(bad)); assert.equal(e.solved, false);
  }
  assert.equal(evaluate(spec({ maxCentre: [999, 999] }), [{ driver: 17, driven: 80 }, { driver: 80, driven: 17 }]).refused, undefined);
});
test('evaluate refuses non-integers, zero, negatives, NaN, strings and a wrong number of meshes', () => {
  const ok2: Mesh = { driver: 20, driven: 40 };
  for (const bad of [{ driver: 20.5, driven: 40 }, { driver: 0, driven: 40 }, { driver: -20, driven: 40 }, { driver: NaN, driven: 40 }, { driver: Infinity, driven: 40 }, { driver: '20' as unknown as number, driven: 40 }, { driver: 20, driven: undefined as unknown as number }]) {
    const e = evaluate(spec(), [bad, ok2]); assert.ok(e.refused, JSON.stringify(bad)); assert.equal(e.solved, false);
  }
  for (const t of [[], [ok2], [ok2, ok2, ok2], null as unknown as Mesh[]]) assert.ok(evaluate(spec(), t).refused, 'length');
});

console.log('Gears: the generator');
test('over 1000 seeds: a worked set solves, the starting set does not, ranges are as stated', () => {
  const meshes = new Set<number>();
  for (let seed = 1; seed <= 1000; seed++) {
    const s = makeGears(seed);
    meshes.add(s.maxCentre.length);
    assert.ok(s.maxCentre.length === 2 || s.maxCentre.length === 3, `seed ${seed} meshes`);
    assert.ok(s.inputRpm >= 600 && s.inputRpm <= 3000, `seed ${seed} rpm ${s.inputRpm}`);
    assert.equal(s.tolerance, 0.01);
    assert.equal(s.example.length, s.maxCentre.length); assert.equal(s.start.length, s.maxCentre.length);
    for (const m of [...s.example, ...s.start]) assert.ok(Number.isInteger(m.driver) && Number.isInteger(m.driven) && m.driver >= 17 && m.driven >= 17 && m.driver <= 80 && m.driven <= 80, `seed ${seed} teeth`);
    const ex = evaluate(s, s.example); assert.equal(ex.refused, undefined); assert.equal(ex.solved, true, `seed ${seed}: the worked set must solve (${JSON.stringify(ex)})`);
    const st = evaluate(s, s.start); assert.equal(st.refused, undefined); assert.equal(st.solved, false, `seed ${seed}: the start must not solve`);
    assert.equal(Math.sign(s.targetRpm), s.maxCentre.length % 2 === 0 ? 1 : -1, `seed ${seed}: direction follows the number of meshes`);
  }
  assert.deepEqual([...meshes].sort(), [2, 3]);
});
test('the generator is deterministic and varies', () => {
  assert.deepEqual(makeGears(4), makeGears(4));
  assert.ok(new Set(Array.from({ length: 30 }, (_, i) => makeGears(i + 1).targetRpm)).size > 10);
});

console.log(`\n${passed} passed`);
