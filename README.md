# UMD Events

Pulls the University of Maryland campus calendar and shows it as a searchable,
filterable list, with Gemma-powered category tags and personal picks.

**AI: 100% Gemma (open-weight).** Every AI feature in this app (event tagging and "For you"
picks) runs on Google's open-weight Gemma model, `gemma-4-26b-a4b-it`, through the Gemini API.
No proprietary Gemini models are used.

## Run it

```bash
npm install
cp .env.example .env   # then paste your Google AI Studio key into .env (optional)
npm start              # http://localhost:3000
```

Without `GEMINI_API_KEY` the app still works; tags and the "For you" panel are just hidden.

## How it works

- **Data:** `https://calendar.umd.edu/ics`, a public iCal feed that isn't linked anywhere
  on the site. It only has titles and times (no locations, descriptions, or links).
  `lib/ics.js` parses it and handles the feed's quirks (duplicate entries, repeat rules
  on events that are already listed one by one, campus-local times).
- **Caching:** `lib/feed.js` refetches hourly. If calendar.umd.edu is unreachable it
  serves `data/snapshot.ics`. Run `npm run snapshot` before a demo to refresh it.
- **Auto-tagging:** `lib/ai.js` sends new event titles to Gemma (`gemma-4-26b-a4b-it`) in batches of 110 and caches
  the results in `data/tags.json`, so each title is tagged once. Commit that file and
  tags work on demo day even without a key or network.
- **Picks:** `lib/match.js` scores the next 7 days of events against the student's interests
  (title words and tags) and keeps the top 12. Gemma gets those in one call and returns up to
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
