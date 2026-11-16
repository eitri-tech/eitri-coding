import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { fetchPublic } from "../lib/http.mjs"
import { protectConfigFiles, configExample } from "../lib/privateFiles.mjs"
import { resolveVtexProduct } from "../lib/pages.mjs"

test("public downloads cancel a chunked response as soon as the byte cap is exceeded", async () => {
    let cancelled = false
    let pulls = 0
    await assert.rejects(() => fetchPublic("https://example.test/icon", {
        maxBytes: 10,
        fetchImpl: async (_, init) => {
            assert.ok(init.signal)
            return new Response(new ReadableStream({
                pull(controller) { pulls++; controller.enqueue(new Uint8Array(6)) },
                cancel() { cancelled = true },
            }, { highWaterMark: 0 }))
        },
    }), /larger than/)
    assert.equal(cancelled, true)
    assert.equal(pulls, 2)
})

test("public downloads reject content-length before reading and keep response metadata", async () => {
    let cancelled = false
    await assert.rejects(() => fetchPublic("https://example.test/icon", {
        maxBytes: 10,
        fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { "content-length": "100" } }),
    }), /larger than/)
    assert.equal(cancelled, true)
    const response = await fetchPublic("https://example.test/data", { fetchImpl: async () => new Response('{"ok":true}', { status: 201 }) })
    assert.equal(response.status, 201)
    assert.equal(response.url, "https://example.test/data")
    assert.deepEqual(await response.json(), { ok: true })
})

test("public downloads set a deadline for a request that never answers", async () => {
    // Keep the event loop alive while AbortSignal.timeout (an unref'ed timer) fires.
    const keepAlive = setTimeout(() => {}, 1000)
    try {
        await assert.rejects(() => fetchPublic("https://example.test/stalled", {
            timeoutMs: 10,
            fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
        }), /timeout/i)
    } finally { clearTimeout(keepAlive) }
})

test("derived config is ignored while its sanitized example can be committed; repeated setup changes nothing", () => {
    const repo = mkdtempSync(join(tmpdir(), "config-protection-"))
    try {
        execFileSync("git", ["init", "-q", repo])
        mkdirSync(join(repo, ".eitri"))
        writeFileSync(join(repo, ".gitignore"), "node_modules/")
        protectConfigFiles(repo)
        const once = readFileSync(join(repo, ".gitignore"), "utf8")
        protectConfigFiles(repo)
        assert.equal(readFileSync(join(repo, ".gitignore"), "utf8"), once)
        // The skill's clone step writes them unanchored (.eitri/secrets.json), which already ignores them.
        writeFileSync(join(repo, ".gitignore"), "node_modules/\n.eitri/secrets.json\n.eitri/remote-config.json\n")
        protectConfigFiles(repo)
        assert.equal(readFileSync(join(repo, ".gitignore"), "utf8"), "node_modules/\n.eitri/secrets.json\n.eitri/remote-config.json\n")
        const config = { providerInfo: { storefrontAccessToken: "DEMO-SECRET", clientSecret: "DEMO-SECRET", host: "https://shop.test" }, nested: [{ apiKey: "DEMO-SECRET", Authorization: "Bearer DEMO-SECRET", private_key: "DEMO-SECRET" }] }
        writeFileSync(join(repo, ".eitri", "secrets.json"), JSON.stringify(config))
        writeFileSync(join(repo, ".eitri", "remote-config.json"), JSON.stringify(config))
        const example = configExample(config)
        assert.equal(example.providerInfo.host, "https://shop.test")
        assert.ok(!JSON.stringify(example).includes("DEMO-SECRET"))
        writeFileSync(join(repo, ".eitri", "remote-config.example.json"), JSON.stringify(example))
        execFileSync("git", ["add", "-A"], { cwd: repo })
        const files = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: repo, encoding: "utf8" })
        assert.ok(files.includes(".eitri/remote-config.example.json"))
        assert.ok(!files.split("\n").includes(".eitri/remote-config.json"))
        assert.ok(!files.includes("secrets.json"))
    } finally { rmSync(repo, { recursive: true, force: true }) }
})

test("FastStore uses the catalog product identity and verifies the suffix; ordinary numeric slugs remain intact", async () => {
    const requests = []
    const product = { productId: "74", linkText: "tenis-2026", items: [{ itemId: "123" }] }
    const resolved = await resolveVtexProduct("shop", "https://shop.test/tenis-2026-123/p", async (url) => {
        requests.push(url)
        return url.includes("fq=skuId:123") ? [product] : null
    })
    assert.deepEqual(resolved, [product])
    assert.equal(requests.length, 2)
    assert.deepEqual(await resolveVtexProduct("shop", "https://shop.test/other-product-123/p", async (url) => url.includes("fq=") ? [product] : null), [])
    let calls = 0
    assert.deepEqual(await resolveVtexProduct("shop", "https://shop.test/tenis-2026/p", async () => { calls++; return [product] }), [product])
    assert.equal(calls, 1)
})

test("screen planning opens the resolved product by id and quotes shell metacharacters in URLs", () => {
    const repo = mkdtempSync(join(tmpdir(), "screen-identity-"))
    try {
        mkdirSync(join(repo, ".eitri"))
        const url = "https://shop.test/tenis-2026-123/p"
        writeFileSync(join(repo, ".eitri", "profile.json"), JSON.stringify({ platform: "VTEX", url: "https://shop.test/?a=1&b=2", pages: { product: url, productId: "74" } }))
        const script = fileURLToPath(new URL("../screens.mjs", import.meta.url))
        const output = JSON.parse(execFileSync(process.execPath, [script, "plan", "--repo", repo], { encoding: "utf8" }))
        assert.equal(output.screens.find((s) => s.name === "pdp").app.init, "productId=74")
        assert.ok(output.screens.find((s) => s.name === "home").commands.capture.includes("'https://shop.test/?a=1&b=2'"))
    } finally { rmSync(repo, { recursive: true, force: true }) }
})

test("detection retains the catalog id for a FastStore PDP discovered on the home", () => {
    const repo = mkdtempSync(join(tmpdir(), "detect-faststore-"))
    try {
        writeFileSync(join(repo, "home.html"), '<html lang="pt-BR"><img src="https://shop.vtexassets.com/a.png"><img src="https://shop.vtexassets.com/b.png"><a href="/tenis-2026-123/p">Tênis</a></html>')
        const product = { productId: "74", linkText: "tenis-2026", items: [{ itemId: "123", sellers: [{ commertialOffer: { AvailableQuantity: 1 } }] }] }
        writeFileSync(join(repo, "responses.json"), JSON.stringify({
            "https://shop.vtexcommercestable.com.br/api/tenant/tenants?q=shop": { defaultCurrency: "BRL" },
            "https://shop.vtexcommercestable.com.br/api/catalog_system/pub/products/search?fq=skuId:123": [product],
        }))
        const profile = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("../detect-store.mjs", import.meta.url)), "https://shop.test", "--html", join(repo, "home.html"), "--responses", join(repo, "responses.json")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))
        assert.equal(profile.pages.productId, "74")
        assert.equal(profile.pages.productSlug, "tenis-2026")
    } finally { rmSync(repo, { recursive: true, force: true }) }
})

test("state recording preserves partial ids, merges reused resources and rejects conflicting identities", async () => {
    const { recordCreation } = await import("../state.mjs")
    const repo = mkdtempSync(join(tmpdir(), "creation-state-"))
    try {
        recordCreation(repo, "create_application", { created: true, application: { id: "app", name: "Shop", clientSecret: "never-save" } })
        recordCreation(repo, "create_eitri_apps", { created: [{ id: "home", slug: "shop-home", publicKey: "pk", secretKey: "never-save" }], failed: { slug: "shop-cart", error: "failed" } })
        const result = { created: [{ id: "cart", slug: "shop-cart" }], reused: [{ id: "home", slug: "shop-home" }], appGroupId: "group" }
        const state = recordCreation(repo, "create_eitri_apps", result)
        assert.equal(state.created.eitriApps.length, 2)
        assert.equal(state.created.appGroupId, "group")
        recordCreation(repo, "create_eitri_apps", result)
        const before = readFileSync(join(repo, ".eitri", "create-app.state.json"), "utf8")
        assert.ok(!before.includes("never-save"))
        assert.throws(() => recordCreation(repo, "create_application", { created: true, application: { id: "another" } }), /another application/)
        assert.equal(readFileSync(join(repo, ".eitri", "create-app.state.json"), "utf8"), before)
    } finally { rmSync(repo, { recursive: true, force: true }) }
})
