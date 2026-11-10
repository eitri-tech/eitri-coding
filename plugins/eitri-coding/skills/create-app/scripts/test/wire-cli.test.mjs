import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "wire-app.mjs")

function run(...args) {
    return runIn(undefined, ...args)
}

function runIn(cwd, ...args) {
    const res = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd })
    return { code: res.status, out: res.stdout, err: res.stderr }
}

function conf(slug, version, sharedVersion) {
    const dependency = sharedVersion
        ? `
	'eitri-app-dependencies': {
		'shopping-vtex-template-shared': {
			isEitriAppShared: true,
			version: '${sharedVersion}'
		}
	},`
        : ""
    return `module.exports = {
	'name': '${slug}',
	'title': '${slug}',
	'slug': '${slug}',
	'version': '${version}',
	'public-key': 'tpl-pk',
	'applicationId': 'tpl-app',
	'id': 'tpl-id',
	'organizationId': 'tpl-org',${dependency}
	'type': 'module'
}
`
}

/** A two-app template: a shared library and a home that imports it. */
function templateRepo() {
    const repo = mkdtempSync(join(tmpdir(), "tpl-"))
    writeFileSync(
        join(repo, "app-config.yaml"),
        `eitri-apps:
    - path: ./shopping-vtex-template-shared
      workspace: shared
      alias: shared
      shared: true
    - path: ./shopping-vtex-template-home
      workspace: home
      alias: home
      shared: false
bottom-tab-view-simulation:
  eitri-apps:
    - slug: "shopping-vtex-template-home"
      title: "Inicio"

application-id: tpl-app`,
    )
    writeFileSync(join(repo, "dynamic-bottom-tab-view-spec.json"), `{ "eitriApps": [ { "slug": "shopping-vtex-template-home", "title": "Inicio" } ] }`)
    mkdirSync(join(repo, "shopping-vtex-template-shared", "src"), { recursive: true })
    writeFileSync(join(repo, "shopping-vtex-template-shared", "eitri-app.conf.js"), conf("shopping-vtex-template-shared", "0.1.10"))
    mkdirSync(join(repo, "shopping-vtex-template-home", "src", "views"), { recursive: true })
    writeFileSync(join(repo, "shopping-vtex-template-home", "eitri-app.conf.js"), conf("shopping-vtex-template-home", "0.1.28", "0.1.9"))
    writeFileSync(
        join(repo, "shopping-vtex-template-home", "src", "views", "Home.jsx"),
        `import { Header } from 'shopping-vtex-template-shared'\nexport default function Home() { return Header }\n`,
    )
    return repo
}

test("plan names the mini-apps from the prefix and maps the navigable ones to their alias", () => {
    const repo = templateRepo()
    const res = run("plan", "--repo", repo, "--prefix", "loja-exemplo")
    assert.equal(res.code, 0, res.err)
    const plan = JSON.parse(res.out)
    assert.deepEqual(plan.createEitriApps, {
        apps: [
            { slug: "loja-exemplo-shared", title: "loja-exemplo-shared" },
            { slug: "loja-exemplo-home", title: "loja-exemplo-home" },
        ],
    })
    assert.deepEqual(plan.slugAliases, { "loja-exemplo-home": ["home"] })
    assert.deepEqual(
        plan.apps.map((a) => [a.templateSlug, a.slug, a.version, a.shared]),
        [
            ["shopping-vtex-template-shared", "loja-exemplo-shared", "0.1.10", true],
            ["shopping-vtex-template-home", "loja-exemplo-home", "0.1.28", false],
        ],
    )
})

test("plan rejects a prefix that would make invalid slugs", () => {
    const res = run("plan", "--repo", templateRepo(), "--prefix", "Loja Exemplo")
    assert.notEqual(res.code, 0)
    assert.match(res.err, /prefix/)
})

test("apply wires every file to the created mini-apps", () => {
    const repo = templateRepo()
    const planFile = join(repo, "plan.json")
    writeFileSync(planFile, run("plan", "--repo", repo, "--prefix", "loja-exemplo").out)
    const createdFile = join(repo, "created.json")
    writeFileSync(
        createdFile,
        JSON.stringify({
            created: [
                { id: "ea-shared", slug: "loja-exemplo-shared", title: "loja-exemplo-shared", publicKey: "pk-shared" },
                { id: "ea-home", slug: "loja-exemplo-home", title: "loja-exemplo-home", publicKey: "pk-home" },
            ],
        }),
    )
    const res = run("apply", "--repo", repo, "--plan", planFile, "--created", createdFile, "--application", "app-new", "--organization", "org-1")
    assert.equal(res.code, 0, res.err)

    const home = readFileSync(join(repo, "shopping-vtex-template-home", "eitri-app.conf.js"), "utf8")
    assert.match(home, /'slug': 'loja-exemplo-home'/)
    assert.match(home, /'id': 'ea-home'/)
    assert.match(home, /'public-key': 'pk-home'/)
    assert.match(home, /'applicationId': 'app-new'/)
    assert.match(home, /'organizationId': 'org-1'/)
    // The stale 0.1.9 pin follows the shared app to the version the repo pushes.
    assert.match(home, /'loja-exemplo-shared': \{\s*isEitriAppShared: true,\s*version: '0\.1\.10'/)

    const shared = readFileSync(join(repo, "shopping-vtex-template-shared", "eitri-app.conf.js"), "utf8")
    assert.match(shared, /'id': 'ea-shared'/)
    assert.equal(
        readFileSync(join(repo, "shopping-vtex-template-home", "src", "views", "Home.jsx"), "utf8"),
        `import { Header } from 'loja-exemplo-shared'\nexport default function Home() { return Header }\n`,
    )
    const appConfig = readFileSync(join(repo, "app-config.yaml"), "utf8")
    assert.match(appConfig, /slug: "loja-exemplo-home"/)
    assert.match(appConfig, /\napplication-id: app-new$/)
    assert.match(readFileSync(join(repo, "dynamic-bottom-tab-view-spec.json"), "utf8"), /"slug": "loja-exemplo-home"/)
    assert.deepEqual(JSON.parse(res.out).slugAliases, { "loja-exemplo-home": ["home"] })
})

test("apply changes nothing when a planned mini-app was not created", () => {
    const repo = templateRepo()
    const planFile = join(repo, "plan.json")
    writeFileSync(planFile, run("plan", "--repo", repo, "--prefix", "loja-exemplo").out)
    const createdFile = join(repo, "created.json")
    writeFileSync(createdFile, JSON.stringify({ created: [{ id: "ea-home", slug: "loja-exemplo-home", publicKey: "pk-home" }] }))
    const before = readFileSync(join(repo, "shopping-vtex-template-home", "eitri-app.conf.js"), "utf8")
    const res = run("apply", "--repo", repo, "--plan", planFile, "--created", createdFile, "--application", "app-new", "--organization", "org-1")
    assert.notEqual(res.code, 0)
    assert.match(res.err, /loja-exemplo-shared/)
    assert.equal(readFileSync(join(repo, "shopping-vtex-template-home", "eitri-app.conf.js"), "utf8"), before)
})

test("apply reports the changed files relative to the repo, also when --repo is .", () => {
    const repo = templateRepo()
    writeFileSync(join(repo, "plan.json"), run("plan", "--repo", repo, "--prefix", "loja-exemplo").out)
    writeFileSync(
        join(repo, "created.json"),
        JSON.stringify({
            created: [
                { id: "ea-shared", slug: "loja-exemplo-shared", publicKey: "pk-shared" },
                { id: "ea-home", slug: "loja-exemplo-home", publicKey: "pk-home" },
            ],
        }),
    )
    const res = runIn(repo, "apply", "--repo", ".", "--plan", "plan.json", "--created", "created.json", "--application", "app-new", "--organization", "org-1")
    assert.equal(res.code, 0, res.err)
    assert.deepEqual(JSON.parse(res.out).filesChanged.sort(), [
        "app-config.yaml",
        "dynamic-bottom-tab-view-spec.json",
        "shopping-vtex-template-home/eitri-app.conf.js",
        "shopping-vtex-template-home/src/views/Home.jsx",
        "shopping-vtex-template-shared/eitri-app.conf.js",
    ])
})
