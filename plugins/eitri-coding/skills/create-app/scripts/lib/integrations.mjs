// Recognizes the third-party services a store uses from what its pages loaded
// (site-clone's network.json URLs, script srcs) and the custom elements in its
// DOM. Each one gets a support level for the Eitri app:
//
//   integrated  the create-app add-ons implement it; `remoteConfig` holds the values to set
//   config      the template supports it through remote config, but the store decides (opt-in)
//   native      needs the native app build (SDK keys in the shell), out of create-app's scope
//   none        not in the app: a gap to report, with what it would take (`note`)
//
// Pure: the caller collects the URLs.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const param = (url, name) => {
    try {
        return new URL(url).searchParams.get(name) ?? undefined
    } catch {
        return undefined
    }
}
const group = (regex) => (url) => regex.exec(url)?.[1]

export const INTEGRATIONS = [
    // --- Reviews
    {
        id: "skeepers",
        name: "Skeepers (Opiniões Verificadas) reviews",
        category: "reviews",
        support: "integrated",
        match: /(?:\.skeepers\.io|avis-verifies\.com)/,
        elements: /^skeepers-/,
        extract: (url) => ({ websiteId: group(new RegExp(`(?:websites|generated|product)/(${UUID})`))(url) ?? param(url, "idWebsite") }),
        remoteConfig: ({ websiteId }) => (websiteId ? { "appConfigs.reviews": { provider: "skeepers", websiteId } } : null),
        note: "Ratings on the product cards and the PDP through the reviews add-on (appConfigs.reviews).",
    },
    {
        id: "yotpo",
        name: "Yotpo reviews",
        category: "reviews",
        support: "none",
        match: /yotpo\.com/,
        extract: (url) => ({ appKey: group(/staticw2\.yotpo\.com\/([A-Za-z0-9]+)\//)(url) }),
        note: "No Yotpo provider in the reviews add-on yet: add one to ReviewsService (bottomline API by app key).",
    },
    { id: "trustvox", name: "Trustvox reviews", category: "reviews", support: "none", match: /trustvox\.com\.br/, note: "No Trustvox provider in the reviews add-on yet." },
    { id: "konfidency", name: "Konfidency reviews", category: "reviews", support: "none", match: /konfidency\.com\.br/, note: "No Konfidency provider in the reviews add-on yet." },
    { id: "judgeme", name: "Judge.me reviews", category: "reviews", support: "none", match: /judge\.me/, note: "No Judge.me provider in the reviews add-on yet." },
    { id: "okendo", name: "Okendo reviews", category: "reviews", support: "none", match: /okendo\.io/, note: "No Okendo provider in the reviews add-on yet." },
    { id: "stamped", name: "Stamped reviews", category: "reviews", support: "none", match: /stamped\.io/, note: "No Stamped provider in the reviews add-on yet." },
    { id: "lily", name: "Lily reviews", category: "reviews", support: "none", match: /lily(?:reviews)?\.(?:com\.br|ai)/, note: "No Lily provider in the reviews add-on yet." },

    // --- Shoppable video / stories / live
    {
        id: "widde",
        name: "Widde shoppable videos (stories)",
        category: "video",
        support: "none",
        match: /widde\.io/,
        elements: /^widde-/,
        note: "Its API answers browsers only (bot challenge): use the VideoStories section with the store's videos in the CMS, or Widde partner credentials.",
    },
    { id: "firework", name: "Firework shoppable videos", category: "video", support: "none", match: /fireworktv\.com|fw\.tv|fwcdn/, elements: /^fw-/, note: "Use the VideoStories section with the store's videos in the CMS." },
    { id: "tolstoy", name: "Tolstoy shoppable videos", category: "video", support: "none", match: /gotolstoy\.com/, elements: /^tolstoy-/, note: "Use the VideoStories section with the store's videos in the CMS." },
    {
        id: "streamshop",
        name: "StreamShop shoppable videos (LiveShop)",
        category: "video",
        support: "integrated",
        match: /streamshop\.com\.br|liveshops\.com\.br/,
        elements: /^liveshop-/,
        note: "The VideoStories section reads its public feed (the storeSlug and tagName of the store's <liveshop-ads-carousel>), placed where the store shows it.",
    },
    { id: "videowise", name: "Videowise shoppable videos", category: "video", support: "none", match: /videowise\.com/, note: "Use the VideoStories section with the store's videos in the CMS." },
    { id: "bambuser", name: "Bambuser live shopping", category: "video", support: "none", match: /bambuser\.com/, note: "Live commerce: Eitri's liveshop dependency covers its own platform, not Bambuser." },
    { id: "mimo", name: "Mimo live shopping", category: "video", support: "none", match: /mimo\.com\.br|mimolive/, note: "Live commerce is not part of the template." },

    // --- Chat / support
    { id: "atendimento", name: "atendimen.to chat", category: "chat", support: "none", match: /atendimen\.to/, note: "No chat in the template: link the store's support channel (WhatsApp, help page) from the account menu." },
    { id: "zendesk", name: "Zendesk chat", category: "chat", support: "none", match: /zdassets\.com|zendesk\.com/, note: "No chat in the template." },
    { id: "blip", name: "Blip chat", category: "chat", support: "none", match: /blip\.ai|take\.net/, note: "No chat in the template." },
    { id: "octadesk", name: "Octadesk chat", category: "chat", support: "none", match: /octadesk\.(?:com|services)/, note: "No chat in the template." },
    { id: "jivochat", name: "JivoChat", category: "chat", support: "none", match: /jivosite\.com|jivochat/, note: "No chat in the template." },
    { id: "tawk", name: "tawk.to chat", category: "chat", support: "none", match: /tawk\.to/, note: "No chat in the template." },
    { id: "intercom", name: "Intercom", category: "chat", support: "none", match: /intercom(?:cdn)?\.(?:io|com)/, note: "No chat in the template." },
    { id: "movidesk", name: "Movidesk chat", category: "chat", support: "none", match: /movidesk\.com/, note: "No chat in the template." },
    { id: "huggy", name: "Huggy chat", category: "chat", support: "none", match: /huggy\.(?:io|app)/, note: "No chat in the template." },
    { id: "hubspot", name: "HubSpot", category: "chat", support: "none", match: /hs-scripts\.com|hubspot\.com/, note: "No chat in the template." },

    // --- Opt-in through template config
    {
        id: "clarity",
        name: "Microsoft Clarity",
        category: "analytics",
        support: "config",
        match: /clarity\.ms/,
        extract: (url) => ({ projectId: group(/clarity\.ms\/tag\/([A-Za-z0-9]+)/)(url) }),
        remoteConfig: ({ projectId }) => (projectId ? { "appConfigs.clarityId": projectId } : null),
        note: "The commerce SDK starts Clarity when appConfigs.clarityId is set (App.startClarity; empty keeps it off, so turning it on later is one config merge): opt-in, it mixes app sessions into the store's web project.",
    },
    {
        id: "recaptcha",
        name: "Google reCAPTCHA",
        category: "security",
        support: "config",
        match: /google\.com\/recaptcha|recaptcha\.net/,
        extract: (url) => ({ siteKey: param(url, "k") ?? param(url, "render"), enterprise: /\/enterprise/.test(url) || undefined }),
        note: "The checkout reads appConfigs.checkout.recaptchaKey, but a web site key only works when its allowed domains include the app's: ask the store for a key for the app.",
    },

    // --- Native app build (SDK keys in the shell)
    { id: "ga4", name: "Google Analytics 4", category: "analytics", support: "native", match: /google-analytics\.com|analytics\.google\.com|googletagmanager\.com\/gtag/, extract: (url) => ({ measurementId: param(url, "tid") ?? param(url, "id") }), note: "The template tracks through Firebase Analytics in the native app build." },
    { id: "gtm", name: "Google Tag Manager", category: "analytics", support: "native", match: /googletagmanager\.com\/gtm\.js/, extract: (url) => ({ containerId: param(url, "id") }), note: "Web only: the app tracks through Firebase Analytics in the native build." },
    { id: "meta", name: "Meta (Facebook) pixel", category: "analytics", support: "native", match: /connect\.facebook\.net|facebook\.com\/tr/, extract: (url) => ({ pixelId: param(url, "id") }), note: "The template logs events through the native Facebook SDK (Eitri.exposedApis.fb)." },
    { id: "tiktok", name: "TikTok pixel", category: "analytics", support: "native", match: /analytics\.tiktok\.com/, extract: (url) => ({ pixelId: param(url, "sdkid") }), note: "Needs the TikTok SDK in the native build." },
    { id: "bing", name: "Microsoft Advertising (Bing UET)", category: "analytics", support: "native", match: /bat\.bing\.com/, extract: (url) => ({ tagId: group(/\/action\/(\d+)\.js/)(url) ?? param(url, "ti") }), note: "Web only." },
    { id: "pinterest", name: "Pinterest tag", category: "analytics", support: "native", match: /pinimg\.com|ct\.pinterest\.com/, note: "Web only." },
    { id: "criteo", name: "Criteo", category: "ads", support: "native", match: /criteo\.(?:com|net)/, note: "Needs Criteo's app SDK in the native build." },
    { id: "insider", name: "Insider", category: "marketing", support: "native", match: /useinsider\.com|insider\.(?:com|io)\/ins/, note: "The template calls Insider through the native SDK (Eitri.exposedApis.insider)." },
    { id: "onesignal", name: "OneSignal push", category: "push", support: "native", match: /onesignal\.com/, note: "Push notifications come from the native build." },

    // --- Marketing / CRM / search (not integrated)
    { id: "klaviyo", name: "Klaviyo", category: "marketing", support: "none", match: /klaviyo\.com/, note: "No Klaviyo integration in the template (newsletter sign-up, events)." },
    { id: "rdstation", name: "RD Station", category: "marketing", support: "none", match: /rdstation\.com\.br|d335luupugsy2\.cloudfront\.net/, note: "No RD Station integration in the template." },
    { id: "emarsys", name: "Emarsys", category: "marketing", support: "none", match: /emarsys\.(?:net|com)|scarabresearch/, note: "No Emarsys integration in the template." },
    { id: "dito", name: "Dito CRM", category: "marketing", support: "none", match: /dito\.com\.br/, note: "No Dito integration in the template." },
    { id: "smarthint", name: "SmartHint search/recommendations", category: "search", support: "none", match: /smarthint\.com\.br/, note: "The app searches with VTEX Intelligent Search, not SmartHint." },
    { id: "linximpulse", name: "Linx Impulse recommendations", category: "search", support: "none", match: /chaordic|linximpulse/, note: "No Linx Impulse recommendations in the template." },
]

/**
 * @param urls            every URL the pages requested (and script srcs)
 * @param customElements  tag names with a hyphen found in the DOM
 * @returns one entry per detected integration: { id, name, category, support, note, config, remoteConfig?, evidence }
 */
export function detectIntegrations({ urls = [], customElements = [] }) {
    const found = new Map()
    const hit = (sig, evidence, config) => {
        const entry = found.get(sig.id) ?? { id: sig.id, name: sig.name, category: sig.category, support: sig.support, note: sig.note, config: {}, evidence: [] }
        for (const [key, value] of Object.entries(config ?? {})) if (value !== undefined && entry.config[key] === undefined) entry.config[key] = value
        if (entry.evidence.length < 3 && !entry.evidence.includes(evidence)) entry.evidence.push(evidence)
        found.set(sig.id, entry)
    }
    for (const url of new Set(urls)) {
        for (const sig of INTEGRATIONS) {
            if (sig.match.test(url)) hit(sig, url.length > 160 ? `${url.slice(0, 160)}…` : url, sig.extract?.(url))
        }
    }
    for (const tag of new Set(customElements)) {
        for (const sig of INTEGRATIONS) if (sig.elements?.test(tag)) hit(sig, `<${tag}>`)
    }
    return [...found.values()].map((entry) => {
        const sig = INTEGRATIONS.find((s) => s.id === entry.id)
        const remoteConfig = sig.remoteConfig?.(entry.config)
        return remoteConfig ? { ...entry, remoteConfig } : entry
    })
}
