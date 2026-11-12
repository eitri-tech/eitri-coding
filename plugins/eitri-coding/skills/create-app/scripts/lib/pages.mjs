// The store pages the app's screens copy, found deterministically: same inputs, same pages.
//
//   listing   the home's most repeated same-origin link (its navigation) whose page lists products, the first
//             with a sort or filter control (a PLP) before a landing page that only shows shelves
//   product   among that listing's first products, the one with the most variants in stock (first on ties):
//             a PDP with a size/color selector, not an accessory with one SKU
//
// Pure: the caller fetches the pages and product answers (detect-store.mjs).

/** Product URLs per platform (pathname). */
export const PRODUCT_PATH = {
    VTEX: /^\/[^/]+\/p\/?$/,
    SHOPIFY: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[^/]+\/?$/,
    WAKE: /^\/produto\//,
}

// Never a listing: account, checkout, help, institutional and content pages, files.
const NOT_LISTING =
    /^\/(?:$|account|conta|minha-conta|my-account|login|logout|checkout|cart|carrinho|sacola|wishlist|favoritos|institucional|atendimento|central-de-atendimento|ajuda|help|faq|fala-|politica|privacidade|privacy|termos|terms|trocas|sobre|about|blog|lojas|nossas-lojas|store-locator|maps|sitemap|api\/|_v\/|pages\/(?:contact|about)|policies\/)/i
const FILE = /\.[a-z0-9]{2,5}$/i

const hrefs = (html) => [...String(html ?? "").matchAll(/<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => (m[1] ?? m[2]).replace(/&amp;/g, "&"))

function sameOrigin(href, pageUrl) {
    try {
        const url = new URL(href, pageUrl)
        return url.origin === new URL(pageUrl).origin ? url : null
    } catch {
        return null
    }
}

/** The home's same-origin non-product links, most repeated first (navigation repeats), then in document order. */
export function listingCandidates(platform, pageUrl, html, { max = 8 } = {}) {
    const product = PRODUCT_PATH[platform]
    if (!product) return []
    const seen = new Map()
    hrefs(html).forEach((href, index) => {
        const url = sameOrigin(href, pageUrl)
        if (!url) return
        const path = url.pathname.replace(/\/+$/, "") || "/"
        if (NOT_LISTING.test(path) || FILE.test(path) || product.test(url.pathname)) return
        const entry = seen.get(path) ?? { path, count: 0, index }
        entry.count += 1
        seen.set(path, entry)
    })
    return [...seen.values()]
        .sort((a, b) => b.count - a.count || a.index - b.index)
        .slice(0, max)
        .map((e) => e.path)
}

/** The distinct product pages a page links to, in document order. */
export function productLinks(platform, pageUrl, html) {
    const product = PRODUCT_PATH[platform]
    if (!product) return []
    const out = []
    for (const href of hrefs(html)) {
        const url = sameOrigin(href, pageUrl)
        if (!url || !product.test(url.pathname)) continue
        const clean = `${url.origin}${url.pathname}`
        if (!out.includes(clean)) out.push(clean)
    }
    return out
}

/** A page lists products when it links to at least this many distinct ones. */
export const MIN_LISTING_PRODUCTS = 6

// A sort or filter control's label, as a text node (never CSS or a class name: no braces, colons or quotes).
const LISTING_CONTROL = />\s*[^<>{};:"']{0,40}?(?<![\p{L}-])(?:ordenar|ordem|relev[aâ]ncia|sort(?: by)?|filtrar|filtros?|filters?)(?![\p{L}-])[^<>{};:"']{0,20}\s*</iu

/**
 * A product listing page (category, search) has a sort or filter control; a landing page that lists
 * products in shelves has none. Both pass MIN_LISTING_PRODUCTS: this tells them apart.
 */
export function hasListingControls(html) {
    return LISTING_CONTROL.test(String(html ?? ""))
}

/** The candidate with the most variants in stock (first on ties); without stock anywhere, the most variants. */
export function pickProduct(candidates) {
    const list = (candidates ?? []).filter((c) => c && c.url)
    const inStock = list.filter((c) => c.inStock > 0)
    const pool = inStock.length ? inStock : list.filter((c) => c.variants > 0)
    const key = inStock.length ? "inStock" : "variants"
    let best
    for (const c of pool) if (!best || c[key] > best[key]) best = c
    return best
}

/** VTEX catalog answer for one product (products/search/<linkText>/p). */
export function vtexVariants(answer) {
    const items = Array.isArray(answer) && Array.isArray(answer[0]?.items) ? answer[0].items : []
    const inStock = items.filter((item) => (item?.sellers ?? []).some((s) => s?.commertialOffer?.AvailableQuantity > 0)).length
    return { variants: items.length, inStock }
}

/** Shopify product answer (/products/<handle>.js). */
export function shopifyVariants(answer) {
    const variants = Array.isArray(answer?.variants) ? answer.variants : []
    return { variants: variants.length, inStock: variants.filter((v) => v?.available).length }
}

export function vtexProductUrl(account, productUrl) {
    const linkText = new URL(productUrl).pathname.replace(/^\/|\/p\/?$/g, "")
    return `https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/products/search/${linkText}/p`
}

export function vtexPagetypeUrl(account, pageUrl) {
    const path = new URL(pageUrl).pathname.replace(/^\/+|\/+$/g, "")
    return `https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/portal/pagetype/${path}`
}

/** One product of a full-text search, to tell a real search from VTEX's FullText answer for an unknown path. */
export function vtexFullTextUrl(account, term) {
    return `https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}&_from=0&_to=0`
}

const slug = (s) =>
    String(s)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()

/** A name as VTEX's catalog paths spell it: "Família 574" → "familia-574". */
export function catalogSlug(name) {
    return slug(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
}

/**
 * What a VTEX listing lists, from the catalog's pagetype answer — for headless storefronts whose page shows it
 * neither in server data nor in filter links. Same shape as vtexBlocks landingTarget, plus `search`:
 *   { type: "collection", value, title }   Collection
 *   { type: "facets", facets, title }       Department / Category / SubCategory (category-N) and Brand (brand)
 *   { type: "search", value, title }        FullText (the template's CMS search action), when `answer.hits` — the
 *                                           products vtexFullTextUrl finds — is above 0
 *   null                                    anything else (NotFound, Product…)
 */
export function vtexListingTarget(answer) {
    if (!answer || typeof answer !== "object") return null
    const title = answer.title || answer.name || ""
    const segments = String(answer.url ?? "")
        .split("?")[0]
        .split("/")
        .slice(1)
        .filter(Boolean)
        .map((s) => slug(decodeURIComponent(s)))
    switch (answer.pageType) {
        case "Collection":
            return answer.id ? { type: "collection", value: String(answer.id), title } : null
        case "Department":
        case "Category":
        case "SubCategory":
            return segments.length ? { type: "facets", facets: segments.map((value, i) => ({ key: `category-${i + 1}`, value })), title } : null
        case "Brand":
            return segments.length ? { type: "facets", facets: [{ key: "brand", value: segments.at(-1) }], title } : null
        case "FullText":
            // VTEX's answer for any path it does not know: a search only when that search finds products.
            return answer.name && answer.hits > 0 ? { type: "search", value: String(answer.name), title } : null
        default:
            return null
    }
}
