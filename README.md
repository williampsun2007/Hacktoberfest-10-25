# UMD Events

Pulls the University of Maryland campus calendar and shows it as a searchable,
filterable list. AI category tags and personal picks plug in through one file,
`lib/ai.js` (see below).

## Run it

```bash
npm install
npm start              # http://localhost:3000
```

## How it works

- **Data:** `https://calendar.umd.edu/ics`, a public iCal feed that isn't linked anywhere
  on the site. It only has titles and times (no locations, descriptions, or links).
  `lib/ics.js` parses it and handles the feed's quirks (duplicate entries, repeat rules
  on events that are already listed one by one, campus-local times).
- **Caching:** `lib/feed.js` refetches hourly, and the page's "Update events" button
  refetches on demand. If calendar.umd.edu is unreachable it serves `data/snapshot.ics`.
  Run `npm run snapshot` before a demo to refresh it.

## Adding AI

Everything AI-related goes in `lib/ai.js`. The server and page already call it, so
nothing else needs to change.

- **Tags** (category filter buttons): write `data/tags.json`, keyed by exact event title.
  Any language works, e.g. a Python script:
  ```json
  { "Maryland Volleyball vs Michigan State": ["Sports & Recreation"] }
  ```
  The server notices changes within a couple of seconds; reload the page to see them.
  Tags listed in `TAGS` in `lib/ai.js` get filter buttons. To tag from JavaScript
  instead, do it in `onEventsImported(events)`, which runs every time events are imported.
- **Picks** (the "For you" panel): implement `pickEvents(events, interests)` to return
  up to 6 `{ id, reason }` objects, then set `aiEnabled = true`.
- **API keys:** put them in a `.env` file (`npm start` loads it; git ignores it) and
  read them with `process.env.YOUR_KEY_NAME`.

## API

- `GET /api/events` returns `{ source, fetchedAt, ai, tagging, tags, events[] }`
- `POST /api/refresh` re-imports from calendar.umd.edu right away (the page's "Update events"
  button) and returns `{ ok, error?, added, total, source, fetchedAt }`. Calls within 30 seconds
  of the last fetch reuse it.
- `POST /api/picks` with `{ "interests": "..." }` returns `{ picks: [{ id, reason }] }`
  (503 until picks are set up)
