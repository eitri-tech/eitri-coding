#!/usr/bin/env node
// Persist successful and partial creation results immediately; never store credentials or arbitrary API payloads.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]))
const identity = (value, keys) => {
    if (!value?.id) throw new Error("Creation result has no resource id: state was not changed")
    return pick(value, keys)
}

export function recordCreation(repo, tool, response) {
    const dir = join(repo, ".eitri")
    const file = join(dir, "create-app.state.json")
    const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
    const created = state.created ??= {}
    if (tool === "create_organization" || tool === "create_application") {
        if (!response.created) throw new Error("Preview/failed result: no resource was created")
        const key = tool === "create_organization" ? "organization" : "application"
        const value = identity(response[key], ["id", "name", "organizationId"])
        if (created[key]?.id && created[key].id !== value.id) throw new Error(`State already records another ${key}; reconcile it before overwriting`)
        created[key] = value
        if (response.environments) created.environments = response.environments.map((env) => identity(env, ["id", "name", "appKey"]))
    } else if (tool === "create_eitri_apps") {
        const bySlug = new Map((created.eitriApps ?? []).map((app) => [app.slug, app]))
        for (const app of [...(response.created ?? []), ...(response.reused ?? [])]) {
            const value = identity(app, ["id", "slug", "title", "publicKey"])
            if (!value.slug) throw new Error("Mini-app result has no slug")
            if (bySlug.has(value.slug) && bySlug.get(value.slug).id !== value.id) throw new Error(`State has a different id for ${value.slug}; reconcile before overwriting`)
            bySlug.set(value.slug, { ...bySlug.get(value.slug), ...value })
        }
        created.eitriApps = [...bySlug.values()]
        if (response.appGroupId) created.appGroupId = response.appGroupId
    } else throw new Error("record supports create_organization, create_application or create_eitri_apps")

    mkdirSync(dir, { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
        writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
        renameSync(temporary, file)
    } finally { rmSync(temporary, { force: true }) }
    return state
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2)
        const option = (name) => {
            const i = args.indexOf(name)
            if (i < 0 || !args[i + 1]) throw new Error(`missing ${name}`)
            return args[i + 1]
        }
        if (args[0] !== "record") throw new Error("usage: state.mjs record --repo <repo> --tool <creation tool> --result <structured JSON>")
        recordCreation(option("--repo"), option("--tool"), JSON.parse(readFileSync(option("--result"), "utf8")))
        console.log("Creation ids saved to .eitri/create-app.state.json")
    } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
    }
}
