// Rasterize an SVG with whichever external renderer is installed. Order = fidelity:
// resvg and rsvg-convert are exact, inkscape is exact but slow, ImageMagick is last
// because its built-in SVG reader (MSVG) ignores a lot — results are flagged "approximate".

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const has = (bin) => spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0 || spawnSync('which', [bin], { stdio: 'ignore' }).status === 0;

export function findRenderers() {
  const list = [];
  if (has('resvg')) list.push('resvg');
  if (has('rsvg-convert')) list.push('rsvg-convert');
  if (has('inkscape')) list.push('inkscape');
  if (has('magick')) list.push('magick');
  else if (has('convert')) list.push('convert');
  return list;
}

/** Rasterize `svgPath` to a PNG buffer of `size` px wide. Returns {png, renderer, approximate} or {error}. */
export function renderSvg(svgPath, size = 1024, prefer = null) {
  const renderers = findRenderers();
  if (!renderers.length) {
    return {
      error:
        'No SVG renderer found. Install one of: resvg (cargo install resvg / brew install resvg), librsvg (rsvg-convert), Inkscape, or ImageMagick.',
    };
  }
  const order = prefer && renderers.includes(prefer) ? [prefer, ...renderers.filter((r) => r !== prefer)] : renderers;
  const tmp = mkdtempSync(join(tmpdir(), 'mobile-icon-'));
  const out = join(tmp, 'render.png');
  const errors = [];
  try {
    for (const r of order) {
      const argv = {
        resvg: ['resvg', ['-w', String(size), svgPath, out]],
        'rsvg-convert': ['rsvg-convert', ['-w', String(size), '-f', 'png', '-o', out, svgPath]],
        inkscape: ['inkscape', [svgPath, '--export-type=png', `--export-filename=${out}`, '-w', String(size)]],
        magick: ['magick', ['-background', 'none', '-density', '384', svgPath, '-resize', `${size}x${size}`, `PNG32:${out}`]],
        convert: ['convert', ['-background', 'none', '-density', '384', svgPath, '-resize', `${size}x${size}`, `PNG32:${out}`]],
      }[r];
      const res = spawnSync(argv[0], argv[1], { encoding: 'utf8', timeout: 60_000 });
      if (res.status === 0) {
        try {
          return { png: readFileSync(out), renderer: r, approximate: r === 'magick' || r === 'convert' };
        } catch {
          /* try next */
        }
      }
      errors.push(`${r}: ${(res.stderr || res.error?.message || 'failed').toString().split('\n')[0]}`);
    }
    return { error: `Every renderer failed — ${errors.join(' | ')}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Convert any raster ImageMagick understands (jpg, webp, gif, …) to PNG. */
export function toPng(path) {
  const bin = has('magick') ? 'magick' : has('convert') ? 'convert' : null;
  if (!bin) return { error: 'Not a PNG/SVG, and ImageMagick is not installed to convert it.' };
  const tmp = mkdtempSync(join(tmpdir(), 'mobile-icon-'));
  const out = join(tmp, 'in.png');
  try {
    const res = spawnSync(bin, [`${path}[0]`, `PNG32:${out}`], { encoding: 'utf8', timeout: 60_000 });
    if (res.status !== 0) return { error: `ImageMagick could not read the file: ${res.stderr}` };
    return { png: readFileSync(out) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
