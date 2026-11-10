#!/usr/bin/env node
// Points a cloned Eitri template repo at newly created mini-apps.
//
//   node wire-app.mjs plan  --repo <dir> --prefix <app-name>
//       → JSON: the mini-apps to create (create_eitri_apps `apps`) and the
//         slug aliases to set (set_slug_aliases `aliases`).
//   node wire-app.mjs apply --repo <dir> --plan <plan.json> --created <created.json>
//                           --application <id> --organization <id> [--message <text>]
//       → rewrites every eitri-app.conf.js, the imports of renamed shared
//         mini-apps, app-config.yaml (slugs and application-id) and dynamic-bottom-tab-view-spec.json.
//         <created.json> is create_eitri_apps' structured output.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseAppConfig, rewriteApplicationId, rewriteConf, rewriteImports, rewriteSlugRefs } from "./lib/wire.mjs"

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SOURCE = /\.(?:jsx?|tsx?|mjs|cjs)$/
const ROOT_FILES = ["app-config.yaml", "dynamic-bottom-tab-view-spec.json"]

function option(args, name, required = true) {
    const i = args.indexOf(name)
    const value = i >= 0 ? args[i + 1] : undefined
    if (required && !value) throw new Error(`missing ${name}`)
    return value
}

function confValue(text, key) {
    return new RegExp(`^\\s*(['"]?)${key}\\1\\s*:\\s*(['"])(.*?)\\2`, "m").exec(text)?.[3]
}

function sourceFiles(dir) {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile() && SOURCE.test(entry.name))
        .map((entry) => join(entry.parentPath, entry.name))
        .filter((path) => !path.split(/[\\/]/).includes("node_modules"))
}

function plan(args) {
    const repo = option(args, "--repo")
    const prefix = option(args, "--prefix")
    if (!SLUG.test(prefix)) throw new Error(`prefix "${prefix}" must be lowercase letters and digits joined by hyphens`)

    const apps = parseAppConfig(readFileSync(join(repo, "app-config.yaml"), "utf8")).map((app) => {
        const conf = readFileSync(join(repo, app.path, "eitri-app.conf.js"), "utf8")
        const templateSlug = confValue(conf, "slug")
        if (!templateSlug) throw new Error(`${app.path}/eitri-app.conf.js has no slug`)
        return { ...app, templateSlug, slug: `${prefix}-${app.alias}`, version: confValue(conf, "version") }
    })
    const slugAliases = Object.fromEntries(apps.filter((a) => !a.shared).map((a) => [a.slug, [a.alias]]))
    return {
        prefix,
        apps,
        createEitriApps: { apps: apps.map((a) => ({ slug: a.slug, title: a.slug })) },
        slugAliases,
    }
}

function apply(args) {
    const repo = option(args, "--repo")
    const { apps, slugAliases } = JSON.parse(readFileSync(option(args, "--plan"), "utf8"))
    const { created = [] } = JSON.parse(readFileSync(option(args, "--created"), "utf8"))
    const applicationId = option(args, "--application")
    const organizationId = option(args, "--organization")
    const versionMessage = option(args, "--message", false) ?? "create-app: first version"

    const bySlug = new Map(created.map((c) => [c.slug, c]))
    const missing = apps.filter((a) => !bySlug.has(a.slug)).map((a) => a.slug)
    if (missing.length) throw new Error(`Not in the created mini-apps: ${missing.join(", ")}. Nothing was changed.`)

    const renames = Object.fromEntries(apps.map((a) => [a.templateSlug, a.slug]))
    const versions = Object.fromEntries(apps.filter((a) => a.shared && a.version).map((a) => [a.slug, a.version]))

    // Compute every new file first, then write: a failure leaves the repo untouched.
    const writes = new Map()
    for (const app of apps) {
        const { id, publicKey, title } = bySlug.get(app.slug)
        const confPath = join(repo, app.path, "eitri-app.conf.js")
        writes.set(
            confPath,
            rewriteConf(readFileSync(confPath, "utf8"), { slug: app.slug, title, id, publicKey, applicationId, organizationId, versionMessage }, { renames, versions }),
        )
        for (const file of sourceFiles(join(repo, app.path, "src"))) {
            const before = readFileSync(file, "utf8")
            const after = rewriteImports(before, renames)
            if (after !== before) writes.set(file, after)
        }
    }
    for (const name of ROOT_FILES) {
        const file = join(repo, name)
        if (!existsSync(file)) continue
        const text = rewriteSlugRefs(readFileSync(file, "utf8"), renames)
        writes.set(file, name === "app-config.yaml" ? rewriteApplicationId(text, applicationId) : text)
    }
    for (const [file, text] of writes) writeFileSync(file, text)

    return {
        filesChanged: [...writes.keys()].map((file) => relative(repo, file).split("\\").join("/")),
        apps: apps.map((a) => ({ path: a.path, slug: a.slug, id: bySlug.get(a.slug).id, shared: a.shared })),
        slugAliases,
    }
}

try {
    const [command, ...args] = process.argv.slice(2)
    const commands = { plan, apply }
    if (!commands[command]) throw new Error("usage: wire-app.mjs plan|apply …")
    console.log(JSON.stringify(commands[command](args), null, 2))
} catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
}
