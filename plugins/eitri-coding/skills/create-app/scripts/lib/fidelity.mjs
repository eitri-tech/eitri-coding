// Compares what componentsProbe.mjs measured on the store's page with what it measured on the app's render
// of the same screen. Pure and deterministic: every part the store has is checked against the app with
// fixed tolerances, and each difference names its part, property and both values.

const TOLERANCE = { size: 1, weight: 100, color: 48, spacing: 0.5, px: 4, ratio: 0.06, share: 0.05, radius: 2, border: 0.5 }

/** The parts each screen compares. */
export const SCREEN_PARTS = { listing: ["cards", "listing"], pdp: ["pdp"], home: ["cards"], cards: ["cards"] }

function rgb(value) {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(String(value ?? ""))
    if (!m) return null
    const alpha = m[4] === undefined ? 1 : Number(m[4])
    return alpha < 0.05 ? null : [Number(m[1]), Number(m[2]), Number(m[3])]
}
const colorDistance = (a, b) => {
    const [x, y] = [rgb(a), rgb(b)]
    if (!x && !y) return 0
    if (!x || !y) return Infinity
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

export function compareProbes(store, app, { screen = "listing" } = {}) {
    const diffs = []
    let checked = 0
    const diff = (path, s, a, why) => diffs.push({ path, store: s, app: a, ...(why ? { why } : {}) })
    const near = (path, s, a, tol) => {
        if (s === null || s === undefined) return
        checked++
        if (a === null || a === undefined || Math.abs(Number(s) - Number(a)) > tol) diff(path, s, a)
    }
    const same = (path, s, a) => {
        if (s === null || s === undefined) return
        checked++
        if (s !== a) diff(path, s, a)
    }
    const color = (path, s, a) => {
        checked++
        if (colorDistance(s, a) > TOLERANCE.color) diff(path, s ?? "none", a ?? "none")
    }
    const present = (path, s, a) => {
        if (!s) return false
        checked++
        if (!a) {
            diff(path, "present", "absent", "missing in the app")
            return false
        }
        return true
    }
    const textStyle = (path, s, a) => {
        if (!present(path, s, a)) return
        near(`${path}.fontSize`, s.fontSize, a.fontSize, TOLERANCE.size)
        if (s.fontWeight !== undefined) {
            checked++
            if (Math.abs(s.fontWeight - a.fontWeight) >= TOLERANCE.weight) diff(`${path}.fontWeight`, s.fontWeight, a.fontWeight)
        }
        // Case only shows on letters: a size "34" is the same in any case.
        if (/\p{L}/u.test(s.text ?? "x")) same(`${path}.textTransform`, s.textTransform, a.textTransform)
        if (s.fontFamily && a.fontFamily) same(`${path}.fontFamily`, s.fontFamily, a.fontFamily)
        color(`${path}.color`, s.color, a.color)
        near(`${path}.letterSpacing`, s.letterSpacing ?? 0, a.letterSpacing ?? 0, TOLERANCE.spacing)
        same(`${path}.struck`, Boolean(s.struck), Boolean(a.struck))
    }
    const radius = (path, s, a) => {
        checked++
        if (s === "pill" || a === "pill" ? s !== a : Math.abs(s - a) > TOLERANCE.radius) diff(path, s, a)
    }
    const blockStyle = (path, s, a) => {
        if (!present(path, s, a)) return
        color(`${path}.background`, s.background, a.background)
        radius(`${path}.radius`, s.radius, a.radius)
        near(`${path}.borderWidth`, s.borderWidth, a.borderWidth, TOLERANCE.border)
        if (s.borderWidth > 0 && a.borderWidth > 0) color(`${path}.borderColor`, s.borderColor, a.borderColor)
        same(`${path}.shadow`, Boolean(s.shadow), Boolean(a.shadow))
    }
    const vw = store.viewport || 375
    const avw = app.viewport || vw

    for (const part of SCREEN_PARTS[screen] ?? []) {
        if (part === "cards" && present("cards", store.cards, app.cards)) {
            const [s, a] = [store.cards, app.cards]
            same("cards.columns", s.columns, a.columns)
            near("cards.gapX", s.gapX, a.gapX, TOLERANCE.px)
            near("cards.gapY", s.gapY, a.gapY, TOLERANCE.px * 2)
            const [sc, ac] = [s.card, a.card]
            if (sc.block) {
                checked++
                const [sb, ab] = [sc.block, ac.block ?? {}]
                color("cards.card.block.background", sb.background, ab.background)
                radius("cards.card.block.radius", sb.radius, ab.radius ?? 0)
                near("cards.card.block.borderWidth", sb.borderWidth, ab.borderWidth ?? 0, TOLERANCE.border)
                same("cards.card.block.shadow", Boolean(sb.shadow), Boolean(ab.shadow))
            }
            if (present("cards.card.image", sc.image, ac.image)) {
                near("cards.card.image.ratio", sc.image.ratio, ac.image.ratio, sc.image.ratio * TOLERANCE.ratio)
                near("cards.card.image.widthShare", sc.image.widthShare, ac.image.widthShare, TOLERANCE.share)
                near("cards.card.image.inset", sc.image.inset, ac.image.inset, TOLERANCE.px)
                radius("cards.card.image.radius", sc.image.radius, ac.image.radius ?? 0)
            }
            for (const t of ["name", "price", "listPrice", "installments"]) textStyle(`cards.card.${t}`, sc[t], ac[t])
            if (present("cards.card.badge", sc.badge, ac.badge)) {
                textStyle("cards.card.badge.text", sc.badge, ac.badge)
                if (sc.badge.block) blockStyle("cards.card.badge.block", sc.badge.block, ac.badge.block)
            }
            present("cards.card.wishlist", sc.wishlist, ac.wishlist)
        }
        if (part === "listing" && present("listing", store.listing, app.listing)) {
            textStyle("listing.title", store.listing.title, app.listing.title)
            const [s, a] = [store.listing.toolbar, app.listing.toolbar]
            if (present("listing.toolbar", s, a)) {
                blockStyle("listing.toolbar", s, a)
                near("listing.toolbar.height", s.box[3], a.box[3], TOLERANCE.px)
                textStyle("listing.toolbar.label", s.label, a.label)
            }
        }
        if (part === "pdp" && present("pdp", store.pdp, app.pdp)) {
            const [s, a] = [store.pdp, app.pdp]
            for (const t of ["title", "price", "listPrice", "installments"]) textStyle(`pdp.${t}`, s[t], a[t])
            if (present("pdp.gallery", s.gallery, a.gallery)) {
                near("pdp.gallery.ratio", s.gallery.ratio, a.gallery.ratio, s.gallery.ratio * TOLERANCE.ratio)
                near("pdp.gallery.widthShare", s.gallery.widthShare, a.gallery.widthShare, TOLERANCE.share)
            }
            if (present("pdp.option", s.option, a.option)) {
                blockStyle("pdp.option", s.option, a.option)
                near("pdp.option.width", s.option.box[2], a.option.box[2], TOLERANCE.px)
                near("pdp.option.height", s.option.box[3], a.option.box[3], TOLERANCE.px)
                textStyle("pdp.option.label", s.option.label, a.option.label)
            }
            if (present("pdp.buyButton", s.buyButton, a.buyButton)) {
                blockStyle("pdp.buyButton", s.buyButton, a.buyButton)
                near("pdp.buyButton.height", s.buyButton.box[3], a.buyButton.box[3], TOLERANCE.px)
                near("pdp.buyButton.widthShare", s.buyButton.box[2] / vw, a.buyButton.box[2] / avw, TOLERANCE.share)
                textStyle("pdp.buyButton.label", s.buyButton.label, a.buyButton.label)
            }
        }
    }
    return { screen, checked, diffs }
}

/** The template files that draw a difference's part (references/template-owners.json), longest key first. */
export function ownersOf(path, owners = {}) {
    const keys = Object.keys(owners).filter((k) => !k.startsWith("//") && (path === k || path.startsWith(`${k}.`)))
    const layout = /^cards\.(columns|gapX|gapY)$/.test(path) ? owners["cards.layout"] : null
    if (layout) return layout
    const key = keys.sort((a, b) => b.length - a.length)[0]
    return key ? owners[key] : []
}
