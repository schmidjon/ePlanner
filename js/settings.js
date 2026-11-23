// Settings model: defaults, persistence, named presets and share links.

const now = new Date();
const defaultYear = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();

export { FONTS } from './fonts.js';

export function defaults() {
  return {
    v: 1,
    device: 'boox-go-103',
    customW: 1860,
    customH: 2480,
    landscape: false,
    toolbarReserve: 'none', // none | top | left | right | bottom
    toolbarSize: 36,

    range: { mode: 'year', year: defaultYear, startYear: defaultYear - 1, startMonth: 7, months: 11 },
    weekStart: 1,
    clock24: false,
    hours: { start: 6, end: 21 },

    school: {
      enabled: false,
      termLabel: 'Quarter',
      periods: 6,
      periodNames: '',
      noSchool: [], // { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', label }
    },

    cover: { enabled: true, title: '', subtitle: '', name: '', contact: '', font: 'Bebas Neue', dark: true, showLinks: true },
    year: { enabled: true, notesPages: 1, notesTemplate: 'notes-yearly' },
    quarter: { enabled: true, template: 'quarter-calendars', notesPages: 1, notesTemplate: 'goals' },
    month: { enabled: true, template: 'calendar-notes', notesPages: 1, notesTemplate: 'monthly-review' },
    week: {
      enabled: true, template: 'agenda-weekly', notesPages: 1, notesTemplate: 'notes-weekly-rows',
      sidebar: 'weeks-of-month', showWeekNums: true, weekNumFromStart: false,
    },
    day: { enabled: true, template: 'agenda-daily-dotted', notesPages: 0, notesTemplate: 'dotted-m', sidebar: 'days-of-week' },

    design: { font: 'Roboto', text: '#333333', lines: '#c8c8c8', dots: '#555555', accent: '#e0e0e0', weekendShade: true },
    sidebar: { enabled: true, left: true, showCollections: true, font: 'Bebas Neue' },
    topbar: { enabled: true, showCollections: true, font: 'Bebas Neue' },

    collections: [
      { name: 'Notes', template: 'dotted-m', indexPages: 2, perIndex: 40, pagesPerItem: 1 },
      { name: 'Goals', template: 'goals', indexPages: 1, perIndex: 20, pagesPerItem: 1 },
    ],

    calendars: [
      { type: 'holidays', name: 'Public Holidays', country: 'US', events: [], show: true },
    ],
  };
}

// Deep-merge saved settings onto defaults so new options get sane values.
export function normalize(saved) {
  const base = defaults();
  const merge = (a, b) => {
    if (b === undefined || b === null) return a;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(b) ? b : a;
    if (typeof a === 'object' && typeof b === 'object') {
      const out = { ...a };
      for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
      return out;
    }
    return b;
  };
  return merge(base, saved || {});
}

export const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
export function setPath(o, path, val) {
  const keys = path.split('.');
  let cur = o;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
  cur[keys[keys.length - 1]] = val;
}

const LS_CURRENT = 'eplanner.current';
const LS_PRESETS = 'eplanner.presets';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export function loadCurrent() {
  return normalize(safe(() => JSON.parse(localStorage.getItem(LS_CURRENT)), null));
}
export function saveCurrent(s) {
  safe(() => localStorage.setItem(LS_CURRENT, JSON.stringify(s)));
}
export function listPresets() {
  return safe(() => JSON.parse(localStorage.getItem(LS_PRESETS)) || {}, {});
}
export function savePreset(name, s) {
  const all = listPresets();
  all[name] = s;
  safe(() => localStorage.setItem(LS_PRESETS, JSON.stringify(all)));
}
export function deletePreset(name) {
  const all = listPresets();
  delete all[name];
  safe(() => localStorage.setItem(LS_PRESETS, JSON.stringify(all)));
}

// Share links carry settings in the URL hash. Imported calendar events are
// dropped to keep links short (they can be re-imported on the other side).
export function toShareHash(s) {
  const slim = { ...s, calendars: s.calendars.map((c) => ({ ...c, events: c.type === 'manual' ? c.events : [] })) };
  const bytes = new TextEncoder().encode(JSON.stringify(slim));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return '#cfg=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromShareHash(hash) {
  const m = /cfg=([^&]+)/.exec(hash || '');
  if (!m) return null;
  return safe(() => {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return normalize(JSON.parse(new TextDecoder().decode(bytes)));
  }, null);
}
