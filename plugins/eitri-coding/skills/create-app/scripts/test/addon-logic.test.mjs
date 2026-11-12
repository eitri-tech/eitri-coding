import { test } from "node:test"
import assert from "node:assert/strict"
import { badgesFor } from "../../addons/vtex/files/shared/src/services/badgesFromCatalog.js"
import { ratingsRequest, parseRatings } from "../../addons/vtex/files/shared/src/services/reviewsProviders.js"

// appConfigs.badges as analyze-store.mjs builds it for oceane.com.br.
const CONFIG = {
    highlights: {
        allow: ["Océane Week", "Tag + barato no APP", "Tag PREÇO DE BLACK"],
        stripPrefixes: ["Tag "],
        styles: { "PREÇO DE BLACK": { bgColor: "#000000", textColor: "#ff66c8" } },
    },
    specifications: { names: ["Selos"], values: { Vegano: { bgColor: "#b6c48c", textColor: "#383935" } } },
    collections: { 99: { text: "Exclusivo app", bgColor: "#7b2cbf", textColor: "#ffffff" } },
    teasers: true,
}

// The two product shapes the app meets: Intelligent Search (arrays) and the catalog API (objects).
const SEARCH_PRODUCT = {
    clusterHighlights: [
        { id: "1733", name: "Tag PREÇO DE BLACK" },
        { id: "500", name: "Liquida antiga" },
    ],
    productClusters: [{ id: "99", name: "App only" }],
    specificationGroups: [{ name: "Selos", specifications: [{ name: "Selos", values: ["Cruelty Free", "Vegano"] }] }],
}
const CATALOG_PRODUCT = { clusterHighlights: { 1546: "Tag + barato no APP" }, productClusters: { 1: "Todos" }, Selos: ["Vegano"] }

test("badgesFor: highlights the store shows, prefix stripped and styled; visible spec values; mapped collections", () => {
    assert.deepEqual(badgesFor(SEARCH_PRODUCT, CONFIG), [
        { textBadge: { text: "PREÇO DE BLACK", bgColor: "#000000", textColor: "#ff66c8" } },
        { textBadge: { text: "Exclusivo app", bgColor: "#7b2cbf", textColor: "#ffffff" } },
        { textBadge: { text: "Vegano", bgColor: "#b6c48c", textColor: "#383935" } },
    ])
})

test("badgesFor reads the catalog API shape too; a highlight without a style uses the theme colors", () => {
    assert.deepEqual(badgesFor(CATALOG_PRODUCT, CONFIG), [
        { textBadge: { text: "+ barato no APP" } },
        { textBadge: { text: "Vegano", bgColor: "#b6c48c", textColor: "#383935" } },
    ])
})

test("badgesFor without config shows nothing new, and tolerates null fields", () => {
    assert.deepEqual(badgesFor(SEARCH_PRODUCT, undefined), [])
    assert.deepEqual(badgesFor({ clusterHighlights: null, specificationGroups: null }, CONFIG), [])
    assert.deepEqual(badgesFor(null, CONFIG), [])
    assert.deepEqual(badgesFor(SEARCH_PRODUCT, { highlights: {} }).map((b) => b.textBadge.text), ["Tag PREÇO DE BLACK", "Liquida antiga"], "no allow list: every highlight")
})

test("Skeepers ratings: one batched request, parsed per product id", () => {
    assert.equal(
        ratingsRequest({ provider: "skeepers", websiteId: "969384d1-eb8a-64e4-a1f2-c46b29a4d241" }, ["61750", "40951"]),
        "https://api-product-reviews.cxr.skeepers.io/v1/websites/969384d1-eb8a-64e4-a1f2-c46b29a4d241/products/ratings?ref=61750,40951",
    )
    const body = { data: { 61750: { average: 4.857723577235772, nb_total: 246, nb_5: 218 }, 40951: { average: 0, nb_total: 0 } } }
    assert.deepEqual(parseRatings({ provider: "skeepers" }, body), { 61750: { average: 4.86, count: 246 } })
    assert.deepEqual(parseRatings({ provider: "skeepers" }, null), {})
})

test("an unknown or unconfigured provider asks for nothing", () => {
    assert.equal(ratingsRequest({ provider: "yotpo" }, ["1"]), null)
    assert.equal(ratingsRequest({ provider: "skeepers" }, ["1"]), null, "no website id")
    assert.equal(ratingsRequest(undefined, ["1"]), null)
    assert.equal(ratingsRequest({ provider: "skeepers", websiteId: "x" }, []), null)
})
