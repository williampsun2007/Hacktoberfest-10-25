// Gemma-powered features: auto-tagging event titles and personal picks.
// Everything here is optional; without GEMINI_API_KEY the app still works,
// just without tags and picks.
//
// Gemma on the Gemini API has no system instructions, no JSON response mode
// and no thinking_budget, so every instruction goes in the user prompt and
// the JSON is parsed out of plain text. Each call takes ~100s (the model
// thinks first) and the free tier allows only a few requests per minute, so
// keep calls few and large.
import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile } from 'node:fs/promises';

const MODEL = 'gemma-4-26b-a4b-it';
const TAGS_PATH = new URL('../data/tags.json', import.meta.url);
const TAG_BATCH_SIZE = 110; // 214 titles in the current feed -> 2 calls

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

const apiKey = process.env.GEMINI_API_KEY;
export const aiEnabled = Boolean(apiKey);
const client = aiEnabled
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 240_000, // a normal call is ~100s; give up on stuck ones
        // On 429 (free-tier rate limit) or 5xx, wait and retry: ~20s, then ~40s.
        retryOptions: { attempts: 3, initialDelay: 20, maxDelay: 60 },
      },
    })
  : null;

// One request whose answer should be a JSON array. Returns the parsed array.
async function askJsonArray(prompt) {
  const response = await client.models.generateContent({ model: MODEL, contents: prompt });
  return parseJsonArray(response.text ?? '');
}

// Gemma's JSON comes back as free text, sometimes in ```json fences or with a
// sentence around it. Take everything from the first [ to the last ].
export function parseJsonArray(text) {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('[');
  const end = unfenced.lastIndexOf(']');
  if (start === -1 || end < start) throw new Error(`Gemma reply had no JSON array: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(unfenced.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Gemma reply was not a JSON array');
  return parsed;
}

// The SDK's error message is the raw JSON response body; the useful part
// (e.g. "API key not valid") is its error.message.
export function describeError(err) {
  try {
    const message = [JSON.parse(err.message)].flat()[0]?.error?.message;
    if (message) return `${err.status} ${message}`;
  } catch {
    // Not a JSON body; fall through.
  }
  return err.message;
}

// ---------------------------------------------------------------------------
// Auto-tagging. Tags are cached per title in data/tags.json, so each title is
// sent to Gemma once. Commit that file and tags keep working with no API key.

let tagCache = {};
let tagging = null;
let tagFailed = false;

try {
  tagCache = JSON.parse(await readFile(TAGS_PATH, 'utf8'));
} catch {
  // No cache yet.
}

export function tagsFor(title) {
  return tagCache[title] ?? null;
}

export function taggingStatus() {
  return { running: Boolean(tagging), failed: tagFailed };
}

// Tags any titles not already in the cache. Runs in the background; safe to
// call repeatedly (overlapping calls share one run).
export function tagNewTitles(events) {
  if (!client || tagging) return tagging;

  tagFailed = false;
  tagging = (async () => {
    const todo = [...new Set(events.map((e) => e.title))].filter((t) => !tagCache[t]);
    if (!todo.length) return;
    console.log(`[ai] tagging ${todo.length} new titles`);

    for (let i = 0; i < todo.length; i += TAG_BATCH_SIZE) {
      const batch = todo.slice(i, i + TAG_BATCH_SIZE);
      const results = await askJsonArray(
        'You categorize events from the University of Maryland, College Park campus calendar so students can filter them.\n\n' +
          'Give each event title below 1 to 3 tags. Use only these tags, spelled exactly as written:\n' +
          TAGS.map((t) => `- ${t}`).join('\n') +
          '\n\nBase the tags on what the title says; when a title is vague, choose the closest fit.\n\n' +
          'Reply with only a JSON array, one object per title, using the number before the title as "i":\n' +
          '[{"i": 0, "tags": ["Academic & Lectures"]}, {"i": 1, "tags": ["Arts & Performances", "Culture & Identity"]}]\n\n' +
          'Event titles:\n' +
          batch.map((title, n) => `${n}. ${title}`).join('\n'),
      );

      for (const { i: n, tags } of results) {
        if (batch[n] && Array.isArray(tags)) tagCache[batch[n]] = tags.filter((t) => TAGS.includes(t)).slice(0, 3);
      }
      await writeFile(TAGS_PATH, JSON.stringify(tagCache, null, 2));
      console.log(`[ai] tagged ${Math.min(i + TAG_BATCH_SIZE, todo.length)}/${todo.length}`);
    }
  })()
    .catch((err) => {
      tagFailed = true;
      console.warn(`[ai] tagging stopped: ${describeError(err)}`);
    })
    .finally(() => { tagging = null; });

  return tagging;
}

// ---------------------------------------------------------------------------
// Picks cache: in memory and in data/picks-cache.json (gitignored: it holds
// what students typed). Keys start with the campus date ("2026-10-25|..."),
// so entries from earlier days are dropped as "this week" moves on.

const PICKS_CACHE_PATH = new URL('../data/picks-cache.json', import.meta.url);
let picksCache = {};

try {
  picksCache = JSON.parse(await readFile(PICKS_CACHE_PATH, 'utf8'));
} catch {
  // No cache yet.
}

export function cachedPicks(key) {
  return picksCache[key] ?? null;
}

export async function cachePicks(key, picks) {
  const day = key.split('|')[0];
  picksCache = Object.fromEntries(Object.entries(picksCache).filter(([k]) => k.startsWith(`${day}|`)));
  picksCache[key] = picks;
  await writeFile(PICKS_CACHE_PATH, JSON.stringify(picksCache, null, 2));
}

// ---------------------------------------------------------------------------
// Personal picks: given a student's free-text interests and ~20 pre-selected
// events (lib/match.js), returns [{ id, reason }] for the ones Gemma recommends.

export async function pickEvents(events, interests) {
  if (!client) throw new Error('AI features are off: set GEMINI_API_KEY');

  const lines = events.map((e, n) => {
    const when = e.allDay ? `${e.startDate} (all day)` : e.start.replace('T', ' ');
    const tags = tagsFor(e.title);
    return `${n} | ${when} | ${e.title}${tags?.length ? ` | ${tags.join(', ')}` : ''}`;
  });

  const picks = await askJsonArray(
    'You recommend University of Maryland campus events to students based on their interests.\n\n' +
      `A student described their interests:\n<interests>\n${interests}\n</interests>\n\n` +
      `Pre-selected campus events this week (index | when | title | tags):\n${lines.join('\n')}\n\n` +
      'Pick up to 6 events this student would most likely enjoy, best match first. For each, write one short ' +
      'sentence telling the student why it fits them, speaking to them as "you". Prefer variety over several ' +
      'sessions of the same event, and leave out events that do not fit rather than filling the list.\n\n' +
      'Decide quickly: a brief judgment is enough, no long deliberation.\n\n' +
      'Reply with only a JSON array, using the event index as "i" (an empty array if nothing fits):\n' +
      '[{"i": 12, "reason": "You said you love jazz, and this is a live jazz night."}]',
  );

  return picks
    .filter((p) => events[p?.i] && typeof p.reason === 'string')
    .slice(0, 6)
    .map((p) => ({ id: events[p.i].id, reason: p.reason }));
}
