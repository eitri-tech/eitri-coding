#!/usr/bin/env node
/**
 * figma-scrape extraction engine.
 *
 * Calls the Figma REST API v1 to pull a selected node (frame, component, or
 * section) into a self-describing reference bundle: node tree, design tokens,
 * named styles, variables, image exports, and copy.
 *
 * Requires Node 18+ (built-in fetch). No npm dependencies.
 * For a local .fig file use fig-extract.mjs, which writes the same bundle.
 *
 * Usage: node extract.mjs <figma-url> [options]   (--help for all flags)
 */
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mk, wj, wt, extractTokens, buildTree, copyMarkdown, listFrames, generateReadme } from './lib/bundle.mjs'

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

/* ------------------------------------------------------------ frame collect -- */

function collectExportIds(root) {
  const ids = [root.id]
  ;(root.children || [])
    .filter(c => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'GROUP'].includes(c.type))
    .forEach(c => ids.push(c.id))
  return ids
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
  const tree = buildTree(root, MAX_DEPTH)
  wj(path.join(outDir, 'layout/tree.json'), tree)
  const frames = listFrames(root)
  wj(path.join(outDir, 'layout/frames.json'), frames)
  log(`layout/tree.json  layout/frames.json  (${frames.length} frames)`)

  /* 6 — text content ---------------------------------------------------- */
  log('Extracting text...')
  const { md: copyMd, count: textCount } = copyMarkdown(root)
  wt(path.join(outDir, 'content/copy.md'), copyMd)
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
  const readme = generateReadme({
    header: `Figma scrape · ${date}\nSource: ${FIGMA_URL}\nFile: \`${fileKey}\` · Node: \`${nodeId || 'root'}\``,
    warnings, root, tokens, frames, styleCount,
    fileRows: [
      ['node.json', 'Raw Figma API node data'],
      ['design/tokens.json', 'Colors, typography, spacing, radii'],
      ['design/styles.json', 'Named styles (fill, text, effect, grid)'],
      ['design/variables.json', 'Variable collections (Pro/Org)'],
      ['layout/tree.json', 'Simplified node tree'],
      ['layout/frames.json', 'Top-level frame summary'],
      ['content/copy.md', 'All text content'],
      ['assets/images/', `PNG exports at ${SCALE}×`],
      ['assets/vectors/', 'SVG exports'],
      ['assets/fills.json', 'Image fill URLs'],
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

main().catch(e => { console.error(e.message); process.exit(1) })
