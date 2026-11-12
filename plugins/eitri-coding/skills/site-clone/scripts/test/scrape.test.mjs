import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

test('an inline data: iframe is reported by its type and size, not by its whole source', { timeout: 150000 }, () => {
  const dir = capture('data-iframe.html')
  const { warnings } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  const iframe = warnings.find(w => /^iframe/.test(w))
  assert.ok(iframe, `the iframe is reported: ${warnings.join(' | ')}`)
  assert.match(iframe, /data:text\/html/)
  assert.ok(warnings.every(w => w.length < 400), `no warning carries a whole inline document (longest: ${Math.max(...warnings.map(w => w.length))} chars)`)
})

test('custom elements are reported, and one still on its loading skeleton is flagged: its content is not in the bundle', { timeout: 150000 }, () => {
  const dir = capture('widgets.html')
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  const byTag = Object.fromEntries(manifest.thirdParty.customElements.map(e => [e.tag, e]))
  assert.equal(byTag['demo-stories'].placeholder, true)
  assert.equal(byTag['my-carousel'].placeholder, false)
  assert.ok(Array.isArray(manifest.thirdParty.hosts))
  assert.ok(manifest.warnings.some(w => /still loading/.test(w) && /demo-stories/.test(w)), manifest.warnings.join(' | '))
  const readme = readFileSync(join(dir, 'README.md'), 'utf8')
  assert.match(readme, /## Third-party widgets and services/)
  assert.match(readme, /`<demo-stories>`.*still loading/)
})

test('outline images carry the link they sit in, so a banner keeps its destination', { timeout: 150000 }, () => {
  const dir = capture('linked-images.html')
  const outline = JSON.parse(readFileSync(join(dir, 'content', 'outline.json'), 'utf8'))
  const linked = outline.find(o => o.type === 'img' && o.alt === 'banner vestidos')
  assert.ok(linked, 'the linked image is in the outline')
  assert.match(linked.href ?? '', /\/produtos\/vestidos$/)
  assert.deepEqual(linked.box.slice(2), [300, 200], 'the rendered size, to tell a slide from a tile')
  const plain = outline.find(o => o.type === 'img' && o.alt === 'sem link')
  assert.ok(plain && !('href' in plain), 'an image outside a link has no href')
})

test('--probe runs a module in the captured page and writes its answer to probe.json', { timeout: 150000 }, () => {
  const mod = join(mkdtempSync(join(tmpdir(), 'probe-')), 'probe.mjs')
  writeFileSync(mod, 'export default function () { return { images: document.querySelectorAll("img").length, width: window.innerWidth } }')
  const dir = capture('linked-images.html', '--probe', mod)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8')), { images: 2, width: 375 })
})

test('off-canvas drawers (fixed outside the screen, or transparent) are hidden before the shots, not reported as popups', { timeout: 150000 }, () => {
  const mod = join(mkdtempSync(join(tmpdir(), 'probe-')), 'probe.mjs')
  writeFileSync(mod, 'export default function () { return { guide: getComputedStyle(document.querySelector("#guide .panel")).visibility, minicart: getComputedStyle(document.querySelector("#minicart")).visibility, title: getComputedStyle(document.querySelector("h1")).visibility } }')
  const dir = capture('offcanvas.html', '--probe', mod)
  const { warnings } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.ok(!warnings.some(w => /covers the page/.test(w)), warnings.join(' | '))
  assert.ok(warnings.some(w => /off-canvas/.test(w) && /#guide/.test(w)), warnings.join(' | '))
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8')), { guide: 'hidden', minicart: 'hidden', title: 'visible' })
  const shot = readPng(join(dir, 'screenshots', '375-fullpage.png'))
  let red = 0
  for (let y = 0; y < shot.height; y += 10) for (let x = 0; x < shot.width; x += 10) { const [r, g, b] = shot.rgb(x, y); if (r > 200 && g < 40 && b < 40) red++ }
  assert.equal(red, 0, 'the drawer is not painted into the full-page shot')
})

test('inline svgs are named by their own class (an SVG className is not a string), else their container', { timeout: 150000 }, () => {
  const dir = capture('svg-icons.html')
  const names = JSON.parse(readFileSync(join(dir, 'assets', 'svgs.json'), 'utf8')).map(s => s.name).sort()
  assert.deepEqual(names, ['icon-cart', 'search-box'])
})
