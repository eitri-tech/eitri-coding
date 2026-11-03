#!/usr/bin/env node
/**
 * Offline counterpart of extract.mjs: reads a local `.fig` file (Figma →
 * File → Save local copy) and writes the same bundle layout, without API
 * token or network. Nodes are converted to the REST API shape so the bundle
 * builders in lib/bundle.mjs are shared.
 *
 * Usage: node fig-extract.mjs <file.fig> --list
 *        node fig-extract.mjs <file.fig> --node <id|name> --out figma/<project> --name <view>
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodeCanvas, readZip } from './lib/kiwi.mjs'
import { mk, wj, wt, toHex, extractTokens, buildTree, copyMarkdown, listFrames, generateReadme } from './lib/bundle.mjs'

/* ------------------------------------------------------------------ args -- */

const argv = process.argv.slice(2)
const flag = n => argv.includes('--' + n)
const opt  = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 || i >= argv.length - 1 ? d : argv[i + 1] }

if (!argv.length || flag('help') || argv[0].startsWith('-')) {
  console.log(`
figma-scrape .fig extractor (offline, no token)

  node fig-extract.mjs <file.fig> [options]

  --list             print pages, sections and frames with their ids, then exit
  --list-depth <n>   how deep --list goes                    (default: 3)
  --node <id|name>   node to extract: page, section, frame…  (default: first page)
  --out <dir>        output root                             (default: figma/<file-name>)
  --name <slug>      bundle folder name                      (default: slug of node name)
  --depth <n>        max depth for simplified tree           (default: 12)
`)
  process.exit(argv.length && !flag('help') ? 1 : 0)
}

const FIG_PATH  = argv[0]
const MAX_DEPTH = parseInt(opt('depth', '12'), 10)
const warnings  = []
const log  = (...a) => console.log(' ·', ...a)
const warn = msg => { warnings.push(msg); console.warn(' ⚠', msg) }
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'node'

/* ------------------------------------------------------------------ load -- */

const raw = fs.readFileSync(FIG_PATH)
let canvasBuf, meta = {}, thumbnail = null
const imageFiles = new Map()
if (raw.toString('latin1', 0, 8) === 'fig-kiwi') {
  canvasBuf = raw
} else {
  const zip = readZip(raw)
  if (!zip || !zip.has('canvas.fig')) {
    console.error('Error: not a Figma .fig file (no canvas.fig inside).')
    process.exit(1)
  }
  canvasBuf = zip.get('canvas.fig')()
  if (zip.has('meta.json')) meta = JSON.parse(zip.get('meta.json')().toString('utf8'))
  if (zip.has('thumbnail.png')) thumbnail = zip.get('thumbnail.png')()
  for (const [name, read] of zip) if (name.startsWith('images/')) imageFiles.set(name.slice(7), read)
}

const { version, message } = decodeCanvas(canvasBuf)
const blobs = message.blobs || []
const changes = (message.nodeChanges || []).filter(n => n.phase !== 'REMOVED')

const gid = g => g ? `${g.sessionID}:${g.localID}` : null
const byGuid = new Map(changes.map(n => [gid(n.guid), n]))
const kids = new Map()
for (const n of changes) {
  if (!n.parentIndex) continue
  const p = gid(n.parentIndex.guid)
  if (!kids.has(p)) kids.set(p, [])
  kids.get(p).push(n)
}
// fractional-index strings: plain code-unit comparison is the intended order
for (const list of kids.values()) list.sort((a, b) => a.parentIndex.position < b.parentIndex.position ? -1 : a.parentIndex.position > b.parentIndex.position ? 1 : 0)
const childrenOf = n => kids.get(gid(n.guid)) || []

const documentNode = changes.find(n => n.type === 'DOCUMENT')
const pages = childrenOf(documentNode).filter(n => n.type === 'CANVAS')
const visiblePages = pages.filter(p => !p.internalOnly)

/* -------------------------------------------------- variables and styles -- */

const varByKey = new Map(), varByGuid = new Map(), setByKey = new Map(), setByGuid = new Map()
const styleByKey = new Map(), styleByGuid = new Map()
for (const n of changes) {
  if (n.type === 'VARIABLE') { varByGuid.set(gid(n.guid), n); if (n.key) varByKey.set(n.key, n) }
  if (n.type === 'VARIABLE_SET') { setByGuid.set(gid(n.guid), n); if (n.key) setByKey.set(n.key, n) }
  if (n.styleType && n.styleType !== 'NONE') { styleByGuid.set(gid(n.guid), n); if (n.key) styleByKey.set(n.key, n) }
}
const lookup = (ref, byKey, byG) => ref?.assetRef ? byKey.get(ref.assetRef.key) : ref?.guid ? byG.get(gid(ref.guid)) : undefined
const varOf = alias => lookup(alias, varByKey, varByGuid)
const styleName = ref => lookup(ref, styleByKey, styleByGuid)?.name

function variableValue(data, seen = new Set()) {
  const v = data?.value
  if (!v) return null
  if (v.alias) {
    const target = varOf(v.alias)
    if (!target || seen.has(target)) return null
    seen.add(target)
    return variableValue(target.variableDataValues?.entries?.[0]?.variableData, seen)
  }
  if (v.colorValue) { const c = v.colorValue; return toHex(c.r, c.g, c.b, c.a ?? 1) }
  if ('floatValue' in v) return v.floatValue
  if ('textValue' in v) return v.textValue
  if ('boolValue' in v) return v.boolValue
  return null
}

function buildVariables() {
  const collections = [...setByGuid.values()].map(s => ({
    name: s.name,
    modes: (s.variableSetModes || []).map(m => m.name),
  }))
  const variables = [...varByGuid.values()].map(v => {
    const set = lookup(v.variableSetID, setByKey, setByGuid)
    const modeName = id => set?.variableSetModes?.find(m => gid(m.id) === gid(id))?.name || gid(id)
    const values = {}
    let aliasOf
    for (const e of v.variableDataValues?.entries || []) {
      values[modeName(e.modeID)] = variableValue(e.variableData)
      if (e.variableData?.value?.alias) aliasOf = varOf(e.variableData.value.alias)?.name
    }
    return {
      name: v.name,
      collection: set?.name || null,
      type: v.variableResolvedType,
      values,
      ...(aliasOf ? { aliasOf } : {}),
      ...(v.description ? { description: v.description } : {}),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return { collections, variables }
}

/* ---------------------------------------------------------- conversion -- */

const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400,
  medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 }
const fontWeight = style => {
  const s = (style || '').toLowerCase().replace(/italic|oblique|[\s-]/g, '')
  return WEIGHTS[s] ?? (parseInt(s, 10) || 400)
}

function textStyle(n) {
  const size = n.fontSize || 0
  const lh = n.lineHeight
  const ls = n.letterSpacing
  const style = {
    fontFamily: n.fontName?.family,
    fontStyle: n.fontName?.style,
    fontWeight: fontWeight(n.fontName?.style),
    fontSize: size,
  }
  if (lh && lh.units === 'PIXELS') style.lineHeightPx = lh.value
  else if (lh && lh.units === 'PERCENT') style.lineHeightPx = lh.value * size / 100
  else if (lh && lh.units === 'RAW') style.lineHeightPx = lh.value * size
  if (ls && ls.value) style.letterSpacing = ls.units === 'PERCENT' ? ls.value * size / 100 : ls.value
  if (n.textCase && n.textCase !== 'ORIGINAL') style.textCase = n.textCase
  if (n.textDecoration) style.textDecoration = n.textDecoration
  if (n.textAlignHorizontal) style.textAlignHorizontal = n.textAlignHorizontal
  return style
}

function paints(list) {
  return (list || []).filter(p => p.visible !== false).map(p => {
    const o = { type: p.type, opacity: p.opacity ?? 1, blendMode: p.blendMode }
    if (p.color) o.color = p.color
    if (p.stops) o.gradientStops = p.stops.map(s => ({ color: s.color, position: s.position }))
    if (p.type === 'IMAGE' && p.image?.hash) {
      o.imageRef = Buffer.from(p.image.hash).toString('hex')
      o.scaleMode = p.imageScaleMode
      if (p.image.name) o.imageName = p.image.name
    }
    const v = p.colorVar?.value?.alias && varOf(p.colorVar.value.alias)
    if (v) o.variableName = v.name
    return o
  })
}

const mul = (A, B) => ({
  a: A.a * B.a + A.c * B.b, b: A.b * B.a + A.d * B.b,
  c: A.a * B.c + A.c * B.d, d: A.b * B.c + A.d * B.d,
  e: A.a * B.e + A.c * B.f + A.e, f: A.b * B.e + A.d * B.f + A.f,
})
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const local = t => t ? { a: t.m00, b: t.m10, c: t.m01, d: t.m11, e: t.m02, f: t.m12 } : IDENTITY
const invert = M => {
  const det = M.a * M.d - M.b * M.c || 1
  return { a: M.d / det, b: -M.b / det, c: -M.c / det, d: M.a / det,
    e: (M.c * M.f - M.d * M.e) / det, f: (M.b * M.e - M.a * M.f) / det }
}

function bbox(M, w, h) {
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f])
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function absoluteMatrix(n) {
  const chain = []
  for (let c = n; c && c.type !== 'CANVAS' && c.type !== 'DOCUMENT'; c = byGuid.get(gid(c.parentIndex?.guid))) chain.unshift(c)
  return chain.reduce((M, c) => mul(M, local(c.transform)), IDENTITY)
}

const TYPE_MAP = { ROUNDED_RECTANGLE: 'RECTANGLE', SYMBOL: 'COMPONENT', CANVAS: 'CANVAS' }
const typeOf = n => {
  if (n.type === 'FRAME' && n.isStateGroup) return 'COMPONENT_SET'
  if (n.type === 'FRAME' && n.resizeToFit) return 'GROUP'
  return TYPE_MAP[n.type] || n.type
}

const geometry = new Map()   // converted id → { matrix, node } for SVG export

function sizing(n, parent) {
  let h, v
  if (n.stackMode === 'HORIZONTAL' || n.stackMode === 'VERTICAL') {
    // absent primary sizing means hug and absent counter sizing means fixed (verified against node geometry)
    const primary = !n.stackPrimarySizing || n.stackPrimarySizing !== 'FIXED' ? 'HUG' : 'FIXED'
    const counter = n.stackCounterSizing && n.stackCounterSizing !== 'FIXED' ? 'HUG' : 'FIXED'
    ;[h, v] = n.stackMode === 'HORIZONTAL' ? [primary, counter] : [counter, primary]
  }
  if (n.type === 'TEXT') {
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') { h = 'HUG'; v = 'HUG' }
    else if (n.textAutoResize === 'HEIGHT') { h = 'FIXED'; v = 'HUG' }
  }
  const pm = parent?.stackMode
  if ((pm === 'HORIZONTAL' || pm === 'VERTICAL') && n.stackPositioning !== 'ABSOLUTE') {
    const grow = n.stackChildPrimaryGrow > 0, stretch = n.stackChildAlignSelf === 'STRETCH'
    if (pm === 'HORIZONTAL') { if (grow) h = 'FILL'; if (stretch) v = 'FILL' }
    else { if (grow) v = 'FILL'; if (stretch) h = 'FILL' }
  }
  return { h, v }
}

function applyPropRefs(n, props) {
  if (!props || !n.componentPropRefs) return n
  const out = { ...n }
  for (const ref of n.componentPropRefs) {
    const val = props.get(gid(ref.defID))
    if (!val) continue
    if (ref.componentPropNodeField === 'TEXT_DATA' && val.textValue) out.textData = val.textValue
    if (ref.componentPropNodeField === 'VISIBLE' && 'boolValue' in val) out.visible = val.boolValue
    if (ref.componentPropNodeField === 'OVERRIDDEN_SYMBOL_ID' && val.guidValue) out.overriddenSymbolID = val.guidValue
  }
  return out
}

/**
 * ctx.over: Map("k1/k2…" → override fields) collected from the enclosing
 * instances; ctx.path is the override-key path of the current node inside them.
 */
function convert(raw, parentRaw, parentMatrix, ctx = { over: null, path: [], idPrefix: '', props: null }) {
  const key = gid(raw.overrideKey || raw.guid)
  const pathHere = ctx.over ? [...ctx.path, key] : []
  let n = raw
  if (ctx.over) {
    const o = ctx.over.get(pathHere.join('/'))
    if (o) n = { ...n, ...o }
    n = applyPropRefs(n, ctx.props)
  }

  const id = ctx.idPrefix ? `${ctx.idPrefix};${gid(raw.guid)}` : gid(raw.guid)
  const M = mul(parentMatrix, local(n.transform))
  const w = n.size?.x || 0, h = n.size?.y || 0
  const out = { id, name: n.name, type: typeOf(n) }
  if (n.visible === false) out.visible = false
  if (n.opacity !== undefined && n.opacity < 1) out.opacity = n.opacity
  if (n.size) out.absoluteBoundingBox = bbox(M, w, h)

  const { h: sh, v: sv } = sizing(n, parentRaw)
  if (sh) out.layoutSizingHorizontal = sh
  if (sv) out.layoutSizingVertical = sv
  if (n.stackPositioning === 'ABSOLUTE') out.layoutPositioning = 'ABSOLUTE'

  const fills = paints(n.fillPaints)
  if (fills.length) out.fills = fills
  const strokes = paints(n.strokePaints)
  if (strokes.length) { out.strokes = strokes; out.strokeWeight = n.strokeWeight; out.strokeAlign = n.strokeAlign }
  if (n.effects?.length) out.effects = n.effects

  if (n.rectangleCornerRadiiIndependent) {
    out.rectangleCornerRadii = [n.rectangleTopLeftCornerRadius || 0, n.rectangleTopRightCornerRadius || 0,
      n.rectangleBottomRightCornerRadius || 0, n.rectangleBottomLeftCornerRadius || 0]
  }
  const corners = [n.rectangleTopLeftCornerRadius, n.rectangleTopRightCornerRadius, n.rectangleBottomRightCornerRadius, n.rectangleBottomLeftCornerRadius]
  const radius = n.cornerRadius ?? (!n.rectangleCornerRadiiIndependent || new Set(corners).size === 1 ? corners[0] : undefined)
  if (radius) out.cornerRadius = radius

  if (n.stackMode === 'HORIZONTAL' || n.stackMode === 'VERTICAL') {
    out.layoutMode = n.stackMode
    out.itemSpacing = n.stackSpacing || 0
    out.paddingLeft = n.stackHorizontalPadding || 0
    out.paddingRight = n.stackPaddingRight || 0
    out.paddingTop = n.stackVerticalPadding || 0
    out.paddingBottom = n.stackPaddingBottom || 0
    const j = n.stackPrimaryAlignItems || 'MIN'
    out.primaryAxisAlignItems = j.startsWith('SPACE') ? 'SPACE_BETWEEN' : j
    out.counterAxisAlignItems = n.stackCounterAlignItems || 'MIN'
    if (n.stackWrap === 'WRAP') { out.layoutWrap = 'WRAP'; out.counterAxisSpacing = n.stackCounterSpacing || 0 }
  }

  const fieldVars = {}
  for (const e of n.parameterConsumptionMap?.entries || []) {
    const v = e.variableData?.value?.alias && varOf(e.variableData.value.alias)
    if (v) fieldVars[e.variableField] = v.name
  }
  if (Object.keys(fieldVars).length) out.fieldVars = fieldVars

  const styles = {}
  if (n.styleIdForText) styles.text = styleName(n.styleIdForText)
  if (n.styleIdForFill) styles.fill = styleName(n.styleIdForFill)
  if (n.styleIdForStrokeFill) styles.stroke = styleName(n.styleIdForStrokeFill)
  if (n.styleIdForEffect) styles.effect = styleName(n.styleIdForEffect)
  for (const k of Object.keys(styles)) if (!styles[k]) delete styles[k]
  if (Object.keys(styles).length) out.styles = styles

  if (n.type === 'TEXT') {
    const chars = n.textData?.characters ?? ''
    out.characters = chars
    out.style = textStyle(n)
    if (n.maxLines) out.maxLines = n.maxLines
    const ids = n.textData?.characterStyleIDs
    const table = new Map((n.textData?.styleOverrideTable || []).map(s => [s.styleID, s]))
    const cps = Array.from(chars)
    const sids = cps.map((_, i) => ids?.[i] ?? 0)
    const uniform = sids.every(sid => sid === sids[0])
    // when no character uses the node's own style, the node fill/font is never rendered: report the dominant override
    if (sids.length && sids.every(sid => sid && table.has(sid))) {
      const count = new Map()
      sids.forEach(sid => count.set(sid, (count.get(sid) || 0) + 1))
      const o = table.get([...count].sort((a, b) => b[1] - a[1])[0][0])
      out.style = textStyle({ ...n, ...o })
      if (o.fillPaints) out.fills = paints(o.fillPaints)
    }
    if (!uniform) {
      const runs = []
      cps.forEach((ch, i) => {
        const sid = sids[i]
        const last = runs[runs.length - 1]
        if (last && last.sid === sid) last.characters += ch
        else runs.push({ sid, characters: ch })
      })
      out.textRuns = runs.map(r => {
        const o = table.get(r.sid) || {}
        return { characters: r.characters, style: textStyle({ ...n, ...o }), fills: paints(o.fillPaints || n.fillPaints) }
      })
    }
  }

  geometry.set(id, { matrix: M, node: n })

  let childRaw = childrenOf(raw)
  let childCtx = ctx.over ? { ...ctx, path: pathHere } : ctx
  if (n.type === 'INSTANCE') {
    const symId = n.overriddenSymbolID || n.symbolData?.symbolID
    const sym = symId && byGuid.get(gid(symId))
    if (sym) {
      out.componentId = gid(sym.guid)
      out.componentName = sym.name
      childRaw = childrenOf(sym)
      const over = new Map(ctx.over || [])
      // derived data carries per-instance layout (resized children); explicit overrides win over it
      const add = (list, pick) => (list || []).forEach(o => {
        const k = [...pathHere, ...(o.guidPath?.guids || []).map(gid)].join('/')
        over.set(k, { ...(over.get(k) || {}), ...pick(o) })
      })
      add(n.derivedSymbolData, o => ({ ...(o.size ? { size: o.size } : {}), ...(o.transform ? { transform: o.transform } : {}) }))
      add(n.symbolData?.symbolOverrides, ({ guidPath, ...o }) => o)
      const props = new Map(ctx.props || [])
      for (const a of n.componentPropAssignments || []) props.set(gid(a.defID), a.value)
      childCtx = { over, path: pathHere, idPrefix: `I${id}`, props }
    } else {
      warn(`Instance "${n.name}" (${id}) points to a component that is not in the file; its content is missing`)
    }
  }
  if (childRaw.length) out.children = childRaw.map(c => convert(c, n, M, childCtx))
  return out
}

/* -------------------------------------------------------------- vectors -- */

const f2 = v => Math.round(v * 100) / 100

function commandsToPath(blobIndex) {
  const b = Buffer.from(blobs[blobIndex]?.bytes || [])
  let i = 0, d = ''
  const f = () => { const v = b.readFloatLE(i); i += 4; return f2(v) }
  while (i < b.length) {
    const cmd = b[i++]
    if (cmd === 0) d += 'Z'
    else if (cmd === 1) d += `M${f()} ${f()}`
    else if (cmd === 2) d += `L${f()} ${f()}`
    else if (cmd === 3) d += `Q${f()} ${f()} ${f()} ${f()}`
    else if (cmd === 4) d += `C${f()} ${f()} ${f()} ${f()} ${f()} ${f()}`
    else break
  }
  return d
}

function networkToPath(n) {
  const vd = n.vectorData
  const b = Buffer.from(blobs[vd?.vectorNetworkBlob]?.bytes || [])
  if (b.length < 12) return ''
  const sx = (n.size?.x || 1) / (vd.normalizedSize?.x || 1), sy = (n.size?.y || 1) / (vd.normalizedSize?.y || 1)
  const vc = b.readUInt32LE(0), sc = b.readUInt32LE(4)
  const verts = []
  let o = 12
  for (let k = 0; k < vc; k++, o += 12) verts.push([b.readFloatLE(o + 4) * sx, b.readFloatLE(o + 8) * sy])
  let d = '', start = -1, prev = -1
  for (let k = 0; k < sc; k++, o += 28) {
    const a = b.readUInt32LE(o + 4), z = b.readUInt32LE(o + 16)
    const ta = [b.readFloatLE(o + 8) * sx, b.readFloatLE(o + 12) * sy], tz = [b.readFloatLE(o + 20) * sx, b.readFloatLE(o + 24) * sy]
    if (!verts[a] || !verts[z]) break
    if (a !== prev) { d += `M${f2(verts[a][0])} ${f2(verts[a][1])}`; start = a }
    if (!ta[0] && !ta[1] && !tz[0] && !tz[1]) d += `L${f2(verts[z][0])} ${f2(verts[z][1])}`
    else d += `C${f2(verts[a][0] + ta[0])} ${f2(verts[a][1] + ta[1])} ${f2(verts[z][0] + tz[0])} ${f2(verts[z][1] + tz[1])} ${f2(verts[z][0])} ${f2(verts[z][1])}`
    if (z === start) d += 'Z'
    prev = z
  }
  return d
}

const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'STAR', 'REGULAR_POLYGON', 'LINE', 'RECTANGLE'])
const hasGeometry = g => g.node.fillGeometry?.length || g.node.strokeGeometry?.length || g.node.vectorData
const SVG_LEAF_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON'])
const ownGeometry = c => VECTOR_TYPES.has(c.type) && !!hasGeometry(geometry.get(c.id))
// a boolean operation carries the combined outline itself; its children are only the operands
const isGlyphLeaf = c => c.type === 'BOOLEAN_OPERATION' ? ownGeometry(c) : !c.children?.length && ownGeometry(c)
const isVectorOnly = c => c.type === 'TEXT' || (c.fills || []).some(f => f.type === 'IMAGE') ? false
  : isGlyphLeaf(c) || (!!c.children?.length && c.children.every(isVectorOnly))

function svgOf(node) {
  const { matrix: root } = geometry.get(node.id)
  const inv = invert(root)
  const w = node.absoluteBoundingBox.width, h = node.absoluteBoundingBox.height
  const parts = []
  const bounds = [0, 0, w, h]
  let pad = 0
  const grow = (R, d) => {
    const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number)
    for (let k = 0; k + 1 < nums.length; k += 2) {
      const x = R.a * nums[k] + R.c * nums[k + 1] + R.e, y = R.b * nums[k] + R.d * nums[k + 1] + R.f
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y)
      bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y)
    }
  }
  const color = list => {
    const p = (list || []).find(x => x.type === 'SOLID' && x.visible !== false)
    return p ? { hex: toHex(p.color.r, p.color.g, p.color.b), alpha: (p.opacity ?? 1) * (p.color.a ?? 1) } : null
  }
  const paint = (attr, c) => c ? `${attr}="${c.hex}"${c.alpha < 1 ? ` ${attr}-opacity="${f2(c.alpha)}"` : ''}` : `${attr}="none"`
  ;(function walk(c) {
    if (c.visible === false) return
    const { matrix, node: n } = geometry.get(c.id)
    const R = mul(inv, matrix)
    const tf = `matrix(${[R.a, R.b, R.c, R.d, R.e, R.f].map(f2).join(' ')})`
    const op = c.opacity < 1 ? ` opacity="${f2(c.opacity)}"` : ''
    const fill = color(n.fillPaints), stroke = color(n.strokePaints)
    if (c.children && !isGlyphLeaf(c)) {
      if (fill && n.size) {
        const r = n.cornerRadius ?? n.rectangleTopLeftCornerRadius
        const rx = r ? ` rx="${f2(Math.min(r, n.size.x / 2, n.size.y / 2))}"` : ''
        parts.push(`<rect transform="${tf}" width="${f2(n.size.x)}" height="${f2(n.size.y)}"${rx} ${paint('fill', fill)}${op}/>`)
      }
      return c.children.forEach(walk)
    }
    if (stroke && n.strokeWeight) pad = Math.max(pad, n.strokeWeight / 2)
    if (n.fillGeometry?.length && fill) {
      for (const g of n.fillGeometry) {
        const d = commandsToPath(g.commandsBlob)
        grow(R, d)
        parts.push(`<path transform="${tf}" d="${d}" ${paint('fill', fill)}${g.windingRule === 'ODD' ? ' fill-rule="evenodd"' : ''}${op}/>`)
      }
    }
    if (n.strokeGeometry?.length && stroke && n.strokeWeight) {
      for (const g of n.strokeGeometry) {
        const d = commandsToPath(g.commandsBlob)
        grow(R, d)
        parts.push(`<path transform="${tf}" d="${d}" ${paint('fill', stroke)}${op}/>`)
      }
    }
    if (!n.fillGeometry?.length && !n.strokeGeometry?.length && n.vectorData) {
      const d = networkToPath(n)
      if (!d) return
      grow(R, d)
      const cap = { ROUND: 'round', SQUARE: 'square' }[n.strokeCap] || 'butt'
      const join = { ROUND: 'round', BEVEL: 'bevel' }[n.strokeJoin] || 'miter'
      const strokeAttrs = stroke && n.strokeWeight ? ` ${paint('stroke', stroke)} stroke-width="${f2(n.strokeWeight)}" stroke-linecap="${cap}" stroke-linejoin="${join}"` : ''
      parts.push(`<path transform="${tf}" d="${d}" ${paint('fill', fill)}${strokeAttrs}${op}/>`)
    }
  })(node)
  // content may overflow the frame (strokes, unclipped children): widen the viewBox instead of clipping
  const [x0, y0, x1, y1] = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad].map(v => Math.round(v * 100) / 100)
  const vb = x0 < 0 || y0 < 0 || x1 > w || y1 > h ? [Math.min(0, x0), Math.min(0, y0), Math.max(w, x1), Math.max(h, y1)] : [0, 0, w, h]
  const [vw, vh] = [f2(vb[2] - vb[0]), f2(vb[3] - vb[1])]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${f2(vb[0])} ${f2(vb[1])} ${vw} ${vh}" fill="none">\n${parts.join('\n')}\n</svg>\n`
}

/* ------------------------------------------------------------- listing -- */

function printTree(n, depth, max) {
  const size = n.size ? `  ${Math.round(n.size.x)}×${Math.round(n.size.y)}` : ''
  const count = childrenOf(n).length
  const hidden = n.visible === false ? '  (hidden)' : ''
  console.log(`${'  '.repeat(depth)}${typeOf(n)} "${n.name}"  ${gid(n.guid)}${size}${count ? `  [${count} children]` : ''}${hidden}`)
  if (depth + 1 >= max) return
  childrenOf(n).filter(c => c.type !== 'TEXT' && !VECTOR_TYPES.has(typeOf(c))).forEach(c => printTree(c, depth + 1, max))
}

/* ---------------------------------------------------------------- main -- */

function selectRoot() {
  const q = opt('node')
  if (!q) return visiblePages[0]
  const exact = byGuid.get(q.replace('-', ':'))
  if (exact) return exact
  const matches = changes.filter(n => n.name === q && n.type !== 'VARIABLE')
  if (matches.length === 1) return matches[0]
  if (!matches.length) { console.error(`Error: no node with id or name "${q}". Run with --list.`); process.exit(1) }
  console.error(`Error: ${matches.length} nodes are named "${q}". Pass one of these ids with --node:`)
  matches.forEach(m => console.error(`  ${gid(m.guid)}  ${typeOf(m)}  ${m.size ? `${Math.round(m.size.x)}×${Math.round(m.size.y)}` : ''}  in "${byGuid.get(gid(m.parentIndex?.guid))?.name}"`))
  process.exit(1)
}

function main() {
  const fileName = meta.file_name || path.basename(FIG_PATH, '.fig')

  if (flag('list')) {
    console.log(`${fileName}  (fig-kiwi v${version}, ${changes.length} nodes)\n`)
    visiblePages.forEach(p => printTree(p, 0, parseInt(opt('list-depth', '3'), 10)))
    return
  }

  const rootRaw = selectRoot()
  const parent = byGuid.get(gid(rootRaw.parentIndex?.guid))
  const parentMatrix = rootRaw.type === 'CANVAS' ? IDENTITY : absoluteMatrix(parent)
  const root = convert(rootRaw, parent, parentMatrix)

  const name   = opt('name', slug(rootRaw.name))
  const outDir = path.resolve(opt('out', path.join('figma', slug(fileName))), name)
  const date   = new Date().toISOString().split('T')[0]

  console.log(`fig-extract: ${fileName} → ${root.type} "${root.name}" (${root.id})`)
  console.log(`  out:  ${outDir}`)
  ;['design', 'layout', 'content', 'assets/images', 'assets/vectors', 'assets/fills'].forEach(d => mk(path.join(outDir, d)))

  wj(path.join(outDir, 'node.json'), root)
  log(`node.json  (${root.type}: "${root.name}", ${root.children?.length || 0} children)`)

  const styles = [...styleByGuid.values()].map(s => ({
    name: s.name,
    styleType: s.styleType,
    key: s.key || gid(s.guid),
    ...(s.description ? { description: s.description } : {}),
    ...(s.styleType === 'TEXT' ? { value: textStyle(s) } : {}),
    ...(s.styleType === 'FILL' ? { value: paints(s.fillPaints).map(p => p.color ? toHex(p.color.r, p.color.g, p.color.b, (p.opacity ?? 1) * (p.color.a ?? 1)) : p.type) } : {}),
    ...(s.styleType === 'EFFECT' ? { value: s.effects } : {}),
  }))
  wj(path.join(outDir, 'design/styles.json'), styles)
  log(`design/styles.json  (${styles.length} styles)`)

  const variables = buildVariables()
  wj(path.join(outDir, 'design/variables.json'), variables)
  log(`design/variables.json  (${variables.collections.length} collections, ${variables.variables.length} variables)`)

  const tokens = extractTokens(root)
  wj(path.join(outDir, 'design/tokens.json'), tokens)
  log(`design/tokens.json  (${tokens.colors.length} colors, ${tokens.typography.length} type styles, ${tokens.spacing.length} spacing values)`)

  /* vectors: icons/logos become SVG files and the tree points at them */
  const fileBySvg = new Map(), usedNames = new Set()
  ;(function walk(n) {
    // a container with its own fill (button, badge) stays in the tree; only the glyph inside becomes SVG
    const ownFill = (n.fills || []).some(f => f.type === 'SOLID')
    const glyph = isGlyphLeaf(n) ? SVG_LEAF_TYPES.has(n.type) : !ownFill
    if (n !== root && n.visible !== false && glyph && isVectorOnly(n)) {
      let svg
      try { svg = svgOf(n) } catch (e) { warn(`SVG export failed for "${n.name}" (${n.id}): ${e.message}`); return }
      if (!fileBySvg.has(svg)) {
        let file = `${slug(n.componentName || n.name)}.svg`
        if (usedNames.has(file)) file = `${slug(n.componentName || n.name)}-${n.id.replace(/[:;]/g, '-')}.svg`
        usedNames.add(file)
        wt(path.join(outDir, 'assets/vectors', file), svg)
        fileBySvg.set(svg, file)
      }
      n.svgPath = `assets/vectors/${fileBySvg.get(svg)}`
      return
    }
    ;(n.children || []).forEach(walk)
  })(root)
  log(`assets/vectors/  (${fileBySvg.size} SVG icons/vectors)`)
  const missing = []
  ;(function walk(n) {
    if (n.visible === false || n.svgPath) return
    if (SVG_LEAF_TYPES.has(n.type) && !isGlyphLeaf(n)) missing.push(`"${n.name}" (${n.id})`)
    ;(n.children || []).forEach(walk)
  })(root)
  if (missing.length) warn(`${missing.length} vector(s) have no geometry in the file and were not exported — check them in the PNG: ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? ', …' : ''}`)

  const tree = buildTree(root, MAX_DEPTH)
  wj(path.join(outDir, 'layout/tree.json'), tree)
  const frames = listFrames(root)
  wj(path.join(outDir, 'layout/frames.json'), frames)
  log(`layout/tree.json  layout/frames.json  (${frames.length} frames)`)

  const { md, count } = copyMarkdown(root)
  wt(path.join(outDir, 'content/copy.md'), md)
  log(`content/copy.md  (${count} text nodes)`)

  /* image fills: the .fig carries the original files, named by sha1 */
  const fills = {}
  ;(function walk(n) {
    for (const f of n.fills || []) {
      if (f.type !== 'IMAGE' || !f.imageRef) continue
      const entry = fills[f.imageRef] || (fills[f.imageRef] = { name: f.imageName || null, file: null, usedBy: [] })
      const b = n.absoluteBoundingBox
      if (entry.usedBy.length < 10) entry.usedBy.push({ id: n.id, name: n.name, size: b ? [Math.round(b.width), Math.round(b.height)] : null })
    }
    ;(n.children || []).forEach(walk)
  })(root)
  for (const [ref, entry] of Object.entries(fills)) {
    const read = imageFiles.get(ref)
    if (!read) { warn(`Image ${ref} ("${entry.name}") is referenced but not embedded in the .fig`); continue }
    const data = read()
    const ext = data[0] === 0x89 ? 'png' : data[0] === 0xff ? 'jpg' : data.toString('latin1', 0, 4) === 'GIF8' ? 'gif'
      : data.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : 'bin'
    entry.file = `assets/fills/${ref}.${ext}`
    fs.writeFileSync(path.join(outDir, entry.file), data)
  }
  wj(path.join(outDir, 'assets/fills.json'), fills)
  log(`assets/fills/  (${Object.keys(fills).length} image fills)`)

  if (thumbnail) {
    fs.writeFileSync(path.join(outDir, 'assets/images/file-thumbnail.png'), thumbnail)
    log('assets/images/file-thumbnail.png')
  }
  warn('A .fig has no per-frame renders: assets/images/ only holds the file thumbnail. For pixel reference, export the frames as PNG in Figma (2×) into assets/images/<frame-id>.png')

  const readme = generateReadme({
    header: `Figma local file · ${date}\nSource: \`${path.resolve(FIG_PATH)}\` (fig-kiwi v${version})\nNode: \`${root.id}\` · Page: "${pages.find(p => isInside(rootRaw, p))?.name || '?'}"`,
    warnings, root, tokens, frames, styleCount: styles.length,
    fileRows: [
      ['node.json', 'Node data converted to the Figma REST API shape'],
      ['design/tokens.json', 'Colors (with bound variable), typography, spacing, radii'],
      ['design/styles.json', 'Named styles with resolved values'],
      ['design/variables.json', 'Variable collections with resolved values per mode'],
      ['layout/tree.json', 'Simplified node tree'],
      ['layout/frames.json', 'Top-level frame summary'],
      ['content/copy.md', 'All visible text content'],
      ['assets/fills/', 'Original image fill files (photos, packshots)'],
      ['assets/fills.json', 'Image ref → file, name and the nodes using it'],
      ['assets/vectors/', 'Icons/vectors rebuilt as SVG'],
      ['assets/images/', 'File thumbnail only (no frame renders in a .fig)'],
    ],
  })
  wt(path.join(outDir, 'README.md'), readme)
  log('README.md')

  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`)
    warnings.forEach(w => console.log(`  - ${w}`))
  }
  console.log(`\nBundle: ${outDir}`)
  console.log('  Read README.md first.')
}

function isInside(n, page) {
  for (let c = n; c; c = byGuid.get(gid(c.parentIndex?.guid))) if (c === page) return true
  return false
}

try { main() } catch (e) { console.error(e.stack || e.message); process.exit(1) }
