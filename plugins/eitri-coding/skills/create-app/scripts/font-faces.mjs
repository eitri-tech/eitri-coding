#!/usr/bin/env node
// Prints @font-face rules with absolute URLs, ready for brand-theme.mjs --font-faces (Luminus v1 global CSS):
// Google Fonts families, or the store's own self-hosted faces from a site-clone capture.
//
//   node font-faces.mjs Montserrat:200,400,600,700 Outfit:400,600 [--subset latin[,latin-ext]]
//   node font-faces.mjs Lufga:400,700 --capture scrape/home     (the store's own files; families it lacks go to Google)
//   node font-faces.mjs Montserrat:400 --from saved-google.css     (offline, for tests)
// With --capture, every font file is checked for CORS (the app loads it cross-origin); --no-check skips that.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fontCorsProblems, fontFacesFromCapture, fontFacesFromGoogleCss, googleFontsCssUrl, parseFontSpec } from "./lib/fonts.mjs"

// Google only answers woff2 to a browser it recognizes.
const MODERN_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
const VALUED = ["--from", "--subset", "--capture"]

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

async function googleFaces(specs, { from, subsets }) {
    let css
    if (from) css = readFileSync(from, "utf8")
    else {
        const url = googleFontsCssUrl(specs)
        const res = await fetch(url, { headers: { "user-agent": MODERN_UA } })
        if (!res.ok) throw new Error(`${url} answered ${res.status}: is every family on Google Fonts?`)
        css = await res.text()
    }
    return fontFacesFromGoogleCss(css, { subsets })
}

async function main(args) {
    const from = option(args, "--from")
    const capture = option(args, "--capture")
    const subsets = (option(args, "--subset") ?? "latin").split(",").map((s) => s.trim())
    const specs = args.filter((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1])).map(parseFontSpec)
    if (!specs.length) throw new Error("usage: font-faces.mjs <Family:weights> … [--capture scrape/<page>] [--subset latin] [--from file]")

    const rules = []
    let google = specs
    if (capture) {
        const fonts = JSON.parse(readFileSync(join(capture, "design", "fonts.json"), "utf8"))
        const { url: pageUrl } = JSON.parse(readFileSync(join(capture, "manifest.json"), "utf8"))
        const own = fontFacesFromCapture(fonts, specs, { pageUrl })
        if (own.css) rules.push(own.css)
        google = own.missing
        if (!args.includes("--no-check")) {
            for (const problem of await fontCorsProblems(own.urls)) console.error(`warning: ${problem}`)
        }
    }
    if (google.length) {
        try {
            rules.push(await googleFaces(google, { from, subsets }))
        } catch (err) {
            if (!capture) throw err
            const names = google.map((s) => s.family).join(", ")
            throw new Error(`${names}: not among the capture's @font-face rules, and Google Fonts failed: ${err instanceof Error ? err.message : err}`)
        }
    }
    console.log(rules.join("\n"))
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
