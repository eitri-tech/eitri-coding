// Contact sheet that shows the icon the way platforms will: iOS squircle on light/dark,
// Android adaptive circle + rounded square (72dp visible area of the 108dp canvas),
// the safe-zone guides, and small sizes. Pure JS so it works without any image tool.

import { resize, over, solid } from './png.mjs';
import { ANDROID } from './analyze.mjs';

const T = 200; // tile size
const G = 16; // gap
const PAD = 16;

function superellipseCoverage(x, y, n, half) {
  // x,y relative to center in px; returns 0..1 coverage with ~1px antialias
  const f = (Math.abs(x / half) ** n + Math.abs(y / half) ** n) ** (1 / n);
  return Math.max(0, Math.min(1, (1 - f) * half + 0.5));
}

function tile(icon, size, bgColor, { shape, n, visibleRatio, bgFill }) {
  // icon: RGBA at size×size. Compose optional icon-background, then mask.
  const buf = solid(size, size, [...bgColor, 255]);
  const layer = new Uint8Array(icon);
  const base = bgFill ? solid(size, size, [...bgFill, 255]) : null;
  const comp = base ? over(base, size, size, layer, size, size) : layer;
  const half = (size * visibleRatio) / 2;
  const out = new Uint8Array(buf);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cov = shape === 'none' ? 1 : superellipseCoverage(x + 0.5 - c, y + 0.5 - c, n, half);
      if (cov <= 0) continue;
      const i = (y * size + x) * 4;
      const a = (comp[i + 3] / 255) * cov;
      for (let k = 0; k < 3; k++) out[i + k] = Math.round(comp[i + k] * a + out[i + k] * (1 - a));
    }
  }
  return out;
}

function checker(size) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? 200 : 235;
      const i = (y * size + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * @param {{w:number,h:number,rgba:Uint8Array}} img  square-ish RGBA icon
 * @param {{bg?:number[]}} opts  `bg` = RGB the icon sits on when it is transparent (iOS tiles + Android background layer)
 * @returns {{w:number,h:number,rgba:Uint8Array}}
 */
export function makePreview(img, { bg = null, iosImg = null, androidImg = null } = {}) {
  // Square-crop helper: any {w,h,rgba} → T×T RGBA
  const toTile = (im) => {
    const side = Math.min(im.w, im.h);
    let data = im.rgba;
    if (im.w !== im.h) {
      data = new Uint8Array(side * side * 4);
      const ox = Math.floor((im.w - side) / 2);
      const oy = Math.floor((im.h - side) / 2);
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) for (let k = 0; k < 4; k++) data[(y * side + x) * 4 + k] = im.rgba[((y + oy) * im.w + x + ox) * 4 + k];
    }
    return { side, data };
  };
  const base = toTile(img);
  const ios0 = iosImg ? toTile(iosImg) : base;
  const and0 = androidImg ? toTile(androidImg) : base;
  const bigI = resize(ios0.data, ios0.side, ios0.side, T, T);
  const bigA = resize(and0.data, and0.side, and0.side, T, T);
  const tinyI = (s) => resize(ios0.data, ios0.side, ios0.side, s, s);
  const tinyA = (s) => resize(and0.data, and0.side, and0.side, s, s);
  const iosFillBg = iosImg ? null : bg || [255, 255, 255];
  const andFillBg = bg || [255, 255, 255];

  const cols = 3;
  const W = PAD * 2 + cols * T + (cols - 1) * G;
  const H = PAD * 2 + 2 * (T + G) + 120;
  const sheet = solid(W, H, [128, 128, 128, 255]);
  const place = (buf, w, h, col, row) => over(sheet, W, H, buf, w, h, PAD + col * (T + G), PAD + row * (T + G));

  // row 0: as-is on checkerboard (+ guides) | iOS light | iOS dark
  const asIs = checker(T);
  over(asIs, T, T, bigA, T, T);
  const c = T / 2;
  const r66 = (ANDROID.safeCircle / ANDROID.canvas / 2) * T;
  const half72 = (ANDROID.visible / ANDROID.canvas / 2) * T;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const i = (y * T + x) * 4;
      if (Math.abs(Math.hypot(dx, dy) - r66) < 0.8) [asIs[i], asIs[i + 1], asIs[i + 2]] = [230, 40, 40];
      if (Math.abs(Math.max(Math.abs(dx), Math.abs(dy)) - half72) < 0.8 && Math.max(Math.abs(dx), Math.abs(dy)) <= half72 + 1) [asIs[i], asIs[i + 1], asIs[i + 2]] = [40, 90, 230];
    }
  }
  place(asIs, T, T, 0, 0);
  const ios = { shape: 'squircle', n: 5, visibleRatio: 1, bgFill: iosFillBg };
  place(tile(bigI, T, [242, 242, 247], ios), T, T, 1, 0);
  place(tile(bigI, T, [28, 28, 30], ios), T, T, 2, 0);

  // row 1: Android circle | rounded square | squircle on dark wallpaper
  const visible = ANDROID.visible / ANDROID.canvas;
  place(tile(bigA, T, [242, 242, 247], { shape: 'circle', n: 2, visibleRatio: visible, bgFill: andFillBg }), T, T, 0, 1);
  place(tile(bigA, T, [242, 242, 247], { shape: 'rounded', n: 3.5, visibleRatio: visible, bgFill: andFillBg }), T, T, 1, 1);
  place(tile(bigA, T, [28, 28, 30], { shape: 'circle', n: 2, visibleRatio: visible, bgFill: andFillBg }), T, T, 2, 1);

  // row 2: small sizes in one strip — iOS 120/60/40/29 (light), Android 96/48 (dark, circle), then 48 on dark iOS and raw 48
  const strip = [
    ...[120, 60, 40, 29].map((s) => ({ s, bgc: [242, 242, 247], opt: ios, from: tinyI })),
    ...[96, 48].map((s) => ({ s, bgc: [28, 28, 30], opt: { shape: 'circle', n: 2, visibleRatio: visible, bgFill: andFillBg }, from: tinyA })),
    { s: 48, bgc: [28, 28, 30], opt: ios, from: tinyI },
  ];
  let sx = PAD;
  const sy = PAD + 2 * (T + G);
  for (const { s, bgc, opt, from } of strip) {
    over(sheet, W, H, tile(from(s), s, bgc, opt), s, s, sx, sy);
    sx += s + 12;
  }
  over(sheet, W, H, tinyI(48), 48, 48, sx, sy);

  return { w: W, h: H, rgba: sheet };
}
