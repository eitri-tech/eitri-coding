import { test } from "node:test"
import assert from "node:assert/strict"
import { parseVtexBlocks, vtexPageSections, vtexProductSummary, cmsSectionsFromVtex } from "../lib/vtexBlocks.mjs"

// The shape VTEX IO server-renders into every page: one entry per block, keyed by its
// tree path, children listed in `blocks` in render order. Slashes come escaped (\u002F).
function entry(path, { component = "vtex.flex-layout@0.21.6/FlexLayout", blocks = [], props = {}, content = {} } = {}) {
    const body = {
        before: [],
        around: [],
        after: [],
        blockId: `store-theme@1.x:${path.split("/").pop()}`,
        blocks: blocks.map((id) => ({ blockId: `store-theme@1.x:${id}`, extensionPointId: id, children: true, blockRole: "children" })),
        component,
        props,
        content,
        render: "server",
    }
    return `"${path.replaceAll("/", "\\u002F")}":${JSON.stringify(body).replaceAll("/", "\\u002F")}`
}

const H = "store.home"
const ENTRIES = [
    entry(H, {
        component: "vtex.render-runtime@8.136.3/LayoutContainer",
        blocks: ["list-context.image-list#hero", "__fold__", "toggle-layout#countdown", "tab-layout#shelf", "flex-layout.row#col1", "flex-layout.row#shelf1", "flex-layout.row#video", "responsive-layout.desktop#only-desktop", "flex-layout.row#text", "flex-layout.row#newsletter", "custom-thing#x", "back-to-top-button"],
    }),
    entry(`${H}/list-context.image-list#hero`, {
        component: "vtex.store-image@0.24.0/ImageList",
        blocks: ["slider-layout#hero"],
        content: {
            images: [
                { image: "https://cdn.x/desk1.jpg", mobileImage: "https://cdn.x/mob1.gif", link: { url: "/promo" }, description: "Black" },
                { image: "https://cdn.x/desk2.jpg", link: { url: "https://www.loja.com/sale" } },
            ],
        },
    }),
    entry(`${H}/list-context.image-list#hero/slider-layout#hero`, { component: "vtex.slider-layout@0.24.4/SliderLayout" }),
    entry(`${H}/toggle-layout#countdown`, { component: "vtex.toggle-layout@0.0.3/index", props: { renderChildren: false }, content: { renderChildren: true }, blocks: ["flex-layout.col#cd"] }),
    entry(`${H}/toggle-layout#countdown/flex-layout.col#cd`, { component: "vtex.flex-layout@0.21.6/FlexCol", blocks: ["image#cd", "rich-text#cd", "count-down"] }),
    entry(`${H}/toggle-layout#countdown/flex-layout.col#cd/image#cd`, { component: "vtex.store-components@3.179.1/Image", content: { src: "https://cdn.x/11-11.webp", link: { url: "/promocao-progressiva" } } }),
    entry(`${H}/toggle-layout#countdown/flex-layout.col#cd/rich-text#cd`, { component: "vtex.rich-text@0.16.1/index", content: { text: "## FALTAM" } }),
    entry(`${H}/toggle-layout#countdown/flex-layout.col#cd/count-down`, {
        component: "store-theme@1.0.0/CountDown",
        content: { targetDate: { typeCounter: "hh:mm:ss", displayDay: true, hour: 10, minute: 0, second: 0, textColor: "#030303", year: 2026, month: 11, day: 13 } },
    }),
    entry(`${H}/tab-layout#shelf`, { component: "vtex.tab-layout@0.4.6/TabLayout", blocks: ["rich-text#tabs-title", "tab-list#shelf", "tab-content#shelf"] }),
    entry(`${H}/tab-layout#shelf/rich-text#tabs-title`, { component: "vtex.rich-text@0.16.1/index", content: { text: "## Produtos Queridinhos\n\nOs produtos para a sua beleza" } }),
    entry(`${H}/tab-layout#shelf/tab-list#shelf`, { component: "vtex.tab-layout@0.4.6/TabList", blocks: ["tab-list.item#a", "tab-list.item#b"] }),
    entry(`${H}/tab-layout#shelf/tab-list#shelf/tab-list.item#a`, { component: "vtex.tab-layout@0.4.6/TabListItem", content: { tabId: "a", label: "Mais vendidos" } }),
    entry(`${H}/tab-layout#shelf/tab-list#shelf/tab-list.item#b`, { component: "vtex.tab-layout@0.4.6/TabListItem", content: { tabId: "b", label: "Lançamentos" } }),
    entry(`${H}/tab-layout#shelf/tab-content#shelf`, { component: "vtex.tab-layout@0.4.6/TabContent", blocks: ["tab-content.item#a", "tab-content.item#b"] }),
    entry(`${H}/tab-layout#shelf/tab-content#shelf/tab-content.item#a`, { component: "vtex.tab-layout@0.4.6/TabContentItem", content: { tabId: "a" }, blocks: ["list-context.product-list#a"] }),
    entry(`${H}/tab-layout#shelf/tab-content#shelf/tab-content.item#a/list-context.product-list#a`, { component: "vtex.product-summary@2.x/ProductList", content: { collection: "1415", orderBy: "OrderByTopSaleDESC", maxItems: 12 } }),
    entry(`${H}/tab-layout#shelf/tab-content#shelf/tab-content.item#b`, { component: "vtex.tab-layout@0.4.6/TabContentItem", content: { tabId: "b" }, blocks: ["list-context.product-list#b"] }),
    entry(`${H}/tab-layout#shelf/tab-content#shelf/tab-content.item#b/list-context.product-list#b`, { component: "vtex.product-summary@2.x/ProductList", content: { collection: "1003", orderBy: "OrderByReleaseDateDESC" } }),
    entry(`${H}/flex-layout.row#col1`, { blocks: ["rich-text#title-col1", "rich-text#subtitle-col1", "list-context.image-list#col1"] }),
    entry(`${H}/flex-layout.row#col1/rich-text#title-col1`, { component: "vtex.rich-text@0.16.1/index", content: { text: "## **hidratar e iluminar ✨**" } }),
    entry(`${H}/flex-layout.row#col1/rich-text#subtitle-col1`, { component: "vtex.rich-text@0.16.1/index", content: { text: "Cremes para a área dos olhos" } }),
    entry(`${H}/flex-layout.row#col1/list-context.image-list#col1`, { component: "vtex.store-image@0.24.0/ImageList", content: { images: [{ image: "https://cdn.x/col1.webp", link: { url: "/mais-descontos" } }] } }),
    entry(`${H}/flex-layout.row#shelf1`, { blocks: ["rich-text#t1", "list-context.product-list#s1"] }),
    entry(`${H}/flex-layout.row#shelf1/rich-text#t1`, { component: "vtex.rich-text@0.16.1/index", content: { text: "##  Protetor Solar Océane" } }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1`, {
        component: "vtex.product-summary@2.92.1/ProductSummaryList",
        props: { orderBy: "OrderByTopSaleDESC" },
        content: { collection: "1765", orderBy: "OrderByPriceASC", maxItems: 12 },
        blocks: ["product-summary"],
    }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary`, {
        component: "vtex.product-summary@2.92.1/ProductSummaryCustom",
        blocks: ["product-specification-badges#shelf", "tags-product", "product-price-savings#shelf", "similar-quantity", "verify-opinion-stars-summary", "add-to-list-btn", "product-summary-name"],
    }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/product-specification-badges#shelf`, {
        component: "vtex.product-specification-badges@0.4.1/index",
        props: { specificationGroupName: "Selos", specificationsOptions: [{ specificationName: "Vegano", displayValue: "SPECIFICATION_VALUE" }] },
    }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/tags-product`, { component: "store-theme@1.0.0/ProductTag" }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/product-price-savings#shelf`, { component: "vtex.product-price@1.x/Savings" }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/similar-quantity`, { component: "store-theme@1.0.0/SimilarQuantity" }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/verify-opinion-stars-summary`, { component: "store-theme@1.0.0/VerifyOpinionStarsSummary" }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/add-to-list-btn`, { component: "vtex.wish-list@1.x/AddProductBtn" }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/product-summary-name`, { component: "vtex.product-summary@2.x/ProductSummaryName" }),
    entry(`${H}/flex-layout.row#video`, { blocks: ["video#v"] }),
    entry(`${H}/flex-layout.row#video/video#v`, { component: "vtex.store-video@1.4.3/Video", content: { src: "https://www.youtube.com/watch?v=DWDFxAbxAqg" } }),
    entry(`${H}/responsive-layout.desktop#only-desktop`, { component: "vtex.responsive-layout@0.1.0/DesktopLayout", blocks: ["rich-text#desk"] }),
    entry(`${H}/responsive-layout.desktop#only-desktop/rich-text#desk`, { component: "vtex.rich-text@0.16.1/index", content: { text: "desktop only" } }),
    entry(`${H}/flex-layout.row#text`, { blocks: ["rich-text#about"] }),
    entry(`${H}/flex-layout.row#text/rich-text#about`, { component: "vtex.rich-text@0.16.1/index", content: { text: "O melhor lugar para **beleza**." } }),
    entry(`${H}/flex-layout.row#newsletter`, { blocks: ["newsletter-form"] }),
    entry(`${H}/flex-layout.row#newsletter/newsletter-form`, { component: "vtex.store-newsletter@1.x/NewsletterForm" }),
    entry(`${H}/custom-thing#x`, { component: "store-theme@1.0.0/Influencers" }),
    entry(`${H}/back-to-top-button`, { component: "vtex.store-components@3.179.1/BackToTopButton" }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/product-highlights#show`, {
        component: "vtex.product-highlights@2.3.2/ProductHighlights",
        props: { filter: { type: "show", highlightNames: ["Océane Week"] } },
    }),
    entry(`${H}/flex-layout.row#shelf1/list-context.product-list#s1/product-summary/product-highlights#hide`, {
        component: "vtex.product-highlights@2.3.2/ProductHighlights",
        props: { type: "collection", filter: { type: "hide", highlightNames: ["Tag + barato no APP", "Tag PREÇO DE BLACK"] } },
    }),
]
const HTML = `<html><body><script>window.__RUNTIME__={"extensions":{${ENTRIES.join(",")}}}</script></body></html>`

test("parseVtexBlocks reads every server-rendered block with its merged props and content", () => {
    const blocks = parseVtexBlocks(HTML)
    const shelf = blocks.get(`${H}/flex-layout.row#shelf1/list-context.product-list#s1`)
    assert.equal(shelf.component, "vtex.product-summary@2.92.1/ProductSummaryList")
    assert.equal(shelf.data.collection, "1765", "content (site editor) wins over props")
    assert.equal(shelf.data.orderBy, "OrderByPriceASC")
    assert.deepEqual(blocks.get(H).children.slice(0, 2), [`${H}/list-context.image-list#hero`, `${H}/toggle-layout#countdown`], "__fold__ has no entry and is skipped")
    assert.equal(parseVtexBlocks("<html>no runtime</html>").size, 0)
})

test("vtexPageSections: the home in render order, mobile only, with the real queries", () => {
    const sections = vtexPageSections(parseVtexBlocks(HTML), "store.home", { utcOffset: "-03:00" })
    assert.deepEqual(
        sections.map((s) => s.kind),
        ["banners", "countdown", "tabbedShelf", "banners", "shelf", "video", "text", "newsletter", "unsupported"],
    )
    const [banners, countdown, tabbed, col1, shelf, video, text, , unsupported] = sections
    assert.equal(col1.title, "hidratar e iluminar ✨", "consecutive rich texts: title, then subtitle")
    assert.equal(col1.subtitle, "Cremes para a área dos olhos")
    assert.deepEqual(banners.images, [
        { image: "https://cdn.x/mob1.gif", link: "/promo", alt: "Black" },
        { image: "https://cdn.x/desk2.jpg", link: "https://www.loja.com/sale" },
    ])
    assert.deepEqual(countdown, { kind: "countdown", id: "toggle-layout#countdown", targetDate: "2026-11-13T10:00:00-03:00", title: "FALTAM", image: "https://cdn.x/11-11.webp", link: "/promocao-progressiva" })
    assert.equal(tabbed.title, "Produtos Queridinhos")
    assert.equal(tabbed.subtitle, "Os produtos para a sua beleza")
    assert.deepEqual(tabbed.tabs, [
        { label: "Mais vendidos", collection: "1415", sort: "orders:desc", maxItems: 12 },
        { label: "Lançamentos", collection: "1003", sort: "release:desc" },
    ])
    assert.deepEqual(shelf, { kind: "shelf", id: "flex-layout.row#shelf1", title: "Protetor Solar Océane", collection: "1765", sort: "price:asc", maxItems: 12 })
    assert.equal(video.src, "https://www.youtube.com/watch?v=DWDFxAbxAqg")
    assert.equal(text.text, "O melhor lugar para beleza.")
    assert.deepEqual(unsupported.components, ["store-theme@1.0.0/Influencers"])
})

test("vtexProductSummary: what the store's product card shows, and which parts the app supports", () => {
    const summary = vtexProductSummary(parseVtexBlocks(HTML))
    const byFeature = Object.fromEntries(summary.features.map((f) => [f.feature, f]))
    assert.deepEqual(byFeature.specificationBadges.groups, ["Selos"])
    assert.deepEqual(byFeature.specificationBadges.names, ["Vegano"])
    assert.ok(byFeature.discount && byFeature.wishlist && byFeature.rating && byFeature.similars)
    assert.equal(byFeature.similars.supported, false)
    assert.equal(byFeature.rating.supported, "with a reviews provider")
    assert.deepEqual(summary.customComponents, ["store-theme@1.0.0/ProductTag"])
    assert.deepEqual(summary.highlights, { show: ["Océane Week"], hide: ["Tag + barato no APP", "Tag PREÇO DE BLACK"] })
})

test("cmsSectionsFromVtex turns them into the app's CMS sections, and lists what it could not", () => {
    const sections = vtexPageSections(parseVtexBlocks(HTML), "store.home", { utcOffset: "-03:00" })
    const { sections: cms, skipped } = cmsSectionsFromVtex(sections)
    assert.deepEqual(
        cms.map((s) => s.name),
        ["MultipleImageBanner", "Countdown", "TabbedProductShelf", "MultipleImageBanner", "ProductShelf", "RichText"],
    )
    const shelf = cms.find((s) => s.name === "ProductShelf")
    assert.deepEqual(shelf.data, { title: "Protetor Solar Océane", facets: [{ key: "productClusterIds", value: "1765" }], sort: "price:asc", numberOfItems: 12, mode: "scroll" })
    assert.deepEqual(cms[0].data.images[0], { imageUrl: "https://cdn.x/mob1.gif", action: { type: "path", value: "/promo" } })
    assert.equal(cms.find((s) => s.name === "Countdown").data.targetDate, "2026-11-13T10:00:00-03:00")
    assert.deepEqual(
        skipped.map((s) => s.kind),
        ["video", "newsletter", "unsupported"],
    )
})

import { landingTarget, resolveLinkActions } from "../lib/vtexBlocks.mjs"

// Trimmed from oceane.com.br/promocao-progressiva (Nov 2026): a store.custom landing page whose product
// listing is a customQuery (the first querySchema is the block's empty default, the second the site editor's).
const LANDING = `<html><head><title>Promoção Progressiva</title></head><body><script>__RUNTIME__ = {"route":{"domain":"store","id":"vtex.store@2.x:store.custom#promocao-progressiva","params":{}},
"querySchema":{"orderByField":"OrderByReleaseDateDESC","maxItemsPerPage":12,"queryField":"","mapField":"productClusterIds"},
"querySchema":{"maxItemsPerPage":24,"orderByField":"","queryField":"1415","mapField":"productClusterIds"}}</script></body></html>`
const CONTENT_PAGE = `<html><head><title>Cupons Océane</title></head><body><script>{"route":{"domain":"store","id":"store.custom#coupons-page","params":{}}}</script></body></html>`
const SEARCH_PAGE = `<html><head><title>Maquiagem</title></head><body><script>{"route":{"domain":"store","id":"vtex.store@2.x:store.search#category","params":{"department":"maquiagem"}}}</script></body></html>`

test("landingTarget: a custom landing page with a collection query opens that collection", () => {
    assert.deepEqual(landingTarget(LANDING), { type: "collection", value: "1415", title: "Promoção Progressiva" })
    assert.deepEqual(landingTarget(LANDING.replace('"orderByField":""', '"orderByField":"OrderByBestDiscountDESC"')), {
        type: "collection",
        value: "1415",
        sort: "discount:desc",
        title: "Promoção Progressiva",
    })
})

test("resolveLinkActions: path actions become what the page lists; content pages open in the browser", () => {
    const sections = [
        { id: "hero", name: "MultipleImageBanner", data: { images: [{ imageUrl: "a.gif", action: { type: "path", value: "/promocao-progressiva" } }, { imageUrl: "b.gif", action: { type: "path", value: "/cupom-de-desconto-oceane" } }, { imageUrl: "c.gif", action: { type: "path", value: "/maquiagem" } }] } },
        { id: "cd", name: "Countdown", data: { targetDate: "2026-11-13T10:00:00-03:00", action: { type: "path", value: "/promocao-progressiva" } } },
        { id: "shelf", name: "ProductShelf", data: { facets: [] } },
    ]
    const pages = { "/promocao-progressiva": LANDING, "/cupom-de-desconto-oceane": CONTENT_PAGE, "/maquiagem": SEARCH_PAGE }
    const { sections: out, unresolved } = resolveLinkActions(sections, pages, "https://www.oceane.com.br")
    assert.deepEqual(out[0].data.images.map((i) => i.action), [
        { type: "collection", value: "1415", title: "Promoção Progressiva" },
        { type: "link", value: "https://www.oceane.com.br/cupom-de-desconto-oceane" },
        { type: "path", value: "/maquiagem" },
    ])
    assert.deepEqual(out[1].data.action, { type: "collection", value: "1415", title: "Promoção Progressiva" })
    assert.deepEqual(unresolved, [])
    assert.equal(sections[0].data.images[0].action.type, "path", "the input is not mutated")
})

test("vtexPageSections: a page-wide wrapper holding a countdown (even a hidden one) is walked through, not turned into one countdown", () => {
    const html = `<html><body><script>window.__RUNTIME__={"extensions":{${[
        entry(H, { component: "vtex.render-runtime@8.136.3/LayoutContainer", blocks: ["responsive-layout.mobile#home"] }),
        entry(`${H}/responsive-layout.mobile#home`, { component: "vtex.responsive-layout@0.1.0/MobileLayout", blocks: ["list-context.image-list#hero", "flex-layout.row#shelf", "flex-layout.row#cd"] }),
        entry(`${H}/responsive-layout.mobile#home/list-context.image-list#hero`, { component: "vtex.store-image@0.24.0/ImageList", content: { images: [{ image: "https://cdn.x/1.jpg" }] } }),
        entry(`${H}/responsive-layout.mobile#home/flex-layout.row#shelf`, { blocks: ["list-context.product-list#s"] }),
        entry(`${H}/responsive-layout.mobile#home/flex-layout.row#shelf/list-context.product-list#s`, { component: "vtex.product-list-context@0.x/ProductList", content: { collection: "137" } }),
        entry(`${H}/responsive-layout.mobile#home/flex-layout.row#cd`, { props: { blockClass: "hide" }, blocks: ["count-down"] }),
        entry(`${H}/responsive-layout.mobile#home/flex-layout.row#cd/count-down`, { component: "store-theme@1.0.0/CountDown", content: { targetDate: { year: 2026, month: 11, day: 13, hour: 10, minute: 0, second: 0 } } }),
    ].join(",")}}}</script></body></html>`
    assert.deepEqual(vtexPageSections(parseVtexBlocks(html), H).map((s) => s.kind), ["banners", "shelf"])
})
