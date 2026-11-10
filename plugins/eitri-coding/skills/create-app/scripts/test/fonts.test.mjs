import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { fontFacesFromGoogleCss, googleFontsCssUrl, parseFontSpec } from "../lib/fonts.mjs"

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
