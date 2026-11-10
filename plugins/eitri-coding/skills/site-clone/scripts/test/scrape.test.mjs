import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scrape.mjs')

function capture (fixture, ...args) {
  const out = mkdtempSync(join(tmpdir(), 'scrape-'))
  const url = pathToFileURL(join(here, 'fixtures', fixture)).href
  execFileSync(process.execPath, [script, url, '--out', out, '--name', 'page', '--bp', '375', '--primary', '375', '--no-assets', '--wait', '2000', ...args], { encoding: 'utf8', stdio: 'pipe', timeout: 120000 })
  return join(out, 'page')
}

test('popups and consent banners that appear after load are dismissed before the capture', { timeout: 150000 }, () => {
  const dir = capture('overlays.html')
  const rendered = readFileSync(join(dir, 'page.rendered.html'), 'utf8')
  assert.doesNotMatch(rendered, /class="nl-backdrop"/, 'the marketing popup is closed through its own close control')
  assert.doesNotMatch(rendered, /class="consent"/, 'the late consent banner is accepted')
  assert.doesNotMatch(rendered, /class="pb_backdrop"/, 'an icon-only close link inside a "close" wrapper is recognised')
  const { sections } = JSON.parse(readFileSync(join(dir, 'layout', 'sections.json'), 'utf8'))
  assert.ok(sections.every(s => !/nl-backdrop|consent/.test(s.classes)), 'no overlay becomes a section')
  assert.equal(sections[0].tag, 'header', 'the page starts at its header again')
  const { warnings } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.ok(warnings.some(w => /dismissed/i.test(w) && /nl-backdrop/.test(w)), 'the bundle says what was closed')
  assert.ok(!warnings.some(w => /did not close/.test(w)), `a fading popup is waited for, not reported stuck: ${warnings.join(' | ')}`)
})

test('a fixed full-screen app shell and a transparent click-catcher are not popups: both are left alone', { timeout: 150000 }, () => {
  const dir = capture('app-shell.html')
  const rendered = readFileSync(join(dir, 'page.rendered.html'), 'utf8')
  assert.match(rendered, /id="shell"/)
  assert.match(rendered, /Mais vendidos/)
  const { warnings } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.ok(!warnings.some(w => /dismissed|overlay|popup/i.test(w)), `no dismissal reported: ${warnings.join(' | ')}`)
})

/** Decodes an 8-bit RGB/RGBA PNG (what Chromium writes): { width, height, rgb(x, y) }. */
function readPng (file) {
  const png = readFileSync(file)
  let at = 8
  let width, height, channels
  const idat = []
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const type = png.toString('latin1', at + 4, at + 8)
    if (type === 'IHDR') {
      width = png.readUInt32BE(at + 8)
      height = png.readUInt32BE(at + 12)
      channels = png[at + 17] === 6 ? 4 : 3
    }
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0
      const p = left + up - upLeft
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft
      pixels[y * stride + x] = (value + [0, left, up, (left + up) >> 1, paeth][filter]) & 255
    }
  }
  return { width, height, rgb: (x, y) => [...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)] }
}

test('a popup that opens again late (when its trigger scrolls into view) is closed before each section screenshot', { timeout: 150000 }, () => {
  const dir = capture('scroll-popup.html')
  const { sections } = JSON.parse(readFileSync(join(dir, 'layout', 'sections.json'), 'utf8'))
  const footer = sections.find(s => s.tag === 'footer')
  assert.ok(footer, sections.map(s => s.tag).join(','))
  const shot = readPng(join(dir, footer.screenshot))
  let magenta = 0
  for (let y = 0; y < shot.height; y += 2) for (let x = 0; x < shot.width; x += 2) {
    const [r, g, b] = shot.rgb(x, y)
    if (r > 200 && g < 60 && b > 200) magenta++
  }
  assert.equal(magenta, 0, 'the footer shot shows the popup')
})
