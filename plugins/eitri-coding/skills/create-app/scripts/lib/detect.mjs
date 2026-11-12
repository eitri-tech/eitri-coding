// Detects a store's e-commerce platform and the facts an Eitri app needs from
// its home page HTML: account / shop domain, name, locale, currency, theme
// color and the pages to capture. Pure: the caller fetches the HTML.
// The app icon is chosen by icon.mjs (app-icon.mjs), which measures every source.

const VTEX_HOSTS = /(?:(?<=%2F)|(?<![a-z0-9%-]))([a-z0-9][a-z0-9-]*)\.(?:vtexassets\.com|vteximg\.com\.br|vtexcommercestable\.com\.br|myvtex\.com)/gi
/** Subdomains VTEX serves for every store: never an account. */
const VTEX_SHARED = new Set(["cdnfiles", "io", "www", "api", "portal", "licensemanager", "assets", "master"])

const WAKE_STORE_HOSTS = /(?:(?<=%2F)|(?<![a-z0-9%-]))([a-z0-9][a-z0-9-]*)\.fbitsstatic\.net/gi
const WAKE_SHARED = new Set(["wake-components", "static", "recursos", "cdn"])
const WAKE_PLATFORM = /(?:\bfbits\.net|\bwake\.tech)\b/gi

const SHOPIFY_SHOP = /Shopify\.shop\s*=\s*["']([a-z0-9-]+\.myshopify\.com)["']/i
const SHOPIFY_DOMAINS = /(?:(?<=%2F)|(?<![a-z0-9%-]))([a-z0-9][a-z0-9-]*\.myshopify\.com)/gi
const SHOPIFY_CDN = /cdn\.shopify\.com/gi

/** Below this score a platform guess is noise (e.g. one image hotlinked from another store). */
const MIN_SCORE = 2

function count(text, regex) {
    return (text.match(regex) ?? []).length
}

/** Occurrences per captured subdomain, most frequent first. */
function tally(text, regex, { shared = new Set(), clean = (s) => s } = {}) {
    const counts = new Map()
    for (const m of text.matchAll(regex)) {
        const name = clean(m[1].toLowerCase())
        if (shared.has(name)) continue
        counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
}

/** `<meta>` / `<link>` tags as attribute maps; attributes may be quoted or not. */
function tags(html, name) {
    const out = []
    for (const m of html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))) {
        const attrs = {}
        for (const a of m[1].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) {
            attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "")
        }
        out.push(attrs)
    }
    return out
}

function metaContent(metas, key) {
    const meta = metas.find((m) => (m.property ?? m.name ?? "").toLowerCase() === key)
    return meta?.content?.trim() || undefined
}

function fold(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

/**
 * The store name from the page title: the segment that contains the domain's
 * name ("… | Motorola Oficial" on motorola.com.br), else the first one
 * ("C&A | Moda feminina…" → "C&A").
 */
function titleName(head, pageUrl) {
    const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
    if (!raw) return undefined
    const title = decodeEntities(raw).replace(/\s+/g, " ").trim()
    const segments = title.split(/\s[|–—-]\s|:\s/).map((s) => s.trim()).filter(Boolean)
    const domainName = fold(new URL(pageUrl).hostname.replace(/^www\./, "").split(".")[0])
    return segments.find((s) => domainName.length > 2 && fold(s).replace(/[^a-z0-9]/g, "").includes(domainName)) ?? segments[0]
}

function detectVtex(text) {
    const hosts = tally(text, VTEX_HOSTS, { shared: VTEX_SHARED, clean: (s) => s.split("--").pop() })
    const hostNames = new Set(hosts.map(([name]) => name))
    const hasRuntime = text.includes("__RUNTIME__")
    // A JSON "account" is only VTEX's when the page is a VTEX IO runtime or the name is also a VTEX asset host.
    const runtimeAccount = [...text.matchAll(/"account"\s*:\s*"([a-z0-9][a-z0-9-]*)"/gi)]
        .map((m) => m[1].toLowerCase())
        .find((name) => hasRuntime || hostNames.has(name))
    const hostHits = hosts.reduce((sum, [, n]) => sum + n, 0)
    const evidence = []
    if (runtimeAccount) evidence.push(`VTEX store account "${runtimeAccount}" in the page data`)
    for (const [name, n] of hosts.slice(0, 3)) evidence.push(`${name} VTEX asset host ×${n}`)
    return { score: (runtimeAccount ? 10 : 0) + hostHits, account: runtimeAccount ?? hosts[0]?.[0], evidence }
}

function detectWake(text) {
    const hosts = tally(text, WAKE_STORE_HOSTS, { shared: WAKE_SHARED })
    const platformHits = count(text, WAKE_PLATFORM)
    const evidence = hosts.slice(0, 3).map(([name, n]) => `${name}.fbitsstatic.net ×${n}`)
    if (platformHits) evidence.push(`Wake platform scripts ×${platformHits}`)
    return { score: hosts.reduce((sum, [, n]) => sum + n, 0) + platformHits, account: hosts[0]?.[0], evidence }
}

function detectShopify(text) {
    const declared = SHOPIFY_SHOP.exec(text)?.[1]?.toLowerCase()
    const domains = tally(text, SHOPIFY_DOMAINS)
    const cdnHits = count(text, SHOPIFY_CDN)
    const evidence = []
    if (declared) evidence.push(`Shopify.shop = ${declared}`)
    if (cdnHits) evidence.push(`cdn.shopify.com ×${cdnHits}`)
    return {
        score: (declared ? 10 : 0) + domains.reduce((sum, [, n]) => sum + n, 0) + cdnHits,
        shopDomain: declared ?? domains[0]?.[0],
        evidence,
    }
}

function detectCurrency(text, platform) {
    const candidates = [
        platform === "VTEX" ? /"culture"\s*:\s*\{[^}]*"currency"\s*:\s*"([A-Z]{3})"/ : null,
        platform === "SHOPIFY" ? /Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/ : null,
        /"priceCurrency"\s*:\s*"([A-Z]{3})"/,
        /"currencyCode"\s*:\s*"([A-Z]{3})"/,
    ]
    for (const regex of candidates) {
        const hit = regex && regex.exec(text)
        if (hit) return hit[1]
    }
    return undefined
}

// Besides the home, the pages whose look the app's other screens copy (PDP, cart, account):
// a product link found on the home, and each platform's fixed cart and login paths.
const PAGE_RULES = {
    VTEX: { product: /^\/[^/]+\/p\/?$/, cart: "/checkout/#/cart", login: "/login" },
    SHOPIFY: { product: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[^/]+\/?$/, cart: "/cart", login: "/account/login" },
    WAKE: { product: /^\/produto\//, cart: "/carrinho", login: "/login" },
}

function pagesToCapture(platform, pageUrl, anchors) {
    const rules = PAGE_RULES[platform]
    if (!rules) return null
    const origin = new URL(pageUrl).origin
    let product = null
    for (const { href } of anchors) {
        if (!href) continue
        let target
        try {
            target = new URL(href, pageUrl)
        } catch {
            continue
        }
        if (target.origin === origin && rules.product.test(target.pathname)) {
            product = `${origin}${target.pathname}`
            break
        }
    }
    return { product, cart: `${origin}${rules.cart}`, login: `${origin}${rules.login}` }
}

export function detectStore({ url, html }) {
    // JSON-escaped URLs (VTEX runtime) read like plain ones.
    const text = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/")
    const head = /<head\b[\s\S]*?<\/head>/i.exec(html)?.[0] ?? html
    const metas = tags(html, "meta")
    const links = tags(html, "link")

    const vtex = detectVtex(text)
    const wake = detectWake(text)
    const shopify = detectShopify(text)
    const [platform, best] = [
        ["VTEX", vtex],
        ["WAKE", wake],
        ["SHOPIFY", shopify],
    ].sort((a, b) => b[1].score - a[1].score)[0]
    const detected = best.score >= MIN_SCORE ? platform : null

    const htmlLang = /<html\b[^>]*\slang\s*=\s*["']?([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,4})?)/i.exec(html)?.[1]
    const cultureLocale = /"culture"\s*:\s*\{[^}]*"locale"\s*:\s*"([A-Za-z-]+)"/.exec(text)?.[1]

    return {
        url,
        host: new URL(url).origin,
        platform: detected,
        evidence: detected ? best.evidence : [],
        account: detected === "VTEX" || detected === "WAKE" ? best.account : undefined,
        shopDomain: detected === "SHOPIFY" ? best.shopDomain : undefined,
        storeName: metaContent(metas, "og:site_name") ?? metaContent(metas, "application-name") ?? titleName(head, url),
        locale: htmlLang ?? cultureLocale,
        currency: detectCurrency(text, detected),
        themeColor: metaContent(metas, "theme-color"),
        pages: pagesToCapture(detected, url, tags(html, "a")),
    }
}

/** VTEX's public tenant endpoint: the account's default currency and locale, whatever the storefront. */
export function vtexTenantUrl(account) {
    return `https://${account}.vtexcommercestable.com.br/api/tenant/tenants?q=${encodeURIComponent(account)}`
}

/**
 * Fills the currency and locale a VTEX home page does not expose (FastStore and
 * legacy CMS pages carry neither) from the tenant answer. The page's own values win.
 */
export function withVtexTenant(profile, tenant) {
    if (!tenant || typeof tenant !== "object") return profile
    const binding = Array.isArray(tenant.bindings) ? tenant.bindings.find((b) => b && typeof b === "object") ?? {} : {}
    const currency = [tenant.defaultCurrency, binding.defaultCurrency].find((c) => typeof c === "string" && /^[A-Z]{3}$/.test(c))
    const locale = [tenant.defaultLocale, binding.defaultLocale].find((l) => typeof l === "string" && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,4})?$/.test(l))
    const out = { ...profile }
    if (!out.currency && currency) out.currency = currency
    if (!out.locale && locale) out.locale = locale
    return out
}

/**
 * VTEX's public default sales channel. Unlike the tenant endpoint (VTEX IO accounts
 * only: 404 elsewhere), every account answers it with its currency and culture.
 */
export function vtexSalesChannelUrl(account) {
    return `https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/saleschannel/default`
}

/** Fills the currency and locale still missing from the default sales channel. The page's own values win. */
export function withVtexSalesChannel(profile, channel) {
    if (!channel || typeof channel !== "object") return profile
    const out = { ...profile }
    if (!out.currency && typeof channel.CurrencyCode === "string" && /^[A-Z]{3}$/.test(channel.CurrencyCode)) out.currency = channel.CurrencyCode
    if (!out.locale && typeof channel.CultureInfo === "string" && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,4})?$/.test(channel.CultureInfo)) out.locale = channel.CultureInfo
    return out
}

/** VTEX's public catalog search: the account's best sellers (the most representative PDP), each with its linkText and stock. */
export function vtexProductSearchUrl(account) {
    return `https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/products/search?_from=0&_to=9&O=OrderByTopSaleDESC`
}

/**
 * A home without product links (banners and category tiles only) leaves the PDP capture
 * without a page: take one from the catalog search, in stock first, as `<host>/<linkText>/p`
 * (VTEX's product route on every storefront). A product link found on the page wins.
 */
export function withVtexProduct(profile, products) {
    if (!profile?.pages || profile.pages.product || !Array.isArray(products)) return profile
    const listed = products.filter((p) => p && typeof p.linkText === "string" && p.linkText)
    const inStock = (p) => (p.items ?? []).some((item) => (item?.sellers ?? []).some((s) => s?.commertialOffer?.AvailableQuantity > 0))
    const pick = listed.find(inStock) ?? listed[0]
    if (!pick) return profile
    const origin = new URL(profile.host ?? profile.url).origin
    return { ...profile, pages: { ...profile.pages, product: `${origin}/${encodeURIComponent(pick.linkText)}/p` } }
}
