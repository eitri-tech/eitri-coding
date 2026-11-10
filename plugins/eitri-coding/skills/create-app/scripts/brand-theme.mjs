#!/usr/bin/env node
// Prints { v2, v1Css, warnings } for a store's brand:
//   v2     → create_theme `content` (Luminus V2.x, DaisyUI theme "eitri")
//   v1Css  → create_global_css `css` (Luminus V1.x: fonts and body)
//
//   node brand-theme.mjs --primary <hex> [--primary-content <hex>] [--secondary <hex>] [--secondary-content <hex>]
//                        [--accent <hex>] [--neutral <hex>]
//                        [--background <hex>] [--text <hex>] [--radius 0.5rem]
//                        [--font-primary "<family>" [--font-main "<family>"] [--font-faces <file from font-faces.mjs>]]
//                        [--font "<family>"] [--font-import <https css url>]   (legacy: one font via @import)
//                        [--color <name>=<color> …]   custom theme colors (theme.extend.colors), e.g. header-background=#ffffff
//                        [--repo <dir>]               warn about theme colors the repo's classes use but the theme lacks
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildTheme, colorTokens } from "./lib/theme.mjs"

const SKIP_DIRS = new Set(["node_modules", ".git", "scrape", ".eitri", "dist", ".workspaces", ".playwright-mcp"])

/** Every --name value, for repeatable flags. */
function options(args, name) {
    return args.flatMap((a, i) => (a === name && i + 1 < args.length ? [args[i + 1]] : []))
}

function usedColors(dir, found = new Map()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) usedColors(join(dir, entry.name), found)
        } else if (/\.(?:jsx?|tsx?)$/.test(entry.name)) {
            for (const [name, uses] of colorTokens(readFileSync(join(dir, entry.name), "utf8"))) found.set(name, (found.get(name) ?? 0) + uses)
        }
    }
    return found
}

function option(args, name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
}

try {
    const args = process.argv.slice(2)
    const family = option(args, "--font")
    const importUrl = option(args, "--font-import")
    const fontPrimary = option(args, "--font-primary")
    const facesFile = option(args, "--font-faces")
    const theme = buildTheme({
        primary: option(args, "--primary"),
        primaryContent: option(args, "--primary-content"),
        secondary: option(args, "--secondary"),
        secondaryContent: option(args, "--secondary-content"),
        accent: option(args, "--accent"),
        neutral: option(args, "--neutral"),
        background: option(args, "--background"),
        text: option(args, "--text"),
        radius: option(args, "--radius") ?? "0.5rem",
        font: family || importUrl ? { family, importUrl } : undefined,
        colors: Object.fromEntries(
            options(args, "--color").map((pair) => {
                const i = pair.indexOf("=")
                if (i <= 0) throw new Error(`--color takes <name>=<color>, got ${JSON.stringify(pair)}`)
                return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()]
            }),
        ),
        usedColors: option(args, "--repo") ? usedColors(option(args, "--repo")) : undefined,
        fonts: fontPrimary ? { primary: fontPrimary, main: option(args, "--font-main"), faces: facesFile ? readFileSync(facesFile, "utf8") : "" } : undefined,
    })
    console.log(JSON.stringify(theme, null, 2))
} catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
}
