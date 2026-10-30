#!/usr/bin/env node
/**
 * figma-scrape extraction engine.
 *
 * Calls the Figma REST API v1 to pull a selected node (frame, component, or
 * section) into a self-describing reference bundle: node tree, design tokens,
 * named styles, variables, image exports, and copy.
 *
 * Requires Node 18+ (built-in fetch). No npm dependencies.
 *
 * Usage: node extract.mjs <figma-url> [options]   (--help for all flags)
 */
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

/* ------------------------------------------------------------------ args -- */

const argv = process.argv.slice(2)
const flag = n => argv.includes('--' + n)
const opt  = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 || i >= argv.length - 1 ? d : argv[i + 1] }

if (!argv.length || flag('help') || argv[0].startsWith('-')) {
  console.log(`
figma-scrape extraction engine

  node extract.mjs <figma-url> [options]

  --out <dir>        output root                        (default: figma)
  --name <slug>      bundle folder name                 (default: derived from url)
  --scale <n>        PNG export scale 1|2|3             (default: 2)
  --depth <n>        max depth for simplified tree      (default: 12)
  --no-images        skip PNG exports entirely
  --no-vectors       skip SVG exports
  --token <pat>      inline Figma PAT (default: $FIGMA_TOKEN)
`)
  process.exit(argv.length && !flag('help') ? 1 : 0)
}

const FIGMA_URL = argv[0]
const TOKEN     = opt('token', process.env.FIGMA_TOKEN)
const SCALE     = parseInt(opt('scale', '2'), 10)
const MAX_DEPTH = parseInt(opt('depth', '12'), 10)
const NO_IMAGES = flag('no-images')
const NO_VECTORS = flag('no-vectors')

if (!TOKEN) {
  console.error('Error: Figma token required.')
  console.error('  Set FIGMA_TOKEN env var or pass --token <pat>')
  console.error('  Create a PAT: Figma → Settings → Security → Personal access tokens')
  process.exit(1)
}

/* --------------------------------------------------------------- helpers -- */

const mk   = d  => fs.mkdirSync(d, { recursive: true })
const wj   = (f, o) => { mk(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(o, null, 2)) }
const wt   = (f, s) => { mk(path.dirname(f)); fs.writeFileSync(f, s) }
const log  = (...a) => console.log(' ·', ...a)
const warn = msg => { warnings.push(msg); console.warn(' ⚠', msg) }

function slugFrom(url) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const fileIdx = parts.findIndex(p => p === 'design' || p === 'file' || p === 'proto')
    const name  = parts[fileIdx + 2] || parts[fileIdx + 1] || 'figma'
    const nodeId = u.searchParams.get('node-id') || ''
    return (decodeURIComponent(name) + (nodeId ? '-' + nodeId : ''))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  } catch { return 'figma-capture' }
}

function parseFigmaUrl(url) {
  const m = url.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9_-]+)/)
  if (!m) throw new Error(`Cannot parse Figma URL: ${url}`)
  const fileKey = m[1]
  const u = new URL(url)
  const rawNodeId = u.searchParams.get('node-id')
  const nodeId = rawNodeId ? rawNodeId.replace(/-/g, ':') : null
  return { fileKey, nodeId }
}

const warnings = []

/* --------------------------------------------------------------- api -- */

const API = 'https://api.figma.com/v1'

async function figmaGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'X-Figma-Token': TOKEN, Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Figma API ${res.status} on ${path}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function downloadTo(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`)
  mk(path.dirname(dest))
  await pipeline(res.body, createWriteStream(dest))
}

/* -------------------------------------------------------- token extraction -- */

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

function extractTokens(root) {
  const colors   = new Map()
  const fonts    = new Map()
  const spacing  = new Set()
  const radii    = new Set()

  function walk(n) {
    ;(n.fills || []).forEach(f => {
      if (f.type === 'SOLID' && f.color) {
        const hex = toHex(f.color.r, f.color.g, f.color.b)
        const opacity = f.opacity !== undefined ? Math.round(f.opacity * 100) / 100 : 1
        const key = opacity < 1 ? `${hex}@${opacity}` : hex
        const entry = colors.get(key) || { hex, opacity, count: 0, seenIn: [] }
        entry.count++
        if (n.name && !entry.seenIn.includes(n.name)) entry.seenIn.push(n.name)
        colors.set(key, entry)
      }
    })
    ;(n.strokes || []).forEach(f => {
      if (f.type === 'SOLID' && f.color) {
        const hex = toHex(f.color.r, f.color.g, f.color.b)
        if (!colors.has(hex)) colors.set(hex, { hex, opacity: 1, count: 0, seenIn: [] })
        colors.get(hex).count++
      }
    })
    if (n.type === 'TEXT' && n.style) {
      const s = n.style
      const key = `${s.fontFamily}/${s.fontWeight}/${Math.round(s.fontSize)}`
      const entry = fonts.get(key) || {
        family: s.fontFamily,
        weight: s.fontWeight,
        size: Math.round(s.fontSize),
        lineHeightPx: s.lineHeightPx ? Math.round(s.lineHeightPx) : null,
        letterSpacing: s.letterSpacing || 0,
        textCase: s.textCase || null,
        count: 0,
      }
      entry.count++
      fonts.set(key, entry)
    }
    if (n.layoutMode) {
      ;['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing'].forEach(p => {
        if (n[p] != null && n[p] > 0) spacing.add(n[p])
      })
    }
    if (n.cornerRadius > 0) radii.add(n.cornerRadius)
    ;(n.rectangleCornerRadii || []).forEach(r => r > 0 && radii.add(r))
    ;(n.children || []).forEach(walk)
  }
  walk(root)

  return {
    colors:     [...colors.values()].sort((a, b) => b.count - a.count),
    typography: [...fonts.values()].sort((a, b) => b.count - a.count),
    spacing:    [...spacing].sort((a, b) => a - b),
    radii:      [...radii].sort((a, b) => a - b),
  }
}

/* ---------------------------------------------------------- simplified tree -- */

function buildTree(n, depth = 0) {
  const out = { id: n.id, name: n.name, type: n.type }

  if (n.absoluteBoundingBox) {
    const b = n.absoluteBoundingBox
    out.box = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
  }

  if (n.opacity !== undefined && n.opacity < 1) out.opacity = n.opacity
  if (n.visible === false) out.hidden = true

  const fill = (n.fills || []).find(f => f.type === 'SOLID' && f.color)
  if (fill) out.fill = toHex(fill.color.r, fill.color.g, fill.color.b)

  if (n.type === 'TEXT') {
    out.text = n.characters
    if (n.style) {
      out.font = {
        family: n.style.fontFamily,
        size:   Math.round(n.style.fontSize),
        weight: n.style.fontWeight,
      }
      if (n.style.lineHeightPx) out.font.lineHeightPx = Math.round(n.style.lineHeightPx)
    }
  }

  if (n.layoutMode) {
    out.layout = {
      mode:       n.layoutMode,
      gap:        n.itemSpacing || 0,
      padding:    [n.paddingTop || 0, n.paddingRight || 0, n.paddingBottom || 0, n.paddingLeft || 0],
      align:      n.primaryAxisAlignItems,
      crossAlign: n.counterAxisAlignItems,
      wrap:       n.layoutWrap || null,
    }
  }

  if (n.componentId)    out.componentId    = n.componentId
  if (n.componentSetId) out.componentSetId = n.componentSetId
  if (n.styles)         out.styleRefs      = n.styles

  if (n.children) {
    if (depth < MAX_DEPTH) {
      out.children = n.children.map(c => buildTree(c, depth + 1))
    } else {
      out.childCount = n.children.length
    }
  }

  return out
}

/* ------------------------------------------------------------- text extract -- */

function extractText(root) {
  const sections = []

  function walk(n, sectionName) {
    if (n.type === 'TEXT' && n.characters) {
      let sec = sections.find(s => s.name === sectionName)
      if (!sec) { sec = { name: sectionName, texts: [] }; sections.push(sec) }
      sec.texts.push(n.characters.trim())
    }
    const next = ['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(n.type) ? n.name : sectionName
    ;(n.children || []).forEach(c => walk(c, next))
  }
  walk(root, root.name)
  return sections
}

/* ------------------------------------------------------------ frame collect -- */

function collectExportIds(root) {
  const ids = [root.id]
  ;(root.children || [])
    .filter(c => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'GROUP'].includes(c.type))
    .forEach(c => ids.push(c.id))
  return ids
}

/* ------------------------------------------------------------------ readme -- */

function generateReadme({ slug, FIGMA_URL, fileKey, nodeId, root, tokens, frames, styleCount, date }) {
  const colorRows = tokens.colors.slice(0, 12).map(c =>
    `| \`${c.hex}\` | ${c.opacity < 1 ? c.opacity : '—'} | ${c.count} | ${c.seenIn.slice(0, 2).join(', ')} |`
  ).join('\n')

  const typeRows = tokens.typography.slice(0, 10).map(t =>
    `| ${t.family} | ${t.weight} | ${t.size}px | ${t.lineHeightPx ? t.lineHeightPx + 'px' : '—'} | ${t.count} |`
  ).join('\n')

  const frameRows = frames.map(f =>
    `| ${f.name} | ${f.type} | ${f.width} × ${f.height} |`
  ).join('\n')

  const warnBlock = warnings.length
    ? `\n## Warnings\n\n${warnings.map(w => `- ${w}`).join('\n')}\n`
    : ''

  return `# ${root.name}

Figma scrape · ${date}
Source: ${FIGMA_URL}
File: \`${fileKey}\` · Node: \`${nodeId || 'root'}\`
${warnBlock}
## Summary

**Type**: ${root.type}
**Top-level children**: ${root.children?.length || 0}
**Named styles in file**: ${styleCount}
**Exportable frames**: ${frames.length}

## Files

| File | Contents |
|---|---|
| \`node.json\` | Raw Figma API node data |
| \`design/tokens.json\` | Colors, typography, spacing, radii |
| \`design/styles.json\` | Named styles (fill, text, effect, grid) |
| \`design/variables.json\` | Variable collections (Pro/Org) |
| \`layout/tree.json\` | Simplified node tree |
| \`layout/frames.json\` | Top-level frame summary |
| \`content/copy.md\` | All text content |
| \`assets/images/\` | PNG exports at ${SCALE}× |
| \`assets/vectors/\` | SVG exports |
| \`assets/fills.json\` | Image fill URLs |

## Frames

| Name | Type | Size |
|---|---|---|
${frameRows || '(none)'}

## Color palette (top ${Math.min(12, tokens.colors.length)})

| Hex | Opacity | Uses | Context |
|---|---|---|---|
${colorRows || '(none found)'}

Spacing scale: \`${tokens.spacing.join('  ')}\`
Border radii: \`${tokens.radii.join('  ')}\`

## Typography (top ${Math.min(10, tokens.typography.length)})

| Family | Weight | Size | Line height | Uses |
|---|---|---|---|---|
${typeRows || '(none found)'}

## How to use

1. **Tokens** → \`design/tokens.json\` : map colors/type/spacing to your theme layer before writing any component
2. **Structure** → \`layout/tree.json\` : component hierarchy, auto-layout config, bounding boxes
3. **Copy** → \`content/copy.md\` : use verbatim — do not paraphrase unless asked
4. **Images** → \`assets/images/\` : pixel-truth reference for your rebuild; never ship these as implementation
5. **Variables** → \`design/variables.json\` : prefer these over raw tokens if populated
`
}

/* ------------------------------------------------------------------- main -- */

async function main() {
  const { fileKey, nodeId } = parseFigmaUrl(FIGMA_URL)
  const slug   = opt('name', slugFrom(FIGMA_URL))
  const outDir = path.resolve(opt('out', 'figma'), slug)
  const date   = new Date().toISOString().split('T')[0]

  console.log(`figma-scrape: ${slug}`)
  console.log(`  file: ${fileKey}  node: ${nodeId || '(root)'}`)
  console.log(`  out:  ${outDir}`)

  mk(outDir)
  ;['design', 'layout', 'content', 'assets/images', 'assets/vectors'].forEach(d =>
    mk(path.join(outDir, d)))

  /* 1 — node data ------------------------------------------------------- */
  log('Fetching node data...')
  let root
  try {
    if (nodeId) {
      const res = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`)
      root = res.nodes?.[nodeId]?.document
      if (!root) throw new Error(`Node ${nodeId} not found in response`)
    } else {
      const res = await figmaGet(`/files/${fileKey}?geometry=paths`)
      root = res.document
    }
  } catch (e) {
    console.error(`Fatal: ${e.message}`)
    process.exit(1)
  }
  wj(path.join(outDir, 'node.json'), root)
  log(`node.json  (${root.type}: "${root.name}", ${root.children?.length || 0} children)`)

  /* 2 — named styles ---------------------------------------------------- */
  log('Fetching named styles...')
  let styleCount = 0
  try {
    const res = await figmaGet(`/files/${fileKey}/styles`)
    const styles = res.meta?.styles || []
    styleCount = styles.length
    wj(path.join(outDir, 'design/styles.json'), styles)
    log(`design/styles.json  (${styles.length} styles)`)
  } catch (e) {
    warn(`Named styles unavailable: ${e.message}`)
    wj(path.join(outDir, 'design/styles.json'), [])
  }

  /* 3 — variables ------------------------------------------------------- */
  log('Fetching variables...')
  try {
    const res = await figmaGet(`/files/${fileKey}/variables/local`)
    wj(path.join(outDir, 'design/variables.json'), res)
    const colCount = Object.keys(res.meta?.variableCollections || {}).length
    log(`design/variables.json  (${colCount} collections)`)
  } catch (e) {
    const msg = e.message.includes('403') || e.message.includes('404')
      ? 'Variables require Pro/Org plan or are not used in this file'
      : e.message
    warn(`Variables unavailable: ${msg}`)
    wj(path.join(outDir, 'design/variables.json'), { error: 'Not available', reason: msg })
  }

  /* 4 — design tokens --------------------------------------------------- */
  log('Extracting design tokens...')
  const tokens = extractTokens(root)
  wj(path.join(outDir, 'design/tokens.json'), tokens)
  log(`design/tokens.json  (${tokens.colors.length} colors, ${tokens.typography.length} type styles, ${tokens.spacing.length} spacing values)`)

  /* 5 — simplified tree + frames --------------------------------------- */
  log('Building layout tree...')
  const tree = buildTree(root)
  wj(path.join(outDir, 'layout/tree.json'), tree)
  const frames = (root.children || [])
    .filter(c => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'GROUP'].includes(c.type))
    .map(f => ({
      id:     f.id,
      name:   f.name,
      type:   f.type,
      width:  Math.round(f.absoluteBoundingBox?.width  || 0),
      height: Math.round(f.absoluteBoundingBox?.height || 0),
    }))
  wj(path.join(outDir, 'layout/frames.json'), frames)
  log(`layout/tree.json  layout/frames.json  (${frames.length} frames)`)

  /* 6 — text content ---------------------------------------------------- */
  log('Extracting text...')
  const sections = extractText(root)
  const copyMd = `# ${root.name}\n\n` +
    sections.map(s => `## ${s.name}\n\n${s.texts.join('\n\n')}`).join('\n\n---\n\n')
  wt(path.join(outDir, 'content/copy.md'), copyMd)
  const textCount = sections.reduce((n, s) => n + s.texts.length, 0)
  log(`content/copy.md  (${textCount} text nodes)`)

  /* 7 — image exports --------------------------------------------------- */
  const exportIds = collectExportIds(root)
  const idsParam  = exportIds.join(',')

  if (!NO_IMAGES && exportIds.length > 0) {
    log(`Exporting PNGs for ${exportIds.length} node(s) at ${SCALE}×...`)
    try {
      const res = await figmaGet(
        `/images/${fileKey}?ids=${encodeURIComponent(idsParam)}&format=png&scale=${SCALE}`)
      const images = res.images || {}
      wj(path.join(outDir, 'assets/images.json'), images)
      let ok = 0, failed = 0
      for (const [id, url] of Object.entries(images)) {
        if (!url) { failed++; continue }
        const dest = path.join(outDir, `assets/images/${id.replace(/:/g, '-')}.png`)
        try { await downloadTo(url, dest); ok++ }
        catch (e) { warn(`PNG download failed for ${id}: ${e.message}`); failed++ }
      }
      log(`assets/images/  (${ok} downloaded${failed ? `, ${failed} failed` : ''})`)
    } catch (e) {
      warn(`PNG export request failed: ${e.message}`)
    }
  }

  if (!NO_VECTORS && exportIds.length > 0) {
    log(`Exporting SVGs for ${exportIds.length} node(s)...`)
    try {
      const res = await figmaGet(
        `/images/${fileKey}?ids=${encodeURIComponent(idsParam)}&format=svg&svg_include_id=true`)
      const images = res.images || {}
      let ok = 0, failed = 0
      for (const [id, url] of Object.entries(images)) {
        if (!url) { failed++; continue }
        const dest = path.join(outDir, `assets/vectors/${id.replace(/:/g, '-')}.svg`)
        try { await downloadTo(url, dest); ok++ }
        catch (e) { warn(`SVG download failed for ${id}: ${e.message}`); failed++ }
      }
      log(`assets/vectors/  (${ok} downloaded${failed ? `, ${failed} failed` : ''})`)
    } catch (e) {
      warn(`SVG export request failed: ${e.message}`)
    }
  }

  /* 8 — image fills ----------------------------------------------------- */
  log('Fetching image fills...')
  try {
    const res = await figmaGet(`/files/${fileKey}/images`)
    wj(path.join(outDir, 'assets/fills.json'), res.meta?.images || {})
    log(`assets/fills.json`)
  } catch (e) {
    warn(`Image fills unavailable: ${e.message}`)
    wj(path.join(outDir, 'assets/fills.json'), {})
  }

  /* 9 — README ---------------------------------------------------------- */
  log('Generating README...')
  const readme = generateReadme({ slug, FIGMA_URL, fileKey, nodeId, root, tokens, frames, styleCount, date })
  wt(path.join(outDir, 'README.md'), readme)
  log('README.md')

  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`)
    warnings.forEach(w => console.log(`  - ${w}`))
  }

  console.log(`\nBundle: ${outDir}`)
  console.log('  Read README.md first.')
}

main().catch(e => { console.error(e.message); process.exit(1) })
