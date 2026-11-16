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

// Legacy VTEX search (drogariaspacheco.com.br, Nov 2026): vtex.search-graphql runs the catalog resolver, which ignores
// selectedFacets (the whole catalog comes back) and answers facets only for a query/map pair.
import { toLegacyOptions, legacyFacetGroups } from "../../addons/vtex/files/home/src/services/legacySearch.js"

test("toLegacyOptions: the app's facets as the legacy query/map pair, other options kept", () => {
    const options = { fullText: "", selectedFacets: [{ key: "productClusterIds", value: "24942" }], orderBy: "OrderByTopSaleDESC", from: 1, to: 12, hideUnavailableItems: true }
    assert.deepEqual(toLegacyOptions(options), { orderBy: "OrderByTopSaleDESC", from: 1, to: 12, hideUnavailableItems: true, query: "24942", map: "productClusterIds" })
    // Category levels are "c", the brand "b"; a legacy key from the filter (b, c, specificationFilter_N) is kept; the term goes last.
    assert.deepEqual(
        toLegacyOptions({ fullText: " dipirona ", selectedFacets: [{ key: "category-1", value: "medicamentos" }, { key: "brand", value: "ems" }, { key: "specificationFilter_115", value: "Desconto%20de%20Laborat%C3%B3rio" }, { key: "b", value: "EMS" }] }),
        { query: "medicamentos/ems/Desconto%20de%20Laborat%C3%B3rio/EMS/dipirona", map: "c,b,specificationFilter_115,b,ft" },
    )
    // A price range has no legacy facet here; malformed facets are skipped; nothing to move → null (the call goes as it was).
    assert.equal(toLegacyOptions({ fullText: "", selectedFacets: [{ key: "price", value: "10:20" }, null, { key: "brand", value: null }] }), null)
    assert.equal(toLegacyOptions({ fullText: "", selectedFacets: null }), null)
    // A search without facets still needs the pair for facets(): it answers nothing without one.
    assert.deepEqual(toLegacyOptions({ fullText: "dipirona", selectedFacets: [] }), { query: "dipirona", map: "ft" })
})

test("legacyFacetGroups: the legacy lists as the filter's facet groups, keys the legacy map names", () => {
    const answer = {
        brands: [{ name: "EMS", quantity: 1006, value: "EMS", map: "b" }, null],
        categoriesTrees: [{ name: "Medicamentos", quantity: 11630, value: "Medicamentos", map: "c", children: [{ name: "Genéricos", quantity: 3000, value: "Genéricos", map: "c" }] }],
        specificationFilters: [{ name: "Descontos e Promoções", facets: [{ name: "Desconto de Laboratório", quantity: 613, value: "Desconto%20de%20Laborat%C3%B3rio", map: "specificationFilter_115" }] }, { name: "Vazio", facets: [] }],
    }
    const groups = legacyFacetGroups(answer)
    assert.deepEqual(groups.map((g) => [g.name, g.type, g.values.map((v) => `${v.key}=${v.value} (${v.quantity})`)]), [
        // One department: its subcategories, not itself.
        ["Categoria", "CATEGORYTREE", ["c=Genéricos (3000)"]],
        ["Marca", "BRAND", ["b=EMS (1006)"]],
        ["Descontos e Promoções", "TEXT", ["specificationFilter_115=Desconto%20de%20Laborat%C3%B3rio (613)"]],
    ])
    assert.ok(groups.every((g) => g.hidden === false && g.values.every((v) => v.selected === false && v.name)))
    assert.deepEqual(legacyFacetGroups(null), [])
    assert.deepEqual(legacyFacetGroups({ brands: "x", categoriesTrees: null }), [])
})

test("Countdown targetOf: untilTime is today's time in the store's offset, tomorrow's once passed; targetDate as given", async () => {
    const { readFileSync } = await import("node:fs")
    const source = readFileSync(new URL("../../addons/vtex/files/home/src/components/CmsComponents/Countdown/Countdown.jsx", import.meta.url), "utf8")
    const body = source.slice(source.indexOf("export function targetOf"), source.indexOf("export default function Countdown"))
    const targetOf = new Function(`${body.replace("export function", "function")}; return targetOf`)()
    const at = (iso) => new Date(iso).getTime()
    // 17:00 in São Paulo (20:00 UTC): today's 23:59:00 -03:00.
    assert.equal(targetOf({ untilTime: "23:59:00", utcOffset: "-03:00" }, at("2026-11-12T20:00:00Z")), at("2026-11-12T23:59:00-03:00"))
    // 00:30 the next day there: the next 23:59.
    assert.equal(targetOf({ untilTime: "23:59:00", utcOffset: "-03:00" }, at("2026-11-13T03:30:00Z")), at("2026-11-13T23:59:00-03:00"))
    assert.equal(targetOf({ targetDate: "2026-11-12T23:59:00-03:00" }, 0), at("2026-11-12T23:59:00-03:00"))
    assert.ok(Number.isNaN(targetOf({}, 0)))
})

