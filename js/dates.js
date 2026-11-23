export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = MONTHS.map((m) => m.slice(0, 3));
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY3 = DAYS.map((d) => d.slice(0, 3));
export const DAY2 = DAYS.map((d) => d.slice(0, 2));

// All dates are created at local noon so DST shifts never change the day.
export const mk = (y, m, d) => new Date(y, m, d, 12);
export const addDays = (d, n) => mk(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const sameDay = (a, b) => ymd(a) === ymd(b);

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return mk(y, (m || 1) - 1, d || 1);
}

export function startOfWeek(d, weekStart) {
  const diff = (d.getDay() - weekStart + 7) % 7;
  return addDays(d, -diff);
}

export function isoWeek(d) {
  const t = mk(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = mk(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Weekday order for column headers, e.g. [1,2,3,4,5,6,0] when weeks start Monday.
export const weekOrder = (weekStart) => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

// Rows of a month calendar: arrays of 7 dates (null outside the month).
export function monthGrid(y, m, weekStart) {
  const first = mk(y, m, 1);
  let cur = startOfWeek(first, weekStart);
  const rows = [];
  while (true) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      row.push(cur.getMonth() === m ? cur : null);
      cur = addDays(cur, 1);
    }
    rows.push(row);
    if (cur.getMonth() !== m || cur.getFullYear() !== y) break;
  }
  return rows;
}

export function hourLabel(h, h24) {
  if (h24) return `${pad(h)}:00`;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}<small>${h < 12 || h === 24 ? 'am' : 'pm'}</small>`;
}
