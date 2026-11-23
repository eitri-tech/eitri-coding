import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const PRIVATE_FILES = [".eitri/secrets.json", ".eitri/remote-config.json"]

export function protectConfigFiles(repo) {
    const file = join(repo, ".gitignore")
    const current = existsSync(file) ? readFileSync(file, "utf8") : ""
    const lines = new Set(current.split(/\r?\n/))
    // An unanchored entry (.eitri/secrets.json) already ignores the root file.
    const missing = PRIVATE_FILES.filter((path) => !lines.has(path) && !lines.has(`/${path}`)).map((path) => `/${path}`)
    if (missing.length) writeFileSync(file, `${current}${current.endsWith("\n") || !current ? "" : "\n"}${missing.join("\n")}\n`)
}

/** Client identifiers can be public; credential values stay out of the versioned example. */
export function configExample(value) {
    if (Array.isArray(value)) return value.map(configExample)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
        /secret|token|passw(?:or)?d|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?key|tcs_account/i.test(key) ? "" : configExample(child),
    ]))
}
