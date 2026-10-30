#!/usr/bin/env node
/**
 * site-clone capture engine.
 *
 * Captures one URL into a self-describing reference bundle designed for 1:1
 * recreation in another framework. Everything it writes is either (a) an exact
 * copy of something the browser had, or (b) a delta against browser defaults —
 * never a summary that loses information.
 *
 * Usage: node scrape.mjs <url> [options]   (see --help)
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/* ------------------------------------------------------------------ args -- */

const argv = process.argv.slice(2)
const flag = n => argv.includes('--' + n)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 || i === argv.length - 1 ? d : argv[i + 1] }

if (!argv.length || flag('help') || argv[0].startsWith('-')) {
  console.log(`
site-clone capture engine

  node scrape.mjs <url> [options]

  --out <dir>        output root                       (default: reference)
  --name <slug>      bundle folder name                (default: derived from url)
  --bp 375,768,1440  breakpoints to capture            (default: 375,768,1440)
  --primary <px>     breakpoint used for deep analysis (default: widest)
  --wait <ms>        settle time after load            (default: 2500)
  --sections "a,b"   CSS selectors that force the section split
  --click "a,b"      selectors to click after load (menus, tabs, "load more")
  --max-nodes <n>    node cap per section tree         (default: 400)
  --max-depth <n>    depth cap per section tree        (default: 14)
  --max-repeat <n>   exemplars kept per repeated sibling (default: 3)
  --full-css         also dump every stylesheet verbatim to css/_all.css
  --no-assets        skip downloading images/fonts
  --headed           run with a visible browser
  --storage <file>   Playwright storageState JSON (cookies + localStorage), for
                     pages behind a login. Create it once with:
                       npx playwright open --save-storage=auth.json <url>
  --header "K: V"    extra request headers, comma-separated for several
  --timeout <ms>     navigation timeout                (default: 60000)
`)
  process.exit(argv.length && !flag('help') ? 1 : 0)
}

const TARGET = argv[0]
const OUT = path.resolve(opt('out', 'reference'), opt('name', slugFromUrl(TARGET)))
const BPS = opt('bp', '375,768,1440').split(',').map(n => parseInt(n, 10)).filter(Boolean).sort((a, b) => a - b)
const PRIMARY = parseInt(opt('primary', String(BPS[BPS.length - 1])), 10)
const WAIT = parseInt(opt('wait', '2500'), 10)
const MAX_NODES = parseInt(opt('max-nodes', '400'), 10)
const MAX_DEPTH = parseInt(opt('max-depth', '14'), 10)
const MAX_REPEAT = parseInt(opt('max-repeat', '3'), 10)
const TIMEOUT = parseInt(opt('timeout', '60000'), 10)
const FORCE_SECTIONS = (opt('sections', '') || '').split(',').map(s => s.trim()).filter(Boolean)
const CLICKS = (opt('click', '') || '').split(',').map(s => s.trim()).filter(Boolean)
const STORAGE = opt('storage', null)
const HEADERS = Object.fromEntries((opt('header', '') || '').split(',').map(h => h.trim()).filter(Boolean)
  .map(h => { const i = h.indexOf(':'); return [h.slice(0, i).trim(), h.slice(i + 1).trim()] }).filter(([k]) => k))

/* --------------------------------------------------------------- helpers -- */

function slugFromUrl (u) {
  try {
    const url = new URL(u)
    const p = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || 'home'
    return (url.hostname.replace(/^www\./, '').split('.')[0] + '-' + p).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  } catch { return 'capture' }
}
const slug = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
const pad = n => String(n).padStart(2, '0')
const hash8 = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)
const mk = d => fs.mkdirSync(d, { recursive: true })
const wJSON = (f, o) => { mk(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(o, null, 2)) }
const wTXT = (f, s) => { mk(path.dirname(f)); fs.writeFileSync(f, s) }
const log = (...a) => console.log('  ·', ...a)

// Third-party noise that never belongs in a design reference.
const JUNK_HOST = /(doubleclick|googletagmanager|google-analytics|googleadservices|googlesyndication|gstatic\.com\/(ads|pagead)|facebook\.(com|net)|fbcdn|hotjar|clarity\.ms|segment\.(io|com)|amplitude|mixpanel|criteo|taboola|outbrain|adsrvr|adnxs|adsct|adservice|demdex|everesttech|tribalfusion|agkn\.com|scorecardresearch|quantserve|bing\.com\/c\.gif|analytics\.twitter|linkedin\.com\/(px|li)|tiktok|snapchat|pinterest\.com\/ct|onetrust|cookielaw|newrelic|nr-data|datadoghq|sentry\.io|browser-intake|hs-analytics|hubspot|intercom|zendesk|livechat|trustpilot\.com\/.*pixel)/i

const EXT_BY_TYPE = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
  'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf',
  'application/font-woff2': '.woff2', 'application/font-woff': '.woff', 'application/x-font-ttf': '.ttf',
  'application/vnd.ms-fontobject': '.eot', 'text/css': '.css'
}

function fileNameFor (url, contentType) {
  let base = 'asset'
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'asset')
  } catch {}
  let ext = path.extname(base)
  const known = EXT_BY_TYPE[(contentType || '').split(';')[0].trim()]
  if (known && ext.toLowerCase() !== known) ext = known
  const stem = (ext ? base.slice(0, base.length - path.extname(base).length) : base).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'asset'
  return `${stem}.${hash8(url)}${ext || '.bin'}`
}

/* ------------------------------------------------------- browser-side lib -- */
/* Injected after every load; exposes window.__sc.* to the small evaluates below. */

const LIB = String.raw`
window.__sc = (function () {
  var PROPS = [
    'display','position','zIndex','float','clear','visibility','pointerEvents','cursor','isolation',
    'boxSizing','minWidth','maxWidth','minHeight','maxHeight','aspectRatio',
    'marginTop','marginRight','marginBottom','marginLeft',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'flexDirection','flexWrap','justifyContent','alignItems','alignContent','alignSelf',
    'flexGrow','flexShrink','flexBasis','order','gap','rowGap','columnGap',
    'gridTemplateColumns','gridTemplateRows','gridTemplateAreas','gridAutoFlow','gridAutoRows','gridAutoColumns',
    'gridColumn','gridRow','placeItems','placeContent',
    'fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing',
    'textAlign','textTransform','textDecorationLine','textDecorationColor','textOverflow','whiteSpace',
    'wordBreak','overflowWrap','verticalAlign','listStyleType','webkitLineClamp',
    'color','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat',
    'backgroundClip','mixBlendMode','backdropFilter','filter','opacity',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle',
    'borderTopColor','borderRightColor','borderBottomColor','borderLeftColor',
    'borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius',
    'boxShadow','textShadow','outline','outlineOffset',
    'overflow','overflowX','overflowY','objectFit','objectPosition',
    'transform','transformOrigin','transition','animation','willChange','columnCount','columnGap'
  ];
  var SKIP_TAGS = { SCRIPT:1, STYLE:1, NOSCRIPT:1, TEMPLATE:1, LINK:1, META:1, BR:1, HEAD:1 };
  var frame, fdoc, defaults = {};

  function defaultsFor (tag) {
    if (defaults[tag]) return defaults[tag];
    if (!frame) {
      frame = document.createElement('iframe');
      frame.setAttribute('data-sc-probe', '');
      frame.style.cssText = 'position:absolute;left:-99999px;top:0;width:1200px;height:800px;border:0;visibility:hidden';
      document.body.appendChild(frame);
      fdoc = frame.contentDocument;
    }
    var el;
    try { el = fdoc.createElement(tag) } catch (e) { el = fdoc.createElement('div') }
    fdoc.body.appendChild(el);
    var cs = fdoc.defaultView.getComputedStyle(el), o = {};
    for (var i = 0; i < PROPS.length; i++) o[PROPS[i]] = cs[PROPS[i]];
    el.remove();
    return (defaults[tag] = o);
  }

  // Web components put their real markup in a shadow root. Walk through it or the
  // capture comes back empty for the whole component.
  function kidsOf (el) {
    var out = [], i;
    if (el.shadowRoot) for (i = 0; i < el.shadowRoot.children.length; i++) out.push(el.shadowRoot.children[i]);
    for (i = 0; i < el.children.length; i++) out.push(el.children[i]);
    return out;
  }

  function visible (el) {
    if (!el || el.nodeType !== 1 || SKIP_TAGS[el.tagName]) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) || el.tagName === 'BR';
  }

  function ownText (el) {
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) out += n.nodeValue;
    return out.replace(/\s+/g, ' ').trim().slice(0, 2000);
  }

  function attrs (el) {
    var keep = {}, n = 0;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i], k = a.name;
      if (k === 'class' || k === 'style') continue;
      if (/^(id|href|src|alt|title|type|name|value|placeholder|role|target|rel|loading|width|height)$/.test(k) ||
          k.indexOf('aria-') === 0 || k.indexOf('data-') === 0) {
        if (k.indexOf('data-') === 0 && ++n > 10) continue;
        keep[k] = (a.value || '').slice(0, 300);
      }
    }
    return keep;
  }

  var INHERITED = {
    color:1, fontFamily:1, fontSize:1, fontWeight:1, fontStyle:1, lineHeight:1, letterSpacing:1,
    wordSpacing:1, textAlign:1, textTransform:1, whiteSpace:1, wordBreak:1, overflowWrap:1,
    listStyleType:1, cursor:1, visibility:1, webkitLineClamp:1
  };

  // Keep only what differs from the UA default for this tag, and — for inherited
  // properties — from what the parent already established. Inheritance is how the
  // original was authored, so re-listing it on every child is pure noise.
  var REPLACED = { IMG:1, VIDEO:1, CANVAS:1, IFRAME:1, OBJECT:1, EMBED:1, SVG:1, INPUT:1 };

  // A property is only worth recording when it can affect this element. A border
  // colour with no border, grid tracks on a flex box, transform-origin with no
  // transform: all of it is resolved-value noise that hides the real design.
  function relevant (p, cs, el, parentCs) {
    switch (p) {
      case 'borderTopColor': case 'borderTopStyle': return cs.borderTopWidth !== '0px'
      case 'borderRightColor': case 'borderRightStyle': return cs.borderRightWidth !== '0px'
      case 'borderBottomColor': case 'borderBottomStyle': return cs.borderBottomWidth !== '0px'
      case 'borderLeftColor': case 'borderLeftStyle': return cs.borderLeftWidth !== '0px'
      case 'outline': case 'outlineOffset': return !!cs.outline && cs.outline.indexOf('none') === -1
      case 'textDecorationColor': return cs.textDecorationLine !== 'none'
      case 'backgroundSize': case 'backgroundPosition': case 'backgroundRepeat': case 'backgroundClip':
        return cs.backgroundImage !== 'none'
      case 'transformOrigin': return cs.transform !== 'none'
      case 'objectFit': case 'objectPosition': return !!REPLACED[el.tagName]
      case 'gridTemplateColumns': case 'gridTemplateRows': case 'gridTemplateAreas':
      case 'gridAutoFlow': case 'gridAutoRows': case 'gridAutoColumns': case 'placeItems': case 'placeContent':
        return cs.display.indexOf('grid') !== -1
      case 'flexDirection': case 'flexWrap': case 'justifyContent': case 'alignItems': case 'alignContent':
      case 'gap': case 'rowGap': case 'columnGap':
        return /flex|grid/.test(cs.display)
      case 'flexGrow': case 'flexShrink': case 'flexBasis': case 'alignSelf': case 'order':
      case 'gridColumn': case 'gridRow':
        return !!parentCs && /flex|grid/.test(parentCs.display)
      case 'columnCount': return cs.columnCount !== 'auto'
      case 'aspectRatio': return cs.aspectRatio !== 'auto'
      case 'webkitLineClamp': return cs.webkitLineClamp !== 'none'
      case 'zIndex': return cs.position !== 'static'
      default: return true
    }
  }

  function styleDelta (el, cs, parentCs) {
    var def = defaultsFor(el.tagName.toLowerCase()), out = {};
    for (var i = 0; i < PROPS.length; i++) {
      var p = PROPS[i], v = cs[p];
      if (v == null || v === '') continue;
      if (!relevant(p, cs, el, parentCs)) continue;
      if (INHERITED[p] && parentCs) { if (v !== parentCs[p]) out[p] = v; continue }
      if (v === def[p]) continue;
      if (p === 'transition' && v === 'all') continue;
      out[p] = v;
    }
    return out;
  }

  function node (el, origin, depth, budget, parentCs) {
    if (budget.n >= budget.max) return null;
    budget.n++;
    var cs = getComputedStyle(el), r = el.getBoundingClientRect();
    var o = {
      tag: el.tagName.toLowerCase(),
      cls: el.getAttribute('class') || undefined,
      box: [Math.round(r.x - origin.x), Math.round(r.y - origin.y), Math.round(r.width), Math.round(r.height)],
      styles: styleDelta(el, cs, parentCs)
    };
    var a = attrs(el); if (Object.keys(a).length) o.attrs = a;
    var inline = el.getAttribute('style'); if (inline) o.inlineStyle = inline;
    var t = ownText(el); if (t) o.text = t;
    if (el.tagName === 'IMG') { o.img = { src: el.currentSrc || el.src, alt: el.alt || '', natural: [el.naturalWidth, el.naturalHeight] } }
    if (el.tagName === 'SVG' || el.tagName === 'svg') { o.svg = el.outerHTML.slice(0, 4000) }
    if (el.tagName === 'VIDEO') { o.video = { src: el.currentSrc || el.src, autoplay: el.autoplay, loop: el.loop, muted: el.muted, poster: el.poster } }
    if (cs.backgroundImage && cs.backgroundImage !== 'none') o.bgImage = cs.backgroundImage;
    if (el.scrollWidth > el.clientWidth + 4 && /auto|scroll/.test(cs.overflowX)) o.scrollsX = true;
    if (el.shadowRoot) o.shadow = true;
    if (depth < budget.depth && el.tagName !== 'SVG') {
      var all = kidsOf(el), vis = [];
      for (var i = 0; i < all.length; i++) if (visible(all[i])) vis.push(all[i]);
      // A grid of 60 product cards is one component repeated 60 times. Keep a few
      // exemplars and record the count: the repetition is the fact worth capturing.
      var sig = function (e) { return e.tagName + '|' + (e.getAttribute('class') || '') };
      var totals = {}, taken = {};
      for (var j = 0; j < vis.length; j++) { var k = sig(vis[j]); totals[k] = (totals[k] || 0) + 1 }
      var kids = [];
      for (var m = 0; m < vis.length; m++) {
        var key = sig(vis[m]);
        taken[key] = (taken[key] || 0) + 1;
        if (totals[key] > budget.repeat && taken[key] > budget.repeat) continue;
        var c = node(vis[m], origin, depth + 1, budget, cs);
        if (!c) continue;
        if (totals[key] > budget.repeat && taken[key] === 1) c.repeats = totals[key];
        kids.push(c);
      }
      if (kids.length) o.children = kids;
      else if (!o.text && el.textContent && el.textContent.trim() && !o.img && !o.svg) o.text = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 2000);
    }
    return o;
  }

  function headingOf (el) {
    var h = el.querySelector('h1,h2,h3,[role="heading"]');
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  }

  return {
    PROPS: PROPS,
    visible: visible,

    /* What this page contains that a static capture handles badly. */
    census: function () {
      var hosts = 0, frames = [];
      document.querySelectorAll('*').forEach(function (e) { if (e.shadowRoot) hosts++ });
      document.querySelectorAll('iframe:not([data-sc-probe])').forEach(function (f) {
        var r = f.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) return;
        var same = false;
        try { same = !!f.contentDocument } catch (e) {}
        frames.push({ src: f.src || '(srcdoc)', size: [Math.round(r.width), Math.round(r.height)], sameOrigin: same });
      });
      return {
        shadowHosts: hosts,
        iframes: frames,
        canvases: document.querySelectorAll('canvas').length,
        openDialogs: document.querySelectorAll('dialog[open],[aria-modal="true"]').length
      };
    },

    /* Split the page into top-level blocks and tag them with data-sc-section. */
    sections: function (forced) {
      document.querySelectorAll('[data-sc-section]').forEach(function (e) { e.removeAttribute('data-sc-section') });
      var vw = innerWidth, list;
      if (forced && forced.length) {
        list = [];
        forced.forEach(function (sel) { try { document.querySelectorAll(sel).forEach(function (e) { list.push(e) }) } catch (e) {} });
      } else {
        var docH = document.documentElement.scrollHeight;
        var take = function (el) {
          return kidsOf(el).filter(function (c) {
            if (!visible(c)) return false;
            var r = c.getBoundingClientRect();
            return r.height >= 40 && r.width >= vw * 0.35;
          });
        };
        // Walk through pass-through wrappers (single significant child) until the
        // first element that genuinely splits into siblings.
        var unwrap = function (el, d) {
          var kids = take(el);
          if (kids.length === 1 && d < 12) return unwrap(kids[0], d + 1);
          return kids.length ? kids : [el];
        };
        list = unwrap(document.body, 0);
        // Any block still taller than ~half the page is a container, not a section.
        for (var round = 0; round < 5; round++) {
          var next = [], changed = false;
          list.forEach(function (el) {
            if (el.getBoundingClientRect().height > docH * 0.45) {
              var sub = unwrap(el, 0);
              if (sub.length > 1) { next = next.concat(sub); changed = true; return }
            }
            next.push(el);
          });
          list = next;
          if (!changed) break;
        }
        var seenEl = [];
        list = list.filter(function (el) { if (seenEl.indexOf(el) !== -1) return false; seenEl.push(el); return true });
        // Absolutely-positioned overlays (arrows, dots, badges) are DOM siblings but
        // visually live inside another candidate — they are not sections.
        var pool = list.slice();
        list = list.filter(function (el) {
          var r = el.getBoundingClientRect();
          return !pool.some(function (o) {
            if (o === el) return false;
            var q = o.getBoundingClientRect();
            return q.width * q.height > r.width * r.height &&
              r.top >= q.top - 2 && r.bottom <= q.bottom + 2 && r.left >= q.left - 2 && r.right <= q.right + 2;
          });
        });
        list.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top });
      }
      var out = [];
      list.forEach(function (el, i) {
        var r = el.getBoundingClientRect();
        el.setAttribute('data-sc-section', String(i));
        out.push({
          index: i,
          tag: el.tagName.toLowerCase(),
          classes: el.getAttribute('class') || '',
          id: el.id || '',
          heading: headingOf(el),
          y: Math.round(r.y + scrollY),
          height: Math.round(r.height),
          sticky: /fixed|sticky/.test(getComputedStyle(el).position) ? getComputedStyle(el).position : undefined
        });
      });
      return out;
    },

    /* Full element tree for one tagged section. */
    tree: function (index, maxNodes, maxDepth, repeat) {
      var el = document.querySelector('[data-sc-section="' + index + '"]');
      if (!el) return null;
      var r = el.getBoundingClientRect(), budget = { n: 0, max: maxNodes, depth: maxDepth, repeat: repeat || 3 };
      var t = node(el, { x: r.x, y: r.y }, 0, budget, el.parentElement ? getComputedStyle(el.parentElement) : null);
      t.truncated = budget.n >= maxNodes;
      t.nodeCount = budget.n;
      return t;
    }
  };
})();
`

/* ------------------------------------------------------------- analyses -- */

/** CSS custom properties + font-face rules + the styleguide sample. */
const collectDesign = () => {
  const vars = {}
  const read = el => {
    const cs = getComputedStyle(el)
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i]
      if (p.startsWith('--')) { const v = cs.getPropertyValue(p).trim(); if (v && !(p in vars)) vars[p] = v }
    }
  }
  read(document.documentElement); read(document.body)
  document.querySelectorAll('[class*="theme"],[data-theme],header,footer,main').forEach(read)

  const sample = [...document.querySelectorAll('body *')].filter(el => window.__sc.visible(el)).slice(0, 4000)
  const tally = {}
  const bump = (k, v) => { if (!v) return; (tally[k] = tally[k] || {}); tally[k][v] = (tally[k][v] || 0) + 1 }
  const byTag = {}
  const fontUse = {}
  for (const el of sample) {
    const cs = getComputedStyle(el)
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())
    if (hasText) {
      bump('fontFamily', cs.fontFamily); bump('fontSize', cs.fontSize); bump('fontWeight', cs.fontWeight)
      bump('lineHeight', cs.lineHeight); bump('color', cs.color); bump('letterSpacing', cs.letterSpacing)
      const t = el.tagName.toLowerCase()
      if (!byTag[t]) byTag[t] = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color, textTransform: cs.textTransform }
      const f = cs.fontFamily
      fontUse[f] = fontUse[f] || { family: f, count: 0, sizes: {}, weights: {} }
      fontUse[f].count++
      fontUse[f].sizes[cs.fontSize] = (fontUse[f].sizes[cs.fontSize] || 0) + 1
      fontUse[f].weights[cs.fontWeight] = (fontUse[f].weights[cs.fontWeight] || 0) + 1
    }
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bump('backgroundColor', cs.backgroundColor)
    if (cs.borderTopWidth !== '0px' || cs.borderLeftWidth !== '0px') bump('borderColor', cs.borderTopColor)
    if (cs.borderTopLeftRadius !== '0px') bump('borderRadius', cs.borderTopLeftRadius)
    if (cs.boxShadow !== 'none') bump('boxShadow', cs.boxShadow)
    if (cs.gap && cs.gap !== 'normal') bump('gap', cs.gap)
    if (cs.maxWidth !== 'none') bump('maxWidth', cs.maxWidth)
    if (/flex|grid/.test(cs.display)) {
      bump('paddingBlock', cs.paddingTop + ' / ' + cs.paddingBottom)
      bump('paddingInline', cs.paddingLeft + ' / ' + cs.paddingRight)
    }
  }
  const sortTally = o => Object.fromEntries(Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, 24))
  const out = {}
  for (const k of Object.keys(tally)) out[k] = sortTally(tally[k])
  return {
    cssVariables: vars,
    sampled: sample.length,
    typographyByTag: byTag,
    frequencies: out,
    fontUsage: Object.values(fontUse).sort((a, b) => b.count - a.count).slice(0, 12)
  }
}

/** Human copy + links + alts, in document order. */
const collectOutline = () => {
  const out = []
  const walk = el => {
    for (const c of el.children) {
      if (!window.__sc.visible(c)) continue
      const t = c.tagName.toLowerCase()
      const own = [...c.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim()
      const sec = c.closest('[data-sc-section]')
      const s = sec ? Number(sec.getAttribute('data-sc-section')) : null
      if (/^h[1-6]$/.test(t)) out.push({ section: s, type: t, text: c.textContent.replace(/\s+/g, ' ').trim() })
      else if (t === 'img') out.push({ section: s, type: 'img', alt: c.alt || '', src: c.currentSrc || c.src })
      else if (t === 'a' && c.textContent.trim()) out.push({ section: s, type: 'link', text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 200), href: c.href })
      else if (t === 'button' && c.textContent.trim()) out.push({ section: s, type: 'button', text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) })
      else if ((t === 'input' || t === 'textarea' || t === 'select')) out.push({ section: s, type: t, inputType: c.type || '', placeholder: c.placeholder || '', label: (c.labels && c.labels[0] ? c.labels[0].textContent.trim() : '') })
      else if (own && /^(p|li|span|strong|em|small|label|dd|dt|figcaption|blockquote|td|th)$/.test(t)) out.push({ section: s, type: t, text: own })
      walk(c)
    }
  }
  walk(document.body)
  return out
}

/** Interaction surface: what the recreation has to *behave* like, not just look like. */
const collectBehaviors = () => {
  const seen = new Set()
  const sel = el => {
    const sec = el.closest('[data-sc-section]')
    return (sec ? 'section#' + sec.getAttribute('data-sc-section') + ' ' : '') +
      el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '')
  }
  const push = (arr, el, extra) => { const s = sel(el); const k = arr.name + s; if (seen.has(k)) return; seen.add(k); arr.push(Object.assign({ selector: s, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) }, extra)) }
  const pinned = []; pinned.name = 'p'
  const scrollers = []; scrollers.name = 's'
  const disclosure = []; disclosure.name = 'd'
  const overlays = []; overlays.name = 'o'
  const animated = []; animated.name = 'a'
  const forms = []; forms.name = 'f'

  for (const el of document.querySelectorAll('body *')) {
    if (!window.__sc.visible(el)) continue
    const cs = getComputedStyle(el)
    if (/fixed|sticky/.test(cs.position) && el.getBoundingClientRect().height > 20) push(pinned, el, { position: cs.position, top: cs.top, bottom: cs.bottom, zIndex: cs.zIndex })
    if (el.scrollWidth > el.clientWidth + 8 && /auto|scroll/.test(cs.overflowX) && el.children.length > 1) push(scrollers, el, { axis: 'x', items: el.children.length, snap: cs.scrollSnapType })
    if (el.hasAttribute('aria-expanded') || el.tagName === 'DETAILS' || el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'tablist') push(disclosure, el, { kind: el.tagName === 'DETAILS' ? 'details' : (el.getAttribute('role') || 'aria-expanded'), expanded: el.getAttribute('aria-expanded') })
    if (el.getAttribute('role') === 'dialog' || el.hasAttribute('aria-modal') || el.tagName === 'DIALOG') push(overlays, el, { hidden: cs.display === 'none' })
    if ((cs.transition && cs.transition !== 'all 0s ease 0s' && cs.transition !== 'none') || (cs.animation && cs.animation !== 'none 0s ease 0s 1 normal none running')) push(animated, el, { transition: cs.transition, animation: cs.animation })
    if (el.tagName === 'FORM') push(forms, el, { action: el.action, method: el.method, fields: el.querySelectorAll('input,select,textarea').length })
  }
  const libs = ['Swiper', 'Glide', 'Splide', 'keenSlider', 'KeenSlider', 'Flickity', 'jQuery', 'Alpine', 'gsap', 'ScrollTrigger', 'lottie', 'AOS', 'Vue', 'React', '__NEXT_DATA__', '__NUXT__']
    .filter(k => k in window)
  return {
    pinned: pinned.slice(0, 20),
    horizontalScrollers: scrollers.slice(0, 20),
    disclosure: disclosure.slice(0, 40),
    overlays: overlays.slice(0, 20),
    animated: animated.slice(0, 40),
    forms: forms.slice(0, 20),
    globals: libs,
    autoplayMedia: [...document.querySelectorAll('video[autoplay],video[loop]')].map(v => ({ src: v.currentSrc || v.src, loop: v.loop, muted: v.muted }))
  }
}

/** Inline SVGs, de-duplicated — icon systems are always inline. */
const collectSvgs = () => {
  const map = new Map()
  for (const s of document.querySelectorAll('svg')) {
    const markup = s.outerHTML
    if (markup.length > 20000) continue
    const key = markup.replace(/\s+id="[^"]*"/g, '').replace(/\s+/g, ' ')
    const sec = s.closest('[data-sc-section]')
    if (map.has(key)) { map.get(key).uses++; continue }
    map.set(key, {
      uses: 1,
      name: s.getAttribute('aria-label') || s.querySelector('title')?.textContent?.trim() || (s.closest('[class]')?.className || '').toString().split(/\s+/)[0] || 'icon',
      section: sec ? Number(sec.getAttribute('data-sc-section')) : null,
      viewBox: s.getAttribute('viewBox') || '',
      size: [Math.round(s.getBoundingClientRect().width), Math.round(s.getBoundingClientRect().height)],
      markup
    })
  }
  return [...map.values()].sort((a, b) => b.uses - a.uses).slice(0, 200)
}

/**
 * Keep only the CSS rules that actually match this page — the single biggest
 * lever on "recreatable 1:1". Runs against detached stylesheets so it never
 * mutates the live page.
 */
const analyzeCss = texts => {
  const kept = []; const states = []; const fontFaces = []; const keyframes = {}; const needed = new Set()
  const STATE = /:(hover|focus|focus-visible|focus-within|active|disabled|checked|placeholder-shown|target|open)\b/
  const base = s => s.replace(/::?[a-zA-Z-]+(\([^()]*(\([^()]*\))?[^()]*\))?/g, m => (/^::?(before|after|first-line|first-letter|placeholder|marker|selection|backdrop|-\w)/.test(m) ? '' : m)).replace(/\s+/g, ' ').trim()
  const strip = s => s.replace(/::?[a-zA-Z-]+(\([^()]*(\([^()]*\))?[^()]*\))?/g, '').replace(/\s{2,}/g, ' ').replace(/\s*([>+~])\s*/g, ' $1 ').trim()
  const matches = s => { if (!s || s === '*') return true; try { return !!document.querySelector(s) } catch { return false } }
  const walk = (rules, stack) => {
    for (const rule of rules) {
      const kind = rule.constructor.name
      if (kind === 'CSSStyleRule') {
        const sels = (rule.selectorText || '').split(',').map(s => s.trim()).filter(Boolean)
        const hit = sels.filter(s => matches(strip(base(s)) || strip(s)))
        if (!hit.length) continue
        kept.push({ media: stack.join(' and '), selector: hit.join(', '), body: rule.style.cssText })
        const an = rule.style.getPropertyValue('animation-name') || rule.style.getPropertyValue('animation')
        if (an) an.split(/[,\s]+/).forEach(n => n && needed.add(n))
        for (const s of hit) if (STATE.test(s)) states.push({ media: stack.join(' and '), selector: s, body: rule.style.cssText })
      } else if (kind === 'CSSFontFaceRule') {
        fontFaces.push(rule.cssText)
      } else if (kind === 'CSSKeyframesRule') {
        keyframes[rule.name] = rule.cssText
      } else if (rule.cssRules) {
        const cond = rule.conditionText ? (kind === 'CSSMediaRule' ? '@media ' + rule.conditionText : '@supports ' + rule.conditionText) : String(rule.cssText || '').split('{')[0].trim()
        walk(rule.cssRules, cond ? [...stack, cond] : stack)
      }
    }
  }
  // Shadow roots carry their own scoped stylesheets, which never match against
  // `document` — collect them separately so component styles are not simply lost.
  const shadow = []
  const hosts = []
  ;(function findHosts (root) {
    root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) { hosts.push(el); findHosts(el.shadowRoot) } })
  })(document)
  for (const host of hosts) {
    const root = host.shadowRoot
    const label = host.tagName.toLowerCase() + (host.id ? '#' + host.id : '')
    const rules = []
    const collect = list => {
      for (const rule of list) {
        if (rule.constructor.name === 'CSSStyleRule') {
          const sels = (rule.selectorText || '').split(',').map(x => x.trim()).filter(Boolean)
          const hit = sels.filter(x => {
            if (/^:host/.test(x) || x === '*' || /::slotted/.test(x)) return true
            try { return !!root.querySelector(strip(base(x)) || x) } catch { return false }
          })
          if (hit.length) rules.push(`${hit.join(', ')} { ${rule.style.cssText} }`)
        } else if (rule.cssRules) collect(rule.cssRules)
      }
    }
    for (const sh of (root.adoptedStyleSheets || [])) { try { collect(sh.cssRules) } catch {} }
    root.querySelectorAll('style').forEach(st => { try { if (st.sheet) collect(st.sheet.cssRules) } catch {} })
    if (rules.length) shadow.push({ host: label, rules })
  }

  const byHref = new Map(texts.map(t => [t.href, t.text]))
  let parsed = 0, total = 0, failed = []
  const seen = new Set()
  const fromText = (href, text) => {
    const sh = new CSSStyleSheet()
    sh.replaceSync(String(text).replace(/@import[^;]+;/g, ''))
    walk(sh.cssRules, [])
  }
  for (const sheet of document.styleSheets) {
    total++
    const href = sheet.href || null
    try {
      const rules = sheet.cssRules            // throws for cross-origin
      walk(rules, [])
      parsed++
      if (href) seen.add(href)
    } catch {
      if (href && byHref.has(href)) {
        try { fromText(href, byHref.get(href)); parsed++; seen.add(href) } catch { failed.push(href) }
      } else failed.push(href || 'inline (opaque)')
    }
  }
  // Stylesheets that were fetched but never attached (preloaded, media-gated).
  for (const t of texts) {
    if (!t.href || seen.has(t.href) || t.href.startsWith('inline')) continue
    total++
    try { fromText(t.href, t.text); parsed++ } catch { failed.push(t.href) }
  }
  return { kept, states, shadow, fontFaces, keyframes: Object.fromEntries(Object.entries(keyframes).filter(([n]) => needed.has(n))), parsed, total, failed }
}

/** Every asset URL the rendered page actually points at, at this breakpoint. */
const DOM_REFS = () => {
  const set = new Set()
  const add = u => { if (u && !u.startsWith('data:')) { try { set.add(new URL(u, location.href).href) } catch {} } }
  document.querySelectorAll('img').forEach(i => { add(i.currentSrc); add(i.src); (i.srcset || '').split(',').forEach(p => add(p.trim().split(/\s+/)[0])) })
  document.querySelectorAll('source[srcset]').forEach(s => (s.srcset || '').split(',').forEach(p => add(p.trim().split(/\s+/)[0])))
  document.querySelectorAll('video,audio,source[src]').forEach(v => { add(v.currentSrc); add(v.src); add(v.poster) })
  document.querySelectorAll('link[rel*="icon"],link[rel="apple-touch-icon"]').forEach(l => add(l.href))
  document.querySelectorAll('body *').forEach(el => {
    const bg = getComputedStyle(el).backgroundImage
    if (bg && bg !== 'none') (bg.match(/url\((['"]?)(.*?)\1\)/g) || []).forEach(m => add(m.replace(/url\((['"]?)(.*?)\1\)/, '$2')))
  })
  return [...set]
}

/** Offline-renderable DOM: absolute asset URLs, no scripts, no stylesheets. */
const cleanSnapshot = () => {
  // Form *state* lives in properties, not attributes, so cloneNode loses it — and
  // checkbox-driven drawers/modals (DaisyUI et al.) spring open in the static copy.
  for (const el of document.querySelectorAll('input,select,textarea')) {
    if (el.type === 'checkbox' || el.type === 'radio') el.toggleAttribute('checked', el.checked)
    else if (el.tagName === 'SELECT') [...el.options].forEach(o => o.toggleAttribute('selected', o.selected))
    else if (el.tagName === 'TEXTAREA') el.textContent = el.value
    else if (el.value) el.setAttribute('value', el.value)
  }
  const doc = document.documentElement.cloneNode(true)
  // Anything JS had hidden outright stays hidden; visibility/opacity are left alone
  // because lazy-load and scroll-reveal use them for content that is really there.
  const liveAll = document.documentElement.querySelectorAll('*')
  const cloneAll = doc.querySelectorAll('*')
  if (liveAll.length === cloneAll.length) {
    for (let i = 0; i < liveAll.length; i++) {
      if (getComputedStyle(liveAll[i]).display === 'none') cloneAll[i].style.setProperty('display', 'none', 'important')
    }
  }
  doc.querySelectorAll('script,noscript,template,link[rel="stylesheet"],link[rel="preload"],style,iframe').forEach(n => n.remove())
  doc.querySelectorAll('[data-sc-probe]').forEach(n => n.remove())
  const live = [...document.querySelectorAll('img')]
  ;[...doc.querySelectorAll('img')].forEach((img, i) => {
    const src = live[i] ? (live[i].currentSrc || live[i].src) : img.getAttribute('src')
    if (src) img.setAttribute('src', src)
    img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.removeAttribute('loading')
  })
  doc.querySelectorAll('picture source').forEach(n => n.remove())
  const liveA = [...document.querySelectorAll('a[href]')]
  ;[...doc.querySelectorAll('a[href]')].forEach((a, i) => { if (liveA[i]) a.setAttribute('href', liveA[i].href) })
  const head = doc.querySelector('head')
  if (head) {
    // Sites with a Trusted Types CSP reject innerHTML/insertAdjacentHTML outright.
    const link = document.createElement('link')
    link.setAttribute('rel', 'stylesheet')
    link.setAttribute('href', 'css/used.css')
    head.appendChild(link)
  }
  return '<!doctype html>\n' + doc.outerHTML
}

/* ------------------------------------------------------------------ main -- */

const CONSENT = [
  '#onetrust-accept-btn-handler', '#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler',
  '[id*="accept-all" i]', '[class*="accept-all" i]', '[aria-label*="accept" i]',
  'button[id*="cookie" i][id*="accept" i]', 'button[class*="cookie" i][class*="accept" i]',
  '#didomi-notice-agree-button', '.cc-allow', '.cookie-accept', '[data-testid*="accept" i]'
]

async function settle (page) {
  let dismissed = false
  for (const sel of CONSENT) {
    try {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 250 })) { await el.click({ timeout: 1500 }); dismissed = true; break }
    } catch {}
  }
  if (!dismissed) {
    // Fall back to the button label — most consent walls are not OneTrust.
    try {
      const btn = page.getByRole('button', { name: /^(accept|accept all|allow all|agree|i agree|got it|ok|aceitar|aceitar todos|concordo|entendi|akzeptieren|aceptar)$/i }).first()
      if (await btn.isVisible({ timeout: 500 })) { await btn.click({ timeout: 1500 }); dismissed = true }
    } catch {}
  }
  if (dismissed) await page.waitForTimeout(600)
  for (const sel of CLICKS) {
    try { await page.locator(sel).first().click({ timeout: 3000 }); await page.waitForTimeout(600) } catch { log('click failed:', sel) }
  }
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.8)
    for (let y = 0; y < document.body.scrollHeight; y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, 220)) }
    scrollTo(0, 0)
    await new Promise(r => setTimeout(r, 400))
  })
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}
  await page.waitForTimeout(WAIT)
}

async function loadChromium () {
  for (const spec of ['playwright', 'playwright-core']) {
    try { return (await import(spec)).chromium } catch {}
  }
  console.error(`\nPlaywright is not installed for this skill. Run once:\n\n  cd ${import.meta.dirname} && npm install\n`)
  process.exit(1)
}

async function main () {
  console.log(`\nsite-clone → ${TARGET}\n         → ${OUT}\n`)
  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: !flag('headed') })
  const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
  const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

  /** url -> { type, status, contentType, size, body } */
  const responses = new Map()
  const network = []
  const onResponse = async res => {
    const url = res.url()
    if (url.startsWith('data:')) return
    const req = res.request()
    const type = req.resourceType()
    const ct = (res.headers()['content-type'] || '').split(';')[0]
    const rec = { url, type, status: res.status(), contentType: ct }
    network.push(rec)
    if (responses.has(url)) return
    if (!/stylesheet|font|image|media/.test(type) && ct !== 'text/css') return
    try {
      const buf = await res.body()
      if (buf.length > 12 * 1024 * 1024) return
      rec.size = buf.length
      responses.set(url, { type, contentType: ct, body: buf })
    } catch {}
  }

  // A phone is not a narrow desktop: below 700px emulate touch and a mobile UA, or
  // sites serve the desktop layout and the capture is worthless for a mobile rebuild.
  const contexts = []
  const makeContext = async bp => {
    const mobile = bp < 700
    const ctx = await browser.newContext({
      viewport: { width: bp, height: mobile ? 812 : 900 },
      deviceScaleFactor: 1,
      isMobile: mobile,
      hasTouch: mobile,
      userAgent: mobile ? UA_MOBILE : UA_DESKTOP,
      ignoreHTTPSErrors: true,
      ...(STORAGE ? { storageState: STORAGE } : {}),
      ...(Object.keys(HEADERS).length ? { extraHTTPHeaders: HEADERS } : {})
    })
    await ctx.addInitScript({ content: LIB })
    ctx.on('response', onResponse)
    contexts.push(ctx)
    return ctx
  }

  // Every phase is independent. A page that defeats one of them (Trusted Types, an
  // exotic CSP, a hostile CSSOM) must still yield everything else.
  const phaseErrors = []
  const safe = async (label, fn, fallback) => {
    try { return await fn() } catch (e) {
      phaseErrors.push(`${label} failed: ${e.message.split('\n')[0]}`)
      console.error(`  ! ${label} failed — continuing without it: ${e.message.split('\n')[0]}`)
      return fallback
    }
  }

  const perBp = {}
  const domRefs = new Set()
  let primaryPage = null

  for (const bp of BPS) {
    log(`breakpoint ${bp}px`)
    const ctx = await makeContext(bp)
    const page = await ctx.newPage()
    try {
      await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
    } catch (e) { console.error('   navigation:', e.message) }
    await settle(page)

    const sections = await safe(`section split @${bp}`, () => page.evaluate(f => window.__sc.sections(f), FORCE_SECTIONS), [])
    log(`  ${sections.length} sections`)

    const trees = []
    for (const s of sections) {
      const t = await safe(`tree ${s.index} @${bp}`, () => page.evaluate(([i, mn, md, rp]) => window.__sc.tree(i, mn, md, rp), [s.index, MAX_NODES, MAX_DEPTH, MAX_REPEAT]), null)
      if (t) trees.push({ meta: s, tree: t })
    }

    mk(path.join(OUT, 'screenshots'))
    try { await page.screenshot({ path: path.join(OUT, 'screenshots', `${bp}-fullpage.png`), fullPage: true }) } catch (e) { log('  fullpage shot failed:', e.message) }
    try { await page.screenshot({ path: path.join(OUT, 'screenshots', `${bp}-viewport.png`) }) } catch {}

    mk(path.join(OUT, 'screenshots', 'sections'))
    for (const s of sections) {
      const name = `${pad(s.index)}-${slug(s.heading || s.id || s.classes.split(/\s+/)[0] || s.tag)}@${bp}.png`
      try {
        await page.locator(`[data-sc-section="${s.index}"]`).screenshot({ path: path.join(OUT, 'screenshots', 'sections', name), timeout: 15000 })
      } catch {}
    }

    perBp[bp] = { sections, trees }
    for (const u of await safe(`asset refs @${bp}`, () => page.evaluate(DOM_REFS), [])) domRefs.add(u)
    if (bp === PRIMARY) primaryPage = page
    else await page.close()
  }

  if (!primaryPage) { primaryPage = await (await makeContext(PRIMARY)).newPage(); await primaryPage.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }); await settle(primaryPage); await primaryPage.evaluate(f => window.__sc.sections(f), FORCE_SECTIONS) }

  log('design tokens, outline, behaviors, svgs')
  const design = await safe('design tokens', () => primaryPage.evaluate(collectDesign),
    { cssVariables: {}, sampled: 0, typographyByTag: {}, frequencies: {}, fontUsage: [] })
  const outline = await safe('content outline', () => primaryPage.evaluate(collectOutline), [])
  const behaviors = await safe('behaviors', () => primaryPage.evaluate(collectBehaviors),
    { pinned: [], horizontalScrollers: [], disclosure: [], overlays: [], animated: [], forms: [], globals: [], autoplayMedia: [] })
  const svgs = await safe('inline svgs', () => primaryPage.evaluate(collectSvgs), [])
  const census = await safe('census', () => primaryPage.evaluate(() => window.__sc.census()),
    { shadowHosts: 0, iframes: [], canvases: 0, openDialogs: 0 })

  log('css: matching rules against the rendered DOM')
  const cssSheets = [...responses.entries()]
    .filter(([, r]) => r.contentType === 'text/css' || r.type === 'stylesheet')
    .map(([url, r]) => ({ href: url, text: r.body.toString('utf8') }))
  const css = await safe('css analysis', () => primaryPage.evaluate(analyzeCss, cssSheets),
    { kept: [], states: [], shadow: [], fontFaces: [], keyframes: {}, parsed: 0, total: 0, failed: [] })
  log(`  ${css.kept.length} matching rules from ${css.parsed}/${css.total} stylesheets, ${css.states.length} state rules`)

  for (const u of await safe('asset refs', () => primaryPage.evaluate(DOM_REFS), [])) domRefs.add(u)

  const html = {
    rendered: await safe('rendered html', () => primaryPage.content(), ''),
    snapshot: await safe('snapshot html', () => primaryPage.evaluate(cleanSnapshot), '')
  }
  let raw = ''
  try { raw = await (await contexts[0].request.get(TARGET)).text() } catch {}

  await browser.close()

  /* ---------------------------------------------------------- write out -- */

  const cssUrlRefs = new Set()
  for (const r of css.kept.concat(css.fontFaces.map(t => ({ body: t })))) {
    ;(String(r.body).match(/url\((['"]?)([^)'"]+)\1\)/g) || []).forEach(m => {
      const u = m.replace(/url\((['"]?)([^)'"]+)\1\)/, '$2')
      if (!u.startsWith('data:')) { try { cssUrlRefs.add(new URL(u, TARGET).href) } catch {} }
    })
  }

  const localOf = new Map()
  const images = []
  const fonts = []
  if (!flag('no-assets')) {
    for (const [url, r] of responses) {
      const isFont = r.type === 'font' || /^font\//.test(r.contentType) || /font/.test(r.contentType)
      const isImg = r.type === 'image' || /^image\//.test(r.contentType)
      if (!isFont && !isImg) continue
      const referenced = domRefs.has(url) || cssUrlRefs.has(url)
      if (!referenced) continue
      if (JUNK_HOST.test(url)) continue
      if (isImg && r.body.length < 512) continue
      const dir = isFont ? 'fonts' : 'images'
      const name = fileNameFor(url, r.contentType)
      const rel = `assets/${dir}/${name}`
      wTXT(path.join(OUT, rel), r.body)
      localOf.set(url, rel)
      ;(isFont ? fonts : images).push({ file: rel, url, bytes: r.body.length, contentType: r.contentType, from: domRefs.has(url) ? 'dom' : 'css' })
    }
  }
  log(`assets: ${images.length} images, ${fonts.length} fonts (from ${responses.size} candidate responses)`)

  // Absolute-URL swap, for HTML where every src/href was normalised in-page.
  const rewrite = (s, prefix) => {
    let out = s
    for (const [url, rel] of localOf) out = out.split(url).join(prefix + rel)
    return out
  }
  // CSS carries relative urls (`url(/assets/x.otf)`), so resolve each token
  // against the page before looking it up — otherwise @font-face silently misses.
  const rewriteCss = (s, prefix) => s.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g, (m, q, u) => {
    if (u.startsWith('data:') || u.startsWith('#')) return m
    let abs; try { abs = new URL(u, TARGET).href } catch { return m }
    const rel = localOf.get(abs)
    return rel ? `url("${prefix}${rel}")` : `url("${abs}")`
  })

  let usedCss = `/* Rules matching the rendered DOM of ${TARGET}\n   ${css.kept.length} rules · ${css.parsed}/${css.total} stylesheets · source order preserved */\n\n`
  usedCss += css.fontFaces.join('\n') + '\n\n'
  usedCss += Object.values(css.keyframes).join('\n') + '\n\n'
  let openMedia = ''
  for (const r of css.kept) {
    const m = r.media || ''
    if (m !== openMedia) {
      if (openMedia) usedCss += '}\n\n'
      if (m) usedCss += `${m} {\n`
      openMedia = m
    }
    usedCss += `${openMedia ? '  ' : ''}${r.selector} { ${r.body} }\n`
  }
  if (openMedia) usedCss += '}\n'
  wTXT(path.join(OUT, 'css', 'used.css'), rewriteCss(usedCss, '../'))
  if (css.shadow.length) {
    wTXT(path.join(OUT, 'css', 'shadow.css'), rewriteCss(
      `/* Shadow-scoped styles, grouped by host element. These are NOT global — each\n   block only applies inside that component's shadow root. */\n\n` +
      css.shadow.map(g => `/* ==== ${g.host} ==== */\n${g.rules.join('\n')}`).join('\n\n'), '../'))
  }
  if (flag('full-css')) wTXT(path.join(OUT, 'css', '_all.css'), cssSheets.map(s => `/* ==== ${s.href} ==== */\n${s.text}`).join('\n\n'))

  const stateBySel = {}
  for (const s of css.states) {
    const k = s.selector
    stateBySel[k] = stateBySel[k] || { selector: k, rules: [] }
    stateBySel[k].rules.push({ media: s.media || null, declarations: s.body })
  }
  wJSON(path.join(OUT, 'design', 'states.json'), Object.values(stateBySel))
  wJSON(path.join(OUT, 'design', 'tokens.json'), { cssVariables: design.cssVariables, frequencies: design.frequencies })
  wJSON(path.join(OUT, 'design', 'fonts.json'), { usage: design.fontUsage, fontFaces: css.fontFaces, files: fonts })
  wJSON(path.join(OUT, 'content', 'outline.json'), outline)
  wJSON(path.join(OUT, 'behaviors.json'), behaviors)
  wJSON(path.join(OUT, 'assets', 'svgs.json'), svgs)
  wJSON(path.join(OUT, 'assets', 'images.json'), images)
  wJSON(path.join(OUT, 'network.json'), network)
  wTXT(path.join(OUT, 'page.rendered.html'), html.rendered)
  wTXT(path.join(OUT, 'page.raw.html'), raw)
  if (html.snapshot) wTXT(path.join(OUT, 'snapshot.html'), rewrite(html.snapshot, ''))

  const primary = perBp[PRIMARY] || perBp[BPS[0]]
  const sectionIndex = primary.sections.map(s => {
    const name = `${pad(s.index)}-${slug(s.heading || s.id || s.classes.split(/\s+/)[0] || s.tag)}`
    const t = primary.trees.find(x => x.meta.index === s.index)
    return {
      ...s,
      name,
      nodes: t ? t.tree.nodeCount : 0,
      truncated: t ? !!t.tree.truncated : false,
      tree: `layout/${PRIMARY}/${name}.json`,
      screenshot: `screenshots/sections/${name}@${PRIMARY}.png`
    }
  })
  wJSON(path.join(OUT, 'layout', 'sections.json'), { url: TARGET, primaryBreakpoint: PRIMARY, sections: sectionIndex })
  // Intern repeated style objects: in a real page dozens of nodes share one rule set,
  // and inlining them all makes a section tree unreadable.
  const intern = tree => {
    const sets = []
    const keys = new Map()
    const walk = n => {
      const k = JSON.stringify(n.styles || {})
      let i = keys.get(k)
      if (i === undefined) { i = sets.length; sets.push(n.styles || {}); keys.set(k, i) }
      delete n.styles
      n.s = i
      ;(n.children || []).forEach(walk)
    }
    walk(tree)
    return { note: 'n.s indexes styleSets; only properties differing from the UA default (and, for inherited properties, from the parent) are listed', styleSets: sets, tree }
  }
  for (const bp of BPS) {
    for (const { meta, tree } of perBp[bp].trees) {
      const idx = sectionIndex.find(s => s.index === meta.index)
      const name = idx ? idx.name : `${pad(meta.index)}-${slug(meta.heading || meta.tag)}`
      wJSON(path.join(OUT, 'layout', String(bp), `${name}.json`), intern(JSON.parse(JSON.stringify(tree))))
    }
  }

  // Responsive deltas: which node paths change which properties between breakpoints.
  const flatten = (n, p = '0', acc = {}) => {
    acc[p] = { tag: n.tag, cls: n.cls, box: n.box, styles: n.styles }
    ;(n.children || []).forEach((c, i) => flatten(c, p + '.' + i, acc))
    return acc
  }
  const responsive = []
  for (const s of sectionIndex) {
    const perBpFlat = {}
    for (const bp of BPS) {
      const t = perBp[bp].trees.find(x => x.meta.index === s.index)
      if (t) perBpFlat[bp] = flatten(t.tree)
    }
    const bps = Object.keys(perBpFlat).map(Number)
    if (bps.length < 2) continue
    const ref = bps[bps.length - 1]
    const diffs = []
    for (const bp of bps) {
      if (bp === ref) continue
      for (const p of Object.keys(perBpFlat[ref])) {
        const a = perBpFlat[ref][p], b = perBpFlat[bp][p]
        if (!b) { diffs.push({ path: p, tag: a.tag, cls: a.cls, [`${bp}`]: 'ABSENT' }); continue }
        const changed = {}
        for (const k of new Set([...Object.keys(a.styles), ...Object.keys(b.styles)])) {
          if (a.styles[k] !== b.styles[k]) changed[k] = { [ref]: a.styles[k] ?? null, [bp]: b.styles[k] ?? null }
        }
        if (a.box[2] !== b.box[2] || a.box[3] !== b.box[3]) changed.box = { [ref]: a.box, [bp]: b.box }
        if (Object.keys(changed).length) diffs.push({ path: p, tag: a.tag, cls: a.cls, changed })
      }
    }
    if (diffs.length) responsive.push({ section: s.index, name: s.name, reference: ref, diffs: diffs.slice(0, 300) })
  }
  wJSON(path.join(OUT, 'layout', 'responsive.json'), responsive)

  // content/copy.md — every human string, grouped by section, ready to paste.
  let copy = `# Copy — ${TARGET}\n\n`
  for (const s of sectionIndex) {
    copy += `## ${pad(s.index)} · ${s.heading || s.name}\n\n`
    for (const o of outline.filter(o => o.section === s.index)) {
      if (o.type === 'img') copy += `- \`img\` alt: ${JSON.stringify(o.alt)}\n`
      else if (o.type === 'link') copy += `- \`link\` ${JSON.stringify(o.text)} → ${o.href}\n`
      else if (o.type === 'button') copy += `- \`button\` ${JSON.stringify(o.text)}\n`
      else if (/^(input|textarea|select)$/.test(o.type)) copy += `- \`${o.type}\` ${JSON.stringify(o.label || o.placeholder)}\n`
      else copy += `- \`${o.type}\` ${o.text}\n`
    }
    copy += '\n'
  }
  wTXT(path.join(OUT, 'content', 'copy.md'), copy)

  const warnings = [...phaseErrors]
  if (sectionIndex.length > 30) warnings.push(`${sectionIndex.length} sections is unusually many — the split has probably fragmented. Compare against screenshots/ and re-run with --sections.`)
  if (!sectionIndex.length) warnings.push('No sections detected — the page may be blocked, empty, or behind a consent wall. Check screenshots/, then re-run with --sections.')
  if (census.shadowHosts) warnings.push(`${census.shadowHosts} shadow root(s): trees include their contents, and scoped rules are in css/shadow.css (NOT applied by snapshot.html).`)
  for (const f of census.iframes) warnings.push(`iframe ${f.sameOrigin ? '(same-origin)' : '(cross-origin — not captured at all)'} ${f.size.join('x')}: ${f.src}`)
  if (census.canvases) warnings.push(`${census.canvases} <canvas> element(s): pixels only, no structure. Screenshots are all you get.`)
  if (css.kept.length < 50) warnings.push(`Only ${css.kept.length} CSS rules matched — suspiciously few. The page may render from inline styles, or stylesheets failed to parse.`)
  if (!images.length && !flag('no-assets')) warnings.push('No images kept. If the page has images, they may be loaded in a way the capture missed.')
  const truncated = sectionIndex.filter(x => x.truncated)
  if (truncated.length) warnings.push(`${truncated.length} section(s) hit the node cap: ${truncated.map(x => x.name).join(', ')}. Re-run with a higher --max-nodes.`)

  wJSON(path.join(OUT, 'manifest.json'), {
    url: TARGET,
    capturedAt: new Date().toISOString(),
    breakpoints: BPS,
    primaryBreakpoint: PRIMARY,
    sections: sectionIndex.length,
    counts: {
      matchedCssRules: css.kept.length,
      stateRules: css.states.length,
      images: images.length,
      fonts: fonts.length,
      inlineSvgs: svgs.length,
      outlineEntries: outline.length,
      requests: network.length
    },
    stylesheets: { parsed: css.parsed, total: css.total, failed: css.failed },
    census,
    warnings
  })

  wTXT(path.join(OUT, 'README.md'), readme({ design, css, sectionIndex, images, fonts, svgs, behaviors, outline, warnings }))
  console.log(`\n✓ ${sectionIndex.length} sections · ${css.kept.length} css rules · ${images.length} images · ${fonts.length} fonts`)
  for (const w of warnings) console.log('  ! ' + w)
  console.log(`  open ${path.join(OUT, 'README.md')}\n`)
}

/* ---------------------------------------------------------------- readme -- */

function table (title, obj, cols = ['value', 'uses']) {
  const rows = Object.entries(obj || {})
  if (!rows.length) return ''
  return `### ${title}\n\n| ${cols[0]} | ${cols[1]} |\n|---|---|\n` +
    rows.map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n') + '\n\n'
}

function readme ({ design, css, sectionIndex, images, fonts, svgs, behaviors, outline, warnings }) {
  const f = design.frequencies
  let md = `# Capture — ${TARGET}
${warnings.length ? '\n> **Check these before building.**\n' + warnings.map(w => '> - ' + w).join('\n') + '\n' : ''}
Captured ${new Date().toISOString()} · breakpoints ${BPS.join(', ')} · primary ${PRIMARY}px.
Frequencies below are counts over ${design.sampled} sampled elements: they say what
*dominates* the page, not an exhaustive token list. Exact values always live in
\`css/used.css\` and the per-section trees.

## Read this bundle in this order

1. \`screenshots/${PRIMARY}-fullpage.png\` — what you are rebuilding.
2. \`layout/sections.json\` — the section split. Every other file keys off these indices.
3. \`layout/${PRIMARY}/<NN>-<name>.json\` — one section's element tree as
   \`{ styleSets, tree }\`. A node has \`tag\`, \`cls\`, \`box: [x, y, w, h]\` relative to
   the section, and \`s\` — an index into \`styleSets\`. A style set lists **only**
   what differs from the browser default for that tag, and for inherited properties
   only what differs from the parent. Nodes sharing an \`s\` are the same component
   repeated. \`repeats: n\` on a node means it had *n* identical siblings and only a
   few exemplars were kept — that is a list, and n is its length.
4. \`css/used.css\` — every CSS rule that matches this DOM, media queries intact.
   This is the authoritative source for anything the tree summarises.
5. \`design/tokens.json\`, \`design/states.json\` — variables, and \`:hover\`/\`:focus\`/
   \`:active\` rules you cannot see in computed styles.
6. \`layout/responsive.json\` — per-node property deltas across breakpoints.
7. \`behaviors.json\` — sticky bars, carousels, accordions, dialogs, transitions.
8. \`content/copy.md\` — all human copy, grouped by section.
9. \`snapshot.html\` — the cleaned DOM wired to \`css/used.css\` and local assets.
   Open it in a browser: it should render like the original. If it does, the
   capture is complete enough to rebuild from. It runs no JavaScript, so anything
   whose final appearance depends on JS — a lazy-load fade-in, a drawer's runtime
   open/closed state — can differ. **The screenshots are the pixel truth**; the
   snapshot is a completeness check on the CSS and assets.

## Sections

| # | name | tag | y | height | nodes | screenshot |
|---|---|---|---|---|---|---|
${sectionIndex.map(s => `| ${s.index} | ${s.heading || s.name} | \`${s.tag}\`${s.sticky ? ' *(' + s.sticky + ')*' : ''} | ${s.y} | ${s.height} | ${s.nodes}${s.truncated ? ' ⚠︎' : ''} | \`${s.screenshot}\` |`).join('\n')}

${sectionIndex.some(s => s.truncated) ? '⚠︎ = tree hit the node cap; re-run with `--max-nodes` higher for that section.\n' : ''}
## Typography by tag

\`\`\`json
${JSON.stringify(design.typographyByTag, null, 2)}
\`\`\`

## Font families in use

${design.fontUsage.map(u => `- \`${u.family}\` — ${u.count} elements · sizes ${Object.keys(u.sizes).join(', ')} · weights ${Object.keys(u.weights).join(', ')}`).join('\n')}

${fonts.length ? '### Font files downloaded\n\n' + fonts.map(x => `- \`${x.file}\``).join('\n') + '\n' : ''}
${css.fontFaces.length ? '### @font-face\n\n```css\n' + css.fontFaces.join('\n') + '\n```\n' : ''}
## Scale

${table('Font sizes', f.fontSize)}${table('Font weights', f.fontWeight)}${table('Line heights', f.lineHeight)}${table('Text colors', f.color)}${table('Background colors', f.backgroundColor)}${table('Border colors', f.borderColor)}${table('Border radii', f.borderRadius)}${table('Shadows', f.boxShadow)}${table('Gaps', f.gap)}${table('Container max-widths', f.maxWidth)}${table('Block padding (top / bottom)', f.paddingBlock)}${table('Inline padding (left / right)', f.paddingInline)}
## CSS custom properties

${Object.keys(design.cssVariables).length
  ? '| variable | value |\n|---|---|\n' + Object.entries(design.cssVariables).map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join('\n')
  : '_None declared — this site does not use CSS variables; read `css/used.css` for literals._'}

## Behaviour to reproduce

- **Pinned / sticky:** ${behaviors.pinned.length ? behaviors.pinned.map(p => `\`${p.selector}\` (${p.position})`).join(', ') : 'none'}
- **Horizontal scrollers / carousels:** ${behaviors.horizontalScrollers.length ? behaviors.horizontalScrollers.map(p => `\`${p.selector}\` (${p.items} items${p.snap && p.snap !== 'none' ? ', snap ' + p.snap : ''})`).join(', ') : 'none'}
- **Accordions / tabs:** ${behaviors.disclosure.length} elements
- **Dialogs / modals:** ${behaviors.overlays.length}
- **Transitioned / animated elements:** ${behaviors.animated.length}
- **Forms:** ${behaviors.forms.length}
- **Libraries detected on \`window\`:** ${behaviors.globals.join(', ') || 'none'}

Full detail in \`behaviors.json\`. Anything requiring a click to observe (menus,
modals, carousel autoplay) is **not** in this capture — drive it with the
Playwright MCP and note what you find.

## Assets

- ${images.length} images → \`assets/images/\`, indexed in \`assets/images.json\`
- ${fonts.length} font files → \`assets/fonts/\`
- ${svgs.length} distinct inline SVGs → \`assets/svgs.json\` (deduplicated, most-used first)

Only assets actually referenced by the DOM or by a matching CSS rule are kept;
tracking pixels and third-party beacons are dropped.

## Coverage caveats

- ${css.failed.length} of ${css.total} stylesheet(s) could not be parsed${css.failed.length ? ': ' + css.failed.slice(0, 5).join(', ') : ''}.
- ${outline.length} copy/link/media entries captured.
- Captured in one state: logged out, default locale, no interaction beyond the
  configured \`--click\` selectors and a full-page scroll.
`
  return md
}

main().catch(e => { console.error(e); process.exit(1) })
