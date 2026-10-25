// Pre-filter for "Find my picks": scores events against a student's interests
// in plain code (no AI), so Gemma only has to judge ~20 candidates. The feed
// has titles and times but no descriptions, so we score titles and tags.
import { TAGS } from './ai.js';

const STOPWORDS = new Set(
  ('i im me my we our you your a an the and or but of to in on at for with from by about into out up get go ' +
    'like love enjoy into really also some any stuff things thing want looking interested interest ' +
    'major minor student students event events free fun good great new').split(' '),
);

// Interest words that point at a tag even when the title doesn't use them.
const KEYWORD_TAGS = {
  'Arts & Performances': 'art music jazz band concert choir orchestra theater theatre dance film movie comedy poetry sing',
  'Exhibitions': 'museum gallery exhibit exhibition art history',
  'Sports & Recreation': 'sport soccer basketball football volleyball tennis gym fitness run running hike climbing swim pickup game',
  'Career & Professional': 'career job internship resume interview networking professional employer recruit',
  'Health & Wellness': 'health wellness yoga meditation mental mindfulness stress sleep nutrition',
  'Social & Community': 'food pizza party social friend friends community volunteer meet mixer hangout club',
  'Workshops & Training': 'workshop training skill learn tutorial class',
  'Science & Research': 'science research coding code computer cs programming python data ai engineering math physics biology chemistry tech',
  'Culture & Identity': 'culture cultural identity heritage language international lgbtq diversity religion',
  'Academic & Lectures': 'lecture talk seminar speaker academic history philosophy politics book',
  'Deadlines & Admin': 'deadline registration register admin financial aid',
};

function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .map(stem);
}

// Cache key: "Jazz, coding" and "coding and jazz" normalize the same.
export function normalizeInterests(text) {
  const tokens = [...new Set(tokenize(text))].sort();
  return tokens.length ? tokens.join(' ') : String(text).trim().toLowerCase();
}

// Short words must match exactly ("ai" shouldn't match "aid"); longer ones
// match as a prefix either way ("cod" ~ "coding", "concert" ~ "concerts").
function wordMatches(token, word) {
  if (token.length < 4 || word.length < 4) return token === word;
  return word.startsWith(token) || token.startsWith(word);
}

const TAG_WORDS = Object.fromEntries(
  TAGS.map((tag) => [tag, new Set([...tokenize(tag), ...tokenize(KEYWORD_TAGS[tag] ?? '')])]),
);

// Returns up to `limit` events, best match first. If few events match at all,
// the rest are filled with upcoming events across different tags so Gemma
// still has a varied list to choose from.
export function rankCandidates(events, interests, tagsFor, limit = 20) {
  const tokens = [...new Set(tokenize(interests))];

  const scored = events.map((event) => {
    const titleWords = tokenize(event.title);
    const tags = tagsFor(event.title) ?? [];
    // Per interest word: 3 if the title says it, else 2 if one of the
    // event's tags covers it.
    const perToken = tokens.map((token) =>
      titleWords.some((w) => wordMatches(token, w)) ? 3
      : tags.some((tag) => [...TAG_WORDS[tag]].some((w) => wordMatches(token, w))) ? 2
      : 0);
    return { event, score: perToken.reduce((a, b) => a + b, 0), perToken };
  });

  const byScore = (a, b) => b.score - a.score || a.event.start.localeCompare(b.event.start);

  // Take the best match for each interest word in turn, so a broad word
  // ("food" matches every social event) can't crowd out a narrow one ("jazz").
  const queues = tokens.map((_, t) =>
    scored.filter((s) => s.perToken[t] > 0).sort((a, b) => b.perToken[t] - a.perToken[t] || byScore(a, b)));
  const picked = new Set();
  for (let round = 0; picked.size < limit && queues.some((q) => q.length > round); round++) {
    for (const queue of queues) {
      if (queue[round] && picked.size < limit) picked.add(queue[round]);
    }
  }
  const matched = [...picked].sort(byScore);
  if (matched.length >= limit) return matched;

  // Fill: round-robin over each event's first tag, earliest first.
  const rest = scored.filter((s) => s.score === 0).sort(byScore);
  const groups = [...Map.groupBy(rest, (s) => (tagsFor(s.event.title) ?? [])[0] ?? '').values()];
  for (let round = 0; matched.length < limit && groups.some((g) => g.length > round); round++) {
    for (const group of groups) {
      if (group[round] && matched.length < limit) matched.push(group[round]);
    }
  }
  return matched;
}
