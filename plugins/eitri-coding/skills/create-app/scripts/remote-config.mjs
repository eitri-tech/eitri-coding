#!/usr/bin/env node
// Prints { config, needs, warnings } for a new store app's environments.
//
//   node remote-config.mjs --repo <template repo> --profile <detect-store.json> --plan <wire plan.json>
//                          [--secrets <secrets.json>] [--set path=value ...]
//
// <secrets.json> holds what only the user can give, e.g. Shopify's
// { "storefrontAccessToken", "clientId", "callbackUrl" } or Wake's { "tcsAccount" }.
// Keep it out of git. --set overrides any config path (e.g. appConfigs.headerLogo=<url>).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildRemoteConfig } from "./lib/remoteConfig.mjs"

function option(args, name, required = true) {
    const i = args.indexOf(name)
    const value = i >= 0 ? args[i + 1] : undefined
    if (required && !value) throw new Error(`missing ${name}`)
    return value
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"))
}

/** "a.b=value": JSON values (true, 3, {"x":1}) are parsed, anything else stays a string. */
function parseSet(pair) {
    const eq = pair.indexOf("=")
    if (eq < 1) throw new Error(`--set expects path=value, got "${pair}"`)
    const raw = pair.slice(eq + 1)
    let value = raw
    try {
        value = JSON.parse(raw)
    } catch {}
    return [pair.slice(0, eq), value]
}

try {
    const args = process.argv.slice(2)
    const template = readJson(join(option(args, "--repo"), "remoteConfig.json"))
    const profile = readJson(option(args, "--profile"))
    const { apps } = readJson(option(args, "--plan"))
    const secretsFile = option(args, "--secrets", false)
    const overrides = Object.fromEntries(args.flatMap((arg, i) => (arg === "--set" ? [parseSet(args[i + 1])] : [])))

    const slugs = Object.fromEntries(apps.filter((a) => !a.shared).map((a) => [a.alias, a.slug]))
    const result = buildRemoteConfig({ template, profile, slugs, secrets: secretsFile ? readJson(secretsFile) : {}, overrides })
    console.log(JSON.stringify(result, null, 2))
} catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
}
