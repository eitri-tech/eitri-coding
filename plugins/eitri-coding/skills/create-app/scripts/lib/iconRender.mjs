// Renders the chosen icon source locally, the way the MCP's upload_application_icon
// will (512 px target, never upscaled, a logo trimmed and centered on its
// background color), so the user can look at it before the Console write.
// Uses the Chromium that site-clone bundles: decodes every format the store
// may serve (PNG, JPEG, WebP, GIF, ICO, SVG) without dependencies here.
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { LOGO_SHARE, MIN_SIDE, TARGET_SIDE } from "./icon.mjs"

const SITE_CLONE_SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "site-clone", "scripts")

export async function loadChromium() {
    const require = createRequire(join(SITE_CLONE_SCRIPTS, "package.json"))
    for (const spec of ["playwright", "playwright-core"]) {
        try {
            // A CommonJS package imported by path: its exports may only be on `default`.
            const mod = await import(pathToFileURL(require.resolve(spec)).href)
            const chromium = mod.chromium ?? mod.default?.chromium
            if (chromium) return chromium
        } catch {}
    }
    return undefined
}

const MIME = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", svg: "image/svg+xml" }

/**
 * @param bytes  the source image
 * @param image  measureImage(bytes)
 * @param mode   "logo" (trim, center on `background`) or "icon" (square: 512 px or its own size)
 * @returns { png: Buffer, width, height, logoColor?, contrast? }
 */
export async function renderIcon({ bytes, image, mode, background }, chromium) {
    chromium ??= await loadChromium()
    if (!chromium) throw new Error(`Playwright is not installed. Run once: cd ${SITE_CLONE_SCRIPTS} && npm ci && npx playwright install chromium`)
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage()
        const out = await page.evaluate(draw, {
            src: `data:${MIME[image.format]};base64,${Buffer.from(bytes).toString("base64")}`,
            natural: { width: image.width, height: image.height },
            vector: Boolean(image.vector),
            mode,
            background: background ?? null,
            target: TARGET_SIDE,
            min: MIN_SIDE,
            share: LOGO_SHARE,
        })
        return { ...out, png: Buffer.from(out.dataUrl.split(",")[1], "base64"), dataUrl: undefined }
    } finally {
        await browser.close()
    }
}

/* Runs in the page. Mirrors the MCP's prepareAppIcon (sharp). */
async function draw({ src, natural, vector, mode, background, target, min, share }) {
    const img = new Image()
    img.src = src
    await img.decode()
    const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h })

    if (mode !== "logo") {
        const side = vector ? target : Math.min(natural.width, natural.height, target)
        const c = canvas(side, side)
        const sourceSide = Math.min(img.naturalWidth, img.naturalHeight)
        c.getContext("2d").drawImage(img, (img.naturalWidth - sourceSide) / 2, (img.naturalHeight - sourceSide) / 2, sourceSide, sourceSide, 0, 0, side, side)
        return { dataUrl: c.toDataURL("image/png"), width: side, height: side }
    }

    // Trim: drop the margins that match the top-left pixel (transparent or flat), like sharp's trim().
    const scale = vector ? (target * share * 2) / Math.max(natural.width, natural.height) : 1
    const w = Math.round(natural.width * scale)
    const h = Math.round(natural.height * scale)
    const raw = canvas(w, h)
    const ctx = raw.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, w, h)
    const px = ctx.getImageData(0, 0, w, h).data
    const ref = px.slice(0, 4)
    const differs = (i) => (ref[3] === 0 ? px[i + 3] > 10 : Math.abs(px[i] - ref[0]) + Math.abs(px[i + 1] - ref[1]) + Math.abs(px[i + 2] - ref[2]) + Math.abs(px[i + 3] - ref[3]) > 40)
    let [x0, y0, x1, y1] = [w, h, -1, -1]
    let sum = [0, 0, 0, 0]
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            if (!differs(i)) continue
            x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y)
            if (px[i + 3] > 128) sum = [sum[0] + px[i], sum[1] + px[i + 1], sum[2] + px[i + 2], sum[3] + 1]
        }
    }
    if (x1 < 0) [x0, y0, x1, y1] = [0, 0, w - 1, h - 1]
    const tw = x1 - x0 + 1
    const th = y1 - y0 + 1
    const longest = Math.max(tw, th)
    const side = vector ? target : Math.min(target, Math.max(min, Math.round(longest / share)))
    const box = Math.round(side * share)
    if (!vector && box > longest + 1) throw new Error(`The logo (${tw}×${th} without margins) would need upscaling ×${(box / longest).toFixed(2)}.`)
    const fit = Math.min(1, box / longest)
    const [dw, dh] = [Math.round(tw * fit), Math.round(th * fit)]
    const out = canvas(side, side)
    const octx = out.getContext("2d")
    octx.fillStyle = background
    octx.fillRect(0, 0, side, side)
    octx.imageSmoothingQuality = "high"
    octx.drawImage(raw, x0, y0, tw, th, Math.round((side - dw) / 2), Math.round((side - dh) / 2), dw, dh)

    // How readable the mark is on the background (WCAG contrast of its average opaque color).
    const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
    const logo = sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : [0, 0, 0]
    const probe = canvas(1, 1).getContext("2d", { willReadFrequently: true })
    probe.fillStyle = background
    probe.fillRect(0, 0, 1, 1)
    const bg = Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3))
    const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
    const [a, b] = [lum(logo), lum(bg)].sort((p, q) => q - p)
    return { dataUrl: out.toDataURL("image/png"), width: side, height: side, logoColor: hex(logo), contrast: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 }
}
