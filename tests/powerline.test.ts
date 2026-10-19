import assert from 'node:assert/strict';
import { lineState, makePowerline, evaluate, RATIOS, type PowerlineSpec } from '@/engineerle/powerline';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);
const spec = (o: Partial<PowerlineSpec> = {}): PowerlineSpec => ({ kind: 'powerline', power: 100_000, vGen: 10_000, lineOhms: 5, maxLossPct: 2, maxVLine: 200_000, ratios: RATIOS, ...o });

console.log('Power line: textbook numbers');
test('100 kW at 10 kV through 5 ohm: 10 A, 500 W, 0.5 %', () => {
  const s = lineState(spec(), 1);
  assert.equal(s.iLine, 10); assert.equal(s.lossW, 500); assert.equal(s.lossPct, 0.5);
  near(s.vLoad, 10_000 - 10 * 5);
});
test('the same 100 kW at 1 kV: 100 A, 50 kW, 50 %', () => {
  const s = lineState(spec({ vGen: 1000 }), 1);
  assert.equal(s.iLine, 100); assert.equal(s.lossW, 50_000); assert.equal(s.lossPct, 50);
});
test('an ideal step-up transformer multiplies voltage and divides current by the ratio', () => {
  for (const r of RATIOS) {
    const sp = spec({ vGen: 2400, power: 250_000 });
    const s = lineState(sp, r);
    near(s.vLine, 2400 * r, 1e-6); near(s.iLine, 250_000 / (2400 * r), 1e-9);
    near(s.iGen, s.iLine * r, 1e-9, 'the generator current is the line current times the ratio');
    near(s.vGen * s.iGen, 250_000, 1e-6);
  }
});
test('losses fall with the square of the ratio', () => {
  const a = lineState(spec({ vGen: 1000 }), 1).lossW, b = lineState(spec({ vGen: 1000 }), 10).lossW;
  near(a / b, 100, 1e-9);
});
test('power is conserved: sent = lost in the line + delivered, and the load sees vLine less the line drop', () => {
  for (let k = 0; k < 200; k++) {
    const sp = makePowerline(k * 31 + 5);
    for (const r of RATIOS) {
      const s = lineState(sp, r);
      near(s.iLine * s.vLoad + s.lossW, sp.power, 1e-9 * sp.power, `seed ${k} ratio ${r}`);
      near(s.vLoad, s.vLine - s.iLine * sp.lineOhms, 1e-9 * s.vLine);
      near(s.efficiency, (sp.power - s.lossW) / sp.power, 1e-12);
    }
  }
});

console.log('Power line: checking a guess');
test('a ratio that is zero, negative, NaN, infinite or absurdly large is refused (not a guess)', () => {
  for (const bad of [0, -1, -10, NaN, Infinity, -Infinity, 1e9, 1001]) {
    const e = evaluate(spec(), bad);
    assert.equal(e.solved, false, String(bad));
    assert.ok(typeof e.refused === 'string' && e.refused.length > 0, `refused ${bad}`);
  }
  assert.equal(evaluate(spec(), 10).refused, undefined);
});
test('too little voltage fails on loss, too much fails on the insulator rating, the window between solves', () => {
  const sp = spec({ power: 200_000, vGen: 1000, lineOhms: 5, maxLossPct: 4, maxVLine: 30_000 }); // needs I^2 R < 8 kW, so I < 40 A, V > 5 kV; and V <= 30 kV
  const by = Object.fromEntries(RATIOS.map((r) => [r, evaluate(sp, r)]));
  assert.equal(by[2].solved, false); assert.ok(by[2].state!.lossPct > 4);
  assert.equal(by[5].solved, true); assert.equal(by[20].solved, true);
  assert.equal(by[50].solved, false); assert.ok(by[50].state!.vLine > 30_000);
});
test('every seed gives a puzzle with 1 to 3 solving ratios, never ratio 1, and the answer is not always the largest', () => {
  let notMax = 0;
  for (let s = 1; s <= 1000; s++) {
    const sp = makePowerline(s * 6151);
    assert.ok(sp.power >= 20_000 && sp.power <= 500_000, `power ${sp.power}`);
    assert.ok(sp.vGen >= 400 && sp.vGen <= 11_000, `vGen ${sp.vGen}`);
    assert.ok(sp.lineOhms >= 1 && sp.lineOhms <= 20, `line ${sp.lineOhms}`);
    assert.ok(sp.maxLossPct >= 2 && sp.maxLossPct <= 8, `loss ${sp.maxLossPct}`);
    assert.deepEqual(sp.ratios, [1, 2, 5, 10, 20, 25, 50, 100]);
    const good = sp.ratios.filter((r) => evaluate(sp, r).solved);
    assert.ok(good.length >= 1 && good.length <= 3, `seed ${s}: ${good.length}`);
    assert.equal(evaluate(sp, 1).solved, false, `seed ${s}: ratio 1 solves`);
    for (const r of sp.ratios) {
      const st = lineState(sp, r);
      assert.ok(Math.abs(st.lossPct - sp.maxLossPct) >= 0.03 * sp.maxLossPct - 1e-12 && Math.abs(st.vLine - sp.maxVLine) >= 0.03 * sp.maxVLine - 1e-9, `seed ${s}: ratio ${r} sits within 3% of a limit`);
    }
    if (Math.max(...good) < 100) notMax++;
  }
  assert.ok(notMax > 500, `the top ratio is the answer too often (${notMax} of 1000 avoid it)`);
});

console.log(`\n${passed} passed`);
