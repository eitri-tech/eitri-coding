// Pure text transforms that point a cloned template repo at newly created
// mini-apps. Text in, text out: formatting and comments are kept, so the
// diff of a wired repo shows only the values that changed.

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function stripQuotes(value) {
    return value.trim().replace(/^(['"])(.*)\1$/, "$2")
}

/** The `eitri-apps:` list of app-config.yaml (top level only; the bottom-bar simulation has its own). */
export function parseAppConfig(yaml) {
    const lines = yaml.split(/\r?\n/)
    const start = lines.findIndex((line) => /^eitri-apps:\s*$/.test(line))
    if (start < 0) throw new Error("app-config.yaml has no top-level eitri-apps list")
    const apps = []
    let current
    for (const line of lines.slice(start + 1)) {
        if (/^\S/.test(line)) break
        const item = /^\s*-\s+(.*)$/.exec(line)
        const pair = /^\s*([\w-]+):\s*(.*)$/.exec(item ? item[1] : line)
        if (item) {
            current = {}
            apps.push(current)
        }
        if (pair && current) current[pair[1]] = stripQuotes(pair[2])
    }
    return apps.map((a) => ({ path: a.path, workspace: a.workspace, alias: a.alias, shared: a.shared === "true" }))
}

/** Writes `value` as a JS string literal in the given quote style. */
function literal(value, quote) {
    return `${quote}${String(value).replace(/\\/g, "\\\\").replaceAll(quote, `\\${quote}`)}${quote}`
}

/** Replaces the first (top-level) `key: 'value'` of a conf; returns undefined when the key is absent. */
function setKey(text, key, value) {
    const regex = new RegExp(`^(\\s*)(['"]?)${escapeRegex(key)}\\2(\\s*:\\s*)(['"])(?:\\\\.|(?!\\4).)*\\4`, "m")
    if (!regex.test(text)) return undefined
    return text.replace(regex, (_, indent, keyQuote, colon, quote) => `${indent}${keyQuote}${key}${keyQuote}${colon}${literal(value, quote)}`)
}

/** Adds `versionMessage` right after the top-level `version`, in the same style. */
function addVersionMessage(text, message) {
    const version = /^(\s*)(['"]?)version\2(\s*:\s*)(['"])[^'"]*\4(,?)[^\n]*$/m.exec(text)
    if (!version) return text
    const [line, indent, keyQuote, colon, quote] = version
    const added = `${indent}${keyQuote}versionMessage${keyQuote}${colon}${literal(message, quote)},`
    return text.replace(line, `${line}\n${added}`)
}

/**
 * Points an eitri-app.conf.js at its new mini-app (name, title, slug, public
 * key, ids) and renames its dependencies on renamed shared mini-apps, pinning
 * them to the version the repo will actually push.
 */
export function rewriteConf(text, identity, { renames, versions }) {
    const fields = [
        ["name", identity.slug],
        ["title", identity.title ?? identity.slug],
        ["slug", identity.slug],
        ["public-key", identity.publicKey],
        ["applicationId", identity.applicationId],
        ["id", identity.id],
        ["organizationId", identity.organizationId],
    ]
    let out = text
    for (const [key, value] of fields) {
        if (value === undefined) continue
        const next = setKey(out, key, value)
        if (next === undefined) throw new Error(`eitri-app.conf.js has no '${key}' field`)
        out = next
    }
    if (identity.versionMessage) out = setKey(out, "versionMessage", identity.versionMessage) ?? addVersionMessage(out, identity.versionMessage)

    for (const [from, to] of Object.entries(renames)) {
        const key = new RegExp(`(['"]?)${escapeRegex(from)}\\1(\\s*:\\s*\\{)`)
        const hit = key.exec(out)
        if (!hit) continue
        out = out.replace(key, `${hit[1]}${to}${hit[1]}$2`)
        const version = versions[to]
        if (!version) continue
        // Re-pin the version inside this dependency's own block.
        const blockStart = out.indexOf("{", hit.index)
        const blockEnd = out.indexOf("}", blockStart)
        const block = out.slice(blockStart, blockEnd).replace(/(version\s*:\s*)(['"])[^'"]*\2/, (_, prefix, quote) => `${prefix}${quote}${version}${quote}`)
        out = out.slice(0, blockStart) + block + out.slice(blockEnd)
    }
    return out
}

/** Renames module specifiers (`from 'x'`, `import('x')`, `require('x')`, `x/sub`), never other strings. */
export function rewriteImports(text, renames) {
    let out = text
    for (const [from, to] of Object.entries(renames)) {
        const specifier = new RegExp(`((?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*)(['"])${escapeRegex(from)}((?:/[^'"]*)?)\\2`, "g")
        out = out.replace(specifier, `$1$2${to}$3$2`)
    }
    return out
}

/**
 * Points app-config.yaml's top-level `application-id` (what `eitri app start` runs
 * against) at the new application. The template ships its own application's id.
 */
export function rewriteApplicationId(yaml, applicationId) {
    const line = /^(application-id:\s*)(['"]?)[^'"\r\n]*\2([ \t]*)$/m
    if (line.test(yaml)) return yaml.replace(line, (_, key, quote, trailing) => `${key}${quote}${applicationId}${quote}${trailing}`)
    const newline = yaml.includes("\r\n") ? "\r\n" : "\n"
    const separator = yaml === "" || yaml.endsWith("\n") ? "" : newline
    return `${yaml}${separator}application-id: ${applicationId}${newline}`
}

/** Renames exact slug values: quoted anywhere (JSON, YAML) or as an unquoted YAML `slug:`. */
export function rewriteSlugRefs(text, renames) {
    let out = text
    for (const [from, to] of Object.entries(renames)) {
        out = out
            .replace(new RegExp(`(['"])${escapeRegex(from)}\\1`, "g"), `$1${to}$1`)
            .replace(new RegExp(`^(\\s*-?\\s*slug:\\s*)${escapeRegex(from)}(\\s*)$`, "gm"), `$1${to}$2`)
    }
    return out
}
