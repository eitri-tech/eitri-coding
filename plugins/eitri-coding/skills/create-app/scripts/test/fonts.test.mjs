import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { fontCorsProblems, fontFacesFromCapture, parseFontSpec } from "../lib/fonts.mjs"

// A capture's design/fonts.json: the store's own @font-face rules as the browser saw them, plus the files it fetched.
const CAPTURE_FONTS = {
    fontFaces: [
        '@font-face { font-family: slick; font-weight: 400; src: url("/_next/static/media/slick.woff") format("woff"); }',
        '@font-face { font-family: Lufga; font-style: normal; font-weight: 400; src: url("https://cdn.example.com/fonts/LufgaRegular.ttf") format("truetype"); font-display: swap; }',
        '@font-face { font-family: "Lufga"; font-style: normal; font-weight: 700; src: url("../fonts/LufgaBold.woff2") format("woff2"); }',
        '@font-face { font-family: Lufga; font-style: italic; font-weight: 400; src: url("https://cdn.example.com/fonts/LufgaItalic.ttf"); }',
        '@font-face { font-family: Lufga; font-style: normal; font-weight: 400; src: url("https://cdn.example.com/fonts/LufgaRegular.ttf") format("truetype"); font-display: swap; }',
        "@font-face { font-family: 'Brand Sans'; font-weight: 100 900; src: url('//static.example.com/brand.woff2') format('woff2'); }",
        '@font-face { font-family: Lost; font-weight: 400; src: url("fonts/lost.woff2"); }',
    ],
    files: [{ url: "https://cdn.example.com/theme/fonts/LufgaBold.woff2", file: "assets/fonts/LufgaBold.1.woff2" }],
}
const PAGE = "https://shop.example.com/home"

test("fontFacesFromCapture keeps the store's own rules for the requested weights, with absolute URLs", () => {
    const { css, urls } = fontFacesFromCapture(CAPTURE_FONTS, [parseFontSpec("Lufga:400,700")], { pageUrl: PAGE })
    assert.equal(
        css,
        [
            "@font-face{font-family:'Lufga';font-style:normal;font-weight:400;src:url(\"https://cdn.example.com/fonts/LufgaRegular.ttf\") format(\"truetype\");font-display:swap}",
            // A path-relative url() resolves against its stylesheet, which the capture's fetched files name.
            "@font-face{font-family:'Lufga';font-style:normal;font-weight:700;src:url(\"https://cdn.example.com/theme/fonts/LufgaBold.woff2\") format(\"woff2\")}",
        ].join("\n"),
    )
    assert.deepEqual(urls, ["https://cdn.example.com/fonts/LufgaRegular.ttf", "https://cdn.example.com/theme/fonts/LufgaBold.woff2"])
})

test("fontCorsProblems flags font files a WebView could not load cross-origin", async () => {
    const seen = []
    const fetchImpl = async (url, init) => {
        seen.push(init.headers.origin)
        const headers = new Headers(url.includes("open") ? { "access-control-allow-origin": "*" } : {})
        return { ok: !url.includes("gone"), status: url.includes("gone") ? 404 : 200, headers, body: { cancel: async () => {} } }
    }
    const problems = await fontCorsProblems(["https://a/open.ttf", "https://a/closed.ttf", "https://a/gone.ttf"], { fetchImpl })
    assert.deepEqual(problems, [
        "https://a/closed.ttf: no Access-Control-Allow-Origin header, so the app cannot load it",
        "https://a/gone.ttf: answered 404",
    ])
    assert.ok(seen.every(Boolean), "asks with an Origin header")
})

test("font-faces.mjs --capture prints the store's own faces from a capture folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "fonts-capture-"))
    mkdirSync(join(dir, "design"))
    writeFileSync(join(dir, "design", "fonts.json"), JSON.stringify(CAPTURE_FONTS))
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ url: PAGE }))
    const script = join(dirname(fileURLToPath(import.meta.url)), "..", "font-faces.mjs")
    const res = spawnSync(process.execPath, [script, "Lufga:400,700", "--capture", dir, "--no-check"], { encoding: "utf8" })
    assert.equal(res.status, 0, res.stderr)
    assert.equal(res.stdout.trim().split("\n").length, 2)
    assert.match(res.stdout, /LufgaBold\.woff2/)
    const missing = spawnSync(process.execPath, [script, "Lufga:400", "Nope:400", "--capture", dir, "--no-check", "--from", join(dir, "manifest.json")], { encoding: "utf8" })
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /Nope/)
})
