import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "detect-store.mjs")
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: "utf8" }))

test("--capture reads the raw HTML (VTEX runtime) and the rendered DOM (injected icon links) together", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"))
    writeFileSync(join(dir, "page.raw.html"), `<html lang="pt-BR"><head><title>Loja X | Moda</title></head><body><script>__RUNTIME__ = {"account":"lojax"}</script></body></html>`)
    writeFileSync(
        join(dir, "page.rendered.html"),
        `<html lang="pt-BR"><head><link rel="apple-touch-icon" sizes="180x180" href="/arquivos/apple.png"></head><body><img src="https://lojax.vtexassets.com/a.png"></body></html>`,
    )
    const tenant = join(dir, "tenant.json")
    writeFileSync(tenant, JSON.stringify({ defaultCurrency: "BRL", defaultLocale: "pt-BR" }))
    const out = run("https://www.lojax.com.br/", "--capture", dir, "--tenant", tenant)
    assert.equal(out.platform, "VTEX")
    assert.equal(out.account, "lojax")
    assert.equal(out.iconCandidates[0], "https://www.lojax.com.br/arquivos/apple.png")
    assert.equal(out.currency, "BRL", "the page has no currency: the VTEX tenant answer fills it")
})

test("--html reads a saved page", () => {
    const file = join(mkdtempSync(join(tmpdir(), "html-")), "home.html")
    writeFileSync(file, `<html><head><title>Loja Y</title></head><body><script>Shopify.shop = "lojay.myshopify.com";</script></body></html>`)
    const out = run("https://lojay.com.br", "--html", file)
    assert.equal(out.platform, "SHOPIFY")
    assert.equal(out.shopDomain, "lojay.myshopify.com")
})
