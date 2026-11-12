// Reads the block tree VTEX IO server-renders into every storefront page
// (window.__RUNTIME__ extensions: one entry per block, keyed by its tree path)
// and turns it into what an app rebuild needs: the page's sections in render
// order with their real settings (banner images and links, shelf collections
// and sort, countdown dates, tab labels), the product card's features, and
// those sections as the Eitri VTEX template's CMS sections. Pure.

/** Parses the JSON object that starts at `start` (string-aware brace matching). */
function objectAt(text, start) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
        const c = text[i]
        if (inString) {
            if (escaped) escaped = false
            else if (c === "\\") escaped = true
            else if (c === '"') inString = false
        } else if (c === '"') inString = true
        else if (c === "{") depth++
        else if (c === "}" && --depth === 0) {
            try {
                return JSON.parse(text.slice(start, i + 1))
            } catch {
                return undefined
            }
        }
    }
    return undefined
}

/**
 * Every block entry of the page: path → { path, id, component, data (props overlaid
 * with the site editor's content), children (paths, render order) }.
 */
export function parseVtexBlocks(html) {
    const text = html.replace(/\\u002F/gi, "/")
    const blocks = new Map()
    for (const m of text.matchAll(/"(store\.[^"]+)":\{"before":/g)) {
        const path = m[1]
        if (blocks.has(path)) continue
        const entry = objectAt(text, m.index + m[0].length - '{"before":'.length)
        if (!entry || typeof entry.component !== "string") continue
        blocks.set(path, {
            path,
            id: path.split("/").pop(),
            component: entry.component,
            data: { ...(entry.props ?? {}), ...(entry.content ?? {}) },
            childIds: (entry.blocks ?? []).map((b) => b.extensionPointId).filter(Boolean),
        })
    }
    for (const block of blocks.values()) {
        block.children = block.childIds.map((id) => `${block.path}/${id}`).filter((p) => blocks.has(p))
    }
    return blocks
}

const VTEX_SORT = {
    OrderByTopSaleDESC: "orders:desc",
    OrderByReleaseDateDESC: "release:desc",
    OrderByBestDiscountDESC: "discount:desc",
    OrderByPriceASC: "price:asc",
    OrderByPriceDESC: "price:desc",
    OrderByNameASC: "name:asc",
    OrderByNameDESC: "name:desc",
    OrderByScoreDESC: "score:desc",
}

const is = {
    imageList: (c) => /store-image@[^/]*\/ImageList|\/ImageList$/.test(c),
    image: (c) => /\/Image$/.test(c),
    productList: (c, id = "") => /\/(?:ProductList|ProductSummaryList)$/.test(c) || id.startsWith("list-context.product-list"),
    productSummary: (c) => /\/ProductSummary/.test(c),
    tabLayout: (c) => /\/TabLayout$/.test(c),
    tabListItem: (c) => /\/TabListItem$/.test(c),
    tabContentItem: (c) => /\/TabContentItem$/.test(c),
    countdown: (c) => /count-?down/i.test(c),
    richText: (c) => /rich-text@/.test(c),
    video: (c) => /store-video@|\/Video$/.test(c),
    newsletter: (c) => /newsletter/i.test(c),
    // Page chrome with no app section: skipped silently.
    chrome: (c) => /\/(?:BackToTopButton|StoreLink|Breadcrumb|LoginContent|CookieFirstTime)$/.test(c),
    desktopOnly: (c) => /\/DesktopLayout$/.test(c),
    // Structure only: walked through, never a section by itself.
    layout: (c) =>
        /flex-layout@|slider-layout@|stack-layout@|toggle-layout@|responsive-layout@|render-runtime@|condition-layout@|store@[^/]*\/(?:Container|Fold)|disclosure-layout@|modal-layout@|\/TabList$|\/TabContent$|custom-background/i.test(
            c,
        ) || /^vtex\.(?:store-components@[^/]*\/(?:Container|SearchBar)|back-to-top-button)/.test(c),
}

/** Plain text from a VTEX rich-text value (markdown). */
function plain(markdown) {
    return String(markdown ?? "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`>#]+/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/[ \t]+/g, " ")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
}

function descendants(blocks, path) {
    const out = []
    const walk = (p) => {
        const block = blocks.get(p)
        if (!block) return
        out.push(block)
        block.children.forEach(walk)
    }
    walk(path)
    return out
}

const hidden = (block) => block.data.renderChildren === false || block.data.blockClass === "hide" || is.desktopOnly(block.component)

function shelfFrom(list) {
    const d = list.data
    const shelf = {}
    if (d.collection) shelf.collection = String(d.collection)
    if (d.category) shelf.category = String(d.category)
    const sort = VTEX_SORT[d.orderBy]
    if (sort) shelf.sort = sort
    if (Number(d.maxItems) > 0) shelf.maxItems = Number(d.maxItems)
    return shelf
}

function isoDate({ year, month, day, hour = 0, minute = 0, second = 0 } = {}, utcOffset) {
    if (!year || !month || !day) return undefined
    const pad = (n) => String(Number(n) || 0).padStart(2, "0")
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${utcOffset ?? ""}`
}

/**
 * The page's sections in render order (mobile layout), each { kind, id, ... }:
 * banners, countdown, tabbedShelf, shelf, video, text, newsletter, unsupported.
 * `utcOffset` ("-03:00") is the store's time zone for countdown dates.
 */
export function vtexPageSections(blocks, page = "store.home", { utcOffset } = {}) {
    const root = blocks.get(page)
    if (!root) return []
    const sections = []
    let pendingText = null

    const take = (section) => {
        // A heading right before a shelf or banner is its title (VTEX lays them out as siblings).
        const sameBlock = pendingText?.section.id === section.id
        if (pendingText && sameBlock && ["shelf", "tabbedShelf", "banners", "newsletter", "video"].includes(section.kind) && !section.title) {
            section.title = pendingText.lines[0]
            if (pendingText.lines[1] && !section.subtitle) section.subtitle = pendingText.lines.slice(1).join(" ")
            pendingText = null
        }
        if (pendingText) sections.push(pendingText.section)
        pendingText = null
        sections.push(section)
    }

    const visit = (path, topId) => {
        const block = blocks.get(path)
        if (!block || hidden(block)) return
        const c = block.component
        const all = descendants(blocks, path)
        if (is.chrome(c)) return
        if (all.some((b) => is.countdown(b.component)) && !is.productList(c, block.id)) {
            const counter = all.find((b) => is.countdown(b.component))
            const image = all.find((b) => is.image(b.component) && b.data.src)
            const title = all.filter((b) => is.richText(b.component)).flatMap((b) => plain(b.data.text))[0]
            const section = { kind: "countdown", id: topId, targetDate: isoDate(counter.data.targetDate, utcOffset) }
            if (title) section.title = title
            if (image) {
                section.image = image.data.src
                if (image.data.link?.url) section.link = image.data.link.url
            }
            return take(section)
        }
        if (is.tabLayout(c)) {
            const labels = all.filter((b) => is.tabListItem(b.component))
            const tabs = labels.map((item) => {
                const content = all.find((b) => is.tabContentItem(b.component) && b.data.tabId === item.data.tabId)
                const list = content && descendants(blocks, content.path).find((b) => is.productList(b.component, b.id))
                return { label: item.data.label ?? item.data.text ?? "", ...(list ? shelfFrom(list) : {}) }
            })
            const heading = all.filter((b) => is.richText(b.component)).flatMap((b) => plain(b.data.text))
            const section = { kind: "tabbedShelf", id: topId, tabs }
            if (heading[0]) section.title = heading[0]
            if (heading[1]) section.subtitle = heading.slice(1).join(" ")
            return take(section)
        }
        if (is.productList(c, block.id)) return take({ kind: "shelf", id: topId, ...shelfFrom(block) })
        if (is.imageList(c)) {
            const images = (Array.isArray(block.data.images) ? block.data.images : [])
                .map((img) => {
                    const image = img?.mobileImage || img?.image
                    if (!image) return null
                    const out = { image }
                    const link = typeof img.link === "string" ? img.link : img.link?.url
                    if (link) out.link = link
                    if (img.description) out.alt = img.description
                    return out
                })
                .filter(Boolean)
            return take({ kind: "banners", id: topId, images })
        }
        if (is.image(c) && block.data.src) {
            const image = { image: block.data.src }
            if (block.data.link?.url) image.link = block.data.link.url
            return take({ kind: "banners", id: topId, images: [image] })
        }
        if (is.video(c)) return take({ kind: "video", id: topId, src: block.data.src })
        if (is.newsletter(c)) return take({ kind: "newsletter", id: topId })
        if (is.productSummary(c)) return
        if (is.richText(c)) {
            const lines = plain(block.data.text)
            if (!lines.length) return
            // Consecutive rich texts of one block (a title, then a subtitle) read as one heading.
            if (pendingText && pendingText.section.id === topId) {
                pendingText.lines.push(...lines)
                pendingText.section.text = pendingText.lines.join("\n")
                return
            }
            if (pendingText) sections.push(pendingText.section)
            pendingText = { lines, section: { kind: "text", id: topId, text: lines.join("\n") } }
            return
        }
        if (is.layout(c) || block.children.length) {
            for (const child of block.children) visit(child, topId)
            return
        }
        take({ kind: "unsupported", id: topId, components: [c] })
    }

    for (const child of root.children) visit(child, blocks.get(child).id)
    if (pendingText) sections.push(pendingText.section)
    // One "unsupported" entry per top-level block; a text repeated in a row (e.g. a "see more" disclosure) once.
    return sections.reduce((acc, s) => {
        const last = acc.at(-1)
        if (s.kind === "unsupported" && last?.kind === "unsupported" && last.id === s.id) last.components.push(...s.components)
        else if (s.kind === "text" && acc.some((t) => t.kind === "text" && t.text === s.text)) return acc
        else acc.push(s)
        return acc
    }, [])
}

/** Product-card features the store shows, and whether the app's card covers them. */
const SUMMARY_FEATURES = [
    { feature: "specificationBadges", match: /product-specification-badges/, supported: true },
    { feature: "highlights", match: /product-highlights/, supported: true },
    { feature: "discount", match: /Savings|price-savings|ListPrice/i, supported: true },
    { feature: "wishlist", match: /wish-?list|add-to-list|bookmark/i, supported: true },
    { feature: "rating", match: /star|rating|review|opinion/i, supported: "with a reviews provider" },
    { feature: "similars", match: /similar/i, supported: false },
    { feature: "installments", match: /installments/i, supported: true },
    { feature: "addToCart", match: /buy-?button|add-to-cart|AddToCart/i, supported: true },
]

export function vtexProductSummary(blocks) {
    const summary = [...blocks.values()].find((b) => is.productSummary(b.component))
    const features = []
    const customComponents = []
    for (const block of summary ? descendants(blocks, summary.path).slice(1) : []) {
        const known = SUMMARY_FEATURES.find((f) => f.match.test(block.component) || f.match.test(block.id))
        if (known) {
            if (features.some((f) => f.feature === known.feature)) continue
            const feature = { feature: known.feature, supported: known.supported, component: block.component }
            if (known.feature === "specificationBadges") {
                feature.groups = [block.data.specificationGroupName].filter(Boolean)
                feature.names = [
                    ...new Set([block.data.specificationName, ...(block.data.specificationsOptions ?? []).map((o) => o?.specificationName)].filter(Boolean)),
                ]
            }
            features.push(feature)
        } else if (!/^vtex\./.test(block.component) && !is.layout(block.component) && !customComponents.includes(block.component)) {
            customComponents.push(block.component)
        }
    }
    const result = { features, customComponents }
    // Highlights the native component shows or hides (a hidden one is often drawn by a custom tag instead).
    const show = new Set()
    const hide = new Set()
    for (const b of blocks.values()) {
        const filter = /product-highlights/.test(b.component) ? b.data.filter : null
        if (!filter || !Array.isArray(filter.highlightNames)) continue
        for (const name of filter.highlightNames) (filter.type === "hide" ? hide : show).add(name)
    }
    if (show.size || hide.size) result.highlights = { show: [...show], hide: [...hide] }
    return result
}

/** A captured link → the template's CMS action (ResolveCmsActions). */
export function actionFromLink(link, storeHost) {
    if (!link) return undefined
    let url
    try {
        url = new URL(link, storeHost ?? "https://store.invalid")
    } catch {
        return undefined
    }
    const sameStore = !storeHost || url.origin === new URL(storeHost).origin || url.origin === "https://store.invalid"
    if (!sameStore) return { type: "link", value: url.href }
    const product = /^\/([^/]+)\/p\/?$/.exec(url.pathname)
    if (product) return { type: "product", value: product[1] }
    return { type: "path", value: `${url.pathname}${url.search}` }
}

/**
 * The sections as the VTEX template's CMS sections ({ name, data }) and the ones
 * the app has no section for (`skipped`, each with its kind and id).
 */
export function cmsSectionsFromVtex(sections, { storeHost } = {}) {
    const out = []
    const skipped = []
    const facetsOf = (s) => [
        ...(s.collection ? [{ key: "productClusterIds", value: s.collection }] : []),
        ...(s.category ? [{ key: "category-1", value: s.category }] : []),
    ]
    for (const s of sections) {
        if (s.kind === "banners" && s.images?.length) {
            const data = {
                mode: s.images.length > 1 ? "SliderHero" : "SingleBanner",
                images: s.images.map((img) => {
                    const image = { imageUrl: img.image }
                    const action = actionFromLink(img.link, storeHost)
                    if (action) image.action = action
                    return image
                }),
            }
            if (s.title) data.mainTitle = s.title
            if (s.subtitle) data.subtitle = s.subtitle
            out.push({ id: s.id, name: "MultipleImageBanner", data })
        } else if (s.kind === "shelf" && (s.collection || s.category)) {
            const data = {}
            if (s.title) data.title = s.title
            if (s.subtitle) data.subtitle = s.subtitle
            data.facets = facetsOf(s)
            if (s.sort) data.sort = s.sort
            data.numberOfItems = s.maxItems ?? 8
            data.mode = "scroll"
            out.push({ id: s.id, name: "ProductShelf", data })
        } else if (s.kind === "tabbedShelf" && s.tabs?.length) {
            out.push({
                id: s.id,
                name: "TabbedProductShelf",
                data: {
                    ...(s.title ? { title: s.title } : {}),
                    ...(s.subtitle ? { subtitle: s.subtitle } : {}),
                    tabs: s.tabs.map((t) => ({ label: t.label, facets: facetsOf(t), ...(t.sort ? { sort: t.sort } : {}), numberOfItems: t.maxItems ?? 8 })),
                },
            })
        } else if (s.kind === "countdown" && s.targetDate) {
            const data = { targetDate: s.targetDate }
            if (s.title) data.title = s.title
            if (s.image) data.imageUrl = s.image
            const action = actionFromLink(s.link, storeHost)
            if (action) data.action = action
            out.push({ id: s.id, name: "Countdown", data })
        } else if (s.kind === "text" && s.text) {
            const blocks = s.text.split("\n").map((text, i) => ({ key: `${s.id}-${i}`, type: "unstyled", depth: 0, text, inlineStyleRanges: [], entityRanges: [] }))
            out.push({ id: s.id, name: "RichText", data: { content: JSON.stringify({ blocks, entityMap: {} }) } })
        } else {
            skipped.push(s)
        }
    }
    // One VTEX block can yield several sections (a banner and a text): ids are React keys, so they must differ.
    const seen = new Map()
    for (const section of out) {
        const n = (seen.get(section.id) ?? 0) + 1
        seen.set(section.id, n)
        if (n > 1) section.id = `${section.id}-${n}`
    }
    return { sections: out, skipped }
}

const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/**
 * A headless VTEX storefront (deco.cx, FastStore) renders no runtime to read, but its listing's filter
 * links (`<path>?filter.<key>=<value>&…`) all repeat the page's base selection. The facets every one of
 * the page's own filter links shares are that selection: a collection (with any other base facets), or
 * the facets alone. Fewer than two filter links, or none shared: undefined.
 */
function headlessListing(text, path) {
    if (!path) return undefined
    const own = new URL(path, "https://store.invalid").pathname.replace(/\/$/, "")
    const sets = []
    for (const m of text.matchAll(/<a\b[^>]*\shref="([^"]*\bfilter\.[^"]*)"/g)) {
        let url
        try {
            url = new URL(decodeEntities(m[1]), "https://store.invalid")
        } catch {
            continue
        }
        if (url.pathname.replace(/\/$/, "") !== own) continue
        sets.push([...url.searchParams].filter(([k]) => k.startsWith("filter.")).map(([k, v]) => `${k.slice(7)}=${v}`))
    }
    if (sets.length < 2) return undefined
    const shared = sets[0].filter((f) => sets.every((set) => set.includes(f)))
    if (!shared.length) return undefined
    const facets = [...new Set(shared)].map((f) => {
        const i = f.indexOf("=")
        return { key: f.slice(0, i), value: f.slice(i + 1) }
    })
    const h1 = /<h1\b[^>]*>([^<]*)/i.exec(text)?.[1]?.trim()
    const title = decodeEntities(h1 || /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() || "")
    const collection = facets.find((f) => f.key === "productClusterIds")
    const rest = facets.filter((f) => f !== collection)
    const target = collection ? { type: "collection", value: collection.value, ...(rest.length ? { facets: rest } : {}) } : { type: "facets", facets: rest }
    if (title) target.title = title
    return target
}

/** A Next.js page's React Server Components payload rides in escaped strings (self.__next_f.push): unescape quotes. */
const unescapeRsc = (text) => text.replace(/\\+"/g, '"')

/**
 * The base facets a Next.js storefront (FastStore + deco) names in its server payload for a listing page —
 * `baseFacets` or a listing's `apiSettings.selectedFacets`, e.g. [{ key: "colecao", value: "Família 574" }]. They are
 * the storefront's own search engine's names, not VTEX facets: the caller resolves each value with VTEX's pagetype
 * (a collection's name slugged is its catalog path). None: [].
 */
export function headlessFacetNames(html) {
    const text = unescapeRsc(String(html ?? ""))
    const out = new Map()
    for (const m of text.matchAll(/"(?:baseFacets|selectedFacets)":(\[[^\[\]]*\])/g)) {
        try {
            for (const f of JSON.parse(m[1])) if (f && typeof f.key === "string" && typeof f.value === "string") out.set(`${f.key}=${f.value}`, { key: f.key, value: f.value })
        } catch {}
    }
    return [...out.values()]
}

/** A Next.js landing page without a listing whose product shelves read a collection: the first one. */
function headlessShelfCollection(text) {
    const id = /"collectionId":"(\d+)"/.exec(unescapeRsc(text))?.[1]
    return id ? { type: "collection", value: id } : undefined
}

const pageTitle = (text) => decodeEntities(/<h1\b[^>]*>([^<]*)/i.exec(text)?.[1]?.trim() || /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() || "")

/**
 * What a store page lists, from its server-rendered route and queries:
 *   { type: "collection", value, sort?, title? }  a landing page whose product listing is a collection
 *                                                  (search-result-layout.customQuery → querySchema)
 *   "path"        a search page (category, brand, ?map=…): the template's path resolver handles it
 *   null          a page without products (content, coupons…)
 *   { type: "collection" | "facets", … }       a headless listing (deco, FastStore): the base facets
 *                                                  every one of its own filter links repeats
 *   undefined     neither (unknown: the caller keeps the path)
 */
export function landingTarget(html, path) {
    const text = String(html ?? "").replace(/\\u002F/gi, "/")
    const route = /"route":\{"domain":"store","id":"([^"]+)"/.exec(text)?.[1]
    if (!route) {
        const listing = headlessListing(text, path)
        if (listing) return listing
        const facets = headlessFacetNames(text)
        // A VTEX collection named as such (productClusterIds, or the storefront's productClusters.id).
        const cluster = facets.find((f) => /^productClusters?(?:Ids|\.id)$/.test(f.key))
        if (cluster) return { type: "collection", value: cluster.value, ...(pageTitle(text) ? { title: pageTitle(text) } : {}) }
        if (facets.length) return undefined
        const shelf = headlessShelfCollection(text)
        if (shelf && pageTitle(text)) shelf.title = pageTitle(text)
        return shelf
    }
    if (/store\.search/.test(route)) return "path"
    const queries = [...text.matchAll(/"querySchema":(\{[^{}]*\})/g)]
        .map((m) => {
            try {
                return JSON.parse(m[1])
            } catch {
                return null
            }
        })
        .filter((q) => q && q.queryField && q.mapField === "productClusterIds")
    if (!queries.length) return null
    const [query] = queries
    const target = { type: "collection", value: String(query.queryField) }
    const sort = VTEX_SORT[query.orderByField]
    if (sort) target.sort = sort
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim()
    if (title) target.title = title
    return target
}

/**
 * The CMS sections with every `path` action (a captured store link) replaced by what the page
 * lists: a collection, or the page itself in the in-app browser when it has no products.
 * `pages` maps each path to its HTML (fetched by the caller); `known` maps a path to what it lists when its
 * page cannot say (VTEX's pagetype: pages.mjs vtexListingTarget). A `?q=` link is that search. Paths it lacks,
 * or whose page it cannot read, are `unresolved`.
 */
export function resolveLinkActions(sections, pages, storeHost, known = {}) {
    const unresolved = new Set()
    const resolve = (action) => {
        if (action?.type !== "path") return action
        const query = new URL(action.value, storeHost).searchParams.get("q")
        if (query) return { type: "search", value: query }
        if (!(action.value in pages)) {
            if (known[action.value]) return { ...known[action.value], ...(action.title ? { title: action.title } : {}) }
            unresolved.add(action.value)
            return action
        }
        const read = landingTarget(pages[action.value], action.value)
        const target = read === undefined && known[action.value] ? known[action.value] : read
        // The banner's own label (what the shopper tapped) beats the page's heading as the listing's title.
        if (target && typeof target === "object") return { ...target, ...(action.title ? { title: action.title } : {}) }
        if (target === null) return { type: "link", value: new URL(action.value, storeHost).href }
        // Neither a VTEX IO page nor a listing whose facets it can read: the path stays, to check by hand.
        if (target === undefined) unresolved.add(action.value)
        return action
    }
    const out = structuredClone(sections).map((section) => {
        if (Array.isArray(section.data?.images)) section.data.images = section.data.images.map((img) => (img.action ? { ...img, action: resolve(img.action) } : img))
        if (section.data?.action) section.data.action = resolve(section.data.action)
        return section
    })
    return { sections: out, unresolved: [...unresolved] }
}

/** The `path` actions of these sections, to fetch for resolveLinkActions. */
export function linkPaths(sections) {
    const paths = new Set()
    for (const s of sections) {
        for (const img of s.data?.images ?? []) if (img.action?.type === "path") paths.add(img.action.value)
        if (s.data?.action?.type === "path") paths.add(s.data.action.value)
    }
    return [...paths]
}
