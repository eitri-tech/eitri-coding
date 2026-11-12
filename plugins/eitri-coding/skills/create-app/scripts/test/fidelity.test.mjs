import { test } from "node:test"
import assert from "node:assert/strict"
import { compareProbes } from "../lib/fidelity.mjs"

const text = (over = {}) => ({ text: "x", fontSize: 12, fontWeight: 300, fontFamily: "montserrat", textTransform: "none", color: "rgb(51, 51, 51)", letterSpacing: 0, lineHeight: 16, lines: 2, struck: false, ...over })
const block = (over = {}) => ({ box: [0, 0, 180, 300], background: null, radius: 0, borderWidth: 0, borderColor: null, shadow: false, ...over })
const store = {
    viewport: 375,
    cards: {
        count: 8,
        columns: 2,
        gapX: 8,
        gapY: 24,
        card: { block: block(), image: { ratio: 0.67, widthShare: 1, inset: 0, radius: 0 }, name: text(), price: text({ fontSize: 13, fontWeight: 600 }), listPrice: text({ fontSize: 11, struck: true }), installments: null, badge: { ...text({ text: "-40%", fontSize: 10 }), block: block({ background: "rgb(255, 234, 87)" }) }, wishlist: { size: 24 } },
    },
    pdp: null,
    listing: { title: text({ fontSize: 20 }), toolbar: { count: 2, ...block({ box: [0, 0, 100, 40], radius: "pill", borderWidth: 1 }), label: text({ fontSize: 14, fontWeight: 400 }) } },
}

test("identical probes match on every part", () => {
    const out = compareProbes(store, structuredClone(store), { screen: "listing" })
    assert.deepEqual(out.diffs, [])
    assert.ok(out.checked > 20, `${out.checked} checks`)
})

test("differences are named by part and property, with both values", () => {
    const app = structuredClone(store)
    app.cards.columns = 1
    app.cards.card.name.fontWeight = 600
    app.cards.card.name.fontSize = 14
    app.cards.card.image.ratio = 1
    app.cards.card.block = block({ radius: 8, shadow: true })
    app.cards.card.badge = null
    app.listing.toolbar.radius = 4
    const { diffs } = compareProbes(store, app, { screen: "listing" })
    const paths = diffs.map((d) => d.path)
    assert.deepEqual(paths.sort(), [
        "cards.card.badge",
        "cards.card.block.radius",
        "cards.card.block.shadow",
        "cards.card.image.ratio",
        "cards.card.name.fontSize",
        "cards.card.name.fontWeight",
        "cards.columns",
        "listing.toolbar.radius",
    ])
    const weight = diffs.find((d) => d.path === "cards.card.name.fontWeight")
    assert.deepEqual([weight.store, weight.app], [300, 600])
    assert.equal(diffs.find((d) => d.path === "cards.card.badge").why, "missing in the app")
})

test("tolerances: a pixel of size, a near color, a pill drawn at any radius; the store's absent parts are not checked", () => {
    const app = structuredClone(store)
    app.cards.card.name.fontSize = 12.5
    app.cards.card.name.color = "rgb(60, 60, 60)"
    app.cards.card.name.fontWeight = 350
    app.cards.gapX = 10
    app.cards.card.installments = text({ text: "6x" })
    app.listing.toolbar.radius = "pill"
    assert.deepEqual(compareProbes(store, app, { screen: "listing" }).diffs, [])
    const pdpStore = { viewport: 375, pdp: { title: text({ fontSize: 18 }), price: null, listPrice: null, installments: null, gallery: { ratio: 0.67, widthShare: 1 }, option: null, buyButton: { ...block({ box: [24, 900, 327, 56], radius: "pill", background: "rgb(51, 51, 51)" }), label: text({ fontSize: 14, color: "rgb(255, 255, 255)" }) } } }
    const pdpApp = structuredClone(pdpStore)
    pdpApp.pdp.buyButton.box = [16, 760, 343, 45]
    const { diffs } = compareProbes(pdpStore, pdpApp, { screen: "pdp" })
    assert.deepEqual(diffs.map((d) => d.path), ["pdp.buyButton.height"])
})

test("a screen the store has and the app does not render at all is one difference, not a crash", () => {
    const { diffs } = compareProbes(store, { viewport: 375, cards: null, pdp: null, listing: null }, { screen: "listing" })
    assert.deepEqual(diffs.map((d) => [d.path, d.why]), [
        ["cards", "missing in the app"],
        ["listing", "missing in the app"],
    ])
})
