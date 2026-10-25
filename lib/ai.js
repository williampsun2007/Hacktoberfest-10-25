// AI features (open-weight models only): auto-tagging event titles and personal picks.
// Everything here is optional; without DO_INFERENCE_KEY or GEMINI_API_KEY the app still works,
// just without tags and picks.
//
// Gemma (the fallback) on the Gemini API has no system instructions, no JSON response mode
// and no thinking_budget, so every instruction goes in the user prompt and
// the JSON is parsed out of plain text. Each call takes ~100s (the model
// thinks first) and the free tier allows only a few requests per minute, so
// keep calls few and large.
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
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

// Preferred: Llama 4 Maverick (open-weight) on DigitalOcean Serverless
// Inference, OpenAI-compatible and much faster (no forced thinking).
// Fallback when DO_INFERENCE_KEY isn't set: Gemma on the Gemini API.
const DO_MODEL = 'llama-4-maverick';
const doKey = process.env.DO_INFERENCE_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
export const aiModel = doKey ? DO_MODEL : MODEL;
export const aiEnabled = Boolean(doKey || geminiKey);

const doClient = doKey
  ? new OpenAI({ apiKey: doKey, baseURL: 'https://inference.do-ai.run/v1', timeout: 60_000, maxRetries: 2 })
  : null;
const client = !doKey && geminiKey
  ? new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: {
        timeout: 240_000, // a normal call is ~100s; give up on stuck ones
        // On 429 (free-tier rate limit) or 5xx, wait and retry: ~20s, then ~40s.
        retryOptions: { attempts: 3, initialDelay: 20, maxDelay: 60 },
      },
    })
  : null;

// One request whose answer should be a JSON array. Returns the parsed array.
// maxTokens/timeout apply to the DO path: picks fit in 400 tokens, but a
// 110-title tagging batch needs ~2000, which at ~7 tokens/s takes minutes.
// If the reply can't be parsed, log it and ask once more before giving up.
async function askJsonArray(prompt, options) {
  for (let attempt = 1; ; attempt++) {
    const reply = await askText(prompt, options);
    try {
      return parseJsonArray(reply);
    } catch (err) {
      console.warn(`[ai] unparseable reply (attempt ${attempt}/2): ${err.message}\n--- raw reply ---\n${reply}\n---`);
      if (attempt >= 2) throw err;
    }
  }
}

// One model request; returns the raw reply text.
async function askText(prompt, { maxTokens = 400, timeout = 60_000 } = {}) {
  if (doClient) {
    // Without the system line Llama writes ~600 tokens of reasoning before
    // the JSON (~85s at DO's ~7 tokens/s); with it, ~100 tokens (~15s).
    const completion = await doClient.chat.completions.create({
      model: DO_MODEL,
      messages: [
        { role: 'system', content: 'Output only the JSON array the user asks for. No explanation, no reasoning, no code fences.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }, { timeout });
    return completion.choices[0]?.message?.content ?? '';
  }
  const response = await client.models.generateContent({ model: MODEL, contents: prompt });
  return response.text ?? '';
}

// The model's JSON comes back as free text, sometimes in ```json fences or with
// text around it (which can itself contain brackets). Parse only the first
// complete array: from the first [ to its matching ], skipping brackets
// inside strings.
export function parseJsonArray(text) {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('[');
  if (start === -1) throw new Error(`Model reply had no JSON array: ${text.slice(0, 200)}`);

  let depth = 0;
  let inString = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i];
    if (inString) {
      if (ch === '\\') i++; // skip the escaped character
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']' && --depth === 0) {
      const parsed = JSON.parse(unfenced.slice(start, i + 1));
      if (!Array.isArray(parsed)) throw new Error('Model reply was not a JSON array');
      return parsed;
    }
  }
  throw new Error('Model reply had an unterminated JSON array');
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
// sent to the model once. Commit that file and tags keep working with no API key.

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
  if (!aiEnabled || tagging) return tagging;

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
        { maxTokens: 4000, timeout: 600_000 }, // runs in the background, so a long wait is fine
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
// events (lib/match.js), returns [{ id, reason }] for the ones the model recommends.

export async function pickEvents(events, interests, rejected = []) {
  if (!aiEnabled) throw new Error('AI features are off: set DO_INFERENCE_KEY or GEMINI_API_KEY');

  const lines = events.map((e, n) => {
    const when = e.allDay ? `${e.startDate} (all day)` : e.start.replace('T', ' ');
    const tags = tagsFor(e.title);
    return `${n} | ${when} | ${e.title}${tags?.length ? ` | ${tags.join(', ')}` : ''}`;
  });

  const picks = await askJsonArray(
    'You recommend University of Maryland campus events to students based on their interests.\n\n' +
      `A student described their interests:\n<interests>\n${interests}\n</interests>\n\n` +
      (rejected.length
        ? `The student said these don't fit, avoid them and similar events: ${rejected.join('; ')}\n\n`
        : '') +
      `Pre-selected campus events in the next two weeks (index | when | title | tags):\n${lines.join('\n')}\n\n` +
      'Pick up to 4 events this student would most likely enjoy, best match first. For each, write one short ' +
      'sentence telling the student why it fits them, speaking to them as "you". Prefer variety over several ' +
      'sessions of the same event, and leave out events that do not fit rather than filling the list. ' +
      'When two events fit similarly well, prefer the sooner one. ' +
      'Only include events that clearly fit the student\'s interests. Returning 1 or 2 strong picks is better ' +
      'than 4 with weak ones.\n\n' +
      'Base each reason only on the event\'s title, date, time, location (when listed) and tags shown above. ' +
      'Never invent details that aren\'t there, such as free food, speakers, performers or prizes.\n\n' +
      'Decide quickly: a brief judgment is enough, no long deliberation.\n\n' +
      'Reply with only a JSON array, using the event index as "i" (an empty array if nothing fits):\n' +
      '[{"i": 12, "reason": "You said you love jazz, and this event is a jazz performance."}]',
  );

  return picks
    .filter((p) => events[p?.i] && typeof p.reason === 'string')
    .slice(0, 4)
    .map((p) => ({ id: events[p.i].id, reason: p.reason }));
}
