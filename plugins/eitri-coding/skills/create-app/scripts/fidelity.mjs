#!/usr/bin/env node
// Compares each screen's store capture with the app's render of it, component by component
// (componentsProbe.mjs on both sides, lib/fidelity.mjs), and names the template files behind each difference:
//
//   node fidelity.mjs check --repo . [--screen listing]     → stdout and .eitri/fidelity.json; exit 1 while any differs
//
// Reads .eitri/screens.json (screens.mjs plan), <capture>/probe.json and preview/<screen>/probe.json. A screen
// whose probe is missing on either side fails: it was not captured or not rendered with --probe yet.
// .eitri/fidelity-waivers.json ({ "<screen>": { "<part path>": "<why it cannot match>" } }) moves a difference
// to `waived`: still reported, no longer failing. A waiver without a reason does not count. The "*" screen
// applies to every screen, and "*" in a path matches any run of it ("*.fontFamily": a font the app cannot load).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { compareProbes, ownersOf } from "./lib/fidelity.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const option = (args, name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

function main(args) {
    if (args[0] !== "check") throw new Error("usage: fidelity.mjs check --repo <dir> [--screen <name>] [--preview preview]")
    const repo = option(args, "--repo") ?? "."
    const previewDir = option(args, "--preview") ?? "preview"
    const only = option(args, "--screen")
    const plan = readJson(join(repo, ".eitri", "screens.json"))
    const allOwners = readJson(resolve(here, "..", "references", "template-owners.json"))
    const owners = allOwners[plan.template] ?? {}
    const waiversFile = join(repo, ".eitri", "fidelity-waivers.json")
    const waivers = existsSync(waiversFile) ? readJson(waiversFile) : {}
    const screens = []
    for (const screen of plan.screens.filter((s) => !only || s.name === only)) {
        if (!screen.parts.length) {
            screens.push({ name: screen.name, ok: true, visualOnly: true, note: "no component parts to measure: compare preview/<screen>/compare/*.png by eye" })
            continue
        }
        const storeProbe = join(repo, screen.store.capture, "probe.json")
        const appProbe = join(repo, previewDir, screen.name, "probe.json")
        const missing = [storeProbe, appProbe].filter((p) => !existsSync(p))
        if (missing.length) {
            screens.push({ name: screen.name, ok: false, error: `no ${missing.map((p) => p.replace(`${repo}/`, "")).join(", ")}: run its capture / render command with --probe` })
            continue
        }
        const { checked, diffs } = compareProbes(readJson(storeProbe), readJson(appProbe), { screen: screen.name })
        // The screen's own waivers, then the "*" ones (every screen); a "*" in a path matches any run of it.
        const rules = Object.entries({ ...(waivers["*"] ?? {}), ...(waivers[screen.name] ?? {}) })
            .filter(([, why]) => typeof why === "string" && why.trim())
            .map(([pattern, why]) => [new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".+")}$`), why.trim()])
        const reasonOf = (d) => rules.find(([re]) => re.test(d.path))?.[1] ?? null
        const withOwners = (d) => ({ ...d, owners: ownersOf(d.path, owners).map((o) => `${plan.apps?.[o.app] ?? o.app}/${o.file}`) })
        const open = diffs.filter((d) => !reasonOf(d))
        screens.push({
            name: screen.name,
            ok: open.length === 0,
            checked,
            diffs: open.map(withOwners),
            waived: diffs.filter(reasonOf).map((d) => ({ ...withOwners(d), reason: reasonOf(d) })),
            ...(checked === 0 ? { note: "nothing to measure: the store page has none of this screen's parts (e.g. no product cards on its home); compare its tiles by eye" } : {}),
        })
    }
    if (only && !screens.length) throw new Error(`No screen ${only} in .eitri/screens.json`)
    const report = { ok: screens.every((s) => s.ok), screens }
    writeFileSync(join(repo, ".eitri", "fidelity.json"), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    process.exit(report.ok ? 0 : 1)
}

try {
    main(process.argv.slice(2))
} catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
}
