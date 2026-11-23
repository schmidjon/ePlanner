// Calendar events: built-in US holidays, other countries via the free
// Nager.Date API, and ICS files/URLs (with basic recurring-event support).

import { mk, addDays, ymd, daysInMonth } from './dates.js';

export const COUNTRIES = [
  ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['AU', 'Australia'],
  ['NZ', 'New Zealand'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['BE', 'Belgium'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'],
  ['FI', 'Finland'], ['PL', 'Poland'], ['PT', 'Portugal'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['JP', 'Japan'],
  ['ZA', 'South Africa'], ['IN', 'India'],
];

const nth = (y, m, dow, n) => {
  if (n > 0) { const first = mk(y, m, 1); return mk(y, m, 1 + ((dow - first.getDay() + 7) % 7) + (n - 1) * 7); }
  const last = mk(y, m, daysInMonth(y, m));
  return mk(y, m, last.getDate() - ((last.getDay() - dow + 7) % 7));
};

function usHolidays(y) {
  const list = [
    [mk(y, 0, 1), "New Year's Day"],
    [nth(y, 0, 1, 3), 'Martin Luther King Jr. Day'],
    [mk(y, 1, 14), "Valentine's Day"],
    [nth(y, 1, 1, 3), "Presidents' Day"],
    [mk(y, 2, 17), "St. Patrick's Day"],
    [nth(y, 4, 0, 2), "Mother's Day"],
    [nth(y, 4, 1, -1), 'Memorial Day'],
    [nth(y, 5, 0, 3), "Father's Day"],
    [mk(y, 5, 19), 'Juneteenth'],
    [mk(y, 6, 4), 'Independence Day'],
    [nth(y, 8, 1, 1), 'Labor Day'],
    [nth(y, 9, 1, 2), "Indigenous Peoples' Day"],
    [mk(y, 9, 31), 'Halloween'],
    [mk(y, 10, 11), 'Veterans Day'],
    [nth(y, 10, 4, 4), 'Thanksgiving'],
    [mk(y, 11, 24), 'Christmas Eve'],
    [mk(y, 11, 25), 'Christmas Day'],
    [mk(y, 11, 31), "New Year's Eve"],
  ];
  return list.map(([d, title]) => ({ date: ymd(d), title }));
}

export async function fetchHolidays(country, years) {
  const out = [];
  for (const y of years) {
    if (country === 'US') { out.push(...usHolidays(y)); continue; }
    const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${country}`);
    if (!r.ok) throw new Error(`Holiday lookup failed (${r.status})`);
    for (const h of await r.json()) out.push({ date: h.date, title: h.localName || h.name });
  }
  return out;
}

// ---------- ICS ----------

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}
function parseIcsDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v || '');
  if (!m) return null;
  if (m[4] && m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return { date: mk(d.getFullYear(), d.getMonth(), d.getDate()), time: d };
  }
  return { date: mk(+m[1], +m[2] - 1, +m[3]), time: m[4] ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null, allDay: !m[4] };
}
const unescapeText = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

export function parseIcs(text, rangeStart, rangeEnd) {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) expand(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase();
    const val = line.slice(i + 1);
    if (key === 'SUMMARY') cur.summary = unescapeText(val);
    else if (key === 'DTSTART') cur.start = parseIcsDate(val);
    else if (key === 'DTEND') cur.end = parseIcsDate(val);
    else if (key === 'RRULE') cur.rrule = Object.fromEntries(val.split(';').map((p) => p.split('=')));
    else if (key === 'EXDATE') (cur.ex ||= []).push(...val.split(',').map((v) => parseIcsDate(v)).filter(Boolean).map((d) => ymd(d.date)));
  }

  function push(start, lenDays, ev) {
    if (start > rangeEnd || addDays(start, lenDays) < rangeStart) return;
    if (ev.ex && ev.ex.includes(ymd(start))) return;
    const t = ev.start.time && !ev.start.allDay
      ? ev.start.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase() + ' '
      : '';
    events.push({ date: ymd(start), end: lenDays > 0 ? ymd(addDays(start, lenDays)) : undefined, time: t.trim() || undefined, title: ev.summary || 'Event' });
  }

  function expand(ev) {
    if (!ev.start) return;
    const s = ev.start.date;
    let len = 0;
    if (ev.end) {
      len = Math.round((ev.end.date - s) / 864e5);
      if (ev.start.allDay) len -= 1; // DTEND is exclusive for all-day events
      len = Math.max(0, Math.min(60, len));
    }
    const r = ev.rrule;
    if (!r) return push(s, len, ev);
    const freq = r.FREQ, interval = +(r.INTERVAL || 1);
    const until = r.UNTIL ? parseIcsDate(r.UNTIL).date : rangeEnd;
    const count = r.COUNT ? +r.COUNT : Infinity;
    const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.slice(-2))) : null;
    let n = 0;
    for (let i = 0; i < 2000 && n < count; i++) {
      let occ;
      if (freq === 'DAILY') occ = [addDays(s, i * interval)];
      else if (freq === 'WEEKLY') {
        const base = addDays(s, i * 7 * interval);
        occ = byday ? byday.map((dw) => addDays(base, (dw - s.getDay() + 7) % 7)).sort((a, b) => a - b) : [base];
      } else if (freq === 'MONTHLY') occ = [mk(s.getFullYear(), s.getMonth() + i * interval, s.getDate())];
      else if (freq === 'YEARLY') occ = [mk(s.getFullYear() + i * interval, s.getMonth(), s.getDate())];
      else { push(s, len, ev); return; }
      for (const d of occ) {
        if (d < s) continue;
        if (d > until || d > rangeEnd || n >= count) return;
        n++;
        push(d, len, ev);
      }
    }
  }
  return events;
}
