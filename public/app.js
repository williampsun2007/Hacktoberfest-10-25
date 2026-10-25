// All dates from the API are campus wall-clock strings ("YYYY-MM-DD" or
// "YYYY-MM-DDTHH:mm"), so we compare them as strings and format them as UTC
// to avoid the viewer's own timezone shifting anything.
const CAMPUS_TZ = 'America/New_York';
const RANGE_DAYS = { today: 0, week: 6, month: 29 };
const TAG_POLL_MS = 10_000;
const MAX_TAG_POLLS = 30;

const state = { events: [], range: 'week', query: '', tags: new Set() };
let tagPolls = 0;
let tagPollTimer = null;
let picksRequest = 0;

const $ = (id) => document.getElementById(id);

wireControls();
load();

// ---------------------------------------------------------------------------
// Data

async function load() {
  let data;
  try {
    const res = await fetch('/api/events');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $('count').textContent = `Couldn't load events (${err.message}). Is the server running?`;
    return;
  }

  state.events = data.events;
  $('picks').hidden = !data.ai;
  renderFeedStatus(data);
  renderTagChips(data.tags);
  render();

  // On a first run Gemma tags titles in the background; check back until done.
  const untagged = state.events.filter((e) => !e.tags).length;
  const { running, failed } = data.tagging;
  $('tag-status').textContent =
    running && untagged ? `Gemma is tagging events… (${untagged} to go)`
    : failed ? 'Auto-tagging hit an error (see the server log). It retries on the next feed refresh.'
    : '';
  clearTimeout(tagPollTimer);
  if (running && tagPolls++ < MAX_TAG_POLLS) tagPollTimer = setTimeout(load, TAG_POLL_MS);
}

// "Update events" button: has the server re-import from calendar.umd.edu now.
async function updateEvents() {
  const button = $('refresh');
  const status = $('refresh-status');
  button.disabled = true;
  button.textContent = 'Updating…';
  status.textContent = '';

  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    await load();
    status.textContent = !result.ok
      ? `Couldn't reach calendar.umd.edu (${result.error}). Still showing the last copy.`
      : result.added
        ? `Imported ${result.added} new event${result.added === 1 ? '' : 's'}.`
        : `Up to date, no new events (${result.total} total).`;
  } catch (err) {
    status.textContent = `Update failed (${err.message}). Is the server running?`;
  } finally {
    button.disabled = false;
    button.textContent = 'Update events';
  }
}

// ---------------------------------------------------------------------------
// Controls

function wireControls() {
  $('refresh').addEventListener('click', updateEvents);

  $('search').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  $('ranges').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    state.range = btn.dataset.range;
    for (const b of $('ranges').children) b.setAttribute('aria-pressed', String(b === btn));
    render();
  });

  $('tags').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tag]');
    if (!btn) return;
    const tag = btn.dataset.tag;
    state.tags.has(tag) ? state.tags.delete(tag) : state.tags.add(tag);
    btn.setAttribute('aria-pressed', String(state.tags.has(tag)));
    render();
  });

  const interests = $('interests');
  try { interests.value = localStorage.getItem('interests') ?? ''; } catch { /* storage unavailable */ }
  $('picks-form').addEventListener('submit', (e) => {
    e.preventDefault();
    getPicks(interests.value.trim());
  });
  $('picks-examples').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    interests.value = btn.textContent;
    getPicks(btn.textContent);
  });
}

function renderTagChips(allTags) {
  const used = new Set(state.events.flatMap((e) => e.tags ?? []));
  const box = $('tags');
  box.replaceChildren(
    ...allTags.filter((t) => used.has(t)).map((t) =>
      el('button', { type: 'button', 'data-tag': t, 'aria-pressed': String(state.tags.has(t)) }, t)),
  );
}

function renderFeedStatus({ source, fetchedAt }) {
  const when = fetchedAt
    ? new Date(fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'unknown time';
  $('feed-status').textContent = source === 'live'
    ? `Live from calendar.umd.edu · updated ${when}`
    : `calendar.umd.edu is unreachable, showing a saved copy from ${when}`;
}

// ---------------------------------------------------------------------------
// Event list

function render() {
  const today = campusNow().slice(0, 10);
  const now = campusNow();
  const last = state.range === 'all' ? '9999-12-31' : addDays(today, RANGE_DAYS[state.range]);

  const shown = state.events.filter((e) =>
    (e.allDay ? e.endDate >= today : e.end >= now) && // hide events that already ended
    e.startDate <= last &&
    (!state.query || e.title.toLowerCase().includes(state.query)) &&
    (!state.tags.size || e.tags?.some((t) => state.tags.has(t))));

  const ongoing = shown.filter((e) => e.multiDay);
  const single = shown.filter((e) => !e.multiDay);

  const details = $('ongoing');
  details.hidden = !ongoing.length;
  details.querySelector('summary').textContent = `Ongoing exhibitions & multi-day events (${ongoing.length})`;
  $('ongoing-list').replaceChildren(...ongoing.map(eventItem));

  $('count').textContent = single.length
    ? `${single.length} event${single.length === 1 ? '' : 's'}`
    : 'No events match. Try a wider date range or clear the filters.';

  const byDay = Map.groupBy(single, (e) => e.startDate);
  $('days').replaceChildren(...[...byDay].map(([day, events]) =>
    el('section', { class: 'day' },
      el('h3', {}, dayLabel(day), relativeDay(day, today) && el('span', { class: 'rel' }, relativeDay(day, today))),
      el('ul', { class: 'event-list' }, ...events.map(eventItem)))));
}

function eventItem(e) {
  return el('li', { class: 'event' },
    el('div', { class: 'event-time' }, whenLabel(e)),
    el('div', {},
      el('p', { class: 'event-title' }, e.title),
      el('div', { class: 'event-meta' },
        ...(e.tags ?? []).map((t) => el('span', { class: 'tag' }, t)),
        el('a', { class: 'add-cal', href: googleCalendarUrl(e), target: '_blank', rel: 'noopener' }, '+ Add to calendar'))));
}

// ---------------------------------------------------------------------------
// Personal picks

async function getPicks(interests) {
  const status = $('picks-status');
  const list = $('picks-list');
  if (!interests) {
    status.textContent = 'Tell us a bit about what you like first.';
    return;
  }
  try { localStorage.setItem('interests', interests); } catch { /* storage unavailable */ }

  const request = ++picksRequest;
  const current = () => request === picksRequest; // a newer search replaces this one
  const byId = new Map(state.events.map((e) => [e.id, e]));
  setPicksBusy(true);
  status.textContent = 'Finding possible matches…';
  list.classList.remove('possible');
  list.replaceChildren();

  try {
    // Step 1 (instant): code-picked "Possible matches", or cached Gemma picks.
    const first = await postJson('/api/candidates', { interests });
    if (!current()) return;
    let picks = first.picks;
    if (!picks) {
      const possible = first.candidates.filter((c) => byId.has(c.id));
      status.textContent = possible.length
        ? 'Possible matches. Gemma is reading this week’s events…'
        : 'Gemma is reading this week’s events…';
      list.classList.add('possible');
      list.replaceChildren(...possible.map((c) => possibleItem(byId.get(c.id))));

      // Step 2 (slow): Gemma chooses and explains. Count the seconds so a
      // ~1-2 minute wait doesn't look frozen.
      startElapsed();
      picks = (await postJson('/api/picks', { interests })).picks;
      if (!current()) return;
    }

    picks = picks.filter((p) => byId.has(p.id));
    status.textContent = picks.length ? '' : 'Nothing this week looks like a strong match. Try describing other interests.';
    list.classList.remove('possible');
    list.replaceChildren(...picks.map((p) => pickCard(byId.get(p.id), p.reason)));
  } catch (err) {
    // Keep any possible matches on screen; just say Gemma's picks didn't come.
    if (current()) status.textContent = list.children.length ? `Possible matches. ${err.message}` : err.message;
  } finally {
    if (current()) {
      stopElapsed();
      setPicksBusy(false);
    }
  }
}

function setPicksBusy(busy) {
  for (const b of document.querySelectorAll('#picks-form button, #picks-examples button')) b.disabled = busy;
}

let elapsedTimer = null;

function startElapsed() {
  const started = Date.now();
  const show = () => { $('picks-elapsed').textContent = `${Math.floor((Date.now() - started) / 1000)}s`; };
  stopElapsed();
  show();
  elapsedTimer = setInterval(show, 1000);
}

function stopElapsed() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
  $('picks-elapsed').textContent = '';
}

function pickTags(e) {
  return (e.tags ?? []).map((t) => el('span', { class: 'tag' }, t));
}

// Code-picked candidate shown (faded) while Gemma works.
function possibleItem(e) {
  return el('li', {},
    el('div', { class: 'pick-title' }, e.title),
    el('div', { class: 'pick-when' }, `${dayLabel(e.startDate)} · ${whenLabel(e)}`),
    el('div', { class: 'event-meta' }, ...pickTags(e)));
}

// Gemma's final pick.
function pickCard(e, reason) {
  return el('li', { class: 'pick-card' },
    el('span', { class: 'pick-badge' }, 'Gemma’s pick'),
    el('div', { class: 'pick-title' }, e.title),
    el('div', { class: 'pick-when' }, `${dayLabel(e.startDate)} · ${whenLabel(e)}`),
    el('p', { class: 'pick-reason' }, el('span', { class: 'pick-why' }, 'Why:'), ` ${reason}`),
    el('div', { class: 'event-meta' },
      ...pickTags(e),
      el('a', { class: 'add-cal', href: googleCalendarUrl(e), target: '_blank', rel: 'noopener' }, '+ Add to calendar')));
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Helpers

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter(Boolean));
  return node;
}

function campusNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPUS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function asUtcDate(dateStr) {
  return new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
}

function dayLabel(dateStr) {
  return asUtcDate(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function shortDate(dateStr) {
  return asUtcDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function relativeDay(day, today) {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return '';
}

function clock(dateTime) {
  const [h, m] = dateTime.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function whenLabel(e) {
  if (e.multiDay) return `${shortDate(e.startDate)} – ${shortDate(e.endDate)}`;
  if (e.allDay) return 'All day';
  return e.end > e.start ? `${clock(e.start)} – ${clock(e.end)}` : clock(e.start);
}

function googleCalendarUrl(e) {
  const compact = (s) => s.replace(/[-:]/g, '') + (s.length > 10 ? '00' : '');
  const dates = e.allDay
    ? `${compact(e.startDate)}/${compact(addDays(e.endDate, 1))}`
    : `${compact(e.start)}/${compact(e.end)}`;
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates,
    ctz: CAMPUS_TZ,
    details: 'From the UMD campus calendar: https://calendar.umd.edu',
  });
}
