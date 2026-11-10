#!/usr/bin/env node
// Prints what an Eitri app needs to know about a store, as JSON:
// platform (VTEX / WAKE / SHOPIFY / null), account or shop domain, name,
// locale, currency, theme color and icon candidates.
//
//   node detect-store.mjs <url>                      fetch the home page
//   node detect-store.mjs <url> --capture <dir>      use a site-clone capture (raw + rendered HTML)
//   node detect-store.mjs <url> --html <file>        use a saved page
//   ... --tenant <file>                              a saved VTEX tenant answer instead of fetching it
//
// VTEX pages that do not declare their currency or locale (FastStore, legacy
// CMS) get them from the account's public tenant endpoint.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { detectStore, vtexTenantUrl, withVtexTenant } from "./lib/detect.mjs"

const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

async function main(args) {
    let url = args[0]
    if (!url || url.startsWith("--")) {
        console.error("usage: detect-store.mjs <url> [--capture <dir> | --html <file>]")
        process.exit(2)
    }
    if (!/^https?:\/\//.test(url)) url = `https://${url}`

    let html
    const capture = option(args, "--capture")
    const file = option(args, "--html")
    if (capture) {
        // The raw HTML keeps server data (VTEX runtime); the rendered DOM has what scripts injected (icons).
        html = ["page.raw.html", "page.rendered.html"]
            .map((name) => join(capture, name))
            .filter((path) => existsSync(path))
            .map((path) => readFileSync(path, "utf8"))
            .join("\n")
        if (!html) throw new Error(`No page.raw.html or page.rendered.html in ${capture}`)
    } else if (file) {
        html = readFileSync(file, "utf8")
    } else {
        const res = await fetch(url, { headers: { "user-agent": MOBILE_UA, accept: "text/html" }, redirect: "follow" })
        if (!res.ok) throw new Error(`${url} answered ${res.status}`)
        url = res.url
        html = await res.text()
    }
    let profile = detectStore({ url, html })
    if (profile.platform === "VTEX" && profile.account && (!profile.currency || !profile.locale)) {
        profile = withVtexTenant(profile, await vtexTenant(profile.account, option(args, "--tenant")))
    }
    console.log(JSON.stringify(profile, null, 2))
}

async function vtexTenant(account, file) {
    if (file) return JSON.parse(readFileSync(file, "utf8"))
    try {
        const res = await fetch(vtexTenantUrl(account), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) })
        if (res.ok) return await res.json()
        console.error(`VTEX tenant ${account} answered ${res.status}: currency/locale stay undetected.`)
    } catch (err) {
        console.error(`VTEX tenant ${account} unreachable (${err instanceof Error ? err.message : err}): currency/locale stay undetected.`)
    }
    return null
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
