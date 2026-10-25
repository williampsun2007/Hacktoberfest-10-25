// Minimal iCal parser for the UMD campus calendar feed (https://calendar.umd.edu/ics).
//
// Quirks of this feed worth knowing:
// - Every occurrence of a repeating event is already its own VEVENT, but each one
//   also carries the series RRULE. We ignore RRULE/EXDATE; expanding them would
//   duplicate events.
// - Times are "floating" (no TZID, no Z), i.e. wall-clock time in College Park.
//   We keep them as wall-clock strings instead of converting to Date objects, so
//   the server's own timezone never shifts anything.
// - The same VEVENT (same UID) often appears several times verbatim; we keep one.

const CAMPUS_TZ = 'America/New_York';

export function parseIcs(text) {
  // Unfold continuation lines (RFC 5545 §3.1), then split.
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = new Map();
  let props = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      props = {};
    } else if (line === 'END:VEVENT') {
      const event = props && toEvent(props);
      if (event && !events.has(event.id)) events.set(event.id, event);
      props = null;
    } else if (props) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(';');
      props[name] = { value: line.slice(colon + 1), params };
    }
  }

  return [...events.values()].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

function toEvent(props) {
  if (!props.DTSTART || !props.SUMMARY) return null;

  const allDay = props.DTSTART.params.includes('VALUE=DATE');
  const start = parseDate(props.DTSTART.value);
  let end = props.DTEND ? parseDate(props.DTEND.value) : start;

  // All-day DTEND is exclusive; store the inclusive last day instead.
  if (allDay && props.DTEND) end = addDays(end, -1);
  if (end < start) end = start;

  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);

  return {
    id: props.UID?.value.replace(/@.*/, '') ?? `${start}-${props.SUMMARY.value}`,
    title: unescapeText(props.SUMMARY.value),
    allDay,
    start, // "YYYY-MM-DD" (all-day) or "YYYY-MM-DDTHH:mm" (wall-clock, campus time)
    end,
    startDate,
    endDate,
    multiDay: startDate !== endDate,
  };
}

// "20261026" -> "2026-10-26", "20261026T090000" -> "2026-10-26T09:00".
// UTC values ("...Z") are converted to campus wall-clock time.
function parseDate(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return value;
  const [, y, mo, d, h, mi, s, utc] = m;
  if (!h) return `${y}-${mo}-${d}`;
  if (!utc) return `${y}-${mo}-${d}T${h}:${mi}`;

  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: CAMPUS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function unescapeText(s) {
  return s.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
}
