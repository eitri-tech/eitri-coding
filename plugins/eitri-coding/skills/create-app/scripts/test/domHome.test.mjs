import { test } from "node:test"
import assert from "node:assert/strict"
import { domHomeSections, domWidgets } from "../lib/domHome.mjs"

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

// drogariaspacheco.com.br (legacy VTEX CMS, Nov 2026): the "Oferta do Dia" box is one product card (its image, its
// name and its prices all link to the product), "Ofertas em Destaque" two; the hero slide opening a product is a banner.
// drogariaspacheco.com.br home (Nov 2026) at 375 px: the layouts a row-by-row reading broke.
const DP = "https://www.drogariaspacheco.com.br"
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

