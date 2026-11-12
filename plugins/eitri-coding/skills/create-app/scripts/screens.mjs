#!/usr/bin/env node
// The screens the app must reproduce 1:1, and how to put each store page next to the app's render of it:
//
//   node screens.mjs plan --repo .        → .eitri/screens.json
//
// For each screen — home, listing (PLP and product card), pdp, login, cart — the store page (profile.pages,
// found by detect-store.mjs), its capture folder, the parts fidelity.mjs compares, the mini-app and init
// params that open the same page in the app (the listing's own facets, the product's slug), and the exact
// capture and render commands, both with componentsProbe.mjs. Run it after capturing the listing: its
// facets come from that capture. Deterministic: same profile and captures, same plan.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { landingTarget } from "./lib/vtexBlocks.mjs"
import { SCREEN_PARTS } from "./lib/fidelity.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const PROBE = resolve(here, "lib", "componentsProbe.mjs")
const SCRAPE = resolve(here, "..", "..", "site-clone", "scripts", "scrape.mjs")
const PREVIEW = resolve(here, "..", "..", "eitri-device", "tools", "browser-preview.mjs")

const option = (args, name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback)

/**
 * What the listing page lists, as the template's ProductCatalog state: { facets, query?, sort?, title }.
 * `known` (profile.pages.listingTarget, from VTEX's pagetype) answers when the page itself cannot say.
 */
export function listingState(html, path, known) {
    const read = landingTarget(html, path)
    const target = read === undefined && known ? known : read
    const h1 = /<h1\b[^>]*>([^<]*)/i.exec(String(html ?? ""))?.[1]?.trim()
    if (target?.type === "search") return { facets: [], query: target.value, title: target.title ?? h1 ?? "" }
    if (target && typeof target === "object") {
        const facets = target.type === "collection" ? [{ key: "productClusterIds", value: target.value }, ...(target.facets ?? [])] : target.facets
        return { facets, ...(target.sort ? { sort: target.sort } : {}), title: target.title ?? h1 ?? "" }
    }
    // A VTEX search route (category/department path) or a page it cannot read: the path's segments as categories.
    const segments = new URL(path, "https://store.invalid").pathname.split("/").filter(Boolean)
    return { facets: segments.map((value, i) => ({ key: `category-${i + 1}`, value })), title: h1 ?? "", inferred: target !== "path" }
}

function plan(repo) {
    const profile = readJson(join(repo, ".eitri", "profile.json"), {})
    const apps = Object.fromEntries((readJson(join(repo, ".eitri", "plan.json"), { apps: [] }).apps ?? []).map((a) => [a.alias, a.path]))
    const state = readJson(join(repo, ".eitri", "create-app.state.json"), {})
    const pages = profile.pages ?? {}
    const vtex = profile.platform === "VTEX"
    const screens = []
    const add = (name, url, app, init, note) => {
        if (!url) return
        const capture = `scrape/${name}`
        const initArg = init ? ` --init "${init}"` : ""
        screens.push({
            name,
            parts: SCREEN_PARTS[name] ?? [],
            store: { url, capture },
            app: { app, init: init ?? null },
            ...(note ? { note } : {}),
            commands: {
                capture: `node ${SCRAPE} ${url} --out scrape --name ${name} --bp 375,414 --primary 375 --probe ${PROBE}`,
                render: `node ${PREVIEW} --app ${app} --config .eitri/remote-config.json${initArg} --compare ${capture}/screenshots/375-fullpage.png --probe ${PROBE} --out preview --name ${name}`,
            },
        })
    }
    add("home", profile.url ?? profile.host, "home")
    if (pages.listing) {
        const path = new URL(pages.listing).pathname
        const raw = join(repo, "scrape", "listing", "page.raw.html")
        if (existsSync(raw)) {
            const state = listingState(readFileSync(raw, "utf8"), path, pages.listingTarget)
            const params = { facets: state.facets, ...(state.query ? { query: state.query } : {}), ...(state.sort ? { sort: state.sort } : {}) }
            const init = `route=ProductCatalog&title=${encodeURIComponent(state.title)}&params=${encodeURIComponent(JSON.stringify(params))}`
            add("listing", pages.listing, "home", init, state.inferred ? "facets inferred from the path: check the app lists the same products" : undefined)
        } else add("listing", pages.listing, "home", null, "capture the listing, then plan again: its facets come from the capture")
    }
    if (pages.product) {
        const slug = vtex ? new URL(pages.product).pathname.replace(/^\/|\/p\/?$/g, "") : null
        add("pdp", pages.product, "pdp", slug ? `slug=${slug}` : null, slug ? undefined : "this template's PDP init params are not known: open the product by hand")
    }
    add("login", pages.login, "account", "route=SignIn")
    add("cart", pages.cart, "cart")
    return { template: state.template?.gitUrl ?? null, probe: PROBE, apps, screens }
}

function main(args) {
    if (args[0] !== "plan") throw new Error("usage: screens.mjs plan --repo <dir>")
    const repo = option(args, "--repo") ?? "."
    const out = plan(repo)
    writeFileSync(join(repo, ".eitri", "screens.json"), `${JSON.stringify(out, null, 2)}\n`)
    console.log(JSON.stringify(out, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main(process.argv.slice(2))
    } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exit(1)
    }
}
