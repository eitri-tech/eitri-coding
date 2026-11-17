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
    // A path with backslashes (Windows) is quoted: a script path may end in a quote.
    assert.match(listing.commands.render, /browser-preview\.mjs'? --app home .*--probe .*componentsProbe\.mjs/)
    assert.match(listing.commands.capture, /scrape\.mjs'? https:\/\/www\.loja\.com\.br\/produtos\/jeans --out scrape --name listing .*--probe/)
    const pdp = plan.screens.find((s) => s.name === "pdp")
    assert.equal(pdp.app.init, "slug=short-jeans-373207-0105")
    assert.deepEqual(pdp.parts, ["pdp"])
    assert.deepEqual(plan.apps, { home: "./shopping-vtex-template-home", pdp: "./shopping-vtex-template-pdp", shared: "./shopping-vtex-template-shared" })
})

test("fidelity check: per screen, every difference with the template files that draw it; a spec sheet that always exits 0", () => {
    const dir = repo()
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const text = (over = {}) => ({ text: "x", fontSize: 18, fontWeight: 300, fontFamily: "montserrat", textTransform: "none", color: "rgb(51, 51, 51)", letterSpacing: 0, lineHeight: 24, lines: 1, struck: false, ...over })
    const pdpProbe = (weight) => ({ viewport: 375, cards: null, listing: null, pdp: { title: text({ fontWeight: weight }), price: null, listPrice: null, installments: null, gallery: null, option: null, buyButton: null } })
    mkdirSync(join(dir, "scrape", "pdp"), { recursive: true })
    writeFileSync(join(dir, "scrape", "pdp", "probe.json"), JSON.stringify(pdpProbe(300)))
    mkdirSync(join(dir, "preview", "pdp"), { recursive: true })
    writeFileSync(join(dir, "preview", "pdp", "probe.json"), JSON.stringify(pdpProbe(700)))

    const failing = spawnSync(process.execPath, [fidelity, "check", "--repo", dir, "--screen", "pdp"], { encoding: "utf8" })
    assert.equal(failing.status, 0)
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
    assert.equal(missing.status, 0)
    assert.match(JSON.parse(missing.stdout).screens[0].error, /probe\.json/)
})

test("screens plan: a VTEX store's cart is captured and rendered with its product in it, not empty", () => {
    const dir = repo()
    const profile = JSON.parse(readFileSync(join(dir, ".eitri", "profile.json"), "utf8"))
    profile.pages.skuId = "768170"
    profile.pages.sellerId = "1"
    writeFileSync(join(dir, ".eitri", "profile.json"), JSON.stringify(profile))
    execFileSync(process.execPath, [screens, "plan", "--repo", dir], { encoding: "utf8" })
    const cart = JSON.parse(readFileSync(join(dir, ".eitri", "screens.json"), "utf8")).screens.find((s) => s.name === "cart")
    assert.equal(cart.store.url, "https://www.loja.com.br/checkout/cart/add?sku=768170&qty=1&seller=1&sc=1&redirect=true")
    // The app's cart opens the same product: an order form made on the store's checkout, its id as the init param.
    assert.match(cart.commands.render, /--init "orderFormId=\$\(node .*screens\.mjs'? order-form --repo \.\)"/)
})

