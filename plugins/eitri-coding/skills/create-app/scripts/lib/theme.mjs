// Turns a store's brand into the two theme layers an Eitri app reads:
// - Luminus v2: a DaisyUI theme named "eitri" (colors + radius), the shape
//   the Console's Luminus V2.x editor saves.
// - Luminus v1 global CSS: brand fonts (@font-face + .font-primary / .font-main,
//   or a legacy @import) and the body font, background and text
//   (fonts go through V1.x even on Luminus v2 apps).

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const WHITE = "#ffffff"
const DARK = "#1f2937"
const STATUS = { info: "#3b82f6", success: "#22c55e", warning: "#f59e0b", error: "#ef4444" }
/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5

function normalizeHex(value, name) {
    if (typeof value !== "string" || !HEX.test(value.trim())) throw new Error(`${name} must be a hex color like #0a2463, got ${JSON.stringify(value)}`)
    const hex = value.trim().toLowerCase()
    return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex
}

function channels(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

function toHex(rgb) {
    return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`
}

function luminance(hex) {
    const [r, g, b] = channels(hex).map((c) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/** White or dark text, whichever reads better on `background`. */
function contentFor(background) {
    return contrastRatio(background, WHITE) >= contrastRatio(background, DARK) ? WHITE : DARK
}

function mix(from, to, amount) {
    const a = channels(from)
    const b = channels(to)
    return toHex(a.map((c, i) => c * (1 - amount) + b[i] * amount))
}

/** The shade of `background` nearest to it (toward black under light text, white under dark) that reaches MIN_CONTRAST with `content`. */
function passingShade(background, content) {
    const toward = luminance(content) > luminance(background) ? "#000000" : WHITE
    for (let step = 1; step <= 100; step++) {
        const shade = mix(background, toward, step / 100)
        if (contrastRatio(shade, content) >= MIN_CONTRAST) return shade
    }
    return toward
}

const TAILWIND_PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
const DAISY_SLOTS = "primary|secondary|accent|neutral|base-100|base-200|base-300|base|info|success|warning|error"
/** Utilities that take a color, and their suffixes that are not colors (sizes, styles, positions). */
const COLOR_UTILITY = /(?<![\w-])(?:[a-z0-9]+:)*(bg|text|border(?:-[xytblrse])?|fill|stroke|from|via|to|ring|outline|decoration|divide|placeholder|caret|accent)-([a-z][a-z0-9-]*)(?:\/\d+)?(?![\w-]|\s*=)/g
const NOT_A_COLOR = new RegExp(
    `^(?:(?:${TAILWIND_PALETTE})-\\d{2,3}|black|white|transparent|current|inherit|(?:${DAISY_SLOTS})(?:-content)?` +
        "|xs|sm|md|lg|xl|\\dxl|base|left|center|right|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty" +
        "|cover|contain|top|bottom|no-repeat|repeat(?:-.*)?|fixed|local|scroll|gradient-to-.*|none|opacity-.*|blend-.*|auto" +
        "|solid|dashed|dotted|double|hidden|collapse|separate|inset|offset-.*|wavy|from-font|clone|slice|origin-.*|clip-.*" +
        "|[xytblrse](?:-\\d+)?|\\d.*)$",
)

/**
 * The theme colors a source's classes use beyond Tailwind's palette and
 * DaisyUI's slots (e.g. a template's `bg-header-background`): name → uses.
 * A class whose color no theme defines renders nothing, without an error.
 */
export function colorTokens(text) {
    const found = new Map()
    for (const m of text.matchAll(COLOR_UTILITY)) {
        if (NOT_A_COLOR.test(m[2])) continue
        found.set(m[2], (found.get(m[2]) ?? 0) + 1)
    }
    return found
}

/** A CSS color the theme can carry: hex or rgb()/rgba()/hsl()/hsla(). */
function normalizeColor(value, name) {
    const v = String(value ?? "").trim()
    if (HEX.test(v)) return normalizeHex(v, name)
    if (/^(?:rgba?|hsla?)\(\s*[\d.%]+\s*,?\s*[\d.%]+\s*,?\s*[\d.%]+\s*(?:[,/]\s*[\d.%]+\s*)?\)$/i.test(v)) return v
    throw new Error(`${name} must be a hex, rgb() or hsl() color, got ${JSON.stringify(value)}`)
}

/** The Console's radius scale around the `md` value (eitri-matrix LuminusV2Theme). */
function radiusScale(md) {
    const square = /^0(?:\.0+)?(?:rem|px)?$/.test(md)
    const fixed = (value) => (square ? md : value)
    return { xs: "0.125rem", sm: fixed("0.25rem"), md, lg: fixed("0.5rem"), xl: fixed("0.75rem"), "2xl": fixed("1rem"), "3xl": fixed("1.5rem"), full: "9999px" }
}

function fontStack(family) {
    const name = /[\s"']/.test(family) ? `"${family.replace(/"/g, "")}"` : family
    return `${name}, sans-serif`
}

export function buildTheme({ primary, primaryContent, secondary, secondaryContent, accent, neutral, background, text, radius = "0.5rem", font, fonts, colors = {}, usedColors = new Map() } = {}) {
    const warnings = []
    const p = normalizeHex(primary, "primary")
    const s = secondary ? normalizeHex(secondary, "secondary") : p
    const a = accent ? normalizeHex(accent, "accent") : s
    const base = background ? normalizeHex(background, "background") : WHITE
    const baseContent = text ? normalizeHex(text, "text") : contentFor(base)
    const n = neutral ? normalizeHex(neutral, "neutral") : DARK

    const eitri = {
        primary: p,
        // The store's own button text color when given; otherwise whichever reads better.
        "primary-content": primaryContent ? normalizeHex(primaryContent, "primary-content") : contentFor(p),
        secondary: s,
        "secondary-content": secondaryContent ? normalizeHex(secondaryContent, "secondary-content") : contentFor(s),
        accent: a,
        "accent-content": contentFor(a),
        neutral: n,
        "neutral-content": contentFor(n),
        "base-100": base,
        "base-200": mix(base, baseContent, 0.04),
        "base-300": mix(base, baseContent, 0.09),
        "base-content": baseContent,
    }
    for (const [name, color] of Object.entries(STATUS)) {
        eitri[name] = color
        eitri[`${name}-content`] = contentFor(color)
    }

    for (const name of ["primary", "secondary", "accent", "neutral", "base"]) {
        const bg = name === "base" ? eitri["base-100"] : eitri[name]
        const ratio = contrastRatio(bg, eitri[`${name}-content`])
        if (ratio < MIN_CONTRAST) {
            const where = name === "base" ? "base-100" : name
            warnings.push(
                `${name}-content on ${where} has contrast ${ratio.toFixed(1)}:1, below ${MIN_CONTRAST}:1: ` +
                    `${passingShade(bg, eitri[`${name}-content`])} passes as ${where} with the same text color.`,
            )
        }
    }

    // Template-specific tokens (e.g. header-background / header-content) live in theme.extend.colors.
    const extendColors = Object.fromEntries(Object.entries(colors).map(([name, value]) => [name, normalizeColor(value, name)]))
    const missing = [...usedColors].filter(([name]) => !(name in extendColors)).sort((a, b) => b[1] - a[1])
    if (missing.length) {
        warnings.push(
            `The repo's classes use theme colors this theme does not define: ${missing.map(([n, uses]) => `${n} (${uses}×)`).join(", ")}. ` +
                "Until defined, a background, border or fill in that color renders nothing and a text in it takes the inherited color: " +
                "pass --color <name>=<color from the capture> for the ones the app shows (the template's header and badges first).",
        )
    }

    const css = []
    // Brand fonts the way production apps ship them: @font-face rules plus
    // .font-primary (text) / .font-main (headings) utility classes.
    if (fonts?.primary) {
        const faces = (fonts.faces ?? "").trim()
        for (const m of faces.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
            if (!/^https:\/\//.test(m[1])) throw new Error(`font files must be https URLs (the CSS is inlined in every mini-app), got ${m[1]}`)
        }
        if (faces) css.push(faces, "")
        css.push(".font-primary {", `    font-family: ${fontStack(fonts.primary)};`, "}", "")
        css.push(".font-main {", `    font-family: ${fontStack(fonts.main || fonts.primary)};`, "}", "")
    }
    if (font?.importUrl) {
        if (!/^https:\/\//.test(font.importUrl)) throw new Error(`font import must be an https URL, got ${font.importUrl}`)
        css.push(`@import url(${font.importUrl});`, "")
    }
    css.push("body {")
    const bodyFont = fonts?.primary ?? font?.family
    if (bodyFont) css.push(`    font-family: ${fontStack(bodyFont)};`)
    css.push(`    background: ${base};`, `    color: ${baseContent};`, "}", "")

    return {
        v2: {
            daisyui: { themes: [{ eitri }], defaultTheme: "eitri", darkTheme: false },
            theme: { borderRadius: radiusScale(radius), ...(Object.keys(extendColors).length ? { extend: { colors: extendColors } } : {}) },
        },
        v1Css: css.join("\n"),
        warnings,
    }
}
