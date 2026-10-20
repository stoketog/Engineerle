/**
 * Daily statistics: send a finished day to the stats service and read back how everyone did.
 *
 * The service is a small Supabase project reached over plain `fetch` (two RPC functions, no table access for the
 * browser). Everything here is best effort: the game never waits for it, every failure ends in `null`, `'queued'`
 * or `'skipped'`, and a result that did not get through is kept and tried again later without ever creating a second
 * row (the database keeps one row per device per day, and this module sends each day at most once after it succeeds).
 */

export const BUCKETS = 20;
export const BUCKET_WIDTH = 25;
const PER_DAY = 5;
const ID = /^[a-z]{2,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const K_DEVICE = 'engineerle:v2:device';
const K_PENDING = 'engineerle:v2:pending';
const K_SENT = 'engineerle:v2:sent';

export interface DayResult {
  /** Engineerle number of the day. */
  day: number;
  ids: string[];
  points: number[];
  guesses: number[];
  seconds: number[];
  total: number;
}

export interface DayStats {
  /** Players who finished the day. */
  n: number;
  /** Their mean total (0 to 500). */
  mean: number;
  /** Counts per 25-point bucket, 0 to 500. */
  buckets: number[];
  perPuzzle: Record<string, { n: number; mean: number }>;
}

export interface Env {
  url: string;
  key: string;
  fetch: typeof fetch;
  storage: Storage;
  timeoutMs: number;
}

// ---------- storage that never throws ----------

const memory = new Map<string, string>();
const get = (s: Storage, k: string): string | null => { try { return s.getItem(k); } catch { return memory.get(k) ?? null; } };
const set = (s: Storage, k: string, v: string) => { try { s.setItem(k, v); } catch { memory.set(k, v); } };
const del = (s: Storage, k: string) => { try { s.removeItem(k); } catch { memory.delete(k); } };

function browserStorage(): Storage {
  try { if (typeof window !== 'undefined' && window.localStorage) return window.localStorage; } catch { /* blocked */ }
  return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k), clear: () => memory.clear(), key: () => null, length: 0 } as Storage;
}

/** Where the service lives, from the two public environment variables; empty (so every call is skipped) when unset. */
export function defaultEnv(): Env {
  const url = (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL : '') || '';
  const key = (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : '') || '';
  return { url: url.replace(/\/+$/, ''), key, fetch: (...a) => fetch(...a), storage: browserStorage(), timeoutMs: 5000 };
}

// ---------- device id ----------

let fallbackDevice: string | null = null;
function randomUuid(): string {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const b = new Uint8Array(16);
  try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b); else throw new Error('none'); } catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A random id for this device, made once. It only lets the service keep one row per device per day. */
export function deviceId(storage: Storage = browserStorage()): string {
  const saved = get(storage, K_DEVICE);
  if (saved && UUID.test(saved)) return saved.toLowerCase();
  const id = fallbackDevice ?? randomUuid();
  set(storage, K_DEVICE, id);
  // if the browser refuses to remember it, keep it for this page at least so a retry is the same device
  const check = get(storage, K_DEVICE);
  if (check !== id) fallbackDevice = id;
  return id;
}

// ---------- the request ----------

async function call(env: Env, name: string, body: unknown): Promise<Response> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: env.key };
  if (env.key.startsWith('eyJ')) headers.Authorization = `Bearer ${env.key}`;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ctl?.abort(); rej(new Error('timeout')); }, env.timeoutMs); });
  try {
    return await Promise.race([env.fetch(`${env.url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl?.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const configured = (env: Env) => !!env.url && !!env.key;

// ---------- reading the day ----------

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1e9;

function parseStats(raw: unknown): DayStats | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isCount(o.n)) return null;
  if (typeof o.mean !== 'number' || !Number.isFinite(o.mean) || o.mean < 0 || o.mean > 500.0001) return null;
  if (!Array.isArray(o.buckets) || o.buckets.length !== BUCKETS || !o.buckets.every(isCount)) return null;
  const buckets = o.buckets as number[];
  if (buckets.reduce((a, b) => a + b, 0) !== o.n) return null;
  const perPuzzle: DayStats['perPuzzle'] = {};
  if (o.perPuzzle !== undefined) {
    if (!o.perPuzzle || typeof o.perPuzzle !== 'object' || Array.isArray(o.perPuzzle)) return null;
    for (const [id, v] of Object.entries(o.perPuzzle as Record<string, unknown>)) {
      const e = v as { n?: unknown; mean?: unknown } | null;
      if (ID.test(id) && e && isCount(e.n) && typeof e.mean === 'number' && Number.isFinite(e.mean) && e.mean >= 0 && e.mean <= 100.0001) perPuzzle[id] = { n: e.n, mean: e.mean };
    }
  }
  return { n: o.n, mean: o.mean, buckets: buckets.slice(), perPuzzle };
}

/** How everyone did on a day, or null for any failure (offline, slow, refused, or a reply that is not what was promised). */
export async function fetchDayStats(day: number, env: Env = defaultEnv()): Promise<DayStats | null> {
  if (!configured(env) || !Number.isInteger(day) || day < 1) return null;
  try {
    const r = await call(env, 'engineerle_day_stats', { p_day: day });
    if (!r.ok) return null;
    return parseStats(await r.json());
  } catch {
    return null;
  }
}

// ---------- sending the day ----------

export function validResult(r: DayResult): boolean {
  if (!r || !Number.isInteger(r.day) || r.day < 1 || r.day > 100_000) return false;
  const arr = (a: unknown): a is unknown[] => Array.isArray(a) && a.length === PER_DAY;
  if (!arr(r.ids) || !arr(r.points) || !arr(r.guesses) || !arr(r.seconds)) return false;
  if (!r.ids.every((i) => typeof i === 'string' && ID.test(i)) || new Set(r.ids).size !== PER_DAY) return false;
  if (!r.points.every((p) => Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 100)) return false;
  if (!r.guesses.every((g) => Number.isInteger(g) && (g as number) >= 0 && (g as number) <= 3)) return false;
  if (!r.seconds.every((s) => Number.isInteger(s) && (s as number) >= 0 && (s as number) <= 86_400)) return false;
  const sum = (r.points as number[]).reduce((a, b) => a + b, 0);
  return Number.isInteger(r.total) && r.total >= 0 && r.total <= 500 && r.total === sum;
}

function readSent(s: Storage): number[] {
  try { const v = JSON.parse(get(s, K_SENT) ?? '[]'); return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : []; } catch { return []; }
}
function readPending(s: Storage): Record<string, DayResult> {
  try {
    const v = JSON.parse(get(s, K_PENDING) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, DayResult> = {};
    for (const [k, r] of Object.entries(v as Record<string, DayResult>)) if (validResult(r) && String(r.day) === k) out[k] = r;
    return out;
  } catch { return {}; }
}
const markSent = (s: Storage, day: number) => { const sent = readSent(s); if (!sent.includes(day)) set(s, K_SENT, JSON.stringify([...sent, day].slice(-400))); };
const setPending = (s: Storage, r: DayResult | null, day: number) => {
  const p = readPending(s);
  if (r) p[String(day)] = r; else delete p[String(day)];
  if (Object.keys(p).length) set(s, K_PENDING, JSON.stringify(p)); else del(s, K_PENDING);
};

const flights = new WeakMap<Storage, Map<number, Promise<'sent' | 'queued' | 'skipped'>>>();

/**
 * Send the finished day once. 'sent': it reached the service. 'queued': it did not, a copy is kept and the next call
 * (or flushPending) tries again. 'skipped': nothing to do (already sent, refused as invalid, not configured).
 */
export function submitResult(r: DayResult, env: Env = defaultEnv()): Promise<'sent' | 'queued' | 'skipped'> {
  if (!validResult(r) || !configured(env)) return Promise.resolve('skipped');
  if (readSent(env.storage).includes(r.day)) return Promise.resolve('skipped');
  let m = flights.get(env.storage);
  if (!m) flights.set(env.storage, (m = new Map()));
  const running = m.get(r.day);
  if (running) return running;
  const p = (async () => {
    try {
      const res = await call(env, 'engineerle_submit', { p_day: r.day, p_device: deviceId(env.storage), p_ids: r.ids, p_points: r.points, p_guesses: r.guesses, p_seconds: r.seconds, p_total: r.total });
      if (res.ok) { markSent(env.storage, r.day); setPending(env.storage, null, r.day); return 'sent' as const; }
      // the service looked at it and said no: do not keep asking (anything but a "try later" status)
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) { markSent(env.storage, r.day); setPending(env.storage, null, r.day); return 'skipped' as const; }
    } catch { /* offline, slow or blocked: keep it for later */ }
    setPending(env.storage, r, r.day);
    return 'queued' as const;
  })().finally(() => m!.delete(r.day));
  m.set(r.day, p);
  return p;
}

/** Try again every result that did not get through. Safe to call as often as you like. */
export async function flushPending(env: Env = defaultEnv()): Promise<void> {
  const pending = readPending(env.storage);
  await Promise.all(Object.values(pending).map((r) => submitResult(r, env)));
}

// ---------- reading the numbers ----------

export const bucketOf = (total: number) => Math.min(BUCKETS - 1, Math.max(0, Math.floor((Number.isFinite(total) ? total : 0) / BUCKET_WIDTH)));

/** Percent of the day's players this total beats: everyone in a lower bucket plus half of those in the same bucket. */
export function percentileBelow(buckets: number[], total: number): number {
  const n = buckets.reduce((a, b) => a + b, 0);
  if (n <= 0) return 0;
  const b = bucketOf(total);
  let below = 0;
  for (let i = 0; i < b; i++) below += buckets[i] ?? 0;
  return ((below + (buckets[b] ?? 0) / 2) / n) * 100;
}

/** The day's mean score of everyone but the player, or null when nobody else has played. */
export function othersAverage(stats: DayStats, myTotal: number, mineIncluded: boolean): number | null {
  if (mineIncluded) return stats.n > 1 ? Math.min(500, Math.max(0, (stats.n * stats.mean - myTotal) / (stats.n - 1))) : null;
  return stats.n > 0 ? stats.mean : null;
}
