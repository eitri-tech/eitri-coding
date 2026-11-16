import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "analyze-store.mjs")

/** A saved search probe of a store whose facets narrow the list (Intelligent Search): keeps the tests offline. */
function ioSearch() {
    const file = join(mkdtempSync(join(tmpdir(), "probe-")), "search-probe.json")
    writeFileSync(file, JSON.stringify({ department: "roupas", all: 5000, byFacet: 800, byQueryMap: 800 }))
    return file
}

function entry(path, { component, blocks = [], content = {} }) {
    const body = { before: [], blockId: path, blocks: blocks.map((id) => ({ extensionPointId: id })), component, props: {}, content }
    return `"${path.replaceAll("/", "\\u002F")}":${JSON.stringify(body)}`
}

/** A minimal site-clone capture of a VTEX store home: block tree, a rendered card, CSS, network log, outline. */
function capture() {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    const H = "store.home"
    const raw = `<html><head><script src="https://cdn.widde.io/widde.1.1.0.js"></script></head><body><script>__RUNTIME__={"extensions":{${[
        entry(H, { component: "vtex.render-runtime@8/LayoutContainer", blocks: ["list-context.image-list#hero", "toggle-layout#cd", "flex-layout.row#s1", "flex-layout.row#nl"] }),
        entry(`${H}/list-context.image-list#hero`, { component: "vtex.store-image@0.24.0/ImageList", content: { images: [{ image: "https://cdn.x/a.gif", link: { url: "/promocao-progressiva" } }, { image: "https://cdn.x/b.gif", link: { url: "/cupom" } }] } }),
        entry(`${H}/toggle-layout#cd`, { component: "vtex.toggle-layout@0.0.3/index", blocks: ["count-down"] }),
        entry(`${H}/toggle-layout#cd/count-down`, { component: "store-theme@1/CountDown", content: { targetDate: { year: 2026, month: 11, day: 13, hour: 10 } } }),
        entry(`${H}/flex-layout.row#s1`, { component: "vtex.flex-layout@0/FlexLayout", blocks: ["list-context.product-list#s1"] }),
        entry(`${H}/flex-layout.row#s1/list-context.product-list#s1`, { component: "vtex.product-summary@2/ProductSummaryList", content: { collection: "1765", orderBy: "OrderByPriceASC" }, blocks: ["product-summary"] }),
        entry(`${H}/flex-layout.row#s1/list-context.product-list#s1/product-summary`, { component: "vtex.product-summary@2/ProductSummaryCustom", blocks: ["badges", "similar-quantity", "stars", "tags-product"] }),
        entry(`${H}/flex-layout.row#s1/list-context.product-list#s1/product-summary/badges`, { component: "vtex.product-specification-badges@0.4.1/index", content: { specificationGroupName: "Selos" } }),
        entry(`${H}/flex-layout.row#s1/list-context.product-list#s1/product-summary/similar-quantity`, { component: "store-theme@1/SimilarQuantity" }),
        entry(`${H}/flex-layout.row#s1/list-context.product-list#s1/product-summary/stars`, { component: "store-theme@1/VerifyOpinionStarsSummary" }),
        entry(`${H}/flex-layout.row#s1/list-context.product-list#s1/product-summary/tags-product`, { component: "store-theme@1/ProductTag" }),
        entry(`${H}/flex-layout.row#s1/list-context.product-list#s1/product-summary/hl`, { component: "vtex.product-highlights@2/ProductHighlights", content: { filter: { type: "hide", highlightNames: ["Tag PREÇO DE BLACK"] } } }),
        entry(`${H}/flex-layout.row#nl`, { component: "vtex.flex-layout@0/FlexLayout", blocks: ["newsletter"] }),
        entry(`${H}/flex-layout.row#nl/newsletter`, { component: "vtex.store-newsletter@1/Newsletter" }),
    ].join(",")}}}</script></body></html>`
    const rendered = `<html><body>
<widde-pro-carousel data-widde-ready=""><div data-widde-skeleton="" style="height: 386px"></div></widde-pro-carousel>
<a href="/fixador-perfect-fix-ap2000965cuni/p"><div class="container-tag-product" style="background-color: rgb(0, 0, 0);"><p class="t" style="color: rgb(255, 102, 200);">PREÇO DE BLACK</p></div><p class="vegano">Vegano</p><p class="cruelty-free">Cruelty Free</p></a>
</body></html>`
    writeFileSync(join(dir, "page.raw.html"), raw)
    writeFileSync(join(dir, "page.rendered.html"), rendered)
    mkdirSync(join(dir, "css"))
    writeFileSync(join(dir, "css", "used.css"), ".vegano { background-color: rgb(182, 196, 140); color: rgb(56, 57, 53); } .cruelty-free { display: none; }")
    writeFileSync(
        join(dir, "network.json"),
        JSON.stringify({
            requests: [
                { url: "https://api-product-reviews.cxr.skeepers.io/v1/websites/969384d1-eb8a-64e4-a1f2-c46b29a4d241/products/ratings?ref=40951" },
                { url: "https://www.clarity.ms/tag/abc123" },
                { url: "https://cdn.atendimen.to/widget/x/current" },
            ],
        }),
    )
    mkdirSync(join(dir, "content"))
    writeFileSync(join(dir, "content", "outline.json"), JSON.stringify([{ section: 1, type: "link", href: "https://www.loja.com.br/fixador-perfect-fix-ap2000965cuni/p" }]))
    const linkPages = join(dir, "link-pages.json")
    writeFileSync(
        linkPages,
        JSON.stringify({
            "/promocao-progressiva": `<title>Promoção Progressiva</title><script>{"route":{"domain":"store","id":"store.custom#promocao-progressiva","params":{}},"querySchema":{"queryField":"1415","mapField":"productClusterIds"}}</script>`,
            "/cupom": `<title>Cupons</title><script>{"route":{"domain":"store","id":"store.custom#coupons-page","params":{}}}</script>`,
        }),
    )
    const catalog = join(dir, "catalog.json")
    writeFileSync(catalog, JSON.stringify([{ productId: "40951", clusterHighlights: { 1733: "Tag PREÇO DE BLACK" }, specifications: { Selos: ["Vegano", "Cruelty Free"] } }]))
    return { dir, catalog, linkPages }
}

test("analyze-store: integrations, the home's sections, the card's badges and every gap, from one capture", () => {
    const { dir, catalog, linkPages } = capture()
    const out = JSON.parse(
        execFileSync(process.execPath, [script, "https://www.loja.com.br/", "--capture", dir, "--catalog", catalog, "--link-pages", linkPages, "--utc-offset", "-03:00"], { encoding: "utf8" }),
    )

    assert.deepEqual(
        out.integrations.map((i) => [i.id, i.support]),
        [
            ["skeepers", "integrated"],
            ["clarity", "config"],
            ["atendimento", "none"],
            ["widde", "none"],
        ],
    )
    assert.equal(out.integrations.find((i) => i.id === "widde").placeholder, true, "the widget was still a skeleton when captured")

    assert.deepEqual(
        out.home.cmsSections.map((s) => s.name),
        ["MultipleImageBanner", "Countdown", "ProductShelf"],
    )
    assert.equal(out.home.cmsSections[1].data.targetDate, "2026-11-13T10:00:00-03:00")
    assert.deepEqual(
        out.home.cmsSections[0].data.images.map((i) => i.action),
        [
            { type: "collection", value: "1415", title: "Promoção Progressiva" },
            { type: "link", value: "https://www.loja.com.br/cupom" },
        ],
        "a banner opens what its landing page lists, not a guessed category",
    )

    assert.deepEqual(out.remoteConfig["appConfigs.reviews"], { provider: "skeepers", websiteId: "969384d1-eb8a-64e4-a1f2-c46b29a4d241" })
    assert.deepEqual(out.remoteConfig["appConfigs.badges"].highlights, { allow: ["Tag PREÇO DE BLACK"], stripPrefixes: ["Tag "], styles: { "PREÇO DE BLACK": { bgColor: "#000000", textColor: "#ff66c8" } } })
    assert.deepEqual(out.remoteConfig["appConfigs.badges"].specifications, { names: ["Selos"], values: { Vegano: { bgColor: "#b6c48c", textColor: "#383935" } } })
    assert.equal(out.remoteConfig["appConfigs.clarityId"], undefined, "opt-in integrations are proposed, not set")
    assert.deepEqual(out.optIn, [{ id: "clarity", remoteConfig: { "appConfigs.clarityId": "abc123" }, note: out.integrations.find((i) => i.id === "clarity").note }])

    const gaps = out.gaps.map((g) => `${g.area}: ${g.item}`)
    assert.ok(gaps.includes("integration: atendimen.to chat"), gaps.join(" | "))
    assert.ok(gaps.includes("integration: Widde shoppable videos (stories)"))
    assert.ok(gaps.includes("home: newsletter"))
    assert.ok(gaps.includes("product card: similars"))
    assert.ok(!gaps.some((g) => /rating|specificationBadges|highlights/.test(g)), "covered: ratings through Skeepers, badges through the add-on")
})

test("analyze-store without a VTEX block tree still reports integrations", () => {
    const { dir, catalog } = capture()
    writeFileSync(join(dir, "page.raw.html"), "<html><body>no runtime</body></html>")
    const out = JSON.parse(execFileSync(process.execPath, [script, "https://www.loja.com.br/", "--capture", dir, "--catalog", catalog], { encoding: "utf8" }))
    assert.ok(out.integrations.length >= 3)
    assert.deepEqual(out.home.cmsSections, [])
    assert.match(out.warnings.join(" "), /no VTEX IO block tree/)
})

test("analyze-store on a headless store (deco, FastStore): the home's linked images become banners that open their listings", () => {
    const { dir, catalog } = capture()
    writeFileSync(join(dir, "page.raw.html"), "<html><body>no runtime</body></html>")
    mkdirSync(join(dir, "layout"))
    writeFileSync(
        join(dir, "layout", "sections.json"),
        JSON.stringify({ sections: [{ index: 0, name: "00-header-header", tag: "header" }, { index: 1, name: "01-images-carousel", tag: "section" }, { index: 2, name: "02-images-banner", tag: "section" }] }),
    )
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ primaryBreakpoint: 375 }))
    const src = (f) => `https://assets.decocms.com/image?width=412&height=534&src=https://cdn.loja.com.br/${f}`
    writeFileSync(
        join(dir, "content", "outline.json"),
        JSON.stringify([
            { section: 0, type: "img", src: src("logo.svg"), box: [112, 54, 138, 20], href: "https://www.loja.com.br/" },
            { section: 1, type: "img", src: src("hero-1.jpg"), box: [0, 92, 375, 486], href: "https://www.loja.com.br/tamanhos/pp" },
            { section: 1, type: "img", src: src("hero-2.jpg"), box: [375, 92, 375, 486], href: "https://www.loja.com.br/sobre" },
            { section: 2, type: "img", src: src("app.jpg"), box: [0, 600, 375, 68], href: "https://loja.onelink.me/abc" },
        ]),
    )
    const linkPages = join(dir, "headless-pages.json")
    writeFileSync(
        linkPages,
        JSON.stringify({
            "/tamanhos/pp": `<h1>Roupas PP</h1><a href="/tamanhos/pp?filter.productClusterIds=689&amp;filter.tamanho=m">M</a><a href="/tamanhos/pp?filter.productClusterIds=689&amp;filter.cor=azul">Azul</a>`,
            "/sobre": `<h1>Sobre</h1><p>texto</p>`,
        }),
    )
    const out = JSON.parse(execFileSync(process.execPath, [script, "https://www.loja.com.br/", "--capture", dir, "--catalog", catalog, "--link-pages", linkPages], { encoding: "utf8" }))
    assert.deepEqual(out.home.cmsSections, [
        {
            id: "dom-01-images-carousel",
            name: "MultipleImageBanner",
            data: {
                images: [
                    { imageUrl: "https://cdn.loja.com.br/hero-1.jpg", action: { type: "collection", value: "689", title: "Roupas PP" } },
                    // Unknown pages keep their path: the template resolves it, and the warning says to check it.
                    { imageUrl: "https://cdn.loja.com.br/hero-2.jpg", action: { type: "path", value: "/sobre" } },
                ],
                aspectRatio: "375:486",
                mode: "SliderHero",
            },
        },
    ])
    assert.match(out.warnings.join(" "), /linked images/)
    assert.ok(out.gaps.some((g) => g.area === "home" && g.item === "app download banner"), JSON.stringify(out.gaps))
})

test("analyze-store on a headless VTEX store: banner links whose pages it cannot read open what VTEX's pagetype says (--pagetypes offline)", () => {
    const { dir, catalog } = capture()
    writeFileSync(join(dir, "page.raw.html"), "<html><body>no runtime</body></html>")
    mkdirSync(join(dir, "layout"))
    writeFileSync(join(dir, "layout", "sections.json"), JSON.stringify({ sections: [{ index: 0, name: "00-header-header", tag: "header" }, { index: 1, name: "01-images-carousel", tag: "section" }] }))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ primaryBreakpoint: 375 }))
    writeFileSync(
        join(dir, "content", "outline.json"),
        JSON.stringify([
            { section: 1, type: "img", src: "https://loja.vtexassets.com/arquivos/a.jpg", box: [0, 92, 375, 486], href: "https://www.loja.com.br/ellipse" },
            { section: 1, type: "img", src: "https://loja.vtexassets.com/arquivos/b.jpg", box: [375, 92, 375, 486], href: "https://www.loja.com.br/9060" },
        ]),
    )
    const linkPages = join(dir, "pages.json")
    writeFileSync(linkPages, JSON.stringify({ "/ellipse": `<div id="__next"></div>`, "/9060": `<div id="__next"></div>` }))
    const pagetypes = join(dir, "pagetypes.json")
    writeFileSync(
        pagetypes,
        JSON.stringify({
            "/ellipse": { id: "577", name: "Ellipse", url: "loja.vtexcommercestable.com.br/577?map=productClusterIds", pageType: "Collection" },
            "/9060": { id: null, name: "9060", url: "loja.vtexcommercestable.com.br/9060", pageType: "FullText", hits: 27 },
        }),
    )
    const profile = join(dir, "profile.json")
    writeFileSync(profile, JSON.stringify({ platform: "VTEX", account: "loja", locale: "pt-BR" }))
    const out = JSON.parse(execFileSync(process.execPath, [script, "https://www.loja.com.br/", "--capture", dir, "--catalog", catalog, "--link-pages", linkPages, "--pagetypes", pagetypes, "--profile", profile, "--search-probe", ioSearch()], { encoding: "utf8" }))
    assert.deepEqual(
        out.home.cmsSections[0].data.images.map((i) => i.action),
        [{ type: "collection", value: "577", title: "Ellipse" }, { type: "search", value: "9060", title: "9060" }],
    )
    assert.doesNotMatch(out.warnings.join(" "), /Could not open or read/)
})

test("analyze-store on a Next.js VTEX store: a listing page's base facet names its collection, a landing page opens its shelf's collection", () => {
    const { dir, catalog } = capture()
    writeFileSync(join(dir, "page.raw.html"), "<html><body>no runtime</body></html>")
    mkdirSync(join(dir, "layout"))
    writeFileSync(join(dir, "layout", "sections.json"), JSON.stringify({ sections: [{ index: 0, name: "00-header-header", tag: "header" }, { index: 1, name: "01-images-carousel", tag: "section" }] }))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ primaryBreakpoint: 375 }))
    writeFileSync(
        join(dir, "content", "outline.json"),
        JSON.stringify([
            { section: 1, type: "img", src: "https://loja.vtexassets.com/arquivos/a.jpg", box: [0, 92, 375, 486], href: "https://www.loja.com.br/family-574" },
            { section: 1, type: "img", src: "https://loja.vtexassets.com/arquivos/b.jpg", box: [375, 92, 375, 486], href: "https://www.loja.com.br/lancamento-983" },
        ]),
    )
    const push = (json) => `<script>self.__next_f.push([1,"${JSON.stringify(json).replace(/"/g, '\\"')}"])</script>`
    const linkPages = join(dir, "pages.json")
    writeFileSync(
        linkPages,
        JSON.stringify({
            "/family-574": `<title>Family 574</title>${push({ pathname: "/family-574", baseFacets: [{ key: "colecao", value: "Família 574" }] })}`,
            "/lancamento-983": `<title>983</title><h1>New Balance 983</h1>${push({ tabs: [{ source: { collectionId: "636" } }] })}`,
        }),
    )
    const pagetypes = join(dir, "pagetypes.json")
    writeFileSync(
        pagetypes,
        JSON.stringify({
            // The page's own path is unknown to the catalog (a search that happens to find products)…
            "/family-574": { id: null, name: "family-574", url: "loja.vtexcommercestable.com.br/family-574", pageType: "FullText", hits: 3 },
            // …but the collection it names is.
            "/familia-574": { id: "177", name: "Família 574", url: "loja.vtexcommercestable.com.br/177?map=productClusterIds", pageType: "Collection" },
        }),
    )
    const profile = join(dir, "profile.json")
    writeFileSync(profile, JSON.stringify({ platform: "VTEX", account: "loja", locale: "pt-BR" }))
    const out = JSON.parse(execFileSync(process.execPath, [script, "https://www.loja.com.br/", "--capture", dir, "--catalog", catalog, "--link-pages", linkPages, "--pagetypes", pagetypes, "--profile", profile, "--search-probe", ioSearch()], { encoding: "utf8" }))
    assert.deepEqual(
        out.home.cmsSections[0].data.images.map((i) => i.action),
        [{ type: "collection", value: "177", title: "Família 574" }, { type: "collection", value: "636", title: "New Balance 983" }],
    )
    assert.doesNotMatch(out.warnings.join(" "), /Could not open or read/)
})

test("analyze-store on a VTEX store whose GraphQL search ignores facets: the legacy search add-on is switched on (--search-probe offline)", () => {
    const { dir, catalog, linkPages } = capture()
    const profile = join(dir, "profile.json")
    writeFileSync(profile, JSON.stringify({ platform: "VTEX", account: "loja", host: "https://www.loja.com.br" }))
    const pagetypes = join(dir, "pagetypes.json")
    writeFileSync(pagetypes, "{}")
    const probe = join(dir, "search-probe.json")
    writeFileSync(probe, JSON.stringify({ department: "medicamentos", all: 94816, byFacet: 94816, byQueryMap: 11630 }))
    const out = JSON.parse(execFileSync(process.execPath, [script, "https://www.loja.com.br/", "--capture", dir, "--catalog", catalog, "--profile", profile, "--search-probe", probe, "--link-pages", linkPages, "--pagetypes", pagetypes], { encoding: "utf8" }))
    assert.equal(out.remoteConfig["appConfigs.legacySearchFacets"], true)
    assert.deepEqual(out.search, { department: "medicamentos", all: 94816, byFacet: 94816, byQueryMap: 11630, legacy: true })
    assert.ok(out.warnings.some((w) => /selectedFacets/.test(w) && /legacySearchFacets/.test(w)), out.warnings.join("\n"))
    // A store whose facets narrow the list keeps the template's search.
    writeFileSync(probe, JSON.stringify({ department: "maquiagem", all: 5000, byFacet: 800, byQueryMap: 800 }))
    const io = JSON.parse(execFileSync(process.execPath, [script, "https://www.loja.com.br/", "--capture", dir, "--catalog", catalog, "--profile", profile, "--search-probe", probe, "--link-pages", linkPages, "--pagetypes", pagetypes], { encoding: "utf8" }))
    assert.equal(io.remoteConfig["appConfigs.legacySearchFacets"], undefined)
    assert.equal(io.search.legacy, false)
})

