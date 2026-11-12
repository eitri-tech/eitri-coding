import { test } from "node:test"
import assert from "node:assert/strict"
import { detectIntegrations, INTEGRATIONS } from "../lib/integrations.mjs"

// Request URLs from www.oceane.com.br's capture (Nov 2026), trimmed.
const OCEANE = [
    "https://api-product-reviews.cxr.skeepers.io/v1/websites/969384d1-eb8a-64e4-a1f2-c46b29a4d241/products/ratings?ref=40951,182407",
    "https://widgets.rr.skeepers.io/product/969384d1-eb8a-64e4-a1f2-c46b29a4d241/stars.a197ef64.js",
    "https://cdn.widde.io/widde.1.1.0.js?v=1.0",
    "https://api-admin.widde.io/api/story/stories-collection/_?url=https%3A%2F%2Fwww.oceane.com.br&loadStories=true",
    "https://cdn.atendimen.to/widget/ca74ccf913dc85d0b6669a7c831e6e22/current?v=202604",
    "https://www.clarity.ms/tag/abc123xyz",
    "https://analytics.google.com/g/collect?v=2&tid=G-LFT5TQ2CQY&gtm=45je6",
    "https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234",
    "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=D0QVVGBC77UEAB187K3G&lib=ttq",
    "https://bat.bing.com/p/action/343005348.js",
    "https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=6LdV7CIpAAAAAPUrHXWlFArQ5hSiNQJk6Ja-vcYM&co=x",
    "https://connect.facebook.net/en_US/fbevents.js",
    "https://oceane.vtexassets.com/arquivos/logo.png",
]

const byId = (list) => Object.fromEntries(list.map((i) => [i.id, i]))

test("Skeepers reviews: detected with its website id and integrated (the app's reviews add-on reads it)", () => {
    const found = byId(detectIntegrations({ urls: OCEANE }))
    assert.deepEqual(found.skeepers.config, { websiteId: "969384d1-eb8a-64e4-a1f2-c46b29a4d241" })
    assert.equal(found.skeepers.category, "reviews")
    assert.equal(found.skeepers.support, "integrated")
    assert.deepEqual(found.skeepers.remoteConfig, { "appConfigs.reviews": { provider: "skeepers", websiteId: "969384d1-eb8a-64e4-a1f2-c46b29a4d241" } })
    assert.ok(found.skeepers.evidence.length >= 1)
})

test("a shoppable-video widget and a chat are reported as not integrated, with what it would take", () => {
    const found = byId(detectIntegrations({ urls: OCEANE }))
    assert.equal(found.widde.support, "none")
    assert.equal(found.widde.category, "video")
    assert.match(found.widde.note, /VideoStories/)
    assert.equal(found.atendimento.category, "chat")
    assert.equal(found.atendimento.support, "none")
})

test("analytics and pixels need the native app build; their ids are extracted", () => {
    const found = byId(detectIntegrations({ urls: OCEANE }))
    assert.deepEqual(found.ga4.config, { measurementId: "G-LFT5TQ2CQY" })
    assert.equal(found.ga4.support, "native")
    assert.deepEqual(found.gtm.config, { containerId: "GTM-ABC1234" })
    assert.deepEqual(found.tiktok.config, { pixelId: "D0QVVGBC77UEAB187K3G" })
    assert.deepEqual(found.bing.config, { tagId: "343005348" })
    assert.ok(found.meta)
})

test("Clarity and reCAPTCHA map onto template config but stay opt-in (the store decides)", () => {
    const found = byId(detectIntegrations({ urls: OCEANE }))
    assert.equal(found.clarity.support, "config")
    assert.deepEqual(found.clarity.remoteConfig, { "appConfigs.clarityId": "abc123xyz" })
    assert.equal(found.recaptcha.support, "config")
    assert.deepEqual(found.recaptcha.config, { siteKey: "6LdV7CIpAAAAAPUrHXWlFArQ5hSiNQJk6Ja-vcYM", enterprise: true })
    assert.match(found.recaptcha.note, /domain/)
})

test("the store's own hosts are not integrations; each integration is listed once", () => {
    const found = detectIntegrations({ urls: [...OCEANE, ...OCEANE] })
    assert.equal(found.filter((i) => i.id === "skeepers").length, 1)
    assert.ok(!found.some((i) => /vtexassets/.test(i.evidence.join(" "))))
})

test("other review providers are recognized and reported as not integrated", () => {
    const found = byId(
        detectIntegrations({
            urls: [
                "https://staticw2.yotpo.com/AbCdEf123/widget.js",
                "https://trustvox.com.br/widget/root.js",
                "https://cdn.judge.me/widget.js",
                "https://api.konfidency.com.br/x",
            ],
        }),
    )
    assert.deepEqual(found.yotpo.config, { appKey: "AbCdEf123" })
    for (const id of ["yotpo", "trustvox", "judgeme", "konfidency"]) {
        assert.equal(found[id].category, "reviews")
        assert.equal(found[id].support, "none")
    }
})

test("custom elements in the DOM count as evidence (a widget that loaded no request yet)", () => {
    const found = byId(detectIntegrations({ urls: [], customElements: ["widde-pro-carousel", "x-unknown"] }))
    assert.ok(found.widde)
    assert.match(found.widde.evidence.join(" "), /widde-pro-carousel/)
})

test("every signature has a category, a support level and a note for anything not integrated", () => {
    for (const sig of INTEGRATIONS) {
        assert.ok(sig.category, sig.id)
        assert.ok(["integrated", "config", "native", "none"].includes(sig.support), sig.id)
        if (sig.support !== "integrated") assert.ok(sig.note, `${sig.id} needs a note`)
    }
})
