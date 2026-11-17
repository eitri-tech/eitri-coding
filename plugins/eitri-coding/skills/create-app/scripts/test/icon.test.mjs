import { test } from "node:test"
import assert from "node:assert/strict"
import { iconSources, measureImage, rankIcons } from "../lib/icon.mjs"
import { png, jpeg, gif, webp, ico, svg } from "./imageFixtures.mjs"

// A store home with every kind of icon source a store exposes, in the order
// stores usually declare them: a tiny favicon first, then the rest.
const HOME = `<!doctype html><html><head>
<link rel="icon" type="image/ico" sizes="16x16" href="/arquivos/favicon.png">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="https://cdn.loja.com/apple-touch-icon.png">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="manifest" href="/site.webmanifest">
</head><body>
<header><a href="/"><img class="store-logoImage" alt="Logo Loja" data-src="https://cdn.loja.com/logo.png" src="https://cdn.loja.com/logo.png"></a></header>
<footer><img alt="logo pagamentos" src="https://cdn.loja.com/pagamentos.png"></footer>
</body></html>`

test("iconSources lists every declared icon, the manifest, the well-known paths and the header logo", () => {
    const { manifestUrl, sources } = iconSources({ html: HOME, pageUrl: "https://www.loja.com.br/" })
    assert.equal(manifestUrl, "https://www.loja.com.br/site.webmanifest")
    const byUrl = Object.fromEntries(sources.map((s) => [s.url, s.kind]))
    assert.deepEqual(byUrl, {
        "https://www.loja.com.br/arquivos/favicon.png": "icon",
        "https://www.loja.com.br/favicon.ico": "favicon",
        "https://cdn.loja.com/apple-touch-icon.png": "apple-touch-icon",
        "https://www.loja.com.br/icon.svg": "icon",
        "https://www.loja.com.br/apple-touch-icon.png": "apple-touch-icon",
        "https://www.loja.com.br/apple-touch-icon-precomposed.png": "apple-touch-icon",
        "https://cdn.loja.com/logo.png": "logo",
    })
    assert.equal(sources.find((s) => s.kind === "logo").url, "https://cdn.loja.com/logo.png", "the first logo in the page (header), not the footer's")
})

test("measureImage reads the real size of every format, whatever the sizes attribute says", () => {
    assert.deepEqual(measureImage(png(60, 60)), { format: "png", width: 60, height: 60 })
    assert.deepEqual(measureImage(jpeg(1024, 768)), { format: "jpeg", width: 1024, height: 768 })
    assert.deepEqual(measureImage(gif(32, 32)), { format: "gif", width: 32, height: 32 })
    assert.deepEqual(measureImage(webp(300, 300)), { format: "webp", width: 300, height: 300 })
    assert.deepEqual(measureImage(svg({ viewBox: "0 0 24 24" })), { format: "svg", width: 24, height: 24, vector: true })
    assert.deepEqual(measureImage(svg({ width: "120px", height: "40" })), { format: "svg", width: 120, height: 40, vector: true })
    assert.equal(measureImage(new TextEncoder().encode("<!doctype html><html>not found</html>")), null)
})

/** A fetched candidate as app-icon.mjs builds it. */
const fetched = (url, kind, bytes, extra = {}) => ({ url, finalUrl: url, kind, image: bytes ? measureImage(bytes) : null, ...extra })

const MIXED = [
    fetched("https://loja.com/arquivos/favicon.png", "icon", png(60, 60), { declared: "16x16" }),
    fetched("https://loja.com/favicon.ico", "favicon", ico([{ bmp: [16, 16] }, { bmp: [32, 32] }])),
    fetched("https://cdn.loja.com/apple-touch-icon.png", "apple-touch-icon", png(180, 180), { declared: "180x180" }),
    fetched("https://loja.com/icons/192.png", "manifest", png(192, 192), { declared: "192x192" }),
    // Declared 512, really 256: measured, not trusted.
    fetched("https://loja.com/icons/fake-512.png", "manifest", png(256, 256), { declared: "512x512" }),
    fetched("https://loja.com/icons/512.png", "manifest", png(512, 512), { declared: "512x512" }),
    fetched("https://loja.com/apple-touch-icon-precomposed.png", "apple-touch-icon", null, { error: "text/html answer (soft 404)" }),
    fetched("https://cdn.loja.com/logo.png", "logo", png(405, 127)),
]

test("rankIcons: the manifest's real 512 px square icon wins over apple-touch, SVG-less favicons and the logo", () => {
    const { chosen, upload, ranked } = rankIcons(MIXED, { background: "#000000" })
    assert.equal(chosen.url, "https://loja.com/icons/512.png")
    assert.deepEqual(upload, { imageUrl: "https://loja.com/icons/512.png" })
    assert.equal(ranked[0].verdict, "chosen")
    const verdict = Object.fromEntries(ranked.map((r) => [r.url, r.verdict]))
    assert.equal(verdict["https://loja.com/arquivos/favicon.png"], "rejected")
    assert.equal(verdict["https://loja.com/favicon.ico"], "rejected")
    assert.equal(verdict["https://loja.com/apple-touch-icon-precomposed.png"], "rejected")
    assert.equal(verdict["https://cdn.loja.com/apple-touch-icon.png"], "fallback")
    const fake = ranked.find((r) => r.url.endsWith("fake-512.png"))
    assert.match(fake.reason, /declared 512x512.*256×256/)
    // Order: the 512 first, then the under-target squares largest first, then the logo, then the rejected.
    assert.deepEqual(ranked.slice(0, 5).map((r) => r.url.split("/").pop()), ["512.png", "fake-512.png", "192.png", "apple-touch-icon.png", "logo.png"])
})

test("rankIcons: when every square icon is too small, the wordmark logo is padded on the background color", () => {
    const onlyTiny = MIXED.filter((c) => ["icon", "favicon", "logo"].includes(c.kind))
    const { chosen, upload } = rankIcons(onlyTiny, { background: "#000000" })
    assert.equal(chosen.kind, "logo")
    assert.deepEqual(upload, { imageUrl: "https://cdn.loja.com/logo.png", background: "#000000" })
    assert.match(chosen.reason, /405×127.*centered.*#000000/)
})

test("rankIcons: a logo too small to pad without upscaling is rejected, and then nothing is chosen", () => {
    const out = rankIcons(
        [fetched("https://loja.com/favicon.ico", "favicon", ico([{ bmp: [16, 16] }])), fetched("https://loja.com/logo.png", "logo", png(120, 40))],
        { background: "#fff" },
    )
    assert.equal(out.chosen, null)
    assert.equal(out.upload, null)
    assert.match(out.ranked.find((r) => r.kind === "logo").reason, /120×40.*upscal/)
    assert.match(out.error, /No icon source/)
})
