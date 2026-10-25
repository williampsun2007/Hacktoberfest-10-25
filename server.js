import express from 'express';
import { getEvents, onEventsLoaded, refreshNow } from './lib/feed.js';
import {
  TAGS, aiEnabled, cachePicks, cachedPicks, describeError, pickEvents, tagNewTitles, taggingStatus, tagsFor,
} from './lib/ai.js';
import { normalizeInterests, rankCandidates } from './lib/match.js';

const PORT = process.env.PORT || 3000;
const PICKS_WINDOW_DAYS = 7;
const PICK_CANDIDATES = 20; // sent to Gemma; fewer = faster
const POSSIBLE_SHOWN = 6; // pre-filter results shown while Gemma works

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

// Tag new titles in the background whenever the feed loads.
onEventsLoaded((events) => tagNewTitles(events));

app.get('/api/events', async (req, res) => {
  const { events, source, fetchedAt } = await getEvents();
  res.json({
    source,
    fetchedAt,
    ai: aiEnabled,
    tagging: taggingStatus(),
    tags: TAGS,
    events: events.map((e) => ({ ...e, tags: tagsFor(e.title) })),
  });
});

// Re-imports events from calendar.umd.edu now instead of waiting for the
// hourly refresh. Responds with { ok, error?, added, total, source, fetchedAt }.
app.post('/api/refresh', async (req, res) => {
  res.json(await refreshNow());
});

// Picks come in two steps so the page can show something right away:
// /api/candidates is instant (code-only pre-filter, plus any cached picks),
// then /api/picks has Gemma choose and explain from those same candidates.
app.post('/api/candidates', async (req, res) => {
  const interests = readInterests(req, res);
  if (!interests) return;
  const candidates = await topCandidates(interests);
  res.json({
    candidates: candidates.slice(0, POSSIBLE_SHOWN).map((e) => ({ id: e.id })),
    picks: cachedPicks(picksKey(interests)),
  });
});

const picksInFlight = new Map(); // same query at the same time -> one Gemma call

app.post('/api/picks', async (req, res) => {
  const interests = readInterests(req, res);
  if (!interests) return;
  const key = picksKey(interests);
  const cached = cachedPicks(key);
  if (cached) return res.json({ picks: cached, cached: true });

  try {
    if (!picksInFlight.has(key)) {
      picksInFlight.set(key, (async () => {
        const picks = await pickEvents(await topCandidates(interests), interests);
        await cachePicks(key, picks);
        return picks;
      })().finally(() => picksInFlight.delete(key)));
    }
    res.json({ picks: await picksInFlight.get(key) });
  } catch (err) {
    console.warn(`[ai] picks failed: ${describeError(err)}`);
    res.status(502).json({ error: 'Could not get picks right now. Try again in a moment.' });
  }
});

// Returns the trimmed interests, or sends the error response and returns null.
function readInterests(req, res) {
  const interests = String(req.body?.interests ?? '').trim().slice(0, 500);
  if (!interests) res.status(400).json({ error: 'Tell us a bit about your interests first.' });
  else if (!aiEnabled) res.status(503).json({ error: 'Picks need a GEMINI_API_KEY on the server.' });
  else return interests;
  return null;
}

function picksKey(interests) {
  return `${campusToday()}|${normalizeInterests(interests)}`;
}

async function topCandidates(interests) {
  return rankCandidates(await weekCandidates(), interests, tagsFor, PICK_CANDIDATES).map((c) => c.event);
}

// Events in the next 7 days, one entry per title (earliest upcoming
// occurrence), so a series doesn't take up 10 slots.
async function weekCandidates() {
  const { events } = await getEvents();
  const today = campusToday();
  const until = addDays(today, PICKS_WINDOW_DAYS);
  const seen = new Set();
  return events
    .filter((e) => e.endDate >= today && e.startDate <= until)
    .filter((e) => !seen.has(e.title) && seen.add(e.title));
}

function campusToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

app.listen(PORT, () => {
  console.log(`UMD Events running at http://localhost:${PORT}`);
  console.log(aiEnabled ? '[ai] Gemma features on (gemma-4-26b-a4b-it)' : '[ai] GEMINI_API_KEY not set: tags and picks are off');
  getEvents(); // warm the cache (and kick off tagging) before the first visitor
});
