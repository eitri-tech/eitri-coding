// Finds the commerce components on a rendered page — product cards and their grid, the PDP's title, price,
// gallery, size/color options and buy button, a listing's title and toolbar — and measures their computed
// styles. The same function runs on the store (site-clone scrape.mjs --probe) and on the app
// (browser-preview.mjs --probe), so fidelity.mjs can compare like with like. Deterministic: no guessing
// from class names, only structure (repeated groups, prices, images, clickable elements) and geometry.
//
// It runs inside the page (page.evaluate): self-contained, no imports, no closures over module scope.
export default function componentsProbe() {
    const vw = window.innerWidth
    const PRICE = /(?:R\$|US\$|\$|€|£)\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|zł|kr)\b/
    const PRICE_FULL = /^[^\d]{0,20}(?:R\$|US\$|\$|€|£)\s?\d[\d.,]*[^\d]{0,24}$/
    const BUY = /\b(comprar|adicionar|add to|buy|sacola|mochila|carrinho|cesta|bag|cart|agregar)\b/i
    const TOOLBAR = /\b(filtr|ordenar|classificar|sort|filter)/i
    const INSTALLMENTS = /\d+\s?x\b/i
    const DISCOUNT = /-?\s?\d{1,2}\s?%/

    const round = (n) => Math.round(n * 100) / 100
    const rect = (el) => el.getBoundingClientRect()
    const box = (el) => {
        const r = rect(el)
        return [Math.round(r.left + window.scrollX), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)]
    }
    // On screen: painted, and not inside a layer that is transparent or parked off-canvas (a fixed drawer
    // outside the viewport, a mini-cart at opacity 0) — their content is not the page's.
    const layerShown = new Map()
    const inShownLayer = (el) => {
        if (!el || el === document.body || el === document.documentElement) return true
        if (layerShown.has(el)) return layerShown.get(el)
        const cs = getComputedStyle(el)
        let shown = Number(cs.opacity) > 0.05
        if (shown && cs.position === "fixed") {
            const r = el.getBoundingClientRect()
            shown = !(r.top >= window.innerHeight || r.bottom <= 0 || r.left >= window.innerWidth || r.right <= 0)
        }
        shown = shown && inShownLayer(el.parentElement)
        layerShown.set(el, shown)
        return shown
    }
    const visible = (el) => {
        const r = rect(el)
        if (r.width < 1 || r.height < 1) return false
        const cs = getComputedStyle(el)
        return cs.visibility !== "hidden" && cs.display !== "none" && inShownLayer(el)
    }
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim()
    const ownText = (el) =>
        [...el.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.nodeValue)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
    const px = (v) => (v && v !== "normal" ? parseFloat(v) : null)
    // Every color as rgb()/rgba(), whatever the CSS wrote (DaisyUI v4 computes oklch): painted on a pixel.
    const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
    const rgbCache = new Map()
    const toRgb = (v) => {
        if (!v || /^rgba?\(/.test(v) || !paint) return v
        if (rgbCache.has(v)) return rgbCache.get(v)
        paint.clearRect(0, 0, 1, 1)
        paint.fillStyle = v
        paint.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data
        const out = a === 255 ? `rgb(${r}, ${g}, ${b})` : a === 0 ? "rgba(0, 0, 0, 0)" : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`
        rgbCache.set(v, out)
        return out
    }
    const color = (v) => {
        const c = toRgb(v)
        return c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) ? c : null
    }
    const all = (root, sel) => [...root.querySelectorAll(sel)].filter(visible)
    // A heading someone reads: a screen-reader-only one (the logo's name, "visually-hidden") is a 1×1 box.
    const readable = (el) => rect(el).width > 1 && rect(el).height > 1
    const struck = (el) => {
        for (let e = el; e && e !== document.body; e = e.parentElement) if (/line-through/.test(getComputedStyle(e).textDecorationLine)) return true
        return false
    }
    const textStyle = (el) => {
        if (!el) return null
        const cs = getComputedStyle(el)
        const size = px(cs.fontSize)
        const lineHeight = px(cs.lineHeight) ?? round(size * 1.2)
        const b = box(el)
        return {
            text: text(el).slice(0, 80),
            fontSize: size,
            fontWeight: Number(cs.fontWeight) || 400,
            fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase(),
            textTransform: cs.textTransform === "none" ? "none" : cs.textTransform,
            color: toRgb(cs.color),
            letterSpacing: px(cs.letterSpacing) ?? 0,
            lineHeight,
            lines: Math.max(1, Math.round(b[3] / lineHeight)),
            struck: struck(el),
            box: b,
        }
    }
    const blockStyle = (el) => {
        if (!el) return null
        const cs = getComputedStyle(el)
        const b = box(el)
        const radius = px(cs.borderTopLeftRadius) ?? 0
        return {
            box: b,
            background: color(cs.backgroundColor),
            radius: radius >= b[3] / 2 - 1 ? "pill" : radius,
            borderWidth: px(cs.borderTopWidth) ?? 0,
            borderColor: (px(cs.borderTopWidth) ?? 0) > 0 ? toRgb(cs.borderTopColor) : null,
            shadow: cs.boxShadow && cs.boxShadow !== "none",
        }
    }
    // The text inside an element that carries its look: the largest font among the descendants with own text.
    const mainText = (el) => {
        let best = null
        for (const e of [el, ...el.querySelectorAll("*")]) {
            if (!visible(e) || !ownText(e)) continue
            const size = px(getComputedStyle(e).fontSize)
            if (!best || size > best.size) best = { e, size }
        }
        return best ? best.e : el
    }

    // Prices: the smallest element whose whole text is one price.
    const prices = all(document.body, "*").filter((el) => {
        const t = text(el)
        if (t.length > 44 || !PRICE_FULL.test(t)) return false
        return ![...el.children].some((c) => PRICE_FULL.test(text(c)))
    })
    const images = all(document.body, "img").filter((img) => rect(img).width >= 48 && rect(img).height >= 48)

    // Product cards: for each price, its smallest ancestor that holds an image at least half its width (the
    // product photo, not a color swatch); a card is such an ancestor repeated with the same width at least twice.
    const cardOf = new Map()
    for (const price of prices) {
        let el = price.parentElement
        for (let depth = 0; el && el !== document.body && depth < 10; depth++, el = el.parentElement) {
            const r = rect(el)
            if (r.width > vw * 1.02) break
            if (images.some((img) => el.contains(img) && rect(img).width >= r.width * 0.5)) {
                cardOf.set(price, el)
                break
            }
        }
    }
    // Cards are items of one list: about the same width, within 4% — `1fr 1fr` columns differ by a few px
    // when one cell is a banner (a grid may also be laid out as one container per column)…
    const groups = new Map()
    let groupWidth = null
    for (const el of [...new Set(cardOf.values())].sort((a, b) => rect(a).width - rect(b).width)) {
        const width = rect(el).width
        if (groupWidth === null || width > groupWidth * 1.04) groupWidth = width
        if (!groups.has(groupWidth)) groups.set(groupWidth, [])
        groups.get(groupWidth).push(el)
    }
    // …and about the same height (a name on one or two lines): a page column is many times taller than an item.
    const sameHeight = (group) => {
        const out = []
        for (const el of [...group].sort((a, b) => rect(a).height - rect(b).height)) {
            const last = out[out.length - 1]
            if (last && rect(el).height <= rect(last[0]).height * 1.3) last.push(el)
            else out.push([el])
        }
        return out
    }
    const lists = [...groups.values()].flatMap(sameHeight)
    const cardEls = lists.filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0] ?? []

    const describeCard = (card) => {
        const img = images.filter((i) => card.contains(i)).sort((a, b) => rect(b).width * rect(b).height - rect(a).width * rect(a).height)[0]
        const cardPrices = prices.filter((p) => card.contains(p))
        const listPrice = cardPrices.find((p) => struck(mainText(p)))
        const price = cardPrices.filter((p) => p !== listPrice).sort((a, b) => px(getComputedStyle(mainText(b)).fontSize) - px(getComputedStyle(mainText(a)).fontSize))[0]
        const texts = all(card, "*").filter((e) => ownText(e) && !cardPrices.some((p) => p.contains(e)))
        const name = texts.filter((e) => !DISCOUNT.test(ownText(e)) && !INSTALLMENTS.test(ownText(e))).sort((a, b) => text(b).length - text(a).length)[0]
        const installments = texts.find((e) => INSTALLMENTS.test(ownText(e)) && PRICE.test(text(e.parentElement || e)))
        const badgeText = texts.find((e) => DISCOUNT.test(ownText(e)) && ownText(e).length <= 12)
        let badge = null
        if (badgeText) {
            let b = badgeText
            while (b !== card && !color(getComputedStyle(b).backgroundColor)) b = b.parentElement
            badge = { ...textStyle(badgeText), block: b !== card ? blockStyle(b) : null }
        }
        const ib = img ? rect(img) : null
        const cb = rect(card)
        const wishlist = ib
            ? all(card, "svg, button, [role=button]").find((e) => {
                  const r = rect(e)
                  return r.width <= 48 && r.left >= ib.left + ib.width * 0.6 && r.top <= ib.top + ib.height * 0.35
              })
            : null
        return {
            block: blockStyle(card),
            image: ib ? { ratio: round(ib.width / ib.height), widthShare: round(ib.width / cb.width), inset: Math.round(ib.left - cb.left), radius: blockStyle(img).radius } : null,
            name: name ? textStyle(name) : null,
            price: price ? textStyle(mainText(price)) : null,
            listPrice: listPrice ? textStyle(mainText(listPrice)) : null,
            installments: installments ? textStyle(installments) : null,
            badge,
            wishlist: wishlist ? { size: Math.round(rect(wishlist).width) } : null,
        }
    }
    let cards = null
    if (cardEls.length) {
        const sorted = [...cardEls].sort((a, b) => rect(a).top - rect(b).top || rect(a).left - rect(b).left)
        // Columns from every card's left edge, not the first row's: a grid's first cells may hold a banner.
        const lefts = []
        for (const left of sorted.map((c) => rect(c).left).sort((a, b) => a - b)) if (!lefts.length || left - lefts[lefts.length - 1] >= 6) lefts.push(left)
        const columnOf = (left) => lefts.findIndex((l) => Math.abs(l - left) < 6)
        const secondRow = sorted.find((c) => rect(c).top > rect(sorted[0]).top + 6)
        const left0 = sorted.find((c) => columnOf(rect(c).left) === 0)
        cards = {
            count: cardEls.length,
            columns: Math.min(lefts.length, Math.max(1, Math.round(vw / rect(sorted[0]).width))),
            width: Math.round(rect(sorted[0]).width),
            gapX: lefts.length > 1 ? Math.round(lefts[1] - (lefts[0] + rect(left0).width)) : null,
            gapY: secondRow ? Math.round(rect(secondRow).top - rect(sorted[0]).bottom) : null,
            // The first card, with the parts that depend on the product (discount, list price, installments)
            // from the first card that has them: products differ between the store and the app.
            card: (() => {
                const described = sorted.slice(0, 12).map(describeCard)
                const card = { ...described[0] }
                for (const key of ["badge", "listPrice", "installments", "wishlist"]) if (!card[key]) card[key] = described.find((d) => d[key])?.[key] ?? null
                return card
            })(),
        }
    }
    const inCards = (el) => cardEls.some((c) => c.contains(el))

    // Clickable: buttons, links, roles, anything with a pointer cursor, and short texts drawn as a box (a
    // background or a border) — the app's Luminus Views take React onClick handlers, with no cursor or attribute.
    const drawn = (el) => {
        const cs = getComputedStyle(el)
        return Boolean(color(cs.backgroundColor)) || (px(cs.borderTopWidth) ?? 0) > 0
    }
    const clickable = all(document.body, "button, a, [role=button], [onclick], div, span, label").filter((el) => {
        if (/^(BUTTON|A)$/.test(el.tagName) || el.getAttribute("role") === "button" || el.hasAttribute("onclick")) return true
        const cs = getComputedStyle(el)
        if (cs.cursor === "pointer") return !el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer"
        const t = text(el)
        return t.length > 0 && t.length <= 40 && drawn(el) && ![...el.children].some((c) => text(c) === t && drawn(c))
    })

    // PDP: a wide buy button outside the cards.
    // The button itself: the innermost such element (a bottom bar around the button has the same text).
    // A buy button is a painted box; a text link that names the cart ("Ir direto para o carrinho") is not one.
    const painted = (el) => {
        const cs = getComputedStyle(el)
        const fill = !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor) || cs.backgroundImage !== "none"
        return rect(el).height >= 28 && (fill || px(cs.borderTopWidth) > 0)
    }
    const buyLike = clickable.filter((el) => !inCards(el) && BUY.test(text(el)) && text(el).length <= 40 && rect(el).width >= vw * 0.4 && painted(el))
    const buy = buyLike.filter((el) => !buyLike.some((o) => o !== el && el.contains(o))).sort((a, b) => rect(a).top - rect(b).top)[0]
    let pdp = null
    if (buy) {
        const top = window.scrollY + rect(buy).top
        const h1 = all(document.body, "h1").find((h) => !inCards(h) && readable(h))
        const titleEl =
            h1 ??
            all(document.body, "*")
                .filter((e) => ownText(e).length >= 8 && readable(e) && !inCards(e) && !PRICE.test(ownText(e)) && box(e)[1] < top + 400)
                .sort((a, b) => px(getComputedStyle(b).fontSize) - px(getComputedStyle(a).fontSize))[0]
        const near = prices.filter((p) => !inCards(p) && !clickable.some((c) => c.contains(p) && BUY.test(text(c)))).sort((a, b) => box(a)[1] - box(b)[1])
        const listPrice = near.find((p) => struck(mainText(p)))
        const price = near.find((p) => p !== listPrice)
        const gallery = images.filter((i) => !inCards(i) && rect(i).width >= vw * 0.6).sort((a, b) => box(a)[1] - box(b)[1])[0]
        // Size/color options: two or more equal-sized short clickable items of one list (each may sit in
        // its own wrapper, e.g. <li><input hidden><label>34</label></li>): grouped by the nearest ancestor
        // with several visible children.
        const listOf = (el) => {
            let a = el.parentElement
            while (a && a !== document.body && [...a.children].filter(visible).length < 2) a = a.parentElement
            return a
        }
        const byParent = new Map()
        for (const el of clickable) {
            if (inCards(el) || text(el).length > 4 || rect(el).width > 90 || rect(el).width < 16) continue
            const key = listOf(el)
            if (!byParent.has(key)) byParent.set(key, [])
            byParent.get(key).push(el)
        }
        // An option shows a value: a label (a size) or a picture (a color swatch). Icon-only buttons (wishlist,
        // share, gallery arrows) are not options; labelled groups (sizes) win over swatches, which the app may
        // not draw at all.
        const iconOnly = (e) => !text(e) && !e.querySelector("img") && Boolean(e.querySelector("svg"))
        const optionGroups = [...byParent.values()]
            .filter((g) => g.length >= 2 && g.every((e) => Math.abs(rect(e).width - rect(g[0]).width) <= 3 && Math.abs(rect(e).height - rect(g[0]).height) <= 3))
            .filter((g) => !g.some(iconOnly))
            .sort((a, b) => box(a[0])[1] - box(b[0])[1])
        const options = optionGroups.find((g) => g.every((e) => text(e))) ?? optionGroups[0]
        const installments = all(document.body, "*").find((e) => !inCards(e) && INSTALLMENTS.test(ownText(e)) && PRICE.test(text(e)) && text(e).length < 80)
        pdp = {
            title: titleEl ? textStyle(mainText(titleEl)) : null,
            price: price ? textStyle(mainText(price)) : null,
            listPrice: listPrice ? textStyle(mainText(listPrice)) : null,
            installments: installments ? textStyle(installments) : null,
            gallery: gallery ? { ratio: round(rect(gallery).width / rect(gallery).height), widthShare: round(rect(gallery).width / vw) } : null,
            option: options ? (() => {
                // The look most options share: the selected one (or the sold-out ones) look different.
                const signature = (o) => { const b = blockStyle(o); return `${b.background}|${b.borderColor}|${b.radius}` }
                const counts = new Map()
                for (const o of options) counts.set(signature(o), (counts.get(signature(o)) ?? 0) + 1)
                const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
                const typical = options.find((o) => signature(o) === common)
                return { count: options.length, ...blockStyle(typical), label: textStyle(mainText(typical)) }
            })() : null,
            buyButton: { ...blockStyle(buy), label: textStyle(mainText(buy)) },
        }
    }

    // Listing: its title and the filter/sort controls, when the page has a card grid and no buy button.
    let listing = null
    if (cards && !pdp) {
        const firstCard = Math.min(...cardEls.map((c) => box(c)[1]))
        const heading = all(document.body, "h1, h2").filter((h) => !inCards(h) && readable(h) && box(h)[1] < firstCard)[0]
        const tools = clickable.filter((el) => !inCards(el) && TOOLBAR.test(text(el)) && text(el).length <= 30 && box(el)[1] < firstCard)
        listing = {
            title: heading ? textStyle(mainText(heading)) : null,
            toolbar: tools.length ? { count: tools.length, ...blockStyle(tools[0]), label: textStyle(mainText(tools[0])) } : null,
        }
    }

    return { url: location.href, viewport: vw, cards, pdp, listing }
}
