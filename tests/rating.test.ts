import assert from 'node:assert/strict';
import { RATINGS, ratingFor } from '@/engineerle/rating';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n')[0]); process.exitCode = 1; }
};

console.log('The finishing title');
test('only a perfect 500 earns the top title, and nothing below 100 earns more than the bottom one', () => {
  assert.equal(ratingFor(500).title, RATINGS[RATINGS.length - 1].title);
  assert.notEqual(ratingFor(499).title, ratingFor(500).title);
  assert.equal(ratingFor(0).title, RATINGS[0].title);
  assert.equal(ratingFor(99).title, RATINGS[0].title);
  assert.notEqual(ratingFor(100).title, RATINGS[0].title);
});
test('a higher score never gets a lower title, and every score from 0 to 500 gets one with a line of text', () => {
  let last = -1;
  for (let s = 0; s <= 500; s++) {
    const r = ratingFor(s);
    const rank = RATINGS.findIndex((x) => x.title === r.title);
    assert.ok(rank >= 0 && rank >= last, `${s} -> ${r.title}`);
    assert.ok(r.title.length > 0 && r.line.length > 0);
    last = rank;
  }
});
test('nonsense totals are clamped rather than throwing', () => {
  assert.equal(ratingFor(Number.NaN).title, RATINGS[0].title);
  assert.equal(ratingFor(-40).title, RATINGS[0].title);
  assert.equal(ratingFor(9999).title, RATINGS[RATINGS.length - 1].title);
  assert.equal(ratingFor(Infinity).title, RATINGS[RATINGS.length - 1].title);
});
test('the thresholds are strictly increasing, start at 0, and every title is different', () => {
  assert.equal(RATINGS[0].from, 0);
  for (let i = 1; i < RATINGS.length; i++) assert.ok(RATINGS[i].from > RATINGS[i - 1].from);
  assert.equal(new Set(RATINGS.map((r) => r.title)).size, RATINGS.length);
});

console.log(`\n${passed} passed`);
