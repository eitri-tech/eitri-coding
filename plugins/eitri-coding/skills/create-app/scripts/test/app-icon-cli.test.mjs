import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { png, ico, drawablePng } from "./imageFixtures.mjs"
import { measureImage } from "../lib/icon.mjs"
import { loadChromium } from "../lib/iconRender.mjs"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "app-icon.mjs")
const run = async (...args) => {
    try {
        const { stdout } = await promisify(execFile)(process.execPath, [script, ...args], { encoding: "utf8" })
        return { code: 0, out: JSON.parse(stdout) }
    } catch (err) {
        if (err.stdout) return { code: err.code, out: JSON.parse(err.stdout) }
        throw err
    }
}

// The fixture store: a 60 px favicon declared 16x16 behind a redirect (like VTEX's /arquivos → vteximg),
// a soft-404 /apple-touch-icon.png, a 16 px /favicon.ico, a manifest whose "512" icon is really 256
// and a real 512, and a white wordmark logo in the header.
let server
let base
const routes = {}
before(async () => {
    const wordmark = await drawablePng(400, 100, (x, y) => (x >= 10 && x < 390 && y >= 10 && y < 90 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    Object.assign(routes, {
        "/": { type: "text/html", body: `<html><head>
<link rel="icon" type="image/ico" sizes="16x16" href="/arquivos/favicon.png">
<link rel="manifest" href="/manifest.json"></head>
<body><header><img class="logoImage" alt="Logo Loja" src="/arquivos/logo.png"></header>
<footer><img alt="logo pagamentos" src="/arquivos/pagamentos.png"></footer></body></html>` },
        "/arquivos/favicon.png": { status: 301, location: "/cdn/favicon.png" },
        "/cdn/favicon.png": { type: "image/png", body: png(60, 60) },
        "/apple-touch-icon.png": { type: "text/html", body: "<html>página não encontrada</html>" },
        "/apple-touch-icon-precomposed.png": { status: 404, type: "text/html", body: "nope" },
        "/favicon.ico": { type: "image/x-icon", body: ico([{ bmp: [16, 16] }]) },
        "/manifest.json": { type: "application/json", body: JSON.stringify({ icons: [{ src: "/icons/fake.png", sizes: "512x512" }, { src: "/icons/512.png", sizes: "512x512" }] }) },
        "/icons/fake.png": { type: "image/png", body: png(256, 256) },
        "/icons/512.png": { type: "image/png", body: png(512, 512) },
        "/arquivos/logo.png": { type: "image/png", body: wordmark },
    })
    server = createServer((req, res) => {
        const route = routes[req.url]
        if (!route) return res.writeHead(404).end()
        if (route.location) return res.writeHead(route.status, { location: route.location }).end()
        res.writeHead(route.status ?? 200, { "content-type": route.type }).end(Buffer.from(route.body))
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

test("downloads every candidate, measures it from its bytes and picks the manifest's real 512", async () => {
    const out = mkdtempSync(join(tmpdir(), "icon-"))
    const { code, out: report } = await run(`${base}/`, "--out", out, "--no-render")
    assert.equal(code, 0)
    assert.equal(report.chosen.url, `${base}/icons/512.png`)
    assert.deepEqual(report.upload, { imageUrl: `${base}/icons/512.png` })
    const byPath = Object.fromEntries(report.ranked.map((c) => [new URL(c.url).pathname, c]))
    assert.equal(byPath["/arquivos/favicon.png"].finalUrl, `${base}/cdn/favicon.png`, "redirects are followed and the final URL kept")
    assert.deepEqual(byPath["/arquivos/favicon.png"].image, { format: "png", width: 60, height: 60 })
    assert.match(byPath["/arquivos/favicon.png"].reason, /declared 16x16, really 60×60.*under 180/)
    assert.match(byPath["/apple-touch-icon.png"].reason, /soft 404/)
    assert.match(byPath["/favicon.ico"].reason, /16×16/)
    assert.match(byPath["/icons/fake.png"].reason, /declared 512x512, really 256×256/)
    assert.equal(byPath["/arquivos/logo.png"].kind, "logo")
    assert.ok(!report.ranked.some((c) => c.url.includes("pagamentos")), "a footer payment logo is not the store's logo")
    assert.ok(existsSync(byPath["/icons/512.png"].file), "every downloaded candidate is kept for inspection")
    assert.ok(existsSync(join(out, "icon.json")))
})

test("with only undersized icons, the wordmark wins but needs the header's background color", async () => {
    delete routes["/manifest.json"]
    const out = mkdtempSync(join(tmpdir(), "icon-"))
    const { code, out: report } = await run(`${base}/`, "--out", out, "--no-render")
    assert.equal(code, 3)
    assert.equal(report.chosen.kind, "logo")
    assert.deepEqual(report.needs, ["background"])
    assert.equal(report.upload, null)
})

test("renders the padded wordmark: trimmed, centered, never enlarged", { skip: !(await loadChromium()) && "Playwright not installed for site-clone" }, async () => {
    delete routes["/manifest.json"]
    const out = mkdtempSync(join(tmpdir(), "icon-"))
    const { code, out: report } = await run(`${base}/`, "--out", out, "--background", "#000000")
    assert.equal(code, 0)
    assert.deepEqual(report.upload, { imageUrl: `${base}/arquivos/logo.png`, background: "#000000" })
    // 380×80 without margins → canvas 380 / 0.8 = 475.
    assert.deepEqual({ width: report.icon.width, height: report.icon.height }, { width: 475, height: 475 })
    assert.deepEqual(measureImage(readFileSync(report.icon.file)), { format: "png", width: 475, height: 475 })
    assert.equal(report.icon.logoColor, "#ffffff")
    assert.ok(report.icon.contrast > 15)
})

test("warns when the logo vanishes on the background it was given", { skip: !(await loadChromium()) && "Playwright not installed for site-clone" }, async () => {
    delete routes["/manifest.json"]
    const out = mkdtempSync(join(tmpdir(), "icon-"))
    const { out: report } = await run(`${base}/`, "--out", out, "--background", "#ffffff")
    assert.ok(report.warnings.some((w) => /barely visible/.test(w)))
})

test("stops with exit 4 when nothing reaches the minimum and there is no logo", async () => {
    routes["/"] = { type: "text/html", body: `<html><head><link rel="icon" href="/favicon.ico"></head><body></body></html>` }
    const out = mkdtempSync(join(tmpdir(), "icon-"))
    const { code, out: report } = await run(`${base}/`, "--out", out, "--no-render")
    assert.equal(code, 4)
    assert.equal(report.chosen, null)
    assert.match(report.error, /No icon source/)
})
