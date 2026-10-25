// AI plug-in point. The app ships without any AI; this file is where a
// teammate connects theirs. The server and the page already use everything
// exported below, so these are the only places to fill in:
//
// 1. Tags (category filter buttons on the page)
//    Easiest: have any script or tool (Python is fine) write data/tags.json:
//      { "Maryland Volleyball vs Michigan State": ["Sports & Recreation"], ... }
//    keyed by exact event title. The server notices changes to the file within
//    a couple of seconds; reload the page to see them.
//    Or tag titles from JavaScript inside onEventsImported() below.
//
// 2. Personal picks (the "For you" panel)
//    Implement pickEvents() and set aiEnabled to true.
import { watchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';

const TAGS_PATH = new URL('../data/tags.json', import.meta.url);

// Shows the "For you" panel on the page and enables POST /api/picks.
// Turn on once pickEvents() works.
export const aiEnabled = false;

// Tags that get a filter button, in this order. Change freely. Tags in
// data/tags.json that aren't listed still show on events, just without a button.
export const TAGS = [
  'Academic & Lectures',
  'Arts & Performances',
  'Exhibitions',
  'Sports & Recreation',
  'Career & Professional',
  'Health & Wellness',
  'Social & Community',
  'Workshops & Training',
  'Science & Research',
  'Culture & Identity',
  'Deadlines & Admin',
];

let tagCache = {};
await loadTagFile();
watchFile(TAGS_PATH, { interval: 2000 }, loadTagFile);

async function loadTagFile() {
  try {
    tagCache = JSON.parse(await readFile(TAGS_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') tagCache = {};
    else console.warn(`[ai] couldn't read data/tags.json: ${err.message}`);
  }
}

// Tags for one event title, or null if it has none.
export function tagsFor(title) {
  return tagCache[title] ?? null;
}

// Called with the full event list every time events are imported (at startup,
// hourly, and on "Update events"). Event objects look like:
//   { id, title, allDay, start, end, startDate, endDate, multiDay }
// Does nothing yet. An AI tagger could tag new titles here and save them to
// data/tags.json.
export async function onEventsImported(events) {}

// The page shows "Tagging events…" while running is true, and an error note
// when failed is true. Only matters if tagging happens in onEventsImported().
export function taggingStatus() {
  return { running: false, failed: false };
}

// Given a student's interests (free text, up to 500 characters) and the events
// in the next two weeks (one per title), return up to 6 recommendations:
//   [{ id: "<event id>", reason: "One sentence on why it fits you." }, ...]
export async function pickEvents(events, interests) {
  throw new Error('Picks are not set up yet: implement pickEvents() in lib/ai.js');
}
