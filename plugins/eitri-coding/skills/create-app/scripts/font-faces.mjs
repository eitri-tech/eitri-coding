#!/usr/bin/env node
// Prints @font-face rules with absolute woff2 URLs for Google Fonts families,
// ready for brand-theme.mjs --font-faces (Luminus v1 global CSS).
//
//   node font-faces.mjs Montserrat:200,400,600,700 Outfit:400,600 [--subset latin[,latin-ext]]
//   node font-faces.mjs Montserrat:400 --from saved-google.css     (offline, for tests)
import { readFileSync } from "node:fs"
import { fontFacesFromGoogleCss, googleFontsCssUrl, parseFontSpec } from "./lib/fonts.mjs"

// Google only answers woff2 to a browser it recognizes.
const MODERN_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

async function main(args) {
    const from = option(args, "--from")
    const subsets = (option(args, "--subset") ?? "latin").split(",").map((s) => s.trim())
    const specs = args.filter((a, i) => !a.startsWith("--") && !["--from", "--subset"].includes(args[i - 1])).map(parseFontSpec)
    if (!specs.length) throw new Error("usage: font-faces.mjs <Family:weights> … [--subset latin] [--from file]")

    let css
    if (from) css = readFileSync(from, "utf8")
    else {
        const url = googleFontsCssUrl(specs)
        const res = await fetch(url, { headers: { "user-agent": MODERN_UA } })
        if (!res.ok) throw new Error(`${url} answered ${res.status}: is every family on Google Fonts?`)
        css = await res.text()
    }
    console.log(fontFacesFromGoogleCss(css, { subsets }))
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
