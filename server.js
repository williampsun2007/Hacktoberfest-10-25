import express from 'express';
import { getEvents, onEventsLoaded, refreshNow } from './lib/feed.js';
import { TAGS, aiEnabled, describeError, pickEvents, tagNewTitles, taggingStatus, tagsFor } from './lib/ai.js';

const PORT = process.env.PORT || 3000;
const PICKS_WINDOW_DAYS = 14;
const MAX_PICK_CANDIDATES = 250;

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

app.post('/api/picks', async (req, res) => {
  const interests = String(req.body?.interests ?? '').trim().slice(0, 500);
  if (!interests) return res.status(400).json({ error: 'Tell us a bit about your interests first.' });
  if (!aiEnabled) return res.status(503).json({ error: 'Picks need a Gemini API key on the server.' });

  // Candidates: events in the next two weeks, one entry per title (earliest
  // upcoming occurrence), so Gemini isn't shown the same series 10 times.
  const { events } = await getEvents();
  const today = campusToday();
  const until = addDays(today, PICKS_WINDOW_DAYS);
  const seen = new Set();
  const candidates = events
    .filter((e) => e.endDate >= today && e.startDate <= until)
    .filter((e) => !seen.has(e.title) && seen.add(e.title))
    .slice(0, MAX_PICK_CANDIDATES);

  try {
    res.json({ picks: await pickEvents(candidates, interests) });
  } catch (err) {
    console.warn(`[ai] picks failed: ${describeError(err)}`);
    res.status(502).json({ error: 'Could not get picks right now. Try again in a moment.' });
  }
});

function campusToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

app.listen(PORT, () => {
  console.log(`UMD Events running at http://localhost:${PORT}`);
  console.log(aiEnabled ? '[ai] Gemini features on' : '[ai] GEMINI_API_KEY not set: tags and picks are off');
  getEvents(); // warm the cache (and kick off tagging) before the first visitor
});
