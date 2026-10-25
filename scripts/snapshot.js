// Saves the current live feed to data/snapshot.ics, which the server falls back
// to when calendar.umd.edu is unreachable (e.g. flaky Wi-Fi during judging).
import { writeFile } from 'node:fs/promises';
import { FEED_URL, SNAPSHOT_PATH } from '../lib/feed.js';
import { parseIcs } from '../lib/ics.js';

const res = await fetch(FEED_URL);
if (!res.ok) throw new Error(`Fetching ${FEED_URL} failed: HTTP ${res.status}`);
const text = await res.text();
await writeFile(SNAPSHOT_PATH, text);
console.log(`Saved ${parseIcs(text).length} events to data/snapshot.ics`);
