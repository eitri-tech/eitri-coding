#!/usr/bin/env node
// Compares each screen's store capture with the app's render of it, component by component
// (componentsProbe.mjs on both sides, lib/fidelity.mjs), and names the template files behind each difference:
//
//   node fidelity.mjs check --repo . [--screen listing]     → stdout and .eitri/fidelity.json
//
// A spec sheet, not a gate: exit 0 whatever differs (2 on bad usage). Reads .eitri/screens.json (screens.mjs
// plan), <capture>/probe.json and preview/<screen>/probe.json; a screen whose probe is missing on either side
// gets `ok: false` and an error: it was not captured or not rendered with --probe yet.
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
        const withOwners = (d) => ({ ...d, owners: ownersOf(d.path, owners).map((o) => `${plan.apps?.[o.app] ?? o.app}/${o.file}`) })
        screens.push({
            name: screen.name,
            ok: diffs.length === 0,
            checked,
            diffs: diffs.map(withOwners),
            ...(checked === 0 ? { note: "nothing to measure: the store page has none of this screen's parts (e.g. no product cards on its home); compare its tiles by eye" } : {}),
        })
    }
    if (only && !screens.length) throw new Error(`No screen ${only} in .eitri/screens.json`)
    const report = { ok: screens.every((s) => s.ok), screens }
    writeFileSync(join(repo, ".eitri", "fidelity.json"), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
}

try {
    main(process.argv.slice(2))
} catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 2
}
