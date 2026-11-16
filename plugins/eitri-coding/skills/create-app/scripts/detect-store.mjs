#!/usr/bin/env node
// Prints what an Eitri app needs to know about a store, as JSON:
// platform (VTEX / WAKE / SHOPIFY / null), account or shop domain, name,
// locale, currency, theme color and the pages to capture. The app icon: app-icon.mjs.
//
//   node detect-store.mjs <url>                      fetch the home page
//   node detect-store.mjs <url> --capture <dir>      use a site-clone capture (raw + rendered HTML)
//   node detect-store.mjs <url> --html <file>        use a saved page
//   ... --tenant <file>                              a saved VTEX tenant answer instead of fetching it
//   ... --sales-channel <file>                       a saved VTEX default sales channel answer
//   ... --products <file>                            a saved VTEX catalog search answer
//   ... --responses <file>                           { url: body | { status, body } } answering every request (offline)
//
// pages.listing / pages.product: the home's most repeated link that lists products, and its product with
// the most variants in stock (lib/pages.mjs) — the PLP and PDP the app's screens are compared against.
// When no candidate's server HTML links to products (headless storefronts list them client-side), the
// candidates are rendered in site-clone's Playwright (offline: --responses entries keyed `render:<url>`).
//
// VTEX pages that do not declare their currency or locale (FastStore, legacy
// CMS, headless storefronts) get them from the account's public tenant endpoint,
// or its default sales channel when the tenant answers 404 (non-IO accounts).
// A VTEX home without product links gets its product page from the catalog search.
import { fetchPublic, MOBILE_UA } from "./lib/http.mjs"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveVtexProduct, listingCandidates, productLinks, MIN_LISTING_PRODUCTS, hasListingControls, pickProduct, vtexListingTarget, vtexPagetypeUrl, vtexFullTextUrl, vtexVariants, shopifyVariants } from "./lib/pages.mjs"
import { loadChromium } from "./lib/iconRender.mjs"
import { detectStore, vtexProductSearchUrl, vtexSalesChannelUrl, vtexTenantUrl, withVtexProduct, withVtexSalesChannel, withVtexTenant } from "./lib/detect.mjs"

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
        // The raw HTML keeps server data (VTEX runtime); the rendered DOM has what scripts injected.
        html = ["page.raw.html", "page.rendered.html"]
            .map((name) => join(capture, name))
            .filter((path) => existsSync(path))
            .map((path) => readFileSync(path, "utf8"))
            .join("\n")
        if (!html) throw new Error(`No page.raw.html or page.rendered.html in ${capture}`)
    } else if (file) {
        html = readFileSync(file, "utf8")
    } else {
        const res = await fetchPublic(url, { headers: { "user-agent": MOBILE_UA, accept: "text/html" } })
        if (!res.ok) throw new Error(`${url} answered ${res.status}`)
        url = res.url
        html = await res.text()
    }
    const responses = option(args, "--responses") ? JSON.parse(readFileSync(option(args, "--responses"), "utf8")) : null
    const requests = new Map()
    const get = (target, what, saved, kind = "json") => {
        const key = JSON.stringify([target, saved, kind])
        if (!requests.has(key)) requests.set(key, getPublic(target, what, { saved, responses, kind }))
        return requests.get(key)
    }

    let profile = detectStore({ url, html })
    if (profile.platform === "VTEX" && profile.account && (!profile.currency || !profile.locale)) {
        profile = withVtexTenant(profile, await get(vtexTenantUrl(profile.account), "VTEX tenant", option(args, "--tenant")))
    }
    if (profile.platform === "VTEX" && profile.account && (!profile.currency || !profile.locale)) {
        profile = withVtexSalesChannel(profile, await get(vtexSalesChannelUrl(profile.account), "VTEX sales channel", option(args, "--sales-channel")))
        if (!profile.currency) console.error(`VTEX ${profile.account}: no currency from the page, tenant or sales channel.`)
    }
    if (profile.pages) profile = await withListingAndProduct(profile, html, get, responses)
    if (profile.platform === "VTEX" && profile.account && profile.pages && !profile.pages.product) {
        profile = withVtexProduct(profile, await get(vtexProductSearchUrl(profile.account), "VTEX catalog search", option(args, "--products")))
    }
    if (profile.platform === "VTEX" && profile.account && profile.pages?.product && !profile.pages.productId) {
        const [product] = await resolveVtexProduct(profile.account, profile.pages.product, get)
        if (product?.productId) profile.pages.productId = String(product.productId)
        if (product?.linkText) profile.pages.productSlug = product.linkText
    }
    console.log(JSON.stringify(profile, null, 2))
}

/**
 * pages.listing: the first of the home's navigation links whose page lists products; pages.product: among
 * that listing's first products, the one with the most variants in stock (lib/pages.mjs). The home's own
 * product link is kept only when no listing is found.
 */
async function withListingAndProduct(profile, homeHtml, get, responses) {
    const { platform } = profile
    const origin = profile.host
    const paths = listingCandidates(platform, profile.url, homeHtml)
    // The first candidate that lists products with a sort/filter control (a PLP); else the first that lists any.
    const firstListing = async (load) => {
        let fallback = null
        for (const path of paths) {
            const html = (await load(`${origin}${path}`)) ?? ""
            const links = productLinks(platform, `${origin}${path}`, html)
            if (links.length < MIN_LISTING_PRODUCTS) continue
            const found = { listing: `${origin}${path}`, products: links.slice(0, 6) }
            if (hasListingControls(html)) return { ...found, controls: true }
            fallback ??= found
        }
        return fallback
    }
    let found = await firstListing((target) => get(target, "listing candidate", undefined, "text"))
    if (!found?.controls && paths.length) {
        // Headless storefronts (FastStore, deco, Next.js, Hydrogen) list products client-side: their server
        // HTML links to none, or only a landing page's shelves do. The same candidates, rendered in a browser.
        const renderer = await openRenderer(responses)
        if (renderer) {
            try {
                const rendered = await firstListing((target) => renderer.html(target))
                if (rendered && (rendered.controls || !found)) found = rendered
            } finally {
                await renderer.close()
            }
        } else if (!found) console.error("The listing candidates link to no product in their server HTML, and rendering them needs Playwright (site-clone's scripts).")
    }
    if (found && !found.controls) console.error(`No listing candidate has a sort or filter control: ${found.listing} may be a landing page, not a PLP.`)
    const { listing = null, products = [] } = found ?? {}
    if (!listing) {
        console.error("No listing found among the home's links: capture a category page by hand (pages.listing).")
        return { ...profile, pages: { ...profile.pages, listing: null } }
    }
    const candidates = []
    for (const productUrl of products) {
        if (platform === "VTEX" && profile.account) {
            const answer = await resolveVtexProduct(profile.account, productUrl, get)
            candidates.push({ url: productUrl, ...vtexVariants(answer), productId: answer[0]?.productId, productSlug: answer[0]?.linkText })
        }
        else if (platform === "SHOPIFY") candidates.push({ url: productUrl, ...shopifyVariants(await get(`${productUrl}.js`, "Shopify product")) })
        else candidates.push({ url: productUrl, variants: 1, inStock: 1 })
    }
    const selected = pickProduct(candidates)
    const product = selected?.url ?? products[0] ?? profile.pages.product
    // What the listing lists, for the app to open the same products (screens.mjs) when its page cannot say.
    let listingTarget = null
    if (platform === "VTEX" && profile.account) {
        const pagetype = await get(vtexPagetypeUrl(profile.account, listing), "VTEX pagetype")
        if (pagetype?.pageType === "FullText" && pagetype.name) pagetype.hits = (await get(vtexFullTextUrl(profile.account, pagetype.name), "VTEX full-text search"))?.length ?? 0
        listingTarget = vtexListingTarget(pagetype)
    }
    return { ...profile, pages: { ...profile.pages, listing, product, ...(selected?.productId ? { productId: String(selected.productId) } : {}), ...(selected?.productSlug ? { productSlug: selected.productSlug } : {}), ...(selected?.skuId ? { skuId: selected.skuId, sellerId: selected.sellerId } : {}), ...(listingTarget ? { listingTarget } : {}) } }
}

/**
 * Renders pages in a phone-sized headless Chromium (site-clone's Playwright) and returns their DOM. Offline
 * (--responses), the `render:<url>` entries answer instead. undefined when Playwright is missing.
 */
async function openRenderer(responses) {
    if (responses) return { html: async (target) => responses[`render:${target}`] ?? null, close: async () => {} }
    const chromium = await loadChromium()
    if (!chromium) return undefined
    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true, userAgent: MOBILE_UA })
    return {
        async html(target) {
            const page = await context.newPage()
            try {
                await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 })
                await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
                return await page.content()
            } catch (err) {
                console.error(`listing candidate did not render (${target}: ${err instanceof Error ? err.message : err}).`)
                return null
            } finally {
                await page.close()
            }
        },
        close: () => browser.close(),
    }
}

/**
 * A public answer: a saved file (--tenant & co.), else the --responses map (offline: an unlisted URL is a
 * 404), else the network. null, with a note, when it fails.
 */
async function getPublic(target, what, { saved, responses, kind }) {
    if (saved) return JSON.parse(readFileSync(saved, "utf8"))
    if (responses) {
        const answer = responses[target]
        if (answer === undefined || (answer && typeof answer === "object" && "status" in answer && answer.status >= 400)) {
            console.error(`${what} answered 404 (${target}).`)
            return null
        }
        const body = answer && typeof answer === "object" && "body" in answer ? answer.body : answer
        return kind === "text" ? String(typeof body === "string" ? body : JSON.stringify(body)) : typeof body === "string" ? JSON.parse(body) : body
    }
    try {
        const res = await fetchPublic(target, {
            headers: { "user-agent": MOBILE_UA, accept: kind === "text" ? "text/html" : "application/json" },
            timeoutMs: 15_000,
        })
        if (res.ok) return kind === "text" ? await res.text() : await res.json()
        console.error(`${what} answered ${res.status} (${target}).`)
    } catch (err) {
        console.error(`${what} unreachable (${err instanceof Error ? err.message : err}).`)
    }
    return null
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
