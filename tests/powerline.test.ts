import assert from 'node:assert/strict';
import { lineState, evaluate, makePowerline, solvingRatios, RATIOS, FALLBACK, type PowerlineSpec } from '@/engineerle/powerline';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const base = (o: Partial<PowerlineSpec> = {}): PowerlineSpec => ({ kind: 'powerline', power: 100_000, vGen: 1_000, lineOhms: 5, maxLossPct: 3, vMax: 33_000, ratios: RATIOS, ...o });

console.log('Transmission line (P = VI, loss = I²R)');
test('100 kW at 10 kV through 5 Ω carries 10 A and loses 500 W, half a percent', () => {
  const s = lineState(base(), 10);
  assert.equal(s.vLine, 10_000); assert.equal(s.iLine, 10); assert.equal(s.lossW, 500); assert.equal(s.lossPct, 0.5);
});
test('the same load at 1 kV carries 100 A and loses half of it', () => {
  const s = lineState(base(), 1);
  assert.equal(s.iLine, 100); assert.equal(s.lossW, 50_000); assert.equal(s.lossPct, 50);
});
test('an ideal step-up transformer: the line voltage is vGen × ratio and the current is P / V', () => {
  for (const r of RATIOS) { const s = lineState(base({ vGen: 690, power: 250_000 }), r); near(s.vLine, 690 * r, 1e-9); near(s.iLine, 250_000 / (690 * r), 1e-12); }
});
test('the voltage at the far end is the sent voltage less the drop I·R', () => {
  const sp = base({ lineOhms: 8 }); const s = lineState(sp, 20);
  near(s.vLoad, s.vLine - s.iLine * 8, 1e-9);
});
test('power is conserved: what is sent equals the line loss plus what is delivered', () => {
  for (const r of RATIOS) for (const o of [{}, { power: 20_000, lineOhms: 20 }, { power: 500_000, vGen: 11_000, lineOhms: 1 }]) {
    const sp = base(o); const s = lineState(sp, r);
    near(sp.power, s.lossW + s.efficiency * sp.power, 1e-6, `ratio ${r}`);
    near(s.lossPct, 100 * s.lossW / sp.power, 1e-9);
  }
});
test('loss falls with the square of the ratio', () => {
  const a = lineState(base(), 5).lossW, b = lineState(base(), 10).lossW;
  near(a / b, 4, 1e-9);
});

console.log('Judging a ratio');
test('a ratio of zero, a negative one or NaN is refused and is not a guess', () => {
  for (const r of [0, -2, NaN, Infinity]) assert.ok(evaluate(base(), r).refused, `ratio ${r}`);
});
test('a ratio passes only when the loss is within the budget and the line stays within its insulation rating', () => {
  const sp = base();                                   // 1 kV, 100 kW, 5 Ω, ≤ 3 %, ≤ 33 kV
  assert.equal(evaluate(sp, 2).solved, false);        // 2 kV: 12.5 % lost
  assert.equal(evaluate(sp, 5).solved, true);         // 5 kV: 20 A, 2 kW = 2 %
  assert.equal(evaluate(sp, 25).solved, true);        // 25 kV
  assert.equal(evaluate(sp, 50).solved, false);       // 50 kV: loses little but flashes over
  assert.equal(evaluate(sp, 50).reason, 'voltage');
  assert.equal(evaluate(sp, 2).reason, 'loss');
  assert.deepEqual(solvingRatios(sp), [5, 10, 20, 25]);
});

console.log('Generator');
test('the fallback instance is a valid puzzle', () => {
  const r = solvingRatios(FALLBACK); assert.ok(r.length >= 1 && r.length <= 3, `${r}`); assert.equal(evaluate(FALLBACK, 1).solved, false);
});
test('over 1000 seeds: ranges as stated, a solving ratio exists, ratio 1 never solves, some ratios fail each way, none is borderline', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const sp = makePowerline(seed);
    assert.equal(sp.kind, 'powerline');
    assert.ok(sp.power >= 20_000 && sp.power <= 500_000, `power ${sp.power}`);
    assert.ok(sp.vGen >= 400 && sp.vGen <= 11_000, `vGen ${sp.vGen}`);
    assert.ok(sp.lineOhms >= 1 && sp.lineOhms <= 20, `R ${sp.lineOhms}`);
    assert.ok(sp.maxLossPct >= 2 && sp.maxLossPct <= 8, `loss ${sp.maxLossPct}`);
    assert.deepEqual(sp.ratios, [1, 2, 5, 10, 20, 25, 50, 100]);
    const ok = solvingRatios(sp);
    assert.ok(ok.length >= 1 && ok.length <= 3, `seed ${seed}: ${ok.length} solutions`);
    assert.equal(evaluate(sp, 1).solved, false, `seed ${seed}: ratio 1 solves`);
    const why = sp.ratios.map((r) => evaluate(sp, r).reason);
    assert.ok(why.includes('loss') && why.includes('voltage'), `seed ${seed}: needs a failure each way`);
    for (const r of sp.ratios) {
      const s = lineState(sp, r);
      assert.ok(Math.abs(s.lossPct / sp.maxLossPct - 1) > 0.05, `seed ${seed} ratio ${r}: loss borderline`);
      assert.ok(Math.abs(s.vLine / sp.vMax - 1) > 0.05, `seed ${seed} ratio ${r}: voltage borderline`);
    }
  }
});
test('the same seed gives the same puzzle, and seeds differ', () => {
  assert.deepEqual(makePowerline(7), makePowerline(7));
  assert.notDeepEqual(makePowerline(7), makePowerline(8));
});

console.log(`\n${passed} passed`);
