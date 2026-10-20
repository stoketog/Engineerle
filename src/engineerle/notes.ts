/**
 * The notepad: scratch working a player keeps for each day. It lives on the device only and is never sent anywhere.
 * Everything here is best effort and never throws: a blocked or full store just means the note lasts for this visit.
 */

export const MAX_NOTE = 4000;
export const KEEP_DAYS = 14;
const KEY = 'engineerle:v2:notes';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Only when the browser's store refuses (blocked, full) does the note live in this in-memory copy instead.
const memory = new Map<string, string>();
const read = (s: Storage): string | null => { try { return s.getItem(KEY); } catch { return memory.get(KEY) ?? null; } };
const write = (s: Storage, v: string | null) => {
  try {
    if (v === null) s.removeItem(KEY); else s.setItem(KEY, v);
    memory.delete(KEY);
  } catch {
    if (v === null) memory.delete(KEY); else memory.set(KEY, v);
  }
};

function all(s: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const v = JSON.parse(read(s) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (DATE.test(k) && typeof t === 'string' && t.trim()) out[k] = t.slice(0, MAX_NOTE);
  } catch { /* damaged: start again */ }
  return out;
}

export function loadNote(dateKey: string, storage: Storage = window.localStorage): string {
  return DATE.test(dateKey) ? all(storage)[dateKey] ?? '' : '';
}

export const hasNote = (dateKey: string, storage: Storage = window.localStorage): boolean => loadNote(dateKey, storage) !== '';

export function saveNote(dateKey: string, text: string, storage: Storage = window.localStorage): void {
  if (!DATE.test(dateKey) || typeof text !== 'string') return;
  const notes = all(storage);
  if (text.trim()) notes[dateKey] = text.slice(0, MAX_NOTE);
  else delete notes[dateKey];
  const keep = Object.keys(notes).sort().slice(-KEEP_DAYS);
  const next: Record<string, string> = {};
  for (const k of keep) next[k] = notes[k];
  write(storage, keep.length ? JSON.stringify(next) : null);
}
