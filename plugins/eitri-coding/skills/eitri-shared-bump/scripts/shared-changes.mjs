#!/usr/bin/env node
// shared-changes.mjs — what changed in the shared libraries an Eitri project links to.
//
// Reads every eitri-app.conf.js of the project (or workspace), collects the
// `eitri-app-dependencies` flagged `isEitriAppShared`, and compares each pin with a
// target version (default: the latest) of that library:
//   upstream : published from eitri-tech/eitri-shopping-services-shared (a directory of that
//              repo named like the dependency) — history from a cached partial clone
//   sibling  : an app of the same workspace (app-config.yaml) — history from its own git repo
//   external : anything else — reported, no source to diff
//
// The upstream repo has NO changelog and NO GitHub Releases, so the changelog is rebuilt from
// `git log <pinned>..<target> -- <library-dir>/`. If a CHANGELOG.md appears in the library
// directory it is returned as `changelogMd` and should be preferred.
//
// Usage:
//   node shared-changes.mjs [--root DIR] [--only LIB] [--from A] [--to B] [--no-fetch] [--max-commits N]
//        full JSON report (needs git; first run clones the upstream repo into a cache)
//   node shared-changes.mjs --check            one line per outdated / skewed pin (cached, network-light)
//   node shared-changes.mjs --pins-changed     shared pins changed in the working tree/branch vs the base branch
//   node shared-changes.mjs --hook EVENT       hook entry point (SessionStart | PostToolUse | Stop), payload on stdin
//
// Zero dependencies. Node >= 18.

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const UPSTREAM_REPO = 'eitri-tech/eitri-shopping-services-shared'
const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPO}.git`
const UPSTREAM_RAW = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/main`
const CACHE_ROOT = path.join(
	process.env.CLAUDE_PLUGIN_DATA || process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
	'eitri-coding'
)
const CHECK_TTL_MS = 6 * 60 * 60 * 1000
const CONF = 'eitri-app.conf.js'
const SCAN_LIMIT = 80 // conf-touching commits inspected when a tag cannot anchor a version

// ---------- args ----------
const argv = process.argv.slice(2)
const flag = n => argv.includes(`--${n}`)
const opt = (n, d = '') => {
	const i = argv.indexOf(`--${n}`)
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const MAX_COMMITS = Number(opt('max-commits', '60'))

// ---------- helpers ----------
const git = (args, { dir, gitDir, allowFail = true, input } = {}) => {
	const base = gitDir ? ['--git-dir', gitDir] : ['-C', dir]
	try {
		return execFileSync('git', [...base, ...args], {
			encoding: 'utf8',
			maxBuffer: 128 * 1024 * 1024,
			stdio: ['pipe', 'pipe', 'pipe'],
			input,
			timeout: 120000,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
		})
	} catch (e) {
		if (allowFail) return null
		throw e
	}
}

const cmpVer = (a, b) => {
	const x = String(a).split('.').map(n => parseInt(n, 10) || 0)
	const y = String(b).split('.').map(n => parseInt(n, 10) || 0)
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1
	}
	return 0
}
const uniqSorted = vs => [...new Set(vs)].sort(cmpVer)

// Evaluates a conf (`module.exports = {...}`) in a sandbox. The serialization happens INSIDE the
// sandbox, under the timeout, so getters/Proxies cannot run unbounded code afterwards. Structure,
// not regex: nested dependency `version` keys can never be mistaken for the app's own version.
function evalConf(text) {
	if (!text) return null
	try {
		const sandbox = { module: { exports: {} } }
		sandbox.exports = sandbox.module.exports
		const json = vm.runInNewContext(`${text}\n;JSON.stringify(module.exports)`, sandbox, { timeout: 1000 })
		const obj = JSON.parse(json)
		return obj && typeof obj === 'object' ? obj : null
	} catch {
		return null
	}
}
const readConf = file => {
	try {
		return evalConf(fs.readFileSync(file, 'utf8'))
	} catch {
		return null
	}
}
const publishMessage = c => (c && (c.messageVersion || c.versionMessage)) || null

// ---------- discover the project's apps ----------
function findWorkspaceRoot(start) {
	let d = path.resolve(start)
	for (let i = 0; i < 4; i++) {
		if (fs.existsSync(path.join(d, 'app-config.yaml'))) return d
		const up = path.dirname(d)
		if (up === d) break
		d = up
	}
	return path.resolve(start)
}

function discoverApps(start) {
	const root = findWorkspaceRoot(start)
	const confs = new Set()
	const add = f => fs.existsSync(f) && confs.add(path.resolve(f))
	add(path.join(root, CONF))
	const yml = path.join(root, 'app-config.yaml')
	if (fs.existsSync(yml)) {
		for (const m of fs.readFileSync(yml, 'utf8').matchAll(/^\s*-?\s*path:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) {
			add(path.join(root, m[1], CONF))
		}
	}
	if (confs.size === 0) {
		for (const e of fs.readdirSync(root, { withFileTypes: true })) {
			if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') add(path.join(root, e.name, CONF))
		}
	}
	const apps = [...confs]
		.map(file => ({ file, dir: path.dirname(file), conf: readConf(file) }))
		.filter(a => a.conf)
		.map(a => ({ ...a, name: a.conf.name || a.conf.slug || path.basename(a.dir) }))
	return { root, apps }
}

function sharedDeps(conf) {
	const out = {}
	for (const [name, spec] of Object.entries((conf && conf['eitri-app-dependencies']) || {})) {
		if (spec && spec.isEitriAppShared && spec.version) out[name] = String(spec.version)
	}
	return out
}

function collectLinks(apps, only) {
	const byName = new Map(apps.map(a => [a.name, a]))
	const links = new Map()
	for (const app of apps) {
		for (const [name, version] of Object.entries(sharedDeps(app.conf))) {
			if (!links.has(name)) links.set(name, { name, pins: [], sibling: byName.get(name) || null })
			links.get(name).pins.push({ app: app.name, version })
		}
	}
	return [...links.values()].filter(l => !only || l.name === only)
}

// ---------- upstream cache ----------
function ensureUpstream({ fetch }) {
	const gitDir = path.join(CACHE_ROOT, 'shopping-services-shared.git')
	fs.mkdirSync(CACHE_ROOT, { recursive: true })
	if (!fs.existsSync(path.join(gitDir, 'HEAD'))) {
		execFileSync('git', ['clone', '-q', '--bare', '--filter=blob:none', UPSTREAM_URL, gitDir], {
			stdio: ['ignore', 'ignore', 'pipe'],
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
		})
	} else if (fetch) {
		git(['fetch', '-q', '--force', '--tags', 'origin', '+refs/heads/main:refs/heads/main'], { gitDir })
	}
	return gitDir
}

// ---------- version -> commit anchors ----------
// `ctx` = { gitDir } or { dir }; `prefix` = library dir relative to the repo root, '' or 'x/'.
function makeAnchors(ctx, prefix, libName, headRef) {
	const confPath = `${prefix}${CONF}`
	const dirPath = prefix ? prefix.replace(/\/$/, '') : null
	const treeOf = sha => (dirPath ? `${sha}:${dirPath}` : `${sha}^{tree}`)
	const confAt = sha => evalConf(git(['show', `${sha}:${confPath}`], ctx))

	let touch = null // first-parent commits that touched the conf, newest first
	const touchCommits = () =>
		(touch ??= (git(['log', '--format=%H', '--first-parent', `-n${SCAN_LIMIT}`, headRef, '--', confPath], ctx) || '')
			.split('\n')
			.filter(Boolean))

	let scanned = null // version -> [{sha, message}] seen across conf-touching commits (lazy)
	const scan = () => {
		if (scanned) return scanned
		scanned = new Map()
		for (const sha of touchCommits()) {
			const c = confAt(sha)
			if (!c || (c.name && c.name !== libName)) continue
			const v = String(c.version)
			if (!scanned.has(v)) scanned.set(v, [])
			scanned.get(v).push({ sha, message: publishMessage(c) })
		}
		return scanned
	}

	// does some conf-touching commit carry exactly the same library tree as `sha`? (trees only, no blobs)
	const sameTreeAsConfCommit = sha => {
		const cands = touchCommits()
		if (!cands.length) return false
		// batch-check resolves each name independently: a commit where the directory does not exist
		// (before creation / after deletion) prints "<name> missing" instead of failing the whole call
		const names = [treeOf(sha), ...cands.map(treeOf)]
		const out = git(['cat-file', '--batch-check=%(objectname)'], { ...ctx, input: names.join('\n') + '\n' })
		if (!out) return false
		const [target, ...rest] = out.trim().split('\n')
		if (!target || target.endsWith('missing')) return false
		return rest.some(h => h === target)
	}

	const resolve = version => {
		const tagSha = git(['rev-parse', '--verify', '-q', `shared-${version}^{commit}`], ctx)?.trim()
		if (tagSha) {
			const c = confAt(tagSha)
			if (c && String(c.version) === version && (!c.name || c.name === libName)) {
				const exact = sameTreeAsConfCommit(tagSha)
				return {
					sha: tagSha,
					via: 'tag',
					ambiguous: !exact,
					why: exact ? null : `tag shared-${version} carries ${libName}@${version}, but the library changed after the last commit that touched its conf — the tag may belong to another library's release`
				}
			}
		}
		const hits = scan().get(version)
		if (hits && hits.length) {
			return {
				sha: hits[0].sha,
				via: 'conf-history',
				ambiguous: hits.length > 1,
				why: hits.length > 1 ? `version ${version} was set ${hits.length} times (rollbacks/re-bumps); candidates: ${hits.map(h => h.sha.slice(0, 7)).join(', ')}` : null
			}
		}
		return null
	}
	return { resolve, scan, confAt }
}

// ---------- changelog for one library ----------
const RC_PATTERNS = [
	/getContent\(\s*['"`]([\w.\-[\]]+)['"`]/g,
	/\b((?:appConfigs|providerInfo|storePreferences)(?:\??\.[\w]+)+)/g
]
const normKey = k => k.replace(/\?/g, '')
function remoteConfigKeys(ctx, from, to, dirPrefix) {
	const diff = git(['diff', '-U0', '--no-color', from, to, '--', `${dirPrefix}src`], ctx)
	if (!diff) return { added: [], removed: [] }
	const seen = { '+': new Map(), '-': new Map() }
	let file = ''
	for (const line of diff.split('\n')) {
		if (line.startsWith('+++ b/')) file = line.slice(6 + dirPrefix.length)
		else if (line.startsWith('+') || line.startsWith('-')) {
			if (line.startsWith('+++') || line.startsWith('---')) continue
			for (const re of RC_PATTERNS) {
				for (const m of line.matchAll(re)) {
					const key = normKey(m[1])
					if (!seen[line[0]].has(key)) seen[line[0]].set(key, new Set())
					seen[line[0]].get(key).add(file)
				}
			}
		}
	}
	const fmt = (map, other) =>
		[...map].filter(([k]) => !other.has(k)).map(([key, files]) => ({ key, files: [...files].slice(0, 5) }))
	return { added: fmt(seen['+'], seen['-']), removed: fmt(seen['-'], seen['+']) }
}

function commitsBetween(ctx, from, to, dirPrefix) {
	const spec = `${from}..${to}`
	const where = dirPrefix || '.'
	const meta = git(['log', `--format=%H\x1f%ad\x1f%an\x1f%P\x1f%s\x1f%b\x1e`, '--date=short', spec, '--', where], ctx) || ''
	const filesOut = git(['log', '--format=%x1e%H', '--name-only', '-z', spec, '--', where], ctx) || ''
	const filesBy = new Map()
	for (const chunk of filesOut.split('\x1e').slice(1)) {
		// chunk = "<sha>\n<file1>\0<file2>\0": the header line ends with a newline, files are NUL-terminated
		const nl = chunk.indexOf('\n')
		const sha = (nl < 0 ? chunk : chunk.slice(0, nl)).replace(/\0/g, '').trim()
		const files = (nl < 0 ? '' : chunk.slice(nl + 1)).split('\0').filter(Boolean)
		filesBy.set(sha, files.map(f => (dirPrefix && f.startsWith(dirPrefix) ? f.slice(dirPrefix.length) : f)))
	}
	const commits = []
	for (const rec of meta.split('\x1e')) {
		const [sha, date, author, parents, subject, body] = rec.replace(/^\n/, '').split('\x1f')
		if (!sha) continue
		const files = filesBy.get(sha.trim()) || []
		commits.push({
			sha: sha.trim().slice(0, 7),
			date,
			author,
			merge: (parents || '').trim().split(' ').filter(Boolean).length > 1,
			subject,
			body: (body || '').trim().slice(0, 600),
			files: files.slice(0, 25),
			touchesPublicSurface: files.some(f => /^src\/export\.(js|ts)$/.test(f)),
			touchesConf: files.includes(CONF)
		})
	}
	return commits
}

function changelog(ctx, prefix, libName, pinned, target, { headRef, light = false } = {}) {
	const anchors = makeAnchors(ctx, prefix, libName, headRef)
	const from = anchors.resolve(pinned)
	const to = anchors.resolve(target)
	const res = { from, to, notes: [] }
	if (!from) res.notes.push(`Could not locate ${libName}@${pinned} in the history (unpublished, other branch, or older than ${SCAN_LIMIT} conf changes). Compare manually.`)
	if (!to) res.notes.push(`Could not locate ${libName}@${target} in the history.`)
	for (const a of [from, to]) if (a?.why) res.notes.push(a.why)
	if (!from || !to) return res
	if (git(['merge-base', '--is-ancestor', from.sha, to.sha], ctx) === null) {
		res.notes.push(`${pinned} is not an ancestor of ${target} on this history — range may be meaningless (pin ahead of main, or diverged branches).`)
	}
	res.commits = commitsBetween(ctx, from.sha, to.sha, prefix).slice(0, MAX_COMMITS)
	res.remoteConfigKeys = remoteConfigKeys(ctx, from.sha, to.sha, prefix)
	if (light) return res

	res.exportDiff = ['src/export.js', 'src/export.ts'].map(f => `git diff ${from.sha.slice(0, 10)} ${to.sha.slice(0, 10)} -- ${prefix}${f}`)
	res.releases = releasesIn(ctx, prefix, libName, anchors, pinned, target)
	const un = git(['log', '--format=%h %ad %s', '--date=short', `${to.sha}..${headRef}`, '--', prefix || '.'], ctx)
	res.unreleased = (un || '').split('\n').filter(Boolean).slice(0, 20)
	return res
}

// one entry per published version in (pinned, target], with the publish message (`messageVersion`)
function releasesIn(ctx, prefix, libName, anchors, pinned, target) {
	const out = []
	const tags = (git(['for-each-ref', 'refs/tags/shared-*', '--format=%(refname:short) %(objectname)'], ctx) || '')
		.split('\n')
		.filter(Boolean)
		.map(l => l.split(' '))
		.map(([ref, sha]) => ({ version: ref.replace(/^shared-/, ''), sha }))
		.filter(t => /^\d+(\.\d+)*$/.test(t.version) && cmpVer(t.version, pinned) > 0 && cmpVer(t.version, target) <= 0)
		.sort((a, b) => cmpVer(a.version, b.version))
		.slice(0, 40)
	for (const t of tags) {
		const c = anchors.confAt(t.sha)
		if (c && String(c.version) === t.version && (!c.name || c.name === libName)) {
			out.push({ version: t.version, messageVersion: publishMessage(c), sha: t.sha.slice(0, 7), via: 'tag' })
		}
	}
	if (!out.length) {
		// no usable tags (sibling workspaces): fall back to the conf history
		for (const [version, hits] of anchors.scan()) {
			if (cmpVer(version, pinned) > 0 && cmpVer(version, target) <= 0) {
				out.push({ version, messageVersion: hits[0].message, sha: hits[0].sha.slice(0, 7), via: 'conf-history' })
			}
		}
		out.sort((a, b) => cmpVer(a.version, b.version))
	}
	return out
}

// ---------- fast check (hook) ----------
async function rawVersion(name, signal) {
	try {
		const r = await fetch(`${UPSTREAM_RAW}/${name}/${CONF}`, { signal })
		if (!r.ok) return null
		const c = evalConf(await r.text())
		return c && c.version ? String(c.version) : null
	} catch {
		return null
	}
}

async function checkLines(start) {
	const { apps } = discoverApps(start)
	const links = collectLinks(apps)
	if (!links.length) return []
	const cacheFile = path.join(CACHE_ROOT, 'check-cache.json')
	let cache = {}
	try {
		cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
	} catch {}
	const ctrl = new AbortController()
	const deadline = setTimeout(() => ctrl.abort(), 6000) // global, below the hook timeout
	const rows = await Promise.all(
		links.map(async l => {
			let latest = null
			let kind = 'external'
			if (l.sibling) {
				kind = 'sibling'
				latest = String(l.sibling.conf.version)
			} else if (/^eitri-shopping-.+/.test(l.name)) {
				kind = 'upstream'
				const c = cache[l.name]
				if (c && Date.now() - c.at < CHECK_TTL_MS) latest = c.version
				else {
					latest = await rawVersion(l.name, ctrl.signal)
					if (latest) cache[l.name] = { at: Date.now(), version: latest }
				}
			}
			return { l, kind, latest }
		})
	)
	clearTimeout(deadline)
	try {
		fs.mkdirSync(CACHE_ROOT, { recursive: true })
		fs.writeFileSync(cacheFile, JSON.stringify(cache))
	} catch {}
	const lines = []
	for (const { l, kind, latest } of rows) {
		const pins = uniqSorted(l.pins.map(p => p.version))
		if (latest && cmpVer(pins[0], latest) < 0) {
			lines.push(`${l.name} (${kind}): pinned ${pins.join(', ')}${pins.length > 1 ? ' (apps differ)' : ''} → latest ${latest}`)
		} else if (pins.length > 1) {
			lines.push(`${l.name} (${kind}): apps pin different versions (${pins.join(', ')})`)
		}
	}
	return lines
}

// ---------- pins changed in the working tree / branch ----------
// Returns { ref, resolved }. `resolved: false` means no default branch was found: only uncommitted
// changes are visible (committed bumps on a feature branch would be missed) — callers must say so.
function baseRef(repo) {
	const candidates = []
	if (opt('base')) candidates.push(opt('base'))
	const head = git(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { dir: repo })?.trim()
	if (head) candidates.push(head.replace(/^refs\/remotes\//, ''))
	const dflt = git(['config', '--get', 'init.defaultBranch'], { dir: repo })?.trim()
	if (dflt) candidates.push(`origin/${dflt}`, dflt)
	for (const b of ['main', 'master', 'develop', 'dev', 'trunk']) candidates.push(`origin/${b}`, b)
	for (const c of candidates) {
		if (git(['rev-parse', '--verify', '-q', c], { dir: repo })) {
			const mb = git(['merge-base', 'HEAD', c], { dir: repo })?.trim()
			if (mb) return { ref: mb, resolved: true }
		}
	}
	return { ref: 'HEAD', resolved: false }
}

function pinsChanged(start) {
	const { root, apps } = discoverApps(start)
	const top = git(['rev-parse', '--show-toplevel'], { dir: root })?.trim()
	if (!top) return { root, changes: [] }
	const { ref: base, resolved: baseResolved } = baseRef(top)
	const byLib = new Map()
	for (const app of apps) {
		const rel = path.relative(top, app.file).split(path.sep).join('/')
		const before = sharedDeps(evalConf(git(['show', `${base}:${rel}`], { dir: top })))
		const now = sharedDeps(app.conf)
		for (const lib of new Set([...Object.keys(before), ...Object.keys(now)])) {
			if (before[lib] === now[lib]) continue
			if (!byLib.has(lib)) byLib.set(lib, { lib, from: [], to: [], apps: [] })
			const e = byLib.get(lib)
			if (before[lib]) e.from.push(before[lib])
			if (now[lib]) e.to.push(now[lib])
			e.apps.push(app.name)
		}
	}
	const changes = [...byLib.values()].map(e => ({ lib: e.lib, from: uniqSorted(e.from), to: uniqSorted(e.to), apps: e.apps }))
	return {
		root,
		base: base.slice(0, 10),
		baseResolved,
		...(baseResolved ? {} : { warning: 'No default branch found (use --base <ref>): only uncommitted pin changes are detected; committed bumps on this branch are not.' }),
		changes
	}
}

// ---------- markers (dedupe hook nudges) ----------
// Markers only throttle nudges; they expire (TTL) so a later, different bump is never silenced
// by an old acknowledgement, and a missing session id cannot suppress anything permanently.
const MARKER_TTL_MS = 12 * 60 * 60 * 1000
const markerFile = key => path.join(CACHE_ROOT, 'markers', crypto.createHash('sha1').update(key).digest('hex').slice(0, 20))
const hasMarker = key => {
	try {
		return Date.now() - fs.statSync(markerFile(key)).mtimeMs < MARKER_TTL_MS
	} catch {
		return false
	}
}
function setMarker(key) {
	try {
		fs.mkdirSync(path.dirname(markerFile(key)), { recursive: true })
		fs.writeFileSync(markerFile(key), new Date().toISOString())
	} catch {}
}
const reportedKey = (root, lib, from, to) => `reported:${root}:${lib}:${from}→${to}`

// ---------- full report ----------
async function report(start) {
	const { root, apps } = discoverApps(start)
	if (!apps.length) return { error: `No ${CONF} found under ${start}` }
	const only = opt('only')
	const links = collectLinks(apps, only || null)
	const out = { root, apps: apps.map(a => ({ name: a.name, version: a.conf.version })), libraries: [] }

	let upstream = null
	const up = () => (upstream ??= ensureUpstream({ fetch: !flag('no-fetch') }))

	for (const l of links) {
		const pinned = uniqSorted(l.pins.map(p => p.version))
		const entry = { name: l.name, pins: l.pins, pinnedVersions: pinned, versionSkew: pinned.length > 1 }
		const from = (only && opt('from')) || pinned[0]
		try {
			if (l.sibling) {
				entry.kind = 'sibling'
				entry.path = path.relative(root, l.sibling.dir) || '.'
				entry.latest = String(l.sibling.conf.version)
				entry.publishMessage = publishMessage(l.sibling.conf)
				entry.ownPins = sharedDeps(l.sibling.conf)
				const target = (only && opt('to')) || entry.latest
				entry.target = target
				const repo = git(['rev-parse', '--show-toplevel'], { dir: l.sibling.dir })?.trim()
				if (!repo) entry.note = 'sibling is not inside a git repository — no history to diff'
				else {
					const prefix = path.relative(repo, l.sibling.dir).split(path.sep).join('/')
					const pfx = prefix ? `${prefix}/` : ''
					const md = git(['show', `HEAD:${pfx}CHANGELOG.md`], { dir: repo })
					if (md) entry.changelogMd = md.slice(0, 20000)
					if (cmpVer(from, target) < 0) {
						entry.changelog = changelog({ dir: repo }, pfx, l.name, from, target, { headRef: 'HEAD' })
						if (cmpVer(target, entry.latest) < 0) entry.skipped = changelog({ dir: repo }, pfx, l.name, target, entry.latest, { headRef: 'HEAD', light: true })
					}
				}
			} else if (/^eitri-shopping-.+/.test(l.name)) {
				entry.kind = 'upstream'
				const gitDir = up()
				entry.gitDir = gitDir
				entry.source = `https://github.com/${UPSTREAM_REPO}/tree/main/${l.name}`
				const main = evalConf(git(['show', `main:${l.name}/${CONF}`], { gitDir }))
				if (!main) {
					entry.kind = 'external'
					entry.note = `${l.name} is not a directory of ${UPSTREAM_REPO}; no changelog source.`
				} else {
					entry.latest = String(main.version)
					entry.publishMessage = publishMessage(main)
					const target = (only && opt('to')) || entry.latest
					entry.target = target
					const md = git(['show', `main:${l.name}/CHANGELOG.md`], { gitDir })
					if (md) entry.changelogMd = md.slice(0, 20000)
					if (cmpVer(from, target) < 0) {
						entry.changelog = changelog({ gitDir }, `${l.name}/`, l.name, from, target, { headRef: 'main' })
						if (cmpVer(target, entry.latest) < 0) entry.skipped = changelog({ gitDir }, `${l.name}/`, l.name, target, entry.latest, { headRef: 'main', light: true })
					}
				}
			} else {
				entry.kind = 'external'
				entry.note = 'Linked shared Eitri-App with no known source repo — ask the user where its history lives.'
			}
			if (entry.target) {
				setMarker(reportedKey(root, l.name, from, entry.target))
				entry.status = cmpVer(from, entry.latest) < 0 ? 'outdated' : cmpVer(pinned.at(-1), entry.latest) > 0 ? 'ahead-of-main' : 'up-to-date'
			}
		} catch (e) {
			entry.error = String(e.message || e).split('\n')[0]
		}
		out.libraries.push(entry)
	}
	return out
}

// ---------- hooks ----------
const emit = obj => process.stdout.write(JSON.stringify(obj) + '\n')
const ctxOut = (event, text) => emit({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })
const describe = c => `${c.lib}: ${c.from.join(', ') || '(new)'} → ${c.to.join(', ') || '(removed)'} (${c.apps.join(', ')})`
const cmdFor = c => `--only ${c.lib}${c.from.length ? ` --from ${c.from[0]}` : ''}${c.to.length ? ` --to ${c.to.at(-1)}` : ''}`

async function readStdin() {
	if (process.stdin.isTTY) return {}
	const chunks = []
	for await (const c of process.stdin) chunks.push(c)
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'))
	} catch {
		return {}
	}
}

async function hook(event) {
	const p = await readStdin()
	const session = p.session_id || 'nosession'
	const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
	const skill = '`eitri-coding:eitri-shared-bump`'

	if (event === 'SessionStart') {
		const lines = await checkLines(cwd)
		if (!lines.length) return
		ctxOut(
			event,
			`SHARED LIBRARY UPDATES DETECTED in this Eitri project:\n${lines.map(l => `- ${l}`).join('\n')}\n` +
				`MANDATORY: invoke the ${skill} skill now and give the user a short awareness summary — what was fixed, added, broken, which new remote-config keys are needed and known issues — so they can decide on the bump. Report only: do not edit pins or versions unless the user asks.`
		)
	} else if (event === 'PostToolUse') {
		const file = p.tool_input && (p.tool_input.file_path || p.tool_input.path)
		if (!file || path.basename(file) !== CONF) return
		const { root, changes } = pinsChanged(path.dirname(file))
		const fresh = changes.filter(c => c.to.length && !hasMarker(`post:${session}:${root}:${c.lib}@${c.to.join(',')}`))
		if (!fresh.length) return
		for (const c of fresh) setMarker(`post:${session}:${root}:${c.lib}@${c.to.join(',')}`)
		ctxOut(
			event,
			`SHARED PIN CHANGED in ${CONF}:\n${fresh.map(c => `- ${describe(c)}`).join('\n')}\n` +
				`MANDATORY: before moving on, invoke the ${skill} skill to validate this bump (report: fixed / added / breaking / new remote-config keys / known issues / impact here). Suggested run: ${fresh.map(c => `shared-changes.mjs ${cmdFor(c)}`).join(' ; ')}. Finish the pending edits across the other apps first if the user asked for a workspace-wide bump, then report once.`
		)
	} else if (event === 'Stop') {
		if (p.stop_hook_active) return
		const { root, changes } = pinsChanged(cwd)
		const pending = changes.filter(
			c =>
				c.to.length &&
				!hasMarker(reportedKey(root, c.lib, c.from[0] || '', c.to.at(-1))) &&
				!hasMarker(`stop:${session}:${root}:${c.lib}:${c.from.join(',')}→${c.to.join(',')}`)
		)
		if (!pending.length) return
		for (const c of pending) setMarker(`stop:${session}:${root}:${c.lib}:${c.from.join(',')}→${c.to.join(',')}`)
		emit({
			decision: 'block',
			reason:
				`This task changes shared-library pins that were not validated yet:\n${pending.map(c => `- ${describe(c)}`).join('\n')}\n` +
				`Before finishing, invoke the ${skill} skill and give the user the awareness report (fixed / added / breaking / new remote-config keys / known issues / impact here), and check the pins match the intended target in every app (and the sibling shared, if any, was re-bumped). Suggested run: ${pending.map(c => `shared-changes.mjs ${cmdFor(c)}`).join(' ; ')}.`
		})
	}
}

// ---------- main ----------
const start = path.resolve(opt('root', process.env.CLAUDE_PROJECT_DIR || process.cwd()))
try {
	if (flag('hook')) await hook(opt('hook', 'SessionStart'))
	else if (flag('check')) {
		const lines = await checkLines(start)
		if (lines.length) process.stdout.write(lines.join('\n') + '\n')
	} else if (flag('pins-changed')) console.log(JSON.stringify(pinsChanged(start), null, 2))
	else console.log(JSON.stringify(await report(start), null, 2))
} catch (e) {
	if (!flag('hook') && !flag('check')) {
		console.log(JSON.stringify({ error: String(e.message || e) }))
		process.exitCode = 1
	}
}
process.exit(process.exitCode || 0)
