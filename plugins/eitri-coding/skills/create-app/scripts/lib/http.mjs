// Public store requests: one deadline covers headers and body, and the byte cap is enforced while streaming.
export const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

export function requestSignal(timeoutMs = 15_000, signal) {
    const deadline = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, deadline]) : deadline
}

export async function fetchPublic(url, { maxBytes = 16 * 1024 * 1024, timeoutMs = 15_000, fetchImpl = fetch, ...options } = {}) {
    const signal = requestSignal(timeoutMs, options.signal)
    const response = await fetchImpl(url, { redirect: "follow", ...options, signal })
    const reader = response.body?.getReader()
    const chunks = []
    let total = 0
    const tooLarge = () => new Error(`${url} is larger than ${maxBytes / 1024 / 1024} MB`)
    try {
        if (Number(response.headers.get("content-length")) > maxBytes) throw tooLarge()
        while (reader) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maxBytes) throw tooLarge()
            chunks.push(value)
        }
    } catch (err) {
        await reader?.cancel().catch(() => {})
        throw err
    } finally {
        reader?.releaseLock()
    }
    const bytes = Buffer.concat(chunks, total)
    return {
        ok: response.ok, status: response.status, url: response.url || String(url), headers: response.headers, bytes,
        text: async () => new TextDecoder().decode(bytes),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    }
}
