import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, guessFactor, puzzlePoints, timeFactor } from '@/engineerle/scoring';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n')[0]); process.exitCode = 1; }
};

console.log('Scoring');
test('a solve is worth 100 x guess factor x time factor', () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(puzzlePoints(1, 0, 90), 100);
  assert.equal(puzzlePoints(1, 90, 90), 100, 'par time is still full marks');
  assert.equal(puzzlePoints(1, 360, 90), 40, 'four times par is the floor');
  assert.equal(puzzlePoints(1, 9999, 90), 40, 'slower than that costs nothing more');
  assert.equal(puzzlePoints(2, 90, 90), 65);
  assert.equal(puzzlePoints(3, 90, 90), 35);
  assert.equal(puzzlePoints(3, 360, 90), 14, 'the least a solve can score');
  assert.equal(puzzlePoints(2, 225, 90), 46, '100 x 0.65 x 0.7 = 45.5 rounds up');
});
test('the time factor falls in a straight line from par to four times par', () => {
  assert.equal(timeFactor(0, 90), 1);
  assert.equal(timeFactor(90, 90), 1);
  assert.equal(timeFactor(225, 90), 0.7);
  assert.equal(timeFactor(360, 90), 0.4);
  assert.equal(timeFactor(1e9, 90), 0.4);
  let last = 1;
  for (let s = 0; s <= 400; s += 5) {
    const f = timeFactor(s, 90);
    assert.ok(f <= last + 1e-12 && f >= 0.4 - 1e-12, `not monotone at ${s}s`);
    last = f;
  }
});
test('the guess factor is 1, 0.65, 0.35 and clamps odd input to those', () => {
  assert.deepEqual([1, 2, 3].map(guessFactor), [1, 0.65, 0.35]);
  assert.equal(guessFactor(0), 1);
  assert.equal(guessFactor(-4), 1);
  assert.equal(guessFactor(4), 0.35);
  assert.equal(guessFactor(NaN), 1);
  assert.equal(guessFactor(2.9), 0.65, 'whole guesses only');
});
test('bad times and pars never produce NaN or more than 100', () => {
  for (const s of [NaN, -5, Infinity, -Infinity]) for (const par of [NaN, 0, -1, 90]) {
    const p = puzzlePoints(1, s, par);
    assert.ok(Number.isInteger(p) && p >= 14 && p <= 100, `${s}/${par} -> ${p}`);
  }
  for (let a = 1; a <= 3; a++) for (let s = 0; s <= 1000; s += 7) {
    const p = puzzlePoints(a, s, 60);
    assert.ok(p >= 14 && p <= 100);
  }
});

console.log(`\n${passed} passed`);
