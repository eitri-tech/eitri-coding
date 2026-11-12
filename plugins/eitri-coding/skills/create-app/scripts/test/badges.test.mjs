import { test } from "node:test"
import assert from "node:assert/strict"
import { textStyle, buildBadgeConfig } from "../lib/badges.mjs"

// Trimmed from oceane.com.br's rendered shelf card and its captured CSS (Nov 2026).
const HTML = `<section><div class="flex">
<div class="container-tag-product" style="background-color: rgb(0, 0, 0);"><p class="container-tag-product--text" style="color: rgb(255, 102, 200);">PREÇO DE BLACK</p></div>
<div class="selos-blocks vtex-product-summary--selos-blocks"><p class="cruelty-free">Cruelty Free</p><p class="vegano">Vegano</p></div>
<span class="vtex-product-highlights-2-x-productHighlightText">Océane Week</span>
</div></section>`
const CSS = `.selos-blocks { display: flex; }
.cruelty-free { display: none; z-index: 4; background-color: rgb(182, 196, 140); color: rgb(56, 57, 53); }
.selos-blocks .vegano { z-index: 4; background-color: rgb(182, 196, 140); color: rgb(56, 57, 53); }
.vtex-product-highlights-2-x-productHighlightText { background-color: #E0C2C2; color: #383935; }`

test("textStyle: inline colors of the element and its wrapper, else the CSS rules of its classes", () => {
    assert.deepEqual(textStyle("PREÇO DE BLACK", { html: HTML, css: CSS }), { bgColor: "#000000", textColor: "#ff66c8" })
    assert.deepEqual(textStyle("Vegano", { html: HTML, css: CSS }), { bgColor: "#b6c48c", textColor: "#383935" })
    assert.deepEqual(textStyle("Cruelty Free", { html: HTML, css: CSS }), { bgColor: "#b6c48c", textColor: "#383935", hidden: true })
    assert.deepEqual(textStyle("Océane Week", { html: HTML, css: CSS }), { bgColor: "#e0c2c2", textColor: "#383935" })
    assert.equal(textStyle("Not on the page", { html: HTML, css: CSS }), null)
})

// What the analyzer gathers: the card's features (block tree) and the catalog of the captured products.
const SUMMARY = {
    features: [
        { feature: "highlights", supported: true },
        { feature: "specificationBadges", supported: true, groups: ["Selos"], names: ["Vegano"] },
    ],
    customComponents: ["store-theme@1/ProductTag", "store-theme@1/Selos"],
    highlights: { show: ["Océane Week"], hide: ["Tag + barato no APP", "Tag PREÇO DE BLACK"] },
}
const CATALOG = [
    { productId: "40951", clusterHighlights: { 1733: "Tag PREÇO DE BLACK" }, specifications: { Selos: ["Vegano", "Cruelty Free"] } },
    { productId: "61750", clusterHighlights: { 1546: "Tag + barato no APP" }, specifications: { Selos: ["Cruelty Free", "Vegano"] } },
]

test("buildBadgeConfig: highlights the store draws (prefix stripped), visible spec values, each with the store's colors", () => {
    const { config, unresolved } = buildBadgeConfig({ summary: SUMMARY, catalog: CATALOG, html: HTML, css: CSS })
    assert.deepEqual(config.highlights.allow, ["Océane Week", "Tag + barato no APP", "Tag PREÇO DE BLACK"])
    assert.deepEqual(config.highlights.stripPrefixes, ["Tag "])
    assert.deepEqual(config.highlights.styles, {
        "PREÇO DE BLACK": { bgColor: "#000000", textColor: "#ff66c8" },
        "Océane Week": { bgColor: "#e0c2c2", textColor: "#383935" },
    })
    assert.deepEqual(config.specifications, { names: ["Selos"], values: { Vegano: { bgColor: "#b6c48c", textColor: "#383935" } } })
    assert.equal(config.teasers, true)
    // "+ barato no APP" is on no captured card: the app shows it, but its colors are unknown.
    assert.deepEqual(unresolved, [{ badge: "+ barato no APP", why: "no captured card shows it: the app draws it in the theme's primary colors" }])
})

test("a highlight seen on a captured page is allowed even when no filter names it", () => {
    const html = `${HTML}<div class="flag" style="background-color: rgb(56, 57, 53);"><p style="color: rgb(255, 255, 255);">Lançamento</p></div>`
    const catalog = [...CATALOG, { productId: "1", clusterHighlights: { 276: "Lançamento" }, specifications: {} }]
    const { config } = buildBadgeConfig({ summary: SUMMARY, catalog, html, css: CSS })
    assert.ok(config.highlights.allow.includes("Lançamento"))
    assert.deepEqual(config.highlights.styles["Lançamento"], { bgColor: "#383935", textColor: "#ffffff" })
})

test("buildBadgeConfig without a highlights filter shows every highlight, and nothing breaks without specs", () => {
    const { config } = buildBadgeConfig({ summary: { features: [{ feature: "highlights", supported: true }], customComponents: [] }, catalog: [], html: "", css: "" })
    assert.deepEqual(config, { highlights: {}, teasers: true })
})
