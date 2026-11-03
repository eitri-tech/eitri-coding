/**
 * Bundle builders shared by extract.mjs (REST API) and fig-extract.mjs (.fig file).
 * Both feed nodes in the Figma REST API shape, so the bundle layout is identical.
 */
import fs from 'node:fs'
import path from 'node:path'

export const mk = d => fs.mkdirSync(d, { recursive: true })
export const wj = (f, o) => { mk(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(o, null, 2)) }
export const wt = (f, s) => { mk(path.dirname(f)); fs.writeFileSync(f, s) }

export const FRAME_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'GROUP', 'INSTANCE', 'SECTION']

export function toHex(r, g, b, a = 1) {
  const hex = '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
  return a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex
}

const solid = list => (list || []).find(f => f.type === 'SOLID' && f.color && f.visible !== false)
const round2 = v => Math.round(v * 100) / 100

/* -------------------------------------------------------- token extraction -- */

export function extractTokens(root) {
  const colors   = new Map()
  const fonts    = new Map()
  const spacing  = new Set()
  const radii    = new Set()

  function walk(n) {
    ;(n.fills || []).forEach(f => {
      if (f.type === 'SOLID' && f.color && f.visible !== false) {
        const hex = toHex(f.color.r, f.color.g, f.color.b)
        const opacity = f.opacity !== undefined ? round2(f.opacity) : 1
        const key = opacity < 1 ? `${hex}@${opacity}` : hex
        const entry = colors.get(key) || { hex, opacity, count: 0, seenIn: [] }
        entry.count++
        if (f.variableName && !entry.variable) entry.variable = f.variableName
        if (n.name && !entry.seenIn.includes(n.name)) entry.seenIn.push(n.name)
        colors.set(key, entry)
      }
    })
    ;(n.strokes || []).forEach(f => {
      if (f.type === 'SOLID' && f.color && f.visible !== false) {
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
        style: n.styles?.text || null,
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

function fontOf(s) {
  const font = { family: s.fontFamily, size: Math.round(s.fontSize), weight: s.fontWeight }
  if (s.fontStyle && /italic/i.test(s.fontStyle)) font.italic = true
  if (s.lineHeightPx) font.lineHeightPx = Math.round(s.lineHeightPx)
  if (s.letterSpacing) font.letterSpacing = round2(s.letterSpacing)
  if (s.textCase) font.textCase = s.textCase
  if (s.textDecoration && s.textDecoration !== 'NONE') font.decoration = s.textDecoration
  if (s.textAlignHorizontal && s.textAlignHorizontal !== 'LEFT') font.align = s.textAlignHorizontal
  return font
}

const intersects = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) >= 1
  && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= 1

export function buildTree(n, maxDepth = 12, depth = 0, origin = n.absoluteBoundingBox) {
  const out = { id: n.id, name: n.name, type: n.type }

  if (n.absoluteBoundingBox) {
    const b = n.absoluteBoundingBox
    out.box = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
    if (depth > 0 && origin) out.rel = [Math.round(b.x - origin.x), Math.round(b.y - origin.y)]
  }
  if (n.layoutSizingHorizontal || n.layoutSizingVertical) {
    out.sizing = [n.layoutSizingHorizontal || 'FIXED', n.layoutSizingVertical || 'FIXED']
  }
  if (n.layoutPositioning === 'ABSOLUTE') out.absolute = true

  if (n.opacity !== undefined && n.opacity < 1) out.opacity = round2(n.opacity)
  if (n.visible === false) out.hidden = true

  const fill = solid(n.fills)
  if (fill) {
    out.fill = toHex(fill.color.r, fill.color.g, fill.color.b, (fill.opacity ?? 1) * (fill.color.a ?? 1))
    if (fill.variableName) out.fillVar = fill.variableName
  }
  const grad = (n.fills || []).find(f => f.type?.startsWith('GRADIENT') && f.visible !== false)
  if (grad && grad.gradientStops) {
    out.gradient = {
      type: grad.type,
      stops: grad.gradientStops.map(s => `${toHex(s.color.r, s.color.g, s.color.b, s.color.a ?? 1)} ${Math.round(s.position * 100)}%`),
    }
  }
  const img = (n.fills || []).find(f => f.type === 'IMAGE' && f.visible !== false)
  if (img && img.imageRef) out.image = { ref: img.imageRef, scaleMode: img.scaleMode }

  const stroke = solid(n.strokes)
  if (stroke && n.strokeWeight) {
    out.stroke = { color: toHex(stroke.color.r, stroke.color.g, stroke.color.b), weight: round2(n.strokeWeight) }
    if (stroke.variableName) out.stroke.var = stroke.variableName
  }
  const radii = n.rectangleCornerRadii
  if (radii && new Set(radii).size > 1) out.radius = radii
  else if (n.cornerRadius > 0) out.radius = round2(n.cornerRadius)
  else if (radii?.[0] > 0) out.radius = round2(radii[0])

  const shadows = (n.effects || []).filter(e => e.visible !== false && /SHADOW/.test(e.type))
  if (shadows.length) {
    out.shadow = shadows.map(e =>
      `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${round2(e.offset?.x || 0)}px ${round2(e.offset?.y || 0)}px ${round2(e.radius || 0)}px ${round2(e.spread || 0)}px ${toHex(e.color.r, e.color.g, e.color.b, e.color.a ?? 1)}`)
  }
  const blur = (n.effects || []).find(e => e.visible !== false && /BLUR/.test(e.type))
  if (blur) out.blur = { type: blur.type, radius: round2(blur.radius || 0) }

  if (n.type === 'TEXT') {
    out.text = n.characters
    if (n.style) out.font = fontOf(n.style)
    if (n.textRuns?.length > 1) {
      out.runs = n.textRuns.map(r => {
        const run = { text: r.characters }
        if (r.style) Object.assign(run, fontOf(r.style))
        const f = solid(r.fills)
        if (f) run.fill = toHex(f.color.r, f.color.g, f.color.b)
        return run
      })
    }
    if (n.maxLines) out.maxLines = n.maxLines
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
  if (n.componentName)  out.component      = n.componentName
  if (n.componentSetId) out.componentSetId = n.componentSetId
  if (n.styles)         out.styleRefs      = n.styles
  if (n.fieldVars)      out.vars           = n.fieldVars
  if (n.svgPath) {
    out.svg = n.svgPath
    if (n.children) out.childCount = n.children.length
    return out
  }

  if (n.children) {
    if (depth < maxDepth) {
      out.children = n.children.map(c => buildTree(c, maxDepth, depth + 1, origin))
      // siblings paint in array order (later = on top); overlaps flag backgrounds and decorations crossing other blocks
      n.children.forEach((a, i) => {
        if (a.visible === false || !a.absoluteBoundingBox) return
        const hits = n.children.filter((b, j) => j !== i && b.visible !== false && b.absoluteBoundingBox
          && intersects(a.absoluteBoundingBox, b.absoluteBoundingBox)).map(b => b.id)
        if (hits.length) out.children[i].overlaps = hits
      })
    } else {
      out.childCount = n.children.length
    }
  }

  return out
}

/* ------------------------------------------------------------- text extract -- */

export function extractText(root) {
  const sections = []

  function walk(n, sectionName) {
    if (n.visible === false) return
    if (n.type === 'TEXT' && n.characters) {
      let sec = sections.find(s => s.name === sectionName)
      if (!sec) { sec = { name: sectionName, texts: [] }; sections.push(sec) }
      sec.texts.push(n.characters.trim())
    }
    const next = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(n.type) ? n.name : sectionName
    ;(n.children || []).forEach(c => walk(c, next))
  }
  walk(root, root.name)
  return sections
}

export function copyMarkdown(root) {
  const sections = extractText(root)
  return {
    md: `# ${root.name}\n\n` + sections.map(s => `## ${s.name}\n\n${s.texts.join('\n\n')}`).join('\n\n---\n\n'),
    count: sections.reduce((n, s) => n + s.texts.length, 0),
  }
}

/* ------------------------------------------------------------ frame collect -- */

export function listFrames(root) {
  return (root.children || [])
    .filter(c => FRAME_TYPES.includes(c.type))
    .map(f => ({
      id:     f.id,
      name:   f.name,
      type:   f.type,
      width:  Math.round(f.absoluteBoundingBox?.width  || 0),
      height: Math.round(f.absoluteBoundingBox?.height || 0),
      ...(f.visible === false ? { hidden: true } : {}),
    }))
}

/* ------------------------------------------------------------------ readme -- */

export function generateReadme({ header, warnings = [], root, tokens, frames, styleCount, fileRows }) {
  const colorRows = tokens.colors.slice(0, 12).map(c =>
    `| \`${c.hex}\` | ${c.opacity < 1 ? c.opacity : '—'} | ${c.variable ? `\`${c.variable}\`` : '—'} | ${c.count} | ${c.seenIn.slice(0, 2).join(', ')} |`
  ).join('\n')

  const typeRows = tokens.typography.slice(0, 10).map(t =>
    `| ${t.family} | ${t.weight} | ${t.size}px | ${t.lineHeightPx ? t.lineHeightPx + 'px' : '—'} | ${t.style || '—'} | ${t.count} |`
  ).join('\n')

  const frameRows = frames.map(f =>
    `| ${f.name} | \`${f.id}\` | ${f.type} | ${f.width} × ${f.height} |`
  ).join('\n')

  const warnBlock = warnings.length
    ? `\n## Warnings\n\n${warnings.map(w => `- ${w}`).join('\n')}\n`
    : ''

  return `# ${root.name}

${header}
${warnBlock}
## Summary

**Type**: ${root.type}
**Top-level children**: ${root.children?.length || 0}
**Named styles in file**: ${styleCount}
**Exportable frames**: ${frames.length}

## Files

| File | Contents |
|---|---|
${fileRows.map(([f, c]) => `| \`${f}\` | ${c} |`).join('\n')}

## Frames

| Name | Id | Type | Size |
|---|---|---|---|
${frameRows || '(none)'}

## Color palette (top ${Math.min(12, tokens.colors.length)})

| Hex | Opacity | Variable | Uses | Context |
|---|---|---|---|---|
${colorRows || '(none found)'}

Spacing scale: \`${tokens.spacing.join('  ')}\`
Border radii: \`${tokens.radii.join('  ')}\`

## Typography (top ${Math.min(10, tokens.typography.length)})

| Family | Weight | Size | Line height | Style | Uses |
|---|---|---|---|---|---|
${typeRows || '(none found)'}

## How to use

1. **Tokens** → \`design/tokens.json\` : map colors/type/spacing to your theme layer before writing any component
2. **Structure** → \`layout/tree.json\` : component hierarchy, auto-layout config, sizing (FIXED/HUG/FILL), bounding boxes
3. **Copy** → \`content/copy.md\` : use verbatim — do not paraphrase unless asked
4. **Images** → \`assets/images/\` : pixel-truth reference for your rebuild; never ship these as implementation
5. **Variables** → \`design/variables.json\` : prefer these over raw tokens if populated
`
}
