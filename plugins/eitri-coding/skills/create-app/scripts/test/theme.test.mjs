import { test } from "node:test"
import assert from "node:assert/strict"
import { buildTheme, colorTokens, contrastRatio } from "../lib/theme.mjs"

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
    ])
    assert.deepEqual(out.v2.theme.borderRadius, {
        xs: "0.125rem", sm: "0.25rem", md: "0.75rem", lg: "0.5rem", xl: "0.75rem", "2xl": "1rem", "3xl": "1.5rem", full: "9999px",
    })
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

test("colorTokens: the theme colors a source's classes need beyond Tailwind's palette and DaisyUI's slots", () => {
    const jsx = `
        <View className={\`fixed bg-header-background shadow-md \${open ? 'text-header-content' : ''}\`}>
        <Text className='text-header-content text-xl font-bold text-primary text-base-content text-gray-500 text-center'>
        <View className='bg-primary-700 border-l-4 border-gray-200 bg-[#ffffff] hover:bg-white/50 ring-2 fill-current'>
        <svg><path fill-rule="evenodd" stroke-width="2" /></svg>`
    assert.deepEqual(Object.fromEntries(colorTokens(jsx)), { "header-background": 1, "header-content": 2, "primary-700": 1 })
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

test("base steps mix the background toward the text color", () => {
    const out = buildTheme({ primary: "#0a2463" })
    assert.equal(eitri(out)["base-100"], "#ffffff")
    assert.equal(eitri(out)["base-content"], "#1f2937")
    assert.equal(eitri(out)["base-200"], "#f6f6f7")
    assert.equal(eitri(out)["base-300"], "#ebeced")
})

test("a square brand gets square corners everywhere but full", () => {
    const out = buildTheme({ primary: "#0a2463", radius: "0rem" })
    assert.deepEqual(out.v2.theme.borderRadius, {
        xs: "0.125rem", sm: "0rem", md: "0rem", lg: "0rem", xl: "0rem", "2xl": "0rem", "3xl": "0rem", full: "9999px",
    })
})

test("v1 global CSS carries the font import and the body font, background and text", () => {
    const out = buildTheme({
        primary: "#0a2463",
        font: { family: "Open Sans", importUrl: "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" },
    })
    assert.equal(
        out.v1Css,
        `@import url(https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap);

body {
    font-family: "Open Sans", sans-serif;
    background: #ffffff;
    color: #1f2937;
}
`,
    )
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

test("the main font defaults to the primary one, and faces must use https URLs", () => {
    const out = buildTheme({ primary: "#0a2463", fonts: { primary: "Open Sans" } })
    assert.match(out.v1Css, /\.font-main \{\n    font-family: "Open Sans", sans-serif;/)
    assert.throws(() => buildTheme({ primary: "#0a2463", fonts: { primary: "X", faces: "@font-face{src:url(fonts/x.ttf)}" } }), /https/)
})

test("warns when the given text color is unreadable on the given background", () => {
    const out = buildTheme({ primary: "#0a2463", background: "#ffffff", text: "#dddddd" })
    assert.ok(out.warnings.some((w) => w.includes("base-content")))
})

test("rejects a color that is not hex, and a non-https font import", () => {
    assert.throws(() => buildTheme({ primary: "red" }), /primary/)
    assert.throws(() => buildTheme({ primary: "#0a2463", font: { family: "X", importUrl: "http://fonts.example/x.css" } }), /https/)
})

test("contrastRatio matches the WCAG extremes", () => {
    assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00")
    assert.equal(contrastRatio("#777777", "#777777").toFixed(2), "1.00")
})
