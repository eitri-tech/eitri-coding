// Zero-dependency PNG decode/encode plus the few pixel helpers the icon tools need.
// Pixels are always handled as 8-bit RGBA (Uint8Array, row-major, straight alpha).

import zlib from 'node:zlib';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

export function isPng(buf) {
  return buf.length > 8 && SIG.every((b, i) => buf[i] === b);
}

/** @returns {{w:number,h:number,rgba:Uint8Array,hasAlphaChannel:boolean,meta:object}} */
export function decodePng(buf) {
  if (!isPng(buf)) throw new Error('not a PNG file');
  let pos = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  const meta = { chunks: [], iccProfile: null, srgb: false, gamma: null };

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    if (pos + 12 + len > buf.length) throw new Error('truncated PNG chunk');
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    meta.chunks.push(type);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'iCCP') meta.iccProfile = data.toString('latin1', 0, Math.max(0, data.indexOf(0)));
    else if (type === 'sRGB') meta.srgb = true;
    else if (type === 'gAMA') meta.gamma = data.readUInt32BE(0) / 100000;
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  const { w, h, depth, colorType, interlace } = ihdr;
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  if (![1, 2, 4, 8, 16].includes(depth)) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (colorType === 3 && !plte) throw new Error('palette PNG without PLTE chunk');

  if (!w || !h || w * h > 64e6) throw new Error(`unsupported PNG dimensions ${w}×${h} (max 64 megapixels)`);
  const bitsPP = channels * depth;
  let expected = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw > 0 && ph > 0) expected += (Math.ceil((pw * bitsPP) / 8) + 1) * ph;
  }
  // bound inflation by the exact size the header promises (blocks decompression bombs)
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  if (raw.length !== expected) throw new Error('PNG pixel data is truncated or has the wrong length');
  const out = new Uint8Array(w * h * 4);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const maxVal = (1 << Math.min(depth, 8)) - 1;
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];

  // color-key transparency (tRNS on gray / truecolor): raw samples, 16-bit aware
  let key = null;
  if (trns && colorType === 0 && trns.length >= 2) key = [trns.readUInt16BE(0)];
  if (trns && colorType === 2 && trns.length >= 6) key = [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)];

  let off = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPerPixel) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const ft = raw[off++];
      const line = new Uint8Array(raw.subarray(off, off + stride));
      off += stride;
      unfilter(ft, line, prev, bpp);
      for (let x = 0; x < pw; x++) {
        const px = x0 + x * dx;
        const py = y0 + y * dy;
        const o = (py * w + px) * 4;
        const sample = (c) => readSample(line, x * channels + c, depth);
        let r;
        let g;
        let b;
        let a = 255;
        if (colorType === 0) {
          const v = sample(0);
          r = g = b = depth === 16 ? v >> 8 : scale(v, maxVal);
          if (key && v === key[0]) a = 0;
        } else if (colorType === 2) {
          const rr = sample(0);
          const gg = sample(1);
          const bb = sample(2);
          if (depth === 16) {
            r = rr >> 8;
            g = gg >> 8;
            b = bb >> 8;
          } else {
            r = rr;
            g = gg;
            b = bb;
          }
          if (key && rr === key[0] && gg === key[1] && bb === key[2]) a = 0;
        } else if (colorType === 3) {
          const idx = sample(0);
          r = plte[idx * 3];
          g = plte[idx * 3 + 1];
          b = plte[idx * 3 + 2];
          if (trns && idx < trns.length) a = trns[idx];
        } else if (colorType === 4) {
          const v = sample(0);
          r = g = b = depth === 16 ? v >> 8 : v;
          const av = sample(1);
          a = depth === 16 ? av >> 8 : av;
        } else {
          const rr = sample(0);
          const gg = sample(1);
          const bb = sample(2);
          const aa = sample(3);
          if (depth === 16) {
            r = rr >> 8;
            g = gg >> 8;
            b = bb >> 8;
            a = aa >> 8;
          } else {
            r = rr;
            g = gg;
            b = bb;
            a = aa;
          }
        }
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
      prev = line;
    }
  }

  return {
    w,
    h,
    rgba: out,
    hasAlphaChannel: colorType === 4 || colorType === 6 || trns !== null,
    meta: { ...meta, depth, colorType, interlaced: !!interlace },
  };
}

function scale(v, maxVal) {
  return maxVal === 255 ? v : Math.round((v * 255) / maxVal);
}

function readSample(line, index, depth) {
  if (depth === 8) return line[index];
  if (depth === 16) return (line[index * 2] << 8) | line[index * 2 + 1];
  const perByte = 8 / depth;
  const byte = line[Math.floor(index / perByte)];
  const shift = 8 - depth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

function unfilter(ft, line, prev, bpp) {
  const n = line.length;
  switch (ft) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255;
      return;
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255;
      return;
    case 3:
      for (let i = 0; i < n; i++) {
        const left = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255;
      }
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + pr) & 255;
      }
      return;
    default:
      throw new Error(`bad PNG filter type ${ft}`);
  }
}

// ---------- encode ----------

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, Buffer.from(data)])), 8 + data.length);
  return out;
}

/**
 * Encode 8-bit RGBA to PNG. With `alpha:false` the file is written as RGB (color type 2),
 * i.e. with NO alpha channel — what the App Store requires for the 1024px marketing icon.
 */
export function encodePng(w, h, rgba, { alpha = true } = {}) {
  const ch = alpha ? 4 : 3;
  const stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowOut = y * (stride + 1);
    raw[rowOut] = 1; // Sub filter
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        const v = rgba[(y * w + x) * 4 + c];
        const left = x > 0 ? rgba[(y * w + x - 1) * 4 + c] : 0;
        raw[rowOut + 1 + x * ch + c] = (v - left) & 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from(SIG),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- pixel helpers ----------

/** Area-average downscale / bilinear upscale in premultiplied space. */
export function resize(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  const down = fx > 1 || fy > 1;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      if (down) {
        const x0 = x * fx;
        const x1 = (x + 1) * fx;
        const y0 = y * fy;
        const y1 = (y + 1) * fy;
        for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy++) {
          const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
          for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx++) {
            const wgt = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
            const i = (sy * sw + sx) * 4;
            const al = src[i + 3] * wgt;
            r += src[i] * al;
            g += src[i + 1] * al;
            b += src[i + 2] * al;
            a += al;
            wsum += wgt;
          }
        }
      } else {
        const gx = Math.max(0, Math.min(sw - 1, (x + 0.5) * fx - 0.5));
        const gy = Math.max(0, Math.min(sh - 1, (y + 0.5) * fy - 0.5));
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const tx = gx - ix;
        const ty = gy - iy;
        for (const [ox, oy, wgt] of [
          [0, 0, (1 - tx) * (1 - ty)],
          [1, 0, tx * (1 - ty)],
          [0, 1, (1 - tx) * ty],
          [1, 1, tx * ty],
        ]) {
          const i = (Math.min(sh - 1, iy + oy) * sw + Math.min(sw - 1, ix + ox)) * 4;
          const al = src[i + 3] * wgt;
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += al;
          wsum += wgt;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = wsum > 0 ? Math.round(a / wsum) : 0;
    }
  }
  return out;
}

/** Alpha-composite `src` over `dst` (both RGBA) with `src` top-left at (ox, oy). Mutates dst. */
export function over(dst, dw, dh, src, sw, sh, ox = 0, oy = 0) {
  for (let y = 0; y < sh; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= dh) continue;
    for (let x = 0; x < sw; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= dw) continue;
      const si = (y * sw + x) * 4;
      const di = (dy * dw + dx) * 4;
      const sa = src[si + 3] / 255;
      if (sa === 0) continue;
      const da = dst[di + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst[di + c] = Math.round((src[si + c] * sa + dst[di + c] * da * (1 - sa)) / oa);
      }
      dst[di + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}

export function solid(w, h, [r, g, b, a = 255]) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }
  return out;
}

export function parseHex(str) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(str).trim());
  if (!m) throw new Error(`invalid color "${str}" (use #RGB or #RRGGBB)`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

const LIN = new Float64Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** WCAG relative luminance of an sRGB color (0..1). */
export const luminance = (r, g, b) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];

export const contrastRatio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
