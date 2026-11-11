import { test } from "node:test"
import assert from "node:assert/strict"
import { buildRemoteConfig } from "../lib/remoteConfig.mjs"

// Trimmed from each template repo's remoteConfig.json (eitri-tech/eitri-shopping-template*, Nov 2026).
const VTEX_TEMPLATE = {
    ecommerceProvider: "VTEX",
    providerInfo: { account: "mundoverde", faststore: "mundoverde", host: "https://www.mundoverde.com.br", vtexCmsUrl: "https://eitripartnerbr.myvtex.com/" },
    appConfigs: {
        useScrollEffect: true,
        statusBarTextColor: "white",
        headerLogo: "https://framerusercontent.com/images/srQA8vHpVggDBFZ60DgGnWDxuT0.svg",
        checkout: { recaptchaKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    },
    eitriConfig: {
        mainApp: "eitri-shopping-home",
        renderFakeBottomBar: true,
        dynamicBottomBar: {
            layout: { theme: "classic" },
            eitriApps: [
                { slug: "eitri-shopping-home", title: "Inicio", initParams: { tabIndex: 0 } },
                { slug: "eitri-shopping-cart", title: "Carrinho", initParams: { tabIndex: 2 } },
                { slug: "eitri-shopping-account", title: "Perfil", initParams: { tabIndex: 4 } },
            ],
        },
    },
    storePreferences: {},
    deeplinkResolver: { slug: "deeplink-resolver" },
}

const WAKE_TEMPLATE = {
    ecommerceProvider: "WAKE",
    providerInfo: {
        account: "balaroti",
        host: "https://www.balaroti.com.br",
        eitriContentCmsUrl: "https://implantacao-content.eitri.tech/api/wake-cms-pages?where[type][equals]=balaroti",
        tcs_account: "tcs_balar_4e61440fe3d84744be0d8e52b74689b3",
        partnerByRegion: true,
    },
    storePreferences: { countryCode: "BRA", currencyCode: "BRL", currencySymbol: "R$", locale: "pt-BR" },
    appConfigs: { headerName: "Balaroti", headerLogo: "https://forge-assets.eitri.tech/store_icons/balaroti.png" },
    eitriConfig: { mainApp: "home", dynamicBottomBar: { eitriApps: [{ slug: "home" }, { slug: "cart" }, { slug: "account" }] } },
}

const SHOPIFY_TEMPLATE = {
    ecommerceProvider: null,
    providerInfo: {
        ecommerceProvider: "SHOPIFY",
        apiVersion: "2026-01",
        host: "www.dlkmodas.com.br",
        storefrontAccessToken: "",
        cmsUrl: "https://dlk-shopify.eitri.tech/eitri-content/api/shopify-cms-pages",
        clientId: "",
        callbackUrl: "",
    },
    appConfigs: { headerLogo: "https://assets.cuponomia.com.br/img/stores/medium/dlk.png?v4", statusBarTextColor: "black" },
    eitriConfig: { mainApp: "home", dynamicBottomBar: { eitriApps: [{ slug: "home" }, { slug: "cart" }] } },
    deeplinkResolver: { slug: "deeplink-resolver" },
}

const SLUGS = { home: "loja-home", cart: "loja-cart", account: "loja-account", pdp: "loja-pdp", checkout: "loja-checkout" }

test("VTEX: the store's account, host and CMS store id; navigation on the new slugs", () => {
    const { config, needs } = buildRemoteConfig({
        template: VTEX_TEMPLATE,
        profile: { platform: "VTEX", host: "https://www.cea.com.br", account: "cea", locale: "pt-BR", currency: "BRL" },
        slugs: SLUGS,
        overrides: { "appConfigs.headerLogo": "https://cea.vtexassets.com/arquivos/logo.png" },
    })
    assert.deepEqual(config.providerInfo, {
        account: "cea",
        faststore: "cea",
        host: "https://www.cea.com.br",
        vtexCmsUrl: "https://eitripartnerbr.myvtex.com/",
    })
    assert.deepEqual(config.storePreferences, { locale: "pt-BR", currencyCode: "BRL" })
    assert.equal(config.eitriConfig.mainApp, "loja-home")
    assert.deepEqual(
        config.eitriConfig.dynamicBottomBar.eitriApps.map((t) => t.slug),
        ["loja-home", "loja-cart", "loja-account"],
    )
    assert.equal(config.appConfigs.headerLogo, "https://cea.vtexassets.com/arquivos/logo.png")
    assert.equal(config.appConfigs.checkout.recaptchaKey, undefined)
    assert.deepEqual(needs, [])
})

test("VTEX: the template must not leak its sample store into the new app", () => {
    const { config, warnings } = buildRemoteConfig({
        template: VTEX_TEMPLATE,
        profile: { platform: "VTEX", host: "https://www.cea.com.br", account: "cea" },
        slugs: SLUGS,
    })
    const text = JSON.stringify(config)
    assert.ok(!text.includes("mundoverde"), "sample account left behind")
    assert.ok(!text.includes("framerusercontent"), "sample logo left behind")
    assert.equal(config.appConfigs.headerLogo, "")
    assert.ok(warnings.some((w) => w.includes("headerLogo")))
    assert.ok(warnings.some((w) => w.includes("deeplink-resolver")))
    // The template's own copy is untouched.
    assert.equal(VTEX_TEMPLATE.providerInfo.account, "mundoverde")
})

test("Wake: account, host and name; no other store's CMS, integration account or regional sellers", () => {
    const { config, warnings } = buildRemoteConfig({
        template: WAKE_TEMPLATE,
        profile: { platform: "WAKE", host: "https://www.lojaw.com.br", account: "lojaw", storeName: "Loja W", locale: "pt-BR", currency: "BRL" },
        slugs: SLUGS,
    })
    assert.deepEqual(config.providerInfo, {
        account: "lojaw",
        host: "https://www.lojaw.com.br",
        eitriContentCmsUrl: "",
        tcs_account: "",
        partnerByRegion: false,
    })
    assert.equal(config.appConfigs.headerName, "Loja W")
    assert.equal(config.storePreferences.currencySymbol, "R$")
    assert.deepEqual(config.eitriConfig.dynamicBottomBar.eitriApps.map((t) => t.slug), ["loja-home", "loja-cart", "loja-account"])
    assert.ok(warnings.some((w) => w.includes("eitriContentCmsUrl")))
    assert.ok(warnings.some((w) => w.includes("tcs_account")))
})

test("Shopify: the Storefront and Customer Account credentials are needs until the user gives them", () => {
    const profile = { platform: "SHOPIFY", host: "https://www.lojas.com.br", shopDomain: "lojas.myshopify.com" }
    const without = buildRemoteConfig({ template: SHOPIFY_TEMPLATE, profile, slugs: SLUGS })
    assert.deepEqual(
        without.needs.map((n) => n.path),
        ["providerInfo.storefrontAccessToken", "providerInfo.clientId", "providerInfo.callbackUrl"],
    )
    assert.equal(without.config.providerInfo.cmsUrl, "")
    assert.equal(without.config.providerInfo.host, "https://www.lojas.com.br")

    const withSecrets = buildRemoteConfig({
        template: SHOPIFY_TEMPLATE,
        profile,
        slugs: SLUGS,
        secrets: { storefrontAccessToken: "sf-token", clientId: "shp-client", callbackUrl: "shop.123://callback" },
    })
    assert.deepEqual(withSecrets.needs, [])
    assert.equal(withSecrets.config.providerInfo.storefrontAccessToken, "sf-token")
    assert.equal(withSecrets.config.providerInfo.clientId, "shp-client")
})

test("refuses a template of another platform than the store", () => {
    assert.throws(
        () => buildRemoteConfig({ template: WAKE_TEMPLATE, profile: { platform: "VTEX", host: "https://x.com", account: "x" }, slugs: SLUGS }),
        /WAKE template.*VTEX store/,
    )
})

test("a VTEX store without a detected account is a need, not a guess", () => {
    const { needs } = buildRemoteConfig({ template: VTEX_TEMPLATE, profile: { platform: "VTEX", host: "https://x.com" }, slugs: SLUGS })
    assert.deepEqual(needs.map((n) => n.path), ["providerInfo.account"])
})

test("warns when the header logo URL asks the CDN for a small resized copy", () => {
    const logo = "https://loja.vtexassets.com/assets/vtex.file-manager-graphql/images/abc___123.png"
    const resized = buildRemoteConfig({
        template: VTEX_TEMPLATE,
        profile: { platform: "VTEX", host: "https://www.loja.com.br", account: "loja" },
        slugs: SLUGS,
        overrides: { "appConfigs.headerLogo": `${logo}?width=68&aspect=true&quality=8` },
    })
    const warning = resized.warnings.find((w) => w.includes("headerLogo") && w.includes("resized"))
    assert.ok(warning, "no resize warning")
    assert.ok(warning.includes("width=68") && warning.includes("quality=8"), warning)
    assert.ok(warning.includes(` ${logo} `) || warning.endsWith(logo), `names the original URL: ${warning}`)

    // A cache-buster is not a resize.
    const clean = buildRemoteConfig({
        template: VTEX_TEMPLATE,
        profile: { platform: "VTEX", host: "https://www.loja.com.br", account: "loja" },
        slugs: SLUGS,
        overrides: { "appConfigs.headerLogo": `${logo}?v=2` },
    })
    assert.ok(!clean.warnings.some((w) => w.includes("resized")))
})
