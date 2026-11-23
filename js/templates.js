// Page templates. Each renderer returns HTML that fills the page's content box.
// Everything is drawn with HTML borders or inline SVG patterns so the PDF stays
// vector (crisp on e-ink, small file size).

import { MONTHS, MON, DAY3, DAY2, daysInMonth, monthGrid, weekOrder, ordinal, hourLabel, addDays, startOfWeek } from './dates.js';
import { dayId, weekId, monthId, esc } from './ids.js';

const SZ = { s: 20, m: 26, l: 34 };

// ---------- drawing helpers ----------

// Explicit vector geometry (not SVG <pattern>, which Chrome rasterizes into
// soft tiles in PDFs). The SVG covers the whole content box and the .fill
// container clips it, so lines/dots stay aligned to the box's top-left.
function pattern(ctx, kind, size) {
  const W = Math.ceil(ctx.cw), H = Math.ceil(ctx.ch);
  const cols = Math.floor(W / size), rws = Math.floor(H / size);
  let d = '', cls = 'ln', sw = 0.8, cap = 'butt';
  if (kind === 'lines') {
    for (let r = 1; r <= rws; r++) d += `M0 ${r * size - 0.5}H${W}`;
  } else if (kind === 'grid') {
    sw = 0.6;
    for (let r = 0; r <= rws; r++) d += `M0 ${r * size}H${cols * size}`;
    for (let c = 0; c <= cols; c++) d += `M${c * size} 0V${rws * size}`;
  } else if (kind === 'dots') {
    cls = 'dotp'; cap = 'round'; sw = size < 22 ? 1.7 : 2.1;
    for (let r = 0; r < rws; r++) for (let c = 0; c < cols; c++) d += `M${c * size + size / 2} ${r * size + size / 2}h.01`;
  }
  return `<svg class="pat" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${d}" class="${cls}" fill="none" stroke-width="${sw}" stroke-linecap="${cap}"/></svg>`;
}
const fill = (ctx, kind, size = SZ.m, cls = '') => `<div class="fill ${cls}">${kind === 'blank' ? '' : pattern(ctx, kind, size)}</div>`;
const lined = (ctx, size = SZ.m, cls = '') => fill(ctx, 'lines', size, cls);
const sec = (title, body, cls = '', style = '') => `<div class="sec ${cls}" style="${style}"><div class="sec-h">${title}</div>${body}</div>`;
const field = (label, style = '') => `<div class="field" style="${style}"><span>${label}</span><i></i></div>`;
const box = '<span class="cb"></span>';

function rows(n, cellFn, cls = '') {
  let h = `<div class="rows ${cls}">`;
  for (let i = 0; i < n; i++) h += `<div class="row">${cellFn(i)}</div>`;
  return h + '</div>';
}

// CSS-grid table. cols: [{label, w}], n data rows.
function table(cols, n, opts = {}) {
  const { header = true, cell = () => '', cls = '', headCell } = opts;
  const tpl = cols.map((c) => c.w || '1fr').join(' ');
  let h = `<div class="gt ${cls}" style="grid-template-columns:${tpl};grid-template-rows:${header ? 'auto ' : ''}repeat(${n},1fr)">`;
  if (header) cols.forEach((c, i) => (h += `<div class="gth">${headCell ? headCell(c, i) : c.label}</div>`));
  for (let r = 0; r < n; r++) cols.forEach((c, i) => (h += `<div class="gtc">${cell(r, i)}</div>`));
  return h + '</div>';
}

const countFor = (h, size) => Math.max(1, Math.floor(h / size));

// Lists every event for a day in the space available (avail = px height).
// Text shrinks from maxFs down to EV_MIN so more items fit; names wrap onto a
// second line when there's room. Only if items still don't fit at the
// smallest size is the list cut short with "+N more".
const EV_MIN = 6, EV_LH = 1.2, EV_GAP = 1.5;
function eventsHtml(ctx, d, avail = 60, maxFs = 8.5) {
  const ev = ctx.eventsOn(d);
  if (!ev.length) return '';
  const n = ev.length;
  const rowH = (fs, lines) => fs * EV_LH * lines + EV_GAP + 1;
  let fs = Math.min(maxFs, (avail / n - EV_GAP - 1) / EV_LH);
  let shown = n;
  if (fs < EV_MIN) {
    fs = EV_MIN;
    shown = Math.max(1, Math.floor(avail / rowH(fs, 1)) - 1);
  }
  const lines = avail >= shown * rowH(fs, 2) ? 2 : 1;
  const items = ev.slice(0, shown).map((e) => `<div class="ev ${e.noSchool ? 'ns' : ''}">${esc(e.title)}</div>`).join('');
  const more = shown < n ? `<div class="ev more">+${n - shown} more</div>` : '';
  return `<div class="evs" style="--evfs:${fs.toFixed(2)}px;--evlines:${lines}">${items}${more}</div>`;
}

function periodNames(ctx) {
  const n = Math.max(1, Math.min(14, +ctx.s.school.periods || 6));
  const names = String(ctx.s.school.periodNames || '').split(',').map((x) => x.trim());
  return Array.from({ length: n }, (_, i) => names[i] || `Period ${i + 1}`);
}

// ---------- calendars ----------

export function miniCalendar(ctx, y, m, cls = '') {
  const order = weekOrder(ctx.s.weekStart);
  let h = `<div class="mini ${cls}">${ctx.link(monthId(y, m), MONTHS[m], 'mini-t', 'a')}<div class="mini-g">`;
  order.forEach((d) => (h += `<span class="mini-dow">${DAY2[d]}</span>`));
  for (const row of monthGrid(y, m, ctx.s.weekStart)) {
    for (const d of row) {
      if (!d) { h += '<span></span>'; continue; }
      const ns = ctx.noSchool(d) ? ' ns' : '';
      const ev = ctx.eventsOn(d).length ? ' has-ev' : '';
      h += ctx.link(dayId(d), d.getDate(), 'mini-d' + ns + ev, 'span');
    }
  }
  return h + '</div></div>';
}

function monthCalendar(ctx, y, m, half) {
  const order = weekOrder(ctx.s.weekStart);
  const grid = monthGrid(y, m, ctx.s.weekStart);
  const wk = ctx.s.week.showWeekNums;
  // height left in a day cell for events: calendar height / rows, minus the date and padding
  const calH = half ? ctx.ch * 0.52 : ctx.ch;
  const cellAvail = (calH - 20) / grid.length - 26;
  let h = `<div class="cal ${half ? 'cal-half' : ''} ${wk ? 'with-wk' : ''}" style="grid-template-rows:auto repeat(${grid.length},1fr)">`;
  if (wk) h += '<div class="cal-dow"></div>';
  order.forEach((d) => (h += `<div class="cal-dow">${DAY3[d]}</div>`));
  for (const row of grid) {
    const first = row.find(Boolean);
    const ws = startOfWeek(first, ctx.s.weekStart);
    if (wk) h += ctx.link(weekId(ws), `<span>Week ${ctx.weekNum(ws)}</span>`, 'cal-wk', 'div');
    row.forEach((d, i) => {
      if (!d) { h += '<div class="cc out"></div>'; return; }
      const we = ctx.s.design.weekendShade && (d.getDay() === 0 || d.getDay() === 6) ? ' we' : '';
      const ns = ctx.noSchool(d) ? ' ns' : '';
      h += ctx.link(dayId(d), `<span class="dn"><small>${DAY3[d.getDay()]}</small> ${d.getDate()}</span>${eventsHtml(ctx, d, cellAvail)}`, 'cc' + we + ns, 'div');
    });
  }
  return h + '</div>';
}

// ---------- weekly helpers ----------

function weekDays(ctx) {
  if (ctx.week) return ctx.week.days;
  const start = startOfWeek(ctx.date || new Date(), ctx.s.weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
const dayHead = (ctx, d, cls = '') => ctx.link(dayId(d), `${DAY3[d.getDay()]} ${d.getDate()}<sup>${ordinal(d.getDate())}</sup>`, 'dh ' + cls, 'div');

// ---------- template registry ----------

const T = [];
const add = (id, label, group, render, scopes) => T.push({ id, label, group, render, scopes });

// Basic
add('blank', 'Blank Page', 'Basic', () => '<div class="fill"></div>');
for (const [k, n] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) {
  add(`dotted-${k}`, `Dotted Grid – ${n}`, 'Basic', (ctx) => fill(ctx, 'dots', SZ[k], 'bleed'));
}
for (const [k, n] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) {
  add(`grid-${k}`, `Grid – ${n}`, 'Basic', (ctx) => fill(ctx, 'grid', SZ[k], 'boxed'));
}
for (const [k, n] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) {
  add(`lined-${k}`, `Lined – ${n}`, 'Basic', (ctx) => lined(ctx, SZ[k]));
}
for (const [k, n] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) {
  add(`numbered-${k}`, `Numbered – ${n}`, 'Basic', (ctx) => rows(countFor(ctx.ch, SZ[k]), (i) => `<span class="num">${i + 1}.</span>`));
}
for (const [k, n] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) {
  add(`todo-${k}`, `To-do List – ${n}`, 'Basic', (ctx) => rows(countFor(ctx.ch, SZ[k] + 4), () => box));
}
add('task-progress', 'Task List – Progress', 'Basic', (ctx) =>
  table(
    [{ label: '', w: '28px' }, { label: 'Task', w: '1fr' }, { label: 'Progress', w: '120px' }, { label: 'Due', w: '70px' }],
    countFor(ctx.ch - 24, 32),
    { cell: (r, c) => (c === 0 ? box : c === 2 ? '<span class="prog"><i></i><i></i><i></i><i></i></span>' : '') },
  ));

// Planning
add('agenda-daily', 'Agenda – Daily (hourly lines)', 'Planning', (ctx) => {
  const { start, end } = ctx.s.hours;
  const ev = ctx.date ? eventsHtml(ctx, ctx.date, 999, 10) : '';
  let h = ev ? `<div class="evbar">${ev}</div>` : '';
  h += '<div class="hours">';
  for (let hr = start; hr <= end; hr++) h += `<div class="hr"><span class="hl">${hourLabel(hr, ctx.s.clock24)}</span><i></i></div>`;
  return h + '</div>';
});
add('agenda-daily-dotted', 'Agenda – Daily (dotted, hours on side)', 'Planning', (ctx) => {
  const size = SZ.m;
  const { start, end } = ctx.s.hours;
  const nrows = Math.floor(ctx.ch / size);
  const hours = end - start + 1;
  const step = Math.max(1, Math.floor((nrows - 1) / hours));
  let labels = '';
  for (let i = 0; i < hours && (i + 1) * step < nrows; i++) {
    const y = ((i + 1) * step + 0.5) * size;
    labels += `<span class="side-hr" style="top:${y}px">${hourLabel(start + i, ctx.s.clock24)}</span>`;
  }
  const ev = ctx.date ? eventsHtml(ctx, ctx.date, 999, 10) : '';
  return `<div class="fill bleed">${pattern(ctx, 'dots', size)}${labels}${ev ? `<div class="evfloat">${ev}</div>` : ''}</div>`;
});
add('daily-planner', 'Daily Planner (schedule + to-do + notes)', 'Planning', (ctx) => {
  const { start, end } = ctx.s.hours;
  const ev = ctx.date ? eventsHtml(ctx, ctx.date, 999, 10) : '';
  let sched = '<div class="hours half">';
  for (let hr = start; hr <= end; hr++) sched += `<div class="hr"><span class="hl">${hourLabel(hr, ctx.s.clock24)}</span><i></i></div>`;
  sched += '</div>';
  return `${ev ? `<div class="evbar">${ev}</div>` : ''}<div class="cols">
    ${sec('Schedule', sched, '', 'flex:1.1')}
    <div class="stack" style="flex:1">
      ${sec('Top Priorities', rows(3, () => box), '', 'flex:0 0 112px')}
      ${sec('To-do', rows(9, () => box), '', 'flex:0 0 300px')}
      ${sec('Notes', lined(ctx))}
    </div></div>`;
});
add('agenda-weekly', 'Agenda – Weekly (hourly columns)', 'Planning', (ctx) => {
  const days = weekDays(ctx);
  const { start, end } = ctx.s.hours;
  const n = end - start + 1;
  const hasEv = days.some((d) => ctx.eventsOn(d).length);
  let h = `<div class="wk-ag" style="grid-template-rows:auto ${hasEv ? 'auto ' : ''}repeat(${n},1fr)">`;
  h += '<div></div>' + days.map((d) => dayHead(ctx, d)).join('');
  if (hasEv) h += '<div class="wk-ev-l"></div>' + days.map((d) => `<div class="wk-ev">${eventsHtml(ctx, d, 64)}</div>`).join('');
  for (let hr = start; hr <= end; hr++) {
    h += `<div class="wk-hl">${hourLabel(hr, ctx.s.clock24)}</div>`;
    days.forEach((d) => (h += `<div class="wk-c ${ctx.noSchool(d) ? 'ns' : ''}"></div>`));
  }
  return h + '</div>';
}, ['week']);
add('notes-weekly', 'Notes – Weekly (boxes)', 'Planning', (ctx) => {
  const days = weekDays(ctx);
  let h = '<div class="wk-box">';
  days.forEach((d) => (h += `<div class="wb">${dayHead(ctx, d)}${eventsHtml(ctx, d, 70)}${lined(ctx, SZ.s)}</div>`));
  return h + `<div class="wb"><div class="dh">Notes</div>${lined(ctx, SZ.s)}</div></div>`;
}, ['week']);
add('notes-weekly-columns', 'Notes – Weekly – Columns', 'Planning', (ctx) => {
  const days = weekDays(ctx);
  return `<div class="wk-cols">${days.map((d) => `<div class="wcol">${dayHead(ctx, d)}${eventsHtml(ctx, d, 90)}${lined(ctx, SZ.s)}</div>`).join('')}</div>`;
}, ['week']);
add('notes-weekly-rows', 'Notes – Weekly – Rows', 'Planning', (ctx) => {
  const days = weekDays(ctx);
  return `<div class="wk-rows">${days.map((d) => `<div class="wrow">${dayHead(ctx, d, 'side')}<div class="wrow-b">${eventsHtml(ctx, d, 50)}${lined(ctx, SZ.s)}</div></div>`).join('')}</div>`;
}, ['week']);
add('notes-daily', 'Notes – Daily', 'Planning', (ctx) => {
  const ev = ctx.date ? eventsHtml(ctx, ctx.date, 999, 10) : '';
  return `${ev ? `<div class="evbar">${ev}</div>` : ''}${lined(ctx)}`;
});
add('calendar', 'Calendar (full page)', 'Planning', (ctx) => monthCalendar(ctx, ctx.month.y, ctx.month.m, false), ['month']);
add('calendar-notes', 'Calendar – With Notes', 'Planning', (ctx) =>
  `${monthCalendar(ctx, ctx.month.y, ctx.month.m, true)}<div class="sec-h center">Notes</div>${fill(ctx, 'dots', SZ.m, 'bleed')}`, ['month']);
add('quarter-calendars', 'Quarter – Calendars + Notes', 'Planning', (ctx) => {
  const months = ctx.quarter ? ctx.quarter.months : [];
  return `<div class="q-rows">${months.map(({ y, m }) => `<div class="q-row">${miniCalendar(ctx, y, m)}${lined(ctx, SZ.s)}</div>`).join('')}</div>`;
}, ['quarter']);
function monthBlocks(ctx, months) {
  const cols = months.length > 4 ? 2 : 1;
  return `<div class="mblocks" style="grid-template-columns:repeat(${cols},1fr)">${months
    .map(({ y, m }) => `<div class="mb">${ctx.link(monthId(y, m), MONTHS[m], 'mb-t', 'div')}${lined(ctx, SZ.s)}</div>`)
    .join('')}</div>`;
}
add('notes-yearly', 'Notes – Yearly (by month)', 'Planning', (ctx) => monthBlocks(ctx, ctx.yearMonths.slice(0, 12)));
add('notes-quarterly', 'Notes – Quarterly (by month)', 'Planning', (ctx) => monthBlocks(ctx, ctx.quarter ? ctx.quarter.months : ctx.yearMonths.slice(0, 3)));

// Notes
add('cornell', 'Cornell Notes', 'Notes', (ctx) => `
  <div class="cols tight">${field('Topic', 'flex:2')}${field('Date', 'flex:1')}</div>
  <div class="cornell">
    <div class="c-cue"><div class="sec-h">Cues / Questions</div>${lined(ctx)}</div>
    <div class="c-notes"><div class="sec-h">Notes</div>${lined(ctx)}</div>
  </div>
  ${sec('Summary', lined(ctx), '', 'flex:0 0 22%')}`);
add('meeting', 'Meeting Notes', 'Notes', (ctx) => `
  <div class="cols tight">${field('Meeting', 'flex:2')}${field('Date', 'flex:1')}${field('Time', 'flex:1')}</div>
  ${field('Attendees')}${field('')}
  ${sec('Agenda', rows(4, (i) => `<span class="num">${i + 1}.</span>`), '', 'flex:0 0 130px')}
  ${sec('Notes', lined(ctx))}
  ${sec('Action Items', table([{ label: '', w: '28px' }, { label: 'Task' }, { label: 'Owner', w: '110px' }, { label: 'Due', w: '80px' }], 6, { cell: (r, c) => (c === 0 ? box : '') }), '', 'flex:0 0 210px')}`);

// Goals & reflection
add('goals', 'Goal Planner', 'Goals & Reflection', (ctx) => `
  ${field('Goal', 'font-size:15px')}
  <div class="cols tight">${field('Start', 'flex:1')}${field('Target date', 'flex:1')}${field('Category', 'flex:1')}</div>
  ${sec('Why it matters', lined(ctx), '', 'flex:0 0 100px')}
  ${sec('Action steps', rows(8, () => box), '', 'flex:0 0 250px')}
  <div class="cols" style="flex:0 0 110px">${sec('Obstacles', lined(ctx))}${sec('Rewards', lined(ctx))}</div>
  ${sec('Progress notes', lined(ctx))}`);
function habitGrid(ctx, n, labelFn) {
  const cols = [{ label: 'Habit', w: '150px' }, ...Array.from({ length: n }, (_, i) => ({ label: labelFn(i), w: '1fr' }))];
  return table(cols, countFor(ctx.ch - 40, 30), { cls: 'habit' });
}
add('habits-month', 'Habit Tracker – Monthly', 'Goals & Reflection', (ctx) => {
  const { y, m } = ctx.month || { y: new Date().getFullYear(), m: null };
  const n = m == null ? 31 : daysInMonth(y, m);
  return habitGrid(ctx, n, (i) => (m == null ? i + 1 : `<small>${DAY2[new Date(y, m, i + 1).getDay()][0]}</small>${i + 1}`));
});
add('habits-week', 'Habit Tracker – Weekly', 'Goals & Reflection', (ctx) => {
  const days = weekDays(ctx);
  return habitGrid(ctx, 7, (i) => (ctx.week ? `${DAY3[days[i].getDay()]} ${days[i].getDate()}` : DAY3[days[i].getDay()]));
});
add('gratitude', 'Gratitude & Journal', 'Goals & Reflection', (ctx) => `
  ${sec('Three things I’m grateful for', rows(3, (i) => `<span class="num">${i + 1}.</span>`), '', 'flex:0 0 112px')}
  ${sec('What would make today great?', lined(ctx), '', 'flex:0 0 100px')}
  ${sec('Affirmation', lined(ctx), '', 'flex:0 0 60px')}
  ${sec('Journal', lined(ctx))}
  ${sec('Highlight of the day', lined(ctx), '', 'flex:0 0 74px')}`);
add('weekly-reflection', 'Weekly Reflection', 'Goals & Reflection', (ctx) => `
  <div class="cols" style="flex:1">${sec('What went well', lined(ctx))}${sec('What didn’t', lined(ctx))}</div>
  ${sec('What I learned', lined(ctx), '', 'flex:.6')}
  ${sec('Focus for next week', rows(5, () => box), '', 'flex:0 0 170px')}`);
add('monthly-review', 'Monthly Review', 'Goals & Reflection', (ctx) => {
  const areas = ['Health', 'Work', 'Family', 'Friends', 'Finances', 'Growth', 'Fun', 'Rest'];
  const rating = areas.map((a) => `<div class="rate"><span>${a}</span>${Array.from({ length: 10 }, (_, i) => `<b>${i + 1}</b>`).join('')}</div>`).join('');
  return `<div class="cols" style="flex:1">${sec('Wins', lined(ctx))}${sec('Challenges', lined(ctx))}</div>
  ${sec('Lessons learned', lined(ctx), '', 'flex:.6')}
  ${sec('Life balance', `<div class="rates">${rating}</div>`, '', 'flex:0 0 auto')}
  ${sec('Focus for next month', rows(4, () => box), '', 'flex:0 0 140px')}`;
});

// Life admin
add('meal-plan', 'Meal Planner – Weekly', 'Life Admin', (ctx) => {
  const days = weekDays(ctx);
  const meals = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  return `${table([{ label: '', w: '70px' }, ...meals.map((m) => ({ label: m }))], 7, {
    cell: (r, c) => (c === 0 ? `<b>${DAY3[days[r].getDay()]}${ctx.week ? ' ' + days[r].getDate() : ''}</b>` : ''),
    cls: 'meal',
  })}
  ${sec('Grocery list', `<div class="cols">${rows(9, () => box)}${rows(9, () => box)}${rows(9, () => box)}</div>`, '', 'flex:0 0 300px')}`;
});
add('budget-monthly', 'Budget – Monthly', 'Life Admin', () => `
  <div class="cols" style="flex:0 0 160px">
    ${sec('Income', table([{ label: 'Source' }, { label: 'Expected', w: '80px' }, { label: 'Actual', w: '80px' }], 4))}
    ${sec('Summary', table([{ label: '' }, { label: 'Amount', w: '100px' }], 4, { cell: (r, c) => (c ? '' : ['Income', 'Expenses', 'Savings', 'Balance'][r]) }))}
  </div>
  ${sec('Bills & fixed expenses', table([{ label: 'Bill' }, { label: 'Due', w: '60px' }, { label: 'Amount', w: '90px' }, { label: 'Paid', w: '44px' }], 10, { cell: (r, c) => (c === 3 ? box : '') }))}
  ${sec('Spending by category', table([{ label: 'Category' }, { label: 'Budget', w: '90px' }, { label: 'Spent', w: '90px' }, { label: 'Left', w: '90px' }], 8))}`);
add('expense-log', 'Expense Log', 'Life Admin', (ctx) =>
  table([{ label: 'Date', w: '70px' }, { label: 'Description' }, { label: 'Category', w: '120px' }, { label: 'Amount', w: '90px' }], countFor(ctx.ch - 24, 28)));
add('reading-list', 'Reading List', 'Life Admin', (ctx) =>
  table([{ label: '#', w: '30px' }, { label: 'Title' }, { label: 'Author', w: '140px' }, { label: 'Started', w: '64px' }, { label: 'Finished', w: '64px' }, { label: 'Rating', w: '70px' }],
    countFor(ctx.ch - 24, 32), { cell: (r, c) => (c === 0 ? r + 1 : c === 5 ? '<span class="stars"><i></i><i></i><i></i><i></i><i></i></span>' : '') }));

// Teacher
add('lesson-weekly', 'Lesson Plan – Weekly (by period)', 'Teacher', (ctx) => {
  const days = weekDays(ctx).filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  const periods = periodNames(ctx);
  return table([{ label: '', w: '74px' }, ...days.map((d) => ({ label: ctx.week ? dayHead(ctx, d) : DAY3[d.getDay()] }))], periods.length, {
    cell: (r, c) => (c === 0 ? `<b class="per">${esc(periods[r])}</b>` : ''),
    cls: 'lesson',
  });
});
add('lesson-daily', 'Lesson Plan – Daily (by period)', 'Teacher', (ctx) => {
  const periods = periodNames(ctx);
  return table([{ label: 'Period', w: '74px' }, { label: 'Objective' }, { label: 'Activities' }, { label: 'Materials', w: '110px' }, { label: 'Homework', w: '110px' }], periods.length, {
    cell: (r, c) => (c === 0 ? `<b class="per">${esc(periods[r])}</b>` : ''),
    cls: 'lesson',
  });
});
add('seating-chart', 'Seating Chart', 'Teacher', (ctx) => {
  let desks = '';
  for (let i = 0; i < 30; i++) desks += '<div class="desk"><i></i><i></i></div>';
  return `<div class="cols tight">${field('Class / Period', 'flex:2')}${field('Room', 'flex:1')}${field('Date', 'flex:1')}</div>
    <div class="desks">${desks}</div><div class="front">Front of room</div>
    ${sec('Notes', lined(ctx), '', 'flex:0 0 120px')}`;
});
add('gradebook', 'Gradebook', 'Teacher', (ctx) =>
  `${field('Class / Period')}${table([{ label: '#', w: '24px' }, { label: 'Student', w: '150px' }, ...Array.from({ length: 16 }, () => ({ label: '' })), { label: 'Avg', w: '40px' }],
    countFor(ctx.ch - 90, 25), { cell: (r, c) => (c === 0 ? r + 1 : ''), cls: 'grades' })}`);
add('roster', 'Class Roster', 'Teacher', (ctx) =>
  `${field('Class / Period')}${table([{ label: '#', w: '24px' }, { label: 'Student' }, { label: 'Parent / Guardian' }, { label: 'Phone / Email' }, { label: 'Notes', w: '120px' }],
    countFor(ctx.ch - 90, 28), { cell: (r, c) => (c === 0 ? r + 1 : '') })}`);
add('contact-log', 'Parent Contact Log', 'Teacher', (ctx) =>
  table([{ label: 'Date', w: '64px' }, { label: 'Student', w: '120px' }, { label: 'Contact', w: '110px' }, { label: 'Method', w: '70px' }, { label: 'Notes / Outcome' }],
    countFor(ctx.ch - 24, 44)));

export const TEMPLATES = T;
export const TEMPLATE_GROUPS = [...new Set(T.map((t) => t.group))];
export const templateById = (id) => T.find((t) => t.id === id) || T.find((t) => t.id === 'dotted-m');
export const templateFits = (t, scope) => !t.scopes || t.scopes.includes(scope);

export function renderTemplate(id, ctx) {
  let t = templateById(id);
  if (!templateFits(t, ctx.scope)) t = templateById('dotted-m');
  return t.render(ctx);
}
