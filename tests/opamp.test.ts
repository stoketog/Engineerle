import assert from 'node:assert/strict';
import { closedLoopGain, bandwidth, output, linearOutput, phaseDeg, clipLimit, makeOpamp, evaluate, RF_VALUES, RG_VALUES, type OpampSpec } from '@/engineerle/opamp';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);

const spec = (o: Partial<OpampSpec> = {}): OpampSpec => ({ kind: 'opamp', mode: 'non-inverting', vin: 0.5, f: 100, gbw: 1e6, supply: 12, target: 1, tolerance: 0.05, ...o });

console.log('Op-amp: closed-loop gain (Horowitz and Hill; Sedra and Smith)');
test('inverting: Av = -Rf/Rg', () => { near(closedLoopGain('inverting', 10e3, 1e3), -10); });
test('non-inverting: Av = 1 + Rf/Rg', () => { near(closedLoopGain('non-inverting', 9e3, 1e3), 10); near(closedLoopGain('non-inverting', 0, 1e3), 1); });

console.log('Op-amp: bandwidth from the gain-bandwidth product');
test('non-inverting 10x with a 1 MHz GBW has 100 kHz bandwidth', () => { near(bandwidth(1e6, 10), 100e3, 1e-6); });
test('inverting: the noise gain is 1 + |Av|, so -10 with 1 MHz GBW gives 90.9 kHz', () => { near(bandwidth(1e6, -10, 'inverting'), 1e6 / 11, 1e-6); });
test('at the bandwidth frequency the magnitude is gain / sqrt(2)', () => {
  const s = spec({ vin: 0.01 });
  near(linearOutput(s, 10, s.vin, bandwidth(s.gbw, 10)), (10 * s.vin) / Math.SQRT2, 1e-9);
  const t = spec({ vin: 0.01, mode: 'inverting' });
  near(linearOutput(t, -10, t.vin, bandwidth(t.gbw, -10, 'inverting')), (10 * t.vin) / Math.SQRT2, 1e-9);
});
test('a decade above the bandwidth the magnitude has fallen to about 1/10 (-20 dB)', () => {
  const s = spec({ vin: 0.01 });
  near(linearOutput(s, 10, s.vin, 10 * bandwidth(s.gbw, 10)) / (10 * s.vin), 1 / Math.sqrt(101), 1e-9);
});
test('the phase lags 45 degrees at the bandwidth (non-inverting) and sits at 180 - 45 for the inverting amplifier', () => {
  near(phaseDeg('non-inverting', 1e6, 10, 100e3), -45, 1e-9);
  near(phaseDeg('inverting', 1e6, -10, 1e6 / 11), 180 - 45, 1e-9);
  near(phaseDeg('inverting', 1e6, -10, 0.001), 180, 1e-3);
});

console.log('Op-amp: output swing');
test('a 0.5 V peak input with gain 30 on a +/-12 V supply clips at 10.5 V', () => {
  const s = spec({ vin: 0.5, supply: 12, f: 10 });
  near(clipLimit(12), 10.5);
  near(output(s, 30, 0.5, 10), 10.5);
  assert.ok(linearOutput(s, 30, 0.5, 10) > 14.9);
});
test('below the rails the output is not clipped', () => { const s = spec({ f: 10 }); near(output(s, 10, 0.5, 10), linearOutput(s, 10, 0.5, 10)); assert.ok(output(s, 10, 0.5, 10) < 5.0001); });

console.log('Op-amp: judging a guess');
test('evaluate refuses zero, negative, NaN, infinite and enormous resistors without testing them', () => {
  const s = spec();
  for (const [rf, rg] of [[1000, 0], [1000, -1], [-5, 1000], [NaN, 1000], [1000, NaN], [Infinity, 1000], [1000, 1e12], [1e12, 1000], [0, 0]] as Array<[number, number]>) {
    const e = evaluate(s, rf, rg);
    assert.ok(e.refused, `refused ${rf},${rg}`); assert.equal(e.solved, false);
  }
});
test('an exact-gain pair solves; a clipped one, a too-slow one and a wrong one do not', () => {
  const s = spec({ mode: 'non-inverting', vin: 0.2, f: 1000, gbw: 1e6, supply: 12, target: 0.2 * 10 / Math.sqrt(1 + (1000 / 100e3) ** 2) });
  assert.equal(evaluate(s, 9e3, 1e3).solved, true);
  assert.equal(evaluate(s, 12e3, 1e3).solved, false);
  const clip = spec({ vin: 1, f: 1000, supply: 12, target: 10.5 });
  const ec = evaluate(clip, 11e3, 1e3); assert.equal(ec.clipped, true); assert.equal(ec.solved, false);
  const slow = spec({ vin: 0.005, f: 50e3, gbw: 1e6, target: 0.005 * 40 });
  const es = evaluate(slow, 39e3, 1e3); assert.equal(es.bwOk, false); assert.equal(es.solved, false);
});
test('the tolerance edge: 5% inside solves, 6% outside does not', () => {
  const s = spec({ vin: 0.1, f: 100, gbw: 1e9, target: 1.0, tolerance: 0.05 });
  const gain = (r: number) => 1 + r / 1000;
  const inside = evaluate(s, 9400 * 1.0, 1000); // gain 10.4 -> 1.04 V
  near(inside.vout!, 0.1 * gain(9400), 1e-3); assert.equal(inside.solved, true);
  assert.equal(evaluate(s, 9600, 1000).solved, false); // 1.06 V
});

console.log('Op-amp: the generator');
test('over 1000 seeds a dial pair reaches the target without clipping or exceeding the bandwidth, and the first dial position does not', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const s = makeOpamp(seed);
    let n = 0;
    for (const rf of RF_VALUES) for (const rg of RG_VALUES) if (evaluate(s, rf, rg).solved) n++;
    assert.ok(n >= 3, `seed ${seed} has ${n} solving pairs`);
    assert.equal(evaluate(s, RF_VALUES[0], RG_VALUES[0]).solved, false, `seed ${seed}: first position must not solve`);
    assert.ok(s.target < clipLimit(s.supply), `seed ${seed}: target beyond the rails`);
    assert.ok(s.tolerance === 0.05);
  }
});
test('the generator is deterministic and varies', () => {
  assert.deepEqual(makeOpamp(7), makeOpamp(7));
  const modes = new Set(Array.from({ length: 60 }, (_, i) => makeOpamp(i + 1).mode));
  assert.equal(modes.size, 2);
  assert.ok(new Set(Array.from({ length: 60 }, (_, i) => makeOpamp(i + 1).gbw)).size >= 2);
});

console.log(`\n${passed} passed`);
