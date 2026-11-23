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
// 3 when the logo needs --background, 4 when no source qualifies (including a logo
// whose margins hide a mark too small to fill the minimum without upscaling).
// --out keeps a second icon apart (e.g. .eitri/org-icon for an organization of another brand).
import { fetchPublic, MOBILE_UA } from "./lib/http.mjs"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { TARGET_SIDE, MIN_SIDE, candidateFileName, iconSources, manifestSources, measureImage, rankIcons } from "./lib/icon.mjs"

const MAX_BYTES = 2 * 1024 * 1024
const VALUED = ["--capture", "--html", "--logo", "--background", "--out"]

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

async function get(url) {
    const res = await fetchPublic(url, { headers: { "user-agent": MOBILE_UA }, maxBytes: MAX_BYTES })
    const bytes = res.bytes
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
        const image = measureImage(res.bytes)
        const redirected = res.finalUrl !== source.url ? { finalUrl: res.finalUrl } : {}
        // Only images are kept for inspection: a soft 404 answers with the store's HTML page.
        if (!image) return { ...source, ...redirected, status: res.status, contentType: res.contentType, error: `not an image (${res.contentType || "no type"} answer${/html/.test(res.contentType) ? ": a soft 404" : ""})` }
        const file = join(dir, candidateFileName(index, source.kind, res.finalUrl))
        writeFileSync(file, res.bytes)
        return { ...source, ...redirected, status: res.status, contentType: res.contentType, file, image }
    } catch (err) {
        return { ...source, error: `fetch failed: ${err instanceof Error ? err.message : err}` }
    }
}

async function main(args) {
    let url = args[0]
    if (!url || url.startsWith("--")) {
        console.error("usage: app-icon.mjs <url> [--capture <dir> | --html <file>] [--logo <url>] [--background <#rrggbb>] [--out <dir>] [--no-render]")
        process.exitCode = 2
        return
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
    const report = { target: TARGET_SIDE, minimum: MIN_SIDE, ...(manifestUrl ? { manifest: manifestUrl } : { manifest: null }), ...ranking, warnings }

    if (ranking.chosen && !args.includes("--no-render") && (ranking.upload || ranking.chosen.kind !== "logo")) {
        const { renderIcon } = await import("./lib/iconRender.mjs")
        const chosen = ranking.chosen
        let rendered
        try {
            rendered = await renderIcon({ bytes: readFileSync(chosen.file), image: chosen.image, mode: chosen.kind === "logo" ? "logo" : "icon", background })
        } catch (err) {
            // Ranked on its full size, the logo is trimmed to render: its mark alone may be too small.
            if (chosen.kind !== "logo" || !/upscaling/.test(String(err?.message))) throw err
            Object.assign(report, { chosen: null, upload: null, error: `${err.message} No icon: set it by hand.` })
            writeFileSync(join(out, "icon.json"), JSON.stringify(report, null, 2))
            console.log(JSON.stringify(report, null, 2))
            process.exitCode = 4
            return
        }
        const file = join(out, "icon.png")
        writeFileSync(file, rendered.png)
        report.icon = { file, width: rendered.width, height: rendered.height, ...(rendered.logoColor ? { logoColor: rendered.logoColor, contrast: rendered.contrast } : {}) }
        if (rendered.contrast !== undefined && rendered.contrast < 2) {
            warnings.push(`The logo (${rendered.logoColor}) is barely visible on ${background} (contrast ${rendered.contrast}): use the color it sits on in the store's header.`)
        }
    }
    writeFileSync(join(out, "icon.json"), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    // exitCode, not exit(): exiting with fetch's keep-alive sockets still open aborts Node on Windows.
    if (!ranking.chosen) process.exitCode = 4
    else if (!ranking.upload) process.exitCode = 3
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
})
