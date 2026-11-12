import { test } from "node:test"
import assert from "node:assert/strict"
import { detectStore, withVtexTenant, vtexTenantUrl, withVtexSalesChannel, vtexSalesChannelUrl, withVtexProduct, vtexProductSearchUrl } from "../lib/detect.mjs"
import { iconSources } from "../lib/icon.mjs"

// Fixtures are trimmed from the real home pages of each platform (Nov 2026):
// only the markers detection reads are kept.

const VTEX_IO = `<!DOCTYPE html><html lang="pt-BR"><head>
<title data-react-helmet="true">C&amp;A | Moda feminina, Masculina, Infantil, Beleza e mais</title>
<link data-react-helmet="true" rel="icon" type="image/png" sizes="96x96" href="/arquivos/cea-2025-favicon-96x96.png"/>
<link data-react-helmet="true" rel="apple-touch-icon" sizes="180x180" href="https://cea.vtexassets.com/arquivos/apple-180.png"/>
<link rel="stylesheet" href="https://cea.vtexassets.com/_v/public/assets/v1/published/cea.cea-store-theme@2.89.0/public/react/IconCart.min.css"/>
</head><body>
<svg><title>Logomarca C&amp;A - Ir para a página inicial</title></svg>
<script>__RUNTIME__ = {"account":"cea","culture":{"availableLocales":[],"country":"BRA","currency":"BRL","language":"pt","locale":"pt-BR","customCurrencySymbol":"R$"},"assets":"https:\\u002F\\u002Fcea.vtexassets.com\\u002Farquivos\\u002Fa.png https:\\u002F\\u002Fcea.vteximg.com.br\\u002Fb.png"}</script>
<img src="https://cea.vtexassets.com/arquivos/ids/1/banner.jpg"><img src="https://cea.vtexassets.com/arquivos/ids/2/banner.jpg">
</body></html>`

const VTEX_FASTSTORE = `<!DOCTYPE html><html lang="pt-BR"><head>
<title>Carrefour: As melhores promoções para você economizar</title>
<meta name="theme-color" content="#1E5BC6">
</head><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"storeConfig":{"api":{"storeId":"x","account":"carrefourbr"}}}}</script>
<img src="https://carrefourbr.vtexassets.com/arquivos/ids/1/a.jpg"><img src="https://carrefourbr.vtexassets.com/arquivos/ids/2/b.jpg">
<script type="application/ld+json">{"@type":"Offer","priceCurrency":"BRL"}</script>
</body></html>`

const VTEX_ASSETS_ONLY = `<html lang="pt-BR"><head><title>Motorola Brasil</title></head><body>
<img src="https://brmotorolanew.vtexassets.com/a.png"><img src="https://brmotorolanew.vtexassets.com/b.png">
<a href="https://www--brmotorolanew.myvtex.com/x">x</a><img src="https://cdnfiles.vtexassets.com/c.png">
</body></html>`

const WAKE = `<!DOCTYPE html><html lang=pt-BR><head>
<title>Balaroti Materiais de Construção | A Sua Casa em Primeiro Lugar</title>
<meta property=og:site_name content=Balaroti />
<link rel=apple-touch-icon href=https://balaroti.fbitsstatic.net/sf/img/apple-touch-icon.png>
</head><body>
<img src=https://balaroti.fbitsstatic.net/img/p/1.jpg><img src=https://balaroti.fbitsstatic.net/img/p/2.jpg>
<script src=https://wake-components.fbitsstatic.net/x.js></script>
<script src=https://commerce-data-exp.wake.tech/y.js></script>
</body></html>`

const SHOPIFY = `<!doctype html><html class="js" lang="pt-BR"><head>
<title>
  DLK | Moda Fitness, Lingerie, Praia e Calçados
</title>
<link rel="apple-touch-icon" href="//dlk.com.br/cdn/shop/files/icon.png?v=1&width=180">
<script>var Shopify = Shopify || {};
Shopify.shop = "dlk-fitness-moda.myshopify.com";
Shopify.currency = {"active":"BRL","rate":"1.0"};
Shopify.shopJsCdnBaseUrl = "https://cdn.shopify.com/shopifycloud/shop-js";</script>
<img src="https://cdn.shopify.com/s/files/1/x.jpg">
<!-- one stray VTEX image must not flip the platform -->
<img src="https://otherstore.vtexassets.com/arquivos/z.png">
</head><body></body></html>`

const UNKNOWN = `<html lang="pt-BR"><head><title>Mundo Verde - Loja de produtos naturais</title>
<link type="image/x-icon" rel="shortcut icon" href="https://d5ekw4ckgpula.cloudfront.net/favicon.ico?v=1"></head><body></body></html>`

test("VTEX IO: account from the runtime, culture locale and currency, decoded store name", () => {
    const out = detectStore({ url: "https://www.cea.com.br/", html: VTEX_IO })
    assert.equal(out.platform, "VTEX")
    assert.equal(out.account, "cea")
    assert.equal(out.host, "https://www.cea.com.br")
    assert.equal(out.locale, "pt-BR")
    assert.equal(out.currency, "BRL")
    assert.equal(out.storeName, "C&A")
})

test("icon choice moved to app-icon.mjs: detection no longer lists icon candidates", () => {
    assert.equal("iconCandidates" in detectStore({ url: "https://www.cea.com.br/", html: VTEX_IO }), false)
})

// iconSources over the same real pages: declared icons resolved (relative, protocol-relative, with queries),
// the well-known paths added, an .ico recognized despite its query string.
const kinds = (html, pageUrl) => iconSources({ html, pageUrl }).sources.map((s) => [s.url, s.kind])

test("icon sources (C&A): the declared PNG favicon and apple-touch-icon, then the well-known paths", () => {
    assert.deepEqual(kinds(VTEX_IO, "https://www.cea.com.br/"), [
        ["https://www.cea.com.br/arquivos/cea-2025-favicon-96x96.png", "icon"],
        ["https://cea.vtexassets.com/arquivos/apple-180.png", "apple-touch-icon"],
        ["https://www.cea.com.br/apple-touch-icon.png", "apple-touch-icon"],
        ["https://www.cea.com.br/apple-touch-icon-precomposed.png", "apple-touch-icon"],
        ["https://www.cea.com.br/favicon.ico", "favicon"],
    ])
})

test("icon sources: an .ico on a CDN with a query string is a favicon; protocol-relative Shopify URLs resolve", () => {
    assert.deepEqual(kinds(UNKNOWN, "https://www.mundoverde.com.br/")[0], ["https://d5ekw4ckgpula.cloudfront.net/favicon.ico?v=1", "favicon"])
    assert.deepEqual(kinds(SHOPIFY, "https://dlk.com.br/")[0], ["https://dlk.com.br/cdn/shop/files/icon.png?v=1&width=180", "apple-touch-icon"])
    assert.deepEqual(kinds(WAKE, "https://www.balaroti.com.br/")[0], ["https://balaroti.fbitsstatic.net/sf/img/apple-touch-icon.png", "apple-touch-icon"])
})

test("icon sources: an SVG icon is a candidate (rasterized at 512), a mask-icon is not", () => {
    const html = `<html><head><link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="mask-icon" href="/mask.svg"></head></html>`
    const urls = kinds(html, "https://www.loja.com.br/").map(([url]) => url)
    assert.ok(urls.includes("https://www.loja.com.br/icon.svg"))
    assert.ok(!urls.includes("https://www.loja.com.br/mask.svg"))
})

test("VTEX FastStore: account from the store config, name before the colon, theme color, JSON-LD currency", () => {
    const out = detectStore({ url: "https://www.carrefour.com.br", html: VTEX_FASTSTORE })
    assert.equal(out.platform, "VTEX")
    assert.equal(out.account, "carrefourbr")
    assert.equal(out.storeName, "Carrefour")
    assert.equal(out.themeColor, "#1E5BC6")
    assert.equal(out.currency, "BRL")
})

test("VTEX without a runtime: the most frequent asset host names the account, shared CDN hosts ignored", () => {
    const out = detectStore({ url: "https://www.motorola.com.br/", html: VTEX_ASSETS_ONLY })
    assert.equal(out.platform, "VTEX")
    assert.equal(out.account, "brmotorolanew")
})

test("Wake: account from the store's fbitsstatic host, not the shared components host; og:site_name wins", () => {
    const out = detectStore({ url: "https://www.balaroti.com.br/", html: WAKE })
    assert.equal(out.platform, "WAKE")
    assert.equal(out.account, "balaroti")
    assert.equal(out.storeName, "Balaroti")
})

test("Shopify: shop domain and currency from the Shopify globals, despite a stray VTEX image", () => {
    const out = detectStore({ url: "https://dlk.com.br/", html: SHOPIFY })
    assert.equal(out.platform, "SHOPIFY")
    assert.equal(out.shopDomain, "dlk-fitness-moda.myshopify.com")
    assert.equal(out.account, undefined)
    assert.equal(out.currency, "BRL")
    assert.equal(out.storeName, "DLK")
})

test("an unknown platform is reported as null with no evidence", () => {
    const out = detectStore({ url: "https://www.mundoverde.com.br/", html: UNKNOWN })
    assert.equal(out.platform, null)
    assert.deepEqual(out.evidence, [])
    assert.equal(out.storeName, "Mundo Verde")
})


test("store name: the title segment that names the domain wins over the first one", () => {
    const html = `<html lang="pt-BR"><head><title data-react-helmet="true">Celulares com 128GB, 256GB, 512GB e 1TB | Motorola Oficial</title></head></html>`
    assert.equal(detectStore({ url: "https://www.motorola.com.br/", html }).storeName, "Motorola Oficial")
})

// /api/tenant/tenants?q=<account> answer, trimmed (chegueiembalagens, Nov 2026).
const TENANT = {
    slug: "chegueiembalagens",
    bindings: [{ defaultLocale: "pt-BR", supportedLocales: ["pt-BR"], defaultCurrency: "BRL", supportedCurrencies: ["BRL"] }],
    defaultCurrency: "BRL",
    defaultLocale: "pt-BR",
}

test("VTEX tenant: fills the currency and locale a FastStore or legacy home page does not expose", () => {
    const profile = { platform: "VTEX", account: "chegueiembalagens", locale: undefined, currency: undefined }
    const out = withVtexTenant(profile, TENANT)
    assert.equal(out.currency, "BRL")
    assert.equal(out.locale, "pt-BR")
    assert.equal(vtexTenantUrl("chegueiembalagens"), "https://chegueiembalagens.vtexcommercestable.com.br/api/tenant/tenants?q=chegueiembalagens")
})

test("VTEX tenant: what the page declares wins; a malformed answer changes nothing", () => {
    const profile = { platform: "VTEX", account: "x", locale: "es-AR", currency: "ARS" }
    assert.deepEqual(withVtexTenant(profile, TENANT), profile)
    const bare = { platform: "VTEX", account: "x" }
    assert.deepEqual(withVtexTenant(bare, null), bare)
    assert.deepEqual(withVtexTenant(bare, { defaultCurrency: "reais" }), bare)
    assert.equal(withVtexTenant(bare, { bindings: [{ defaultCurrency: "BRL" }] }).currency, "BRL")
})

test("pages to capture besides the home: the first product link, the platform's cart and login", () => {
    const vtex = detectStore({
        url: "https://compre.seara.com.br/",
        html: VTEX_FASTSTORE.replace(
            "</body>",
            '<a href="/institucional/quem-somos">Quem somos</a><a href="https://other.com/x/p">x</a><a href="/kit-agradecimento-40/p">Kit</a><a href="/kit-ano-novo-46/p?skuId=1">Kit</a></body>',
        ),
    })
    assert.deepEqual(vtex.pages, {
        product: "https://compre.seara.com.br/kit-agradecimento-40/p",
        cart: "https://compre.seara.com.br/checkout/#/cart",
        login: "https://compre.seara.com.br/login",
    })

    const shopify = detectStore({
        url: "https://loja.com/",
        html: '<script>Shopify.shop = "loja.myshopify.com";</script><script src="https://cdn.shopify.com/a.js"></script><script src="https://cdn.shopify.com/b.js"></script><a href="/collections/all">all</a><a href="/products/camisa-azul?variant=1">x</a>',
    })
    assert.deepEqual(shopify.pages, { product: "https://loja.com/products/camisa-azul", cart: "https://loja.com/cart", login: "https://loja.com/account/login" })

    // No product link on the home: the product page is left for the agent to pick from the capture.
    assert.equal(detectStore({ url: "https://compre.seara.com.br/", html: VTEX_FASTSTORE }).pages.product, null)
    assert.equal(detectStore({ url: "https://example.com/", html: "<html><title>x</title></html>" }).pages, null)
})

test("VTEX sales channel: fills currency and locale when the tenant endpoint answers 404 (non-IO accounts)", () => {
    const channel = { Id: 1, CultureInfo: "pt-BR", CurrencyCode: "BRL", CurrencySymbol: "R$" }
    const out = withVtexSalesChannel({ platform: "VTEX", account: "lojafarm", locale: undefined }, channel)
    assert.equal(out.currency, "BRL")
    assert.equal(out.locale, "pt-BR")
    assert.equal(vtexSalesChannelUrl("lojafarm"), "https://lojafarm.vtexcommercestable.com.br/api/catalog_system/pub/saleschannel/default")
    // The page's own values win; a malformed answer changes nothing.
    const declared = { platform: "VTEX", currency: "ARS", locale: "es-AR" }
    assert.deepEqual(withVtexSalesChannel(declared, channel), declared)
    assert.deepEqual(withVtexSalesChannel({ platform: "VTEX" }, { CurrencyCode: "reais" }), { platform: "VTEX" })
    assert.deepEqual(withVtexSalesChannel({ platform: "VTEX" }, null), { platform: "VTEX" })
})

test("VTEX product page: a home without product links takes one in stock from the public catalog search", () => {
    const offer = (qty) => ({ sellers: [{ commertialOffer: { AvailableQuantity: qty } }] })
    const products = [
        { linkText: "presilha-sem-estoque-1", items: [offer(0)] },
        { linkText: "vestido-midi-estampado-372285-59587", items: [offer(0), offer(3)] },
    ]
    const profile = {
        platform: "VTEX",
        host: "https://www.farmrio.com.br",
        pages: { product: null, cart: "https://www.farmrio.com.br/checkout/#/cart", login: "https://www.farmrio.com.br/login" },
    }
    const out = withVtexProduct(profile, products)
    assert.equal(out.pages.product, "https://www.farmrio.com.br/vestido-midi-estampado-372285-59587/p")
    assert.equal(out.pages.cart, profile.pages.cart)
    assert.equal(profile.pages.product, null, "the input is not mutated")
    assert.equal(vtexProductSearchUrl("lojafarm"), "https://lojafarm.vtexcommercestable.com.br/api/catalog_system/pub/products/search?_from=0&_to=9&O=OrderByTopSaleDESC")
    // Nothing in stock: the first product still beats no product page.
    assert.equal(withVtexProduct(profile, [products[0]]).pages.product, "https://www.farmrio.com.br/presilha-sem-estoque-1/p")
    // A product link found on the home wins; a malformed answer changes nothing.
    const found = { ...profile, pages: { ...profile.pages, product: "https://www.farmrio.com.br/x/p" } }
    assert.deepEqual(withVtexProduct(found, products), found)
    assert.deepEqual(withVtexProduct(profile, { error: "x" }), profile)
    assert.deepEqual(withVtexProduct(profile, [{ items: [] }]), profile)
})

test("VTEX asset hosts URL-encoded in an image proxy (https%3A%2F%2Flojaq.vtexassets.com) count for the account, not as '2flojaq'", () => {
    const html = `<html><head><title>Loja Q</title></head><body>
<img src="https://img.cdn.example/rs:fit/https%3A%2F%2Flojaq.vtexassets.com/a.png"><img src="https://img.cdn.example/https%3a%2f%2flojaq.vtexassets.com/b.png"><img src="https://lojaq.vtexassets.com/c.png"></body></html>`
    const profile = detectStore({ url: "https://www.lojaq.com.br/", html })
    assert.equal(profile.account, "lojaq")
    assert.deepEqual(profile.evidence, ["lojaq VTEX asset host ×3"])
})
