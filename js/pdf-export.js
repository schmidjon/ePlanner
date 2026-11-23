// Direct PDF export (no print dialog).
//
// Each planner page is laid out off-screen by the browser, then this module
// walks the rendered DOM and redraws it into the PDF with pdf-lib: box
// backgrounds and borders, SVG paths (ruling, dots, grids, icons), and text in
// the embedded fonts. Text runs are placed at the exact positions the browser
// measured and stretched by a hair if needed, so the PDF matches the preview.
// Internal <a href="#id"> links become PDF link annotations to the target page.
//
// Supports the CSS this app uses: solid colors, per-corner border radius,
// solid/dashed/dotted borders, hatched (repeating-linear-gradient) fills,
// opacity, overflow clipping, letter-spacing, text-transform and rotated
// vertical text. It is not a general-purpose HTML-to-PDF converter.

import { FONT_META, fontBytes, pickWeight } from './fonts.js';

const K = 0.75; // PDF points per CSS px (same ratio Chrome uses)

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}
async function libs() {
  if (!window.PDFLib) await loadScript('vendor/pdf-lib.min.js');
  if (!window.fontkit) await loadScript('vendor/fontkit.umd.min.js');
  return window.PDFLib;
}

function parseColor(str) {
  if (!str || str === 'none' || str === 'transparent') return null;
  let m = /rgba?\(([^)]+)\)/.exec(str);
  let r, g, b, a = 1;
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    [r, g, b] = p.map((x) => x / 255);
    if (p.length > 3) a = p[3];
  } else if ((m = /color\(srgb ([^)]+)\)/.exec(str))) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat);
    [r, g, b] = p;
    if (p.length > 3) a = p[3];
  } else return null;
  if (a <= 0.003) return null;
  return { r, g, b, a };
}

const inter = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
const empty = (c) => c.r - c.l <= 0.01 || c.b - c.t <= 0.01;
const inside = (c, clip) => c.l >= clip.l - 0.5 && c.t >= clip.t - 0.5 && c.r <= clip.r + 0.5 && c.b <= clip.b + 0.5;

function radiusPx(v, w, h) {
  if (!v) return 0;
  const n = parseFloat(v);
  return v.includes('%') ? (Math.min(w, h) * n) / 100 : n || 0;
}
function roundRectPath(w, h, [tl, tr, br, bl]) {
  const m = Math.min(w, h) / 2;
  [tl, tr, br, bl] = [tl, tr, br, bl].map((x) => Math.min(x, m));
  return `M${tl} 0H${w - tr}${tr ? `A${tr} ${tr} 0 0 1 ${w} ${tr}` : ''}V${h - br}${br ? `A${br} ${br} 0 0 1 ${w - br} ${h}` : ''}H${bl}${bl ? `A${bl} ${bl} 0 0 1 0 ${h - bl}` : ''}V${tl}${tl ? `A${tl} ${tl} 0 0 1 ${tl} 0` : ''}Z`;
}

/**
 * @param opts.pages       page descriptors (id used for link targets)
 * @param opts.renderPage  (page, index) => HTML string of one <section class="page">
 * @param opts.size        { w, h } page size in CSS px
 * @param opts.families    font families used (preloaded and embedded)
 * @param opts.fallback    family used for text whose font isn't embedded
 * @param opts.prepareHost (el) => void, sets CSS variables on the off-screen host
 * @param opts.onProgress  (done, total) => void
 * @param opts.title       PDF title
 * @returns Uint8Array PDF bytes
 */
export async function exportPdf(opts) {
  const PDFLib = await libs();
  const { PDFDocument, rgb, degrees, LineCapStyle, PDFName, PDFNull,
    pushGraphicsState, popGraphicsState, rectangle, clip: clipOp, endPath, setCharacterSpacing, setCharacterSqueeze } = PDFLib;

  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
  doc.setTitle(opts.title || 'Planner');
  doc.setCreator('ePlanner');
  doc.setProducer('ePlanner (pdf-lib)');

  // ---- fonts: every family/weight the planner may use
  const fonts = new Map();
  for (const fam of new Set(opts.families)) {
    for (const w of FONT_META[fam] || []) {
      const f = await doc.embedFont(await fontBytes(fam, w), { subset: true });
      fonts.set(`${fam}|${w}`, f);
    }
  }
  const fontFor = (cs) => {
    let fam = cs.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!FONT_META[fam] || !fonts.has(`${fam}|${FONT_META[fam][0]}`)) fam = opts.fallback;
    return fonts.get(`${fam}|${pickWeight(fam, cs.fontWeight)}`) || fonts.values().next().value;
  };

  // ---- off-screen host at 1:1 scale
  const host = document.createElement('div');
  host.className = 'planner';
  opts.prepareHost(host);
  host.style.position = 'fixed';
  host.style.left = '-30000px';
  host.style.top = '0';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  const { w: PW, h: PH } = opts.size;
  const pdfPages = [];
  const links = []; // { page, rect: [x1,y1,x2,y2], id }
  const range = document.createRange();

  try {
    for (let i = 0; i < opts.pages.length; i++) {
      host.innerHTML = opts.renderPage(opts.pages[i], i);
      const pageEl = host.firstElementChild;
      const o = pageEl.getBoundingClientRect();
      const page = doc.addPage([PW * K, PH * K]);
      pdfPages.push(page);
      const X = (x) => (x - o.left) * K;
      const Y = (y) => (PH - (y - o.top)) * K;
      const full = { l: o.left, t: o.top, r: o.left + PW, b: o.top + PH };

      const withClip = (area, c, fn) => {
        if (inside(area, c)) return fn();
        page.pushOperators(pushGraphicsState(), rectangle(X(c.l), Y(c.b), (c.r - c.l) * K, (c.b - c.t) * K), clipOp(), endPath());
        fn();
        page.pushOperators(popGraphicsState());
      };
      const col = (c) => rgb(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b));

      const fillRect = (l, t, w, h, c, op) => {
        if (w <= 0 || h <= 0) return;
        page.drawRectangle({ x: X(l), y: Y(t + h), width: w * K, height: h * K, color: col(c), opacity: c.a * op });
      };

      function paintBox(el, cs, r, clip, op) {
        const area = box(r);
        const w = r.width, h = r.height;
        const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => radiusPx(v, w, h));
        const rounded = radii.some((x) => x > 0.2);
        const bg = parseColor(cs.backgroundColor);
        const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat);
        const bs = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
        const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(parseColor);
        const has = (k) => bw[k] > 0 && bs[k] !== 'none' && bs[k] !== 'hidden' && bc[k];
        const hatch = cs.backgroundImage.includes('repeating-linear-gradient');
        if (!bg && !hatch && ![0, 1, 2, 3].some(has)) return;

        withClip(area, clip, () => {
          if (bg) {
            if (rounded) page.drawSvgPath(roundRectPath(w, h, radii), { x: X(r.left), y: Y(r.top), scale: K, color: col(bg), opacity: bg.a * op });
            else fillRect(r.left, r.top, w, h, bg, op);
          }
          if (hatch) {
            const colors = cs.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/g) || [];
            const c = parseColor(colors[colors.length - 1]);
            if (c) {
              const ac = inter(area, clip);
              page.pushOperators(pushGraphicsState(), rectangle(X(ac.l), Y(ac.b), (ac.r - ac.l) * K, (ac.b - ac.t) * K), clipOp(), endPath());
              for (let t = -h; t < w; t += 6) {
                page.drawLine({ start: { x: X(r.left + t), y: Y(r.bottom) }, end: { x: X(r.left + t + h), y: Y(r.top) }, thickness: K, color: col(c), opacity: c.a * op });
              }
              page.pushOperators(popGraphicsState());
            }
          }
          const uniform = [1, 2, 3].every((k) => bw[k] === bw[0] && bs[k] === bs[0] && cs[['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'][k]] === cs.borderTopColor);
          if (rounded && has(0) && uniform) {
            const b = bw[0];
            page.drawSvgPath(roundRectPath(w - b, h - b, radii.map((x) => Math.max(0, x - b / 2))), {
              x: X(r.left + b / 2), y: Y(r.top + b / 2), scale: K, borderColor: col(bc[0]), borderWidth: b, borderOpacity: bc[0].a * op,
            });
            return;
          }
          const sides = [
            [r.left, r.top, w, bw[0], r.left, r.top + bw[0] / 2, r.right, r.top + bw[0] / 2],
            [r.right - bw[1], r.top, bw[1], h, r.right - bw[1] / 2, r.top, r.right - bw[1] / 2, r.bottom],
            [r.left, r.bottom - bw[2], w, bw[2], r.left, r.bottom - bw[2] / 2, r.right, r.bottom - bw[2] / 2],
            [r.left, r.top, bw[3], h, r.left + bw[3] / 2, r.top, r.left + bw[3] / 2, r.bottom],
          ];
          sides.forEach((sd, k) => {
            if (!has(k)) return;
            if (bs[k] === 'solid' || bs[k] === 'double' || bs[k] === 'groove' || bs[k] === 'ridge' || bs[k] === 'inset' || bs[k] === 'outset') {
              fillRect(sd[0], sd[1], sd[2], sd[3], bc[k], op);
            } else {
              const dash = bs[k] === 'dotted' ? Math.max(bw[k], 1) : Math.max(bw[k] * 3, 3);
              page.drawLine({
                start: { x: X(sd[4]), y: Y(sd[5]) }, end: { x: X(sd[6]), y: Y(sd[7]) }, thickness: bw[k] * K,
                color: col(bc[k]), opacity: bc[k].a * op, dashArray: [dash * K, dash * K],
              });
            }
          });
        });
      }

      function drawSvg(svg, r, clip, op) {
        const vb = svg.viewBox && svg.viewBox.baseVal;
        const s = vb && vb.width ? r.width / vb.width : 1;
        const ox = vb ? vb.x : 0, oy = vb ? vb.y : 0;
        withClip(box(r), clip, () => {
          for (const path of svg.querySelectorAll('path')) {
            const pcs = getComputedStyle(path);
            const d = path.getAttribute('d');
            if (!d) continue;
            const fill = pcs.fill === 'none' ? null : parseColor(pcs.fill);
            const stroke = pcs.stroke === 'none' ? null : parseColor(pcs.stroke);
            if (!fill && !stroke) continue;
            const o2 = op * parseFloat(pcs.opacity || 1);
            page.drawSvgPath(d, {
              x: X(r.left - ox * s), y: Y(r.top - oy * s), scale: s * K,
              ...(fill ? { color: col(fill), opacity: fill.a * o2 } : {}),
              ...(stroke ? {
                borderColor: col(stroke), borderOpacity: stroke.a * o2, borderWidth: parseFloat(pcs.strokeWidth) || 1,
                borderLineCap: pcs.strokeLinecap === 'round' ? LineCapStyle.Round : pcs.strokeLinecap === 'square' ? LineCapStyle.Projecting : LineCapStyle.Butt,
              } : {}),
            });
          }
        });
      }

      function drawRun(str, rect, cs, clip, op, color) {
        if (!str) return;
        const font = fontFor(cs);
        const size = parseFloat(cs.fontSize);
        const fk = font.embedder.font;
        const asc = (fk.ascent / fk.unitsPerEm) * size;
        const desc = (-fk.descent / fk.unitsPerEm) * size;
        const ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0;
        const vertical = cs.writingMode.startsWith('vertical');
        let natural;
        try { natural = font.widthOfTextAtSize(str, size) + ls * str.length; } catch { return; }
        const along = vertical ? rect.height : rect.width;
        let squeeze = natural > 0 ? (along / natural) * 100 : 100;
        if (!(squeeze > 70 && squeeze < 140)) squeeze = 100;
        const across = vertical ? rect.width : rect.height;
        const base = (across - (asc + desc)) / 2 + asc;
        const area = box(rect);
        withClip(area, clip, () => {
          page.pushOperators(setCharacterSpacing(ls * K), setCharacterSqueeze(squeeze));
          if (!vertical) {
            page.drawText(str, { x: X(rect.left), y: Y(rect.top + base), size: size * K, font, color: col(color), opacity: color.a * op });
          } else {
            // vertical-rl rotated 180deg: reads bottom-to-top, glyph tops face left
            page.drawText(str, { x: X(rect.left + base), y: Y(rect.bottom), size: size * K, font, color: col(color), opacity: color.a * op, rotate: degrees(90) });
          }
          page.pushOperators(setCharacterSpacing(0), setCharacterSqueeze(100));
          // underline / line-through (horizontal text only; used by mini calendars)
          const deco = cs.textDecorationLine || '';
          if (!vertical && deco !== 'none') {
            const lw = Math.max(0.6, size / 16);
            const line = (y) => page.drawLine({ start: { x: X(rect.left), y: Y(y) }, end: { x: X(rect.right), y: Y(y) }, thickness: lw * K, color: col(color), opacity: color.a * op });
            const off = parseFloat(cs.textUnderlineOffset);
            if (deco.includes('underline')) line(rect.top + base + (Number.isFinite(off) ? off : size * 0.12));
            if (deco.includes('line-through')) line(rect.top + base - asc * 0.32);
          }
        });
      }

      function drawText(node, cs, clip, op) {
        const raw = node.data;
        const a = raw.search(/\S/);
        if (a < 0) return;
        const color = parseColor(cs.color);
        if (!color) return;
        const b = raw.length - (raw.length - raw.trimEnd().length);
        const tf = (s) => {
          s = s.replace(/\s+/g, ' ');
          if (cs.textTransform === 'uppercase') return s.toUpperCase();
          if (cs.textTransform === 'lowercase') return s.toLowerCase();
          return s;
        };
        range.setStart(node, a);
        range.setEnd(node, b);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) return;
        if (rects.length === 1 || cs.writingMode.startsWith('vertical')) {
          const u = range.getBoundingClientRect();
          drawRun(tf(raw.slice(a, b)), u, cs, clip, op, color);
          return;
        }
        // wrapped text: group words by line, draw each line as one run
        let line = null;
        const flush = () => { if (line) drawRun(tf(raw.slice(line.s, line.e)), line.rect, cs, clip, op, color); line = null; };
        for (const m of raw.matchAll(/\S+/g)) {
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const wr = [...range.getClientRects()].filter((r) => r.width > 0);
          if (wr.length !== 1) {
            // a word broken across lines: draw it character by character
            flush();
            for (let k = 0; k < m[0].length; k++) {
              range.setStart(node, m.index + k); range.setEnd(node, m.index + k + 1);
              const cr = range.getBoundingClientRect();
              if (cr.width > 0) drawRun(tf(m[0][k]), cr, cs, clip, op, color);
            }
            continue;
          }
          const r = wr[0];
          if (line && Math.abs(r.top - line.rect.top) < 1) {
            line.e = m.index + m[0].length;
            line.rect = new DOMRect(line.rect.left, Math.min(line.rect.top, r.top), r.right - line.rect.left, Math.max(line.rect.bottom, r.bottom) - Math.min(line.rect.top, r.top));
          } else {
            flush();
            line = { s: m.index, e: m.index + m[0].length, rect: r };
          }
        }
        flush();
      }

      function walk(el, clip, opacity) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const op = opacity * parseFloat(cs.opacity);
        if (op <= 0.003) return;
        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        if (tag === 'svg') { if (!empty(inter(box(r), clip))) drawSvg(el, r, clip, op); return; }
        paintBox(el, cs, r, clip, op);
        if (tag === 'a') {
          const href = el.getAttribute('href') || '';
          const c = inter(box(r), clip);
          if (href.startsWith('#') && !empty(c)) links.push({ page, rect: [X(c.l), Y(c.b), X(c.r), Y(c.t)], id: href.slice(1) });
        }
        let childClip = clip;
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') childClip = inter(clip, box(r));
        if (empty(childClip)) return;
        for (const n of el.childNodes) {
          if (n.nodeType === 3) drawText(n, cs, childClip, op);
          else if (n.nodeType === 1) walk(n, childClip, op);
        }
      }

      walk(pageEl, full, 1);

      if (opts.onProgress) opts.onProgress(i + 1, opts.pages.length);
      // yield so the progress text repaints; MessageChannel isn't throttled
      // like setTimeout when the tab is in the background
      if (i % 4 === 3) await new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = res; ch.port2.postMessage(0); });
    }
  } finally {
    host.remove();
  }

  // ---- link annotations (explicit page destinations work in every reader)
  const index = new Map(opts.pages.map((p, i) => [p.id, i]));
  for (const l of links) {
    const target = index.get(l.id);
    if (target == null) continue;
    const annot = doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: l.rect, Border: [0, 0, 0],
      Dest: [pdfPages[target].ref, PDFName.of('Fit')],
    });
    l.page.node.addAnnot(doc.context.register(annot));
  }

  return doc.save({ useObjectStreams: true });
}
