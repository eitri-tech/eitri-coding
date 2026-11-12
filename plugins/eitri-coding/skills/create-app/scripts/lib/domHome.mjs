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
    for (const o of own) {
        if (o.type === "img") return undefined
        const text = /^h[1-6]$/.test(o.type) ? String(o.text ?? "").trim() : ""
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

function bannerData(row, viewport, storeHost) {
    const width = median(row.map((i) => i.box[2]))
    const height = median(row.map((i) => i.box[3]))
    const data = {
        images: row.map((i) => {
            const image = { imageUrl: proxiedOriginal(i.src) }
            if (i.caption) image.subLabel = i.caption
            const action = actionFromLink(i.href, storeHost)
            if (action?.type === "path" && i.label) action.title = i.label
            if (action) image.action = action
            return image
        }),
        aspectRatio: `${width}:${height}`,
    }
    const right = Math.max(...row.map((i) => i.box[0] + i.box[2]))
    if (row.length === 1) data.mode = "SingleBanner"
    else if (width >= viewport * 0.9) data.mode = "SliderHero"
    else if (right <= viewport + 2) data.mode = "FitOnScreen"
    else {
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
        const title = sectionTitle(own)
        if (!linked.length) continue
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
        rows(images).forEach((row, n) => {
            const rowId = n ? `${id}-${n + 1}` : id
            // Every image opens a product: a product shelf (its query lives in the store's CMS), not banners of
            // packshots. Its products go to `skipped`, for the home step to rebuild as a ProductShelf.
            const actions = row.map((i) => actionFromLink(i.href, storeHost))
            if (row.length >= 3 && actions.every((a) => a?.type === "product")) {
                skipped.push({ id: rowId, kind: "product shelf", products: [...new Set(actions.map((a) => a.value))] })
                return
            }
            const data = bannerData(row, viewport, storeHost)
            if (!n && title) data.mainTitle = title
            out.push({ id: rowId, name: "MultipleImageBanner", data })
        })
    }
    return { sections: out, skipped }
}
