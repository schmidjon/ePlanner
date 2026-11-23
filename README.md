# ePlanner

A browser-based builder for hyperlinked PDF planners for e-paper tablets (Boox, reMarkable, Kindle Scribe, Supernote, Kobo). Pick your settings in the side panel, click through a live preview, then export the PDF.

It's plain HTML/CSS/JavaScript with no build step and no server code, so it can be hosted anywhere static files are served.

## Run it locally

```bash
python3 devserver.py
```

Then open <http://localhost:5173>. The dev server turns off caching so edits show up on reload. `python3 -m http.server 5173` also works. Opening `index.html` directly from disk won't work, because browsers block JavaScript modules on `file://` pages.

## Export the PDF

Click **Export PDF**. The planner is built in your browser and downloads as a file such as `ePlanner 2027 Boox Go 10.3.pdf`, with no print dialog. Copy it to your tablet; on Boox, open it in NeoReader. Tabs, dates, breadcrumbs and index entries are all links.

- **Exact page size**: the device's aspect ratio is written straight into the PDF, so there's nothing to scale or crop.
- **Vector output**: crisp on e-ink. Fonts are embedded, and only the characters used are included.
- **Size and speed**: a full year with daily pages is about 600 pages, roughly 5 MB, and builds in a few seconds.
- **Fonts**: they load from Fontsource on jsDelivr. The preview uses the same files, so text measures identically.

## Features

- **Devices**: Boox Go 10.3 (default) plus other Boox models, reMarkable 2 / Paper Pro / Move, Kindle Scribe, Supernote, Kobo, A5/Letter paper, or a custom size. Landscape option, and an optional margin for an on-screen toolbar.
- **Views**: cover, year, quarters/terms, months, weeks and days. Each view has its own page template and extra note pages.
- **Navigation**: sidebar tabs (left or right; choose what they list) and top-bar breadcrumbs, with fonts set separately.
- **48 page templates** in six groups:
  - Basic: dotted, grid, lined, numbered and to-do pages in three sizes
  - Planning: hourly agendas, weekly layouts, calendars
  - Notes: Cornell, meeting
  - Goals & Reflection: goals, habit trackers, gratitude/journal, weekly and monthly reviews
  - Life Admin: meal plan, budget, expense log, reading list
  - Teacher: weekly and daily lesson plans by period, seating chart, gradebook, roster, parent contact log
- **School year**: one-click Aug–Jun dates, quarters renamed to terms/trimesters/semesters, class periods for lesson plans, no-school days and breaks (hatched on calendars), and one-click teacher collections.
- **Collections**: numbered page sets with linked index pages. Choose each one's template and whether it appears in the navigation.
- **Calendar events**: lists every event on the day, shrinking the text when a day is busy. Built-in US holidays, other countries via the free [Nager.Date](https://date.nager.at) API, ICS import (URL or file, including recurring events, with an option to hide event times), and typed-in events.
- **Design**: page, sidebar, top-bar and cover fonts (Google Fonts); text, line, dot and sidebar colors; quick themes.
- **Presets**: settings save automatically in the browser. You can also save named presets, export or import a settings file, or copy a share link.

## Project layout

```
index.html          builder shell
devserver.py        local no-cache dev server
css/builder.css     builder UI
css/planner.css     planner page styles (what ends up in the PDF)
js/app.js           settings panel, live preview, presets, export
js/pdf-export.js    draws laid-out pages into the PDF (pdf-lib) with links
js/fonts.js         font list + loading (same files for preview and PDF)
vendor/             pdf-lib + fontkit (MIT, see vendor/LICENSES.txt)
js/settings.js      defaults, persistence, share links
js/planner.js       turns settings into the ordered, linked page list
js/templates.js     page templates (add new ones with add(...))
js/calendars.js     holidays + ICS parsing
js/devices.js       device screen sizes
js/dates.js, ids.js helpers
```

### Adding a template

In `js/templates.js`, call `add(id, label, group, render, scopes?)`. `render(ctx)` returns HTML that fills the content box. Useful context:

- `ctx.cw`, `ctx.ch`: content size in px
- `ctx.date`, `ctx.week`, `ctx.month`, `ctx.quarter`: the date context of the page
- `ctx.eventsOn(d)`, `ctx.link(id, html)`: event lookup and safe internal links

Use the `lined()`, `fill()`, `rows()`, `table()` and `sec()` helpers so output stays vector and crisp on e-ink.

## Notes

- **How export works**: each page is laid out off-screen by the browser, then `js/pdf-export.js` walks the rendered page and redraws it into the PDF: backgrounds, borders, SVG paths and text at the measured positions. It handles the CSS this app uses; if you add templates with unusual CSS (gradients, shadows, images), extend the exporter too.
- **Template drawing**: templates draw ruling, dots and grids as explicit SVG paths, which export as vector lines.
