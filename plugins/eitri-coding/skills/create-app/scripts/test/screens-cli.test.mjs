import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const screens = join(here, "..", "screens.mjs")
const fidelity = join(here, "..", "fidelity.mjs")

function repo() {
    const dir = mkdtempSync(join(tmpdir(), "screens-"))
    mkdirSync(join(dir, ".eitri"))
    writeFileSync(
        join(dir, ".eitri", "profile.json"),
        JSON.stringify({ platform: "VTEX", host: "https://www.loja.com.br", pages: { listing: "https://www.loja.com.br/produtos/jeans", product: "https://www.loja.com.br/short-jeans-373207-0105/p", cart: "https://www.loja.com.br/checkout/#/cart", login: "https://www.loja.com.br/login" } }),
    )
    writeFileSync(
        join(dir, ".eitri", "plan.json"),
        JSON.stringify({ apps: [{ path: "./shopping-vtex-template-home", alias: "home" }, { path: "./shopping-vtex-template-pdp", alias: "pdp" }, { path: "./shopping-vtex-template-shared", alias: "shared" }] }),
    )
    writeFileSync(join(dir, ".eitri", "create-app.state.json"), JSON.stringify({ template: { gitUrl: "https://github.com/eitri-tech/eitri-shopping-template" } }))
    // A headless listing: its filter links share the collection.
    mkdirSync(join(dir, "scrape", "listing"), { recursive: true })
    writeFileSync(
        join(dir, "scrape", "listing", "page.raw.html"),
        `<h1>Jeans Refarm</h1><a href="/produtos/jeans?filter.productClusterIds=1748&amp;filter.tamanho=m">M</a><a href="/produtos/jeans?filter.productClusterIds=1748&amp;filter.cor=azul">Azul</a>`,
    )
    return dir
}

test("screens plan: each screen's store capture and the app render that shows the same page, as commands", () => {
    const dir = repo()
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const plan = JSON.parse(readFileSync(join(dir, ".eitri", "screens.json"), "utf8"))
    const listing = plan.screens.find((s) => s.name === "listing")
    assert.equal(listing.store.url, "https://www.loja.com.br/produtos/jeans")
    assert.equal(listing.store.capture, "scrape/listing")
    assert.equal(listing.app.app, "home")
    const init = new URLSearchParams(listing.app.init)
    assert.equal(init.get("route"), "ProductCatalog")
    assert.equal(init.get("title"), "Jeans Refarm")
    assert.deepEqual(JSON.parse(init.get("params")).facets, [{ key: "productClusterIds", value: "1748" }])
    assert.match(listing.commands.render, /browser-preview\.mjs --app home .*--probe .*componentsProbe\.mjs/)
    assert.match(listing.commands.capture, /scrape\.mjs https:\/\/www\.loja\.com\.br\/produtos\/jeans --out scrape --name listing .*--probe/)
    const pdp = plan.screens.find((s) => s.name === "pdp")
    assert.equal(pdp.app.init, "slug=short-jeans-373207-0105")
    assert.deepEqual(pdp.parts, ["pdp"])
    assert.deepEqual(plan.apps, { home: "./shopping-vtex-template-home", pdp: "./shopping-vtex-template-pdp", shared: "./shopping-vtex-template-shared" })
})

test("fidelity check: per screen, every difference with the template files that draw it; exit 1 until none is left", () => {
    const dir = repo()
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const text = (over = {}) => ({ text: "x", fontSize: 18, fontWeight: 300, fontFamily: "montserrat", textTransform: "none", color: "rgb(51, 51, 51)", letterSpacing: 0, lineHeight: 24, lines: 1, struck: false, ...over })
    const pdpProbe = (weight) => ({ viewport: 375, cards: null, listing: null, pdp: { title: text({ fontWeight: weight }), price: null, listPrice: null, installments: null, gallery: null, option: null, buyButton: null } })
    mkdirSync(join(dir, "scrape", "pdp"), { recursive: true })
    writeFileSync(join(dir, "scrape", "pdp", "probe.json"), JSON.stringify(pdpProbe(300)))
    mkdirSync(join(dir, "preview", "pdp"), { recursive: true })
    writeFileSync(join(dir, "preview", "pdp", "probe.json"), JSON.stringify(pdpProbe(700)))

    const failing = spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "pdp"], { encoding: "utf8" })
    assert.equal(failing.status, 1)
    const report = JSON.parse(failing.stdout)
    assert.equal(report.ok, false)
    const [d] = report.screens[0].diffs
    assert.deepEqual([d.path, d.store, d.app], ["pdp.title.fontWeight", 300, 700])
    assert.deepEqual(d.owners, ["./shopping-vtex-template-pdp/src/components/MainDescription/MainDescription.jsx"])

    writeFileSync(join(dir, "preview", "pdp", "probe.json"), JSON.stringify(pdpProbe(300)))
    const passing = spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "pdp"], { encoding: "utf8" })
    assert.equal(passing.status, 0, passing.stdout)
    assert.equal(JSON.parse(readFileSync(join(dir, ".eitri", "fidelity.json"), "utf8")).ok, true)

    // A screen not captured or not rendered yet is reported, never passed.
    const missing = spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "listing"], { encoding: "utf8" })
    assert.equal(missing.status, 1)
    assert.match(JSON.parse(missing.stdout).screens[0].error, /probe\.json/)
})

test("fidelity check: a written waiver (screen → part → reason) reports the difference without failing; a reasonless one does not count", () => {
    const dir = repo()
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const probe = (weight) => ({ viewport: 375, cards: null, listing: null, pdp: { title: { text: "x", fontSize: 18, fontWeight: weight, textTransform: "none", color: "rgb(0, 0, 0)" } } })
    mkdirSync(join(dir, "scrape", "pdp"), { recursive: true })
    writeFileSync(join(dir, "scrape", "pdp", "probe.json"), JSON.stringify(probe(300)))
    mkdirSync(join(dir, "preview", "pdp"), { recursive: true })
    writeFileSync(join(dir, "preview", "pdp", "probe.json"), JSON.stringify(probe(700)))
    writeFileSync(join(dir, ".eitri", "fidelity-waivers.json"), JSON.stringify({ pdp: { "pdp.title.fontWeight": "" } }))
    assert.equal(spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "pdp"], { encoding: "utf8" }).status, 1)
    writeFileSync(join(dir, ".eitri", "fidelity-waivers.json"), JSON.stringify({ pdp: { "pdp.title.fontWeight": "the store's light weight is not in the app's font files" } }))
    const run = spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "pdp"], { encoding: "utf8" })
    assert.equal(run.status, 0, run.stdout)
    const [screen] = JSON.parse(run.stdout).screens
    assert.deepEqual(screen.diffs, [])
    assert.deepEqual(screen.waived.map((w) => [w.path, w.reason]), [["pdp.title.fontWeight", "the store's light weight is not in the app's font files"]])
})

test("fidelity check: a screen whose store page has none of its parts passes with a note, not silently", () => {
    const dir = repo()
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    for (const side of [join(dir, "scrape", "home"), join(dir, "preview", "home")]) {
        mkdirSync(side, { recursive: true })
        writeFileSync(join(side, "probe.json"), JSON.stringify({ viewport: 375, cards: null, pdp: null, listing: null }))
    }
    const [home] = JSON.parse(spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "home"], { encoding: "utf8" }).stdout).screens
    assert.equal(home.ok, true)
    assert.equal(home.checked, 0)
    assert.match(home.note, /nothing to measure/)
})

test("screens plan: a client-rendered listing without filter links opens what VTEX's pagetype says it lists (profile.pages.listingTarget)", () => {
    const dir = repo()
    const profile = JSON.parse(readFileSync(join(dir, ".eitri", "profile.json"), "utf8"))
    profile.pages.listing = "https://www.loja.com.br/ellipse"
    profile.pages.listingTarget = { type: "collection", value: "577", title: "Ellipse" }
    writeFileSync(join(dir, ".eitri", "profile.json"), JSON.stringify(profile))
    writeFileSync(join(dir, "scrape", "listing", "page.raw.html"), `<div id="__next"></div>`)
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const listing = JSON.parse(readFileSync(join(dir, ".eitri", "screens.json"), "utf8")).screens.find((s) => s.name === "listing")
    const init = new URLSearchParams(listing.app.init)
    assert.deepEqual(JSON.parse(init.get("params")), { facets: [{ key: "productClusterIds", value: "577" }] })
    assert.equal(init.get("title"), "Ellipse")
    assert.equal(listing.note, undefined, "not inferred: VTEX said what the page lists")
})

test("screens plan: a full-text listing target opens the app's catalog with that query", () => {
    const dir = repo()
    const profile = JSON.parse(readFileSync(join(dir, ".eitri", "profile.json"), "utf8"))
    profile.pages.listing = "https://www.loja.com.br/9060"
    profile.pages.listingTarget = { type: "search", value: "9060", title: "9060" }
    writeFileSync(join(dir, ".eitri", "profile.json"), JSON.stringify(profile))
    writeFileSync(join(dir, "scrape", "listing", "page.raw.html"), `<div id="__next"></div>`)
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const listing = JSON.parse(readFileSync(join(dir, ".eitri", "screens.json"), "utf8")).screens.find((s) => s.name === "listing")
    assert.deepEqual(JSON.parse(new URLSearchParams(listing.app.init).get("params")), { facets: [], query: "9060" })
})

test("fidelity check: a \"*\" screen waives on every screen and \"*\" in a path matches any run of it — one reason for a font the app cannot load", () => {
    const dir = repo()
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const text = (family, weight = 600) => ({ text: "x", fontSize: 18, fontWeight: weight, fontFamily: family, textTransform: "none", color: "rgb(0, 0, 0)" })
    const probe = (family, weight) => ({ viewport: 375, cards: null, listing: null, pdp: { title: text(family, weight), price: text(family) } })
    mkdirSync(join(dir, "scrape", "pdp"), { recursive: true })
    writeFileSync(join(dir, "scrape", "pdp", "probe.json"), JSON.stringify(probe("proximanova", 300)))
    mkdirSync(join(dir, "preview", "pdp"), { recursive: true })
    writeFileSync(join(dir, "preview", "pdp", "probe.json"), JSON.stringify(probe("figtree", 700)))
    const why = "the store's proximaNova files have no CORS header: Figtree stands in"
    writeFileSync(join(dir, ".eitri", "fidelity-waivers.json"), JSON.stringify({ "*": { "*.fontFamily": why } }))
    const run = spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "pdp"], { encoding: "utf8" })
    const [screen] = JSON.parse(run.stdout).screens
    assert.deepEqual(screen.diffs.map((d) => d.path), ["pdp.title.fontWeight"], "only what the wildcard does not name still fails")
    assert.deepEqual(screen.waived.map((w) => [w.path, w.reason]), [["pdp.title.fontFamily", why], ["pdp.price.fontFamily", why]])
    assert.equal(run.status, 1)
})
