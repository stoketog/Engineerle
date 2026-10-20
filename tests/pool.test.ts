import assert from 'node:assert/strict';
import { POOL, byId, type Discipline, type PuzzleDef } from '@/engineerle/registry';
import { pickDay } from '@/engineerle/select';
import { getEngineerleDaily } from '@/engineerle/daily';
import { addDays } from '@/lib/dates';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n')[0]); process.exitCode = 1; }
};

/** A pool shaped like the finished one: 13 puzzles over five disciplines. */
const SHAPE: Array<[Discipline, 1 | 2 | 3]> = [
  ['structures', 3], ['structures', 2], ['mechanical', 1], ['mechanical', 3], ['mechanical', 1],
  ['electrical', 1], ['electrical', 1], ['electronics', 1], ['electronics', 2], ['electronics', 2],
  ['aerospace', 2], ['aerospace', 3], ['aerospace', 2],
  // extra puzzles, for the roomy-pool test
  ['structures', 2], ['structures', 1], ['mechanical', 2], ['electrical', 3], ['electronics', 3], ['aerospace', 1], ['aerospace', 3],
];
const letters = 'abcdefghijklmnopqrstuvwxyz';
const fake = (n: number): PuzzleDef[] => SHAPE.slice(0, n).map(([discipline, difficulty], i) => ({
  id: `p${letters[i]}`, discipline, difficulty, tab: `T${i}`, title: `Title ${i}`, brief: 'brief', parSeconds: 90, make: () => ({ kind: 'fake' }),
}));
const START = '2026-10-19';
const days = (n: number, from = START) => Array.from({ length: n }, (_, i) => addDays(from, i));

console.log('The pool');
test('the registry has distinct, well-formed puzzles and byId finds them', () => {
  assert.ok(POOL.length >= 5);
  assert.equal(new Set(POOL.map((p) => p.id)).size, POOL.length);
  for (const p of POOL) {
    assert.match(p.id, /^[a-z]{2,20}$/);
    assert.ok(p.parSeconds >= 30 && p.parSeconds <= 300, p.id);
    assert.ok(p.title && p.tab && p.brief);
    assert.equal(byId(p.id), p);
  }
  assert.equal(byId('nope'), undefined);
});

console.log('Choosing the day');
test('five different puzzles a day, never more than two from one discipline', () => {
  const pool = fake(13);
  for (const d of days(400)) {
    const ids = pickDay(d, pool);
    assert.equal(ids.length, 5, d);
    assert.equal(new Set(ids).size, 5, `${d} repeats a puzzle`);
    const per = new Map<string, number>();
    for (const id of ids) {
      const disc = pool.find((p) => p.id === id)!.discipline;
      per.set(disc, (per.get(disc) ?? 0) + 1);
    }
    assert.ok(Math.max(...per.values()) <= 2, `${d} has three of one discipline`);
  }
});
test('a puzzle is never repeated from yesterday, and from the day before only when the pool is too small to avoid it', () => {
  for (const [n, allowedFromDayBefore] of [[13, 2], [20, 0]] as const) {
    const pool = fake(n);
    const ds = days(400);
    let worst = 0;
    for (let i = 2; i < ds.length; i++) {
      const today = pickDay(ds[i], pool);
      const yesterday = new Set(pickDay(ds[i - 1], pool)), before = new Set(pickDay(ds[i - 2], pool));
      for (const id of today) assert.ok(!yesterday.has(id), `${n} puzzles, ${ds[i]}: ${id} was on yesterday's list`);
      worst = Math.max(worst, today.filter((id) => before.has(id)).length);
    }
    assert.ok(worst <= allowedFromDayBefore, `${n} puzzles: up to ${worst} came back from the day before`);
  }
});
test('the day runs from the more approachable puzzles to the more demanding', () => {
  const pool = fake(13);
  for (const d of days(200)) {
    const diffs = pickDay(d, pool).map((id) => pool.find((p) => p.id === id)!.difficulty);
    for (let i = 1; i < diffs.length; i++) assert.ok(diffs[i] >= diffs[i - 1], `${d}: ${diffs}`);
  }
});
test('the same date gives the same set every time, and the days differ', () => {
  const pool = fake(13);
  const a = pickDay('2026-11-05', pool), b = pickDay('2026-11-05', pool);
  assert.deepEqual(a, b);
  assert.notDeepEqual(pickDay('2026-11-06', pool).slice().sort(), a.slice().sort());
  // asking for a later day first must not change an earlier day
  const late = pickDay('2027-02-01', pool);
  assert.deepEqual(pickDay('2026-11-05', pool), a);
  assert.deepEqual(pickDay('2027-02-01', pool), late);
});
test('over a long run every puzzle in the pool gets its turn', () => {
  const pool = fake(13);
  const seen = new Set<string>();
  for (const d of days(400)) pickDay(d, pool).forEach((id) => seen.add(id));
  assert.equal(seen.size, 13);
});
test('small pools still give five different puzzles, or all there are', () => {
  for (const n of [5, 6, 8, 11]) for (const d of days(60)) assert.equal(new Set(pickDay(d, fake(n))).size, 5, `${n} puzzles on ${d}`);
  assert.deepEqual(pickDay(START, fake(5)).slice().sort(), fake(5).map((p) => p.id).sort());
  assert.deepEqual(pickDay(START, fake(3)).slice().sort(), fake(3).map((p) => p.id).sort());
  assert.deepEqual(pickDay(START, []), []);
});
test('odd dates (long ago, far ahead, not a date) still give five different puzzles, quickly', () => {
  const pool = fake(13);
  const t0 = Date.now();
  for (const d of ['1999-01-01', '2200-12-31', '2026-02-30', 'tomorrow', '', '2026-10-19']) {
    const ids = pickDay(d, pool);
    assert.equal(new Set(ids).size, 5, d);
  }
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
});
test('the real pool gives a valid day on every date', () => {
  for (const d of days(120)) {
    const ids = pickDay(d);
    assert.equal(new Set(ids).size, 5);
    ids.forEach((id) => assert.ok(byId(id), id));
  }
});

console.log('The daily set');
test('everyone gets the same five puzzles on a day, built from the date alone', () => {
  const a = getEngineerleDaily('2026-10-20'), b = getEngineerleDaily('2026-10-20'), c = getEngineerleDaily('2026-10-21');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
  assert.equal(a.puzzles.length, 5);
  assert.deepEqual(a.puzzles.map((p) => p.def.id), pickDay('2026-10-20'));
  assert.equal(a.number, 2);
  assert.equal(getEngineerleDaily('2026-10-19').number, 1);
});
test('a puzzle built for a date does not depend on where it sits in the day', () => {
  const a = getEngineerleDaily('2026-10-20');
  for (const p of a.puzzles) {
    const alone = getEngineerleDaily('2026-10-20', [p.def]);
    assert.equal(JSON.stringify(alone.puzzles[0].spec), JSON.stringify(p.spec), p.def.id);
  }
});

console.log('Growing the pool');
test('a puzzle added with a start date changes no earlier day, and joins the pool from its date', () => {
  const grown: PuzzleDef[] = [...POOL, { ...POOL[0], id: 'pumpx', since: '2027-03-01' }];
  for (const d of days(500)) {
    if (d < '2027-03-01') assert.deepEqual(pickDay(d, grown), pickDay(d, POOL), `${d} is unchanged`);
  }
  assert.ok(days(120, '2027-03-01').some((d) => pickDay(d, grown).includes('pumpx')), 'it is served once it has started');
  assert.ok(days(120, '2027-03-01').every((d) => new Set(pickDay(d, grown)).size === 5), 'still five different ones');
});
test('a retired puzzle (until) stops being served from its end date and leaves earlier days alone', () => {
  const kept = POOL.find((p) => p.id === 'lever')!;
  const retired: PuzzleDef[] = POOL.map((p) => (p === kept ? { ...p, until: '2027-01-15' } : p));
  for (const d of days(400)) {
    if (d < '2027-01-15') assert.deepEqual(pickDay(d, retired), pickDay(d, POOL), `${d} is unchanged`);
    else assert.ok(!pickDay(d, retired).includes('lever'), `${d} has no lever`);
  }
});

console.log(`\n${passed} passed`);
