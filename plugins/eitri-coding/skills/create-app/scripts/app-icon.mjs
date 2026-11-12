#!/usr/bin/env node
// Picks the app icon (the avatar in the Console and Eitri Play) from everything
// a store exposes, and renders it locally for the confirmation.
//
//   node app-icon.mjs <url> [--capture scrape/home | --html <file>] [--logo <url>] [--background <#rrggbb>]
//                           [--out .eitri/icon] [--no-render]
//
// Candidates: the web app manifest's icons, apple-touch-icon(-precomposed), every
// <link rel=icon> (raster and SVG), /favicon.ico (its largest frame) and the store
// logo (--logo, else the page's first "logo" image). Each one is downloaded
// (redirects followed) into <out>/candidates/ and measured from its bytes, never
// from its sizes attribute, then ranked (lib/icon.mjs). --background is the color
// the logo sits on in the store's header: a wordmark is centered on it.
//
// Prints JSON: every candidate with its real size and verdict, the chosen one,
// `upload` (the upload_application_icon arguments) and `icon` (the local preview,
// <out>/icon.png, what the MCP will upload). Exit 0 when `upload` is ready,
// 3 when the logo needs --background, 4 when no source qualifies.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { candidateFileName, iconSources, manifestSources, measureImage, rankIcons } from "./lib/icon.mjs"

const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const MAX_BYTES = 2 * 1024 * 1024
const VALUED = ["--capture", "--html", "--logo", "--background", "--out"]

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

async function get(url) {
    const res = await fetch(url, { headers: { "user-agent": MOBILE_UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) })
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { status: res.status, finalUrl: res.url || url, contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim(), bytes }
}

async function pageHtml(url, args) {
    const capture = option(args, "--capture")
    if (capture) {
        // The rendered DOM has what scripts injected (react-helmet icons, lazy logos); the raw HTML what the server sent.
        const html = ["page.rendered.html", "page.raw.html"].map((n) => join(capture, n)).filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n")
        if (!html) throw new Error(`No page.rendered.html or page.raw.html in ${capture}`)
        return html
    }
    const file = option(args, "--html")
    if (file) return readFileSync(file, "utf8")
    const res = await get(url)
    if (res.status >= 400) throw new Error(`${url} answered ${res.status}`)
    return new TextDecoder().decode(res.bytes)
}

async function fetchCandidate(source, dir, index) {
    try {
        const res = await get(source.url)
        if (res.status >= 400) return { ...source, status: res.status, error: `answered ${res.status}` }
        if (res.bytes.length > MAX_BYTES) return { ...source, status: res.status, error: "larger than 2 MB" }
        const image = measureImage(res.bytes)
        const name = candidateFileName(index, source.kind, res.finalUrl)
        const file = join(dir, name)
        writeFileSync(file, res.bytes)
        const redirected = res.finalUrl !== source.url ? { finalUrl: res.finalUrl } : {}
        if (!image) return { ...source, ...redirected, status: res.status, contentType: res.contentType, file, error: `not an image (${res.contentType || "no type"} answer${/html/.test(res.contentType) ? ": a soft 404" : ""})` }
        return { ...source, ...redirected, status: res.status, contentType: res.contentType, file, image }
    } catch (err) {
        return { ...source, error: `fetch failed: ${err instanceof Error ? err.message : err}` }
    }
}

async function main(args) {
    let url = args[0]
    if (!url || url.startsWith("--")) {
        console.error("usage: app-icon.mjs <url> [--capture <dir> | --html <file>] [--logo <url>] [--background <#rrggbb>] [--out <dir>] [--no-render]")
        process.exit(2)
    }
    if (!/^https?:\/\//.test(url)) url = `https://${url}`
    const unknown = args.slice(1).filter((a, i, all) => a.startsWith("--") && !VALUED.includes(a) && a !== "--no-render" && !VALUED.includes(all[i - 1]))
    if (unknown.length) throw new Error(`Unknown option ${unknown.join(", ")}`)
    const background = option(args, "--background")
    if (background && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(background)) throw new Error(`--background must be #rgb or #rrggbb, got ${background}`)
    const out = option(args, "--out") ?? ".eitri/icon"
    const dir = join(out, "candidates")
    mkdirSync(dir, { recursive: true })

    const html = await pageHtml(url, args)
    const { manifestUrl, sources } = iconSources({ html, pageUrl: url, logoUrl: option(args, "--logo") })
    const warnings = []
    if (manifestUrl) {
        try {
            const res = await get(manifestUrl)
            sources.unshift(...manifestSources(JSON.parse(new TextDecoder().decode(res.bytes)), res.finalUrl))
        } catch (err) {
            warnings.push(`Web app manifest ${manifestUrl} unreadable: ${err instanceof Error ? err.message : err}`)
        }
    }
    const candidates = await Promise.all(sources.map((s, i) => fetchCandidate(s, dir, i + 1)))
    const ranking = rankIcons(candidates, { background })
    const report = { target: 512, minimum: 180, ...(manifestUrl ? { manifest: manifestUrl } : { manifest: null }), ...ranking, warnings }

    if (ranking.chosen && !args.includes("--no-render") && (ranking.upload || ranking.chosen.kind !== "logo")) {
        const { renderIcon } = await import("./lib/iconRender.mjs")
        const chosen = ranking.chosen
        const rendered = await renderIcon({ bytes: readFileSync(chosen.file), image: chosen.image, mode: chosen.kind === "logo" ? "logo" : "icon", background })
        const file = join(out, "icon.png")
        writeFileSync(file, rendered.png)
        report.icon = { file, width: rendered.width, height: rendered.height, ...(rendered.logoColor ? { logoColor: rendered.logoColor, contrast: rendered.contrast } : {}) }
        if (rendered.contrast !== undefined && rendered.contrast < 2) {
            warnings.push(`The logo (${rendered.logoColor}) is barely visible on ${background} (contrast ${rendered.contrast}): use the color it sits on in the store's header.`)
        }
    }
    writeFileSync(join(out, "icon.json"), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (!ranking.chosen) process.exit(4)
    if (!ranking.upload) process.exit(3)
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
