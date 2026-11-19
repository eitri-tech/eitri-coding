import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "brand-theme.mjs")
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })

test("prints the v2 content, the v1 CSS and the warnings from flags", () => {
    const res = run("--primary", "#e30613", "--background", "#fafafa", "--radius", "1rem", "--font", "Montserrat", "--font-import", "https://fonts.googleapis.com/css2?family=Montserrat&display=swap")
    assert.equal(res.status, 0, res.stderr)
    const out = JSON.parse(res.stdout)
    assert.equal(out.v2.daisyui.themes[0].eitri.primary, "#e30613")
    assert.equal(out.v2.daisyui.themes[0].eitri["base-100"], "#fafafa")
    assert.equal(out.v2.theme.borderRadius.md, "1rem")
    assert.match(out.v1Css, /font-family: Montserrat, sans-serif;/)
    assert.ok(Array.isArray(out.warnings))
})

test("--color sets custom theme colors and --repo reports the ones the repo's classes still miss", () => {
    const repo = mkdtempSync(join(tmpdir(), "repo-"))
    mkdirSync(join(repo, "shared", "src"), { recursive: true })
    writeFileSync(join(repo, "shared", "src", "Header.jsx"), "<View className='bg-header-background text-header-content bg-primary-700' />")
    mkdirSync(join(repo, "shared", "node_modules", "x"), { recursive: true })
    writeFileSync(join(repo, "shared", "node_modules", "x", "i.js"), "'bg-vendor-only'")
    const res = run("--primary", "#24809c", "--color", "header-background=#ffffff", "--color", "header-content=rgba(20, 27, 65, 1)", "--repo", repo)
    assert.equal(res.status, 0, res.stderr)
    const out = JSON.parse(res.stdout)
    assert.deepEqual(out.v2.theme.extend.colors, { "header-background": "#ffffff", "header-content": "rgba(20, 27, 65, 1)" })
    assert.ok(out.warnings.some((w) => w.includes("primary-700") && !w.includes("vendor-only")), out.warnings.join(" | "))
})
