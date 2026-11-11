import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMiniApp, flattenKeys, usedKeys } from "../lib/i18n.mjs"

test("flattenKeys lists the dotted path of every string", () => {
    assert.deepEqual(flattenKeys({ home: { title: "Início", nested: { a: "x" } }, top: "y" }), {
        "home.title": "Início",
        "home.nested.a": "x",
        top: "y",
    })
})

test("usedKeys finds the static keys passed to t() / i18n.t() / i18next.t(), with or without a default", () => {
    const source = `
        const { t } = useTranslation()
        <Text>{t('emptyCart.txtEmptyCart')}</Text>
        <Text>{t("home.labelAddresses", 'Endereços')}</Text>
        <Text>{i18n.t(\`cart.total\`)}</Text>
        const free = i18next.t('common.free')
        <Text>{t(\`dynamic.\${key}\`)}</Text>
        const format = (x) => x
        alert(x)
    `
    assert.deepEqual([...usedKeys(source)].sort(), ["cart.total", "common.free", "emptyCart.txtEmptyCart", "home.labelAddresses"])
})

const PT = { emptyCart: { txtEmptyCart: "Sua sacola está vazia", labelButton: "Voltar às compras" }, home: { title: "Sacola" } }
const EN = { emptyCart: { txtEmptyCart: "Your bag is empty", labelButton: "Back to shopping" }, home: { title: "Bag" } }

test("a mini-app with language-only en and pt folders and the same keys passes", () => {
    const report = checkMiniApp({ name: "cart", locales: { pt: PT, en: EN }, used: new Set(["home.title"]) })
    assert.deepEqual(report.errors, [])
})

test("a Portuguese-only mini-app shows raw keys on an English phone: error", () => {
    const report = checkMiniApp({ name: "cart", locales: { "pt-BR": PT }, used: new Set(["home.title"]) })
    assert.ok(report.errors.some((e) => /no English/.test(e)), report.errors.join("\n"))
})

test("regional folders only match that exact device language: rename them to the language", () => {
    const report = checkMiniApp({ name: "cart", locales: { "pt-BR": PT, "en-US": EN }, used: new Set() })
    assert.ok(report.errors.some((e) => e.includes("en-US") && e.includes("src/locales/en")), report.errors.join("\n"))
    assert.ok(report.errors.some((e) => e.includes("pt-BR") && e.includes("src/locales/pt")), report.errors.join("\n"))
})

test("keys missing from one language, or used in code but in no file, are errors", () => {
    const report = checkMiniApp({
        name: "cart",
        locales: { pt: PT, en: { home: { title: "Bag" } } },
        used: new Set(["home.title", "cart.coupon"]),
    })
    assert.ok(report.errors.some((e) => e.includes("en") && e.includes("emptyCart.txtEmptyCart")), report.errors.join("\n"))
    assert.ok(report.errors.some((e) => e.includes("cart.coupon")), report.errors.join("\n"))
})

test("an English value identical to the Portuguese one is flagged as probably untranslated", () => {
    const report = checkMiniApp({
        name: "cart",
        locales: { pt: PT, en: { ...EN, emptyCart: { ...EN.emptyCart, labelButton: "Voltar às compras" } } },
        used: new Set(),
    })
    assert.deepEqual(report.errors, [])
    assert.ok(report.warnings.some((w) => w.includes("emptyCart.labelButton")), report.warnings.join("\n"))
})

test("a mini-app without translations or t() calls has nothing to check", () => {
    assert.deepEqual(checkMiniApp({ name: "shared", locales: {}, used: new Set() }), { name: "shared", errors: [], warnings: [] })
    // The VTEX template's shared lib ships empty pt-BR and en-US files and translates nothing.
    assert.deepEqual(checkMiniApp({ name: "shared", locales: { "pt-BR": {}, "en-US": {} }, used: new Set() }).errors, [])
})

test("i18n.mjs check reports every mini-app and fails until each has en and pt", () => {
    const repo = mkdtempSync(join(tmpdir(), "i18n-"))
    const app = (folder, locales, source) => {
        mkdirSync(join(repo, folder, "src", "views"), { recursive: true })
        writeFileSync(join(repo, folder, "eitri-app.conf.js"), `module.exports = { 'slug': '${folder}' }`)
        writeFileSync(join(repo, folder, "src", "views", "Home.jsx"), source)
        for (const [lang, json] of Object.entries(locales)) {
            mkdirSync(join(repo, folder, "src", "locales", lang), { recursive: true })
            writeFileSync(join(repo, folder, "src", "locales", lang, "translation.json"), JSON.stringify(json))
        }
    }
    app("loja-cart", { "pt-BR": PT }, "t('home.title')")
    app("loja-home", { pt: PT, en: EN }, "t('home.title')")
    const script = join(dirname(fileURLToPath(import.meta.url)), "..", "i18n.mjs")

    const failing = spawnSync(process.execPath, [script, "check", "--repo", repo], { encoding: "utf8" })
    assert.equal(failing.status, 1, failing.stderr)
    const report = JSON.parse(failing.stdout)
    assert.deepEqual(report.apps.map((a) => [a.name, a.errors.length > 0]), [["loja-cart", true], ["loja-home", false]])

    mkdirSync(join(repo, "loja-cart", "src", "locales", "en"), { recursive: true })
    writeFileSync(join(repo, "loja-cart", "src", "locales", "en", "translation.json"), JSON.stringify(EN))
    spawnSync("mv", [join(repo, "loja-cart", "src", "locales", "pt-BR"), join(repo, "loja-cart", "src", "locales", "pt")])
    const passing = spawnSync(process.execPath, [script, "check", "--repo", repo], { encoding: "utf8" })
    assert.equal(passing.status, 0, passing.stdout)
})
