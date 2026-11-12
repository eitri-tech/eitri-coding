// Image headers for tests: just enough bytes for a decoder to read the size.
// Not drawable images (except where noted): measuring reads headers only.

const u16le = (n) => [n & 255, (n >>> 8) & 255]
const u32le = (n) => [...u16le(n & 0xffff), ...u16le(n >>> 16)]
const u32be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

export function png(width, height) {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0, 0, 0, 0, 0])
}

export function jpeg(width, height) {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

export function gif(width, height) {
    return new Uint8Array([...new TextEncoder().encode("GIF89a"), ...u16le(width), ...u16le(height), 0, 0, 0])
}

/** WebP VP8X (extended) header. */
export function webp(width, height) {
    const u24 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]
    return new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)])
}

export function svg({ width, height, viewBox } = {}) {
    const attrs = [width && `width="${width}"`, height && `height="${height}"`, viewBox && `viewBox="${viewBox}"`].filter(Boolean).join(" ")
    return new TextEncoder().encode(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="100%" height="100%"/></svg>`)
}

/**
 * An .ico with the given frames: `{ bmp: [w, h] }` (a BITMAPINFOHEADER, height doubled
 * as in icons) or `{ png: bytes }` (embedded PNG). `dirSide` overrides the directory's
 * byte (0 means 256), to test that the frame itself is read.
 */
export function ico(frames) {
    const datas = frames.map((f) => (f.png ? Array.from(f.png) : [...u32le(40), ...u32le(f.bmp[0]), ...u32le(f.bmp[1] * 2), ...u16le(1), ...u16le(32), ...new Array(24).fill(0)]))
    let offset = 6 + 16 * frames.length
    const dir = frames.flatMap((f, i) => {
        const side = f.dirSide ?? (f.bmp ? f.bmp[0] : 0)
        const entry = [side & 255, (f.bmp ? f.bmp[1] : side) & 255, 0, 0, ...u16le(1), ...u16le(32), ...u32le(datas[i].length), ...u32le(offset)]
        offset += datas[i].length
        return entry
    })
    return new Uint8Array([0, 0, ...u16le(1), ...u16le(frames.length), ...dir, ...datas.flat()])
}

/**
 * A real, drawable RGBA PNG: `paint(x, y)` answers [r, g, b, a] per pixel
 * (default: opaque pink). For render tests.
 */
export async function drawablePng(width, height, paint = () => [224, 69, 123, 255]) {
    const { deflateSync } = await import("node:zlib")
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        return c >>> 0
    })
    const crc = (bytes) => {
        let c = 0xffffffff
        for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
        return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type, data) => {
        const body = [...new TextEncoder().encode(type), ...data]
        return [...u32be(data.length), ...body, ...u32be(crc(body))]
    }
    const rows = []
    for (let y = 0; y < height; y++) {
        rows.push(0)
        for (let x = 0; x < width; x++) rows.push(...paint(x, y))
    }
    const ihdr = [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", ihdr), ...chunk("IDAT", [...deflateSync(Buffer.from(rows))]), ...chunk("IEND", [])])
}
