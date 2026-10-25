import { readFile, stat } from 'node:fs/promises';
import { parseIcs } from './ics.js';

export const FEED_URL = 'https://calendar.umd.edu/ics';
export const SNAPSHOT_PATH = new URL('../data/snapshot.ics', import.meta.url);

const REFRESH_MS = 60 * 60 * 1000; // re-fetch the live feed hourly
const RETRY_MS = 5 * 60 * 1000; // after a failure, try again sooner
const MIN_MANUAL_GAP_MS = 30 * 1000; // repeated "Update" clicks reuse a fetch this recent

let state = { events: [], source: null, fetchedAt: null };
let nextRefresh = 0;
let inflight = null;
const listeners = [];

// Called with the new event list every time the feed is (re)loaded.
export function onEventsLoaded(fn) {
  listeners.push(fn);
}

// Returns the cached feed, refreshing it in the background when stale.
// Only the very first call waits for the network.
export async function getEvents() {
  if (Date.now() >= nextRefresh) {
    inflight ??= refresh().finally(() => { inflight = null; });
    if (!state.source) await inflight;
  }
  return state;
}

// Fetches the live feed right away (the page's "Update events" button) and
// reports how many events are new since the previous load.
export async function refreshNow() {
  const before = new Set(state.events.map((e) => e.id));
  const recent = state.source === 'live' && Date.now() - Date.parse(state.fetchedAt) < MIN_MANUAL_GAP_MS;
  const result = recent ? { ok: true } : await (inflight ??= refresh().finally(() => { inflight = null; }));
  return {
    ...result,
    added: state.events.filter((e) => !before.has(e.id)).length,
    total: state.events.length,
    source: state.source,
    fetchedAt: state.fetchedAt,
  };
}

// Returns { ok: true } or { ok: false, error } for the live fetch.
async function refresh() {
  let result = { ok: true };
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = parseIcs(await res.text());
    if (!events.length) throw new Error('feed contained no events');
    state = { events, source: 'live', fetchedAt: new Date().toISOString() };
    nextRefresh = Date.now() + REFRESH_MS;
  } catch (err) {
    console.warn(`[feed] live fetch failed (${err.message})`);
    result = { ok: false, error: err.message };
    nextRefresh = Date.now() + RETRY_MS;
    if (state.source) return result; // keep serving what we already have
    const [text, info] = await Promise.all([readFile(SNAPSHOT_PATH, 'utf8'), stat(SNAPSHOT_PATH)]);
    state = { events: parseIcs(text), source: 'snapshot', fetchedAt: info.mtime.toISOString() };
    console.warn(`[feed] serving saved snapshot from ${state.fetchedAt}`);
  }
  for (const fn of listeners) fn(state.events);
  return result;
}
