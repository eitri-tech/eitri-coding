import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { contrast, deriveLayout, initParamsString, replaceSimulation, simulationBlock, specFromConfig, tabKind, toHex } from "../lib/bottomBar.mjs"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "bottom-bar.mjs")

const navy = "rgb(26, 40, 91)"
const yellow = "rgb(247, 220, 22)"
const clear = "rgba(0, 0, 0, 0)"

// A floating yellow pill: 16 px from each side, 12 px from the bottom, white icon on a navy circle when active.
const pill = {
    viewportWidth: 375,
    background: yellow,
    radius: 999,
    height: 52,
    left: 16,
    right: 16,
    bottom: 12,
    shadow: "rgba(0, 0, 0, 0.16) 0px 4px 16px 0px",
    border: { width: 0 },
    labels: false,
    badge: { background: navy, color: "rgb(255, 255, 255)" },
    items: [
        { active: true, color: "rgb(255, 255, 255)", background: navy, iconSize: 24 },
        { active: false, color: navy, background: clear, iconSize: 24 },
        { active: false, color: navy, background: clear, iconSize: 24 },
    ],
}

test("colors: rgb()/hex parsing and contrast", () => {
    assert.equal(toHex(yellow), "#F7DC16")
    assert.equal(toHex("#abc"), "#AABBCC")
    assert.equal(toHex(clear), undefined)
    assert.equal(contrast("#000000", "#FFFFFF"), 21)
})

test("a detached pill becomes the floating theme, with a classic fallback", () => {
    const { layout, warnings } = deriveLayout(pill)
    assert.equal(layout.theme, "floating")
    assert.equal(layout.backgroundColor, "#F7DC16")
    assert.equal(layout.badgeBackground, "#1A285B")
    assert.equal(layout.badgeTextColor, "#FFFFFF")
    const floating = layout.themeCustomizations.floating
    assert.equal(floating.bottomMargin, 12)
    // 52 px tall with 24 px icons and no labels: 14 above and below, like the store.
    assert.equal(floating.paddingTop, 14)
    assert.equal(floating.paddingBottom, 14)
    assert.equal(floating.iconSize, undefined, "24 is the default")
    assert.equal(floating.cornerRadius, undefined, "a pill is the default radius")
    assert.equal(floating.elevation, 3)
    assert.equal(floating.tabWidth, "equal")
    assert.equal(floating.labelVisibility, "unlabeled")
    assert.equal(floating.activeIndicator.enabled, true)
    assert.deepEqual(layout.themeCustomizations.classic, { paddingTop: 14, paddingBottom: 14, labels: "hidden", topBorder: { thickness: 0, color: "#F7DC16" } })
    // White on yellow would vanish on the classic fallback: the indicator's navy is the selected color.
    assert.equal(layout.selectedColor, "#1A285B")
    assert.ok(contrast(layout.selectedColor, layout.backgroundColor) >= 3)
    assert.ok(warnings.some((w) => w.includes("reads only on its indicator")))
})

test("a bar glued to the bottom stays classic and keeps a readable selected color", () => {
    const { layout } = deriveLayout({
        viewportWidth: 375,
        background: "rgb(255, 255, 255)",
        radius: 0,
        height: 60,
        left: 0,
        right: 0,
        bottom: 0,
        shadow: null,
        border: { width: 1, color: "rgb(219, 221, 224)" },
        labels: true,
        items: [
            { active: true, color: "rgb(204, 0, 0)", background: clear },
            { active: false, color: "rgb(51, 51, 51)", background: clear },
            { active: false, color: "rgb(51, 51, 51)", background: clear },
        ],
    })
    assert.equal(layout.theme, "classic")
    assert.equal(layout.themeCustomizations.floating, undefined)
    assert.equal(layout.selectedColor, "#CC0000")
    assert.equal(layout.unselectedColor, "#333333")
    assert.deepEqual(layout.themeCustomizations.classic, { labels: "shown", topBorder: { thickness: 1, color: "#DBDDE0" } })
})

test("no marked tab and a raised center button are reported, not guessed", () => {
    const { layout, warnings } = deriveLayout({
        ...pill,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgb(255, 255, 255)",
        labels: true,
        items: [
            { label: "Home", active: false, color: "rgb(63, 68, 68)", background: clear },
            { label: "Carrinho", active: false, raised: true, color: "rgb(63, 68, 68)", background: "rgb(255, 255, 255)" },
            { label: "Conta", active: false, color: "rgb(63, 68, 68)", background: clear },
        ],
    })
    assert.equal(layout.theme, "classic")
    assert.equal(layout.selectedColor, "#3F4444")
    assert.ok(warnings.some((w) => w.includes("marks no open tab")))
    assert.ok(warnings.some((w) => w.includes('"Carrinho" is a raised center button')))
})

test("a rounded card bar keeps its radius", () => {
    const { layout } = deriveLayout({ ...pill, radius: 12 })
    assert.equal(layout.themeCustomizations.floating.cornerRadius, 12)
})

test("tab kinds from labels and links", () => {
    assert.equal(tabKind({ label: "Início", href: "/" }), "home")
    assert.equal(tabKind({ label: "Buscar" }), "categories")
    assert.equal(tabKind({ label: "Favoritos", href: "https://x/account/#wishlist" }), "wishlist")
    assert.equal(tabKind({ label: "Carrinho" }), "cart")
    assert.equal(tabKind({ label: "Minha conta", href: "#" }), "account")
    assert.equal(tabKind({ label: "", href: "https://store.com/" }), "home")
    assert.equal(tabKind({ label: "Ajuda", href: "#modal-ajuda" }), "help")
    assert.equal(tabKind({ label: "Alertas" }), "notifications")
    assert.equal(tabKind({ label: "???" }), undefined)
})

const bar = {
    layout: { theme: "classic", backgroundColor: "#F7DC16" },
    eitriApps: [
        { slug: "x-home", title: "Início", icon: "https://a/home.png", initParams: { tabIndex: 0 } },
        { slug: "x-home", title: "Buscar", icon: "https://a/s.png", initParams: { tabIndex: 1, route: "Categories" } },
        { slug: "x-cart", title: "Carrinho", initParams: { tabIndex: 2 } },
    ],
}

test("spec and simulation from the config", () => {
    assert.equal(initParamsString({ tabIndex: 1, route: "Categories" }), "tabIndex=1&route=Categories")
    assert.deepEqual(specFromConfig(bar), {
        layout: bar.layout,
        eitriApps: [
            { slug: "x-home", title: "Início", icon: "https://a/home.png" },
            { slug: "x-home", title: "Buscar", icon: "https://a/s.png" },
            { slug: "x-cart", title: "Carrinho" },
        ],
    })
    const block = simulationBlock(bar.eitriApps)
    assert.match(block, /^bottom-tab-view-simulation:\n {2}eitri-apps:\n {4}- slug: "x-home"\n {6}title: "Início"\n {6}initialization-params:\n {8}type: "string"\n {8}value: "tabIndex=0"\n/)
    assert.throws(() => specFromConfig({ layout: {} }), /eitriApps/)
})

test("replaceSimulation keeps the rest of app-config.yaml", () => {
    const yaml = `eitri-apps:\n    - path: ./home\n      alias: home\nbottom-tab-view-simulation:\n  eitri-apps:\n    - slug: "old"\n      title: "Old"\n\napplication-id: abc\n`
    const next = replaceSimulation(yaml, simulationBlock(bar.eitriApps))
    assert.ok(next.startsWith("eitri-apps:\n    - path: ./home\n      alias: home\nbottom-tab-view-simulation:\n"))
    assert.ok(!next.includes('"old"'))
    assert.ok(next.endsWith('value: "tabIndex=2"\n\napplication-id: abc\n'))
    assert.equal(replaceSimulation(next, simulationBlock(bar.eitriApps)), next, "idempotent")
    assert.ok(replaceSimulation("eitri-apps: []\n", simulationBlock(bar.eitriApps)).includes("bottom-tab-view-simulation:"))
})

test("sync writes the spec and the simulation; --check reports drift", () => {
    const repo = mkdtempSync(join(tmpdir(), "bottom-bar-"))
    writeFileSync(join(repo, "app-config.yaml"), `eitri-apps:\n    - path: ./home\nbottom-tab-view-simulation:\n  eitri-apps:\n    - slug: "old"\n      title: "Old"\n\napplication-id: abc\n`)
    writeFileSync(join(repo, "dynamic-bottom-tab-view-spec.json"), JSON.stringify({ layout: { backgroundColor: "#FFFFFF" }, eitriApps: [{ slug: "old", title: "Old" }] }))
    // remote-config.mjs's envelope: { config, needs, warnings }.
    writeFileSync(join(repo, "config.json"), JSON.stringify({ config: { eitriConfig: { dynamicBottomBar: bar } }, needs: [], warnings: [] }))
    const run = (...args) => spawnSync(process.execPath, [script, "sync", "--repo", repo, "--config", join(repo, "config.json"), ...args], { encoding: "utf8" })

    assert.equal(run("--check").status, 1)
    assert.equal(run().status, 0)
    assert.equal(run("--check").status, 0)
    const spec = JSON.parse(readFileSync(join(repo, "dynamic-bottom-tab-view-spec.json"), "utf8"))
    assert.equal(spec.layout.backgroundColor, "#F7DC16")
    assert.deepEqual(spec.eitriApps.map((t) => t.title), ["Início", "Buscar", "Carrinho"])
    const yaml = readFileSync(join(repo, "app-config.yaml"), "utf8")
    assert.ok(yaml.includes('value: "tabIndex=1&route=Categories"'))
    assert.ok(yaml.endsWith("\napplication-id: abc\n"))
})
