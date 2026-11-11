// Turns a store's Google Fonts into @font-face rules with absolute URLs for the
// Luminus v1 global CSS. Absolute URLs matter: manager-api inlines the global CSS
// into every mini-app's index.html, so a relative url() resolves against each
// mini-app's own folder and only works where the files were bundled.

/** "Montserrat:200,400,700" → { family, weights }; no weights means 400. */
export function parseFontSpec(spec) {
    const [family, weightList] = String(spec).split(":")
    if (!family?.trim()) throw new Error(`font spec "${spec}" has no family`)
    const weights = (weightList ? weightList.split(",") : ["400"]).map((w) => {
        const n = Number(w.trim())
        if (!Number.isInteger(n) || n < 100 || n > 900) throw new Error(`font spec "${spec}": "${w}" is not a weight (100–900)`)
        return n
    })
    return { family: family.trim(), weights: [...new Set(weights)] }
}

/** The fonts.googleapis.com/css2 URL that serves every family at its weights. */
export function googleFontsCssUrl(specs) {
    const families = specs.map(({ family, weights }) => {
        const sorted = [...weights].sort((a, b) => a - b).join(";")
        return `family=${family.trim().replace(/\s+/g, "+")}:wght@${sorted}`
    })
    return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`
}

/**
 * Keeps the requested subsets of a css2 response (each block is preceded by a
 * `/* <subset> *\/` comment) as one-line @font-face rules. `latin` covers
 * Portuguese and Spanish accents.
 */
export function fontFacesFromGoogleCss(css, { subsets = ["latin"] } = {}) {
    const rules = []
    for (const m of String(css).matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
        if (!subsets.includes(m[1])) continue
        const body = m[2]
            .split(";")
            .map((d) => d.trim().replace(/\s*:\s*/, ":"))
            .filter(Boolean)
            .join(";")
        rules.push(`@font-face{${body}}`)
    }
    if (!rules.length) throw new Error(`no @font-face for subsets ${subsets.join(", ")} in the Google Fonts response`)
    return rules.join("\n")
}

// A store that hosts its own font (no Google Fonts) already declares it: the capture keeps those
// @font-face rules as the browser saw them (design/fonts.json → fontFaces) and the files it fetched.

/** Splits a rule's body into [property, value] pairs; `;` inside quotes or parentheses (data: URIs) is kept. */
function declarations(rule) {
    const body = rule.slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"))
    const parts = []
    let current = ""
    let depth = 0
    let quote = null
    for (const ch of body) {
        if (quote) {
            current += ch
            if (ch === quote) quote = null
            continue
        }
        if (ch === '"' || ch === "'") quote = ch
        else if (ch === "(") depth++
        else if (ch === ")") depth--
        else if (ch === ";" && depth === 0) {
            parts.push(current)
            current = ""
            continue
        }
        current += ch
    }
    parts.push(current)
    return parts
        .map((p) => p.trim())
        .filter((p) => p.includes(":"))
        .map((p) => {
            const i = p.indexOf(":")
            return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()]
        })
}

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, "$2")

/** "normal" → [400, 400], "100 900" (a variable font) → [100, 900]. */
function weightRange(value = "400") {
    const named = { normal: 400, bold: 700 }
    const nums = value.split(/\s+/).map((w) => named[w.toLowerCase()] ?? Number(w))
    if (nums.some((n) => !Number.isFinite(n))) return [400, 400]
    return [nums[0], nums[1] ?? nums[0]]
}

/**
 * The absolute URL of a url() in a captured rule. Root- and protocol-relative ones resolve against the page;
 * a path-relative one resolves against its stylesheet, which the rule no longer names — the capture's fetched
 * files do, so it is matched by path suffix. Anything left would break once inlined into each mini-app.
 */
function absoluteFontUrl(url, { pageUrl, files }) {
    if (/^(https?:|data:)/i.test(url)) return url
    if (url.startsWith("//")) return `https:${url}`
    if (url.startsWith("/")) return new URL(url, pageUrl).href
    const suffix = "/" + url.split(/[?#]/)[0].replace(/^(\.{1,2}\/)+/, "")
    const match = files.find((f) => f.url && new URL(f.url).pathname.endsWith(suffix))
    if (match) return match.url
    throw new Error(`${url}: relative to a stylesheet the capture does not name, so it has no absolute URL — host the file on a public https URL`)
}

/**
 * The store's own @font-face rules for the requested families and weights (normal style), one per line, every
 * url() absolute. `missing` lists the requested families the capture does not declare at all (try Google Fonts).
 */
export function fontFacesFromCapture(fonts, specs, { pageUrl }) {
    const files = fonts.files ?? []
    const faces = (fonts.fontFaces ?? [])
        .map((rule) => {
            const decls = declarations(rule)
            const get = (prop) => decls.find(([p]) => p === prop)?.[1]
            return { decls, family: unquote(get("font-family") ?? ""), style: (get("font-style") ?? "normal").toLowerCase(), range: weightRange(get("font-weight")) }
        })
        .filter((f) => f.family && f.style === "normal")
    const rules = []
    const urls = []
    const missing = []
    const used = new Set()
    for (const spec of specs) {
        const own = faces.filter((f) => f.family.toLowerCase() === spec.family.toLowerCase())
        if (!own.length) {
            missing.push(spec)
            continue
        }
        for (const weight of spec.weights) {
            const face = own.find((f) => f.range[0] <= weight && weight <= f.range[1])
            if (!face) {
                const have = [...new Set(own.map((f) => (f.range[0] === f.range[1] ? `${f.range[0]}` : `${f.range[0]}–${f.range[1]}`)))]
                throw new Error(`${spec.family} ${weight}: the capture has ${spec.family} at ${have.join(", ")}`)
            }
            if (used.has(face)) continue
            used.add(face)
            const body = face.decls.map(([prop, value]) => {
                if (prop === "font-family") return `font-family:'${face.family}'`
                if (prop !== "src") return `${prop}:${value}`
                const src = value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_, q, url) => {
                    const abs = absoluteFontUrl(url, { pageUrl, files })
                    if (!abs.startsWith("data:")) urls.push(abs)
                    return `url(${q}${abs}${q})`
                })
                return `src:${src}`
            })
            rules.push(`@font-face{${body.join(";")}}`)
        }
    }
    return { css: rules.join("\n"), urls: [...new Set(urls)], missing }
}

/**
 * A mini-app loads the global CSS's fonts cross-origin: a file served without Access-Control-Allow-Origin is
 * silently dropped and the text falls back to the system font. Returns one line per file that would fail.
 */
export async function fontCorsProblems(urls, { fetchImpl = fetch, origin = "https://eitri.tech" } = {}) {
    const problems = []
    for (const url of urls) {
        try {
            const res = await fetchImpl(url, { headers: { origin } })
            await res.body?.cancel?.()
            if (!res.ok) problems.push(`${url}: answered ${res.status}`)
            else if (!res.headers.get("access-control-allow-origin")) problems.push(`${url}: no Access-Control-Allow-Origin header, so the app cannot load it`)
        } catch (err) {
            problems.push(`${url}: ${err instanceof Error ? err.message : err}`)
        }
    }
    return problems
}
