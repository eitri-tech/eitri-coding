// Image URLs as stores render them vs the files behind them.

// Image proxies that carry the original's address in a parameter (deco.cx /image?src=, Next.js /_next/image?url=).
const PROXY_PATH = /(?:^|\/)(?:_next\/)?image\/?$/
const VTEX_ASSETS = /(?:^|\.)(?:vtexassets\.com|vteximg\.com\.br)$/i
const VTEX_RESIZE = new Set(["width", "height", "aspect", "quality"])

/**
 * The file an image proxy resizes (a relative source lives on the proxy's own host:
 * deco's assets.decocms.com/<site>/<file>); any other URL as it is.
 */
export function proxiedOriginal(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return url
    }
    // VTEX's resizer (thumbor): /unsafe/<size>/<filters>/<the original, URL-encoded>.
    const thumbor = /^\/unsafe\/(?:[^/]+\/)*?(https?(?::|%3A).*)$/i.exec(parsed.pathname)
    if (thumbor) {
        try {
            return new URL(decodeURIComponent(thumbor[1])).href
        } catch {
            return url
        }
    }
    // VTEX asset hosts resize by query parameter (?width=3840&aspect=true&quality=8): the file is without them.
    if (VTEX_ASSETS.test(parsed.hostname) && [...parsed.searchParams.keys()].some((k) => VTEX_RESIZE.has(k.toLowerCase()))) {
        for (const key of [...parsed.searchParams.keys()]) if (VTEX_RESIZE.has(key.toLowerCase())) parsed.searchParams.delete(key)
        return parsed.href
    }
    const source = parsed.searchParams.get("src") ?? parsed.searchParams.get("url")
    if (!PROXY_PATH.test(parsed.pathname) || !source) return url
    try {
        return new URL(source, `${parsed.origin}/`).href
    } catch {
        return url
    }
}
