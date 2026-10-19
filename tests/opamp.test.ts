import assert from 'node:assert/strict';
import { closedLoopGain, bandwidth, output, evaluate, makeOpamp, R_DIAL, type OpampSpec } from '@/engineerle/opamp';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const spec = (o: Partial<OpampSpec> = {}): OpampSpec => ({ kind: 'opamp', mode: 'non-inverting', vin: 0.5, f: 10_000, gbw: 1e6, supply: 12, target: 5, tolerance: 0.05, ...o });
const pairs = () => R_DIAL.flatMap((rf) => R_DIAL.map((rg) => [rf, rg] as const));

console.log('Ideal gains and bandwidth (Sedra and Smith, Microelectronic Circuits, ch. 2 and 9)');
test('inverting gain is −Rf/Rg and non-inverting gain is 1 + Rf/Rg', () => {
  assert.equal(closedLoopGain('inverting', 10e3, 1e3), -10);
  assert.equal(closedLoopGain('non-inverting', 9e3, 1e3), 10);
  assert.equal(closedLoopGain('non-inverting', 0, 1e3), 1);
});
test('a non-inverting 10× stage on a 1 MHz gain-bandwidth product has 100 kHz of bandwidth; an inverting 10× stage has 1 MHz/11 because the noise gain is 1 + 10', () => {
  assert.equal(bandwidth(1e6, closedLoopGain('non-inverting', 9e3, 1e3)), 100_000);
  near(bandwidth(1e6, closedLoopGain('inverting', 10e3, 1e3)), 1e6 / 11, 1e-6);
  near(bandwidth(1e6, -1), 500_000, 1e-6);                 // inverting unity gain: noise gain 2
  near(bandwidth(1e6, 1), 1e6, 1e-6);                      // the follower keeps the whole GBW
});
test('at the bandwidth frequency the output is the gain over √2 (−3 dB), a decade below it is within 0.5% of the ideal gain', () => {
  const big = spec({ supply: 1000 });
  const g = closedLoopGain('non-inverting', 9e3, 1e3), bw = bandwidth(1e6, g);
  near(output(big, g, 1, bw), g / Math.SQRT2, 1e-9);
  near(output(big, g, 1, bw / 10) / g, 1, 0.005);
  const gi = closedLoopGain('inverting', 10e3, 1e3);
  near(output(big, gi, 1, bandwidth(1e6, gi)), 10 / Math.SQRT2, 1e-9);
});
test('the output is judged against an independent model: open-loop A(f) = A0/(1 + jf/fp), summing at the inverting input with feedback factor β = Rg/(Rf + Rg)', () => {
  // non-inverting: Vo/Vi = A/(1 + Aβ);  inverting: Vo/Vi = −A(1 − β)/(1 + Aβ), both derived straight from Vo = A(V+ − V−)
  const A0 = 1e7, gbw = 2e6, fp = gbw / A0;
  const loopMag = (f: number, beta: number) => {
    const d = 1 + (f / fp) ** 2;                         // A = A0(1 − jf/fp)/d
    const are = A0 / d, aim = (-A0 * (f / fp)) / d;
    const dre = 1 + beta * are, dim = beta * aim;         // 1 + Aβ
    return Math.hypot(are, aim) / Math.hypot(dre, dim);
  };
  for (const [mode, rf, rg] of [['non-inverting', 47e3, 4.7e3], ['non-inverting', 1e3, 22e3], ['inverting', 100e3, 3.3e3], ['inverting', 6.8e3, 6.8e3]] as const) {
    const beta = rg / (rf + rg);
    const g = closedLoopGain(mode, rf, rg), bw = bandwidth(gbw, g);
    for (const f of [bw / 10, bw / 2, bw, 2 * bw, 5 * bw]) {
      const reference = loopMag(f, beta) * (mode === 'inverting' ? 1 - beta : 1);
      near(output(spec({ supply: 1e6, gbw }), g, 1, f) / reference, 1, 0.002, `${mode} ${rf}/${rg} at ${f} Hz`);
    }
  }
});
test('a 0.5 V peak input at a gain of 30 on a ±12 V supply clips at 10.5 V (the output swings to within 1.5 V of each rail)', () => {
  assert.equal(output(spec(), 30, 0.5, 100), 10.5);
  assert.equal(output(spec({ supply: 15 }), 30, 0.5, 100), 13.5);
  assert.ok(output(spec(), 10, 0.5, 100) < 5.0001 && output(spec(), 10, 0.5, 100) > 4.99);
});

console.log('Judging a choice');
test('a feedback or ground resistor that is zero (ground), negative or not a number is refused and is not a guess', () => {
  for (const [rf, rg] of [[10e3, 0], [10e3, -1e3], [NaN, 1e3], [10e3, NaN], [-1, 1e3], [Infinity, 1e3]]) assert.ok(evaluate(spec(), rf, rg).refused, `${rf} ${rg}`);
  assert.equal(evaluate(spec(), 0, 1e3).refused, undefined);
});
test('a pair passes when the output peak is within 5% of the target, nothing clips and the tone is inside the bandwidth', () => {
  const s = spec({ target: 5 });                      // 0.5 V in, 5 V out wanted: gain ~10, bw ~100 kHz, 10 kHz tone
  const ok = evaluate(s, 9.1e3, 1e3);                 // gain 10.1
  assert.equal(ok.solved, true); near(ok.gain, 10.1, 1e-12);
  assert.equal(evaluate(s, 15e3, 1e3).solved, false); // gain 16: too much (and 8 V)
  assert.equal(evaluate(s, 4.3e3, 1e3).solved, false);// gain 5.3: too little
  const clip = evaluate(spec({ target: 10 }), 100e3, 3.3e3); // gain ~31: clips at 10.5
  assert.equal(clip.clipped, true); assert.equal(clip.amplitude, 10.5); assert.equal(clip.solved, false);
});
test('a gain the amplifier cannot hold at that frequency fails even if the roll-off lands the output on target', () => {
  // 1 MHz GBW, 400 kHz tone, 0.1 V in, target 1.0 V: gain 100 is needed on paper, but the bandwidth is only 10 kHz.
  const s = spec({ f: 400_000, vin: 0.1, target: 1 });
  const e = evaluate(s, 99e3, 1e3);
  assert.equal(e.overBandwidth, true); assert.equal(e.solved, false);
});

console.log('Generator');
test('over 1000 seeds a pair from the dials reaches the target in tolerance without clipping or leaving the bandwidth, and the first dial position does not', () => {
  const modes: Record<string, number> = { inverting: 0, 'non-inverting': 0 }; let bwBites = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const sp = makeOpamp(seed); modes[sp.mode]++;
    assert.equal(sp.kind, 'opamp'); assert.equal(sp.tolerance, 0.05);
    assert.ok([9, 12, 15].includes(sp.supply) && sp.target <= sp.supply - 1.5, `seed ${seed}: target ${sp.target} supply ${sp.supply}`);
    assert.ok(sp.vin >= 0.01 && sp.vin <= 1 && sp.f >= 100 && sp.f <= 200_000 && sp.gbw >= 0.5e6 && sp.gbw <= 10e6, `seed ${seed} ranges`);
    const good = pairs().filter(([rf, rg]) => evaluate(sp, rf, rg).solved);
    assert.ok(good.length >= 1, `seed ${seed}: nothing solves it`);
    const first = evaluate(sp, R_DIAL[0], R_DIAL[0]);
    assert.equal(first.solved, false, `seed ${seed}: first dial position solves`);
    for (const [rf, rg] of good) { const e = evaluate(sp, rf, rg); assert.ok(!e.clipped && !e.overBandwidth && Math.abs(e.amplitude - sp.target) <= 0.05 * sp.target + 1e-12, `seed ${seed}`); }
    // does the ideal gain (target / vin) miss because of roll-off alone? then the bandwidth really matters
    const ideal = sp.target / sp.vin;
    const noiseGain = sp.mode === 'inverting' ? 1 + ideal : ideal;
    if (sp.f > 0.33 * (sp.gbw / noiseGain)) bwBites++;
  }
  assert.ok(modes.inverting > 300 && modes['non-inverting'] > 300, JSON.stringify(modes));
  assert.ok(bwBites > 150, `bandwidth matters in a good share of puzzles: ${bwBites}`);
});
test('the same seed gives the same puzzle', () => assert.deepEqual(makeOpamp(5), makeOpamp(5)));

console.log(`\n${passed} passed`);
