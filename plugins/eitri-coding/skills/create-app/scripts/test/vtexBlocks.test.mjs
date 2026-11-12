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

test("cmsSectionsFromVtex: sections from one block get distinct ids (they are React keys)", () => {
    const { sections } = cmsSectionsFromVtex([
        { kind: "banners", id: "flex-layout.row#bottom-text", images: [{ image: "https://cdn.x/logo.png" }] },
        { kind: "text", id: "flex-layout.row#bottom-text", text: "O melhor lugar" },
        { kind: "text", id: "flex-layout.row#bottom-text", text: "Ver mais" },
    ])
    assert.deepEqual(
        sections.map((s) => s.id),
        ["flex-layout.row#bottom-text", "flex-layout.row#bottom-text-2", "flex-layout.row#bottom-text-3"],
    )
})

import { headlessFacetNames, landingTarget, resolveLinkActions } from "../lib/vtexBlocks.mjs"

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

test("landingTarget: a page without products is content (null), a search page keeps its path", () => {
    assert.equal(landingTarget(CONTENT_PAGE), null)
    assert.equal(landingTarget(SEARCH_PAGE), "path")
    assert.equal(landingTarget("<html>not VTEX</html>"), undefined)
})

// Trimmed from farmrio.com.br (deco.cx on VTEX, Nov 2026): no VTEX IO runtime; every filter link of the listing
// repeats the page's own base facets, and the header links to other listings with their own filters.
const HEADLESS_LISTING = `<html><head><title>Amigo Oculto: troca de presentes</title></head><body>
<a href="/fabula-e-bento/smiley?filter.productClusterIds=2617&amp;filter.tamanho=10">Smiley</a>
<h1 class="t">Roupas tamanho PP FARM Rio<div class="breadcrumbs">x</div></h1>
<a href="/tamanhos/tamanho-pp?filter.productClusterIds=689&amp;filter.specificationFilter_29=PP&amp;filter.tamanho=m">M</a>
<a href="/tamanhos/tamanho-pp?filter.productClusterIds=689&amp;filter.specificationFilter_29=PP&amp;filter.cores=azul">Azul</a>
</body></html>`

test("landingTarget: a headless listing (deco, FastStore) opens the base facets its filter links share", () => {
    assert.deepEqual(landingTarget(HEADLESS_LISTING, "/tamanhos/tamanho-pp"), {
        type: "collection",
        value: "689",
        facets: [{ key: "specificationFilter_29", value: "PP" }],
        title: "Roupas tamanho PP FARM Rio",
    })
    // Without a collection the shared facets open as a facets action.
    const category = HEADLESS_LISTING.replaceAll("filter.productClusterIds=689&amp;", "filter.category-1=roupas&amp;").replace(/<h1[\s\S]*?<\/h1>/, "")
    assert.deepEqual(landingTarget(category, "/tamanhos/tamanho-pp"), {
        type: "facets",
        facets: [{ key: "category-1", value: "roupas" }, { key: "specificationFilter_29", value: "PP" }],
        title: "Amigo Oculto: troca de presentes",
    })
    // Filter links of other pages say nothing about this one; one filter link alone is not a base.
    assert.equal(landingTarget(HEADLESS_LISTING, "/outra-pagina"), undefined)
    const single = HEADLESS_LISTING.replace(/<a href="\/tamanhos\/tamanho-pp[^>]*cores=azul">Azul<\/a>/, "")
    assert.equal(landingTarget(single, "/tamanhos/tamanho-pp"), undefined)
    // Filter links that share nothing: unknown, the path stays.
    const disjoint = HEADLESS_LISTING.replace("filter.productClusterIds=689&amp;filter.specificationFilter_29=PP&amp;filter.cores=azul", "filter.cores=azul")
    assert.equal(landingTarget(disjoint, "/tamanhos/tamanho-pp"), undefined)
})

test("resolveLinkActions: a headless store's banner paths become their listings' facets", () => {
    const sections = [{ id: "b", name: "MultipleImageBanner", data: { images: [{ imageUrl: "a.jpg", action: { type: "path", value: "/tamanhos/tamanho-pp" } }] } }]
    const { sections: out } = resolveLinkActions(sections, { "/tamanhos/tamanho-pp": HEADLESS_LISTING }, "https://www.farmrio.com.br")
    assert.equal(out[0].data.images[0].action.type, "collection")
    assert.equal(out[0].data.images[0].action.value, "689")
    // A fetched page that is neither a listing nor a VTEX IO page keeps its path, and says so.
    const unknown = resolveLinkActions([{ id: "b", name: "MultipleImageBanner", data: { images: [{ imageUrl: "a.jpg", action: { type: "path", value: "/produtos/barbour" } }] } }], { "/produtos/barbour": "<h1>vem aí</h1>" }, "https://www.farmrio.com.br")
    assert.deepEqual(unknown.sections[0].data.images[0].action, { type: "path", value: "/produtos/barbour" })
    assert.deepEqual(unknown.unresolved, ["/produtos/barbour"])
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

test("resolveLinkActions: a page that could not be fetched is reported and left as is", () => {
    const sections = [{ id: "hero", name: "MultipleImageBanner", data: { images: [{ imageUrl: "a.gif", action: { type: "path", value: "/gone" } }] } }]
    const { sections: out, unresolved } = resolveLinkActions(sections, {}, "https://www.loja.com")
    assert.deepEqual(out[0].data.images[0].action, { type: "path", value: "/gone" })
    assert.deepEqual(unresolved, ["/gone"])
})

test("resolveLinkActions: a page it cannot read opens what VTEX's pagetype says it lists; a ?q= link opens that search", () => {
    const sections = [{ name: "MultipleImageBanner", data: { images: [{ action: { type: "path", value: "/ellipse" } }, { action: { type: "path", value: "/9060" } }, { action: { type: "path", value: "/s?q=gator" } }, { action: { type: "path", value: "/sobre" } }] } }]
    const pages = { "/ellipse": `<div id="__next"></div>`, "/9060": `<div id="__next"></div>`, "/s?q=gator": `<div id="__next"></div>`, "/sobre": `<div id="__next"></div>` }
    const known = { "/ellipse": { type: "collection", value: "577", title: "Ellipse" }, "/9060": { type: "search", value: "9060", title: "9060" } }
    const { sections: out, unresolved } = resolveLinkActions(sections, pages, "https://www.loja.com.br", known)
    assert.deepEqual(
        out[0].data.images.map((i) => i.action),
        [{ type: "collection", value: "577", title: "Ellipse" }, { type: "search", value: "9060", title: "9060" }, { type: "search", value: "gator" }, { type: "path", value: "/sobre" }],
    )
    assert.deepEqual(unresolved, ["/sobre"])
})

// A Next.js (FastStore + deco) page: the listing is client-rendered, and what it lists rides in the React Server
// Components payload, as escaped JSON inside self.__next_f.push strings.
const rsc = (json) => `<html><head><title>Family 574</title></head><body><h1>Family 574</h1><script>self.__next_f.push([1,"${JSON.stringify(json).replace(/"/g, '\\"')}"])</script></body></html>`
const RSC_LISTING = rsc(["$", "$L2c", null, { pathname: "/family-574", baseFacets: [{ key: "colecao", value: "Família 574" }], noIndexing: false }])
const RSC_LANDING = rsc(["$", "$L2e", null, { title: "Conheça o lançamento", tabs: [{ source: { collectionId: "636", sort: "Mais vendidos" }, numberOfItems: 10 }] }])
    .replace(/Family 574/g, "New Balance 983 está chegando")

test("headlessFacetNames: the base facets a Next.js listing page names in its server payload", () => {
    assert.deepEqual(headlessFacetNames(RSC_LISTING), [{ key: "colecao", value: "Família 574" }])
    assert.deepEqual(headlessFacetNames(RSC_LANDING), [])
    assert.deepEqual(headlessFacetNames("<html>plain</html>"), [])
})

test("landingTarget: a Next.js listing names facets only (the caller resolves them), a landing page opens its shelf's collection", () => {
    assert.equal(landingTarget(RSC_LISTING, "/family-574"), undefined)
    assert.deepEqual(landingTarget(RSC_LANDING, "/lancamento-983"), { type: "collection", value: "636", title: "New Balance 983 está chegando" })
})

test("landingTarget: a Next.js listing whose base facet is a VTEX collection opens it, before any shelf on the page", () => {
    const page = rsc([
        ["$", "$L2c", null, { pathname: "/lancamento-gremio", baseFacets: [{ key: "productClusters.id", value: "559" }] }],
        ["$", "$L2d", null, { server: { variables: { selectedFacets: [{ key: "productClusterIds", value: "559" }] } } }],
        ["$", "$L2e", null, { tabs: [{ source: { collectionId: "623" } }] }],
    ]).replace(/Family 574/g, "Camisas Grêmio")
    assert.deepEqual(landingTarget(page, "/lancamento-gremio"), { type: "collection", value: "559", title: "Camisas Grêmio" })
})

test("resolveLinkActions: the banner's own label beats the page's heading as the listing title", () => {
    const sections = [{ id: "s", name: "MultipleImageBanner", data: { images: [{ imageUrl: "a.jpg", action: { type: "path", value: "/lancamento-983", title: "983" } }] } }]
    const { sections: out } = resolveLinkActions(sections, { "/lancamento-983": RSC_LANDING }, "https://www.loja.com.br")
    assert.deepEqual(out[0].data.images[0].action, { type: "collection", value: "636", title: "983" })
})
