import assert from 'node:assert/strict';
import { BUCKETS, bucketOf, deviceId, fetchDayStats, flushPending, othersAverage, percentileBelow, submitResult, validResult, type DayResult, type Env } from '@/engineerle/stats';

let passed = 0;
const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);

class Mem {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as unknown as Response;
const env = (f: typeof fetch, o: Partial<Env> = {}): Env => ({ url: 'https://example.supabase.co', key: 'sb_publishable_test', fetch: f, storage: new Mem() as unknown as Storage, timeoutMs: 5000, ...o });
const result = (o: Partial<DayResult> = {}): DayResult => ({ day: 12, ids: ['waveform', 'lever', 'rcfilter', 'orbit', 'bridge'], points: [100, 80, 65, 35, 0], guesses: [1, 1, 2, 3, 3], seconds: [40, 80, 100, 150, 300], total: 280, ...o });
const goodStats = () => ({ n: 10, mean: 250, buckets: [0, 0, 5, 5, ...Array(16).fill(0)], perPuzzle: { waveform: { n: 10, mean: 90 }, lever: { n: 9, mean: 70.5 } } });

console.log('Stats: the day results fetch');
test('a thrown fetch, a 500, malformed JSON and a body without buckets all give null', async () => {
  assert.equal(await fetchDayStats(12, env(async () => { throw new Error('offline'); })), null);
  assert.equal(await fetchDayStats(12, env(async () => res(500, { message: 'boom' }))), null);
  assert.equal(await fetchDayStats(12, env(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }) as unknown as Response)), null);
  assert.equal(await fetchDayStats(12, env(async () => res(200, { n: 3, mean: 100, perPuzzle: {} }))), null);
  assert.equal(await fetchDayStats(12, env(async () => res(200, 'null'))), null);
});
test('garbage shapes are refused: wrong bucket count, negative or non-numeric counts, NaN mean', async () => {
  for (const bad of [{ ...goodStats(), buckets: [1, 2, 3] }, { ...goodStats(), buckets: Array(20).fill(-1) }, { ...goodStats(), buckets: Array(20).fill('x') }, { ...goodStats(), mean: 'abc' }, { ...goodStats(), n: -4 }, { ...goodStats(), n: 1e12 }, { ...goodStats(), perPuzzle: 'no' }, [], 'text']) {
    assert.equal(await fetchDayStats(12, env(async () => res(200, bad as unknown))), null, JSON.stringify(bad).slice(0, 60));
  }
});
test('a good body is parsed, with the right request', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const s = await fetchDayStats(12, env(async (url, init) => { seen = { url: String(url), init: init! }; return res(200, goodStats()); }));
  assert.ok(s); assert.equal(s!.n, 10); near(s!.mean, 250); assert.equal(s!.buckets.length, BUCKETS); assert.equal(s!.buckets[2], 5); near(s!.perPuzzle.lever.mean, 70.5);
  assert.equal(seen!.url, 'https://example.supabase.co/rest/v1/rpc/engineerle_day_stats');
  assert.equal(seen!.init.method, 'POST'); assert.deepEqual(JSON.parse(String(seen!.init.body)), { p_day: 12 });
  assert.equal((seen!.init.headers as Record<string, string>).apikey, 'sb_publishable_test');
});
test('a missing configuration gives null without calling fetch', async () => {
  let called = false;
  assert.equal(await fetchDayStats(12, env(async () => { called = true; return res(200, goodStats()); }, { url: '', key: '' })), null);
  assert.equal(called, false);
});
test('it gives up after the timeout even when fetch never answers', async () => {
  const t0 = Date.now();
  const s = await fetchDayStats(12, env(() => new Promise<Response>(() => {}), { timeoutMs: 60 }));
  assert.equal(s, null); assert.ok(Date.now() - t0 < 1500, 'returned promptly');
});
test('a day number that is not a positive integer is not requested', async () => {
  let called = false;
  for (const d of [0, -1, 1.5, NaN, Infinity]) assert.equal(await fetchDayStats(d, env(async () => { called = true; return res(200, goodStats()); })), null);
  assert.equal(called, false);
});

console.log('Stats: sending a result');
test('queued when fetch throws, sent on the retry, skipped the third time', async () => {
  const e = env(async () => { throw new Error('offline'); });
  assert.equal(await submitResult(result(), e), 'queued');
  assert.ok(e.storage.getItem('engineerle:v2:pending'), 'a pending marker is kept');
  e.fetch = async () => res(204, '{}'.replace('{}', 'null'));
  assert.equal(await submitResult(result(), e), 'sent');
  assert.equal(e.storage.getItem('engineerle:v2:pending') === null || !JSON.parse(e.storage.getItem('engineerle:v2:pending')!)['12'], true, 'pending cleared');
  let calls = 0; e.fetch = async () => { calls++; return res(204, 'null'); };
  assert.equal(await submitResult(result(), e), 'skipped'); assert.equal(calls, 0, 'never sends a day twice');
});
test('the request carries the device, the arrays and the total', async () => {
  let body: Record<string, unknown> = {}, url = '';
  const e = env(async (u, init) => { url = String(u); body = JSON.parse(String(init!.body)); return res(204, 'null'); });
  assert.equal(await submitResult(result(), e), 'sent');
  assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/engineerle_submit');
  assert.equal(body.p_day, 12); assert.equal(body.p_total, 280); assert.deepEqual(body.p_points, [100, 80, 65, 35, 0]); assert.deepEqual(body.p_ids, result().ids); assert.deepEqual(body.p_guesses, [1, 1, 2, 3, 3]); assert.deepEqual(body.p_seconds, [40, 80, 100, 150, 300]);
  assert.equal(body.p_device, deviceId(e.storage));
});
test('an HTTP 500 or a timeout queues it; a 400 (the server refused the data) is dropped, not retried forever', async () => {
  const e1 = env(async () => res(503, { message: 'down' })); assert.equal(await submitResult(result(), e1), 'queued');
  const e2 = env(() => new Promise<Response>(() => {}), { timeoutMs: 50 }); assert.equal(await submitResult(result(), e2), 'queued');
  const e3 = env(async () => res(400, { message: 'invalid' })); assert.equal(await submitResult(result(), e3), 'skipped');
  e3.fetch = async () => { throw new Error('should not be called'); }; assert.equal(await submitResult(result(), e3), 'skipped');
});
test('a result the server would refuse is never sent', async () => {
  let called = false; const e = env(async () => { called = true; return res(204, 'null'); });
  for (const bad of [result({ total: 600 }), result({ points: [100, 100, 100, 100, 101], total: 501 }), result({ points: [100, 80, 65, 35] }), result({ ids: ['Waveform', 'lever', 'rcfilter', 'orbit', 'bridge'] }), result({ seconds: [40, 80, 100, 150, 90_000] }), result({ total: 281 }), result({ day: 0 }), result({ guesses: [1, 1, 2, 3, 9] })]) {
    assert.equal(validResult(bad), false); assert.equal(await submitResult(bad, e), 'skipped');
  }
  assert.equal(called, false); assert.equal(validResult(result()), true);
});
test('two retries racing do not both send, and flushPending sends what is waiting', async () => {
  const e = env(async () => { throw new Error('offline'); });
  await submitResult(result({ day: 3 }), e); await submitResult(result({ day: 4 }), e);
  let sent: number[] = []; e.fetch = async (_u, init) => { sent.push(JSON.parse(String(init!.body)).p_day); return res(204, 'null'); };
  await Promise.all([flushPending(e), flushPending(e)]);
  assert.deepEqual(sent.sort(), [3, 4], 'each day exactly once');
});
test('damaged storage is survived: junk in the device id, the pending list and the sent list', async () => {
  const e = env(async () => res(204, 'null'));
  e.storage.setItem('engineerle:v2:device', 'not-a-uuid'); e.storage.setItem('engineerle:v2:pending', '{{{'); e.storage.setItem('engineerle:v2:sent', '"x"');
  assert.match(deviceId(e.storage), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(await submitResult(result(), e), 'sent');
});
test('storage that throws on every call still works (nothing persists, nothing breaks)', async () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } } as unknown as Storage;
  const e = env(async () => res(204, 'null'), { storage: bad });
  assert.ok(deviceId(bad)); assert.equal(await submitResult(result(), e), 'sent');
});
test('the device id is a random UUID, kept once made', () => {
  const m = new Mem() as unknown as Storage; const a = deviceId(m), b = deviceId(m);
  assert.equal(a, b); assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(deviceId(new Mem() as unknown as Storage), a);
});

console.log('Stats: where the player placed');
test('buckets are 25 points wide over 0 to 500, twenty of them', () => {
  assert.equal(BUCKETS, 20); assert.equal(bucketOf(0), 0); assert.equal(bucketOf(24), 0); assert.equal(bucketOf(25), 1); assert.equal(bucketOf(499), 19); assert.equal(bucketOf(500), 19); assert.equal(bucketOf(-5), 0); assert.equal(bucketOf(9999), 19);
});
test('percentile: 10 players, 5 in a lower bucket, 5 in the player\'s: (5 + 2.5) / 10 = 75', () => {
  near(percentileBelow([0, 0, 5, 5, ...Array(16).fill(0)], 80), 75);
});
test('percentile: 8 players, 3 below, 4 in the player\'s bucket, 1 above: (3 + 2) / 8 = 62.5', () => {
  near(percentileBelow([0, 0, 3, 4, 1, ...Array(15).fill(0)], 80), 62.5);
});
test('percentile edges: nobody there, the lowest bucket alone, the top bucket alone', () => {
  assert.equal(percentileBelow(Array(20).fill(0), 100), 0 / 1 || 0); near(percentileBelow([4, ...Array(19).fill(0)], 10), 50); near(percentileBelow([...Array(19).fill(0), 4], 500), 50);
  near(percentileBelow([2, 0, 0, ...Array(17).fill(0)], 300), 100);
});
test('the others\' average takes the player out of the day mean once their result is counted', () => {
  const s = { n: 10, mean: 250, buckets: Array(20).fill(0), perPuzzle: {} };
  near(othersAverage(s, 340, true)!, (2500 - 340) / 9); near(othersAverage(s, 340, false)!, 250);
  assert.equal(othersAverage({ ...s, n: 1, mean: 340 }, 340, true), null, 'no other players yet');
  assert.equal(othersAverage({ ...s, n: 0, mean: 0 }, 340, false), null);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
  }
  console.log(`\n${passed} passed`);
})();
