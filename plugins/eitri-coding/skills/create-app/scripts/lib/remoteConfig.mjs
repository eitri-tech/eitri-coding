// Builds an environment's remote config for a new store app from the
// template's remoteConfig.json and the detected store. The template's sample
// values belong to another store (its account, logo, CMS, integration
// account): every one is replaced or cleared, never carried over.
//
// Returns { config, needs, warnings }: `needs` are values only the user can
// give (credentials); `warnings` are things that work but look unfinished.

const RECAPTCHA_PLACEHOLDER = /^x+$/i

function setPath(obj, path, value) {
    const keys = path.split(".")
    let node = obj
    for (const key of keys.slice(0, -1)) {
        if (typeof node[key] !== "object" || node[key] === null) node[key] = {}
        node = node[key]
    }
    node[keys.at(-1)] = value
}

function templatePlatform(template) {
    return String(template.ecommerceProvider ?? template.providerInfo?.ecommerceProvider ?? "").toUpperCase() || undefined
}

const providers = {
    VTEX(config, { profile }, report) {
        const account = profile.account ?? ""
        if (!account) report.need("providerInfo.account", "the store's VTEX account (detect-store could not find it)")
        Object.assign(config.providerInfo, { account, host: profile.host, faststore: account })
        report.warn(
            `Home and landing pages come from the Eitri VTEX CMS (providerInfo.vtexCmsUrl) under faststore "${account}"; they stay empty until that CMS has pages for it.`,
        )
        if (!profile.currency) report.warn("storePreferences.currencyCode defaulted to BRL: the store's currency was not detected.")
        config.storePreferences = { ...config.storePreferences, locale: profile.locale ?? "pt-BR", currencyCode: profile.currency ?? "BRL" }
    },

    WAKE(config, { profile, secrets }, report) {
        const account = profile.account ?? ""
        if (!account) report.need("providerInfo.account", "the store's Wake account (detect-store could not find it)")
        Object.assign(config.providerInfo, {
            account,
            host: profile.host,
            eitriContentCmsUrl: "",
            tcs_account: secrets.tcsAccount ?? "",
            partnerByRegion: false,
        })
        report.warn("providerInfo.eitriContentCmsUrl is empty: the home has no CMS content until the store's Eitri Content pages exist.")
        if (!secrets.tcsAccount) report.warn("providerInfo.tcs_account is empty: set the store's Wake integration account if its features need it.")
        const prefs = config.storePreferences ?? {}
        if (profile.currency && prefs.currencyCode && profile.currency !== prefs.currencyCode) {
            report.warn(`The store uses ${profile.currency}: review storePreferences (symbol and number format are the template's ${prefs.currencyCode}).`)
        }
        config.storePreferences = { ...prefs, locale: profile.locale ?? prefs.locale, currencyCode: profile.currency ?? prefs.currencyCode }
        setPath(config, "appConfigs.headerName", profile.storeName ?? "")
    },

    SHOPIFY(config, { profile, secrets }, report) {
        config.providerInfo.host = profile.host
        config.providerInfo.cmsUrl = ""
        const credentials = [
            ["storefrontAccessToken", "storefrontAccessToken", "Storefront API token (Shopify Admin → Apps → Storefront API)"],
            ["clientId", "clientId", "Customer Account API client id (Shopify Admin → Customer Account API)"],
            ["callbackUrl", "callbackUrl", "OAuth redirect URL or deep link registered in the Customer Account API"],
        ]
        for (const [field, secret, why] of credentials) {
            config.providerInfo[field] = secrets[secret] ?? ""
            if (!secrets[secret]) report.need(`providerInfo.${field}`, why)
        }
        report.warn("providerInfo.cmsUrl is empty: the home and categories have no CMS content until the store's Eitri Content pages exist.")
    },
}

/** A template slug or alias ("eitri-shopping-home", "home") → the new app's real slug. */
function resolveSlug(slug, slugs) {
    return slugs[slug] ?? slugs[String(slug).split("-").pop()]
}

// Query parameters image CDNs read as "resize this" (VTEX: width/height/aspect/quality; Shopify: width/height).
const RESIZE_PARAMS = new Set(["width", "height", "w", "h", "quality", "q", "aspect"])

/** The resize parameters of an image URL and the URL without them, or null when it asks for the original. */
function resizeParams(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    const found = [...parsed.searchParams.entries()].filter(([key]) => RESIZE_PARAMS.has(key.toLowerCase()))
    if (!found.some(([key]) => key.toLowerCase() !== "aspect")) return null
    for (const [key] of found) parsed.searchParams.delete(key)
    return { params: found.map(([k, v]) => `${k}=${v}`).join(", "), original: parsed.href }
}

export function buildRemoteConfig({ template, profile, slugs, secrets = {}, overrides = {} }) {
    const platform = templatePlatform(template)
    if (profile.platform && platform && profile.platform !== platform) {
        throw new Error(`This is a ${platform} template but a ${profile.platform} store: pick the store's template.`)
    }
    const provider = providers[platform ?? profile.platform]
    if (!provider) throw new Error(`No remote config rules for platform ${platform ?? profile.platform ?? "(unknown)"}.`)

    const needs = []
    const warnings = []
    const report = { need: (path, why) => needs.push({ path, why }), warn: (text) => warnings.push(text) }

    const config = structuredClone(template)
    config.providerInfo ??= {}
    provider(config, { profile, secrets }, report)

    config.appConfigs ??= {}
    config.appConfigs.headerLogo = ""
    if (RECAPTCHA_PLACEHOLDER.test(config.appConfigs.checkout?.recaptchaKey ?? "")) {
        delete config.appConfigs.checkout.recaptchaKey
        warnings.push("Removed the template's placeholder checkout.recaptchaKey: checkout runs without reCAPTCHA until a real site key is set.")
    }

    const eitriConfig = config.eitriConfig ?? {}
    if (eitriConfig.mainApp) {
        const main = resolveSlug(eitriConfig.mainApp, slugs)
        if (main) eitriConfig.mainApp = main
        else warnings.push(`eitriConfig.mainApp "${eitriConfig.mainApp}" matches no mini-app of this app.`)
    }
    for (const tab of eitriConfig.dynamicBottomBar?.eitriApps ?? []) {
        const slug = resolveSlug(tab.slug, slugs)
        if (slug) tab.slug = slug
        else warnings.push(`Bottom bar tab "${tab.title ?? tab.slug}" opens "${tab.slug}", which is no mini-app of this app.`)
    }
    if (config.deeplinkResolver?.slug) {
        warnings.push(
            `deeplinkResolver.slug "${config.deeplinkResolver.slug}" is a separate add-on mini-app this app does not include: deep links do not resolve until it is licensed to the app.`,
        )
    }

    for (const [path, value] of Object.entries(overrides)) setPath(config, path, value)
    if (!config.appConfigs.headerLogo) warnings.push("appConfigs.headerLogo is empty: set the store's logo URL so the header shows it.")
    else {
        const resize = resizeParams(config.appConfigs.headerLogo)
        if (resize) {
            warnings.push(
                `appConfigs.headerLogo asks the CDN for a resized copy (${resize.params}), which the header shows blurry: use the original file ${resize.original} (check it loads).`,
            )
        }
    }

    return { config, needs, warnings }
}
