// Gemini-powered features: auto-tagging event titles and personal picks.
// Everything here is optional; without GEMINI_API_KEY the app still works,
// just without tags and picks.
import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile } from 'node:fs/promises';

const MODEL = 'gemini-3.8-flash';
const TAGS_PATH = new URL('../data/tags.json', import.meta.url);
const TAG_BATCH_SIZE = 75;

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
const client = aiEnabled ? new GoogleGenAI({ apiKey }) : null;

// One structured-output request. Returns the parsed JSON object.
async function askJson({ system, prompt, schema }) {
  const interaction = await client.interactions.create({
    model: MODEL,
    system_instruction: system,
    input: prompt,
    response_format: { type: 'text', mime_type: 'application/json', schema },
    store: false, // don't keep students' interests on Google's side
  });

  if (interaction.status !== 'completed') throw new Error(`Gemini request ended with status "${interaction.status}"`);
  return JSON.parse(interaction.output_text);
}

// The SDK's own error message is often generic ("400 API error occurred");
// the useful part (e.g. "API key not valid") is in the response body.
export function describeError(err) {
  try {
    const body = typeof err.body === 'string' ? JSON.parse(err.body) : err.body;
    const message = [body].flat()[0]?.error?.message;
    if (message) return `${err.statusCode ?? err.status} ${message}`;
  } catch {
    // Not a JSON body; fall through.
  }
  return err.message;
}

// ---------------------------------------------------------------------------
// Auto-tagging. Tags are cached per title in data/tags.json, so each title is
// sent to Gemini once. Commit that file and tags keep working with no API key.

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
      const { results } = await askJson({
        system: 'You categorize events from the University of Maryland, College Park campus calendar so students can filter them.',
        prompt:
          'Give each event title below 1 to 3 tags from the allowed list. Base the tags on what the title ' +
          'says; when a title is vague, choose the closest fit.\n\n' +
          batch.map((title, n) => `${n}. ${title}`).join('\n'),
        schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  i: { type: 'integer' },
                  tags: { type: 'array', items: { type: 'string', enum: TAGS } },
                },
                required: ['i', 'tags'],
                additionalProperties: false,
              },
            },
          },
          required: ['results'],
          additionalProperties: false,
        },
      });

      for (const { i: n, tags } of results) {
        if (batch[n]) tagCache[batch[n]] = tags.filter((t) => TAGS.includes(t)).slice(0, 3);
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
// Personal picks: given a student's free-text interests and a list of upcoming
// events, returns [{ id, reason }] for the events Gemini recommends.

export async function pickEvents(events, interests) {
  if (!client) throw new Error('AI features are off: set GEMINI_API_KEY');

  const lines = events.map((e, n) => {
    const when = e.allDay ? `${e.startDate} (all day)` : e.start.replace('T', ' ');
    const tags = tagsFor(e.title);
    return `${n} | ${when} | ${e.title}${tags?.length ? ` | ${tags.join(', ')}` : ''}`;
  });

  const { picks } = await askJson({
    system: 'You recommend University of Maryland campus events to students based on their interests.',
    prompt:
      `A student described their interests:\n<interests>\n${interests}\n</interests>\n\n` +
      `Upcoming campus events (index | when | title | tags):\n${lines.join('\n')}\n\n` +
      'Pick up to 6 events this student would most likely enjoy, best match first. For each, write one short ' +
      'sentence telling the student why it fits them, speaking to them as "you". Prefer variety over several ' +
      'sessions of the same event, and leave out events that do not fit rather than filling the list.',
    schema: {
      type: 'object',
      properties: {
        picks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { i: { type: 'integer' }, reason: { type: 'string' } },
            required: ['i', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['picks'],
      additionalProperties: false,
    },
  });

  return picks.filter((p) => events[p.i]).slice(0, 6).map((p) => ({ id: events[p.i].id, reason: p.reason }));
}
