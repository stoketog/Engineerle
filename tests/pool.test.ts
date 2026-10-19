import assert from 'node:assert/strict';
import { POOL, byId, type PuzzleDef, type Discipline } from '@/engineerle/registry';
import { pickDay } from '@/engineerle/select';
import { getEngineerleDaily, ENGINEERLE_EPOCH } from '@/engineerle/daily';
import { addDays } from '@/lib/dates';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};

const mk = (id: string, discipline: Discipline, difficulty: 1 | 2 | 3): PuzzleDef => ({ id, discipline, difficulty, tab: id, title: id, brief: id, parSeconds: 60, make: (seed) => ({ kind: id, seed }) as { kind: string } });
const SIX = [mk('a', 'structures', 1), mk('b', 'mechanical', 2), mk('c', 'electrical', 3), mk('d', 'electronics', 1), mk('e', 'aerospace', 2), mk('f', 'mechanical', 3)];
const dates = (n: number, from = ENGINEERLE_EPOCH) => Array.from({ length: n }, (_, i) => addDays(from, i));
const diffOf = (pool: PuzzleDef[], id: string) => pool.find((p) => p.id === id)!.difficulty;
const discOf = (pool: PuzzleDef[], id: string) => pool.find((p) => p.id === id)!.discipline;

function rules(pool: PuzzleDef[], label: string) {
  const days = dates(400);
  const picks = days.map((d) => pickDay(d, pool));
  const seen = new Set<string>();
  picks.forEach((ids, i) => {
    assert.equal(ids.length, 5, `${label} ${days[i]} has five`);
    assert.equal(new Set(ids).size, 5, `${label} ${days[i]} distinct: ${ids}`);
    ids.forEach((id) => { assert.ok(pool.some((p) => p.id === id), `unknown id ${id}`); seen.add(id); });
    const per: Record<string, number> = {};
    ids.forEach((id) => { const d = discOf(pool, id); per[d] = (per[d] ?? 0) + 1; });
    if (new Set(pool.map((p) => p.discipline)).size >= 3) assert.ok(Math.max(...Object.values(per)) <= 2, `${label} ${days[i]} discipline cap: ${JSON.stringify(per)}`);
    const diffs = ids.map((id) => diffOf(pool, id));
    assert.deepEqual(diffs, [...diffs].sort((a, b) => a - b), `${label} ${days[i]} ordered by difficulty`);
    assert.deepEqual(pickDay(days[i], pool), ids, 'deterministic');
    // Two days of five leave 15 or more puzzles for a fully fresh day; with 10..14 the day before is still never repeated.
    const lookBack = pool.length >= 15 ? 2 : pool.length >= 10 ? 1 : 0;
    for (let back = 1; back <= lookBack; back++) if (i >= back) for (const id of picks[i - back]) assert.ok(!ids.includes(id), `${label} ${days[i]} repeats ${id} from ${back} day(s) ago`);
  });
  assert.equal(seen.size, pool.length, `${label}: every puzzle appears (${seen.size}/${pool.length})`);
}

console.log('Daily selection');
test('the registry holds unique ids and byId finds them', () => {
  assert.equal(new Set(POOL.map((p) => p.id)).size, POOL.length);
  for (const p of POOL) assert.equal(byId(p.id), p);
  assert.throws(() => byId('nope'));
  for (const p of POOL) assert.ok(p.parSeconds >= 30 && p.parSeconds <= 600, `${p.id} par`);
});
test('a six-puzzle pool obeys the rules over 400 days', () => rules(SIX, 'six'));
test('the real pool obeys the rules over 400 days', () => rules(POOL, 'pool'));
test('a pool of exactly five returns those five', () => {
  const five = SIX.slice(0, 5);
  const ids = pickDay('2026-12-01', five);
  assert.deepEqual([...ids].sort(), five.map((p) => p.id).sort());
});
test('dates far in the past and future still give five distinct puzzles', () => {
  for (const d of ['1999-12-31', '2200-02-29', '2026-10-19']) {
    const ids = pickDay(d, SIX);
    assert.equal(new Set(ids).size, 5, d);
  }
});
test('different days differ', () => {
  const sets = new Set(dates(30).map((d) => pickDay(d, SIX).join()));
  assert.ok(sets.size > 5, `${sets.size} distinct days of 30`);
});
test('getEngineerleDaily pairs each picked id with a spec made from the date seed', () => {
  const a = getEngineerleDaily('2026-11-05'), b = getEngineerleDaily('2026-11-05'), c = getEngineerleDaily('2026-11-06');
  assert.equal(a.puzzles.length, 5);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
  assert.deepEqual(a.puzzles.map((p) => p.def.id), pickDay('2026-11-05'));
  assert.equal(a.number, 18);
});
test('every pool puzzle generates a spec for many seeds', () => {
  for (const p of POOL) for (let s = 1; s <= 40; s++) assert.ok(p.make(s * 2654435761 >>> 0).kind, p.id);
});

console.log(`\n${passed} passed`);
