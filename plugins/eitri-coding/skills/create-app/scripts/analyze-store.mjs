#!/usr/bin/env node
// Reads site-clone captures of a store and prints, as JSON, what the app must
// reproduce and what it will not:
//
//   integrations   third-party services (reviews, video, chat, analytics...) with their support level
//   home           the home's sections from the VTEX IO block tree, and as the template's CMS sections;
//                  without one (deco.cx, FastStore), the banners from the capture's linked images
//   productCard    the store's product card features, and `badges` (catalog highlights/specifications, colors)
//   search         VTEX: whether the store's GraphQL search narrows by facet (`legacy: true` when it does not)
//   optIn          template features the store has but must agree to (e.g. Clarity)
//   gaps           everything the app does not reproduce, for the confirmation and the handoff
//
//   node analyze-store.mjs <url> --capture scrape/home [--capture scrape/pdp ...]
//                          [--utc-offset -03:00 | --profile .eitri/profile.json] [--catalog <saved.json>] [--max-products 24]
//                          [--link-pages <saved.json>] [--pagetypes <saved.json>] [--search-probe <saved.json>]
//
// The first capture is the home. Product data for the badges comes from the store's public
// catalog API (products linked from the captures), or from --catalog. Every page a banner or countdown links
// to is fetched (or read from --link-pages: { path: html }) to open what it lists: a VTEX landing page's
// collection, not a category guessed from its path. A page whose HTML cannot say (a client-rendered listing)
// opens what VTEX's pagetype API answers for its path (with --profile of a VTEX account; or --pagetypes:
// { path: answer }); a `?q=` link opens that search. On VTEX it also checks that the store's GraphQL search
// narrows by facet (or reads --search-probe: { department, all, byFacet, byQueryMap }): a legacy one does not,
// and the app's catalog must send its facets as query/map instead.
import { fetchPublic, MOBILE_UA } from "./lib/http.mjs"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { detectIntegrations } from "./lib/integrations.mjs"
import { parseVtexBlocks, vtexPageSections, vtexProductSummary, cmsSectionsFromVtex, resolveLinkActions, linkPaths, linkQueryTarget, trackingFreePath, landingTarget, headlessFacetNames } from "./lib/vtexBlocks.mjs"
import { buildBadgeConfig } from "./lib/badges.mjs"
import { domHomeSections, domWidgets, placeWidgets } from "./lib/domHome.mjs"
import { catalogSlug, vtexFullTextUrl, vtexLegacySearch, vtexListingTarget, vtexPagetypeUrl, vtexSearchCountQuery } from "./lib/pages.mjs"

const VALUED = ["--capture", "--utc-offset", "--profile", "--catalog", "--max-products", "--link-pages", "--pagetypes", "--search-probe"]

function options(args, name) {
    return args.flatMap((arg, i) => (arg === name && args[i + 1] ? [args[i + 1]] : []))
}

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "")

/** Every "url" string anywhere in a JSON value (site-clone's network.json is an array of requests). */
function urlsIn(value, out = []) {
    if (Array.isArray(value)) value.forEach((v) => urlsIn(v, out))
    else if (value && typeof value === "object") {
        if (typeof value.url === "string") out.push(value.url)
        for (const v of Object.values(value)) if (v && typeof v === "object") urlsIn(v, out)
    }
    return out
}

function loadCapture(dir) {
    let network = []
    try {
        network = urlsIn(JSON.parse(read(join(dir, "network.json")) || "[]"))
    } catch {}
    const raw = read(join(dir, "page.raw.html"))
    const rendered = read(join(dir, "page.rendered.html"))
    const scripts = [...`${raw}\n${rendered}`.matchAll(/<(?:script|link)\b[^>]*\s(?:src|href)\s*=\s*"(https?:[^"]+)"/gi)].map((m) => m[1])
    let outline = []
    try {
        outline = JSON.parse(read(join(dir, "content", "outline.json")) || "[]")
    } catch {}
    let sections = []
    let viewport = 375
    try {
        sections = JSON.parse(read(join(dir, "layout", "sections.json")) || "{}").sections ?? []
        viewport = JSON.parse(read(join(dir, "manifest.json")) || "{}").primaryBreakpoint ?? 375
    } catch {}
    return { dir, raw, rendered, css: read(join(dir, "css", "used.css")), urls: [...network, ...scripts], outline, sections, viewport }
}

/** Custom elements (tag names with a hyphen) and whether each still held a loading skeleton when captured. */
function customElements(html) {
    const out = new Map()
    for (const m of html.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]+)\b/g)) {
        const tag = m[1]
        const after = html.slice(m.index, m.index + 600)
        const placeholder = /skeleton|aria-busy="true"|data-loading/i.test(after)
        out.set(tag, (out.get(tag) ?? false) || placeholder)
    }
    return out
}

function productLinks(captures, origin, max) {
    const paths = []
    for (const c of captures) {
        const hrefs = Array.isArray(c.outline) ? c.outline.map((o) => o?.href).filter(Boolean) : []
        for (const m of c.rendered.matchAll(/href="([^"]+\/p)"/g)) hrefs.push(m[1])
        for (const href of hrefs) {
            try {
                const url = new URL(href, origin)
                const linkText = /^\/([^/]+)\/p\/?$/.exec(url.pathname)?.[1]
                if (url.origin === origin && linkText && !paths.includes(linkText)) paths.push(linkText)
            } catch {}
        }
    }
    return paths.slice(0, max)
}

/** The catalog fields the badges need: { productId, clusterHighlights, specifications: { field: [values] } }. */
function catalogEntry(product, groups) {
    const specifications = {}
    for (const group of groups) {
        const fields = Array.isArray(product[group]) ? product[group] : []
        const values = new Set()
        for (const field of fields) {
            if (Array.isArray(product[field])) product[field].forEach((v) => values.add(v))
            else values.add(field)
        }
        if (values.size) specifications[group] = [...values]
    }
    return { productId: product.productId, clusterHighlights: product.clusterHighlights ?? {}, specifications }
}

async function fetchCatalog(origin, linkTexts, groups) {
    const out = []
    await Promise.all(
        linkTexts.map(async (linkText) => {
            try {
                const res = await fetchPublic(`${origin}/api/catalog_system/pub/products/search/${encodeURIComponent(linkText)}/p`, { timeoutMs: 15_000 })
                const [product] = res.ok ? await res.json() : []
                if (product) out.push(catalogEntry(product, groups))
            } catch {}
        }),
    )
    return out
}

/** VTEX's pagetype answer for each store path (failed ones are left out). */
async function fetchPagetypes(account, origin, paths) {
    const out = {}
    await Promise.all(
        paths.slice(0, 40).map(async (path) => {
            try {
                const res = await fetchPublic(vtexPagetypeUrl(account, new URL(path, origin).href), { timeoutMs: 15_000 })
                if (!res.ok) return
                const answer = await res.json()
                if (answer?.pageType === "FullText" && answer.name) {
                    const search = await fetchPublic(vtexFullTextUrl(account, answer.name), { timeoutMs: 15_000 })
                    answer.hits = search.ok ? ((await search.json())?.length ?? 0) : 0
                }
                out[path] = answer
            } catch {}
        }),
    )
    return out
}

/**
 * Counts a search three ways on the store's GraphQL search (what the template calls): everything, the first
 * department by facet, the same by query/map. null when the category tree or a count is unavailable.
 */
async function probeVtexSearch(account, origin) {
    try {
        const tree = await fetchPublic(`https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/1`, { timeoutMs: 15_000 })
        const departments = tree.ok ? await tree.json() : []
        const url = Array.isArray(departments) ? departments.find((d) => d?.url)?.url : null
        const department = url ? decodeURIComponent(new URL(url, origin).pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase() : ""
        if (!department) return null
        const count = async (args) => {
            const res = await fetchPublic(`${origin}/api/io/_v/private/graphql/v1`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ query: vtexSearchCountQuery(args) }),
                timeoutMs: 20_000,
            })
            const total = res.ok ? (await res.json())?.data?.productSearch?.recordsFiltered : null
            return Number.isFinite(total) ? total : null
        }
        const value = JSON.stringify(department)
        return {
            department,
            all: await count(""),
            byFacet: await count(`selectedFacets: [{ key: "category-1", value: ${value} }], `),
            byQueryMap: await count(`query: ${value}, map: "c", `),
        }
    } catch {
        return null
    }
}

/** The HTML of each store path a section links to (failed ones are left out). */
async function fetchPages(origin, paths) {
    const pages = {}
    await Promise.all(
        paths.slice(0, 40).map(async (path) => {
            try {
                const res = await fetchPublic(new URL(path, origin), { headers: { "user-agent": MOBILE_UA }, timeoutMs: 20_000 })
                if (res.ok) pages[path] = await res.text()
            } catch {}
        }),
    )
    return pages
}

const TAG_COMPONENT = /tag|selo|flag|badge|stamp/i
const WRAPPER_COMPONENT = /wrapper|render-?on-?view|container|layout/i

async function main(args) {
    let url = args[0]
    if (!url || url.startsWith("--")) {
        console.error("usage: analyze-store.mjs <url> --capture <dir> [--capture <dir> ...] [--utc-offset -03:00 | --profile <profile.json>] [--catalog <file>]")
        process.exit(2)
    }
    if (!/^https?:\/\//.test(url)) url = `https://${url}`
    const unknown = args.slice(1).filter((a, i, all) => a.startsWith("--") && !VALUED.includes(a) && !VALUED.includes(all[i - 1]))
    if (unknown.length) throw new Error(`Unknown option ${unknown.join(", ")}`)
    const origin = new URL(url).origin
    const dirs = options(args, "--capture")
    if (!dirs.length) throw new Error("Pass at least one --capture (the home first).")
    const captures = dirs.map(loadCapture)
    const warnings = []

    let utcOffset = options(args, "--utc-offset")[0]
    const profilePath = options(args, "--profile")[0]
    const profile = profilePath ? JSON.parse(read(profilePath) || "{}") : {}
    if (!utcOffset && /^pt(-BR)?$/i.test(profile.locale ?? "")) utcOffset = "-03:00"

    // Integrations
    const elements = new Map()
    for (const c of captures) for (const [tag, placeholder] of customElements(c.rendered)) elements.set(tag, (elements.get(tag) ?? false) || placeholder)
    const integrations = detectIntegrations({ urls: captures.flatMap((c) => c.urls), customElements: [...elements.keys()] }).map((integration) => {
        const tags = [...elements.entries()].filter(([tag]) => integration.evidence.includes(`<${tag}>`) || tag.startsWith(`${integration.id}-`))
        return tags.some(([, placeholder]) => placeholder) ? { ...integration, placeholder: true } : integration
    })

    // VTEX IO block tree: the home's sections and the product card
    const blocks = new Map()
    for (const c of captures) for (const [path, block] of parseVtexBlocks(c.raw)) if (!blocks.has(path)) blocks.set(path, block)
    const homeBlocks = parseVtexBlocks(captures[0].raw)
    const sections = vtexPageSections(homeBlocks, "store.home", { utcOffset })
    if (sections.some((s) => s.kind === "countdown") && !utcOffset) warnings.push("Countdown dates have no time zone: pass --utc-offset (the store's) or they read as the phone's local time.")
    let converted = cmsSectionsFromVtex(sections, { storeHost: origin })
    if (!blocks.size) {
        // No block tree (deco.cx, FastStore, legacy CMS): the home's banners from the DOM capture.
        const home = captures[0]
        converted = domHomeSections({ outline: home.outline, sections: home.sections, viewport: home.viewport, storeHost: origin })
        // The store's widgets no linked image shows: its video carousel and its countdown, where it has them.
        const widgets = domWidgets({ rendered: home.rendered, utcOffset: utcOffset ?? "-03:00", storeHost: origin })
        converted = { ...converted, sections: placeWidgets(converted.sections, widgets) }
        warnings.push(
            `The captures carry no VTEX IO block tree (not a VTEX IO store, or the raw HTML is missing): the home's ${converted.sections.length} banner section(s) come from the capture's linked images; shelves, texts and card features come from the screenshots only.`,
        )
    }
    const skipped = converted.skipped
    const linkPagesFile = options(args, "--link-pages")[0]
    // A link whose own query says what it lists (?q=, VTEX legacy fq=H:<id>) needs no fetch.
    const openPaths = linkPaths(converted.sections).filter((p) => !linkQueryTarget(p, origin))
    const pages = linkPagesFile ? JSON.parse(read(linkPagesFile)) : await fetchPages(origin, openPaths)
    // What each linked page lists when its HTML cannot say (client-rendered listings): VTEX's pagetype.
    const pagetypesFile = options(args, "--pagetypes")[0]
    // Pagetype reads the path alone: a query of tracking parameters only (utm_*, utmi_*) does not change the page.
    const plainPaths = openPaths.filter((p) => trackingFreePath(p, origin) !== null)
    const vtex = profile.platform === "VTEX" && profile.account
    const pagetypes = pagetypesFile ? JSON.parse(read(pagetypesFile)) : vtex ? await fetchPagetypes(profile.account, origin, plainPaths) : {}
    const known = Object.fromEntries(Object.entries(pagetypes).map(([path, answer]) => [path, vtexListingTarget(answer)]).filter(([, target]) => target))
    // A Next.js storefront (FastStore + deco) names its listing's facets in its own search engine's words
    // ({ key: "colecao", value: "Família 574" }): the catalog knows a collection by its name slugged (/familia-574).
    // That beats what the page's own path answers, which for a landing path is at best a full-text search.
    const named = {}
    for (const [path, html] of Object.entries(pages)) {
        if (landingTarget(html, path) !== undefined) continue
        const [facet] = headlessFacetNames(html)
        if (facet) named[path] = `/${catalogSlug(facet.value)}`
    }
    const missing = [...new Set(Object.values(named))].filter((p) => !(p in pagetypes))
    if (!pagetypesFile && vtex && missing.length) Object.assign(pagetypes, await fetchPagetypes(profile.account, origin, missing))
    for (const [path, slugPath] of Object.entries(named)) {
        const target = vtexListingTarget(pagetypes[slugPath])
        if (target && target.type !== "search" && (!known[path] || known[path].type === "search")) known[path] = target
    }
    const { sections: cmsSections, unresolved } = resolveLinkActions(converted.sections, pages, origin, known)
    if (unresolved.length) warnings.push(`Could not open or read ${unresolved.join(", ")}: those banners keep a path action, which the app resolves as a category — check them.`)
    const summary = vtexProductSummary(blocks)

    // Badges: the card's features + the catalog of products the captures show
    const groups = summary.features.find((f) => f.feature === "specificationBadges")?.groups ?? []
    const catalogFile = options(args, "--catalog")[0]
    const max = Number(options(args, "--max-products")[0] ?? 24)
    const catalog = catalogFile ? JSON.parse(read(catalogFile)) : await fetchCatalog(origin, productLinks(captures, origin, max), groups)
    const page = { html: captures.map((c) => c.rendered).join("\n"), css: captures.map((c) => c.css).join("\n") }
    const hasBadges = summary.features.some((f) => ["highlights", "specificationBadges"].includes(f.feature)) || summary.highlights
    const badges = hasBadges ? buildBadgeConfig({ summary, catalog, ...page }) : null

    // Search: a legacy GraphQL search ignores the app's facets; the app must send them as query/map instead.
    const probeFile = options(args, "--search-probe")[0]
    const probe = probeFile ? JSON.parse(read(probeFile)) : vtex ? await probeVtexSearch(profile.account, origin) : null
    const search = probe ? { ...probe, legacy: vtexLegacySearch(probe) } : null
    if (search?.legacy) {
        warnings.push(
            `The store's GraphQL search ignores selectedFacets (legacy catalog resolver: "${search.department}" by facet counts ${search.all} products, the whole catalog; by query/map ${search.byQueryMap}): the app's catalog must send its facets as query/map, and its filters read the legacy facet lists (category, brand, specifications; no price ranges).`,
        )
    } else if (vtex && !search) warnings.push("Could not check whether the store's GraphQL search narrows by facet: open a category in the app and check it lists that category.")
    const optIn = integrations.filter((i) => i.support === "config").map((i) => ({ id: i.id, ...(i.remoteConfig ? { remoteConfig: i.remoteConfig } : { config: i.config }), note: i.note }))

    // Gaps: everything the app will not reproduce
    const gaps = []
    for (const i of integrations) {
        if (i.support === "none") gaps.push({ area: "integration", item: i.name, detail: i.note + (i.placeholder ? " (it was still loading when captured: its content is not in the capture)" : "") })
        if (i.support === "native") gaps.push({ area: "native build", item: i.name, detail: i.note })
    }
    for (const s of skipped) {
        if (s.products) gaps.push({ area: "home", item: s.kind, detail: `${s.id}: rebuild it as a ProductShelf by hand (the store's query is not in the page) — it shows ${s.products.join(", ")}` })
        else if (s.links) gaps.push({ area: "home", item: s.kind, detail: `${s.id}: ${s.links.join(", ")} (the app is already installed)` })
        else if (s.texts) gaps.push({ area: "home", item: s.kind, detail: `${s.id}: "${s.texts.join(" · ")}" — no app section reads it: rebuild it by hand (an icon list, a note…) from the capture` })
        else gaps.push({ area: "home", item: s.kind === "unsupported" ? `store component ${s.components.join(", ")}` : s.kind, detail: `block ${s.id}${s.title ? ` ("${s.title}")` : ""}` })
    }
    const reviewsFound = integrations.some((i) => i.category === "reviews" && i.support === "rebuild")
    for (const f of summary.features) {
        if (f.supported === false) gaps.push({ area: "product card", item: f.feature, detail: `the store shows it (${f.component}); the app's card does not` })
        if (f.supported === "with a reviews provider" && !reviewsFound) gaps.push({ area: "product card", item: "rating", detail: "the store shows ratings but no supported reviews provider was detected" })
    }
    const explained = (c) => (TAG_COMPONENT.test(c.split("/").pop()) && hasBadges) || WRAPPER_COMPONENT.test(c.split("/").pop())
    const review = summary.customComponents.filter((c) => !explained(c))
    if (review.length) gaps.push({ area: "product card", item: "store components to check", detail: review.join(", ") })
    for (const u of badges?.unresolved ?? []) gaps.push({ area: "badges", item: u.badge, detail: u.why })

    const report = {
        url: origin,
        integrations,
        home: { sections, cmsSections, skipped },
        productCard: badges ? { ...summary, badges: badges.config } : summary,
        search,
        optIn,
        gaps,
        warnings,
    }
    console.log(JSON.stringify(report, null, 2))
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
