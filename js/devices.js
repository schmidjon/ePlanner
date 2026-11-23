// Screen sizes for common e-paper devices (portrait, in device pixels).
// Pages are laid out at a fixed logical width (PAGE_W) and the height follows
// the device's aspect ratio, so the PDF fills the screen edge to edge.

export const PAGE_W = 702;

export const DEVICES = [
  { id: 'boox-go-103', name: 'Boox Go 10.3', w: 1860, h: 2480 },
  { id: 'boox-note-air', name: 'Boox Note Air 3 / 4C (10.3")', w: 1404, h: 1872 },
  { id: 'boox-tab-ultra', name: 'Boox Tab Ultra / Tab X', w: 1404, h: 1872 },
  { id: 'boox-note-max', name: 'Boox Note Max (13.3")', w: 2400, h: 3200 },
  { id: 'boox-go-7', name: 'Boox Go 7 / Page (7")', w: 1264, h: 1680 },
  { id: 'remarkable-2', name: 'reMarkable 2', w: 1404, h: 1872 },
  { id: 'remarkable-pro', name: 'reMarkable Paper Pro', w: 1620, h: 2160 },
  { id: 'remarkable-move', name: 'reMarkable Paper Pro Move', w: 954, h: 1696 },
  { id: 'kindle-scribe', name: 'Kindle Scribe', w: 1860, h: 2480 },
  { id: 'supernote-manta', name: 'Supernote Manta (A5 X2)', w: 1920, h: 2560 },
  { id: 'supernote-nomad', name: 'Supernote Nomad (A6 X2)', w: 1404, h: 1872 },
  { id: 'kobo-elipsa', name: 'Kobo Elipsa 2E', w: 1404, h: 1872 },
  { id: 'a5', name: 'Print – A5 paper', w: 1480, h: 2100 },
  { id: 'letter', name: 'Print – US Letter', w: 2550, h: 3300 },
  { id: 'custom', name: 'Custom size…', w: 0, h: 0 },
];

export function pageSize(settings) {
  let d = DEVICES.find((x) => x.id === settings.device) || DEVICES[0];
  let w = d.w, h = d.h;
  if (d.id === 'custom') {
    w = Math.max(100, +settings.customW || 1404);
    h = Math.max(100, +settings.customH || 1872);
  }
  if (settings.landscape) [w, h] = [h, w];
  return { w: PAGE_W, h: Math.round((PAGE_W * h) / w), device: d };
}
