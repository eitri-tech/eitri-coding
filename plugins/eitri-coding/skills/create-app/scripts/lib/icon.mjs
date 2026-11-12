// Finds the best source for an app's icon (its avatar in the Console and Eitri
// Play) among everything a store exposes, measures each by decoding its bytes,
// and ranks them. Pure: app-icon.mjs fetches. The MCP's upload_application_icon
// applies the same limits server side (512 px target, 180 px minimum, never
// upscaled, a non-square logo centered on a background color).

/** What the MCP uploads: a 512 px square PNG when the source allows it. */
export const TARGET_SIDE = 512
/** Below this the avatar looks blurry: refused, never enlarged. */
export const MIN_SIDE = 180
/** Share of the square canvas a padded logo's longest side takes. */
export const LOGO_SHARE = 0.8
/** Sides within this ratio count as square. */
const SQUARE_TOLERANCE = 0.02

/** Which kind wins between two equally good squares: the order stores intend them for app icons. */
const KIND_PRIORITY = { manifest: 0, "apple-touch-icon": 1, icon: 2, favicon: 3 }

// --- Sources ----------------------------------------------------------------

function decodeEntities(text) {
    return text.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

function tags(html, name) {
    const out = []
    for (const m of html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))) {
        const attrs = {}
        for (const a of m[1].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) {
            attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "")
        }
        out.push(attrs)
    }
    return out
}

function resolve(href, base) {
    try {
        const url = new URL(href, base)
        return /^https?:$/.test(url.protocol) ? url.toString() : undefined
    } catch {
        return undefined
    }
}

const pathOf = (url) => url.split(/[?#]/)[0]

/** Words that mark an image as somebody else's logo (payment, security seals, the agency) rather than the store's. */
const NOT_THE_STORE = /pagamento|payment|seguro|secure|selo|seal|ssl|footer|parceir|partner|corebiz|agencia|agency|developed|desenvolvido/i

/**
 * The store's own logo: the first <img> whose class, id, alt, title or file name
 * says "logo" and nothing marks as a seal or the footer. Headers come before
 * footers in the document, so the first match is the header's.
 */
function pageLogo(html, pageUrl) {
    for (const img of tags(html, "img")) {
        const src = img.src && !img.src.startsWith("data:") ? img.src : img["data-src"]
        if (!src) continue
        const words = [img.class, img.id, img.alt, img.title, pathOf(src).split("/").pop()].filter(Boolean).join(" ")
        if (/logo/i.test(words) && !NOT_THE_STORE.test(words)) return resolve(src, pageUrl)
    }
    return undefined
}

/**
 * Every icon source a store's page declares, plus the well-known paths and the
 * header logo. Kinds: manifest (from the web app manifest, see manifestSources),
 * apple-touch-icon, icon (<link rel=icon>, raster or SVG), favicon (.ico) and logo.
 */
// The local file name of a downloaded candidate: "<NN>-<kind>-<url basename>", at most 80
// characters. A long basename (CDN file names are hashes) is shortened in its stem, so the
// extension survives and the file still opens as what it is.
export function candidateFileName(index, kind, url, max = 80) {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || "index"
    const prefix = `${String(index).padStart(2, "0")}-${kind}-`
    const dot = base.lastIndexOf(".")
    const ext = dot > 0 && base.length - dot <= 6 ? base.slice(dot) : ""
    const stem = ext ? base.slice(0, dot) : base
    return prefix + stem.slice(0, Math.max(1, max - prefix.length - ext.length)) + ext
}

export function iconSources({ html, pageUrl, logoUrl }) {
    const origin = new URL(pageUrl).origin
    const sources = []
    const add = (url, kind, declared) => {
        if (url && !sources.some((s) => s.url === url)) sources.push({ url, kind, ...(declared ? { declared } : {}) })
    }
    let manifestUrl
    for (const link of tags(html, "link")) {
        const rel = (link.rel ?? "").toLowerCase().split(/\s+/)
        const url = link.href && resolve(link.href, pageUrl)
        if (!url) continue
        if (rel.includes("manifest")) manifestUrl ??= url
        else if (rel.some((r) => r.startsWith("apple-touch-icon"))) add(url, "apple-touch-icon", link.sizes)
        else if (rel.includes("icon")) add(url, /\.ico$/i.test(pathOf(url)) ? "favicon" : "icon", link.sizes)
    }
    add(`${origin}/apple-touch-icon.png`, "apple-touch-icon")
    add(`${origin}/apple-touch-icon-precomposed.png`, "apple-touch-icon")
    add(`${origin}/favicon.ico`, "favicon")
    add(logoUrl ?? pageLogo(html, pageUrl), "logo")
    return { manifestUrl, sources }
}

/** The web app manifest's icons, resolved against the manifest URL. Monochrome icons are masks, not the brand mark. */
export function manifestSources(manifest, manifestUrl) {
    const icons = Array.isArray(manifest?.icons) ? manifest.icons : []
    return icons
        .filter((i) => i && typeof i.src === "string" && !String(i.purpose ?? "").split(/\s+/).includes("monochrome"))
        .map((i) => ({ url: resolve(i.src, manifestUrl), kind: "manifest", ...(i.sizes ? { declared: i.sizes } : {}) }))
        .filter((i) => i.url)
}

// --- Measuring --------------------------------------------------------------

const ascii = (b, at, text) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0))

function pngSize(b, at = 0) {
    if (b.length < at + 24 || b[at] !== 0x89 || !ascii(b, at + 1, "PNG") || !ascii(b, at + 12, "IHDR")) return undefined
    const u32 = (o) => ((b[at + o] << 24) | (b[at + o + 1] << 16) | (b[at + o + 2] << 8) | b[at + o + 3]) >>> 0
    return { width: u32(16), height: u32(20) }
}

function jpegSize(b) {
    if (b[0] !== 0xff || b[1] !== 0xd8) return undefined
    let at = 2
    while (at + 9 < b.length) {
        if (b[at] !== 0xff) return undefined
        const marker = b[at + 1]
        const length = (b[at + 2] << 8) | b[at + 3]
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: (b[at + 5] << 8) | b[at + 6], width: (b[at + 7] << 8) | b[at + 8] }
        }
        if (length < 2) return undefined
        at += 2 + length
    }
    return undefined
}

function gifSize(b) {
    if (b.length < 10 || !(ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a"))) return undefined
    return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }
}

function webpSize(b) {
    if (b.length < 16 || !ascii(b, 0, "RIFF") || !ascii(b, 8, "WEBP")) return undefined
    if (ascii(b, 12, "VP8X") && b.length >= 30) {
        const u24 = (o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
        return { width: u24(24) + 1, height: u24(27) + 1 }
    }
    if (ascii(b, 12, "VP8L") && b.length >= 25 && b[20] === 0x2f) {
        const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (ascii(b, 12, "VP8 ") && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
        return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff }
    }
    return undefined
}

/** Every frame of an .ico, sized from the frame's own header (the directory's bytes can lie, and 0 means 256). */
function icoFrames(b) {
    if (b.length < 6 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 0) return undefined
    const count = b[4] | (b[5] << 8)
    const frames = []
    for (let i = 0; i < count; i++) {
        const at = 6 + 16 * i
        if (at + 16 > b.length) break
        const offset = (b[at + 12] | (b[at + 13] << 8) | (b[at + 14] << 16) | (b[at + 15] << 24)) >>> 0
        const embedded = pngSize(b, offset)
        if (embedded) {
            frames.push(embedded)
            continue
        }
        if (offset + 12 <= b.length && b[offset] === 40) {
            const i32 = (o) => b[offset + o] | (b[offset + o + 1] << 8) | (b[offset + o + 2] << 16) | (b[offset + o + 3] << 24)
            frames.push({ width: Math.abs(i32(4)), height: Math.abs(i32(8)) / 2 })
            continue
        }
        frames.push({ width: b[at] || 256, height: b[at + 1] || 256 })
    }
    return frames.length ? frames : undefined
}

const number = (value) => {
    const n = Number.parseFloat(String(value ?? ""))
    return Number.isFinite(n) && n > 0 && !/%/.test(String(value)) ? n : undefined
}

function svgSize(b) {
    const head = new TextDecoder().decode(b.subarray(0, 4096))
    const tag = /<svg\b([^>]*)>/i.exec(head)
    if (!tag) return undefined
    const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag[1])?.[1]
    const box = attr("viewBox")?.trim().split(/[\s,]+/).map(Number)
    const width = number(attr("width")) ?? (box?.length === 4 ? box[2] : undefined)
    const height = number(attr("height")) ?? (box?.length === 4 ? box[3] : undefined)
    return width && height ? { width, height } : undefined
}

/**
 * The real format and size of an image, from its bytes: PNG, JPEG, GIF, WebP,
 * ICO (its largest frame, with every frame listed) and SVG (vector). Null for
 * anything else — e.g. the HTML page a missing /apple-touch-icon.png answers.
 */
export function measureImage(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    for (const [format, read] of [["png", pngSize], ["jpeg", jpegSize], ["gif", gifSize], ["webp", webpSize]]) {
        const size = read(b)
        if (size) return { format, ...size }
    }
    const frames = icoFrames(b)
    if (frames) {
        const largest = frames.reduce((best, f) => (f.width * f.height > best.width * best.height ? f : best))
        return { format: "ico", width: largest.width, height: largest.height, frames: frames.map((f) => `${f.width}×${f.height}`) }
    }
    const vector = svgSize(b)
    if (vector) return { format: "svg", ...vector, vector: true }
    return null
}

// --- Ranking ----------------------------------------------------------------

const isSquare = ({ width, height }) => Math.abs(width - height) <= SQUARE_TOLERANCE * Math.max(width, height)
const dims = ({ width, height }) => `${width}×${height}`

/** The canvas a logo with this longest side is centered on: grows with the logo up to the target, never enlarges it. */
export function logoCanvasSide(longest) {
    return Math.min(TARGET_SIDE, Math.max(MIN_SIDE, Math.round(longest / LOGO_SHARE)))
}

function declaredNote(c) {
    if (!c.declared || !c.image) return ""
    const side = Number.parseInt(String(c.declared).split(/\s+/).pop(), 10)
    return side && side !== c.image.width ? ` (declared ${c.declared}, really ${dims(c.image)})` : ""
}

/**
 * Sorts every fetched candidate into a verdict, best first:
 *   tier 1 — square, at least TARGET_SIDE (or SVG): uploaded at 512 px; manifest > apple-touch > icon > favicon;
 *   tier 2 — square, MIN_SIDE to TARGET_SIDE: uploaded at its own size, largest first;
 *   tier 3 — the store logo, centered on `background` (the color it sits on in the header) when no square icon reaches MIN_SIDE;
 *   rejected — not an image, too small, or not square (and not the logo).
 * Returns the chosen candidate, the upload_application_icon arguments for it
 * (null when nothing qualifies, or when the logo needs a background color first)
 * and the ranked list with a reason for every verdict.
 */
export function rankIcons(candidates, { background } = {}) {
    const scored = candidates.map((c) => {
        const note = declaredNote(c)
        if (!c.image) return { ...c, tier: 9, reason: c.error ?? "not an image" }
        const { image } = c
        const kindRank = KIND_PRIORITY[c.kind] ?? 4
        if (c.kind === "logo") {
            const longest = Math.max(image.width, image.height)
            if (!image.vector && longest < Math.ceil(MIN_SIDE * LOGO_SHARE)) {
                return { ...c, tier: 9, reason: `logo ${dims(image)}: too small to fill even a ${MIN_SIDE} px canvas without upscaling` }
            }
            const canvas = image.vector ? TARGET_SIDE : logoCanvasSide(longest)
            return {
                ...c,
                tier: 3,
                sort: [-longest],
                reason: `logo ${dims(image)}${image.vector ? " (SVG)" : ""}, centered on a ${canvas} px square ${background ? `in ${background}` : "(needs the header's background color)"}`,
            }
        }
        if (!isSquare(image)) return { ...c, tier: 9, reason: `${dims(image)} ${image.format}${note}: not square, the avatar would crop it` }
        if (image.vector) return { ...c, tier: 1, sort: [kindRank, -Infinity], reason: `SVG icon: rasterized at ${TARGET_SIDE} px` }
        const side = Math.min(image.width, image.height)
        const frames = image.frames ? `, largest of frames ${image.frames.join(", ")}` : ""
        if (side >= TARGET_SIDE) return { ...c, tier: 1, sort: [kindRank, -side], reason: `${dims(image)} ${image.format}${note}${frames}: at or above the ${TARGET_SIDE} px target` }
        if (side >= MIN_SIDE) return { ...c, tier: 2, sort: [-side, kindRank], reason: `${dims(image)} ${image.format}${note}${frames}: under the ${TARGET_SIDE} px target, uploaded at its own size` }
        return { ...c, tier: 9, reason: `${dims(image)} ${image.format}${note}${frames}: under ${MIN_SIDE} px, it would look blurry` }
    })
    const ranked = scored
        .map((c, i) => ({ c, i }))
        .sort((a, b) => a.c.tier - b.c.tier || compare(a.c.sort, b.c.sort) || a.i - b.i)
        .map(({ c }) => c)
    const best = ranked[0]?.tier < 9 ? ranked[0] : null
    const out = ranked.map(({ tier, sort, ...c }, i) => ({ ...c, verdict: tier === 9 ? "rejected" : best && i === 0 ? "chosen" : "fallback" }))
    const chosen = best ? out[0] : null
    if (!chosen) return { chosen: null, upload: null, ranked: out, error: `No icon source reaches ${MIN_SIDE} px, and the store logo cannot be padded without upscaling: set the icon by hand.` }
    if (chosen.kind === "logo") {
        if (!background) return { chosen, upload: null, needs: ["background"], ranked: out }
        return { chosen, upload: { imageUrl: chosen.finalUrl ?? chosen.url, background }, ranked: out }
    }
    return { chosen, upload: { imageUrl: chosen.finalUrl ?? chosen.url }, ranked: out }
}

function compare(a = [], b = []) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0
        const y = b[i] ?? 0
        if (x !== y) return x === -Infinity ? -1 : y === -Infinity ? 1 : x < y ? -1 : 1
    }
    return 0
}
