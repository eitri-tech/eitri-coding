import { test } from "node:test"
import assert from "node:assert/strict"
import { listingCandidates, productLinks, pickProduct, vtexVariants, hasListingControls, vtexCartAddUrl } from "../lib/pages.mjs"

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

test("hasListingControls: a product listing page has a sort or filter control; a landing page with shelves has none", () => {
    assert.equal(hasListingControls(`<button><span>Relevância</span></button><button>Filtrar</button>`), true)
    assert.equal(hasListingControls(`<label>Ordenar por</label><select><option>Mais vendidos</option></select>`), true)
    assert.equal(hasListingControls(`<button>Sort by</button>`), true)
    assert.equal(hasListingControls(`<button aria-label="x">Filters (2)</button>`), true)
    assert.equal(hasListingControls(`<h2>Modern architecture.</h2><a href="/a-1/p">A</a>`), false)
    assert.equal(hasListingControls(`<style>.a>.b{filter:blur(2px)}.c>.d{backdrop-filter:none}</style><div class="filter-x"></div>`), false, "CSS and class names are not controls")
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

