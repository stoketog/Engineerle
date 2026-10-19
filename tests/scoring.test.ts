import assert from 'node:assert/strict';
import { guessFactor, timeFactor, puzzlePoints } from '@/engineerle/scoring';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};

console.log('Scoring');
test('a first-guess solve inside par time is worth the full 100', () => {
  assert.equal(puzzlePoints(1, 0, 90), 100);
  assert.equal(puzzlePoints(1, 90, 90), 100);
});
test('time costs points linearly after par, down to 40% at four times par, and no further', () => {
  assert.equal(puzzlePoints(1, 360, 90), 40);
  assert.equal(puzzlePoints(1, 9999, 90), 40);
  assert.equal(timeFactor(225, 90), 0.7);
  assert.equal(timeFactor(90, 90), 1);
  assert.equal(timeFactor(180, 90), 1 - 0.6 / 3);
});
test('later guesses are worth less: 1, 0.65 and 0.35 of the time score', () => {
  assert.equal(puzzlePoints(2, 90, 90), 65);
  assert.equal(puzzlePoints(3, 90, 90), 35);
  assert.equal(puzzlePoints(3, 360, 90), 14);
  assert.equal(puzzlePoints(2, 225, 90), 46);
  assert.deepEqual([1, 2, 3].map(guessFactor), [1, 0.65, 0.35]);
});
test('guess numbers outside 1..3 clamp', () => {
  assert.equal(puzzlePoints(0, 90, 90), puzzlePoints(1, 90, 90));
  assert.equal(puzzlePoints(4, 90, 90), puzzlePoints(3, 90, 90));
  assert.equal(guessFactor(-5), 1);
  assert.equal(guessFactor(99), 0.35);
});
test('a time that is not a number does not break the score', () => {
  assert.equal(puzzlePoints(1, Number.NaN, 90), 100);
  assert.equal(puzzlePoints(1, -10, 90), 100);
});
test('points never leave 0..100 and fall as time or guesses rise', () => {
  for (let g = 1; g <= 3; g++) {
    let prev = 101;
    for (let s = 0; s <= 600; s += 5) {
      const p = puzzlePoints(g, s, 120);
      assert.ok(p >= 0 && p <= 100 && p <= prev, `${g} ${s} ${p}`);
      prev = p;
    }
  }
});

console.log(`\n${passed} passed`);
