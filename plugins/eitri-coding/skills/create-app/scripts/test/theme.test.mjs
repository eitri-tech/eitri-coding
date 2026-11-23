import { test } from "node:test"
import assert from "node:assert/strict"
import { buildTheme, contrastRatio } from "../lib/theme.mjs"

const eitri = (out) => out.v2.daisyui.themes[0].eitri

test("v2 content has the Console's shape: one DaisyUI theme named eitri, default, light, with a radius scale", () => {
    const out = buildTheme({ primary: "#0a2463", radius: "0.75rem" })
    assert.equal(out.v2.daisyui.defaultTheme, "eitri")
    assert.equal(out.v2.daisyui.darkTheme, false)
    assert.deepEqual(Object.keys(eitri(out)).sort(), [
        "accent", "accent-content", "base-100", "base-200", "base-300", "base-content",
        "error", "error-content", "info", "info-content", "neutral", "neutral-content",
        "primary", "primary-content", "secondary", "secondary-content",
        "success", "success-content", "warning", "warning-content",
        // DaisyUI's own radii (inputs, buttons, cards, badges draw from these, not from theme.borderRadius).
        "--rounded-badge", "--rounded-box", "--rounded-btn",
    ].sort())
    assert.deepEqual(out.v2.theme.borderRadius, {
        none: "0px", xs: "0.125rem", sm: "0.25rem", DEFAULT: "0.25rem", md: "0.75rem", lg: "0.5rem", xl: "0.75rem", "2xl": "1rem", "3xl": "1.5rem", full: "9999px",
    }, "the whole scale: theme.borderRadius replaces Tailwind's, so `rounded-none` and `rounded` need their steps")
})

test("content colors follow contrast: dark text on yellow, white text on navy", () => {
    const out = buildTheme({ primary: "#ffd600", secondary: "#0a2463" })
    assert.equal(eitri(out).primary, "#ffd600")
    assert.equal(eitri(out)["primary-content"], "#1f2937")
    assert.equal(eitri(out)["secondary-content"], "#ffffff")
})

test("the store's own button text color is kept, and a failing one comes with the nearest passing shade", () => {
    // Cheguei Embalagens: white text on a light blue CTA, 3.0:1.
    const out = buildTheme({ primary: "#2ea2c6", primaryContent: "#ffffff", secondary: "#141b41", secondaryContent: "#ffffff" })
    assert.equal(eitri(out)["primary-content"], "#ffffff")
    assert.equal(eitri(out)["secondary-content"], "#ffffff")
    const warning = out.warnings.find((w) => w.startsWith("primary-content"))
    assert.ok(warning, "a contrast warning for primary")
    const shade = /(#[0-9a-f]{6}) passes/.exec(warning)?.[1]
    assert.ok(shade, `the warning names a passing shade: ${warning}`)
    assert.ok(contrastRatio(shade, "#ffffff") >= 4.5)
    assert.ok(contrastRatio(shade, "#ffffff") < 4.8, "the nearest one, not black")
    assert.ok(!out.warnings.some((w) => w.startsWith("secondary-content")))
})

test("custom theme colors go to theme.extend.colors; the ones the repo uses but nobody defines are warned about", () => {
    const out = buildTheme({
        primary: "#24809c",
        colors: { "header-background": "#ffffff", "header-content": "#141b41" },
        usedColors: new Map([["header-content", 9], ["header-background", 2], ["primary-700", 3]]),
    })
    assert.deepEqual(out.v2.theme.extend, { colors: { "header-background": "#ffffff", "header-content": "#141b41" } })
    const warning = out.warnings.find((w) => w.includes("primary-700"))
    assert.ok(warning, out.warnings.join(" | "))
    assert.ok(!warning.includes("header-"), "defined colors are not reported")
    assert.equal(buildTheme({ primary: "#24809c" }).v2.theme.extend, undefined, "no extend without custom colors")
    assert.throws(() => buildTheme({ primary: "#24809c", colors: { "header-content": "blue;}" } }), /header-content/)
})

test("v1 global CSS ships the brand fonts like a production app: @font-face rules, .font-primary / .font-main and the body font", () => {
    const faces = "@font-face{font-family:'Montserrat';src:url(https://fonts.gstatic.com/m.woff2) format('woff2')}"
    const out = buildTheme({ primary: "#0a2463", fonts: { primary: "Montserrat", main: "Outfit", faces } })
    assert.equal(
        out.v1Css,
        `${faces}

.font-primary {
    font-family: Montserrat, sans-serif;
}

.font-main {
    font-family: Outfit, sans-serif;
}

body {
    font-family: Montserrat, sans-serif;
    background: #ffffff;
    color: #1f2937;
}
`,
    )
})
