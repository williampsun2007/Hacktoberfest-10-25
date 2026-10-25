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
- Picks is exactly one call over the next 7 days of events (`PICKS_WINDOW_DAYS` in
  `server.js`), with "Gemma is reading this week's events…" shown while it runs.
