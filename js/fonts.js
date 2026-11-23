// Fonts come from Fontsource (Google Fonts, self-hostable builds) as WOFF.
// The same files are used for the on-screen preview (FontFace) and embedded
// in the exported PDF, so text measures identically in both.

export const FONT_META = {
  'Abril Fatface': [400], 'Acme': [400], 'Anton': [400], 'Bebas Neue': [400], 'Caveat': [400, 500, 700],
  'Caveat Brush': [400], 'Dancing Script': [400, 500, 700], 'DM Serif Display': [400], 'Indie Flower': [400],
  'Inter': [400, 500, 700], 'Just Another Hand': [400], 'Lato': [400, 700], 'Lilita One': [400], 'Lobster': [400],
  'Montserrat': [400, 500, 700], 'Nunito': [400, 500, 700], 'Oswald': [400, 500, 700], 'Pacifico': [400],
  'Permanent Marker': [400], 'Playfair Display': [400, 500, 700], 'Poppins': [400, 500, 700], 'PT Serif': [400, 700],
  'Rancho': [400], 'Roboto': [400, 500, 700], 'Roboto Condensed': [400, 500, 700], 'Roboto Slab': [400, 500, 700],
  'Satisfy': [400], 'Shadows Into Light Two': [400], 'Source Serif 4': [400, 500, 700],
};
const VERSION = { 'Source Serif 4': '5.3.1' };

export const FONTS = Object.keys(FONT_META);

const slug = (f) => f.toLowerCase().replace(/ /g, '-');
export const fontUrl = (family, weight) =>
  `https://cdn.jsdelivr.net/npm/@fontsource/${slug(family)}@${VERSION[family] || '5.3.0'}/files/${slug(family)}-latin-${weight}-normal.woff`;

// Closest weight the family actually ships.
export function pickWeight(family, weight) {
  const ws = FONT_META[family] || [400];
  const w = +weight || 400;
  return ws.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) || (Math.abs(x - w) === Math.abs(best - w) && x > best) ? x : best), ws[0]);
}

const bytesCache = new Map();
export function fontBytes(family, weight) {
  const url = fontUrl(family, pickWeight(family, weight));
  if (!bytesCache.has(url)) {
    bytesCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Could not download font ${family} (${r.status})`);
      return r.arrayBuffer();
    }));
  }
  return bytesCache.get(url);
}

const registered = new Set();
export async function loadBrowserFonts(families) {
  const jobs = [];
  for (const fam of new Set(families)) {
    if (!FONT_META[fam]) continue;
    for (const w of FONT_META[fam]) {
      const key = fam + w;
      if (registered.has(key)) continue;
      registered.add(key);
      jobs.push(fontBytes(fam, w).then((buf) => {
        const face = new FontFace(fam, buf, { weight: String(w), style: 'normal' });
        document.fonts.add(face);
        return face.load();
      }).catch(() => registered.delete(key)));
    }
  }
  await Promise.all(jobs);
}
