import { test } from "node:test"
import assert from "node:assert/strict"
import { domHomeSections, domWidgets, placeWidgets } from "../lib/domHome.mjs"
import { proxiedOriginal } from "../lib/imageUrl.mjs"

const HOST = "https://www.farmrio.com.br"
const proxy = (file, w, h) => `https://assets.decocms.com/image?fit=cover&width=${w}&height=${h}&quality=high&src=https://cf.farmriosoma.farmrio.com.br/site/${file}`
const img = (section, file, href, box, alt = "") => ({ section, type: "img", alt, src: proxy(file, box[2], box[3]), box, href: /^https?:/.test(href) ? href : `${HOST}${href}` })

// Shaped after farmrio.com.br (deco.cx, Nov 2026) at 375 px: a hero carousel whose loop clones slides,
// a single banner, round size tiles that overflow the screen, two banners side by side, an app-download
// banner and the footer.
const SECTIONS = [
    { index: 0, name: "00-header-header", tag: "section" },
    { index: 1, name: "01-images-carousel", tag: "section" },
    { index: 2, name: "02-images-bannercollection", tag: "section" },
    { index: 3, name: "03-category-categoryshelf", tag: "section" },
    { index: 4, name: "04-images-bannercollection", tag: "section" },
    { index: 5, name: "05-images-bannercollection", tag: "section" },
    { index: 6, name: "06-footer-footer", tag: "section" },
]
const OUTLINE = [
    { section: 0, type: "img", alt: "", src: "https://assets.decocms.com/image?width=138&height=20&src=farmrio/logo.svg", box: [112, 54, 138, 20], href: `${HOST}/` },
    img(1, "tv-achadinhos-mobile.jpg", "/produtos/achadinhos", [0, 92, 375, 486]),
    img(1, "tv-vitrine-mobile.jpg", "/novidades", [375, 92, 375, 486]),
    img(1, "tv-achadinhos-mobile.jpg", "/produtos/achadinhos", [750, 92, 375, 486]),
    img(2, "sec-vestidos-mobile.jpg", "/produtos/vestido", [0, 600, 375, 486], "banner vestidos"),
    { section: 2, type: "p", text: "Vestidos" },
    img(3, "pp.jpg", "/tamanhos/tamanho-pp", [16, 1100, 150, 156]),
    img(3, "p.jpg", "/tamanhos/tamanho-p", [174, 1100, 150, 156]),
    img(3, "m.jpg", "/tamanhos/tamanho-m", [332, 1100, 150, 156]),
    img(4, "duplo-1.jpg", "/ate-250", [0, 1300, 187, 243]),
    img(4, "duplo-2.jpg", "/produtos/partes-de-cima", [188, 1300, 187, 243]),
    img(5, "faixa-app.jpg", "https://farmrio.onelink.me/VoZj/e48c7a23", [0, 1600, 375, 68]),
    { section: 6, type: "link", text: "Mapa do site", href: `${HOST}/maps` },
    img(6, "selo.png", "/selo-b", [16, 2000, 78, 128]),
]

test("dom home: linked images become banner sections whose mode follows their rendered layout", () => {
    const { sections, skipped } = domHomeSections({ outline: OUTLINE, sections: SECTIONS, viewport: 375, storeHost: HOST })
    assert.deepEqual(
        sections.map((s) => [s.id, s.data.mode]),
        [
            ["dom-01-images-carousel", "SliderHero"],
            ["dom-02-images-bannercollection", "SingleBanner"],
            ["dom-03-category-categoryshelf", "BannerList"],
            ["dom-04-images-bannercollection", "FitOnScreen"],
        ],
    )
    const [hero, single, tiles, pair] = sections
    assert.equal(hero.name, "MultipleImageBanner")
    // Carousel loop clones are one slide; the image is the original file, not the proxy's resized copy.
    assert.deepEqual(hero.data.images, [
        { imageUrl: "https://cf.farmriosoma.farmrio.com.br/site/tv-achadinhos-mobile.jpg", action: { type: "path", value: "/produtos/achadinhos" } },
        { imageUrl: "https://cf.farmriosoma.farmrio.com.br/site/tv-vitrine-mobile.jpg", action: { type: "path", value: "/novidades" } },
    ])
    assert.equal(hero.data.aspectRatio, "375:486")
    assert.equal(single.data.aspectRatio, "375:486")
    assert.deepEqual(tiles.data.size, { maxWidth: 150 })
    assert.equal(tiles.data.aspectRatio, "150:156")
    assert.equal(tiles.data.gap, 8)
    assert.equal(pair.data.images.length, 2)
    // Header and footer are the app's own; an app-download banner means nothing inside the app.
    assert.ok(!sections.some((s) => /header|footer/.test(s.id)))
    assert.deepEqual(skipped, [{ id: "dom-05-images-bannercollection", kind: "app download banner", links: ["https://farmrio.onelink.me/VoZj/e48c7a23"] }])
})

test("dom home: an outline without boxes or links (an older capture) gives no sections, not wrong ones", () => {
    const old = OUTLINE.map(({ box, href, ...rest }) => rest)
    assert.deepEqual(domHomeSections({ outline: old, sections: SECTIONS, viewport: 375, storeHost: HOST }).sections, [])
})

test("proxiedOriginal: image proxies give back the file they resize; other URLs are kept", () => {
    assert.equal(proxiedOriginal("https://assets.decocms.com/image?fit=cover&width=138&src=farmrio/abc/logo.svg"), "https://assets.decocms.com/farmrio/abc/logo.svg")
    assert.equal(proxiedOriginal("https://loja.com/_next/image?url=https%3A%2F%2Fcdn.loja.com%2Fa.png&w=256&q=75"), "https://cdn.loja.com/a.png")
    assert.equal(proxiedOriginal("https://loja.vtexassets.com/arquivos/ids/1/a.jpg?v=2"), "https://loja.vtexassets.com/arquivos/ids/1/a.jpg?v=2")
    assert.equal(proxiedOriginal("not a url"), "not a url")
})

test("proxiedOriginal: VTEX's resizer (thumbor) and asset resize parameters give back the original file", () => {
    assert.equal(
        proxiedOriginal("https://loja.vtexassets.com/unsafe/400x0/filters:no_upscale():quality(80)/https%3A%2F%2Floja.vtexassets.com%2Fassets%2Fvtex.file-manager-graphql%2Fimages%2Fabc___123.webp"),
        "https://loja.vtexassets.com/assets/vtex.file-manager-graphql/images/abc___123.webp",
    )
    assert.equal(proxiedOriginal("https://loja.vtexassets.com/assets/vtex.file-manager-graphql/images/abc___1.png?width=3840&aspect=true&quality=8"), "https://loja.vtexassets.com/assets/vtex.file-manager-graphql/images/abc___1.png")
    assert.equal(proxiedOriginal("https://loja.vteximg.com.br/arquivos/ids/9-500-500/a.jpg?v=1&width=500"), "https://loja.vteximg.com.br/arquivos/ids/9-500-500/a.jpg?v=1")
    // Another host's width parameter may be the file itself: kept.
    assert.equal(proxiedOriginal("https://cdn.loja.com/banner.png?width=300"), "https://cdn.loja.com/banner.png?width=300")
})

test("dom home: a row whose images all open products is a product shelf, skipped with its products — not a banner of packshots", () => {
    const sections = [{ index: 1, name: "01-shelf", tag: "div" }, { index: 2, name: "02-banner", tag: "div" }]
    const outline = [
        img(1, "p1.jpg", "/tenis-a-1393592/p?skuId=1", [20, 100, 220, 220]),
        img(1, "p2.jpg", "/tenis-b-1393578/p", [250, 100, 220, 220]),
        img(1, "p3.jpg", "/tenis-c-1396412/p", [480, 100, 220, 220]),
        img(2, "hero.jpg", "/novidades", [0, 400, 375, 300]),
    ]
    const { sections: out, skipped } = domHomeSections({ outline, sections, viewport: 375, storeHost: HOST })
    assert.deepEqual(out.map((s) => s.id), ["dom-02-banner"])
    assert.deepEqual(skipped, [{ id: "dom-01-shelf", kind: "product shelf", products: ["tenis-a-1393592", "tenis-b-1393578", "tenis-c-1396412"] }])
})

// Shaped after newbalance.com.br (FastStore + deco, Nov 2026): the hero's slide images are not links — each
// slide's call to action is a button under its title — and the silhouette tiles are links labelled with the model.
const NB = "https://www.newbalance.com.br"
const NB_SECTIONS = [
    { index: 1, name: "01-flex", tag: "div" },
    { index: 2, name: "The 983", tag: "div" },
    { index: 3, name: "Descubra as Silhuetas", tag: "div" },
]
const nbImg = (section, file, box, href) => ({ section, type: "img", alt: "", src: `https://assets.decocms.com/image?width=400&src=nb%2F${file}`, box, ...(href ? { href: `${NB}${href}` } : {}) })
const NB_OUTLINE = [
    { section: 1, type: "img", alt: "", src: `${NB}/brand/search.svg`, box: [313, 110, 22, 22] },
    { section: 1, type: "link", text: "Ver tudo", href: `${NB}/busca` },
    // A looping carousel: the last slide is cloned before the first.
    nbImg(2, "mob-ellipse.webp", [-375, 155, 375, 385]),
    { section: 2, type: "h1", text: "The Ellipse" },
    { section: 2, type: "link", text: "Masculino", href: `${NB}/tenis-ellipse-masculino-1395125/p` },
    { section: 2, type: "link", text: "Feminino", href: `${NB}/tenis-ellipse-feminino-1395154/p` },
    nbImg(2, "mob-983.webp", [0, 155, 375, 385]),
    { section: 2, type: "h1", text: "The 983" },
    { section: 2, type: "h2", text: "A new dimension." },
    { section: 2, type: "link", text: "Explorar", href: `${NB}/lancamento-983` },
    nbImg(2, "mob-ellipse.webp", [375, 155, 375, 385]),
    { section: 2, type: "h1", text: "The Ellipse" },
    { section: 2, type: "link", text: "Masculino", href: `${NB}/tenis-ellipse-masculino-1395125/p` },
    { section: 3, type: "h2", text: "Descubra as Silhuetas" },
    { section: 3, type: "link", text: "983", href: `${NB}/lancamento-983` },
    nbImg(3, "983-silhu.webp", [20, 900, 185, 93], "/lancamento-983"),
    { section: 3, type: "span", text: "983" },
    { section: 3, type: "link", text: "574", href: `${NB}/family-574` },
    nbImg(3, "574-silhu.webp", [215, 900, 185, 93], "/family-574"),
]

test("dom home: a slide image that is not a link opens its slide's call to action, titled with the slide's heading", () => {
    const { sections } = domHomeSections({ outline: NB_OUTLINE, sections: NB_SECTIONS, viewport: 375, storeHost: NB })
    assert.deepEqual(
        sections.map((s) => [s.id, s.data.mode]),
        [
            ["dom-The 983", "SliderHero"],
            ["dom-Descubra as Silhuetas", "BannerList"],
        ],
    )
    // Slides in on-screen order: the loop's clone before the first slide does not reorder them.
    assert.deepEqual(sections[0].data.images, [
        { imageUrl: proxiedOriginal(nbImg(2, "mob-983.webp", [0, 0, 1, 1]).src), action: { type: "path", value: "/lancamento-983", title: "The 983" } },
        { imageUrl: proxiedOriginal(nbImg(2, "mob-ellipse.webp", [0, 0, 1, 1]).src), action: { type: "product", value: "tenis-ellipse-masculino-1395125" } },
    ])
})

test("dom home: a linked tile's label is its action's title", () => {
    const { sections } = domHomeSections({ outline: NB_OUTLINE, sections: NB_SECTIONS, viewport: 375, storeHost: NB })
    assert.deepEqual(
        sections[1].data.images.map((i) => i.action),
        [
            { type: "path", value: "/lancamento-983", title: "983" },
            { type: "path", value: "/family-574", title: "574" },
        ],
    )
})

test("dom home: the section's heading is its mainTitle, a tile's caption its subLabel (what the template's banners draw)", () => {
    const { sections } = domHomeSections({ outline: NB_OUTLINE, sections: NB_SECTIONS, viewport: 375, storeHost: NB })
    const [hero, tiles] = sections
    // The hero's headings belong to its slides, not to the section.
    assert.equal(hero.data.mainTitle, undefined)
    assert.ok(hero.data.images.every((i) => i.subLabel === undefined))
    assert.equal(tiles.data.mainTitle, "Descubra as Silhuetas")
    assert.deepEqual(tiles.data.images.map((i) => i.subLabel), ["983", "574"])
})

// drogariaspacheco.com.br (legacy VTEX CMS, Nov 2026): the "Oferta do Dia" box is one product card (its image, its
// name and its prices all link to the product), "Ofertas em Destaque" two; the hero slide opening a product is a banner.
test("dom home: product cards (an image whose product link also shows a price) are skipped at any count; a banner opening a product stays", () => {
    const PH = "https://www.drogariaspacheco.com.br"
    const sections = [
        { index: 1, name: "01-container-lg", tag: "section" },
        { index: 7, name: "07-oferta-do-dia", tag: "section" },
    ]
    const p = (slug) => `${PH}/${slug}/p`
    const outline = [
        { section: 1, type: "img", src: `${PH}/arquivos/semaclique.jpg`, box: [20, 540, 335, 335], href: p("semaclique-semaglutida") },
        { section: 1, type: "link", text: "Saiba mais", href: p("semaclique-semaglutida") },
        { section: 7, type: "h2", text: "Oferta do Dia" },
        { section: 7, type: "img", src: `${PH}/arquivos/ids/1/c-triple.jpg`, box: [128, 2706, 120, 120], href: p("c-triple") },
        { section: 7, type: "link", text: "Complemento Alimentar C-Triple", href: p("c-triple") },
        { section: 7, type: "link", text: "R$35,99", href: p("c-triple") },
        { section: 7, type: "h2", text: "Ofertas em Destaque" },
        { section: 7, type: "img", src: `${PH}/arquivos/ids/2/kit-nivea.jpg`, box: [128, 3205, 120, 120], href: p("kit-nivea") },
        { section: 7, type: "link", text: "R$42,90", href: p("kit-nivea") },
        { section: 7, type: "img", src: `${PH}/arquivos/ids/3/nivea-lata.jpg`, box: [451, 3205, 120, 120], href: p("nivea-lata") },
        // Its second card shows a promotion ("Leve 3 itens por") instead of a price link: still a product card row.
        { section: 7, type: "link", text: "Desodorante Nivea", href: p("nivea-lata") },
        { section: 7, type: "span", text: "Leve 3 itens por" },
    ]
    const { sections: out, skipped } = domHomeSections({ outline, sections, viewport: 375, storeHost: PH })
    assert.deepEqual(out.map((s) => s.id), ["dom-01-container-lg"])
    assert.deepEqual(out[0].data.images[0].action, { type: "product", value: "semaclique-semaglutida" })
    assert.deepEqual(skipped, [
        { id: "dom-07-oferta-do-dia", kind: "product shelf", products: ["c-triple"] },
        { id: "dom-07-oferta-do-dia-2", kind: "product shelf", products: ["kit-nivea", "nivea-lata"] },
    ])
})

test("dom home: a screen-reader-only heading (srOnly in the outline) is not the section's title", () => {
    const PH = "https://www.drogariaspacheco.com.br"
    const outline = [
        { section: 0, type: "h2", text: "Categorias e Departamentos em Destaque", srOnly: true },
        // Each tile is a link holding its caption heading, then its image: the caption is the tile's, not the section's.
        { section: 0, type: "link", text: "Imperdíveis", href: `${PH}/busca?fq=H:24942` },
        { section: 0, type: "h3", text: "Imperdíveis" },
        { section: 0, type: "img", src: `${PH}/arquivos/imperdiveis.png`, box: [10, 150, 72, 72], href: `${PH}/busca?fq=H:24942` },
        { section: 0, type: "img", src: `${PH}/arquivos/generico.png`, box: [90, 150, 72, 72], href: `${PH}/busca?fq=H:24448` },
    ]
    const { sections } = domHomeSections({ outline, sections: [{ index: 0, name: "00-categorias", tag: "section" }], viewport: 375, storeHost: PH })
    assert.equal(sections[0].data.mainTitle, undefined)
})

// drogariaspacheco.com.br home (Nov 2026) at 375 px: the layouts a row-by-row reading broke.
const DP = "https://www.drogariaspacheco.com.br"
const tile = (section, file, href, box, extra = {}) => ({ section, type: "img", alt: "", src: `${DP}/arquivos/${file}`, box, href: `${DP}${href}`, ...extra })

test("dom home: rows of equal tiles that all fit the screen are one grid; round tiles stay round", () => {
    const brands = [
        tile(18, "dove.png", "/dove", [12, 7851, 109, 109], { round: true }),
        tile(18, "siage.png", "/busca?fq=H:1", [133, 7851, 109, 109], { round: true }),
        tile(18, "amamente.png", "/busca?fq=H:2", [254, 7851, 109, 109], { round: true }),
        tile(18, "eucerin.png", "/busca?fq=H:3", [12, 7972, 109, 109], { round: true }),
        tile(18, "vichy.png", "/busca?fq=H:4", [133, 7972, 109, 109], { round: true }),
        tile(18, "darrow.png", "/busca?fq=H:5", [254, 7972, 109, 109], { round: true }),
    ]
    const { sections } = domHomeSections({ outline: [{ section: 18, type: "h2", text: "Marcas Mais Amadas" }, ...brands], sections: [{ index: 18, name: "18-marcas-mais-amadas", tag: "section" }], viewport: 375, storeHost: DP })
    assert.equal(sections.length, 1)
    assert.deepEqual({ ...sections[0].data, images: sections[0].data.images.length }, { mode: "GridList", columns: 3, gap: 12, rounded: true, mainTitle: "Marcas Mais Amadas", images: 6 })
})

test("dom home: a row of mixed tile sizes (a mosaic) keeps each tile's box instead of one size for all", () => {
    const protena = [
        tile(10, "b1.png", "/busca?fq=H:24890", [12, 4776, 321, 146]),
        tile(10, "b2.png", "/busca?fq=H:24890", [345, 4776, 321, 146]),
        tile(10, "c1.png", "/busca?fq=H:24890", [12, 4934, 122, 180]),
        tile(10, "c2.png", "/busca?fq=H:24890", [146, 4934, 188, 82]),
        tile(10, "c3.png", "/busca?fq=H:24890", [146, 5032, 188, 82]),
        tile(10, "c4.png", "/busca?fq=H:24890", [346, 4934, 463, 180]),
    ]
    const { sections } = domHomeSections({ outline: protena, sections: [{ index: 10, name: "10-container-lg", tag: "section" }], viewport: 375, storeHost: DP })
    assert.equal(sections.length, 1)
    assert.equal(sections[0].data.mode, "Mosaic")
    assert.deepEqual(sections[0].data.images.map((i) => i.box), [[12, 0, 321, 146], [345, 0, 321, 146], [12, 158, 122, 180], [146, 158, 188, 82], [346, 158, 463, 180], [146, 256, 188, 82]])
    // Its links resolve later, like any banner's (resolveLinkActions walks data.images).
    assert.deepEqual(sections[0].data.images[0].action, { type: "path", value: "/busca?fq=H:24890" })
})

test("dom home: a scrolling row of round tiles is a RoundedBannerList at their size", () => {
    const cats = [0, 1, 2, 3, 4, 5].map((n) => tile(0, `c${n}.png`, `/busca?fq=H:${n + 10}`, [12 + n * 80, 129, 70, 70], { round: true }))
    const { sections } = domHomeSections({ outline: cats, sections: [{ index: 0, name: "00-categorias", tag: "section" }], viewport: 375, storeHost: DP })
    assert.equal(sections[0].data.mode, "RoundedBannerList")
    assert.deepEqual(sections[0].data.size, { maxWidth: 70, maxHeight: 70 })
})

test("dom home: a section with text but no linked image (benefits, a countdown) is reported, never dropped silently", () => {
    const outline = [
        { section: 3, type: "h2", text: "Benefícios", srOnly: true },
        { section: 3, type: "h3", text: "Frete Grátis" },
        { section: 3, type: "p", text: "Acima R$199" },
        { section: 3, type: "h3", text: "Entrega" },
    ]
    const { sections, skipped } = domHomeSections({ outline, sections: [{ index: 3, name: "03-beneficios", tag: "section" }], viewport: 375, storeHost: DP })
    assert.deepEqual(sections, [])
    assert.deepEqual(skipped, [{ id: "dom-03-beneficios", kind: "text block", texts: ["Frete Grátis", "Acima R$199", "Entrega"] }])
})

// The store's own widgets in the rendered capture (drogariaspacheco.com.br, Nov 2026): a StreamShop video carousel
// (a custom element) and a countdown whose end date sits in a hidden element.
const RENDERED = `<div data-sc-section="0"><a href="/busca?fq=H:25032"><img src="/nivea.png"></a>
<div class="rnk-contador-promo"><div class="d-none rnk-promo-time">12/11/2026 23:59:00</div><ul><li><p> Horas <span class="value">07</span></p></li><li><p> Minutos <span class="value">47</span></p></li><li><p> Segundos <span class="value">43</span></p></li></ul></div></div>
<div data-sc-section="6"><img src="/naldecon.png"></div>
<div class="container-lg rnk-comp-live-stories" data-sc-section="7"><liveshop-ads-carousel-v2 name="ss-ads-80da04c4" height="500px" videos-from-store="drogariaspachecovc"></liveshop-ads-carousel-v2></div>
<div data-sc-section="8"><h2>Oferta do Dia</h2></div>`

test("dom widgets: a StreamShop carousel becomes VideoStories reading its feed; a countdown its end date in the store's offset", () => {
    assert.deepEqual(domWidgets({ rendered: RENDERED, utcOffset: "-03:00", storeHost: DP }), [
        { section: 0, widget: { id: "dom-00-countdown", name: "Countdown", data: { targetDate: "2026-11-12T23:59:00-03:00" } } },
        { section: 7, widget: { id: "dom-07-video-stories", name: "VideoStories", data: { streamshop: { storeSlug: "drogariaspachecovc", tagName: "ss-ads-80da04c4", origin: `${DP}/` } } } },
    ])
    // Labels without a date are a clock with nothing to count to: no countdown.
    assert.deepEqual(domWidgets({ rendered: RENDERED.replace("12/11/2026 23:59:00", ""), utcOffset: "-03:00", storeHost: DP }).map((w) => w.widget.name), ["VideoStories"])
})

test("place widgets: each one after its section's banners, in the page's order", () => {
    const sections = ["dom-00-categorias", "dom-00-categorias-2", "dom-01-container-lg", "dom-06-patrocinados", "dom-10-container-lg"].map((id) => ({ id, name: "MultipleImageBanner", data: {} }))
    const widgets = domWidgets({ rendered: RENDERED, utcOffset: "-03:00", storeHost: DP })
    assert.deepEqual(placeWidgets(sections, widgets).map((s) => s.id), ["dom-00-categorias", "dom-00-categorias-2", "dom-00-countdown", "dom-01-container-lg", "dom-06-patrocinados", "dom-07-video-stories", "dom-10-container-lg"])
})

