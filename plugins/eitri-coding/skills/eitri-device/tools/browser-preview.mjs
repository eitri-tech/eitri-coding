#!/usr/bin/env node
/**
 * Renders an Eitri-App in Chromium at phone size, no device or emulator needed.
 *
 * `eitri start` / `eitri app start` build each mini-app into a remote dev workspace that
 * Eitri-Play opens at https://api.eitri.tech/foundry/user/<workspaceId>/index.html — an
 * ordinary web page (React, Luminus, Bifrost and the theme CSS from CDNs). The only native
 * piece is eitri-bifrost's bridge: the page posts {methodName, promiseId, args} to
 * window.ReactNativeWebView and the host answers through
 * window.EITRI.connector.resolvePromise / rejectPromise. This script is that host: remote
 * config from a file, initialization params, storage in memory, HTTP performed by Node
 * (no CORS), and a record of everything a browser cannot do (opening other mini-apps,
 * the system browser...).
 *
 *   node browser-preview.mjs (--app <workspace name> | --workspace <id> | --url <url>) [options]
 *
 *   --config <file>     remote config: create-app's .eitri/remote-config.json ({ config }) or the
 *                       environment config itself (get_environment_config → config)
 *   --init "k=v&k2=v2"  initialization params (getInitializationInfos), e.g. "route=Categories"
 *   --locale pt-BR      navigator.language / i18n (default: config storePreferences.locale, else pt-BR)
 *   --bp 375            viewport width; height 812 (default 375, like site-clone's phone capture)
 *   --dpr 1             device scale factor (default 1: same pixels as site-clone's screenshots)
 *   --out preview       output root (default ./preview); files go to <out>/<name>/
 *   --name <name>       default: the --app name, else "app"
 *   --wait 4000         settle time after the network is idle
 *   --compare <png>     reference screenshot (site-clone: scrape/<slug>/screenshots/375-fullpage.png):
 *                       writes compare/NN.png, the reference and the app side by side per screen
 *   --headed            show the browser and keep it open, interactive, until its window is closed
 *
 * Writes viewport.png, fullpage.png, tiles/NN.png (screen-high slices of the full page) and
 * report.json (native calls, unhandled methods, apps/links the page tried to open, page
 * errors, console errors, failed requests).
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}
const flag = name => argv.includes(`--${name}`)

const SCREEN_HEIGHT = 812
const WORKSPACE_URL = id => `https://api.eitri.tech/foundry/user/${id}/index.html`

/** Methods with nothing to show in a browser: answered with null, not reported. */
const NO_OPS = new Set([
  'notifyBifrostLoad', 'setStatusBarTextBlack', 'setStatusBarTextWhite', 'scrollDirectionChanged', 'keyboardDismiss',
  'hapticFeedbackVibration', 'bottomBarShow', 'bottomBarHide', 'dynamicMethod', 'dynamicMethodGetDescriptors',
])
/** What a page asks the host to open or leave: recorded in report.opened, answered with null. */
const OPENS = new Set(['openEitriApp', 'openBrowser', 'openDeeplink', 'close', 'bottomBarChangeTab', 'reloadEitriApp', 'shareLink', 'shareText', 'systemOpenAppSettings'])

function usage(message) {
  if (message) console.error(message)
  console.error('usage: browser-preview.mjs (--app <workspace name> | --workspace <id> | --url <url>) [--config <file>] [--init "k=v"] [--compare <png>] …')
  process.exit(2)
}

async function loadChromium() {
  try {
    return (await import('playwright')).chromium
  } catch {}
  // site-clone, in the same plugin, already installs Playwright.
  try {
    return createRequire(join(here, '../../site-clone/scripts/package.json'))('playwright').chromium
  } catch {}
  console.error(`\nPlaywright is not installed for this tool. Run once:\n\n  cd ${here} && npm install && npx playwright install chromium\n`)
  process.exit(1)
}

/** `eitri workspace list` → the id of the workspace with this name (app-config.yaml → workspace). */
function workspaceIdByName(name) {
  const text = execFileSync('eitri', ['workspace', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\x1b\[[0-9;]*m/g, '')
  const match = new RegExp(`Workspace:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n\\s*Id:\\s*([0-9a-f-]{36})`, 'i').exec(text)
  if (!match) throw new Error(`No workspace named "${name}" in \`eitri workspace list\`. Run \`eitri app start\` first.`)
  return match[1]
}

function readConfig(file) {
  if (!file) return {}
  const json = JSON.parse(readFileSync(file, 'utf8'))
  return json && typeof json.config === 'object' && json.config ? json.config : json
}

/** "route=Categories&tabIndex=1" → { route: 'Categories', tabIndex: 1 } (numbers and booleans typed). */
function parseInit(text) {
  const out = {}
  for (const [key, value] of new URLSearchParams(text ?? '')) {
    out[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value === 'true' ? true : value === 'false' ? false : value
  }
  return out
}

async function httpCall(method, args = {}) {
  const { url, data, config = {} } = args
  const target = new URL(url)
  for (const [key, value] of Object.entries(config.params ?? {})) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value))
  }
  const headers = { ...(config.headers ?? {}) }
  let body
  if (data !== undefined && data !== null && !['GET', 'HEAD'].includes(method)) {
    body = typeof data === 'string' ? data : JSON.stringify(data)
    if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'
  }
  const res = await fetch(target, { method, headers, body, redirect: 'follow' })
  const text = method === 'HEAD' ? '' : await res.text()
  let parsed = text
  try { parsed = JSON.parse(text) } catch {}
  const responseHeaders = Object.fromEntries(res.headers)
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  if (cookies.length) responseHeaders['set-cookie'] = cookies
  const response = { status: res.status, statusText: res.statusText, headers: responseHeaders, data: parsed, config }
  return res.status >= 400 ? { __reject: { ...response, message: `Request failed with status code ${res.status}` } } : response
}

async function main() {
  const name = opt('name', opt('app', 'app'))
  let url = opt('url')
  if (!url) {
    const id = opt('workspace') ?? (opt('app') ? workspaceIdByName(opt('app')) : undefined)
    if (!id) usage('Pass --app, --workspace or --url.')
    url = WORKSPACE_URL(id)
  }
  const target = new URL(url)
  const config = readConfig(opt('config'))
  const locale = opt('locale', config?.storePreferences?.locale ?? 'pt-BR')
  // What Eitri-Play appends: eitri-bifrost's canIUse(level) reads api_level, the templates' i18n reads hl.
  if (!target.searchParams.has('api_level')) target.searchParams.set('api_level', '30')
  if (!target.searchParams.has('hl')) target.searchParams.set('hl', locale)
  const init = parseInit(opt('init'))
  const width = Number(opt('bp', '375'))
  const out = resolve(opt('out', 'preview'), name)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'tiles'), { recursive: true })

  const storage = new Map()
  const nativeCalls = {}
  const unhandled = new Set()
  const opened = []
  const handlers = {
    getConfigs: () => ({
      applicationData: { env: 'dev', platform: 'android', language: locale },
      eitriAppData: {},
      superAppData: { safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 }, platform: 'android', language: locale, appVersion: 'browser-preview' },
    }),
    environmentGetRemoteConfigs: () => config,
    getInitializationInfos: () => init,
    isOnline: () => true,
    getDeviceInfos: () => ({ platform: 'android', osVersion: '14', brand: 'browser-preview', model: 'Chromium', apiLevel: 34, language: locale }),
    storageGetItem: a => storage.get(a?.key) ?? null,
    storageSetItem: a => (storage.set(a?.key, a?.value), null),
    storageRemoveItem: a => (storage.delete(a?.key), null),
    storageKeys: () => [...storage.keys()],
    storageClear: () => (storage.clear(), null),
    notificationCheckPermission: () => ({ status: 'GRANTED' }),
    notificationRequestPermission: () => ({ status: 'GRANTED' }),
    geolocationCheckPermission: () => ({ status: 'DENIED' }),
    cameraCheckPermission: () => ({ status: 'DENIED' }),
    canOpenDeeplink: () => false,
    httpGet: a => httpCall('GET', a),
    httpPost: a => httpCall('POST', a),
    httpPut: a => httpCall('PUT', a),
    httpPatch: a => httpCall('PATCH', a),
    httpDelete: a => httpCall('DELETE', a),
    httpHead: a => httpCall('HEAD', a),
    httpOptions: a => httpCall('OPTIONS', a),
  }

  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: !flag('headed') })
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    deviceScaleFactor: Number(opt('dpr', '1')),
    isMobile: true,
    hasTouch: true,
    locale,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 EitriBrowserPreview',
  })
  await context.exposeFunction('__eitriHost', async json => {
    const { methodName, args } = JSON.parse(json)
    nativeCalls[methodName] = (nativeCalls[methodName] ?? 0) + 1
    if (OPENS.has(methodName)) {
      opened.push({ method: methodName, args })
      return null
    }
    if (NO_OPS.has(methodName)) return null
    const handler = handlers[methodName]
    if (!handler) {
      unhandled.add(methodName)
      return null
    }
    try {
      return await handler(args)
    } catch (e) {
      return { __reject: { message: e instanceof Error ? e.message : String(e) } }
    }
  })
  await context.addInitScript(() => {
    window.ReactNativeWebView = {
      postMessage(json) {
        const { promiseId } = JSON.parse(json)
        window.__eitriHost(json).then(res => {
          const connector = window.EITRI && window.EITRI.connector
          if (!connector) return
          if (res && res.__reject) connector.rejectPromise({ promiseId, res: res.__reject })
          else connector.resolvePromise({ promiseId, res })
        })
      },
    }
  })

  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  const failedRequests = []
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 500)))
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`.slice(0, 400))
  })
  page.on('requestfailed', r => failedRequests.push(`${r.failure()?.errorText ?? 'failed'} ${r.url()}`.slice(0, 300)))
  page.on('response', r => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`.slice(0, 300))
  })

  await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 })
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }) } catch {}
  await page.waitForTimeout(Number(opt('wait', '4000')))

  // Content wider than the screen is a layout bug on a phone: report it, and keep every shot screen-wide.
  const { height, scrollWidth } = await page.evaluate(() => ({
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
  }))
  await page.screenshot({ path: join(out, 'viewport.png') })
  await page.screenshot({ path: join(out, 'fullpage.png'), fullPage: true, clip: { x: 0, y: 0, width, height } })
  const tiles = Math.max(1, Math.ceil(height / SCREEN_HEIGHT))
  const pad = n => String(n).padStart(2, '0')
  for (let i = 0; i < tiles; i++) {
    const y = i * SCREEN_HEIGHT
    await page.screenshot({ path: join(out, 'tiles', `${pad(i + 1)}.png`), fullPage: true, clip: { x: 0, y, width, height: Math.min(SCREEN_HEIGHT, height - y) } })
  }

  const reference = opt('compare')
  if (reference) {
    mkdirSync(join(out, 'compare'), { recursive: true })
    const dataUrl = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`
    const refUrl = dataUrl(reference)
    const appUrl = dataUrl(join(out, 'fullpage.png'))
    // Its own desktop context: in the phone context a page without a viewport meta is zoomed out.
    const sheetContext = await browser.newContext({ viewport: { width: width * 2 + 24, height: SCREEN_HEIGHT + 28 }, deviceScaleFactor: 1 })
    const sheet = await sheetContext.newPage()
    await sheet.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;background:#9ca3af;font:12px/20px sans-serif">
      <div style="display:flex;gap:8px;padding:0 8px;height:24px"><b style="width:${width}px">reference</b><b style="width:${width}px">app</b></div>
      <div style="display:flex;gap:8px;padding:0 8px;height:${SCREEN_HEIGHT}px">
        <div style="width:${width}px;height:${SCREEN_HEIGHT}px;overflow:hidden;position:relative;background:#fff"><img id="ref" src="${refUrl}" style="position:absolute;left:0;top:0;width:${width}px"></div>
        <div style="width:${width}px;height:${SCREEN_HEIGHT}px;overflow:hidden;position:relative;background:#fff"><img id="app" src="${appUrl}" style="position:absolute;left:0;top:0;width:${width}px"></div>
      </div></body>`)
    await sheet.waitForFunction(() => [...document.images].every(i => i.complete))
    const refHeight = await sheet.evaluate(() => document.getElementById('ref').getBoundingClientRect().height)
    const pairs = Math.max(tiles, Math.ceil(refHeight / SCREEN_HEIGHT))
    for (let i = 0; i < pairs; i++) {
      await sheet.evaluate(top => {
        document.getElementById('ref').style.top = `${-top}px`
        document.getElementById('app').style.top = `${-top}px`
      }, i * SCREEN_HEIGHT)
      await sheet.screenshot({ path: join(out, 'compare', `${pad(i + 1)}.png`) })
    }
    await sheetContext.close()
  }

  const report = {
    url: target.toString(),
    locale,
    init,
    title: await page.title(),
    pageHeight: height,
    overflowX: scrollWidth > width ? scrollWidth : null,
    tiles,
    nativeCalls,
    unhandled: [...unhandled],
    opened,
    pageErrors,
    consoleErrors: consoleErrors.slice(0, 60),
    failedRequests: failedRequests.slice(0, 60),
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`browser-preview → ${out}`)
  console.log(`  ${tiles} tile(s), ${Object.values(nativeCalls).reduce((a, b) => a + b, 0)} native calls, ${pageErrors.length} page error(s)`)
  if (report.unhandled.length) console.log(`  unhandled native methods: ${report.unhandled.join(', ')}`)
  if (opened.length) console.log(`  the page tried to open: ${opened.map(o => `${o.method}(${JSON.stringify(o.args)})`).join(', ')}`)
  if (report.overflowX) console.log(`  ! content is ${report.overflowX}px wide on a ${width}px screen (horizontal overflow)`)
  for (const e of pageErrors.slice(0, 5)) console.log(`  ! ${e}`)

  if (flag('headed')) {
    // A person is looking: keep the app open and interactive until its window is closed,
    // and say live what a browser cannot do (another mini-app, a link) and any new error.
    const seen = { opened: opened.length, errors: pageErrors.length }
    const live = setInterval(() => {
      for (const o of opened.slice(seen.opened)) console.log(`  → the app asked to open ${o.method}(${JSON.stringify(o.args)}) — not followed in the browser`)
      for (const e of pageErrors.slice(seen.errors)) console.log(`  ! ${e}`)
      seen.opened = opened.length
      seen.errors = pageErrors.length
    }, 500)
    console.log('  the browser stays open: use the app, then close its window to finish')
    await new Promise(resolve => {
      page.on('close', resolve)
      browser.on('disconnected', resolve)
    })
    clearInterval(live)
  }
  await browser.close().catch(() => {})
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
