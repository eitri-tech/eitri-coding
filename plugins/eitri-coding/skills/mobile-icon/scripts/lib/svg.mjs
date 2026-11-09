// Static SVG linter for app-icon sources. No rendering here — it reads the markup and reports
// the constructs that make an SVG render differently (or not at all) once it goes through
// Android's VectorDrawable converter, Apple's Icon Composer / asset catalog, or a rasterizer.

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const DEFS_LIKE = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'lineargradient', 'radialgradient', 'filter']);
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAMED_OK = /^(none|transparent|currentcolor|inherit|context-fill|context-stroke)$/i;

// ---------- tolerant XML scanner ----------

const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1]] = decodeEntities(m[2] ?? m[3]);
  return attrs;
}

function scan(xml) {
  const root = { name: '#root', attrs: {}, children: [], parent: null, text: '' };
  let cur = root;
  const all = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      cur.text += xml.slice(i);
      break;
    }
    if (lt > i) cur.text += xml.slice(i, lt);
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e === -1 ? n : e + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt);
      cur.text += xml.slice(lt + 9, e === -1 ? n : e);
      i = e === -1 ? n : e + 3;
    } else if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt);
      i = e === -1 ? n : e + 2;
    } else if (xml.startsWith('<!', lt)) {
      let depth = 0;
      let j = lt;
      for (; j < n; j++) {
        if (xml[j] === '[') depth++;
        else if (xml[j] === ']') depth--;
        else if (xml[j] === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else {
      // read tag honoring quotes
      let j = lt + 1;
      let q = null;
      for (; j < n; j++) {
        const c = xml[j];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (c === '>') break;
      }
      const body = xml.slice(lt + 1, j);
      i = j + 1;
      if (body.startsWith('/')) {
        const name = body.slice(1).trim().toLowerCase();
        let p = cur;
        while (p && p.name !== name) p = p.parent;
        if (p && p.parent) cur = p.parent;
      } else {
        const selfClose = body.endsWith('/');
        const m = /^([^\s/>]+)([\s\S]*)$/.exec(selfClose ? body.slice(0, -1) : body);
        if (!m) continue;
        const node = { name: m[1].toLowerCase(), raw: m[1], attrs: parseAttrs(m[2]), children: [], parent: cur, text: '' };
        // inline style="" wins over presentation attributes
        if (node.attrs.style) {
          for (const decl of node.attrs.style.split(';')) {
            const k = decl.indexOf(':');
            if (k > 0) node.attrs[decl.slice(0, k).trim()] = decl.slice(k + 1).trim();
          }
        }
        cur.children.push(node);
        all.push(node);
        if (!selfClose) cur = node;
      }
    }
  }
  return { root, all };
}

const attrUp = (node, name) => {
  for (let p = node; p; p = p.parent) if (p.attrs && p.attrs[name] !== undefined) return p.attrs[name];
  return undefined;
};
const hasAncestor = (node, set) => {
  for (let p = node.parent; p; p = p.parent) if (set.has(p.name)) return true;
  return false;
};
const transformUp = (node) => {
  for (let p = node; p && p.name !== '#root'; p = p.parent) {
    const t = p.attrs.transform;
    if (t && t.trim() && !/^none$/i.test(t.trim())) return t.trim();
  }
  return null;
};

// ---------- path data ----------

export function parsePathData(d) {
  const segs = [];
  const errors = [];
  let i = 0;
  const n = d.length;
  const ws = () => {
    while (i < n && /[\s,]/.test(d[i])) i++;
  };
  const num = () => {
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  let first = true;
  while (true) {
    ws();
    if (i >= n) break;
    const c = d[i];
    const up = c.toUpperCase();
    if (!(up in ARITY) || !/[a-zA-Z]/.test(c)) {
      errors.push(`unexpected "${c}" at offset ${i}`);
      break;
    }
    if (first && up !== 'M') {
      errors.push(`path data must start with M/m, found "${c}"`);
      break;
    }
    first = false;
    i++;
    const arity = ARITY[up];
    if (arity === 0) {
      segs.push({ cmd: c, args: [] });
      continue;
    }
    let groups = 0;
    while (true) {
      ws();
      if (i >= n || /[a-zA-Z]/.test(d[i])) break;
      const args = [];
      const raws = [];
      for (let k = 0; k < arity; k++) {
        ws();
        let r;
        if (up === 'A' && (k === 3 || k === 4)) {
          r = d[i] === '0' || d[i] === '1' ? d[i++] : null;
        } else r = num();
        if (r === null) {
          errors.push(`"${c}" needs ${arity} numbers per segment (offset ${i})`);
          return { segs, errors };
        }
        raws.push(r);
        args.push(parseFloat(r));
      }
      segs.push({ cmd: groups === 0 ? c : c === 'M' ? 'L' : c === 'm' ? 'l' : c, args, raws });
      groups++;
    }
    if (groups === 0) {
      errors.push(`"${c}" has no coordinates`);
      break;
    }
  }
  return { segs, errors };
}

function arcPoints(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2, out) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return void out.push([x2, y2]);
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = c * dx + s * dy;
  const y1p = -s * dx + c * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const k = Math.sqrt(lam);
    rx *= k;
    ry *= k;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2;
  const cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  else if (fs && dth < 0) dth += 2 * Math.PI;
  for (let i = 1; i <= 32; i++) {
    const th = th1 + (dth * i) / 32;
    out.push([cx + rx * Math.cos(th) * c - ry * Math.sin(th) * s, cy + rx * Math.cos(th) * s + ry * Math.sin(th) * c]);
  }
}

/** Points that bound the drawn geometry: endpoints plus dense samples along Béziers and arcs (not control points). */
function pathPoints(segs) {
  const pts = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null; // previous cubic 2nd control point
  let lastQ = null; // previous quadratic control point
  const cubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      pts.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
  };
  const quad = (x0, y0, x1, y1, x2, y2) => {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      pts.push([u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2]);
    }
  };
  for (const { cmd, args: a } of segs) {
    const rel = cmd === cmd.toLowerCase();
    const U = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    let nextC = null;
    let nextQ = null;
    if (U === 'M' || U === 'L') {
      x = ox + a[0];
      y = oy + a[1];
      pts.push([x, y]);
      if (U === 'M') [sx, sy] = [x, y];
    } else if (U === 'H') {
      x = ox + a[0];
      pts.push([x, y]);
    } else if (U === 'V') {
      y = oy + a[0];
      pts.push([x, y]);
    } else if (U === 'C') {
      const [x1, y1, x2, y2] = [ox + a[0], oy + a[1], ox + a[2], oy + a[3]];
      cubic(x, y, x1, y1, x2, y2, ox + a[4], oy + a[5]);
      x = ox + a[4];
      y = oy + a[5];
      nextC = [x2, y2];
    } else if (U === 'S') {
      const [x1, y1] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
      const [x2, y2] = [ox + a[0], oy + a[1]];
      cubic(x, y, x1, y1, x2, y2, ox + a[2], oy + a[3]);
      x = ox + a[2];
      y = oy + a[3];
      nextC = [x2, y2];
    } else if (U === 'Q') {
      const [x1, y1] = [ox + a[0], oy + a[1]];
      quad(x, y, x1, y1, ox + a[2], oy + a[3]);
      x = ox + a[2];
      y = oy + a[3];
      nextQ = [x1, y1];
    } else if (U === 'T') {
      const [x1, y1] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
      quad(x, y, x1, y1, ox + a[0], oy + a[1]);
      x = ox + a[0];
      y = oy + a[1];
      nextQ = [x1, y1];
    } else if (U === 'A') {
      arcPoints(x, y, a[0], a[1], a[2], a[3], a[4], ox + a[5], oy + a[6], pts);
      x = ox + a[5];
      y = oy + a[6];
    } else if (U === 'Z') {
      x = sx;
      y = sy;
    }
    lastC = nextC;
    lastQ = nextQ;
  }
  return pts;
}

const nums = (s) => (String(s ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || []).map(Number);
const f = (v) => parseFloat(v) || 0;

function shapePoints(node) {
  const a = node.attrs;
  switch (node.name) {
    case 'rect': {
      const [x, y, w, h] = [f(a.x), f(a.y), f(a.width), f(a.height)];
      return [[x, y], [x + w, y + h]];
    }
    case 'circle': {
      const [cx, cy, r] = [f(a.cx), f(a.cy), f(a.r)];
      return [[cx - r, cy - r], [cx + r, cy + r]];
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [f(a.cx), f(a.cy), f(a.rx), f(a.ry)];
      return [[cx - rx, cy - ry], [cx + rx, cy + ry]];
    }
    case 'line':
      return [[f(a.x1), f(a.y1)], [f(a.x2), f(a.y2)]];
    case 'polyline':
    case 'polygon': {
      const v = nums(a.points);
      const out = [];
      for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i], v[i + 1]]);
      return out;
    }
    default:
      return [];
  }
}

// ---------- the linter ----------

/**
 * @returns {{findings: Array, stats: object, viewBox: number[]|null, bbox: object|null}}
 */
export function lintSvg(xml) {
  const findings = [];
  const add = (level, id, msg, fix, extra = {}) => findings.push({ level, id, msg, fix, ...extra });
  const { root, all } = scan(xml);
  const svg = all.find((n) => n.name === 'svg');
  if (!svg) {
    add('error', 'svg-no-root', 'No <svg> root element found — the file is not a valid SVG.', 'Re-export the artwork as SVG.');
    return { findings, stats: {}, viewBox: null, bbox: null };
  }

  // --- root ---
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(xml.slice(0, 2000))) {
    add('error', 'svg-xmlns', 'Missing xmlns="http://www.w3.org/2000/svg" on <svg>; many loaders reject the file.', 'Add xmlns="http://www.w3.org/2000/svg" to the root element.');
  }
  let viewBox = null;
  if (svg.attrs.viewBox) {
    const v = nums(svg.attrs.viewBox);
    if (v.length === 4 && v[2] > 0 && v[3] > 0) viewBox = v;
    else add('error', 'svg-viewbox-invalid', `viewBox "${svg.attrs.viewBox}" is not "minX minY width height" with positive size.`, 'Fix the viewBox.');
  }
  const wAttr = svg.attrs.width;
  const hAttr = svg.attrs.height;
  if (!svg.attrs.viewBox) {
    add('error', 'svg-no-viewbox', 'No viewBox: scaling to icon sizes is undefined, so content gets cropped or misplaced.', 'Add viewBox="0 0 W H" matching the artboard (e.g. 0 0 1024 1024).');
  }
  const badUnits = [['width', wAttr], ['height', hAttr]].filter(([, v]) => v && !/^[\d.]+(px)?$/.test(v.trim()));
  if (badUnits.length) {
    add('warn', 'svg-units', `${badUnits.map(([k, v]) => `${k}="${v}"`).join(' ')} use non-pixel units (%, em, pt, mm…) — renderers disagree on the resulting size.`, 'Use unitless/px width and height equal to the viewBox size.');
  }
  if (viewBox) {
    if (Math.abs(viewBox[2] - viewBox[3]) > 1e-6) {
      add('error', 'svg-not-square', `viewBox is ${viewBox[2]}×${viewBox[3]} — app icons must be square.`, 'Put the artwork on a square artboard (1:1), centered.');
    }
    if (viewBox[0] !== 0 || viewBox[1] !== 0) {
      add('warn', 'svg-viewbox-origin', `viewBox starts at (${viewBox[0]}, ${viewBox[1]}), not (0, 0); some converters ignore the offset and shift the art.`, 'Translate the content so the artboard starts at 0 0 and use viewBox="0 0 W H".');
    }
    if (wAttr && hAttr && /^[\d.]+(px)?$/.test(wAttr.trim()) && /^[\d.]+(px)?$/.test(hAttr.trim())) {
      const ar = f(wAttr) / f(hAttr);
      if (Math.abs(ar - viewBox[2] / viewBox[3]) > 0.01) {
        add('warn', 'svg-aspect-mismatch', 'width/height and viewBox have different aspect ratios — the art will be letterboxed or cropped.', 'Make width/height match the viewBox ratio.');
      }
    }
  }

  // --- element inventory ---
  const count = {};
  for (const n of all) count[n.name] = (count[n.name] || 0) + 1;
  const stat = { elements: all.length, shapes: 0, paths: 0, pathCommands: 0 };

  const flag = (names, level, id, msg, fix) => {
    const hit = names.filter((nm) => count[nm]);
    if (hit.length) add(level, id, msg.replace('{n}', hit.map((h) => `${h}×${count[h]}`).join(', ')), fix);
  };

  flag(['script', 'foreignobject', 'animate', 'animatetransform', 'animatemotion', 'set'], 'error', 'svg-dynamic', 'Scripts / foreignObject / animation ({n}) are never rendered in an icon.', 'Delete them; icons are static artwork.');
  flag(['image'], 'error', 'svg-embedded-raster', 'Embedded <image> ({n}): the "vector" is really a bitmap, so it blurs when scaled and converters drop it.', 'Replace it with real vector shapes, or use a PNG source at ≥1024px instead.');
  flag(['text', 'tspan', 'textpath'], 'error', 'svg-text', 'Live <text> ({n}) depends on installed fonts; VectorDrawable and Icon Composer do not render it.', 'Convert text to outlines (Figma: Outline text / Inkscape: Object to Path) so it becomes <path>.');
  flag(['filter', 'fegaussianblur', 'fedropshadow', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite', 'feflood'], 'error', 'svg-filter', 'SVG filters ({n}: blur, shadow, glow…) are not supported by Android vectors and are flattened or dropped elsewhere.', 'Remove them. iOS 26 and Material You add their own depth/shadow; bake only flat shapes.');
  flag(['mask'], 'error', 'svg-mask', '<mask> ({n}) is not supported by Android VectorDrawable and renders inconsistently elsewhere.', 'Boolean-combine the shapes into a single path (Figma: Flatten / Inkscape: Path ▸ Difference) instead of masking.');
  flag(['pattern'], 'error', 'svg-pattern', '<pattern> ({n}) fills are not supported by Android vectors.', 'Expand the pattern into real shapes or use a solid fill.');
  flag(['marker'], 'error', 'svg-marker', '<marker> ({n}) is not supported by Android vectors.', 'Draw the markers as ordinary paths.');
  flag(['clippath'], 'warn', 'svg-clippath', '<clipPath> ({n}) only half-works on Android (path clips only, no transforms/groups inside) and some tools ignore it.', 'Apply the clip yourself: Path ▸ Intersection, then export the resulting path.');
  flag(['use', 'symbol'], 'warn', 'svg-use', '<use>/<symbol> ({n}) references are not resolved by several converters.', 'Inline them as real shapes (Inkscape: Edit ▸ Clone ▸ Unlink Clone; Figma: Detach instance, then Flatten).');
  flag(['switch'], 'warn', 'svg-switch', '<switch> ({n}) is not portable.', 'Keep only the branch you want.');

  if (count.style) {
    add('warn', 'svg-css', '<style> block: CSS rules/classes are applied by browsers but ignored or only partly resolved by Android Studio, Icon Composer and most converters, so colors can disappear.', 'Inline everything as presentation attributes (fill="…", stroke="…") — svgo "inlineStyles" or Inkscape "Save as Plain SVG".');
  } else if (all.some((n) => n.attrs.class)) {
    add('info', 'svg-class', 'class attributes without a <style> block do nothing.', 'Remove them.');
  }
  if (all.some((n) => /(^|;)\s*(mix-blend-mode|isolation|backdrop-filter)\s*:/.test(n.attrs.style || '') || n.attrs['mix-blend-mode'])) {
    add('error', 'svg-blend', 'Blend modes (mix-blend-mode / isolation) are not supported outside browsers.', 'Flatten the blended result into plain shapes with explicit colors.');
  }
  if (all.some((n) => n.attrs.href?.startsWith('http') || n.attrs['xlink:href']?.startsWith('http'))) {
    add('error', 'svg-external-ref', 'External href — the file depends on a network resource.', 'Inline the content.');
  }
  if (xml.includes('inkscape:') || xml.includes('sodipodi:') || xml.includes('sketch:') || xml.includes('xmlns:serif')) {
    add('info', 'svg-editor-metadata', 'Editor metadata (inkscape:/sodipodi:/sketch:) is embedded.', 'Strip it with svgo or "Save as Plain SVG".');
  }
  if (xml.length > 200_000) {
    add('warn', 'svg-heavy', `SVG is ${(xml.length / 1024).toFixed(0)} KB — likely auto-traced or over-detailed for an icon.`, 'Simplify paths (svgo, or Path ▸ Simplify) and drop fine detail that vanishes at 48px.');
  }

  // --- shapes & paths ---
  let bbox = null;
  let bboxReliable = true;
  const grow = (pts) => {
    for (const [x, y] of pts) {
      if (!bbox) bbox = { minX: x, minY: y, maxX: x, maxY: y };
      else {
        bbox.minX = Math.min(bbox.minX, x);
        bbox.minY = Math.min(bbox.minY, y);
        bbox.maxX = Math.max(bbox.maxX, x);
        bbox.maxY = Math.max(bbox.maxY, y);
      }
    }
  };
  let strokeNodes = 0;
  let transforms = 0;
  let nonPath = 0;
  let evenodd = 0;
  let arcs = 0;
  let longPaths = 0;
  let sci = 0;
  let precise = 0;
  let badColors = new Set();
  let gradientRefs = 0;
  let currentColor = 0;
  let groupOpacity = 0;
  let hidden = 0;
  let dashed = 0;
  let invisible = 0;
  const pathErrors = [];

  const drawn = all.filter((n) => SHAPES.has(n.name) && !hasAncestor(n, DEFS_LIKE));
  for (const node of drawn) {
    stat.shapes++;
    const a = node.attrs;
    const fill = attrUp(node, 'fill');
    const stroke = attrUp(node, 'stroke');
    const hasStroke = stroke !== undefined && !/^none$/i.test(stroke.trim()) && f(attrUp(node, 'stroke-width') ?? 1) > 0;
    const noFill = fill !== undefined && /^none$/i.test(fill.trim());
    if (hasStroke) strokeNodes++;
    if (noFill && !hasStroke) invisible++;
    if (/(^|\s)(none|hidden)$/.test(attrUp(node, 'display') ?? '') || /^hidden$/.test(attrUp(node, 'visibility') ?? '')) hidden++;
    if (attrUp(node, 'stroke-dasharray') && !/^none$/i.test(attrUp(node, 'stroke-dasharray'))) dashed++;
    if (a['fill-rule'] === 'evenodd' || a['clip-rule'] === 'evenodd' || attrUp(node, 'fill-rule') === 'evenodd') evenodd++;
    for (const v of [fill, stroke]) {
      if (v === undefined) continue;
      const t = v.trim();
      if (/^url\(/i.test(t)) gradientRefs++;
      else if (/^currentcolor$/i.test(t)) currentColor++;
      else if (!(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || /^(rgb|rgba|hsl|hsla)\(/i.test(t) || NAMED_OK.test(t) || /^[a-z]+$/i.test(t))) badColors.add(t);
    }
    for (let p = node; p && p.name !== 'svg'; p = p.parent) {
      if (p.name === 'g' && p.attrs.opacity !== undefined && f(p.attrs.opacity) < 1) groupOpacity++;
    }
    if (node.name !== 'path') nonPath++;

    const tr = transformUp(node);
    if (tr) {
      transforms++;
      bboxReliable = false;
    }

    if (node.name === 'path') {
      stat.paths++;
      const d = a.d || '';
      if (!d.trim()) {
        pathErrors.push('empty d attribute');
        continue;
      }
      if (d.length > 800) longPaths++;
      const { segs, errors } = parsePathData(d);
      errors.forEach((e) => pathErrors.push(e));
      stat.pathCommands += segs.length;
      if (segs.some((s) => s.cmd.toUpperCase() === 'A')) arcs++;
      if (/[eE][+-]?\d/.test(d)) sci++;
      const decs = (d.match(/\.\d+/g) || []).map((s) => s.length - 1);
      if (decs.length && decs.reduce((s, v) => s + v, 0) / decs.length > 4) precise++;
      if (!tr) grow(pathPoints(segs));
    } else if (!tr) grow(shapePoints(node));
  }

  // <use> instances draw content that lives in <defs>/<symbol>; the rendered check decides whether it is empty
  if (!drawn.length && !count.use && !alreadyExplained(findings)) {
    add('error', 'svg-empty', 'The SVG draws nothing (no <path>/<rect>/<circle>… outside <defs>).', 'Check the export — layers may be hidden or the artwork is only text/images.');
  }
  if (pathErrors.length) {
    add('error', 'svg-path-invalid', `Invalid path data (${pathErrors.length}): ${[...new Set(pathErrors)].slice(0, 3).join('; ')}. Browsers stop drawing at the first error, so the shape renders truncated or empty.`, 'Re-export or repair the path; run it through svgo (convertPathData) to normalise it.');
  }
  if (strokeNodes) {
    add('warn', 'svg-stroke', `${strokeNodes} shape(s) rely on a stroke. Stroke joins, caps and widths are re-implemented differently per renderer, and they scale unpredictably when the icon is resized.`, 'Outline strokes into filled paths (Figma: Outline stroke / Illustrator: Outline Stroke / Inkscape: Stroke to Path) so the geometry is the shape, not a rendering rule.');
  }
  if (dashed) add('warn', 'svg-dash', `${dashed} shape(s) use stroke-dasharray — dashes are not portable.`, 'Expand the dashes into real shapes.');
  if (nonPath) {
    add('info', 'svg-basic-shapes', `${nonPath} <rect>/<circle>/<ellipse>/<line>/<poly*> element(s). They render fine in browsers, but converters handle rx/ry, transforms and strokes on them inconsistently.`, 'Convert them to <path> (Figma/Inkscape: Object to Path; svgo "convertShapeToPath").');
  }
  if (transforms) {
    add('warn', 'svg-transform', `${transforms} shape(s) sit under a transform=. Nested/rotated/skewed transforms are where converters most often shift or distort art.`, 'Bake the transforms into the path coordinates (svgo convertPathData applies transforms set directly on a path; for rotated/skewed groups re-export flattened from the design tool or use Inkscape: Preferences ▸ Behavior ▸ Transforms ▸ Store transformation: optimized).');
  }
  if (gradientRefs) {
    add('warn', 'svg-gradient', `${gradientRefs} fill/stroke(s) reference a gradient or paint server. Android vectors only accept gradients in user-space coordinates, and gradientTransform often breaks.`, 'Prefer solid fills for the icon; if you need a gradient use gradientUnits="userSpaceOnUse" with absolute coordinates and no gradientTransform.');
  }
  if (currentColor) add('warn', 'svg-currentcolor', 'fill/stroke="currentColor" has no CSS context inside an app icon and resolves to black.', 'Use explicit colors.');
  if (badColors.size) add('warn', 'svg-color-format', `Unusual color value(s): ${[...badColors].slice(0, 3).join(', ')} — only hex / rgb() / hsl() / named colors are portable.`, 'Convert to sRGB hex (#RRGGBB).');
  if (groupOpacity) add('warn', 'svg-group-opacity', 'Opacity on <g> groups composites differently across renderers (VectorDrawable has no group alpha).', 'Bake the transparency into each fill (fill-opacity) or flatten the colors.');
  if (evenodd) add('info', 'svg-evenodd', `${evenodd} shape(s) use fill-rule="evenodd". Supported on Android API 24+ only; holes must be real holes either way.`, 'If you target older Android, re-draw compound shapes with opposite winding under the default nonzero rule.');
  if (arcs) add('info', 'svg-arcs', `${arcs} path(s) contain arc (A/a) commands; some older converters approximate them badly.`, 'If a curve looks off after conversion, redraw or re-export it as cubic Béziers (Figma: Outline stroke/Flatten; Inkscape: Object to Path, then Path ▸ Simplify).');
  if (sci) add('warn', 'svg-scientific-notation', `${sci} path(s) contain scientific notation (1e-5): several path parsers mis-read it and distort the shape.`, 'Re-serialise with fixed decimals (svgo convertPathData floatPrecision: 3).');
  if (precise) add('info', 'svg-precision', `${precise} path(s) carry >4 decimal places.`, 'Round to ≤3 decimals (svgo floatPrecision: 3): smaller file, no float noise, identical result at icon sizes.');
  if (longPaths) add('info', 'svg-long-path', `${longPaths} path(s) exceed 800 characters of path data (Android lint flags this as slow to render).`, 'Merge/simplify nodes (Path ▸ Simplify) or split into several paths.');
  if (hidden) add('info', 'svg-hidden', `${hidden} hidden element(s) (display:none / visibility:hidden) are still in the file; some tools export them anyway.`, 'Delete hidden layers.');
  if (invisible) add('info', 'svg-invisible', `${invisible} shape(s) have fill="none" and no stroke, so draw nothing.`, 'Delete them.');

  // --- geometry vs viewBox ---
  let bboxOut = null;
  if (bbox && bboxReliable) {
    bboxOut = bbox;
    if (viewBox) {
      const [vx, vy, vw, vh] = viewBox;
      const eps = Math.max(vw, vh) * 0.002;
      if (bbox.minX < vx - eps || bbox.minY < vy - eps || bbox.maxX > vx + vw + eps || bbox.maxY > vy + vh + eps) {
        add('warn', 'svg-outside-viewbox', 'Part of the artwork lies outside the viewBox and will be cut off.', 'Move/scale the artwork inside the artboard (and keep the safe-zone margins).');
      }
    }
  } else if (bbox && !bboxReliable) {
    findings.push({ level: 'info', id: 'svg-bbox-skipped', msg: 'Bounding box not computed statically because transforms are present; relying on the rendered check.', fix: '' });
  }

  return { findings, stats: { ...stat, count }, viewBox, bbox: bboxOut };
}

function alreadyExplained(findings) {
  return findings.some((f) => f.id === 'svg-dynamic' || f.id === 'svg-embedded-raster' || f.id === 'svg-text');
}
