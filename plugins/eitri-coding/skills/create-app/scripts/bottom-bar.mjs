#!/usr/bin/env node
// The app's native bottom bar, made as close as the platform allows to the store's mobile tab bar.
// Rules and limits: references/bottom-bar.md.
//
//   node bottom-bar.mjs capture --capture scrape/home [--url <page url>] [--out .eitri/bottom-bar] [--width 375] [--height 812]
//       Opens the captured page live (its URL from the capture's manifest; the rendered DOM is the fallback) at phone size, finds the store's bottom tab bar (a fixed or
//       sticky bar at the bottom with three or more icon buttons), and writes to <out>:
//         bar.json        its measurements, its tabs (label, link, kind, active) and the closest
//                         dynamicBottomBar `layout`, with the warnings of what differs
//         store-bar.png   the bar as the store draws it (to compare with the app)
//         icons/NN-<kind>.png  each tab's icon as the bar needs it: 96×96 PNG, transparent, one flat black
//       Exit 0 with a bar, 2 when the page has none (the app keeps the template's bar; say so in the handoff).
//
//   node bottom-bar.mjs apply --config <remote-config.json> --bar <bar.json> [--icon <tab>=<https url> …]
//       Writes the bar's layout into eitriConfig.dynamicBottomBar and each given tab icon (tab = index
//       in eitriApps). Every icon URL is checked: https, answers 200 with a PNG.
//
//   node bottom-bar.mjs sync --repo . [--config <file>] [--check]
//       Writes dynamic-bottom-tab-view-spec.json and app-config.yaml's bottom-tab-view-simulation from the
//       config's dynamicBottomBar (default config: .eitri/remote-config.json, else remoteConfig.json).
//       `eitri app start` and snapshots REPLACE the environment's bar with these files, so a stale
//       spec is what Eitri Play shows. --check only compares: exit 1 when they differ.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deriveLayout, replaceSimulation, simulationBlock, specFromConfig, tabKind } from "./lib/bottomBar.mjs"
import { loadChromium } from "./lib/iconRender.mjs"
import { MOBILE_UA } from "./lib/http.mjs"

const ICON_SIDE = 96

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

function options(args, name) {
    return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []))
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"))
}

/* Runs in the page: finds the bottom tab bar and measures it. */
function probe() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const visible = (el) => {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05 && r.width > 0 && r.height > 0
    }
    const opaque = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c)
        if (!m) return false
        const p = m[1].split(/[\s,/]+/).map(Number)
        return p.length < 4 || p[3] > 0.5
    }
    const clickables = (root) => {
        const all = [...root.querySelectorAll("a, button, [role=tab], [role=button], [role=link]")].filter(visible)
        return all.filter((el) => !all.some((o) => o !== el && o.contains(el)) && el.querySelector("svg, img"))
    }
    const bars = [...document.querySelectorAll("body *")]
        .filter((el) => {
            const cs = getComputedStyle(el)
            if (cs.position !== "fixed" && cs.position !== "sticky") return false
            if (!visible(el)) return false
            const r = el.getBoundingClientRect()
            return r.height >= 30 && r.height <= 140 && r.width >= vw * 0.5 && r.bottom >= vh - 200 && r.top >= vh * 0.5
        })
        .map((el) => ({ el, items: clickables(el) }))
        .filter((b) => b.items.length >= 3)
        .sort((a, b) => b.items.length - a.items.length)
    const found = bars[0]
    if (!found) return null
    const { el, items } = found
    found.el.setAttribute("data-bottom-bar-probe", "bar")

    // The painted surface: the bar itself or the first descendant covering it with an opaque color.
    const r = el.getBoundingClientRect()
    let surface = el
    if (!opaque(getComputedStyle(el).backgroundColor)) {
        surface =
            [...el.querySelectorAll("*")].find((d) => {
                const dr = d.getBoundingClientRect()
                return opaque(getComputedStyle(d).backgroundColor) && dr.width >= r.width * 0.9 && dr.height >= r.height * 0.8
            }) ?? el
    }
    const scs = getComputedStyle(surface)
    const sr = surface.getBoundingClientRect()
    const activeAttr = (node) =>
        [node, ...node.querySelectorAll("*")].some((n) =>
            [...n.attributes].some(
                (a) =>
                    (/active|current|selected/i.test(a.name) && a.value !== "false") ||
                    (a.name === "aria-current" && a.value !== "false") ||
                    (a.name === "class" && /(^|[\s_-])(active|selected|current)([\s_-]|$)/i.test(a.value)),
            ),
        )
    const measured = items.map((item, index) => {
        item.setAttribute("data-bottom-bar-probe", `item-${index}`)
        const cs = getComputedStyle(item)
        const icon = item.querySelector("svg, img")
        // The circle/pill behind an active icon is the item or a child of it with its own background.
        const painted = [item, ...item.querySelectorAll("*")].find((n) => opaque(getComputedStyle(n).backgroundColor) && !/^\s*\d+\s*$/.test(n.textContent))
        const text = [...item.querySelectorAll("*")]
            .filter((n) => n.children.length === 0 && visible(n) && n.textContent.trim() && !/^\s*\d+\+?\s*$/.test(n.textContent))
            .map((n) => n.textContent.trim())
            .join(" ")
        const badge = [...item.querySelectorAll("*")].find((n) => visible(n) && /^\s*\d+\+?\s*$/.test(n.textContent) && n.children.length === 0)
        let badgeColors
        if (badge) {
            let n = badge
            while (n && n !== item && !opaque(getComputedStyle(n).backgroundColor)) n = n.parentElement
            badgeColors = { background: n && n !== item ? getComputedStyle(n).backgroundColor : undefined, color: getComputedStyle(badge).color }
        }
        return {
            index,
            label: item.getAttribute("aria-label") || item.getAttribute("title") || text || "",
            href: item.getAttribute("href") || "",
            activeAttr: activeAttr(item),
            color: getComputedStyle(icon).color || cs.color,
            background: painted ? getComputedStyle(painted).backgroundColor : "rgba(0, 0, 0, 0)",
            text,
            badge: badgeColors,
            iconTag: icon.tagName.toLowerCase(),
            // A center "action" button sticks out above the bar.
            raised: [item, ...item.querySelectorAll("*")].some((n) => visible(n) && n.getBoundingClientRect().top < r.top - 4),
            iconSize: Math.round(Math.max(icon.getBoundingClientRect().width, icon.getBoundingClientRect().height)),
        }
    })
    // No attribute says which tab is active: the one painted differently from the others.
    if (!measured.some((m) => m.activeAttr)) {
        const counts = {}
        for (const m of measured) counts[m.background] = (counts[m.background] ?? 0) + 1
        // Painted like the bar itself is not an indicator (a raised center button is a white circle on a white bar).
        const odd = measured.filter((m) => counts[m.background] === 1 && opaque(m.background) && m.background !== scs.backgroundColor)
        if (odd.length === 1) odd[0].activeAttr = true
    }
    const border = parseFloat(scs.borderTopWidth) || 0
    return {
        tag: el.tagName.toLowerCase(),
        viewportWidth: vw,
        viewportHeight: vh,
        background: scs.backgroundColor,
        radius: parseFloat(scs.borderTopLeftRadius) || 0,
        height: sr.height,
        left: sr.left,
        right: vw - sr.right,
        bottom: vh - sr.bottom,
        shadow: scs.boxShadow && scs.boxShadow !== "none" ? scs.boxShadow : null,
        border: { width: border, color: border ? scs.borderTopColor : null },
        labels: measured.some((m) => m.text),
        badge: measured.find((m) => m.badge?.background)?.badge,
        items: measured.map(({ activeAttr, ...m }) => ({ ...m, active: activeAttr })),
    }
}

/* Runs in the page: the icon of item `index` as a 96×96 PNG, transparent, one flat black. */
async function rasterize({ index, side }) {
    const item = document.querySelector(`[data-bottom-bar-probe="item-${index}"]`)
    const icon = item.querySelector("svg, img")
    let src
    let box
    if (icon.tagName.toLowerCase() === "svg") {
        const clone = icon.cloneNode(true)
        // Page CSS does not reach a standalone SVG: carry each shape's computed paint over.
        const originals = [icon, ...icon.querySelectorAll("*")]
        const copies = [clone, ...clone.querySelectorAll("*")]
        originals.forEach((o, i) => {
            const cs = getComputedStyle(o)
            for (const prop of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "opacity", "display"]) {
                const v = cs.getPropertyValue(prop)
                if (v) copies[i].setAttribute(prop, v)
            }
        })
        const vb = icon.viewBox?.baseVal
        const r = icon.getBoundingClientRect()
        box = vb && vb.width && vb.height ? { w: vb.width, h: vb.height } : { w: r.width || 24, h: r.height || 24 }
        if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${box.w} ${box.h}`)
        clone.setAttribute("width", String(side))
        clone.setAttribute("height", String(Math.round((side * box.h) / box.w)))
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
        clone.style.color = "#000"
        src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone).replaceAll("currentColor", "#000"))
    } else {
        src = icon.currentSrc || icon.src
    }
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = src
    await img.decode()
    const w = img.naturalWidth || side
    const h = img.naturalHeight || side
    const scale = Math.min(side / w, side / h)
    const canvas = Object.assign(document.createElement("canvas"), { width: side, height: side })
    const ctx = canvas.getContext("2d")
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(img, (side - w * scale) / 2, (side - h * scale) / 2, w * scale, h * scale)
    // One flat color: the bar repaints the icon, only its alpha matters.
    ctx.globalCompositeOperation = "source-in"
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, side, side)
    return canvas.toDataURL("image/png")
}

async function capture(args) {
    const dir = option(args, "--capture")
    if (!dir) throw new Error("missing --capture <scrape/home>")
    // The live page is measured: a phone-only tab bar lives in a media query, which snapshot.html's
    // used.css flattens, and the store's stylesheets do not load outside its origin. The capture's
    // rendered DOM (store CSS, no scripts) is the fallback when the page cannot be opened.
    const manifest = existsSync(join(dir, "manifest.json")) ? readJson(join(dir, "manifest.json")) : {}
    const url = option(args, "--url") ?? manifest.url
    if (!url) throw new Error(`No page URL: ${dir}/manifest.json has none, pass --url`)
    const html = join(dir, "page.rendered.html")
    const out = option(args, "--out") ?? ".eitri/bottom-bar"
    const width = Number(option(args, "--width") ?? 375)
    const height = Number(option(args, "--height") ?? 812)

    const chromium = await loadChromium()
    if (!chromium) throw new Error("Playwright is not installed: see site-clone's scripts (npm ci && npx playwright install chromium).")
    const browser = await chromium.launch()
    try {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_UA, locale: "pt-BR" })
        const page = await context.newPage()
        let source = url
        let bar = null
        try {
            await page.goto(url, { waitUntil: "load", timeout: 60000 })
            await page.waitForTimeout(2500)
            bar = await page.evaluate(probe)
        } catch {}
        if (!bar && existsSync(html)) {
            source = html
            const markup = readFileSync(html, "utf8")
                .replace(/<script\b[\s\S]*?<\/script>/gi, "")
                .replace(/\s(?:crossorigin|integrity)(?:="[^"]*")?/gi, "")
                .replace(/<head([^>]*)>/i, `<head$1><base href="${url.replace(/"/g, "&quot;")}">`)
            await page.setContent(markup, { waitUntil: "load", timeout: 60000 }).catch(() => {})
            await page.waitForTimeout(500)
            bar = await page.evaluate(probe)
        }
        if (!bar) {
            console.log(JSON.stringify({ found: false, page: source, note: "No fixed bottom bar with three or more icon buttons at this width: the app keeps the template's bar." }, null, 2))
            return 2
        }
        // A rerun replaces the icons: a tab whose kind changed must not leave its old file behind.
        rmSync(join(out, "icons"), { recursive: true, force: true })
        mkdirSync(join(out, "icons"), { recursive: true })
        // Cookie banners, chat launchers and popups sit over the bar: hide every other fixed layer for the picture.
        await page.evaluate(() => {
            const bar = document.querySelector('[data-bottom-bar-probe="bar"]')
            for (const el of document.querySelectorAll("body *")) {
                if (el.contains(bar) || bar.contains(el)) continue
                const position = getComputedStyle(el).position
                if (position === "fixed" || position === "sticky") el.style.setProperty("opacity", "0", "important")
            }
        })
        await page.locator('[data-bottom-bar-probe="bar"]').screenshot({ path: join(out, "store-bar.png") }).catch(() => {})
        const tabs = []
        for (const item of bar.items) {
            const kind = tabKind(item) ?? `tab${item.index + 1}`
            const file = join(out, "icons", `${String(item.index + 1).padStart(2, "0")}-${kind}.png`)
            const dataUrl = await page.evaluate(rasterize, { index: item.index, side: ICON_SIDE })
            writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"))
            tabs.push({ index: item.index, label: item.label, href: item.href, kind, active: item.active, icon: file })
        }
        const { layout, warnings } = deriveLayout(bar)
        const result = { found: true, page: source, viewport: { width, height }, bar, tabs, layout, warnings, storeBar: join(out, "store-bar.png") }
        writeFileSync(join(out, "bar.json"), JSON.stringify(result, null, 2) + "\n")
        console.log(JSON.stringify(result, null, 2))
        return 0
    } finally {
        await browser.close()
    }
}

async function checkIcon(url) {
    if (!/^https:\/\//.test(url)) return `${url}: the bar needs an https URL`
    try {
        const res = await fetch(url, { redirect: "follow" })
        if (res.status !== 200) return `${url}: answered ${res.status}`
        const bytes = new Uint8Array(await res.arrayBuffer())
        const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        if (!png) return `${url}: not a PNG`
        const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
        const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
        if (w !== h) return `${url}: ${w}×${h}, not square`
        // Alpha: RGBA (6), gray + alpha (4), or a palette/gray/RGB image with a tRNS chunk.
        const hasTrns = () => {
            for (let i = 8; i + 8 <= bytes.length; ) {
                const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]
                const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
                if (type === "tRNS") return true
                if (type === "IDAT" || type === "IEND") return false
                i += 12 + len
            }
            return false
        }
        if (bytes[25] !== 6 && bytes[25] !== 4 && !hasTrns()) return `${url}: no alpha channel (an opaque icon paints a square)`
        return undefined
    } catch (e) {
        return `${url}: ${e.message}`
    }
}

async function apply(args) {
    const configPath = option(args, "--config")
    const barPath = option(args, "--bar")
    if (!configPath || !barPath) throw new Error("usage: apply --config <file> --bar <bar.json> [--icon <tab>=<url> …]")
    const config = readJson(configPath)
    const bar = readJson(barPath)
    // remote-config.mjs writes { config, needs, warnings }; the template's remoteConfig.json is the bare config.
    const dbb = (config.config ?? config).eitriConfig?.dynamicBottomBar
    if (!dbb?.eitriApps?.length) throw new Error(`${configPath} has no eitriConfig.dynamicBottomBar.eitriApps`)
    const errors = []
    for (const pair of options(args, "--icon")) {
        const [index, url] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]
        const tab = dbb.eitriApps[Number(index)]
        if (!tab) {
            errors.push(`--icon ${pair}: no tab ${index}`)
            continue
        }
        const problem = await checkIcon(url)
        if (problem) errors.push(problem)
        else tab.icon = url
    }
    if (errors.length) {
        console.error(errors.join("\n"))
        return 1
    }
    dbb.layout = bar.layout
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    console.log(JSON.stringify({ config: configPath, layout: dbb.layout, tabs: dbb.eitriApps.map(({ slug, title, icon, initParams }) => ({ slug, title, icon, initParams })), warnings: bar.warnings ?? [] }, null, 2))
    return 0
}

function sync(args) {
    const repo = option(args, "--repo") ?? "."
    const configPath = option(args, "--config") ?? [".eitri/remote-config.json", "remoteConfig.json"].map((p) => join(repo, p)).find(existsSync)
    if (!configPath) throw new Error("No config: pass --config (or create .eitri/remote-config.json)")
    const config = readJson(configPath)
    const root = config.config ?? config
    const dbb = root.eitriConfig?.dynamicBottomBar ?? root.dynamicBottomBar
    const spec = JSON.stringify(specFromConfig(dbb), null, 2) + "\n"
    const yamlPath = join(repo, "app-config.yaml")
    const specPath = join(repo, "dynamic-bottom-tab-view-spec.json")
    const yaml = readFileSync(yamlPath, "utf8")
    const nextYaml = replaceSimulation(yaml, simulationBlock(dbb.eitriApps))
    const currentSpec = existsSync(specPath) ? readFileSync(specPath, "utf8") : ""
    const stale = []
    if (JSON.stringify(JSON.parse(currentSpec || "null")) !== JSON.stringify(JSON.parse(spec))) stale.push(specPath)
    if (yaml !== nextYaml) stale.push(yamlPath)
    if (args.includes("--check")) {
        console.log(JSON.stringify({ config: configPath, inSync: stale.length === 0, stale }, null, 2))
        return stale.length ? 1 : 0
    }
    if (stale.includes(specPath)) writeFileSync(specPath, spec)
    if (stale.includes(yamlPath)) writeFileSync(yamlPath, nextYaml)
    console.log(JSON.stringify({ config: configPath, written: stale }, null, 2))
    return 0
}

const [command, ...args] = process.argv.slice(2)
const commands = { capture, apply, sync }
if (!commands[command]) {
    console.error("usage: bottom-bar.mjs capture|apply|sync … (see the header of this file)")
    process.exit(64)
}
try {
    process.exit(await commands[command](args))
} catch (e) {
    console.error(e.message)
    process.exit(1)
}
