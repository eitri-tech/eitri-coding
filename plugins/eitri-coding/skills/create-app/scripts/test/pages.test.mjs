import { test } from "node:test"
import assert from "node:assert/strict"
import { listingCandidates, productLinks, pickProduct, vtexVariants, shopifyVariants, hasListingControls, vtexListingTarget, vtexPagetypeUrl, vtexFullTextUrl, catalogSlug, vtexLegacySearch, vtexCartAddUrl } from "../lib/pages.mjs"

const HOME = `<html><body>
<a href="/">logo</a><a href="/login">entrar</a><a href="/checkout/#/cart">sacola</a>
<a href="/institucional/sobre">sobre</a><a href="https://instagram.com/loja">ig</a>
<a href="/novidades">Novidades</a>
<a href="/produtos/vestido?utm=menu">Vestidos</a><a href="/produtos/vestido">Vestidos</a><a href="/produtos/vestido#top">Vestidos</a>
<a href="/novidades">Novidades</a>
<a href="/vestido-azul-12/p">um produto</a>
<a href="/arquivos/regulamento.pdf">regulamento</a>
<a href="/bazar">Bazar</a>
</body></html>`

test("listing candidates: the home's own navigation, most repeated first, then document order; never product, account or file links", () => {
    assert.deepEqual(listingCandidates("VTEX", "https://www.loja.com.br/", HOME), ["/produtos/vestido", "/novidades", "/bazar"])
    assert.deepEqual(listingCandidates("VTEX", "https://www.loja.com.br/", HOME, { max: 1 }), ["/produtos/vestido"])
    assert.deepEqual(listingCandidates(null, "https://www.loja.com.br/", HOME), [])
})

test("listing candidates: search links are skipped, their meaning is the query a candidate drops", () => {
    const home = `<a href="/busca?fq=H:22427">a</a><a href="/busca/?fq=H:24963&utmi_p=_">b</a><a href="/busca?fq=H:1">c</a><a href="/pesquisa?q=naldecon">d</a><a href="/search?q=x">e</a><a href="/medicamentos">Medicamentos</a>`
    assert.deepEqual(listingCandidates("VTEX", "https://www.drogariaspacheco.com.br/", home), ["/medicamentos"])
})

test("product links: the distinct product pages a page lists, in order, on the store's origin", () => {
    const html = `<a href="/b-2/p?brand=farm">b</a><a href="/a-1/p">a</a><a href="/b-2/p">b again</a><a href="https://other.com/c-3/p">x</a><a href="/produtos/vestido">listing</a>`
    assert.deepEqual(productLinks("VTEX", "https://www.loja.com.br/produtos/vestido", html), ["https://www.loja.com.br/b-2/p", "https://www.loja.com.br/a-1/p"])
    const shopify = `<a href="/collections/all/products/camisa?variant=1">c</a><a href="/products/saia">s</a>`
    assert.deepEqual(productLinks("SHOPIFY", "https://loja.com/collections/all", shopify), ["https://loja.com/products/saia"])
})

test("pick product: the most variants in stock, first on ties; out of stock only when nothing is in stock", () => {
    const pick = (list) => pickProduct(list)?.url
    assert.equal(pick([{ url: "a", variants: 1, inStock: 1 }, { url: "b", variants: 5, inStock: 4 }, { url: "c", variants: 6, inStock: 4 }]), "b")
    assert.equal(pick([{ url: "a", variants: 3, inStock: 0 }, { url: "b", variants: 5, inStock: 0 }]), "b")
    assert.equal(pick([{ url: "a", variants: 0, inStock: 0 }, { url: "b", variants: 2, inStock: 1 }]), "b")
    assert.equal(pick([]), undefined)
})

test("variant counts from the platforms' public product answers; malformed answers count nothing", () => {
    const offer = (qty) => ({ sellers: [{ commertialOffer: { AvailableQuantity: qty } }] })
    assert.deepEqual(vtexVariants([{ items: [offer(0), offer(2), offer(9)] }]), { variants: 3, inStock: 2 })
    assert.deepEqual(vtexVariants({ error: 1 }), { variants: 0, inStock: 0 })
    assert.deepEqual(shopifyVariants({ variants: [{ available: true }, { available: false }] }), { variants: 2, inStock: 1 })
    assert.deepEqual(shopifyVariants(null), { variants: 0, inStock: 0 })
})

test("hasListingControls: a product listing page has a sort or filter control; a landing page with shelves has none", () => {
    assert.equal(hasListingControls(`<button><span>Relevância</span></button><button>Filtrar</button>`), true)
    assert.equal(hasListingControls(`<label>Ordenar por</label><select><option>Mais vendidos</option></select>`), true)
    assert.equal(hasListingControls(`<button>Sort by</button>`), true)
    assert.equal(hasListingControls(`<button aria-label="x">Filters (2)</button>`), true)
    assert.equal(hasListingControls(`<h2>Modern architecture.</h2><a href="/a-1/p">A</a>`), false)
    assert.equal(hasListingControls(`<style>.a>.b{filter:blur(2px)}.c>.d{backdrop-filter:none}</style><div class="filter-x"></div>`), false, "CSS and class names are not controls")
})

test("vtexListingTarget: the brand or category name titles the listing, not the page's SEO title", () => {
    // drogariaspacheco.com.br/dove (Nov 2026): the SEO title would head the app's listing as "Dove em Promoção - Drogarias Pacheco".
    const dove = { id: "1176", name: "Dove", url: "drogariaspacheco.vtexcommercestable.com.br/Dove", title: "Dove em Promoção - Drogarias Pacheco", pageType: "Brand" }
    assert.equal(vtexListingTarget(dove).title, "Dove")
    const department = { id: "800", name: "Medicamentos", url: "loja.vtexcommercestable.com.br/Medicamentos", title: "Medicamentos | Drogarias Pacheco", pageType: "Department" }
    assert.equal(vtexListingTarget(department).title, "Medicamentos")
})

test("vtexListingTarget: VTEX's pagetype answer as what a listing lists (collection, category path, brand, full text)", () => {
    assert.equal(vtexPagetypeUrl("loja", "https://www.loja.com.br/ellipse"), "https://loja.vtexcommercestable.com.br/api/catalog_system/pub/portal/pagetype/ellipse")
    assert.deepEqual(vtexListingTarget({ id: "577", name: "Ellipse", url: "loja.vtexcommercestable.com.br/577?map=productClusterIds", pageType: "Collection" }), { type: "collection", value: "577", title: "Ellipse" })
    assert.deepEqual(vtexListingTarget({ id: "494", name: "Tênis", url: "loja.vtexcommercestable.com.br/Calcado/Tênis", title: "Tênis", pageType: "Category" }), {
        type: "facets",
        facets: [{ key: "category-1", value: "calcado" }, { key: "category-2", value: "tenis" }],
        title: "Tênis",
    })
    assert.deepEqual(vtexListingTarget({ id: "9", name: "New Balance", url: "loja.vtexcommercestable.com.br/New-Balance", pageType: "Brand" }), { type: "facets", facets: [{ key: "brand", value: "new-balance" }], title: "New Balance" })
    // FullText is VTEX's answer for any path it does not know: a search only when that search finds products (hits).
    assert.deepEqual(vtexListingTarget({ id: null, name: "9060", url: "loja.vtexcommercestable.com.br/9060", pageType: "FullText", hits: 27 }), { type: "search", value: "9060", title: "9060" })
    assert.equal(vtexListingTarget({ id: null, name: "lancamento-983", url: "loja.vtexcommercestable.com.br/lancamento-983", pageType: "FullText", hits: 0 }), null)
    assert.equal(vtexListingTarget({ id: null, name: "9060", pageType: "FullText" }), null, "unchecked: unknown")
    assert.equal(vtexFullTextUrl("loja", "9060"), "https://loja.vtexcommercestable.com.br/api/catalog_system/pub/products/search?ft=9060&_from=0&_to=0")
    assert.equal(vtexListingTarget({ pageType: "NotFound" }), null)
    assert.equal(vtexListingTarget(null), null)
})

test("catalogSlug spells a name as VTEX catalog paths do", () => {
    assert.equal(catalogSlug("Família 574"), "familia-574")
    assert.equal(catalogSlug("  Coleção Verão/2026 "), "colecao-verao-2026")
})

test("VTEX legacy search: a department searched by facet counts the whole catalog, by query/map only its own", () => {
    // drogariaspacheco.com.br, Nov 2026: vtex.search-graphql on the catalog resolver.
    assert.equal(vtexLegacySearch({ department: "medicamentos", all: 94816, byFacet: 94816, byQueryMap: 11630 }), true)
    // Intelligent Search behind it: the facet narrows the list.
    assert.equal(vtexLegacySearch({ department: "maquiagem", all: 5000, byFacet: 800, byQueryMap: 800 }), false)
    // A probe that could not count says nothing.
    assert.equal(vtexLegacySearch({ all: 94816, byFacet: null, byQueryMap: 11630 }), null)
    assert.equal(vtexLegacySearch({ all: 0, byFacet: 0, byQueryMap: 0 }), null)
    assert.equal(vtexLegacySearch(null), null)
})

test("VTEX cart: the first SKU in stock and its seller, and the store URL that adds it to a fresh cart", () => {
    const answer = [{ items: [
        { itemId: "11", sellers: [{ sellerId: "1", commertialOffer: { AvailableQuantity: 0 } }] },
        { itemId: "768170", sellers: [{ sellerId: "1", commertialOffer: { AvailableQuantity: 9 } }] },
    ] }]
    assert.deepEqual(vtexVariants(answer), { variants: 2, inStock: 1, skuId: "768170", sellerId: "1" })
    assert.equal(vtexCartAddUrl("https://www.loja.com.br", { skuId: "768170", sellerId: "1" }), "https://www.loja.com.br/checkout/cart/add?sku=768170&qty=1&seller=1&sc=1&redirect=true")
    assert.equal(vtexCartAddUrl("https://www.loja.com.br", {}), null)
})

