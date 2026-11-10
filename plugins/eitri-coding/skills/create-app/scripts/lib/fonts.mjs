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
