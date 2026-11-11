#!/usr/bin/env node
// Checks every mini-app of the repo for English and Portuguese translations (src/locales/en and src/locales/pt),
// the same keys in both, and every t('key') the code uses. Prints a JSON report; exits 1 while any error remains.
//
//   node i18n.mjs check --repo .
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { checkMiniApp, usedKeys } from "./lib/i18n.mjs"

const SOURCE = /\.(jsx?|tsx?|mjs)$/

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

/** Folders holding an eitri-app.conf.js, at the repo root or one level down. */
function miniApps(repo) {
    const candidates = [repo, ...readdirSync(repo).map((entry) => join(repo, entry))]
    return candidates
        .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, "eitri-app.conf.js")))
        .sort()
}

function sourceFiles(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "locales" || entry.name.startsWith(".")) continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) sourceFiles(path, out)
        else if (SOURCE.test(entry.name)) out.push(path)
    }
    return out
}

function readLocales(app) {
    const root = join(app, "src", "locales")
    if (!existsSync(root)) return {}
    const locales = {}
    for (const folder of readdirSync(root)) {
        const file = join(root, folder, "translation.json")
        if (existsSync(file)) locales[folder] = JSON.parse(readFileSync(file, "utf8"))
    }
    return locales
}

function main(args) {
    if (args[0] !== "check") throw new Error("usage: i18n.mjs check --repo <dir>")
    const repo = option(args, "--repo") ?? "."
    const apps = miniApps(repo).map((app) => {
        const used = new Set()
        const src = join(app, "src")
        if (existsSync(src)) for (const file of sourceFiles(src)) for (const key of usedKeys(readFileSync(file, "utf8"))) used.add(key)
        return checkMiniApp({ name: relative(repo, app) || ".", locales: readLocales(app), used })
    })
    const ok = apps.every((app) => app.errors.length === 0)
    console.log(JSON.stringify({ ok, apps }, null, 2))
    process.exit(ok ? 0 : 1)
}

try {
    main(process.argv.slice(2))
} catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
}
