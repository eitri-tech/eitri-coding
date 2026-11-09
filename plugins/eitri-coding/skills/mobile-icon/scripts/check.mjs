#!/usr/bin/env node
// mobile-icon check — is this image (SVG or PNG) good enough to be an app icon on iOS and Android?
//
//   node check.mjs <icon.svg|icon.png> [--target ios|android|both] [--role source|ios-icon|play-icon|android-layer] [--bg "#RRGGBB"]
//        [--preview sheet.png] [--render-out render.png] [--renderer resvg|rsvg-convert|inkscape|magick]
//        [--json]
//
// Exit code: 0 = no blocking problem, 1 = at least one error, 2 = bad usage / unreadable file,
// 3 = incomplete (the SVG could not be rendered, so pixel checks did not run).

import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { decodePng, encodePng, isPng, parseHex } from './lib/png.mjs';
import { lintSvg } from './lib/svg.mjs';
import { renderSvg, toPng, findRenderers } from './lib/render.mjs';
import { measure, evaluate, verdict } from './lib/analyze.mjs';
import { makePreview } from './lib/preview.mjs';

const USAGE = `Usage: node check.mjs <icon.svg|icon.png> [--target ios|android|both] [--role source|ios-icon|play-icon|android-layer] [--bg "#RRGGBB"] [--preview out.png] [--render-out out.png] [--renderer name] [--json]`;

function args(argv) {
  const o = { target: 'both', json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      o[key] = v;
    } else rest.push(a);
  }
  o.file = rest[0];
  return o;
}

function fail(msg) {
  console.error(`error: ${msg}\n${USAGE}`);
  process.exit(2);
}

// write a file, creating its folder first (the docs point --preview/--render-out at a not-yet-existing out dir)
function writeOut(path, data) {
  const p = resolve(path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

const opts = args(process.argv.slice(2));
if (!opts.file) fail('missing input file');
if (!['ios', 'android', 'both'].includes(opts.target)) fail('--target must be ios, android or both');
const ROLES = { source: 'both', 'ios-icon': 'ios', 'play-icon': 'android', 'android-layer': 'android' };
opts.role = opts.role || 'source';
if (!(opts.role in ROLES)) fail('--role must be source, ios-icon, play-icon or android-layer');
if (opts.role !== 'source' && !process.argv.includes('--target')) opts.target = ROLES[opts.role];
if (opts.bg) {
  try {
    parseHex(opts.bg);
  } catch (e) {
    fail(e.message);
  }
}

const file = resolve(opts.file);
let bytes;
try {
  bytes = readFileSync(file);
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}
const fileBytes = statSync(file).size;

const findings = []; // svg-level + raster-level, each {level,target,id,msg,fix}
const notes = [];
let format;
let img = null;
let svgInfo = null;

const looksSvg = extname(file).toLowerCase() === '.svg' || /^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(bytes.subarray(0, 2048).toString('utf8'));

if (looksSvg) {
  format = 'svg';
  svgInfo = lintSvg(bytes.toString('utf8'));
  for (const f of svgInfo.findings) findings.push({ target: 'both', ...f });
  const blocking = svgInfo.findings.some((f) => f.id === 'svg-no-root');
  if (!blocking) {
    const r = renderSvg(file, 1024, opts.renderer || null);
    if (r.error) {
      notes.push(`Rendered checks skipped: ${r.error}`);
    } else {
      img = decodePng(r.png);
      notes.push(`Rendered with ${r.renderer}${r.approximate ? ' (approximate renderer — install resvg or librsvg for exact output; judge colors/edges visually)' : ''} at 1024px.`);
      if (opts.renderOut) writeOut(opts.renderOut, r.png);
    }
  }
} else if (isPng(bytes)) {
  format = 'png';
  try {
    img = decodePng(bytes);
  } catch (e) {
    fail(`could not decode PNG: ${e.message}`);
  }
} else {
  format = 'raster';
  const c = toPng(file);
  if (c.error) fail(c.error);
  img = decodePng(c.png);
  img.hasAlphaChannel = false; // the converted PNG always has one; the original JPG/WebP/… is judged by its real pixels
  findings.push({ level: 'warn', target: 'both', id: 'not-png', msg: `File is not a PNG (${extname(file) || 'unknown type'}); stores and asset catalogs want PNG (or SVG as the source).`, fix: 'Export a 1024×1024 PNG or provide the SVG.' });
}

if (format === 'png' && img.meta) {
  if (img.meta.interlaced) findings.push({ level: 'info', target: 'both', id: 'png-interlaced', msg: 'PNG is interlaced.', fix: 'Not a problem, but non-interlaced is the norm for icons.' });
  if (img.meta.depth === 16) findings.push({ level: 'info', target: 'both', id: 'png-16bit', msg: '16-bit PNG.', fix: '8 bits per channel is all stores need.' });
  if (img.meta.iccProfile && !/srgb/i.test(img.meta.iccProfile)) {
    findings.push({ level: 'warn', target: 'ios', id: 'png-profile', msg: `Embedded color profile "${img.meta.iccProfile}" is not sRGB; colors may shift, and build.mjs does not convert profiles (it would relabel the values as sRGB).`, fix: 'Convert to sRGB before export (build.mjs refuses such a source unless --assume-srgb).' });
  }
}

let metrics = null;
if (img) {
  metrics = measure(img, { plannedBg: opts.bg || null });
  for (const f of evaluate(metrics, { format: format === 'svg' ? 'svg' : 'png', fileBytes, plannedBg: opts.bg || null, role: opts.role })) findings.push(f);

  // The static bbox from the SVG is a second opinion on the rendered one
  if (svgInfo?.bbox && svgInfo.viewBox && metrics.bbox && metrics.mode === 'transparent') {
    const [, , vw, vh] = svgInfo.viewBox;
    const b = svgInfo.bbox;
    const sw = (b.maxX - b.minX) / vw;
    const sh = (b.maxY - b.minY) / vh;
    const rendered = metrics.extent;
    if (Math.abs(Math.max(sw, sh) - rendered) > 0.08) {
      findings.push({
        level: 'warn',
        target: 'both',
        id: 'svg-render-mismatch',
        msg: `The path coordinates span ${(Math.max(sw, sh) * 100).toFixed(0)}% of the viewBox but the renderer drew ${(rendered * 100).toFixed(0)}% — the paths are not rendering as written (transforms, clip/mask, strokes or an unsupported feature).`,
        fix: 'Flatten transforms, outline strokes and remove clip/mask, then re-check.',
      });
    }
  }

  if (opts.preview) {
    const bgRgb = opts.bg ? parseHex(opts.bg) : metrics.mode === 'transparent' ? (metrics.contrast.onWhite >= metrics.contrast.onBlack ? [255, 255, 255] : [20, 20, 22]) : null;
    const sheet = makePreview(img, { bg: bgRgb });
    writeOut(opts.preview, encodePng(sheet.w, sheet.h, sheet.rgba, { alpha: false }));
    notes.push(`Preview sheet written to ${resolve(opts.preview)}${metrics.mode === 'transparent' && !opts.bg ? ` (transparent artwork shown on ${bgRgb[0] > 128 ? 'white' : 'near-black'}; pass --bg to try your brand color)` : ''}.`);
  }
}

if (format === 'svg' && !img) {
  findings.push({ level: 'info', target: 'both', id: 'no-render', msg: 'Pixel-level checks (safe zone, contrast, margins) need a rendered image.', fix: 'Install resvg, librsvg (rsvg-convert), Inkscape or ImageMagick and run again.' });
}

const shown = findings.filter((f) => opts.target === 'both' || f.target === 'both' || f.target === opts.target);
const targets = opts.target === 'both' ? ['ios', 'android'] : [opts.target];
// Without pixel analysis (SVG that could not be rendered) a clean lint is NOT "ready": report it as incomplete.
const incomplete = !img;
const verdicts = Object.fromEntries(targets.map((t) => [t, incomplete && verdict(findings, t) !== 'blocked' ? 'unknown' : verdict(findings, t)]));
const hasError = shown.some((f) => f.level === 'error');
const exitCode = hasError ? 1 : incomplete ? 3 : 0;

if (opts.json) {
  console.log(
    JSON.stringify(
      {
        file,
        format,
        target: opts.target,
        renderers: format === 'svg' ? findRenderers() : undefined,
        verdicts,
        metrics: metrics ? { ...metrics, bbox: metrics.bbox, cornerAlpha: undefined } : null,
        svg: svgInfo ? { viewBox: svgInfo.viewBox, bbox: svgInfo.bbox, stats: svgInfo.stats } : undefined,
        findings: shown,
        notes,
      },
      null,
      2,
    ),
  );
  process.exit(exitCode);
}

const ICON = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ', ok: '✅' };
const ORDER = { error: 0, warn: 1, info: 2, ok: 3 };
const LABEL = { ios: 'iOS', android: 'Android' };
const VERDICT = { ready: '✅ ready', caveats: '⚠️  usable, with caveats', blocked: '❌ not usable as-is', unknown: '❔ incomplete — pixel checks could not run' };

console.log(`\nIcon check — ${file}`);
console.log(`Role: ${opts.role}`);
console.log(`Format: ${format.toUpperCase()}${img ? `  ·  ${img.w}×${img.h}px${format === 'svg' ? ' (rendered)' : ''}` : ''}`);
if (metrics) {
  const parts = [];
  parts.push(metrics.mode === 'transparent' ? `transparent artwork (${(metrics.transparentFrac * 100).toFixed(0)}% empty)` : metrics.fullBleed ? 'opaque full-bleed art' : 'opaque, simple background');
  if (metrics.extent) parts.push(`glyph spans ${(metrics.extent * 100).toFixed(0)}% of canvas`);
  if (metrics.dominantColors.length) parts.push(`${metrics.dominantColors.length} main color(s): ${metrics.dominantColors.slice(0, 4).map((c) => c.hex).join(' ')}`);
  console.log(parts.join('  ·  '));
}
console.log('');
for (const t of targets) console.log(`${LABEL[t].padEnd(8)} ${VERDICT[verdicts[t]]}`);
console.log('');

for (const scope of ['both', ...targets]) {
  const list = shown.filter((f) => f.target === scope).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  if (!list.length) continue;
  console.log(scope === 'both' ? 'Both platforms / source' : `${LABEL[scope]}`);
  for (const f of list) {
    console.log(`  ${ICON[f.level]} ${f.msg}`);
    if (f.fix && f.level !== 'ok') console.log(`       → ${f.fix}`);
  }
  console.log('');
}
for (const n of notes) console.log(`• ${n}`);
if (notes.length) console.log('');
process.exit(exitCode);
