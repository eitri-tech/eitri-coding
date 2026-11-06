// Pixel-level analysis of a rasterized icon + the per-platform rules that turn the
// metrics into findings. Everything is measured on the artwork as it will actually look.

import { luminance, contrastRatio, parseHex } from './png.mjs';

// Android adaptive icon geometry (dp on a 108dp canvas)
export const ANDROID = { canvas: 108, visible: 72, safeCircle: 66 };

function dilate(mask, w, h, r) {
  // separable box max via running sums; returns Uint8Array
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = 0; x < Math.min(w, r); x++) sum += mask[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) sum += mask[row + x + r];
      if (x - r - 1 >= 0) sum -= mask[row + x - r - 1];
      tmp[row + x] = sum > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(h, r); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) sum += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = sum > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Compute artwork metrics. `img` = {w,h,rgba,hasAlphaChannel}. */
export function measure(img, opts = {}) {
  const { w, h, rgba } = img;
  const size = Math.min(w, h);
  const n = w * h;

  let transparent = 0;
  let translucent = 0;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    if (a < 16) transparent++;
    if (a < 250) translucent++;
  }
  const transparentFrac = transparent / n;
  const mode = transparentFrac > 0.02 ? 'transparent' : 'opaque';

  const corner = Math.max(2, Math.round(size * 0.02));
  const cornerAlpha = [[0, 0], [w - corner, 0], [0, h - corner], [w - corner, h - corner]].map(([cx, cy]) => {
    let s = 0;
    for (let y = cy; y < cy + corner; y++) for (let x = cx; x < cx + corner; x++) s += rgba[(y * w + x) * 4 + 3];
    return s / (corner * corner) / 255;
  });
  const roundedCorners = cornerAlpha.every((a) => a < 0.2) && mode === 'transparent';

  // --- foreground mask ---
  const mask = new Uint8Array(n);
  let background = null;
  let fullBleed = false;
  if (mode === 'transparent') {
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3] >= 32 ? 1 : 0;
  } else {
    // dominant color of the outer ring = background
    const ring = Math.max(2, Math.round(size * 0.015));
    const buckets = new Map();
    let total = 0;
    const take = (x, y) => {
      const i = (y * w + x) * 4;
      const key = (rgba[i] >> 3) * 1024 + (rgba[i + 1] >> 3) * 32 + (rgba[i + 2] >> 3);
      const e = buckets.get(key) || { c: 0, r: 0, g: 0, b: 0 };
      e.c++;
      e.r += rgba[i];
      e.g += rgba[i + 1];
      e.b += rgba[i + 2];
      buckets.set(key, e);
      total++;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < ring || y < ring || x >= w - ring || y >= h - ring) take(x, y);
      }
    }
    let best = null;
    for (const e of buckets.values()) if (!best || e.c > best.c) best = e;
    if (best && best.c / total >= 0.6) {
      background = [Math.round(best.r / best.c), Math.round(best.g / best.c), Math.round(best.b / best.c)];
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(rgba[i * 4] - background[0], rgba[i * 4 + 1] - background[1], rgba[i * 4 + 2] - background[2]);
        mask[i] = d > 28 ? 1 : 0;
      }
    } else {
      fullBleed = true;
      mask.fill(1);
    }
  }

  // --- geometry of the mask ---
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const empty = count === 0;
  const cx = w / 2;
  const cy = h / 2;
  let outside66 = 0;
  let outside72 = 0;
  if (!empty) {
    const r66 = (ANDROID.safeCircle / ANDROID.canvas / 2) * size;
    const half72 = (ANDROID.visible / ANDROID.canvas / 2) * size;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!mask[y * w + x]) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (Math.hypot(dx, dy) > r66) outside66++;
        if (Math.abs(dx) > half72 || Math.abs(dy) > half72) outside72++;
      }
    }
  }

  // --- colors & contrast of the artwork ---
  const colorBuckets = new Map();
  let colorTotal = 0;
  const hist = { white: new Uint32Array(220), black: new Uint32Array(220), bg: new Uint32Array(220) };
  const contrastBg = background || (opts.plannedBg ? parseHex(opts.plannedBg) : null);
  const bgLum = contrastBg ? luminance(...contrastBg) : null;
  let histN = 0;
  let lumSum = 0;
  if (!empty) {
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const a = rgba[i * 4 + 3];
      if (a < 128) continue;
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      if (!fullBleed && a >= 250) {
        const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
        colorBuckets.set(key, (colorBuckets.get(key) || 0) + 1);
        colorTotal++;
      }
      // composite the (possibly semi-transparent) pixel on each backdrop before measuring
      const af = a / 255;
      const onto = (bgc) => luminance(Math.round(r * af + bgc[0] * (1 - af)), Math.round(g * af + bgc[1] * (1 - af)), Math.round(b * af + bgc[2] * (1 - af)));
      lumSum += luminance(r, g, b);
      histN++;
      hist.white[Math.min(219, Math.round(contrastRatio(onto([255, 255, 255]), 1) * 10))]++;
      hist.black[Math.min(219, Math.round(contrastRatio(onto([0, 0, 0]), 0) * 10))]++;
      if (contrastBg) hist.bg[Math.min(219, Math.round(contrastRatio(onto(contrastBg), bgLum) * 10))]++;
    }
  }
  const median = (hs) => {
    if (!histN) return null;
    let acc = 0;
    for (let i = 0; i < hs.length; i++) {
      acc += hs[i];
      if (acc >= histN / 2) return i / 10;
    }
    return null;
  };
  const dominantColors = [...colorBuckets.entries()]
    .filter(([, c]) => c / Math.max(1, colorTotal) >= 0.01)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ hex: '#' + [(k >> 8) & 15, (k >> 4) & 15, k & 15].map((v) => (v * 17).toString(16).padStart(2, '0')).join(''), share: c / colorTotal }));

  // --- baked-in shadows / glows (soft alpha away from the solid core) ---
  let halo = 0;
  let solid = 0;
  if (mode === 'transparent' && !empty) {
    const core = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] >= 250) {
        core[i] = 1;
        solid++;
      }
    }
    const near = dilate(core, w, h, Math.max(2, Math.round(size * 0.006)));
    for (let i = 0; i < n; i++) {
      const a = rgba[i * 4 + 3];
      if (a >= 8 && a < 250 && !near[i]) halo++;
    }
  }

  // --- pre-rounded corner heuristic for opaque art: corner pixels near-white/black vs inner edge ---
  let cornerFill = null;
  if (mode === 'opaque') {
    const sample = (px, py) => {
      const rr = Math.max(1, Math.round(size * 0.01));
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      for (let y = py - rr; y <= py + rr; y++) {
        for (let x = px - rr; x <= px + rr; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          c++;
        }
      }
      return [r / c, g / c, b / c];
    };
    const e = Math.round(size * 0.012);
    const inner = Math.round(size * 0.1);
    const pairs = [[[e, e], [inner, inner]], [[w - 1 - e, e], [w - 1 - inner, inner]], [[e, h - 1 - e], [inner, h - 1 - inner]], [[w - 1 - e, h - 1 - e], [w - 1 - inner, h - 1 - inner]]];
    let flagged = 0;
    for (const [c, i] of pairs) {
      const a = sample(...c);
      const b = sample(...i);
      const L = luminance(Math.round(a[0]), Math.round(a[1]), Math.round(a[2]));
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d > 60 && (L > 0.85 || L < 0.01)) flagged++;
    }
    cornerFill = flagged >= 3;
  }

  return {
    w,
    h,
    mode,
    hasAlphaChannel: !!img.hasAlphaChannel,
    transparentFrac,
    translucentFrac: translucent / n,
    cornerAlpha,
    roundedCorners,
    cornerFill,
    background,
    contrastBackground: contrastBg,
    fullBleed,
    empty,
    bbox: empty ? null : { minX, minY, maxX, maxY },
    margins: empty ? null : { left: minX / w, top: minY / h, right: (w - 1 - maxX) / w, bottom: (h - 1 - maxY) / h },
    extent: empty ? 0 : Math.max(maxX - minX + 1, maxY - minY + 1) / size,
    centerOffset: empty ? 0 : Math.hypot((minX + maxX + 1) / 2 - cx, (minY + maxY + 1) / 2 - cy) / size,
    fillRatio: empty ? 0 : count / n,
    outside66: count ? outside66 / count : 0,
    outside72: count ? outside72 / count : 0,
    meanLuminance: histN ? lumSum / histN : null,
    contrast: { onWhite: median(hist.white), onBlack: median(hist.black), onBackground: bgLum !== null ? median(hist.bg) : null },
    dominantColors,
    haloFrac: solid ? halo / solid : 0,
    haloPixels: halo,
  };
}

/**
 * Turn metrics into findings per target. `ctx`: {format:'png'|'svg', fileBytes, plannedBg: '#hex'|null}
 * Finding: {level:'error'|'warn'|'info'|'ok', target:'ios'|'android'|'both', id, msg, fix}
 */
export function evaluate(m, ctx) {
  const out = [];
  const add = (level, target, id, msg, fix = '') => out.push({ level, target, id, msg, fix });
  const px = (v) => (v * 100).toFixed(1) + '%';
  const size = Math.min(m.w, m.h);

  // ----- dimensions -----
  if (m.w !== m.h) {
    add('error', 'both', 'not-square', `Image is ${m.w}×${m.h}; app icons must be square (1:1).`, 'Re-export on a square artboard with the art centered.');
  }
  if (m.empty) {
    add('error', 'both', 'empty', 'Nothing visible in the image (fully transparent or a single flat color).', 'Check the export; the artwork may be hidden or missing.');
    return out;
  }

  const role = ctx.role || 'source';
  if (ctx.format === 'svg') {
    add('ok', 'both', 'vector', 'Vector source — can be exported crisply at every size.');
  } else if (role !== 'android-layer') {
    if (role === 'ios-icon') {
      if (m.w === 1024 && m.h === 1024) add('ok', 'ios', 'ios-size', '1024×1024 — exact App Store size.');
      else add('error', 'ios', 'ios-size', `${m.w}×${m.h}: the App Store icon must be exactly 1024×1024.`, 'Re-export at 1024×1024.');
    } else if (role === 'play-icon') {
      if (!m.hasAlphaChannel) add('warn', 'android', 'play-format', 'Not a 32-bit PNG (no alpha channel). Google Play specifies a 32-bit PNG for the 512×512 icon.', 'Re-export as 32-bit RGBA (build.mjs does; alpha can stay fully opaque).');
      if (m.w === 512 && m.h === 512) add('ok', 'android', 'play-size', '512×512 — exact Play Store icon size.');
      else add('error', 'android', 'play-size', `${m.w}×${m.h}: the Play Store icon must be exactly 512×512.`, 'Re-export at 512×512.');
    } else {
      if (size < 512) add('error', 'ios', 'ios-size', `${m.w}×${m.h} is far below the 1024×1024 App Store master.`, 'Export the master at 1024×1024 (or provide the SVG).');
      else if (size < 1024) add('warn', 'ios', 'ios-size', `${m.w}×${m.h}: the App Store icon must be 1024×1024; upscaling will blur it.`, 'Re-export at 1024×1024, or provide the SVG source.');
      else if (size > 1024) add('info', 'ios', 'ios-size', `${m.w}×${m.h} is larger than the 1024×1024 App Store master; it must be downscaled.`, 'Run build.mjs, which downsamples correctly.');
      else add('ok', 'ios', 'ios-size', '1024×1024 — exact App Store master size.');
      if (size < 512) add('error', 'android', 'play-size', `${m.w}×${m.h} is below the 512×512 Play Store icon size.`, 'Export the master at 1024×1024 (or provide the SVG).');
      else add('ok', 'android', 'play-size', `${size}px ≥ 512px — enough for the Play Store icon.`);
    }
    if (role !== 'ios-icon' && ctx.fileBytes > 1024 * 1024) add('error', 'android', 'play-filesize', `File is ${(ctx.fileBytes / 1048576).toFixed(2)} MB; the Play Store icon must be ≤ 1024 KB.`, 'Re-export with a smaller palette/compression.');
  }

  // ----- iOS -----
  const preMasked = m.roundedCorners && m.extent >= 0.9; // art fills the canvas except the corners
  if (preMasked) {
    add('error', 'ios', 'ios-rounded', 'The corners are transparent and the art fills the rest of the canvas — the icon is pre-rounded/pre-masked. iOS applies its own squircle mask; pre-rounding leaves visible edges or black corners.', 'Supply a square, full-bleed image; let the system round it.');
  } else if (m.mode === 'transparent') {
    add(
      role === 'ios-icon' ? 'error' : 'warn',
      'ios',
      'ios-needs-background',
      `Logo on a transparent canvas (${px(m.transparentFrac)} empty). The iOS marketing icon cannot be transparent — App Store Connect rejects it — so it needs an opaque full-bleed background first.`,
      'Pick a background (brand color, solid or subtle gradient) and flatten: build.mjs --bg "#RRGGBB" writes the 1024px PNG without alpha. For iOS 26, keep the glyph as a separate layer in Icon Composer.',
    );
  } else if (m.hasAlphaChannel) {
    add('error', 'ios', 'ios-alpha', 'The PNG has an alpha channel (even if fully opaque); App Store Connect rejects the 1024px icon with one.', 'Re-export without alpha (flatten). build.mjs writes an RGB PNG.');
  } else if (ctx.format === 'png') {
    add('ok', 'ios', 'ios-alpha', 'Opaque, no alpha channel.');
  }
  if (!preMasked && m.cornerFill) {
    add('warn', 'ios', 'ios-rounded', 'Corners look filled with white/black unlike the rest of the art — probably a baked-in rounded-rectangle mask.', 'Remove the fake rounded corners and extend the background to the edges.');
  }
  if (m.mode === 'opaque' && !m.fullBleed && m.background) {
    const minMargin = Math.min(m.margins.left, m.margins.top, m.margins.right, m.margins.bottom);
    if (minMargin < 0.05) add('warn', 'ios', 'ios-tight', `Glyph comes within ${px(minMargin)} of an edge; the squircle mask and the home-screen glow will crowd or clip it.`, 'Keep the glyph inside roughly the central 80% of the canvas.');
    if (m.extent < 0.3) add('warn', 'ios', 'ios-small', `Glyph spans only ${px(m.extent)} of the canvas — it will be tiny on the home screen.`, 'Scale the logo up (≈55–70% of the canvas is typical).');
    else if (minMargin >= 0.05) add('ok', 'ios', 'ios-margin', `Glyph occupies ${px(m.extent)} of the canvas with comfortable margins.`);
  }

  // ----- Android -----
  if (role === 'android-layer' && m.mode !== 'transparent') {
    add('error', 'android', 'android-layer-opaque', 'This is meant as an adaptive-icon foreground/monochrome layer but it has no transparency.', 'Layers must be the glyph on a transparent canvas; the background is a separate layer.');
  } else if (role === 'play-icon') {
    /* the Play icon is a full-bleed square: layer rules do not apply */
  } else if (m.mode === 'transparent') {
    if (m.outside72 > 0.002) {
      add('error', 'android', 'android-clipped', `${px(m.outside72)} of the artwork lies outside the 72dp visible area of the adaptive icon — it is always cropped.`, 'Scale the logo down so every pixel sits inside the central 66/108 circle (build.mjs does this automatically).');
    } else if (m.outside66 > 0.01) {
      add('warn', 'android', 'android-safe-zone', `${px(m.outside66)} of the artwork is beyond the 66dp safe circle; circular and squircle launcher masks will clip it.`, 'Shrink the logo until it fits the 66/108 circle (≈61% of the canvas diameter).');
    } else {
      add('ok', 'android', 'android-safe-zone', 'Artwork sits inside the 66dp adaptive-icon safe zone.');
    }
    if (m.dominantColors.length > 6) {
      add('info', 'android', 'android-monochrome', `${m.dominantColors.length} distinct colors: a silhouette taken from the alpha channel will lose inner detail in Material You themed (monochrome) icons.`, 'Author a dedicated single-color monochrome layer where inner shapes are separated by gaps.');
    }
  } else {
    add('warn', 'android', 'android-not-layered', 'Image is opaque (no transparent foreground). It works for the Play Store listing, but as a launcher icon Android 8+ would shrink it onto a plain plate or crop its outer third — an adaptive icon needs separate foreground/background layers.', 'Provide the logo on a transparent background (or the SVG) so a foreground, background and monochrome layer can be produced.');
  }

  // ----- shared -----
  if (m.centerOffset > 0.03) add('warn', 'both', 'off-center', `Artwork is off-center by ${px(m.centerOffset)} of the canvas.`, 'Center it on the artboard.');
  if (m.haloFrac > 0.02 && m.haloPixels > 200) {
    add('warn', 'both', 'baked-shadow', 'Soft shadow/glow pixels detected around the artwork.', 'Remove baked-in shadows, glows and glossy highlights; iOS 26 (Liquid Glass) and Material You add depth themselves, and a baked one doubles up.');
  }

  if (role === 'android-layer') {
    /* backdrop is a separate layer: contrast is judged on the composite */
  } else if (m.contrast.onBackground !== null) {
    const c = m.contrast.onBackground;
    if (c < 3) add('warn', 'both', 'contrast', `Artwork vs. its background has a median contrast ratio of ${c.toFixed(1)}:1 (< 3:1) — the logo will look washed out, especially in tinted/dark appearances.`, 'Increase the lightness gap between logo and background (aim for ≥ 4.5:1).');
    else add('ok', 'both', 'contrast', `Artwork vs. background contrast ${c.toFixed(1)}:1.`);
  } else if (m.mode === 'transparent' && m.contrast.onWhite !== null) {
    const { onWhite, onBlack } = m.contrast;
    if (onWhite < 3 && onBlack < 3) add('warn', 'both', 'contrast', `Mid-tone artwork: contrast is only ${onWhite.toFixed(1)}:1 on white and ${onBlack.toFixed(1)}:1 on black — it will struggle on any backdrop.`, 'Pick a background that is clearly lighter or darker than the logo, or recolor the logo (white is the safest on a brand-colored field).');
    else if (onWhite < 3) add('info', 'both', 'contrast', `Light artwork: ${onWhite.toFixed(1)}:1 on white but ${onBlack.toFixed(1)}:1 on black — needs a dark/brand-colored background, and a dark-appearance variant should keep it.`, 'Use a saturated or dark background.');
    else if (onBlack < 3) add('info', 'both', 'contrast', `Dark artwork: ${onBlack.toFixed(1)}:1 on black but ${onWhite.toFixed(1)}:1 on white — needs a light background; for iOS dark/tinted variants provide a lighter version of the glyph.`, 'Use a light background, and ship a dark variant.');
    else add('ok', 'both', 'contrast', `Contrast ${onWhite.toFixed(1)}:1 on white / ${onBlack.toFixed(1)}:1 on black — works on both.`);
  }
  return out;
}

export function verdict(findings, target) {
  const mine = findings.filter((f) => f.target === target || f.target === 'both');
  if (mine.some((f) => f.level === 'error')) return 'blocked';
  if (mine.some((f) => f.level === 'warn')) return 'caveats';
  return 'ready';
}
