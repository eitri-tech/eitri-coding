// Checks that every mini-app speaks English and Portuguese.
//
// Forge builds each mini-app's i18next resources from its src/locales/<lang>/translation.json folders and starts it
// with lng = the device language Eitri-Play passes (hl, e.g. "en-US" or "pt-BR") and fallbackLng "en". i18next
// resolves "pt-BR" → "pt-BR", "pt", then "en" — but never "en" → "en-US". So language-only folders (en, pt) serve
// every regional variant, a regional one (pt-BR, en-US) only that exact language, and a mini-app without an English
// folder renders its raw keys ("emptyCart.txtEmptyCart") on any phone set to English.

export const REQUIRED_LANGUAGES = [
    { code: "en", name: "English" },
    { code: "pt", name: "Portuguese" },
]

/** { a: { b: "x" } } → { "a.b": "x" } */
export function flattenKeys(object, prefix = "", out = {}) {
    for (const [key, value] of Object.entries(object ?? {})) {
        const path = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === "object" && !Array.isArray(value)) flattenKeys(value, path, out)
        else out[path] = value
    }
    return out
}

/** The static keys a source file passes to t() / i18n.t(); template literals with ${} are skipped. */
export function usedKeys(source) {
    const keys = new Set()
    const pattern = /(?<![\w$])(?:i18n(?:ext)?\.)?t\(\s*(['"`])([A-Za-z0-9_.-]+)\1/g
    for (const match of String(source).matchAll(pattern)) {
        if (match[2].includes(".")) keys.add(match[2])
    }
    return keys
}

const languagePart = (folder) => folder.split(/[-_]/)[0].toLowerCase()

/**
 * Errors make the app show raw keys or the wrong language to someone; warnings are probably-untranslated strings.
 * locales: { "<folder>": translation object }, used: keys the code passes to t().
 */
export function checkMiniApp({ name, locales, used }) {
    const errors = []
    const warnings = []
    const folders = Object.keys(locales ?? {})
    const translatesNothing = folders.every((f) => Object.keys(flattenKeys(locales[f])).length === 0)
    if (translatesNothing && (!used || used.size === 0)) return { name, errors, warnings }

    const flat = {}
    for (const [code, { name: language }] of REQUIRED_LANGUAGES.map((l) => [l.code, l])) {
        if (folders.includes(code)) {
            flat[code] = flattenKeys(locales[code])
            continue
        }
        const regional = folders.filter((f) => languagePart(f) === code)
        if (regional.length) {
            errors.push(
                `${name}: ${language} lives in ${regional.map((f) => `src/locales/${f}`).join(", ")}, which only matches a phone set to exactly that language — rename it to src/locales/${code} so every ${language} variant uses it.`,
            )
            flat[code] = flattenKeys(locales[regional[0]])
        } else {
            errors.push(
                `${name}: no ${language} translation (src/locales/${code}/translation.json)${code === "en" ? ": a phone set to English shows the raw keys" : ""}.`,
            )
        }
    }

    const languages = Object.keys(flat)
    const allKeys = new Set(languages.flatMap((code) => Object.keys(flat[code])))
    for (const code of languages) {
        const missing = [...allKeys].filter((key) => !(key in flat[code]))
        if (missing.length) errors.push(`${name}: ${code} lacks ${missing.length} key(s) the other language has: ${list(missing)}`)
    }
    const unknown = [...(used ?? [])].filter((key) => languages.length && languages.every((code) => !(key in flat[code])))
    if (unknown.length) errors.push(`${name}: the code uses ${unknown.length} key(s) no translation defines: ${list(unknown)}`)
    for (const code of languages) {
        const missingUsed = [...(used ?? [])].filter((key) => !unknown.includes(key) && !(key in flat[code]))
        if (missingUsed.length) errors.push(`${name}: ${code} lacks ${missingUsed.length} key(s) the code uses: ${list(missingUsed)}`)
    }

    if (flat.en && flat.pt) {
        const same = Object.keys(flat.en).filter(
            (key) => typeof flat.en[key] === "string" && flat.en[key] === flat.pt[key] && /\p{L}{2,}\s+\p{L}{2,}/u.test(flat.en[key]),
        )
        if (same.length) warnings.push(`${name}: en repeats the Portuguese text, probably untranslated: ${list(same)}`)
    }
    return { name, errors, warnings }
}

function list(keys) {
    const shown = keys.slice(0, 8).join(", ")
    return keys.length > 8 ? `${shown} … (+${keys.length - 8})` : shown
}
