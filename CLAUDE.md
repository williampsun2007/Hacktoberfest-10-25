# UMD Events

Node/Express app (`server.js`, `public/`) that imports the UMD campus calendar's iCal feed
and shows it as a searchable list, with AI category tags and "Find my picks". See README.md
for the API and data flow. Run with `npm start` (key in `.env` as `GEMINI_API_KEY`).
`terplink_events.py` is an unrelated standalone scraper, not part of the app.

## AI: open-weight Gemma only

The project is entered for "Best Open-Source AI Project", so **every** model call must use
`gemma-4-26b-a4b-it` (via `@google/genai`, `client.models.generateContent`). Never use a
Gemini model. All calls go through `askJsonArray()` in `lib/ai.js`.

Gemma on the Gemini API:
- No system instructions, no JSON response mode / response schema, and it rejects
  `thinking_budget`. Put every instruction in the user prompt and ask for a bare JSON array.
- Parse output with `parseJsonArray()` (strips ```json fences, slices first `[` to last `]`),
  then validate every field; output is not schema-constrained.
- Each call takes ~100-140s (built-in thinking). Free tier is ~5-15 requests/min.
  The client has a 240s timeout and retries 429/5xx.

So keep calls few:
- Tagging batches 110 titles per call (214 titles = 2 calls) and caches results per title in
  `data/tags.json`. Commit that file so tags work with no key or network.
- Picks is exactly one call. `lib/match.js` first pre-filters the next 7 days of events in code
  (title words + tags, round-robin per interest word) down to 12 (`PICK_CANDIDATES` in
  `server.js`); Gemma only chooses and explains from those. Cold calls measured 75-124s (12 candidates, 4 picks).
- The page calls `/api/candidates` first (instant) to show "Possible matches", then
  `/api/picks` for Gemma's answer. Picks are cached per `date|normalized interests` in memory
  and `data/picks-cache.json` (gitignored: it holds what students type).
- The feed has no event descriptions, so matching can only use titles and tags.
