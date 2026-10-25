# UMD Events

Pulls the University of Maryland campus calendar and shows it as a searchable,
filterable list, with AI-powered category tags and personal picks.

**AI: open-weight models only.** "For you" picks run on **Llama 4 Maverick** (`llama-4-maverick`),
Meta's open-weight model, hosted on DigitalOcean Serverless Inference (OpenAI-compatible API,
key in `.env` as `DO_INFERENCE_KEY`). If that key isn't set, the app falls back to Google's
open-weight **Gemma** (`gemma-4-26b-a4b-it`) via `GEMINI_API_KEY`. The committed event tags in
`data/tags.json` were produced by Gemma. No proprietary models are used.

## Run it

```bash
npm install
cp .env.example .env   # then add DO_INFERENCE_KEY (or GEMINI_API_KEY) to .env (optional)
npm start              # http://localhost:3000
```

Without either key the app still works; tags and the "For you" panel are just hidden.

## How it works

- **Data:** `https://calendar.umd.edu/ics`, a public iCal feed that isn't linked anywhere
  on the site. It only has titles and times (no locations, descriptions, or links).
  `lib/ics.js` parses it and handles the feed's quirks (duplicate entries, repeat rules
  on events that are already listed one by one, campus-local times).
- **Caching:** `lib/feed.js` refetches hourly. If calendar.umd.edu is unreachable it
  serves `data/snapshot.ics`. Run `npm run snapshot` before a demo to refresh it.
- **Auto-tagging:** `lib/ai.js` sends new event titles to the AI model in batches of 110 and caches
  the results in `data/tags.json`, so each title is tagged once. Commit that file and
  tags work on demo day even without a key or network.
- **Picks:** `lib/match.js` scores the next 14 days of events against the student's interests
  (title words and tags) and keeps the top 30. The model gets those in one call and returns up to
  4 events with a one-line reason for each. Answers are cached per day and normalized query
  in `data/picks-cache.json`, so repeat searches are instant.

## API

- `GET /api/events` returns `{ source, fetchedAt, ai, tagging, tags, events[] }`
- `POST /api/refresh` re-imports from calendar.umd.edu right away (the page's "Update events"
  button) and returns `{ ok, error?, added, total, source, fetchedAt }`. Calls within 30 seconds
  of the last fetch reuse it.
- `POST /api/candidates` with `{ "interests": "..." }` returns instantly with
  `{ candidates: [{ id }], picks }`: the top 6 pre-filtered events, plus cached picks or `null`.
- `POST /api/picks` with `{ "interests": "..." }` returns `{ picks: [{ id, reason }], cached? }`
