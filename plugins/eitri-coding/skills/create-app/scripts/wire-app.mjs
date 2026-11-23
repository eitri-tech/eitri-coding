#!/usr/bin/env node
// Points a cloned Eitri template repo at newly created mini-apps.
//
//   node wire-app.mjs plan  --repo <dir> --project <app-name>
//       → JSON: the mini-apps to create (create_eitri_apps `apps`) and the
//         slug aliases to set (set_slug_aliases `aliases`). Every mini-app is
//         named `eitri-shopping-<project>-<alias>` — slug, name, title, folder
//         and workspace alike, as in the production shopping apps.
//   node wire-app.mjs apply --repo <dir> --plan <plan.json> --created <created.json>
//                           --application <id> --organization <id> [--message <text>]
//       → rewrites every eitri-app.conf.js, the imports of renamed shared
//         mini-apps, app-config.yaml (paths, workspaces, slugs and application-id) and
//         dynamic-bottom-tab-view-spec.json and remoteConfig.json, then renames each mini-app folder.
//         <created.json> is create_eitri_apps' structured output.
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { miniAppName, parseAppConfig, rewriteAppEntries, rewriteApplicationId, rewriteConf, rewriteImports, rewriteSlugRefs } from "./lib/wire.mjs"

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SOURCE = /\.(?:jsx?|tsx?|mjs|cjs)$/
const ROOT_FILES = ["app-config.yaml", "dynamic-bottom-tab-view-spec.json", "remoteConfig.json"]

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
    if (args.includes("--prefix")) throw new Error("--prefix is gone: pass --project <app-name>; mini-apps are named eitri-shopping-<project>-<alias>")
    const project = option(args, "--project").replace(/^eitri-shopping-/, "")
    if (!SLUG.test(project)) throw new Error(`project "${project}" must be lowercase letters and digits joined by hyphens`)

    const apps = parseAppConfig(readFileSync(join(repo, "app-config.yaml"), "utf8")).map((app) => {
        const conf = readFileSync(join(repo, app.path, "eitri-app.conf.js"), "utf8")
        const templateSlug = confValue(conf, "slug")
        if (!templateSlug) throw new Error(`${app.path}/eitri-app.conf.js has no slug`)
        const slug = miniAppName(project, app.alias)
        return {
            path: `./${slug}`,
            workspace: slug,
            alias: app.alias,
            shared: app.shared,
            slug,
            templatePath: app.path,
            templateWorkspace: app.workspace,
            templateSlug,
            version: confValue(conf, "version"),
        }
    })
    const slugAliases = Object.fromEntries(apps.filter((a) => !a.shared).map((a) => [a.slug, [a.alias]]))
    return {
        project,
        apps,
        createEitriApps: { apps: apps.map((a) => ({ slug: a.slug, title: a.slug })) },
        slugAliases,
    }
}

function apply(args) {
    const repo = option(args, "--repo")
    const { apps, slugAliases } = JSON.parse(readFileSync(option(args, "--plan"), "utf8"))
    const response = JSON.parse(readFileSync(option(args, "--created"), "utf8"))
    if (response.failed || response.appGroupError || response.conflicts?.length) throw new Error("Partial or conflicting creation result: reconcile it before wiring. Nothing was changed.")
    const created = [...(response.created ?? []), ...(response.reused ?? [])]
    const applicationId = option(args, "--application")
    const organizationId = option(args, "--organization")
    const versionMessage = option(args, "--message", false) ?? "create-app: first version"

    const bySlug = new Map(created.map((c) => [c.slug, c]))
    const missing = apps.filter((a) => !bySlug.has(a.slug)).map((a) => a.slug)
    if (missing.length) throw new Error(`Not in the created mini-apps: ${missing.join(", ")}. Nothing was changed.`)

    const renames = Object.fromEntries(apps.map((a) => [a.templateSlug, a.slug]))
    const versions = Object.fromEntries(apps.filter((a) => a.shared && a.version).map((a) => [a.slug, a.version]))

    // Where each mini-app is now: its template folder, or already its own on a rerun.
    const current = new Map()
    for (const app of apps) {
        const from = app.templatePath ?? app.path
        const here = existsSync(join(repo, from, "eitri-app.conf.js")) ? from : app.path
        if (!existsSync(join(repo, here, "eitri-app.conf.js"))) throw new Error(`No eitri-app.conf.js in ${from} or ${app.path}. Nothing was changed.`)
        if (here !== app.path && existsSync(join(repo, app.path))) throw new Error(`${app.path} already exists: cannot move ${here} there. Nothing was changed.`)
        current.set(app.slug, here)
    }

    // Compute every new file first, then write: a failure leaves the repo untouched.
    const writes = new Map()
    for (const app of apps) {
        const { id, publicKey, title } = bySlug.get(app.slug)
        const dir = current.get(app.slug)
        const confPath = join(repo, dir, "eitri-app.conf.js")
        writes.set(
            confPath,
            rewriteConf(readFileSync(confPath, "utf8"), { slug: app.slug, title, id, publicKey, applicationId, organizationId, versionMessage }, { renames, versions }),
        )
        for (const file of sourceFiles(join(repo, dir, "src"))) {
            const before = readFileSync(file, "utf8")
            const after = rewriteImports(before, renames)
            if (after !== before) writes.set(file, after)
        }
    }
    const moves = apps.map((a) => ({ path: current.get(a.slug), toPath: a.path, workspace: a.templateWorkspace ?? a.workspace, toWorkspace: a.workspace }))
    for (const name of ROOT_FILES) {
        const file = join(repo, name)
        if (!existsSync(file)) continue
        const text = rewriteSlugRefs(readFileSync(file, "utf8"), renames)
        writes.set(file, name === "app-config.yaml" ? rewriteApplicationId(rewriteAppEntries(text, moves), applicationId) : text)
    }
    for (const [file, text] of writes) writeFileSync(file, text)
    const moved = moves.filter((m) => m.path !== m.toPath)
    for (const m of moved) renameSync(join(repo, m.path), join(repo, m.toPath))

    const display = (file) => {
        const path = relative(repo, file).split("\\").join("/")
        const m = moved.find((x) => path.startsWith(`${x.path.replace(/^\.\//, "")}/`))
        return m ? path.replace(m.path.replace(/^\.\//, ""), m.toPath.replace(/^\.\//, "")) : path
    }
    return {
        filesChanged: [...writes.keys()].map(display),
        foldersMoved: moved.map((m) => ({ from: m.path, to: m.toPath })),
        apps: apps.map((a) => ({ path: a.path, workspace: a.workspace, slug: a.slug, id: bySlug.get(a.slug).id, shared: a.shared })),
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
