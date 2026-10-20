import assert from 'node:assert/strict';
import { KEEP_DAYS, MAX_NOTE, hasNote, loadNote, saveNote } from '@/engineerle/notes';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n')[0]); process.exitCode = 1; }
};
class Mem {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const mem = () => new Mem() as unknown as Storage;
const KEY = 'engineerle:v2:notes';
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;

console.log('The notepad');
test('a note is kept for its own day and for no other', () => {
  const s = mem();
  assert.equal(loadNote(day(5), s), '');
  saveNote(day(5), '2πfRC = 1\nR = 1/(2π·1k·0.1µ)', s);
  assert.equal(loadNote(day(5), s), '2πfRC = 1\nR = 1/(2π·1k·0.1µ)');
  assert.equal(loadNote(day(6), s), '');
  assert.equal(hasNote(day(5), s), true);
  assert.equal(hasNote(day(6), s), false);
});
test('emptying a note removes it, and a note that is only blank space counts as empty', () => {
  const s = mem();
  saveNote(day(5), 'x', s); saveNote(day(5), '', s);
  assert.equal(hasNote(day(5), s), false); assert.equal(s.getItem(KEY), null);
  saveNote(day(5), '   \n  ', s); assert.equal(hasNote(day(5), s), false);
});
test('a note is cut to the length limit', () => {
  const s = mem();
  saveNote(day(5), 'a'.repeat(MAX_NOTE + 500), s);
  assert.equal(loadNote(day(5), s).length, MAX_NOTE);
});
test('only the most recent days are kept', () => {
  const s = mem();
  for (let d = 1; d <= KEEP_DAYS + 6; d++) saveNote(day(d), `note ${d}`, s);
  assert.equal(hasNote(day(1), s), false, 'the oldest is dropped');
  assert.equal(hasNote(day(KEEP_DAYS + 6), s), true, 'the newest stays');
  assert.equal(Object.keys(JSON.parse(s.getItem(KEY)!)).length, KEEP_DAYS);
});
test('damaged storage reads as an empty notepad and is repaired by the next save', () => {
  for (const bad of ['{{{ nope', '[]', '"x"', '42', 'null', JSON.stringify({ [day(5)]: 12, 'not a date': 'x', [day(6)]: 'fine' })]) {
    const s = mem(); s.setItem(KEY, bad);
    assert.equal(loadNote(day(5), s), '', bad);
    saveNote(day(7), 'ok', s);
    assert.equal(loadNote(day(7), s), 'ok', bad);
  }
  const s = mem(); s.setItem(KEY, JSON.stringify({ [day(6)]: 'fine', 'not a date': 'x' }));
  assert.equal(loadNote(day(6), s), 'fine'); assert.equal(loadNote('not a date', s), '');
});
test('storage that throws never throws out of here, and the note is still kept for this visit', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } } as unknown as Storage;
  assert.doesNotThrow(() => saveNote(day(5), 'kept', broken));
  assert.equal(loadNote(day(5), broken), 'kept');
  assert.doesNotThrow(() => hasNote(day(5), broken));
});
test('a bad date key or a non-string note is refused quietly', () => {
  const s = mem();
  saveNote('nope', 'x', s); saveNote(day(5), 42 as unknown as string, s);
  assert.equal(s.getItem(KEY), null);
});

console.log(`\n${passed} passed`);
