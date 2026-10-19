import assert from 'node:assert/strict';
import { nextElapsed, formatClock } from '@/hooks/useStopwatch';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};

console.log('Stopwatch');
test('a visible tick adds its time', () => {
  assert.equal(nextElapsed(10, 250, true), 10.25);
});
test('a long gap (the device slept) adds at most two seconds', () => {
  assert.equal(nextElapsed(10, 3_600_000, true), 12);
  assert.equal(nextElapsed(10, 2000, true), 12);
});
test('nothing is added while the page is hidden', () => {
  assert.equal(nextElapsed(10, 250, false), 10);
});
test('a clock that jumped backwards or is not a number adds nothing', () => {
  assert.equal(nextElapsed(10, -500, true), 10);
  assert.equal(nextElapsed(10, Number.NaN, true), 10);
});
test('the clock reads minutes and seconds', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(59.9), '0:59');
  assert.equal(formatClock(90), '1:30');
  assert.equal(formatClock(3599), '59:59');
  assert.equal(formatClock(3600), '60:00');
  assert.equal(formatClock(-4), '0:00');
});

console.log(`\n${passed} passed`);
