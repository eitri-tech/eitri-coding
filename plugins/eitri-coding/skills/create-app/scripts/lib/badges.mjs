// Works out the product-card badges a store shows and how they look (analyze-store's
// productCard.badges), for the agent to rebuild them in the app. Sources, all standard VTEX:
//   - highlights (clusterHighlights): collections flagged for display; a store often hides them from the native
//     component and draws them with its own tag (e.g. "Tag PREÇO DE BLACK" shown as "PREÇO DE BLACK");
//   - specification values (e.g. group "Selos" → "Vegano"), of which the store may hide some with CSS;
//   - promotion teasers ("Leve 3 por R$ 99").
// Colors come from the captured page: the badge element's inline style, its wrapper's, or its classes' CSS rules. Pure.

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function hex(color) {
    if (!color) return undefined
    const value = color.trim().toLowerCase()
    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(value)
    if (rgb) {
        if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined
        return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`
    }
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value)
    if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    if (/^#[0-9a-f]{6}$/.test(value)) return value
    return undefined
}

function declarations(text) {
    const out = {}
    for (const part of String(text ?? "").split(";")) {
        const i = part.indexOf(":")
        if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!important/, "").trim()
    }
    return out
}

const attr = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1]

/** CSS declarations of the rules whose selector ends with one of these classes, in source order. */
function classRules(css, classes) {
    const out = {}
    for (const cls of classes) {
        const rule = new RegExp(`(?:^|[\\s}])[^{}]*\\.${escapeRegex(cls)}\\s*\\{([^}]*)\\}`, "g")
        for (const m of css.matchAll(rule)) Object.assign(out, declarations(m[1]))
    }
    return out
}

/**
 * How a badge text looks on the captured page: { bgColor?, textColor?, hidden? },
 * or null when the text is not on it.
 */
export function textStyle(text, { html = "", css = "" }) {
    const at = new RegExp(`>\\s*${escapeRegex(text)}\\s*<`, "i").exec(html)
    if (!at) return null
    // The element's opening tag, then up to two wrappers before it (closing tags in between end the chain).
    const tags = []
    let end = at.index + 1
    for (let i = 0; i < 3; i++) {
        const start = html.lastIndexOf("<", end - 1)
        if (start < 0) break
        const tag = html.slice(start, end)
        if (tag.startsWith("</")) break
        tags.push(tag)
        end = start
        if (!/^\s*$/.test(html.slice(start - 1 >= 0 ? html.lastIndexOf(">", start - 1) + 1 : 0, start))) break
    }
    const [own, ...wrappers] = tags
    if (!own) return null
    const ownClasses = (attr(own, "class") ?? "").split(/\s+/).filter(Boolean)
    const rules = classRules(css, ownClasses)
    const inline = declarations(attr(own, "style"))
    const style = {}
    const background = [inline["background-color"], inline.background, ...wrappers.map((w) => declarations(attr(w, "style"))["background-color"]), rules["background-color"], rules.background]
        .map(hex)
        .find(Boolean)
    const color = [inline.color, rules.color].map(hex).find(Boolean)
    if (background) style.bgColor = background
    if (color) style.textColor = color
    if ((inline.display ?? rules.display) === "none") style.hidden = true
    return style
}

const TAG_COMPONENT = /tag|selo|flag|badge|stamp/i

/**
 * @param summary  vtexProductSummary(): the card's features, custom components and highlight filters
 * @param catalog  captured products: { clusterHighlights: {id: name}, specifications: {name: [values]} }
 * @returns { config: the badges (productCard.badges), unresolved: [{ badge, why }] }
 */
export function buildBadgeConfig({ summary, catalog = [], html = "", css = "" }) {
    const features = Object.fromEntries((summary?.features ?? []).map((f) => [f.feature, f]))
    const config = {}
    const unresolved = []
    const page = { html, css }

    if (features.highlights || summary?.highlights) {
        const highlights = {}
        const filters = summary?.highlights
        if (filters) {
            const drawnByCustomTag = (summary.customComponents ?? []).some((c) => TAG_COMPONENT.test(c.split("/").pop()))
            const allow = [...(filters.show ?? []), ...(drawnByCustomTag ? (filters.hide ?? []) : [])]
            if (allow.length) highlights.allow = allow
        }
        const names = [...new Set([...(highlights.allow ?? []), ...catalog.flatMap((p) => Object.values(p.clusterHighlights ?? {}))])]
        const prefixes = new Set()
        const styles = {}
        const pending = []
        for (const name of names) {
            const firstWord = /^(\S+\s+)/.exec(name)?.[1]
            const shown = textStyle(name, page) ? name : firstWord && textStyle(name.slice(firstWord.length), page) ? name.slice(firstWord.length) : null
            if (!shown) {
                pending.push(name)
                continue
            }
            if (shown !== name) prefixes.add(firstWord)
            const style = textStyle(shown, page)
            if (style?.hidden) continue
            // Seen on the store: shown in the app too, whatever the native component's filter says.
            if (highlights.allow && !highlights.allow.includes(name)) highlights.allow.push(name)
            if (style && (style.bgColor || style.textColor)) styles[shown] = { ...(style.bgColor ? { bgColor: style.bgColor } : {}), ...(style.textColor ? { textColor: style.textColor } : {}) }
        }
        for (const name of pending) {
            if (highlights.allow && !highlights.allow.includes(name)) continue
            const prefix = [...prefixes].find((p) => name.startsWith(p))
            const shown = prefix ? name.slice(prefix.length) : name
            unresolved.push({ badge: shown, why: "no captured card shows it: the app draws it in the theme's primary colors" })
        }
        if (prefixes.size) highlights.stripPrefixes = [...prefixes]
        if (Object.keys(styles).length) highlights.styles = styles
        config.highlights = highlights
    }

    const groups = features.specificationBadges?.groups ?? []
    if (groups.length) {
        const values = {}
        for (const value of new Set(catalog.flatMap((p) => groups.flatMap((g) => p.specifications?.[g] ?? [])))) {
            const style = textStyle(value, page)
            if (!style || style.hidden) continue
            values[value] = { ...(style.bgColor ? { bgColor: style.bgColor } : {}), ...(style.textColor ? { textColor: style.textColor } : {}) }
        }
        if (Object.keys(values).length) config.specifications = { names: groups, values }
    }

    config.teasers = true
    return { config, unresolved }
}
