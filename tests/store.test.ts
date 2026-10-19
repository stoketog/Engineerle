import assert from 'node:assert/strict';
import { emptyStore, recordAttempt, addSeconds, getDay, dayDone, dayPoints, streak, totals, shareText, sanitise, square } from '@/engineerle/store';
import { pickDay } from '@/engineerle/select';
import { engineerleNumber, ENGINEERLE_EPOCH } from '@/engineerle/daily';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const PAR = 90;

console.log('Progress store');
test('a day starts with the five puzzles picked for it', () => {
  const d = getDay(emptyStore(), '2026-11-05');
  assert.deepEqual(d.puzzles.map((p) => p.id), pickDay('2026-11-05'));
  assert.ok(d.puzzles.every((p) => p.attempts === 0 && !p.done && p.points === 0 && p.seconds === 0));
});
test('a solve on guess 2 at 225 s of a par-90 puzzle is worth 46', () => {
  let s = emptyStore();
  s = addSeconds(s, 'd1', 0, 225);
  s = recordAttempt(s, 'd1', 0, false, PAR);
  s = recordAttempt(s, 'd1', 0, true, PAR);
  const p = getDay(s, 'd1').puzzles[0];
  assert.equal(p.points, Math.round(100 * 0.65 * 0.7));
  assert.equal(p.points, 46);
  assert.equal(p.seconds, 225);
  assert.ok(p.done && p.solved && p.attempts === 2);
});
test('100, 65 and 35 for a quick first, second and third guess; nothing when out of guesses', () => {
  let s = emptyStore();
  const k = '2026-11-05';
  s = recordAttempt(s, k, 0, true, PAR);
  s = recordAttempt(s, k, 1, false, PAR); s = recordAttempt(s, k, 1, true, PAR);
  s = recordAttempt(s, k, 2, false, PAR); s = recordAttempt(s, k, 2, false, PAR); s = recordAttempt(s, k, 2, true, PAR);
  for (let i = 0; i < 3; i++) s = recordAttempt(s, k, 3, false, PAR);
  const d = getDay(s, k);
  assert.deepEqual(d.puzzles.map((p) => p.points), [100, 65, 35, 0, 0]);
  assert.ok(!dayDone(d));
  assert.equal(dayPoints(d), 200);
  assert.deepEqual(d.puzzles.map(square), ['🟩', '🟨', '🟧', '⬛', '⬛']);
  assert.equal(JSON.stringify(recordAttempt(s, k, 0, false, PAR)), JSON.stringify(s), 'a finished puzzle cannot be re-scored');
});
test('seconds accumulate, never go negative, and stop once the puzzle is done', () => {
  let s = emptyStore();
  s = addSeconds(s, 'd1', 1, 10); s = addSeconds(s, 'd1', 1, 2.5);
  assert.equal(getDay(s, 'd1').puzzles[1].seconds, 12.5);
  s = addSeconds(s, 'd1', 1, -100);
  assert.equal(getDay(s, 'd1').puzzles[1].seconds, 0);
  s = addSeconds(s, 'd1', 1, Number.NaN);
  assert.equal(getDay(s, 'd1').puzzles[1].seconds, 0);
  s = recordAttempt(s, 'd1', 1, true, PAR);
  const after = addSeconds(s, 'd1', 1, 50);
  assert.equal(getDay(after, 'd1').puzzles[1].seconds, 0, 'a finished puzzle has stopped its clock');
  assert.equal(addSeconds(s, 'd1', 9, 5), s, 'unknown index is ignored');
});
test('streaks, totals and the share text', () => {
  let s = emptyStore();
  for (const k of ['2026-10-19', '2026-10-20', '2026-10-21']) for (let i = 0; i < 5; i++) s = recordAttempt(s, k, i, i !== 3 || k !== '2026-10-20', PAR);
  assert.equal(streak(s, '2026-10-21'), 1, 'day 2 puzzle 3 was attempted once, so that day is not finished');
  for (let i = 0; i < 2; i++) s = recordAttempt(s, '2026-10-20', 3, false, PAR);
  assert.equal(streak(s, '2026-10-21'), 3);
  assert.equal(streak(s, '2026-10-22'), 3, 'today still open keeps yesterday\'s run');
  assert.equal(streak(s, '2026-10-25'), 0);
  const t = totals(s);
  assert.equal(t.played, 3);
  assert.equal(t.perfect, 2);
  assert.equal(t.best, 500);
  const txt = shareText('2026-10-20', getDay(s, '2026-10-20'));
  assert.ok(txt.startsWith(`Engineerle #${engineerleNumber('2026-10-20')}`) && txt.includes('🟩🟩🟩⬛🟩'), txt);
});
test('saved data is cleaned on load', () => {
  for (const bad of [null, 'x', 7, [], { v: 1, days: { '2026-10-19': { puzzles: [{ attempts: 1, solved: true }] } } }]) {
    const s = sanitise(bad);
    assert.equal(s.v, 2);
    assert.deepEqual(s.days, {});
  }
  const s = sanitise({ v: 2, days: { '2026-10-19': { puzzles: [{ attempts: 99, seconds: -5, solved: true }, { attempts: 'x' }, null] }, junk: {} } });
  assert.equal(s.v, 2);
  assert.deepEqual(Object.keys(s.days), ['2026-10-19']);
  const d = s.days['2026-10-19'];
  assert.equal(d.puzzles.length, 5);
  assert.deepEqual(d.puzzles.map((p) => p.id), pickDay('2026-10-19'));
  assert.equal(d.puzzles[0].attempts, 3);
  assert.equal(d.puzzles[0].seconds, 0);
  assert.equal(d.puzzles[0].points, Math.round(100 * 0.35), 'points are recomputed, not trusted');
  assert.equal(d.puzzles[1].attempts, 0);
});
test('a stored record whose puzzle no longer matches that day is reset', () => {
  const ids = pickDay('2026-10-19');
  const s = sanitise({ v: 2, days: { '2026-10-19': { puzzles: [{ id: 'not-a-puzzle', attempts: 2, solved: true, seconds: 10 }, { id: ids[1], attempts: 1, solved: true, seconds: 40 }] } } });
  const d = s.days['2026-10-19'];
  assert.equal(d.puzzles[0].attempts, 0);
  assert.equal(d.puzzles[1].attempts, 1);
  assert.equal(d.puzzles[1].seconds, 40);
});
test('a store survives a JSON round trip unchanged', () => {
  let s = emptyStore();
  s = addSeconds(s, ENGINEERLE_EPOCH, 0, 33);
  s = recordAttempt(s, ENGINEERLE_EPOCH, 0, true, PAR);
  s = recordAttempt(s, ENGINEERLE_EPOCH, 1, false, PAR);
  assert.equal(JSON.stringify(sanitise(JSON.parse(JSON.stringify(s)))), JSON.stringify(s));
});

console.log(`\n${passed} passed`);
