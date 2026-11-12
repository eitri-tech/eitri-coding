import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import componentsProbe from "../lib/componentsProbe.mjs"

const here = dirname(fileURLToPath(import.meta.url))
// site-clone, in the same plugin, installs Playwright.
const { chromium } = createRequire(join(here, "../../../site-clone/scripts/package.json"))("playwright")

async function probe(fixture) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
        await page.goto(pathToFileURL(join(here, "fixtures", fixture)).href)
        return await page.evaluate(componentsProbe)
    } finally {
        await browser.close()
    }
}

test("probe on a listing: the card grid, each part of a card with its computed style, the title and the toolbar", { timeout: 60000 }, async () => {
    const out = await probe("listing.html")
    assert.equal(out.pdp, null)
    assert.equal(out.cards.count, 4)
    assert.equal(out.cards.columns, 2)
    assert.equal(out.cards.gapX, 8)
    assert.equal(out.cards.gapY, 24)
    const card = out.cards.card
    assert.equal(card.image.ratio, 0.67)
    assert.equal(card.image.widthShare, 1)
    assert.equal(card.name.fontSize, 12)
    assert.equal(card.name.fontWeight, 300)
    assert.equal(card.name.fontFamily, "montserrat")
    assert.equal(card.price.fontSize, 13)
    assert.equal(card.price.fontWeight, 600)
    assert.equal(card.listPrice.struck, true)
    assert.equal(card.badge.text, "-40%")
    assert.equal(card.badge.block.background, "rgb(255, 234, 87)")
    assert.equal(card.wishlist.size, 24)
    assert.equal(out.listing.title.text, "Jeans Refarm")
    assert.equal(out.listing.title.fontWeight, 300)
    assert.equal(out.listing.toolbar.count, 2)
    assert.equal(out.listing.toolbar.radius, "pill")
})

test("probe on a PDP built from divs (as Luminus renders): title, prices, gallery, size options and the buy button", { timeout: 60000 }, async () => {
    const out = await probe("pdp.html")
    const pdp = out.pdp
    assert.equal(pdp.title.text, "Short Jeans Artesanal Coqueiro")
    assert.equal(pdp.title.fontSize, 18)
    assert.equal(pdp.price.text, "R$ 298,80")
    assert.equal(pdp.listPrice.struck, true)
    assert.match(pdp.installments.text, /6x/)
    assert.equal(pdp.gallery.ratio, 0.67)
    assert.equal(pdp.option.count, 4)
    assert.equal(pdp.option.radius, "pill")
    assert.equal(pdp.option.box[2], 42, "the rendered size, borders included")
    assert.equal(pdp.buyButton.radius, "pill")
    assert.equal(pdp.buyButton.box[3], 56)
    assert.equal(pdp.buyButton.background, "rgb(51, 51, 51)")
    assert.equal(pdp.buyButton.label.text, "Adicionar na mochila")
    // The related shelf is a card grid too, and its prices are not the PDP's.
    assert.equal(out.cards.count, 2)
    assert.equal(out.listing, null)
})

test("probe on the app's markup (Luminus: divs with React handlers, no pointer cursor): drawn boxes count as buttons and options", { timeout: 60000 }, async () => {
    const { pdp } = await probe("luminus-pdp.html")
    assert.ok(pdp, "the PDP is found")
    assert.equal(pdp.buyButton.label.text, "Comprar")
    assert.equal(pdp.buyButton.box[3], 45)
    assert.equal(pdp.buyButton.radius, 8)
    assert.equal(pdp.option.count, 3)
    assert.equal(pdp.option.radius, 0)
    assert.equal(pdp.option.background, null, "the unselected look, shared by most options, not the preselected 34")
    assert.equal(pdp.title.fontWeight, 700)
    // The button itself, not the bar around it; colors in one format whatever the CSS wrote (DaisyUI: oklch).
    assert.match(pdp.buyButton.background, /^rgb\(5[01], 5[01], 5[01]\)$/)
})

test("probe on a listing whose first grid cell is an editorial banner: the grid still has its columns and gap", { timeout: 60000 }, async () => {
    const out = await probe("listing-banner-cell.html")
    assert.equal(out.cards.count, 5)
    assert.equal(out.cards.columns, 2, "the first card sits alone in its row, next to the banner")
    assert.equal(out.cards.gapX, 8)
    assert.equal(out.cards.gapY, 24)
})

test("probe on a listing whose cards show color swatches next to the name: the card is the whole item, its image the product photo", { timeout: 60000 }, async () => {
    const out = await probe("listing-swatches.html")
    assert.equal(out.cards.count, 4)
    assert.equal(out.cards.columns, 2)
    assert.equal(out.cards.gapY, 24)
    assert.equal(out.cards.card.image.widthShare, 1)
    assert.equal(out.cards.card.image.ratio, 0.67)
})

test("probe on a PDP with round icon buttons over the gallery and color swatches above the sizes: the options are the labelled sizes", { timeout: 60000 }, async () => {
    const { pdp } = await probe("pdp-icon-buttons.html")
    assert.equal(pdp.option.count, 4, "the size buttons, not the wishlist/share icons nor the swatches")
    assert.equal(pdp.option.label.text, "38")
    assert.equal(pdp.option.box[2], 54)
    assert.equal(pdp.option.radius, 0)
    assert.equal(pdp.option.borderWidth, 1)
    assert.equal(pdp.option.label.fontSize, 16)
})
