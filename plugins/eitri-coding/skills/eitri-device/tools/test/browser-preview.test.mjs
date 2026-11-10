import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { inflateSync } from 'node:zlib'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'browser-preview.mjs')

let server
let base

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/workspace/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(readFileSync(join(here, 'fixtures', 'workspace.html')))
    }
    if (url.pathname === '/items') {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['vtex_session=abc; Path=/'] })
      return res.end(JSON.stringify({ items: [1, 2], page: Number(url.searchParams.get('page')) }))
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

const run = promisify(execFile)

// Async on purpose: a synchronous child would block this process, and with it the server the page calls.
async function preview(...args) {
  const out = mkdtempSync(join(tmpdir(), 'preview-'))
  const config = join(out, 'remote-config.json')
  // create-app's .eitri/remote-config.json shape: the config under `config`.
  writeFileSync(config, JSON.stringify({ config: { providerInfo: { account: 'lojax' }, storePreferences: { locale: 'pt-BR' } } }))
  await run(process.execPath, [script, '--url', `${base}/workspace/index.html?api=${encodeURIComponent(base)}`, '--config', config, '--out', out, '--name', 'home', '--wait', '300', ...args], { timeout: 120000 })
  return join(out, 'home')
}

test('plays the native host: remote config, init params, storage, HTTP from Node, locale, api level', { timeout: 150000 }, async () => {
  const dir = await preview('--init', 'route=Categories&tabIndex=1')
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))
  assert.equal(report.title, 'account=lojax;route=Categories/number;stored=v;items=2@2;404=404;lang=pt-BR;api=30;hl=pt-BR')
  assert.ok(existsSync(join(dir, 'viewport.png')))
  assert.ok(existsSync(join(dir, 'fullpage.png')))
  assert.ok(readdirSync(join(dir, 'tiles')).length >= 2, 'a page taller than the screen is cut into screen-high tiles')
  // A 600 px block overflows the 375 px screen: reported, and the shots stay screen-wide.
  assert.equal(report.overflowX, 600)
  assert.equal(readPng(join(dir, 'fullpage.png')).width, 375)
})

test('reports what the page asked of the host that a browser cannot do, and calls it does not know', { timeout: 150000 }, async () => {
  const report = JSON.parse(readFileSync(join(await preview(), 'report.json'), 'utf8'))
  assert.deepEqual(report.opened, [{ method: 'openEitriApp', args: { slug: 'cart' } }])
  assert.deepEqual(report.unhandled, ['someFutureMethod'])
  assert.equal(report.nativeCalls.environmentGetRemoteConfigs, 1)
})

/** Decodes an 8-bit RGB/RGBA PNG (what Chromium writes): { width, height, rgb(x, y) }. */
function readPng(file) {
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
      const paeth = () => {
        const p = left + up - upLeft
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
        return a <= b && a <= c ? left : b <= c ? up : upLeft
      }
      const predictor = [0, left, up, (left + up) >> 1, paeth()][filter]
      pixels[y * stride + x] = (value + predictor) & 255
    }
  }
  return { width, height, rgb: (x, y) => [...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)] }
}

test('--compare pairs each screen-high tile with the same tile of a reference screenshot, at 1:1 scale', { timeout: 150000 }, async () => {
  const first = await preview()
  const dir = await preview('--compare', join(first, 'fullpage.png'))
  const pairs = readdirSync(join(dir, 'compare'))
  assert.ok(pairs.length >= 2, pairs.join(','))
  assert.ok(pairs.every(p => /^\d{2}\.png$/.test(p)))
  // The fixture's first section ends with a 4 px #24809c border at y = 896–900: tile 2 shows it,
  // 4 rows tall in both panels — a zoomed-out sheet would shrink it.
  const sheet = readPng(join(dir, 'compare', '02.png'))
  const isBorder = ([r, g, b]) => Math.abs(r - 0x24) < 24 && Math.abs(g - 0x80) < 24 && Math.abs(b - 0x9c) < 24
  for (const x of [100, 375 + 24 + 100]) {
    const rows = []
    for (let y = 0; y < sheet.height; y++) if (isBorder(sheet.rgb(x, y))) rows.push(y)
    assert.equal(rows.length, 4, `border rows at x=${x}: ${rows.join(',')}`)
  }
})
