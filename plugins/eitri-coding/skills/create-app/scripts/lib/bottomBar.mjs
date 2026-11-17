// The app's native bottom bar (remote config `eitriConfig.dynamicBottomBar`), made from the
// store's own mobile tab bar and kept in step with the local simulation files.
//
// Pure functions: the browser measurements come in as plain objects (bottom-bar.mjs probes
// them), text goes out. See references/bottom-bar.md for the rules they implement.

/** Parses #rgb, #rrggbb(aa) and rgb()/rgba() into [r, g, b, a]; undefined when unreadable. */
export function parseColor(value) {
    if (!value) return undefined
    const text = String(value).trim().toLowerCase()
    const hex = /^#([0-9a-f]{3,8})$/.exec(text)
    if (hex) {
        let h = hex[1]
        if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
        if (h.length !== 6 && h.length !== 8) return undefined
        const n = (i) => parseInt(h.slice(i, i + 2), 16)
        return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
    }
    const rgb = /^rgba?\(([^)]+)\)$/.exec(text)
    if (!rgb) return undefined
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((v) => !Number.isFinite(v))) return undefined
    return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1]
}

/** #RRGGBB of an opaque color; undefined for a transparent or unreadable one. */
export function toHex(value) {
    const c = parseColor(value)
    if (!c || c[3] < 0.5) return undefined
    return "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()
}

function luminance(hex) {
    return parseColor(hex)
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
}

/** WCAG contrast ratio of two hex colors. */
export function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

const MIN_ICON_CONTRAST = 3

/**
 * The dynamicBottomBar `layout` closest to the store's bar.
 *
 * `bar` is what bottom-bar.mjs measured at phone width:
 *   { background, radius, height, left, right, bottom, viewportWidth, shadow, border: { width, color },
 *     labels, items: [{ active, color, background }], badge: { background, color } }
 *
 * The bar is `floating` when it is detached from the screen edges (side or bottom gap, or a radius of
 * a pill/card). A `classic` customization is always written too: an absent or unknown theme falls back
 * to classic, and native builds older than the floating theme read only that node. Because classic
 * has no active indicator, `selectedColor` must read on the bar's own background — a store whose
 * active icon is only visible on its indicator (white on a navy circle over a yellow bar) gets the
 * indicator's color as `selectedColor`, and the floating indicator derives its tint from it.
 */
export function deriveLayout(bar) {
    const warnings = []
    const background = toHex(bar.background) ?? "#FFFFFF"
    const items = bar.items ?? []
    const active = items.find((i) => i.active)
    const inactive = items.filter((i) => !i.active)
    const inactiveColor = mostCommon(inactive.map((i) => toHex(i.color)).filter(Boolean))
    const indicator = active ? toHex(active.background) : undefined
    const hasIndicator = Boolean(indicator && indicator !== background)

    let unselectedColor = inactiveColor ?? "#333333"
    if (contrast(unselectedColor, background) < MIN_ICON_CONTRAST) {
        warnings.push(`The store's icon color ${unselectedColor} barely reads on ${background}: using the most readable of black and white.`)
        unselectedColor = contrast("#000000", background) >= contrast("#FFFFFF", background) ? "#000000" : "#FFFFFF"
    }

    for (const item of items.filter((i) => i.raised))
        warnings.push(`"${item.label ?? `tab ${item.index + 1}`}" is a raised center button in the store: the bar has no such shape, it becomes a regular tab.`)

    let selectedColor = active ? toHex(active.color) : undefined
    if (!active) {
        warnings.push(`The store marks no open tab: selectedColor is the icon color (${unselectedColor}). Set the brand color by hand if the app should show the open tab.`)
        selectedColor = unselectedColor
    } else if (!selectedColor || contrast(selectedColor, background) < MIN_ICON_CONTRAST) {
        const fallback = hasIndicator && contrast(indicator, background) >= MIN_ICON_CONTRAST ? indicator : unselectedColor
        if (selectedColor) warnings.push(`The active icon (${selectedColor}) reads only on its indicator (${indicator ?? "none"}): selectedColor is ${fallback} so the classic fallback, which has no indicator, still shows it.`)
        selectedColor = fallback
    }

    if (active && selectedColor === unselectedColor)
        warnings.push(`Selected and unselected icons share ${selectedColor}, as in the store, where only the indicator marks the open tab: the classic fallback shows no selection.`)

    const viewportWidth = bar.viewportWidth ?? 375
    const sideGap = Math.max(0, Math.round(Math.min(bar.left ?? 0, bar.right ?? 0)))
    const bottomGap = Math.max(0, Math.round(bar.bottom ?? 0))
    const height = Math.round(bar.height ?? 56)
    const radius = Math.round(bar.radius ?? 0)
    const floating = sideGap > 0 || bottomGap > 0

    const border = bar.border?.width > 0 ? { thickness: Math.round(bar.border.width), color: toHex(bar.border.color) ?? background } : undefined
    const layout = {
        theme: floating ? "floating" : "classic",
        backgroundColor: background,
        selectedColor,
        unselectedColor,
    }
    const badgeBackground = toHex(bar.badge?.background)
    const badgeTextColor = toHex(bar.badge?.color)
    if (badgeBackground) layout.badgeBackground = badgeBackground
    if (badgeTextColor) layout.badgeTextColor = badgeTextColor

    // Bar height = paddingTop + iconSize (+ label) + paddingBottom: without labels, the store's height and icon size give the padding.
    const iconSize = mostCommon(items.map((i) => i.iconSize).filter((v) => v > 0)) ?? 24
    const padding = bar.labels ? undefined : Math.max(0, Math.round((height - iconSize) / 2))
    const sizing = { ...(iconSize !== 24 ? { iconSize } : {}), ...(padding !== undefined ? { paddingTop: padding, paddingBottom: padding } : {}) }

    const classic = {
        ...sizing,
        labels: bar.labels ? "shown" : "hidden",
        // A floating store bar has no top edge: a border in the bar's own color hides the classic one.
        topBorder: border ?? { thickness: floating ? 0 : 1, color: floating ? background : "#DBDDE0" },
    }
    layout.themeCustomizations = { classic }
    if (floating) {
        const pill = radius * 2 >= height - 1
        const spans = (bar.left ?? 0) > 0 && (bar.right ?? 0) > 0 && viewportWidth - sideGap * 2 >= viewportWidth * 0.8
        layout.themeCustomizations.floating = {
            ...sizing,
            bottomMargin: bottomGap,
            ...(pill ? {} : { cornerRadius: radius }),
            elevation: bar.shadow ? 3 : 0,
            stroke: bar.border?.width > 0 ? { width: Math.round(bar.border.width), color: toHex(bar.border.color) ?? background } : { width: 0 },
            tabWidth: spans ? "equal" : "content",
            labelVisibility: bar.labels ? "labeled" : "unlabeled",
            activeIndicator: hasIndicator ? { enabled: true } : { enabled: false },
        }
        if (hasIndicator && selectedColor !== indicator) layout.themeCustomizations.floating.activeIndicator.color = indicator
        if (hasIndicator && selectedColor === indicator)
            warnings.push(`The floating indicator is a tint of ${selectedColor}, not the store's solid ${indicator} with a ${toHex(active.color) ?? "light"} icon: a solid one would hide the icon on the classic fallback.`)
    }
    return { layout, warnings }
}

function mostCommon(values) {
    const counts = new Map()
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** The `initialization-params` string of a tab: `tabIndex=1&route=Categories`. */
export function initParamsString(initParams = {}) {
    return Object.entries(initParams)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : String(v))}`)
        .join("&")
}

/** dynamic-bottom-tab-view-spec.json from the config's dynamicBottomBar (layout + slug/title/icon/badge). */
export function specFromConfig(dynamicBottomBar) {
    if (!dynamicBottomBar?.eitriApps?.length) throw new Error("The config has no eitriConfig.dynamicBottomBar.eitriApps")
    return {
        ...(dynamicBottomBar.layout ? { layout: dynamicBottomBar.layout } : {}),
        eitriApps: dynamicBottomBar.eitriApps.map(({ slug, title, icon, badge }) => ({
            slug,
            title: title ?? "",
            ...(icon ? { icon } : {}),
            ...(badge !== undefined ? { badge } : {}),
        })),
    }
}

function yamlString(value) {
    return JSON.stringify(String(value))
}

/** The `bottom-tab-view-simulation:` block of app-config.yaml for these tabs. */
export function simulationBlock(eitriApps) {
    const lines = ["bottom-tab-view-simulation:", "  eitri-apps:"]
    for (const tab of eitriApps) {
        lines.push(`    - slug: ${yamlString(tab.slug)}`, `      title: ${yamlString(tab.title ?? "")}`)
        const params = initParamsString(tab.initParams)
        if (params) lines.push("      initialization-params:", '        type: "string"', `        value: ${yamlString(params)}`)
    }
    return lines.join("\n") + "\n"
}

/** Replaces (or appends) the top-level bottom-tab-view-simulation block, leaving the rest of the file as is. */
export function replaceSimulation(yaml, block) {
    const lines = yaml.split("\n")
    const start = lines.findIndex((l) => /^bottom-tab-view-simulation:\s*$/.test(l))
    if (start < 0) return yaml.replace(/\n*$/, "\n") + block
    let end = start + 1
    while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]))) end++
    // Keep one blank line before the next top-level key, as the template does.
    const next = lines.slice(end)
    return [...lines.slice(0, start), ...block.replace(/\n$/, "").split("\n"), ...(next.length ? ["", ...next] : [""])].join("\n")
}

/**
 * What a store tab opens, from its label and link: home, categories (also a search or menu tab),
 * wishlist, cart, account or offers — tabs the app has screens for — or help, notifications and
 * stores, which it has not; undefined when nothing says. Matching it to an app route is
 * the agent's call (references/bottom-bar.md → Tabs).
 */
export function tabKind(item) {
    const text = `${item.label ?? ""} ${item.href ?? ""}`.toLowerCase()
    const rules = [
        ["wishlist", /favorit|wishlist|lista de desejo|desejos|heart|wish/],
        ["cart", /carrinho|sacola|cart|bag|cesta|checkout/],
        ["help", /ajuda|help|atendimento|\bsac\b|fale conosco|suporte|support/],
        ["notifications", /alerta|notifica|avisos|notification|alert|inbox/],
        ["stores", /nossas lojas|lojas|store locator|encontre uma loja|onde comprar/],
        ["account", /conta|account|perfil|profile|login|entrar|minha|my |usu[aá]rio|user/],
        ["categories", /categor|menu|departament|buscar|busca|search|pesquis|explore/],
        ["offers", /oferta|promo|offer|sale|desconto|outlet/],
        ["home", /in[ií]cio|home|^\s*\/\s*$|principal/],
    ]
    for (const [kind, re] of rules) if (re.test(text)) return kind
    if ((item.href ?? "").replace(/^https?:\/\/[^/]+/, "") === "/") return "home"
    return undefined
}
