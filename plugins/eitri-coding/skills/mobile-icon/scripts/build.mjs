#!/usr/bin/env node
// mobile-icon build — turn a logo (SVG or PNG) into store-ready icon assets.
//
//   node build.mjs <logo.svg|logo.png> [--out dir] [--bg "#RRGGBB"] [--ios-fill 0.6] [--android-fill 0.9]
//                  [--renderer resvg|rsvg-convert|inkscape|magick] [--assume-srgb]
//
// With a transparent logo it writes:
//   ios/AppIcon-1024.png            opaque RGB (no alpha channel) — the App Store marketing icon
//   ios/foreground-1024.png         transparent glyph layer, e.g. for an Icon Composer layer
//   android/res/…                   adaptive icon: foreground + monochrome PNGs per density, XML, background color
//   play/play-store-512.png         opaque 512px Play Store icon
//   preview.png                     contact sheet (masks, light/dark, small sizes)
// With an already-opaque image it only writes the iOS and Play files (it cannot split layers out of a flat image).

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { decodePng, encodePng, isPng, resize, over, solid, parseHex, toHex } from './lib/png.mjs';
import { renderSvg, toPng } from './lib/render.mjs';
import { measure, ANDROID } from './lib/analyze.mjs';
import { makePreview } from './lib/preview.mjs';

const USAGE = 'Usage: node build.mjs <logo.svg|logo.png> [--out dir] [--bg "#RRGGBB"] [--ios-fill 0.6] [--android-fill 0.9] [--renderer name] [--assume-srgb]';
const fail = (m) => {
  console.error(`error: ${m}\n${USAGE}`);
  process.exit(2);
};

const o = { out: 'mobile-icon-out', iosFill: '0.6', androidFill: '0.9' };
const rest = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--assume-srgb') o.assumeSrgb = true;
  else if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (argv[i + 1] === undefined) fail(`${argv[i]} needs a value`);
    o[k] = argv[++i];
  } else rest.push(argv[i]);
}
if (!rest[0]) fail('missing input file');
const iosFill = parseFloat(o.iosFill);
const androidFill = parseFloat(o.androidFill);
if (!(iosFill > 0.1 && iosFill <= 1) || !(androidFill > 0.1 && androidFill <= 1)) fail('--ios-fill and --android-fill must be between 0.1 and 1');

const file = resolve(rest[0]);
const outDir = resolve(o.out);
let bytes;
try {
  bytes = readFileSync(file);
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}

// ---------- load source (SVG rendered large so every size is downsampled, never upsampled) ----------
let img;
let isVector = false;
const head = bytes.subarray(0, 2048).toString('utf8');
if (extname(file).toLowerCase() === '.svg' || /<svg[\s>]/i.test(head)) {
  isVector = true;
  const r = renderSvg(file, 2048, o.renderer || null);
  if (r.error) fail(r.error);
  if (r.approximate) console.warn('! Rendered with ImageMagick (approximate). Install resvg or librsvg for exact output and re-run if edges or colors look off.');
  img = decodePng(r.png);
} else if (isPng(bytes)) {
  img = decodePng(bytes);
  // The outputs are tagged sRGB without converting pixels, so a source in another profile (Display P3, …) would shift colors.
  const prof = img.meta?.iccProfile;
  if (prof && !/srgb/i.test(prof) && !o.assumeSrgb) {
    fail(`the PNG embeds the color profile "${prof}", and this script does not convert colors (it would tag the same values as sRGB and shift them). Convert the source to sRGB first (e.g. magick in.png -colorspace sRGB -strip out.png), or pass --assume-srgb if the values are already sRGB.`);
  }
} else {
  const c = toPng(file);
  if (c.error) fail(c.error);
  img = decodePng(c.png);
}
if (img.w !== img.h) fail(`the image is ${img.w}×${img.h}; icons must be square. Re-export on a square artboard first (run check.mjs for details).`);

const m = measure(img, { plannedBg: o.bg || null });
if (m.empty) fail('nothing visible in the image — check the export.');
const transparent = m.mode === 'transparent';
const { w: SW, h: SH, rgba: src } = img;

const write = (rel, buf) => {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  written.push(rel);
};
const written = [];
const notes = [];
let iosOut = null;
let androidOut = null;

// ---------- background ----------
let bg;
if (o.bg) bg = parseHex(o.bg);
else if (transparent) {
  bg = m.contrast.onWhite >= m.contrast.onBlack ? [255, 255, 255] : [17, 24, 39];
  notes.push(`No --bg given: using ${toHex(bg)} (best contrast for this logo). Replace it with your brand color: --bg "#RRGGBB".`);
} else bg = m.background || [255, 255, 255];

// ---------- placement helpers ----------
// `art` is the region of the source that holds the artwork (cropped to its bounding box once known),
// so scaling never blows up the empty canvas around a tiny logo.
let art = { data: src, w: SW, h: SH, ox: 0, oy: 0 };
function layer(canvas, scale, cx, cy) {
  const dw = Math.max(1, Math.round(art.w * scale));
  const dh = Math.max(1, Math.round(art.h * scale));
  if (dw * dh > canvas * canvas * 4) fail('the logo is too small or too thin to scale to the icon size; use a larger or cleaner source.');
  const r = resize(art.data, art.w, art.h, dw, dh);
  const out = new Uint8Array(canvas * canvas * 4);
  over(out, canvas, canvas, r, dw, dh, Math.round(canvas / 2 - (cx - art.ox) * scale), Math.round(canvas / 2 - (cy - art.oy) * scale));
  return out;
}
const flatten = (canvas, fg) => over(solid(canvas, canvas, [...bg, 255]), canvas, canvas, fg, canvas, canvas);

if (transparent) {
  const { minX, minY, maxX, maxY } = m.bbox;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  {
    const data = new Uint8Array(bw * bh * 4);
    for (let y = 0; y < bh; y++) data.set(src.subarray(((y + minY) * SW + minX) * 4, ((y + minY) * SW + minX + bw) * 4), y * bw * 4);
    art = { data, w: bw, h: bh, ox: minX, oy: minY };
  }
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  let rmax = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // farthest corner of the pixel, so a single visible pixel still has a positive extent
      if (src[(y * SW + x) * 4 + 3] >= 32) rmax = Math.max(rmax, Math.hypot(Math.abs(x + 0.5 - cx) + 0.5, Math.abs(y + 0.5 - cy) + 0.5));
    }
  }
  if (!(rmax > 0) || !(bw > 0) || !(bh > 0)) fail('could not measure the artwork (nothing opaque enough to place).');

  // iOS: glyph spans iosFill of the canvas along its longest side
  const iosScale = (iosFill * 1024) / Math.max(bw, bh);
  const iosFg = layer(1024, iosScale, cx, cy);
  write('ios/foreground-1024.png', encodePng(1024, 1024, iosFg));
  iosOut = { w: 1024, h: 1024, rgba: flatten(1024, iosFg) };
  write('ios/AppIcon-1024.png', encodePng(1024, 1024, iosOut.rgba, { alpha: false }));

  // Play Store: same composition as iOS, 512px
  const playFg = layer(512, iosScale / 2, cx, cy);
  write('play/play-store-512.png', encodePng(512, 512, flatten(512, playFg))); // 32-bit RGBA, alpha 255 (Play spec)

  // Android adaptive: every pixel inside the 66dp circle (scaled by androidFill)
  const densities = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
  const R = ((ANDROID.safeCircle / ANDROID.canvas) * 432) / 2 * androidFill; // radius at 432px canvas
  const base = R / rmax; // src px → 432px canvas
  if (!Number.isFinite(base) || base <= 0) fail('could not compute a finite scale for the Android layers.');
  for (const [d, canvas] of Object.entries(densities)) {
    const fg = layer(canvas, (base * canvas) / 432, cx, cy);
    if (canvas === 432) androidOut = { w: 432, h: 432, rgba: fg };
    write(`android/res/drawable-${d}/ic_launcher_foreground.png`, encodePng(canvas, canvas, fg));
    const mono = new Uint8Array(fg);
    for (let i = 0; i < mono.length; i += 4) mono[i] = mono[i + 1] = mono[i + 2] = 0;
    write(`android/res/drawable-${d}/ic_launcher_monochrome.png`, encodePng(canvas, canvas, mono));
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;
  write('android/res/mipmap-anydpi-v26/ic_launcher.xml', adaptive);
  write('android/res/mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);
  write('android/res/values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${toHex(bg)}</color>\n</resources>\n`);

  if (m.dominantColors.length > 6) notes.push(`The logo has ${m.dominantColors.length} distinct colors. The monochrome layer is a plain silhouette of the alpha channel; check preview.png and hand-author a simplified monochrome if inner detail is lost.`);
  if (SW < 1024 && !isVector) notes.push(`Source is only ${SW}px; the iOS 1024px layer is upscaled and will look soft. Use the SVG or a ≥1024px export.`);
} else {
  // "opaque" may still hold a few translucent pixels: composite them on the background before dropping alpha
  const flat = over(solid(SW, SH, [...bg, 255]), SW, SH, src, SW, SH);
  const full = (canvas) => (SW === canvas ? flat : resize(flat, SW, SH, canvas, canvas));
  iosOut = { w: 1024, h: 1024, rgba: full(1024) };
  write('ios/AppIcon-1024.png', encodePng(1024, 1024, iosOut.rgba, { alpha: false }));
  write('play/play-store-512.png', encodePng(512, 512, full(512))); // 32-bit RGBA, alpha 255 (Play spec)
  // An earlier run in this folder may have produced layers for a different logo; remove exactly the files this script generates for layered builds
  const stale = ['ios/foreground-1024.png', 'android/res/mipmap-anydpi-v26/ic_launcher.xml', 'android/res/mipmap-anydpi-v26/ic_launcher_round.xml', 'android/res/values/ic_launcher_background.xml'];
  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) stale.push(`android/res/drawable-${d}/ic_launcher_foreground.png`, `android/res/drawable-${d}/ic_launcher_monochrome.png`);
  const removed = stale.filter((rel) => existsSync(join(outDir, rel)));
  for (const rel of removed) rmSync(join(outDir, rel), { force: true });
  if (removed.length) notes.push(`Removed ${removed.length} layer file(s) left in ${outDir} by an earlier build, so they cannot be mistaken for this logo's output.`);
  notes.push('The logo is already a flat opaque image, so adaptive-icon layers (foreground / background / monochrome) were NOT generated. Provide the glyph on a transparent background or the SVG to get them.');
  if (m.cornerFill || m.roundedCorners) notes.push('The corners look pre-rounded; the iOS file keeps them. Remove them in the source so the system mask is clean.');
}

// ---------- preview ----------
const sheet = makePreview(iosOut || { w: SW, h: SH, rgba: src }, { bg: transparent ? bg : null, iosImg: iosOut, androidImg: androidOut });
write('preview.png', encodePng(sheet.w, sheet.h, sheet.rgba, { alpha: false }));

console.log(`\nIcon set written to ${outDir}\n`);
for (const w of written) console.log(`  ${w}`);
console.log('');
for (const n of notes) console.log(`• ${n}`);
console.log('\nNext: look at preview.png, then verify with check.mjs --role ios-icon (AppIcon), --role android-layer (foreground), --role play-icon (Play icon).');
