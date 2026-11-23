// Turns settings into an ordered list of linked pages.

import { MONTHS, MON, DAYS, DAY3, mk, addDays, daysInMonth, ymd, parseYmd, startOfWeek, isoWeek, ordinal } from './dates.js';
import { dayId, weekId, monthId, quarterId, collectionId, esc } from './ids.js';
import { renderTemplate, miniCalendar } from './templates.js';
import { pageSize } from './devices.js';

const SB_W = 52;
const TB_H = 40;
const HOME_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-label="Home"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z" fill="currentColor"/></svg>';

export function computeRange(s) {
  let y0, m0, n;
  if (s.range.mode === 'year') { y0 = +s.range.year; m0 = 0; n = 12; }
  else { y0 = +s.range.startYear; m0 = +s.range.startMonth; n = Math.max(1, Math.min(24, +s.range.months || 12)); }
  const months = Array.from({ length: n }, (_, i) => { const d = mk(y0, m0 + i, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const last = months[months.length - 1];
  const start = mk(months[0].y, months[0].m, 1);
  const end = mk(last.y, last.m, daysInMonth(last.y, last.m));
  const label = months[0].y === last.y ? String(last.y) : `${months[0].y}–${String(last.y).slice(2)}`;
  return { months, start, end, label };
}

export function buildEvents(s) {
  const map = new Map();
  const put = (date, ev) => { const k = ymd(date); if (!map.has(k)) map.set(k, []); map.get(k).push(ev); };
  const spread = (startStr, endStr, ev) => {
    let d = parseYmd(startStr);
    const e = endStr ? parseYmd(endStr) : d;
    for (let i = 0; d <= e && i < 400; i++, d = addDays(d, 1)) put(d, ev);
  };
  for (const cal of s.calendars || []) {
    if (cal.show === false) continue;
    const times = cal.showTimes !== false;
    for (const ev of cal.events || []) {
      let title = String(ev.title || '');
      if (!times) title = title.replace(/^\d{1,2}(:\d{2})?\s*(am|pm)\s+/i, '');
      else if (ev.time) title = `${ev.time} ${title}`;
      spread(ev.date, ev.end, { title });
    }
  }
  const noSchool = new Map();
  if (s.school.enabled) {
    for (const ns of s.school.noSchool || []) {
      if (!ns.start) continue;
      let d = parseYmd(ns.start);
      const e = ns.end ? parseYmd(ns.end) : d;
      for (let i = 0; d <= e && i < 400; i++, d = addDays(d, 1)) {
        noSchool.set(ymd(d), ns.label || 'No school');
        put(d, { title: ns.label || 'No school', noSchool: true });
      }
    }
  }
  return { map, noSchool };
}

export function buildPlanner(s) {
  const size = pageSize(s);
  const range = computeRange(s);
  const { map: evMap, noSchool: nsMap } = buildEvents(s);
  const ws = +s.weekStart;
  const pages = [];
  const ids = new Set();

  // ---- frame geometry ----
  const sb = s.sidebar.enabled;
  const tb = s.topbar.enabled;
  const res = s.toolbarReserve, rs = +s.toolbarSize || 36;
  const cw = size.w - (sb ? SB_W : 0) - 32 - (res === 'left' || res === 'right' ? rs : 0);
  const ch = size.h - (tb ? TB_H : 16) - 16 - (res === 'top' || res === 'bottom' ? rs : 0);

  const link = (id, inner, cls = '', tag = 'span') =>
    ids.has(id) ? `<a href="#${id}" class="${cls}">${inner}</a>` : `<${tag} class="${cls}">${inner}</${tag}>`;

  // ---- weeks ----
  const weeks = [];
  for (let w = startOfWeek(range.start, ws); w <= range.end; w = addDays(w, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
    const anchor = w < range.start ? range.start : w;
    weeks.push({ start: w, days, y: anchor.getFullYear(), m: anchor.getMonth() });
  }
  const weekNum = (start) => {
    if (s.week.weekNumFromStart) {
      const i = weeks.findIndex((w) => ymd(w.start) === ymd(start));
      return i >= 0 ? i + 1 : isoWeek(addDays(start, ws === 0 ? 1 : 0));
    }
    return isoWeek(addDays(start, ws === 0 ? 1 : 0));
  };
  const weekOf = (d) => weeks.find((w) => d >= w.start && d < addDays(w.start, 7));

  // ---- quarters ----
  const termShort = (s.school.termLabel || 'Quarter')[0].toUpperCase();
  const quarters = [];
  for (let i = 0; i < range.months.length; i += 3) quarters.push({ i: quarters.length, months: range.months.slice(i, i + 3) });
  const quarterOfMonth = (y, m) => quarters.find((q) => q.months.some((x) => x.y === y && x.m === m));

  const baseCtx = {
    s, cw, ch, weekNum, yearMonths: range.months, link,
    eventsOn: (d) => evMap.get(ymd(d)) || [],
    noSchool: (d) => (d ? nsMap.get(ymd(d)) : null),
  };

  // ---- collections ----
  const cols = (s.collections || []).map((c, i) => ({ ...c, id: collectionId(c, i) }));
  const navCols = cols.filter((c) => c.nav !== false);
  const navChars = navCols.reduce((a, c) => a + String(c.name).length + 2, 0);
  const colLinks = () => navCols.map((c) => link(c.id, esc(c.name), '')).join('<span class="sep">/</span>');
  const tbSize = navChars > 46 ? 'lots' : navChars > 28 ? 'many' : '';
  const sbSize = navChars > 44 ? 'lots' : navChars > 26 ? 'many' : '';

  // ---- crumbs ----
  const yearCrumb = () => ({ id: 'year', label: range.label });
  const qCrumb = (q) => ({ id: quarterId(q.i), label: `${termShort}${q.i + 1}` });
  const mCrumb = (y, m, short) => ({ id: monthId(y, m), label: short ? MON[m] : MONTHS[m] });
  const wCrumb = (w, short) => ({ id: weekId(w.start), label: `${short ? 'Wk' : 'Week'} ${weekNum(w.start)}` });

  // ---- sidebar item builders ----
  const sbMonths = (activeId) => range.months.map(({ y, m }) => ({ id: monthId(y, m), html: MON[m], active: monthId(y, m) === activeId }));
  const sbQuarters = (activeId) => quarters.map((q) => ({ id: quarterId(q.i), html: `${termShort}${q.i + 1}`, active: quarterId(q.i) === activeId }));
  const sbWeeks = (list, activeId) => list.map((w) => {
    const d = w.start < range.start ? range.start : w.start;
    return { id: weekId(w.start), html: `<small>${MON[d.getMonth()]}</small>${d.getDate()}`, active: weekId(w.start) === activeId };
  });
  const sbWeeksOfMonth = (y, m, activeId) => sbWeeks(weeks.filter((w) => w.y === y && w.m === m), activeId);
  const sbWeeksOfYear = (activeId) => weeks.map((w) => ({ id: weekId(w.start), html: `<small>W</small>${weekNum(w.start)}`, active: weekId(w.start) === activeId }));
  const sbDays = (list, activeId, fmt) => list.filter((d) => d >= range.start && d <= range.end).map((d) => ({ id: dayId(d), html: fmt(d), active: dayId(d) === activeId }));

  function weekSidebar(w) {
    const a = weekId(w.start);
    switch (s.week.sidebar) {
      case 'weeks-of-year': return sbWeeksOfYear(a);
      case 'months': return sbMonths(monthId(w.y, w.m));
      case 'days-of-week': return sbDays(w.days, null, (d) => `<small>${DAY3[d.getDay()]}</small>${d.getDate()}`);
      case 'none': return [];
      default: return sbWeeksOfMonth(w.y, w.m, a);
    }
  }
  function daySidebar(d, w) {
    const a = dayId(d);
    switch (s.day.sidebar) {
      case 'days-of-month': {
        const list = Array.from({ length: daysInMonth(d.getFullYear(), d.getMonth()) }, (_, i) => mk(d.getFullYear(), d.getMonth(), i + 1));
        return sbDays(list, a, (x) => x.getDate());
      }
      case 'weeks-of-month': return sbWeeksOfMonth(d.getFullYear(), d.getMonth(), weekId(w.start));
      case 'months': return sbMonths(monthId(d.getFullYear(), d.getMonth()));
      case 'none': return [];
      default: return sbDays(w.days, a, (x) => `<small>${DAY3[x.getDay()]}</small>${x.getDate()}`);
    }
  }

  // ---- page factory ----
  function addPage(p) {
    // p: { id, group, label, crumbs, sidebar, template, scope, extra, cover, title }
    ids.add(p.id);
    pages.push(p);
  }

  function addWithNotes(base, view) {
    addPage(base);
    const n = Math.max(0, Math.min(20, +view.notesPages || 0));
    for (let i = 2; i <= n + 1; i++) {
      addPage({
        ...base,
        id: `${base.id}-pg${i}`,
        label: `${base.label} · page ${i}`,
        crumbs: [...base.crumbs, { label: `Page ${i}` }],
        template: view.notesTemplate,
        heading: null,
        isNotes: true,
      });
    }
  }

  // Cover
  if (s.cover.enabled) addPage({ id: 'home', group: 'Cover', label: 'Cover', cover: true });

  // Year
  if (s.year.enabled) {
    addWithNotes({ id: 'year', group: 'Year', label: range.label, scope: 'year', crumbs: [{ id: 'year', label: range.label }], sidebar: sbMonths(null), template: '__year' }, s.year);
  }

  // Quarters
  if (s.quarter.enabled) {
    for (const q of quarters) {
      addWithNotes({
        id: quarterId(q.i), group: 'Quarters', label: `${s.school.termLabel || 'Quarter'} ${q.i + 1}`, scope: 'quarter', quarter: q,
        crumbs: [yearCrumb(), { id: quarterId(q.i), label: `${s.school.termLabel || 'Quarter'} ${q.i + 1}` }],
        sidebar: sbQuarters(quarterId(q.i)), template: s.quarter.template,
      }, s.quarter);
    }
  }

  // Months
  if (s.month.enabled) {
    for (const { y, m } of range.months) {
      const q = quarterOfMonth(y, m);
      addWithNotes({
        id: monthId(y, m), group: 'Months', label: `${MONTHS[m]} ${y}`, scope: 'month', month: { y, m },
        crumbs: [yearCrumb(), qCrumb(q), mCrumb(y, m)],
        sidebar: sbMonths(monthId(y, m)), template: s.month.template,
      }, s.month);
    }
  }

  // Weeks
  if (s.week.enabled) {
    for (const w of weeks) {
      const q = quarterOfMonth(w.y, w.m);
      addWithNotes({
        id: weekId(w.start), group: 'Weeks', label: `Week ${weekNum(w.start)} · ${MON[w.start.getMonth()]} ${w.start.getDate()}`, scope: 'week', week: w,
        month: { y: w.y, m: w.m },
        crumbs: [yearCrumb(), qCrumb(q), mCrumb(w.y, w.m, true), wCrumb(w)],
        sidebar: weekSidebar(w), template: s.week.template,
      }, s.week);
    }
  }

  // Days
  if (s.day.enabled) {
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      const w = weekOf(d);
      const q = quarterOfMonth(d.getFullYear(), d.getMonth());
      const title = `${DAY3[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}<sup>${ordinal(d.getDate())}</sup>`;
      addWithNotes({
        id: dayId(d), group: 'Days', label: `${DAY3[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`, scope: 'day', date: d, week: w,
        month: { y: d.getFullYear(), m: d.getMonth() },
        crumbs: [yearCrumb(), qCrumb(q), mCrumb(d.getFullYear(), d.getMonth(), true), wCrumb(w, true), { id: dayId(d), label: title }],
        sidebar: daySidebar(d, w), template: s.day.template,
      }, s.day);
    }
  }

  // Collections
  for (const c of cols) {
    const per = Math.max(1, Math.min(60, +c.perIndex || 20));
    const nIdx = Math.max(1, Math.min(20, +c.indexPages || 1));
    const ppi = Math.max(1, Math.min(10, +c.pagesPerItem || 1));
    const total = per * nIdx;
    for (let p = 1; p <= nIdx; p++) {
      addPage({
        id: p === 1 ? c.id : `${c.id}-pg${p}`, group: 'Collections', label: `${c.name} · index ${p}`, scope: 'collection',
        crumbs: [{ id: c.id, label: esc(c.name) }, ...(p > 1 ? [{ label: `Page ${p}` }] : [])],
        sidebar: sbMonths(null), template: '__index', index: { c, from: (p - 1) * per + 1, to: p * per },
      });
    }
    for (let i = 1; i <= total; i++) {
      for (let k = 1; k <= ppi; k++) {
        const idxPage = Math.ceil(i / per);
        addPage({
          id: k === 1 ? `${c.id}-${i}` : `${c.id}-${i}-p${k}`, group: 'Collections', label: `${c.name} · ${i}${ppi > 1 ? ` (${k})` : ''}`,
          scope: 'collection',
          crumbs: [{ id: idxPage === 1 ? c.id : `${c.id}-pg${idxPage}`, label: esc(c.name) }, { id: `${c.id}-${i}`, label: String(i) }, ...(k > 1 ? [{ label: `Page ${k}` }] : [])],
          sidebar: sbMonths(null), template: c.template,
        });
      }
    }
  }

  // ---- renderers ----
  function renderCover() {
    const title = esc(s.cover.title) || range.label;
    const links = [s.year.enabled ? link('year', 'Planner') : '', ...(s.cover.showLinks ? cols.map((c) => link(c.id, esc(c.name))) : [])].filter(Boolean);
    // The 'home' anchor sits just inside the page: Chrome drops a PDF
    // destination placed at the very top-left of page 1.
    return `<section class="page cover ${s.cover.dark ? 'dark' : ''}" id="cover"><span class="anchor" id="home"></span>
      <div class="cover-in">
        <h1 style="font-family:'${s.cover.font}'">${title}</h1>
        ${s.cover.subtitle ? `<div class="cover-sub">${esc(s.cover.subtitle)}</div>` : ''}
        <div class="cover-links">${links.join('<span class="sep">/</span>')}</div>
      </div>
      ${s.cover.name || s.cover.contact ? `<div class="cover-contact">${s.cover.name ? `<div>${esc(s.cover.name)}</div>` : ''}${s.cover.contact ? `<div>${esc(s.cover.contact)}</div>` : ''}</div>` : ''}
    </section>`;
  }

  function renderYear(ctx) {
    const n = range.months.length;
    const colsN = n > 12 ? 4 : 3;
    return `<div class="year-grid" style="grid-template-columns:repeat(${colsN},1fr)">${range.months.map(({ y, m }) => miniCalendar(ctx, y, m)).join('')}</div>`;
  }

  function renderIndex(p) {
    const { c, from, to } = p.index;
    const per = to - from + 1;
    const half = Math.ceil(per / 2);
    const twoCol = per > 20;
    const item = (i) => `<div class="ix">${link(`${c.id}-${i}`, `<span>${i})</span><i></i>`, 'ix-a', 'div')}</div>`;
    let h = `<div class="index ${twoCol ? 'two' : ''}" style="grid-template-rows:repeat(${twoCol ? half : per},1fr)">`;
    for (let i = from; i <= to; i++) h += item(i);
    return h + '</div>';
  }

  function renderPage(p, index) {
    if (p.cover) return renderCover();
    let n = 0;
    const ctx = { ...baseCtx, ...p, uid: () => `${index}_${n++}` };
    let content;
    if (p.template === '__year') content = renderYear(ctx);
    else if (p.template === '__index') content = renderIndex(p);
    else content = renderTemplate(p.template, ctx);

    const crumbs = p.crumbs.map((c, i) => {
      const last = i === p.crumbs.length - 1;
      return c.id && !last ? link(c.id, c.label) : `<b>${c.label}</b>`;
    });
    const top = tb
      ? `<header class="tb"><div class="crumbs">${link('home', HOME_ICON, 'home')}<span class="sep">/</span>${crumbs.join('<span class="sep">/</span>')}</div>${s.topbar.showCollections && navCols.length ? `<div class="tb-links ${tbSize}">${colLinks()}</div>` : ''}</header>`
      : '';
    const items = p.sidebar || [];
    const dense = items.length > 16 ? (items.length > 32 ? 'denser' : 'dense') : '';
    const side = sb
      ? `<nav class="sb ${dense}">${items.map((it) => link(it.id, it.html, 'tab' + (it.active ? ' active' : ''), 'span')).join('')}<div class="sb-grow"></div>${s.sidebar.showCollections && navCols.length ? `<div class="sb-cols ${sbSize}">${colLinks()}</div>` : ''}</nav>`
      : '';
    return `<section class="page ${sb ? '' : 'no-sb'} ${s.sidebar.left ? 'sb-left' : 'sb-right'} res-${res}" id="${p.id}">${side}<div class="main">${top}<div class="content">${content}</div></div></section>`;
  }

  return { pages, size, range, renderPage, ids };
}
