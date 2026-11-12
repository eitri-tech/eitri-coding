import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "detect-store.mjs")
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: "utf8" }))

test("--capture reads the raw HTML (VTEX runtime) and the rendered DOM (injected asset hosts) together", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    writeFileSync(join(dir, "page.raw.html"), `<html lang="pt-BR"><head><title>Loja X | Moda</title></head><body><script>__RUNTIME__ = {"account":"lojax"}</script></body></html>`)
    writeFileSync(
        join(dir, "page.rendered.html"),
        `<html lang="pt-BR"><head><link rel="apple-touch-icon" sizes="180x180" href="/arquivos/apple.png"></head><body><img src="https://lojax.vtexassets.com/a.png"></body></html>`,
    )
    const tenant = join(dir, "tenant.json")
    writeFileSync(tenant, JSON.stringify({ defaultCurrency: "BRL", defaultLocale: "pt-BR" }))
    const products = join(dir, "products.json")
    writeFileSync(products, "[]")
    const out = run("https://www.lojax.com.br/", "--capture", dir, "--tenant", tenant, "--products", products)
    assert.equal(out.platform, "VTEX")
    assert.equal(out.account, "lojax")
    assert.equal(out.currency, "BRL", "the page has no currency: the VTEX tenant answer fills it")
})

test("--html reads a saved page", () => {
    const file = join(mkdtempSync(join(tmpdir(), "html-")), "home.html")
    writeFileSync(file, `<html><head><title>Loja Y</title></head><body><script>Shopify.shop = "lojay.myshopify.com";</script></body></html>`)
    const out = run("https://lojay.com.br", "--html", file)
    assert.equal(out.platform, "SHOPIFY")
    assert.equal(out.shopDomain, "lojay.myshopify.com")
})

test("VTEX without a tenant or a product link: the sales channel fills the currency and the catalog search the product page", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    writeFileSync(join(dir, "page.raw.html"), `<html><head><title>Loja Z</title></head><body><img src="https://lojaz.vtexassets.com/a.png"><img src="https://lojaz.vtexassets.com/b.png"><a href="/produtos/vestido">Vestidos</a></body></html>`)
    const tenant = join(dir, "tenant.json")
    writeFileSync(tenant, "null")
    const channel = join(dir, "channel.json")
    writeFileSync(channel, JSON.stringify({ CultureInfo: "pt-BR", CurrencyCode: "BRL" }))
    const products = join(dir, "products.json")
    writeFileSync(products, JSON.stringify([{ linkText: "vestido-azul-12", items: [{ sellers: [{ commertialOffer: { AvailableQuantity: 1 } }] }] }]))
    const offline = join(dir, "responses.json")
    writeFileSync(offline, "{}")
    const out = run("https://www.lojaz.com.br/", "--capture", dir, "--tenant", tenant, "--sales-channel", channel, "--products", products, "--responses", offline)
    assert.equal(out.currency, "BRL")
    assert.equal(out.locale, "pt-BR")
    assert.equal(out.pages.product, "https://www.lojaz.com.br/vestido-azul-12/p")
})

test("pages: the listing is the home's most repeated link that lists products; the PDP its product with the most variants in stock", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    const home = `<html lang="pt-BR"><head><title>Loja W</title></head><body><img src="https://lojaw.vtexassets.com/a.png"><img src="https://lojaw.vtexassets.com/b.png">
<a href="/sobre">Sobre</a><a href="/sobre">Sobre</a><a href="/sobre">Sobre</a><a href="/produtos/vestido">Vestidos</a><a href="/produtos/vestido">Vestidos</a><a href="/bazar">Bazar</a></body></html>`
    writeFileSync(join(dir, "page.raw.html"), home)
    const cards = (n) => Array.from({ length: n }, (_, i) => `<a href="/vestido-${i}-1${i}/p">v${i}</a>`).join("")
    const offer = (qty) => ({ sellers: [{ commertialOffer: { AvailableQuantity: qty } }] })
    const responses = join(dir, "responses.json")
    writeFileSync(
        responses,
        JSON.stringify({
            "https://lojaw.vtexcommercestable.com.br/api/tenant/tenants?q=lojaw": { status: 404, body: "" },
            "https://lojaw.vtexcommercestable.com.br/api/catalog_system/pub/saleschannel/default": { CurrencyCode: "BRL", CultureInfo: "pt-BR" },
            "https://www.lojaw.com.br/sobre": "<h1>Sobre nós</h1>",
            "https://www.lojaw.com.br/produtos/vestido": `<h1>Vestidos</h1>${cards(8)}`,
            "https://lojaw.vtexcommercestable.com.br/api/catalog_system/pub/products/search/vestido-0-10/p": [{ items: [offer(1)] }],
            "https://lojaw.vtexcommercestable.com.br/api/catalog_system/pub/products/search/vestido-1-11/p": [{ items: [offer(1), offer(0), offer(4)] }],
            "https://lojaw.vtexcommercestable.com.br/api/catalog_system/pub/products/search/vestido-2-12/p": [{ items: [offer(0)] }],
        }),
    )
    const out = run("https://www.lojaw.com.br/", "--capture", dir, "--responses", responses)
    assert.equal(out.currency, "BRL")
    assert.equal(out.pages.listing, "https://www.lojaw.com.br/produtos/vestido")
    assert.equal(out.pages.product, "https://www.lojaw.com.br/vestido-1-11/p")
})

test("pages: a listing rendered client-side (no product links in its server HTML) is found by rendering it", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    writeFileSync(
        join(dir, "page.raw.html"),
        `<html lang="pt-BR"><head><title>Loja R</title></head><body><img src="https://lojar.vtexassets.com/a.png"><img src="https://lojar.vtexassets.com/b.png">
<a href="/sobre">Sobre</a><a href="/9060">9060</a><a href="/9060">9060</a><a href="/linha">Linha</a></body></html>`,
    )
    const cards = (n) => Array.from({ length: n }, (_, i) => `<a href="/tenis-${i}-1${i}/p?skuId=${i}">t${i}</a>`).join("")
    const offer = (qty) => ({ sellers: [{ commertialOffer: { AvailableQuantity: qty } }] })
    const responses = join(dir, "responses.json")
    writeFileSync(
        responses,
        JSON.stringify({
            "https://lojar.vtexcommercestable.com.br/api/tenant/tenants?q=lojar": { defaultCurrency: "BRL", defaultLocale: "pt-BR" },
            "https://www.lojar.com.br/9060": "<div id=__next></div>",
            "https://www.lojar.com.br/linha": "<div id=__next></div>",
            "render:https://www.lojar.com.br/9060": `<h1>9060</h1>${cards(7)}`,
            "https://lojar.vtexcommercestable.com.br/api/catalog_system/pub/products/search/tenis-0-10/p": [{ items: [offer(1)] }],
            "https://lojar.vtexcommercestable.com.br/api/catalog_system/pub/products/search/tenis-1-11/p": [{ items: [offer(2), offer(3)] }],
        }),
    )
    const out = run("https://www.lojar.com.br/", "--capture", dir, "--responses", responses)
    assert.equal(out.pages.listing, "https://www.lojar.com.br/9060")
    assert.equal(out.pages.product, "https://www.lojar.com.br/tenis-1-11/p")
})

test("pages: a listing with sort or filter controls wins over a more repeated landing page that also lists products", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    writeFileSync(
        join(dir, "page.raw.html"),
        `<html lang="pt-BR"><head><title>Loja L</title></head><body><img src="https://lojal.vtexassets.com/a.png"><img src="https://lojal.vtexassets.com/b.png">
<a href="/colecao">C</a><a href="/colecao">C</a><a href="/colecao">C</a><a href="/tenis">T</a></body></html>`,
    )
    const cards = (n, p) => Array.from({ length: n }, (_, i) => `<a href="/${p}-${i}-1${i}/p">x</a>`).join("")
    const responses = join(dir, "responses.json")
    writeFileSync(
        responses,
        JSON.stringify({
            "https://lojal.vtexcommercestable.com.br/api/tenant/tenants?q=lojal": { defaultCurrency: "BRL", defaultLocale: "pt-BR" },
            "https://www.lojal.com.br/colecao": `<h2>Modern architecture.</h2>${cards(8, "colecao")}`,
            "https://www.lojal.com.br/tenis": `<h1>Tênis</h1><button>Ordenar por</button><button>Filtrar</button>${cards(8, "tenis")}`,
        }),
    )
    const out = run("https://www.lojal.com.br/", "--capture", dir, "--responses", responses)
    assert.equal(out.pages.listing, "https://www.lojal.com.br/tenis")
})

test("pages: on VTEX the listing's pagetype says what it lists (pages.listingTarget)", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    writeFileSync(join(dir, "page.raw.html"), `<html lang="pt-BR"><head><title>Loja P</title></head><body><img src="https://lojap.vtexassets.com/a.png"><img src="https://lojap.vtexassets.com/b.png"><a href="/ellipse">E</a></body></html>`)
    const cards = Array.from({ length: 7 }, (_, i) => `<a href="/t-${i}-1${i}/p">x</a>`).join("")
    const responses = join(dir, "responses.json")
    writeFileSync(
        responses,
        JSON.stringify({
            "https://lojap.vtexcommercestable.com.br/api/tenant/tenants?q=lojap": { defaultCurrency: "BRL", defaultLocale: "pt-BR" },
            "https://www.lojap.com.br/ellipse": `<button>Filtrar</button>${cards}`,
            "https://lojap.vtexcommercestable.com.br/api/catalog_system/pub/portal/pagetype/ellipse": { id: "577", name: "Ellipse", url: "lojap.vtexcommercestable.com.br/577?map=productClusterIds", pageType: "Collection" },
        }),
    )
    const out = run("https://www.lojap.com.br/", "--capture", dir, "--responses", responses)
    assert.deepEqual(out.pages.listingTarget, { type: "collection", value: "577", title: "Ellipse" })
})

test("pages: a listing VTEX only knows as full text is a search when that search finds products", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    writeFileSync(join(dir, "page.raw.html"), `<html lang="pt-BR"><head><title>Loja F</title></head><body><img src="https://lojaf.vtexassets.com/a.png"><img src="https://lojaf.vtexassets.com/b.png"><a href="/9060">E</a></body></html>`)
    const cards = Array.from({ length: 7 }, (_, i) => `<a href="/t-${i}-1${i}/p">x</a>`).join("")
    const responses = join(dir, "responses.json")
    writeFileSync(
        responses,
        JSON.stringify({
            "https://lojaf.vtexcommercestable.com.br/api/tenant/tenants?q=lojaf": { defaultCurrency: "BRL", defaultLocale: "pt-BR" },
            "https://www.lojaf.com.br/9060": `<button>Filtrar</button>${cards}`,
            "https://lojaf.vtexcommercestable.com.br/api/catalog_system/pub/portal/pagetype/9060": { id: null, name: "9060", url: "lojaf.vtexcommercestable.com.br/9060", pageType: "FullText" },
            "https://lojaf.vtexcommercestable.com.br/api/catalog_system/pub/products/search?ft=9060&_from=0&_to=0": [{ productId: "1" }],
        }),
    )
    const out = run("https://www.lojaf.com.br/", "--capture", dir, "--responses", responses)
    assert.deepEqual(out.pages.listingTarget, { type: "search", value: "9060", title: "9060" })
})
