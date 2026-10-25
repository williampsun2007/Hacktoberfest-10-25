# UMD Events

Pulls the University of Maryland campus calendar and shows it as a searchable,
filterable list, with Gemma-powered category tags and personal picks.

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
- **Picks:** `POST /api/picks` sends the student's interests plus the next 7 days
  of events to Gemma in one call, which returns up to 6 events with a one-line reason for each.

## API

- `GET /api/events` returns `{ source, fetchedAt, ai, tagging, tags, events[] }`
- `POST /api/refresh` re-imports from calendar.umd.edu right away (the page's "Update events"
  button) and returns `{ ok, error?, added, total, source, fetchedAt }`. Calls within 30 seconds
  of the last fetch reuse it.
- `POST /api/picks` with `{ "interests": "..." }` returns `{ picks: [{ id, reason }] }`
