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

test("takes the primary and main fonts and a file of @font-face rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "theme-"))
    const faces = join(dir, "faces.css")
    writeFileSync(faces, "@font-face{font-family:'Outfit';src:url(https://fonts.gstatic.com/o.woff2) format('woff2')}\n")
    const res = run("--primary", "#e30613", "--font-primary", "Montserrat", "--font-main", "Outfit", "--font-faces", faces)
    assert.equal(res.status, 0, res.stderr)
    const { v1Css } = JSON.parse(res.stdout)
    assert.match(v1Css, /^@font-face\{font-family:'Outfit'/)
    assert.match(v1Css, /\.font-main \{\n    font-family: Outfit, sans-serif;/)
    assert.match(v1Css, /body \{\n    font-family: Montserrat, sans-serif;/)
})

test("--primary-content / --secondary-content set the button text colors", () => {
    const res = run("--primary", "#2ea2c6", "--primary-content", "#ffffff", "--secondary", "#141b41", "--secondary-content", "#fff")
    assert.equal(res.status, 0, res.stderr)
    const out = JSON.parse(res.stdout)
    assert.equal(out.v2.daisyui.themes[0].eitri["primary-content"], "#ffffff")
    assert.equal(out.v2.daisyui.themes[0].eitri["secondary-content"], "#ffffff")
    assert.ok(out.warnings.some((w) => w.startsWith("primary-content")))
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

test("exits non-zero without a primary color", () => {
    const res = run("--background", "#ffffff")
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /primary/)
})
