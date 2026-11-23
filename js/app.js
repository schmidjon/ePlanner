import { DEVICES, pageSize } from './devices.js';
import { MONTHS, ymd } from './dates.js';
import { FONTS, defaults, normalize, getPath, setPath, loadCurrent, saveCurrent, listPresets, savePreset, deletePreset, toShareHash, fromShareHash } from './settings.js';
import { TEMPLATES, TEMPLATE_GROUPS, templateFits } from './templates.js';
import { buildPlanner, computeRange } from './planner.js';
import { COUNTRIES, fetchHolidays, parseIcs } from './calendars.js';
import { esc } from './ids.js';
import { loadBrowserFonts } from './fonts.js';
import { exportPdf } from './pdf-export.js';

const $ = (sel, el = document) => el.querySelector(sel);

let S = fromShareHash(location.hash) || loadCurrent();
if (location.hash.includes('cfg=')) history.replaceState(null, '', location.pathname + location.search);
let P = null; // built planner
let current = 'home';
const history_ = [];

// ---------------------------------------------------------------- form schema

const sel = (opts) => opts.map((o) => (Array.isArray(o) ? o : [o, o]));
const fontOpts = sel(FONTS);
const yearOpts = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => [y, y]);
const monthOpts = MONTHS.map((m, i) => [i, m]);
const notesCount = Array.from({ length: 11 }, (_, i) => [i, i === 0 ? 'None' : String(i)]);

const viewFields = (key, scope, extra = []) => [
  { k: `${key}.enabled`, t: 'check', label: `Include ${key} pages` },
  ...(scope !== 'year' ? [{ k: `${key}.template`, t: 'tpl', scope, label: 'Page template', show: (s) => s[key].enabled }] : []),
  ...extra.map((f) => ({ show: (s) => s[key].enabled, ...f })),
  { row: [
    { k: `${key}.notesPages`, t: 'select', opts: notesCount, label: 'Extra note pages', num: true },
    { k: `${key}.notesTemplate`, t: 'tpl', scope, label: 'Note page template', show: (s) => s[key].notesPages > 0 },
  ], show: (s) => s[key].enabled },
];

const SECTIONS = [
  { id: 'device', title: 'Device & Page', open: true, fields: [
    { k: 'device', t: 'select', label: 'Device', opts: DEVICES.map((d) => [d.id, d.name]) },
    { row: [{ k: 'customW', t: 'num', label: 'Width (px)' }, { k: 'customH', t: 'num', label: 'Height (px)' }], show: (s) => s.device === 'custom' },
    { k: 'landscape', t: 'check', label: 'Landscape orientation' },
    { row: [
      { k: 'toolbarReserve', t: 'select', label: 'Leave room for device toolbar', opts: [['none', 'No'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right'], ['bottom', 'Bottom']] },
      { k: 'toolbarSize', t: 'num', label: 'Size (px)', show: (s) => s.toolbarReserve !== 'none' },
    ] },
    { note: (s) => { const z = pageSize(s); return `Page aspect ${z.w}×${z.h}. The PDF fills the screen edge to edge; your tablet scales it to fit.`; } },
  ] },
  { id: 'dates', title: 'Dates', open: true, fields: [
    { k: 'range.mode', t: 'select', label: 'Date range', opts: [['year', 'Calendar year'], ['custom', 'Custom range']] },
    { k: 'range.year', t: 'select', label: 'Year', opts: yearOpts, num: true, show: (s) => s.range.mode === 'year' },
    { row: [
      { k: 'range.startMonth', t: 'select', label: 'Start month', opts: monthOpts, num: true },
      { k: 'range.startYear', t: 'select', label: 'Start year', opts: yearOpts, num: true },
    ], show: (s) => s.range.mode === 'custom' },
    { k: 'range.months', t: 'select', label: 'Number of months', opts: Array.from({ length: 24 }, (_, i) => [i + 1, String(i + 1)]), num: true, show: (s) => s.range.mode === 'custom' },
    { k: 'weekStart', t: 'select', label: 'Weeks start on', opts: [[1, 'Monday'], [0, 'Sunday']], num: true },
    { row: [
      { k: 'hours.start', t: 'select', label: 'Day starts at', opts: Array.from({ length: 13 }, (_, i) => [i, `${i}:00`]), num: true },
      { k: 'hours.end', t: 'select', label: 'Day ends at', opts: Array.from({ length: 13 }, (_, i) => [i + 12, `${i + 12}:00`]), num: true },
    ] },
    { k: 'clock24', t: 'check', label: '24-hour clock' },
  ] },
  { id: 'school', title: 'School Year', tag: (s) => (s.school.enabled ? 'on' : ''), fields: [
    { k: 'school.enabled', t: 'check', label: 'Turn on school-year features' },
    { custom: 'schoolTools', show: (s) => s.school.enabled },
  ] },
  { id: 'cover', title: 'Cover Page', fields: [
    { k: 'cover.enabled', t: 'check', label: 'Include cover page' },
    { k: 'cover.title', t: 'text', label: 'Title (defaults to the year)', show: (s) => s.cover.enabled },
    { k: 'cover.subtitle', t: 'text', label: 'Subtitle', show: (s) => s.cover.enabled },
    { row: [{ k: 'cover.name', t: 'text', label: 'Name' }, { k: 'cover.contact', t: 'text', label: 'Email / phone' }], show: (s) => s.cover.enabled },
    { k: 'cover.font', t: 'select', label: 'Font', opts: fontOpts, show: (s) => s.cover.enabled },
    { k: 'cover.dark', t: 'check', label: 'Dark background', show: (s) => s.cover.enabled },
    { k: 'cover.showLinks', t: 'check', label: 'Show links to collections', show: (s) => s.cover.enabled },
  ] },
  { id: 'year', title: 'Year View', fields: viewFields('year', 'year') },
  { id: 'quarter', title: 'Quarter / Term View', fields: viewFields('quarter', 'quarter') },
  { id: 'month', title: 'Month View', fields: viewFields('month', 'month') },
  { id: 'week', title: 'Week View', fields: viewFields('week', 'week', [
    { k: 'week.sidebar', t: 'select', label: 'Sidebar shows', opts: [['weeks-of-month', 'Weeks of the month'], ['weeks-of-year', 'Weeks of the year'], ['days-of-week', 'Days of the week'], ['months', 'Months'], ['none', 'Nothing']] },
    { k: 'week.showWeekNums', t: 'check', label: 'Show week numbers on month calendars' },
    { k: 'week.weekNumFromStart', t: 'check', label: 'Number weeks from the start of the planner (not ISO)' },
  ]) },
  { id: 'day', title: 'Day View', fields: viewFields('day', 'day', [
    { k: 'day.sidebar', t: 'select', label: 'Sidebar shows', opts: [['days-of-week', 'Days of the week'], ['days-of-month', 'Days of the month'], ['weeks-of-month', 'Weeks of the month'], ['months', 'Months'], ['none', 'Nothing']] },
  ]) },
  { id: 'design', title: 'Design', fields: [
    { k: 'design.font', t: 'select', label: 'Page font', opts: fontOpts },
    { row: [{ k: 'design.text', t: 'color', label: 'Text' }, { k: 'design.lines', t: 'color', label: 'Lines' }, { k: 'design.dots', t: 'color', label: 'Dots' }, { k: 'design.accent', t: 'color', label: 'Sidebar' }], cls: 'row4' },
    { k: 'design.weekendShade', t: 'check', label: 'Shade weekends on month calendars' },
    { custom: 'themes' },
  ] },
  { id: 'nav', title: 'Navigation', fields: [
    { k: 'sidebar.enabled', t: 'check', label: 'Sidebar tabs' },
    { k: 'sidebar.left', t: 'check', label: 'Sidebar on the left', show: (s) => s.sidebar.enabled },
    { k: 'sidebar.showCollections', t: 'check', label: 'Collection links in sidebar', show: (s) => s.sidebar.enabled },
    { k: 'sidebar.font', t: 'select', label: 'Sidebar font', opts: fontOpts, show: (s) => s.sidebar.enabled },
    { k: 'topbar.enabled', t: 'check', label: 'Top bar breadcrumbs' },
    { k: 'topbar.showCollections', t: 'check', label: 'Collection links in top bar', show: (s) => s.topbar.enabled },
    { k: 'topbar.font', t: 'select', label: 'Top bar font', opts: fontOpts, show: (s) => s.topbar.enabled },
  ] },
  { id: 'collections', title: 'Collections', tag: (s) => `${s.collections.length}`, fields: [
    { note: () => 'Collections are numbered page sets with an index page, e.g. Notes, Meetings or Goals. Each index entry links to its pages.' },
    { custom: 'collections' },
  ] },
  { id: 'calendars', title: 'Calendar Events', tag: (s) => { const n = s.calendars.reduce((a, c) => a + (c.events?.length || 0), 0); return n ? `${n} events` : ''; }, fields: [
    { custom: 'calendars' },
  ] },
  { id: 'presets', title: 'Presets & Sharing', fields: [{ custom: 'presets' }] },
];

// ---------------------------------------------------------------- form rendering

function tplOptions(scope, value) {
  return TEMPLATE_GROUPS.map((g) => {
    const opts = TEMPLATES.filter((t) => t.group === g && templateFits(t, scope));
    if (!opts.length) return '';
    return `<optgroup label="${g}">${opts.map((t) => `<option value="${t.id}" ${t.id === value ? 'selected' : ''}>${t.label}</option>`).join('')}</optgroup>`;
  }).join('');
}

function fieldHtml(f) {
  const v = getPath(S, f.k);
  const id = 'f-' + f.k.replace(/\./g, '-');
  const attrs = `id="${id}" data-k="${f.k}" ${f.num ? 'data-num="1"' : ''}`;
  switch (f.t) {
    case 'check': return `<label class="chk"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}/> ${f.label}</label>`;
    case 'select': return `<label class="fld"><span>${f.label}</span><select ${attrs}>${f.opts.map(([o, l]) => `<option value="${o}" ${String(o) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    case 'tpl': return `<label class="fld"><span>${f.label}</span><select ${attrs}>${tplOptions(f.scope, v)}</select></label>`;
    case 'num': return `<label class="fld"><span>${f.label}</span><input type="number" ${attrs} data-num="1" value="${esc(v)}"/></label>`;
    case 'color': return `<label class="fld"><span>${f.label}</span><input type="color" ${attrs} value="${esc(v)}"/></label>`;
    default: return `<label class="fld"><span>${f.label}</span><input type="text" ${attrs} value="${esc(v)}"/></label>`;
  }
}

const showFns = [];
function wrap(html, show) {
  if (!show) return html;
  showFns.push(show);
  return `<div data-show="${showFns.length - 1}">${html}</div>`;
}

function renderPanel() {
  showFns.length = 0;
  const openNow = new Set([...document.querySelectorAll('.panel details[open]')].map((d) => d.dataset.id));
  const first = !$('#panel').children.length;
  $('#panel').innerHTML = SECTIONS.map((sec) => {
    const body = sec.fields.map((f) => {
      if (f.note) return wrap(`<p class="note" data-note="${SECTIONS.indexOf(sec)}">${f.note(S)}</p>`, f.show);
      if (f.custom) return wrap(`<div data-custom="${f.custom}"></div>`, f.show);
      if (f.row) return wrap(`<div class="${f.row.length === 3 ? 'row3' : f.row.length === 4 ? 'row3 r4' : 'row2'}" style="${f.row.length === 4 ? 'grid-template-columns:repeat(4,1fr)' : ''}">${f.row.map((x) => wrap(fieldHtml(x), x.show)).join('')}</div>`, f.show);
      return wrap(fieldHtml(f), f.show);
    }).join('');
    const open = first ? sec.open : openNow.has(sec.id);
    return `<details data-id="${sec.id}" ${open ? 'open' : ''}><summary>${sec.title}<span class="tag" data-tag="${sec.id}"></span></summary><div class="sect">${body}</div></details>`;
  }).join('');
  renderCustom();
  refreshDynamic();
}

function refreshDynamic() {
  document.querySelectorAll('[data-show]').forEach((el) => el.classList.toggle('hidden', !showFns[+el.dataset.show](S)));
  SECTIONS.forEach((sec) => {
    const t = $(`[data-tag="${sec.id}"]`);
    if (t) t.textContent = sec.tag ? sec.tag(S) : '';
    sec.fields.forEach((f) => { if (f.note) { const n = $(`[data-note="${SECTIONS.indexOf(sec)}"]`); if (n) n.textContent = f.note(S); } });
  });
}

$('#panel').addEventListener('change', onFieldInput);
$('#panel').addEventListener('input', (e) => { if (e.target.matches('input[type=text], input[type=color]')) onFieldInput(e); });

function onFieldInput(e) {
  const el = e.target;
  const k = el.dataset.k;
  if (!k) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.num && v !== '') v = +v;
  setPath(S, k, v);
  refreshDynamic();
  changed();
}

// ---------------------------------------------------------------- custom editors

function renderCustom() {
  document.querySelectorAll('[data-custom]').forEach((el) => {
    const fn = CUSTOM[el.dataset.custom];
    if (fn) fn(el);
  });
}

function bindList(el, list, rerender) {
  el.querySelectorAll('[data-li]').forEach((inp) => {
    const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' || inp.type === 'date' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      const [i, key] = inp.dataset.li.split(':');
      let v = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (inp.type === 'number') v = +v;
      list[+i][key] = v;
      changed();
      if (inp.dataset.rerender) rerender();
    });
  });
}

const THEMES = {
  Classic: { text: '#333333', lines: '#c8c8c8', dots: '#555555', accent: '#e0e0e0' },
  'High contrast': { text: '#000000', lines: '#8a8a8a', dots: '#222222', accent: '#d0d0d0' },
  Soft: { text: '#4a4a4a', lines: '#dddddd', dots: '#888888', accent: '#eeeeee' },
  'Navy (color screens)': { text: '#1f3a5f', lines: '#b9c7d8', dots: '#5b7393', accent: '#dfe7f1' },
  'Sage (color screens)': { text: '#344e41', lines: '#c4d3c4', dots: '#5f7a64', accent: '#e3ebe1' },
};

const CUSTOM = {
  themes(el) {
    el.innerHTML = `<div class="fld"><span>Quick themes</span><div class="btnrow">${Object.keys(THEMES).map((t) => `<button class="small" data-theme="${t}">${t}</button>`).join('')}</div></div>`;
    el.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
      Object.assign(S.design, THEMES[b.dataset.theme]);
      renderPanel(); changed();
    }));
  },

  schoolTools(el) {
    const sch = S.school;
    const terms = ['Quarter', 'Term', 'Trimester', 'Semester', 'Marking Period'];
    el.innerHTML = `
      <div class="sect" style="padding:0">
        <div class="btnrow"><button class="small" id="sy-range">Set dates to Aug–Jun school year</button><button class="small" id="sy-teacher">Add teacher collections</button></div>
        <div class="row2">
          <label class="fld"><span>Call quarters</span><select id="sy-term">${terms.map((t) => `<option ${t === sch.termLabel ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="fld"><span>Class periods per day</span><input type="number" min="1" max="14" id="sy-periods" value="${sch.periods}"/></label>
        </div>
        <label class="fld"><span>Period names (comma-separated, optional)</span><input type="text" id="sy-pnames" placeholder="Homeroom, Math 7, Math 8, Lunch, …" value="${esc(sch.periodNames)}"/></label>
        <p class="note">Periods are used by the Lesson Plan templates. Use them on week/day pages or in a collection.</p>
        <div class="fld"><span>No-school days &amp; vacations</span>
          <div id="ns-list" style="display:grid;gap:6px">${sch.noSchool.map((n, i) => `
            <div class="card" style="padding:8px;gap:6px">
              <div class="row2"><input type="date" data-li="${i}:start" value="${n.start || ''}"/><input type="date" data-li="${i}:end" value="${n.end || ''}" title="End date (optional)"/></div>
              <div style="display:flex;gap:6px"><input type="text" data-li="${i}:label" placeholder="Label, e.g. Winter Break" value="${esc(n.label)}" style="flex:1"/><button class="small danger" data-rm="${i}">✕</button></div>
            </div>`).join('')}</div>
          <div class="btnrow"><button class="small" id="ns-add">+ Add no-school day or break</button></div>
        </div>
      </div>`;
    el.querySelectorAll('#ns-list input').forEach((i) => (i.closest('.fld') ? null : null));
    bindList(el.querySelector('#ns-list'), sch.noSchool, () => CUSTOM.schoolTools(el));
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { sch.noSchool.splice(+b.dataset.rm, 1); CUSTOM.schoolTools(el); changed(); }));
    $('#ns-add', el).onclick = () => { sch.noSchool.push({ start: '', end: '', label: '' }); CUSTOM.schoolTools(el); };
    $('#sy-term', el).onchange = (e) => { sch.termLabel = e.target.value; changed(); };
    $('#sy-periods', el).oninput = (e) => { sch.periods = +e.target.value || 1; changed(); };
    $('#sy-pnames', el).oninput = (e) => { sch.periodNames = e.target.value; changed(); };
    $('#sy-range', el).onclick = () => {
      const y = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      Object.assign(S.range, { mode: 'custom', startMonth: 7, startYear: y, months: 11 });
      renderPanel(); changed(); toast(`Dates set to August ${y} – June ${y + 1}.`);
    };
    $('#sy-teacher', el).onclick = () => {
      const add = [
        { name: 'Lesson Plans', template: 'lesson-weekly', indexPages: 1, perIndex: 40, pagesPerItem: 1 },
        { name: 'Gradebook', template: 'gradebook', indexPages: 1, perIndex: 10, pagesPerItem: 2 },
        { name: 'Seating', template: 'seating-chart', indexPages: 1, perIndex: 10, pagesPerItem: 1, nav: false },
        { name: 'Rosters', template: 'roster', indexPages: 1, perIndex: 10, pagesPerItem: 1, nav: false },
        { name: 'Contacts', template: 'contact-log', indexPages: 1, perIndex: 10, pagesPerItem: 4, nav: false },
      ].filter((c) => !S.collections.some((x) => x.name === c.name));
      S.collections.push(...add);
      renderPanel(); changed(); toast(add.length ? `Added ${add.map((c) => c.name).join(', ')}.` : 'Teacher collections are already there.');
    };
  },

  collections(el) {
    const list = S.collections;
    el.innerHTML = `<div style="display:grid;gap:8px">${list.map((c, i) => `
      <div class="card">
        <div class="card-h"><strong>${esc(c.name) || 'Untitled'}</strong>
          <button class="small" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="small danger" data-rm="${i}" title="Remove">✕</button></div>
        <label class="fld"><span>Name</span><input type="text" data-li="${i}:name" value="${esc(c.name)}"/></label>
        <label class="fld"><span>Page template</span><select data-li="${i}:template">${tplOptions('collection', c.template)}</select></label>
        <div class="row3">
          <label class="fld"><span>Index pages</span><input type="number" min="1" max="20" data-li="${i}:indexPages" value="${c.indexPages}"/></label>
          <label class="fld"><span>Items / index</span><input type="number" min="1" max="60" data-li="${i}:perIndex" value="${c.perIndex}"/></label>
          <label class="fld"><span>Pages / item</span><input type="number" min="1" max="10" data-li="${i}:pagesPerItem" value="${c.pagesPerItem}"/></label>
        </div>
        <label class="chk small"><input type="checkbox" data-li="${i}:nav" ${c.nav !== false ? 'checked' : ''}/> Show in sidebar &amp; top-bar links</label>
        <p class="note">${(c.indexPages || 1) * (c.perIndex || 1) * (c.pagesPerItem || 1) + (+c.indexPages || 1)} pages</p>
      </div>`).join('')}
      <div class="btnrow"><button class="small" id="col-add">+ Add collection</button></div></div>`;
    bindList(el, list);
    el.querySelectorAll('[data-li$=":name"]').forEach((inp) => inp.addEventListener('change', () => renderPanel()));
    el.querySelectorAll('input[type=number][data-li]').forEach((inp) => inp.addEventListener('change', () => CUSTOM.collections(el)));
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { list.splice(+b.dataset.rm, 1); renderPanel(); changed(); }));
    el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; renderPanel(); changed(); }));
    $('#col-add', el).onclick = () => { list.push({ name: `Collection ${list.length + 1}`, template: 'lined-m', indexPages: 1, perIndex: 20, pagesPerItem: 1 }); renderPanel(); changed(); };
  },

  calendars(el) {
    const list = S.calendars;
    const card = (c, i) => {
      const head = `<div class="card-h"><strong>${esc(c.name || (c.type === 'holidays' ? 'Public Holidays' : 'Calendar'))}</strong>
        <label class="chk small"><input type="checkbox" data-li="${i}:show" ${c.show !== false ? 'checked' : ''}/> show</label>
        <button class="small danger" data-rm="${i}">✕</button></div>`;
      const count = `<p class="note">${(c.events || []).length} events loaded</p>`;
      if (c.type === 'holidays') return `<div class="card">${head}
        <div style="display:flex;gap:6px"><select data-li="${i}:country" style="flex:1">${COUNTRIES.map(([k, n]) => `<option value="${k}" ${k === c.country ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button class="small" data-load="${i}">Load</button></div>${count}
        ${c.country !== 'US' ? '<p class="note">Non-US holidays come from the free Nager.Date service.</p>' : ''}</div>`;
      if (c.type === 'manual') return `<div class="card">${head}
        <label class="fld"><span>One per line: <code>2027-03-14 Science fair</code> or <code>2027-04-19..2027-04-23 Spring break</code></span>
        <textarea rows="5" data-manual="${i}">${esc(c.text || '')}</textarea></label>${count}</div>`;
      return `<div class="card">${head}
        <label class="fld"><span>Name</span><input type="text" data-li="${i}:name" value="${esc(c.name)}"/></label>
        <label class="fld"><span>ICS calendar URL</span><input type="url" data-li="${i}:url" placeholder="https://…/basic.ics" value="${esc(c.url)}"/></label>
        <div class="btnrow"><button class="small" data-ics-url="${i}">Import from URL</button><label class="small" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--line);border-radius:8px;padding:4px 10px">Upload .ics<input type="file" accept=".ics,text/calendar" data-ics-file="${i}" hidden/></label></div>
        <label class="chk small"><input type="checkbox" data-li="${i}:showTimes" ${c.showTimes !== false ? 'checked' : ''}/> Show event times (e.g. “8am”)</label>
        ${count}<p class="note">Many calendar hosts block browser downloads; if the URL fails, download the .ics file and upload it instead.</p></div>`;
    };
    el.innerHTML = `<div style="display:grid;gap:8px">${list.map(card).join('')}
      <div class="btnrow"><button class="small" data-add="holidays">+ Holidays</button><button class="small" data-add="ics">+ ICS calendar</button><button class="small" data-add="manual">+ Type in events</button></div></div>`;
    bindList(el, list);
    const rr = () => { CUSTOM.calendars(el); refreshDynamic(); };
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { list.splice(+b.dataset.rm, 1); rr(); changed(); }));
    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const t = b.dataset.add;
      const c = t === 'holidays' ? { type: t, name: 'Public Holidays', country: 'US', events: [], show: true }
        : t === 'manual' ? { type: t, name: 'My Events', text: '', events: [], show: true }
        : { type: t, name: 'Calendar', url: '', events: [], show: true };
      list.push(c);
      if (t === 'holidays') await loadHolidays(c);
      rr(); changed();
    }));
    el.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', async () => { await loadHolidays(list[+b.dataset.load], true); rr(); changed(); }));
    el.querySelectorAll('[data-manual]').forEach((ta) => ta.addEventListener('input', () => {
      const c = list[+ta.dataset.manual];
      c.text = ta.value;
      c.events = parseManual(ta.value);
      changed();
      const n = ta.closest('.card').querySelector('.note:last-child'); if (n) n.textContent = `${c.events.length} events loaded`;
    }));
    el.querySelectorAll('[data-ics-url]').forEach((b) => b.addEventListener('click', async () => {
      const c = list[+b.dataset.icsUrl];
      if (!c.url) return toast('Paste an ICS URL first.');
      try {
        const r = await fetch(c.url.replace(/^webcal:/, 'https:'));
        if (!r.ok) throw new Error(r.status);
        importIcs(c, await r.text());
      } catch { toast('Could not download that calendar (the host may block browsers). Try downloading the .ics and uploading it.'); }
      rr();
    }));
    el.querySelectorAll('[data-ics-file]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      const c = list[+inp.dataset.icsFile];
      if (!c.name || c.name === 'Calendar') c.name = f.name.replace(/\.ics$/i, '');
      importIcs(c, await f.text());
      rr();
    }));
  },

  presets(el) {
    const all = listPresets();
    const names = Object.keys(all).sort();
    el.innerHTML = `
      <div style="display:flex;gap:6px"><input type="text" id="pr-name" placeholder="Preset name, e.g. Work 2027" style="flex:1;padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:var(--bg)"/><button class="small" id="pr-save">Save</button></div>
      <div>${names.length ? names.map((n) => `<div class="preset"><span>${esc(n)}</span><button class="small" data-load="${esc(n)}">Load</button><button class="small danger" data-del="${esc(n)}">✕</button></div>`).join('') : '<p class="note">No saved presets yet. Your current settings are kept automatically in this browser.</p>'}</div>
      <div class="btnrow"><button class="small" id="pr-export">Export settings file</button><label class="small" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--line);border-radius:8px;padding:4px 10px">Import settings file<input type="file" accept=".json,application/json" id="pr-import" hidden/></label></div>
      <div class="btnrow"><button class="small" id="pr-share">Copy share link</button><button class="small danger" id="pr-reset">Reset to defaults</button></div>`;
    $('#pr-save', el).onclick = () => {
      const n = $('#pr-name', el).value.trim();
      if (!n) return toast('Give the preset a name.');
      savePreset(n, JSON.parse(JSON.stringify(S))); CUSTOM.presets(el); toast(`Saved “${n}”.`);
    };
    el.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => { S = normalize(listPresets()[b.dataset.load]); renderPanel(); changed(); toast(`Loaded “${b.dataset.load}”.`); }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { if (confirm(`Delete preset “${b.dataset.del}”?`)) { deletePreset(b.dataset.del); CUSTOM.presets(el); } }));
    $('#pr-export', el).onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'eplanner-settings.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#pr-import', el).onchange = async (e) => {
      try { S = normalize(JSON.parse(await e.target.files[0].text())); renderPanel(); changed(); toast('Settings imported.'); }
      catch { toast('That file is not an ePlanner settings file.'); }
    };
    $('#pr-share', el).onclick = share;
    $('#pr-reset', el).onclick = () => { if (confirm('Reset all settings to defaults? Saved presets are kept.')) { S = defaults(); loadHolidays(S.calendars[0]).then(() => { renderPanel(); changed(); }); } };
  },
};

function parseManual(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d{4}-\d{2}-\d{2})(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2}))?\s+(.+)$/.exec(line);
    if (m) out.push({ date: m[1], end: m[2], title: m[3].trim() });
  }
  return out;
}

function importIcs(c, text) {
  const r = computeRange(S);
  c.events = parseIcs(text, r.start, r.end);
  c.loadedRange = ymd(r.start) + ymd(r.end);
  changed();
  toast(`Imported ${c.events.length} events in your planner’s date range.`);
}

async function loadHolidays(c, force) {
  const r = computeRange(S);
  const years = [...new Set(r.months.map((m) => m.y))];
  const key = c.country + years.join(',');
  if (!force && c.loadedFor === key) return;
  try {
    c.events = await fetchHolidays(c.country, years);
    c.loadedFor = key;
  } catch (e) {
    toast(String(e.message || e));
  }
}

// ---------------------------------------------------------------- planner + preview

let timer = null;
function changed() {
  saveCurrent(S);
  clearTimeout(timer);
  timer = setTimeout(rebuild, 120);
}

async function rebuild() {
  // keep holiday calendars in sync with the date range
  let reloaded = false;
  for (const c of S.calendars) if (c.type === 'holidays') {
    const before = c.loadedFor;
    await loadHolidays(c);
    if (c.loadedFor !== before) reloaded = true;
  }
  if (reloaded) { saveCurrent(S); const el = $('[data-custom="calendars"]'); if (el) CUSTOM.calendars(el); refreshDynamic(); }

  P = buildPlanner(S);
  applyVars($('#pv-page'));
  loadBrowserFonts(usedFonts()).then(() => fit());
  const groups = {};
  P.pages.forEach((p, i) => (groups[p.group] ||= []).push(`<option value="${p.id}">${p.label}</option>`));
  $('#pv-select').innerHTML = Object.entries(groups).map(([g, o]) => `<optgroup label="${g}">${o.join('')}</optgroup>`).join('');
  const d = P.size.device;
  $('#meta').textContent = `${P.pages.length} pages · ${P.range.label} · ${d.id === 'custom' ? 'Custom size' : d.name}`;
  if (!P.ids.has(current)) current = P.pages[0]?.id;
  show(current, false);
}

function applyVars(el) {
  const s = S;
  el.style.setProperty('--pw', P.size.w);
  el.style.setProperty('--ph', P.size.h);
  el.style.setProperty('--text', s.design.text);
  el.style.setProperty('--line', s.design.lines);
  el.style.setProperty('--dot', s.design.dots);
  el.style.setProperty('--accent', s.design.accent);
  el.style.setProperty('--font', `'${s.design.font}'`);
  el.style.setProperty('--sbfont', `'${s.sidebar.font}'`);
  el.style.setProperty('--tbfont', `'${s.topbar.font}'`);
  el.style.setProperty('--rs', +s.toolbarSize || 36);
}

const usedFonts = () => [...new Set([S.design.font, S.sidebar.font, S.topbar.font, S.cover.font])];

function show(id, push = true) {
  const i = P.pages.findIndex((p) => p.id === id);
  if (i < 0) return;
  if (push && current && current !== id) history_.push(current);
  current = id;
  // ids are renamed so the preview never duplicates ids of the page being exported
  $('#pv-page').innerHTML = P.renderPage(P.pages[i], 'pv' + i).replace(/ id="/g, ' data-pv-id="');
  $('#pv-select').value = id;
  $('#pv-count').textContent = `${i + 1} / ${P.pages.length}`;
  $('#pv-back').disabled = !history_.length;
  fit();
}

function fit() {
  const stage = $('#pv-stage');
  const sc = $('#pv-scale');
  const pad = 40;
  let k = 1;
  if ($('#pv-fit').checked) k = Math.min((stage.clientWidth - pad) / P.size.w, (stage.clientHeight - pad) / P.size.h);
  k = Math.max(0.2, k);
  sc.style.transform = `scale(${k})`;
  sc.style.width = P.size.w * k + 'px';
  sc.style.height = P.size.h * k + 'px';
}

const step = (n) => {
  const i = P.pages.findIndex((p) => p.id === current);
  const j = Math.max(0, Math.min(P.pages.length - 1, i + n));
  show(P.pages[j].id);
};

$('#pv-prev').onclick = () => step(-1);
$('#pv-next').onclick = () => step(1);
$('#pv-select').onchange = (e) => show(e.target.value);
$('#pv-back').onclick = () => { const id = history_.pop(); if (id) show(id, false); };
$('#pv-fit').onchange = fit;
window.addEventListener('resize', fit);
$('#pv-stage').addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  show(a.getAttribute('href').slice(1));
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});

// ---------------------------------------------------------------- export / share

const fileName = () => {
  const d = P.size.device;
  return `ePlanner ${P.range.label} ${d.id === 'custom' ? `${S.customW}x${S.customH}` : d.name}.pdf`.replace(/[\\/:*?"<>|–]+/g, '-');
};

async function buildPdfBytes(onProgress) {
  await loadBrowserFonts(usedFonts());
  await document.fonts.ready;
  return exportPdf({
    pages: P.pages,
    renderPage: P.renderPage,
    size: P.size,
    families: usedFonts(),
    fallback: S.design.font,
    prepareHost: applyVars,
    title: `ePlanner ${P.range.label}`,
    onProgress,
  });
}

let exporting = false;
async function exportFile() {
  if (exporting) return;
  exporting = true;
  const total = P.pages.length;
  $('#ov-text').textContent = `Building page 0 of ${total}…`;
  $('#overlay').hidden = false;
  try {
    const t0 = performance.now();
    const bytes = await buildPdfBytes((done) => { $('#ov-text').textContent = `Building page ${done} of ${total}…`; });
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`Exported ${total} pages (${(bytes.length / 1048576).toFixed(1)} MB) in ${Math.round((performance.now() - t0) / 1000)}s.`, 5000);
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message || e}`, 8000);
  } finally {
    $('#overlay').hidden = true;
    exporting = false;
  }
}
// Exposed for automated checks (returns the PDF bytes without downloading).
window.ePlanner = { buildPdfBytes, fileName };

async function share() {
  const url = location.origin + location.pathname + toShareHash(S);
  try { await navigator.clipboard.writeText(url); toast('Share link copied. Imported calendar events aren’t included in links.'); }
  catch { prompt('Copy this link:', url); }
}

$('#btn-export').onclick = exportFile;
$('#btn-share').onclick = share;

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------- start
renderPanel();
rebuild();
