import { ymd, pad, startOfWeek } from './dates.js';

export const dayId = (d) => 'd-' + ymd(d);
export const weekId = (start) => 'w-' + ymd(start);
export const weekIdFor = (d, weekStart) => weekId(startOfWeek(d, weekStart));
export const monthId = (y, m) => `m-${y}-${pad(m + 1)}`;
export const quarterId = (i) => 'q' + (i + 1);
export const slug = (s) => String(s || 'collection').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';
export const collectionId = (c, i) => 'c' + i + '-' + slug(c.name);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
