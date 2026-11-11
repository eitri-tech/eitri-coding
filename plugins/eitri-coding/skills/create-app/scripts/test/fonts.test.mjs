import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { fontCorsProblems, fontFacesFromCapture, fontFacesFromGoogleCss, googleFontsCssUrl, parseFontSpec } from "../lib/fonts.mjs"

// The shape fonts.googleapis.com/css2 answers a woff2-capable browser: one block per subset.
const GOOGLE_CSS = `/* latin-ext */
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/montserrat/v31/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/montserrat/v31/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
/* latin */
@font-face {
  font-family: 'Outfit';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/outfit/v15/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`

test("parseFontSpec reads a family and its weights", () => {
    assert.deepEqual(parseFontSpec("Montserrat:200,400,700"), { family: "Montserrat", weights: [200, 400, 700] })
    assert.deepEqual(parseFontSpec("Open Sans"), { family: "Open Sans", weights: [400] })
    assert.throws(() => parseFontSpec("Montserrat:bold"), /weight/)
})

test("googleFontsCssUrl asks css2 for every family with sorted weights", () => {
    assert.equal(
        googleFontsCssUrl([parseFontSpec("Open Sans:700,400"), parseFontSpec("Outfit:600")]),
        "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Outfit:wght@600&display=swap",
    )
})

test("fontFacesFromGoogleCss keeps the requested subsets as absolute-URL @font-face rules", () => {
    assert.equal(
        fontFacesFromGoogleCss(GOOGLE_CSS),
        [
            "@font-face{font-family:'Montserrat';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/montserrat/v31/latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131}",
            "@font-face{font-family:'Outfit';font-style:normal;font-weight:600;font-display:swap;src:url(https://fonts.gstatic.com/s/outfit/v15/latin.woff2) format('woff2');unicode-range:U+0000-00FF}",
        ].join("\n"),
    )
    assert.equal(fontFacesFromGoogleCss(GOOGLE_CSS, { subsets: ["latin-ext"] }).split("\n").length, 1)
    assert.throws(() => fontFacesFromGoogleCss("body{}"), /no @font-face/)
})

test("font-faces.mjs prints the rules from a saved Google response", () => {
    const dir = mkdtempSync(join(tmpdir(), "fonts-"))
    writeFileSync(join(dir, "google.css"), GOOGLE_CSS)
    const script = join(dirname(fileURLToPath(import.meta.url)), "..", "font-faces.mjs")
    const res = spawnSync(process.execPath, [script, "Montserrat:400", "Outfit:600", "--from", join(dir, "google.css")], { encoding: "utf8" })
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /^@font-face\{font-family:'Montserrat'.*latin\.woff2/m)
    assert.match(res.stdout, /^@font-face\{font-family:'Outfit'/m)
    assert.doesNotMatch(res.stdout, /ext\.woff2/)
})

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

test("fontFacesFromCapture resolves root- and protocol-relative URLs and matches variable weight ranges", () => {
    assert.match(fontFacesFromCapture(CAPTURE_FONTS, [parseFontSpec("slick")], { pageUrl: PAGE }).css, /url\("https:\/\/shop\.example\.com\/_next\/static\/media\/slick\.woff"\)/)
    const variable = fontFacesFromCapture(CAPTURE_FONTS, [parseFontSpec("Brand Sans:400,700")], { pageUrl: PAGE })
    assert.equal(variable.css.split("\n").length, 1, "one variable face covers both weights")
    assert.match(variable.css, /font-family:'Brand Sans'.*url\('https:\/\/static\.example\.com\/brand\.woff2'\)/)
})

test("fontFacesFromCapture names what it cannot serve instead of guessing", () => {
    assert.throws(() => fontFacesFromCapture(CAPTURE_FONTS, [parseFontSpec("Lufga:300")], { pageUrl: PAGE }), /Lufga 300.*400, 700/)
    assert.throws(() => fontFacesFromCapture(CAPTURE_FONTS, [parseFontSpec("Lost")], { pageUrl: PAGE }), /fonts\/lost\.woff2.*relative/)
    assert.equal(fontFacesFromCapture(CAPTURE_FONTS, [parseFontSpec("Nope")], { pageUrl: PAGE }).missing.length, 1)
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
