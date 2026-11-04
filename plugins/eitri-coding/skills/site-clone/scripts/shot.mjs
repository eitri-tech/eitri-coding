#!/usr/bin/env node
/**
 * Render anything and screenshot it, using the same emulation as scrape.mjs so a
 * rebuild can be compared against a capture without an apples-to-oranges viewport.
 *
 * Works on a URL, a dev server, or a local file (snapshot.html, your build).
 * This is the fidelity check — it needs no MCP.
 *
 *   node shot.mjs <url|path> <out.png> [--bp 375] [--viewport] [--wait 2500]
 *                                      [--click "sel,sel"] [--storage auth.json]
 */
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = n => argv.includes('--' + n)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 || i === argv.length - 1 ? d : argv[i + 1] }

if (argv.length < 2 || flag('help')) {
  console.log(`
  node shot.mjs <url|path> <out.png> [options]

  --bp <px>          viewport width; under 700 emulates touch + a mobile UA,
                     exactly as the capture does          (default: 1440)
  --viewport         viewport only, instead of the full page
  --wait <ms>        settle time after load               (default: 2500)
  --click "a,b"      selectors to click before shooting (menus, consent, tabs)
  --storage <file>   Playwright storageState JSON, for pages behind a login
`)
  process.exit(argv.length < 2 ? 1 : 0)
}

const [target, out] = argv
const BP = parseInt(opt('bp', '1440'), 10)
const WAIT = parseInt(opt('wait', '2500'), 10)
const STORAGE = opt('storage', null)
const CLICKS = (opt('click', '') || '').split(',').map(s => s.trim()).filter(Boolean)
const mobile = BP < 700

const url = /^(https?|file):/.test(target) ? target : 'file://' + path.resolve(target)

const chromium = await (async () => {
  for (const spec of ['playwright', 'playwright-core']) {
    try { return (await import(spec)).chromium } catch {}
  }
  console.error(`\nPlaywright is not installed for this skill. Run once:\n\n  cd ${import.meta.dirname} && npm install\n`)
  process.exit(1)
})()

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: BP, height: mobile ? 812 : 900 },
  deviceScaleFactor: 1,
  isMobile: mobile,
  hasTouch: mobile,
  userAgent: mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  ignoreHTTPSErrors: true,
  ...(STORAGE ? { storageState: STORAGE } : {})
})
const page = await context.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push(e.message.slice(0, 200)))

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
} catch (e) { console.error('navigation:', e.message) }

for (const sel of CLICKS) {
  try { await page.locator(sel).first().click({ timeout: 3000 }); await page.waitForTimeout(500) } catch { console.error('click failed:', sel) }
}

// Trigger lazy content the same way the capture does.
await page.evaluate(async () => {
  const step = Math.round(innerHeight * 0.8)
  for (let y = 0; y < document.body.scrollHeight; y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, 200)) }
  scrollTo(0, 0)
})
try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}
await page.waitForTimeout(WAIT)

await page.screenshot({ path: out, fullPage: !flag('viewport') })
const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])
await browser.close()

console.log(`✓ ${out} — ${size[0]}x${size[1]} at ${BP}px${mobile ? ' (mobile emulation)' : ''}`)
if (size[0] > BP + 2) console.log(`  ! page is ${size[0]}px wide at a ${BP}px viewport — something overflows horizontally`)
for (const e of errors.slice(0, 5)) console.log('  ! console error:', e)
