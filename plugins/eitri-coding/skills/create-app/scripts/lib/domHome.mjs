// The home's sections read from a site-clone capture's DOM, for stores without a VTEX IO block tree
// (deco.cx, FastStore, legacy CMS): every linked image the page renders, grouped by capture section
// and row, becomes a MultipleImageBanner whose mode follows the rendered layout. A row whose images
// all open products is a product shelf: skipped with its products (the app draws shelves from a query the
// page does not expose). Text is not read here: it comes from the screenshots.
import { actionFromLink } from "./vtexBlocks.mjs"
import { proxiedOriginal } from "./imageUrl.mjs"

/** The page's own chrome: the app has its own header, menu and account screens. */
const CHROME = /header|footer|navbar|^nav$|menu/i
/** Links that install the store's app: meaningless inside the app. */
const APP_DOWNLOAD = /(?:^|\.)(?:onelink\.me|app\.link|apps\.apple\.com|play\.google\.com|app\.adjust\.com)$/i

const hostOf = (href) => {
    try {
        return new URL(href).hostname
    } catch {
        return ""
    }
}
const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor((sorted.length - 1) / 2)]
}

const LABEL_MAX = 40
/** A price as a product card prints it ("R$35,99", "R$ 19,99", "$12.50"). */
const PRICE = /(?:R\$|US\$|\$|€|£)\s*\d|\d[.,]\d{2}\b/
const sized = (o) => Array.isArray(o.box) && o.box[2] > 1 && o.box[3] > 1

/**
 * A section's images that open something, each with the `label` a shopper reads for it:
 * - a linked image: the text of the nearest link to the same place (a tile's caption, "983");
 * - an unlinked image at least half the screen wide (a slide whose link is its call-to-action button, not the
 *   image): the first link after it, before the next image, labelled with the heading between them ("The 983").
 */
function linkedImages(own, viewport) {
    const out = []
    own.forEach((o, k) => {
        if (o.type !== "img" || !sized(o)) return
        if (o.href) {
            let label
            let distance = Infinity
            own.forEach((l, j) => {
                const text = l.type === "link" && l.href === o.href ? String(l.text ?? "").trim() : ""
                if (text && text.length <= LABEL_MAX && Math.abs(j - k) < distance) [label, distance] = [text, Math.abs(j - k)]
            })
            // A link's text next to its image is a caption the page shows under the tile.
            out.push(label ? { ...o, label, caption: label } : o)
            return
        }
        if (o.box[2] < viewport * 0.5) return
        let heading
        for (const next of own.slice(k + 1)) {
            if (next.type === "img") break
            if (/^h[1-6]$/.test(next.type) && !heading && next.text?.trim()) heading = next.text.trim()
            if (next.type === "link" && next.href) {
                out.push({ ...o, href: next.href, ...(heading && heading.length <= LABEL_MAX ? { label: heading } : {}) })
                break
            }
        }
    })
    return out
}

/** The heading a section shows above its first image (its banners' mainTitle); headings after it belong to slides. */
function sectionTitle(own) {
    // A link to where an image leads opens that image's tile: headings from there on are its caption.
    const tiles = new Set(own.filter((o) => o.type === "img" && o.href).map((o) => o.href))
    for (const o of own) {
        if (o.type === "img" || (o.type === "link" && tiles.has(o.href))) return undefined
        // A screen-reader-only heading (site-clone marks it srOnly) is not what the section shows.
        const text = /^h[1-6]$/.test(o.type) && !o.srOnly ? String(o.text ?? "").trim() : ""
        if (text && text.length <= 60) return text
    }
    return undefined
}

/** Images one above the other are separate rows; a row is a slider, tiles side by side or a scrolling list. */
function rows(images) {
    const out = []
    for (const image of [...images].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])) {
        const row = out.find((r) => Math.abs(r[0].box[1] - image.box[1]) <= 4)
        if (row) row.push(image)
        else out.push([image])
    }
    return out.map((row) => row.sort((a, b) => a.box[0] - b.box[0]))
}

const sameSize = (list) => list.every((i) => Math.abs(i.box[2] - list[0].box[2]) <= 2 && Math.abs(i.box[3] - list[0].box[3]) <= 2)
const rightEdge = (list) => Math.max(...list.map((i) => i.box[0] + i.box[2]))

function imageData(i, storeHost) {
    const image = { imageUrl: proxiedOriginal(i.src) }
    if (i.caption) image.subLabel = i.caption
    const action = actionFromLink(i.href, storeHost)
    if (action?.type === "path" && i.label) action.title = i.label
    if (action) image.action = action
    return image
}

/**
 * The layout a section's banner rows make together, when it is not one banner mode per row:
 * - "GridList": two or more rows of the same tile, the same count per row, all on screen (a brand grid);
 * - "Mosaic": a row whose tiles differ in size, or tiles stacked inside a row's height (a tall card beside two
 *   stacked ones): every tile keeps its captured box, relative to the block's top.
 * null: read row by row.
 */
function blockLayout(rows, viewport, storeHost) {
    const all = rows.flat()
    if (rows.length >= 2 && rows[0].length >= 2 && sameSize(all) && rows.every((r) => r.length === rows[0].length && rightEdge(r) <= viewport + 2)) {
        const row = rows[0]
        return {
            mode: "GridList",
            columns: row.length,
            gap: Math.max(0, row[1].box[0] - row[0].box[0] - row[0].box[2]),
            ...(all.every((i) => i.round) ? { rounded: true } : {}),
            images: all.map((i) => imageData(i, storeHost)),
        }
    }
    const stacked = rows.some((r, k) => k + 1 < rows.length && rows[k + 1][0].box[1] < Math.max(...r.map((i) => i.box[1] + i.box[3])) - 2)
    if (rows.some((r) => !sameSize(r)) || stacked) {
        const top = Math.min(...all.map((i) => i.box[1]))
        return { mode: "Mosaic", images: all.map((i) => ({ ...imageData(i, storeHost), box: [i.box[0], i.box[1] - top, i.box[2], i.box[3]] })) }
    }
    return null
}

function bannerData(row, viewport, storeHost) {
    const width = median(row.map((i) => i.box[2]))
    const height = median(row.map((i) => i.box[3]))
    const data = {
        images: row.map((i) => imageData(i, storeHost)),
        aspectRatio: `${width}:${height}`,
    }
    const right = Math.max(...row.map((i) => i.box[0] + i.box[2]))
    if (row.length === 1) data.mode = "SingleBanner"
    else if (width >= viewport * 0.9) data.mode = "SliderHero"
    else if (right <= viewport + 2) data.mode = "FitOnScreen"
    else if (row.every((i) => i.round)) {
        // Round tiles scrolling sideways (category circles).
        data.mode = "RoundedBannerList"
        data.size = { maxWidth: width, maxHeight: height }
        const gap = row[1].box[0] - row[0].box[0] - row[0].box[2]
        if (gap > 0) data.gap = gap
    } else {
        data.mode = "BannerList"
        data.size = { maxWidth: width }
        const gap = row[1].box[0] - row[0].box[0] - row[0].box[2]
        if (gap > 0) data.gap = gap
    }
    return data
}

/**
 * outline: site-clone's content/outline.json (img entries carry `href` and `box` since Nov 2026);
 * sections: layout/sections.json → sections; viewport: the capture's primary breakpoint.
 * Returns { sections } in the template's CMS shape ({ id, name, data }) with `path` actions for
 * resolveLinkActions, and `skipped` (what the page shows that the app leaves out).
 */
export function domHomeSections({ outline = [], sections = [], viewport = 375, storeHost } = {}) {
    const out = []
    const skipped = []
    for (const section of sections) {
        if (CHROME.test(section.name ?? "") || CHROME.test(section.tag ?? "")) continue
        const own = outline.filter((o) => o.section === section.index)
        const linked = linkedImages(own, viewport)
        const priced = new Set(own.filter((o) => o.type === "link" && o.href && PRICE.test(String(o.text ?? ""))).map((o) => o.href))
        const title = sectionTitle(own)
        if (!linked.length) {
            // Text without a banner (benefits, a countdown, a note): the app has no section for it yet — say so.
            const texts = own.filter((o) => !o.srOnly && (/^h[1-6]$/.test(o.type) || o.type === "p") && String(o.text ?? "").trim()).map((o) => String(o.text).trim())
            if (texts.length) skipped.push({ id: `dom-${section.name ?? section.index}`, kind: "text block", texts: [...new Set(texts)].slice(0, 12) })
            continue
        }
        const id = `dom-${section.name ?? section.index}`
        const appLinks = linked.filter((i) => APP_DOWNLOAD.test(hostOf(i.href)))
        if (appLinks.length) skipped.push({ id, kind: "app download banner", links: [...new Set(appLinks.map((i) => i.href))] })
        // A carousel's loop repeats its slides: one image per file and destination.
        // Keep the copy on screen: a looping carousel clones its last slides before the first.
        const seen = new Set()
        const onScreenFirst = [...linked].sort((a, b) => (a.box[0] < 0) - (b.box[0] < 0))
        const images = onScreenFirst.filter((i) => {
            const key = `${proxiedOriginal(i.src)}|${i.href}`
            if (APP_DOWNLOAD.test(hostOf(i.href)) || seen.has(key)) return false
            seen.add(key)
            return true
        })
        const banners = []
        rows(images).forEach((row, n) => {
            const rowId = n ? `${id}-${n + 1}` : id
            // Every image opens a product: a product shelf (its query lives in the store's CMS), not banners of
            // packshots. Its products go to `skipped`, for the home step to rebuild as a ProductShelf.
            // So is any row of product cards: an image's product link also shows its price (a card on promotion may
            // show "Leve 3 por…" instead; a "deal of the day" box holds one). A banner that opens a product has no price.
            const actions = row.map((i) => actionFromLink(i.href, storeHost))
            const cards = row.some((i) => priced.has(i.href))
            if ((row.length >= 3 || cards) && actions.every((a) => a?.type === "product")) {
                skipped.push({ id: rowId, kind: "product shelf", products: [...new Set(actions.map((a) => a.value))] })
                return
            }
            banners.push({ row, rowId })
        })
        const block = banners.length ? blockLayout(banners.map((b) => b.row), viewport, storeHost) : null
        if (block) {
            out.push({ id, name: "MultipleImageBanner", data: { ...block, ...(title ? { mainTitle: title } : {}) } })
            continue
        }
        banners.forEach(({ row, rowId }, n) => {
            const data = bannerData(row, viewport, storeHost)
            if (!n && title) data.mainTitle = title
            out.push({ id: rowId, name: "MultipleImageBanner", data })
        })
    }
    return { sections: out, skipped }
}

const COUNTDOWN_UNITS = /(?:>|\s)(?:dias|horas|minutos|segundos|days|hours|minutes|seconds)(?:<|\s)/gi
const DATE_TIME = /\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\b/
const STREAMSHOP = /<liveshop-ads-carousel(?:-v2)?\b([^>]*)>/i
const attr = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs)?.[1]

/**
 * The store's widgets the linked images do not show, read from the rendered capture per site-clone section
 * (data-sc-section): a StreamShop video carousel (<liveshop-ads-carousel name videos-from-store>) becomes
 * VideoStories reading its public feed; a countdown (unit labels and an end date, often in a hidden element)
 * becomes Countdown, its "dd/mm/yyyy hh:mm" date in the store's `utcOffset`. Returns [{ section, widget }].
 */
export function domWidgets({ rendered = "", utcOffset = "-03:00", storeHost } = {}) {
    const marks = [...String(rendered).matchAll(/data-sc-section="(\d+)"/g)].map((m) => ({ index: Number(m[1]), at: m.index }))
    const out = []
    marks.forEach((mark, k) => {
        const html = String(rendered).slice(mark.at, k + 1 < marks.length ? marks[k + 1].at : undefined)
        const tag = (name) => `dom-${String(mark.index).padStart(2, "0")}-${name}`
        const date = DATE_TIME.exec(html)
        const units = new Set((html.match(COUNTDOWN_UNITS) ?? []).map((u) => u.replace(/[<>\s]/g, "").toLowerCase()))
        if (date && units.size >= 3) {
            const [, dd, mm, yyyy, hh, mi, ss = "00"] = date
            out.push({ section: mark.index, widget: { id: tag("countdown"), name: "Countdown", data: { targetDate: `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${utcOffset}` } } })
        }
        const carousel = STREAMSHOP.exec(html)
        const storeSlug = carousel && attr(carousel[1], "videos-from-store")
        const tagName = carousel && attr(carousel[1], "name")
        if (storeSlug && tagName) {
            const origin = storeHost ? `${new URL(storeHost).origin}/` : ""
            out.push({ section: mark.index, widget: { id: tag("video-stories"), name: "VideoStories", data: { streamshop: { storeSlug, tagName, origin } } } })
        }
    })
    return out
}

/** The home's sections with each widget after the banners of its capture section (ids read "dom-NN-…"). */
export function placeWidgets(sections, widgets) {
    const indexOf = (s) => Number(/^dom-(\d+)/.exec(s.id ?? "")?.[1] ?? NaN)
    const out = [...sections]
    for (const { section, widget } of widgets) {
        let at = out.length
        for (let k = 0; k < out.length; k++) {
            if (indexOf(out[k]) > section) {
                at = k
                break
            }
        }
        out.splice(at, 0, widget)
    }
    return out
}
