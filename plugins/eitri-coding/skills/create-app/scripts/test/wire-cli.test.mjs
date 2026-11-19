import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
    writeFileSync(join(repo, "remoteConfig.json"), `{ "eitriConfig": { "mainApp": "shopping-vtex-template-home" } }`)
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

const SHARED = "eitri-shopping-loja-exemplo-shared"
const HOME = "eitri-shopping-loja-exemplo-home"

test("plan names every mini-app eitri-shopping-<project>-<alias>: slug, folder and workspace", () => {
    const repo = templateRepo()
    const res = run("plan", "--repo", repo, "--project", "loja-exemplo")
    assert.equal(res.code, 0, res.err)
    const plan = JSON.parse(res.out)
    assert.deepEqual(plan.createEitriApps, {
        apps: [
            { slug: SHARED, title: SHARED },
            { slug: HOME, title: HOME },
        ],
    })
    assert.deepEqual(plan.slugAliases, { [HOME]: ["home"] })
    assert.deepEqual(
        plan.apps.map((a) => [a.templateSlug, a.slug, a.path, a.workspace, a.templatePath, a.version, a.shared]),
        [
            ["shopping-vtex-template-shared", SHARED, `./${SHARED}`, SHARED, "./shopping-vtex-template-shared", "0.1.10", true],
            ["shopping-vtex-template-home", HOME, `./${HOME}`, HOME, "./shopping-vtex-template-home", "0.1.28", false],
        ],
    )
    // An already prefixed project name is not prefixed twice; the old --prefix is refused, not misread.
    assert.equal(JSON.parse(run("plan", "--repo", repo, "--project", "eitri-shopping-loja-exemplo").out).apps[1].slug, HOME)
    assert.match(run("plan", "--repo", repo, "--prefix", "loja-exemplo").err, /--project/)
})

function created(repo, ids = { shared: "ea-shared", home: "ea-home" }) {
    const file = join(repo, "created.json")
    writeFileSync(
        file,
        JSON.stringify({
            created: [
                { id: ids.shared, slug: SHARED, title: SHARED, publicKey: "pk-shared" },
                { id: ids.home, slug: HOME, title: HOME, publicKey: "pk-home" },
            ],
        }),
    )
    return file
}

test("apply wires every file to the created mini-apps and moves each into its own folder", () => {
    const repo = templateRepo()
    const planFile = join(repo, "plan.json")
    writeFileSync(planFile, run("plan", "--repo", repo, "--project", "loja-exemplo").out)
    const res = run("apply", "--repo", repo, "--plan", planFile, "--created", created(repo), "--application", "app-new", "--organization", "org-1")
    assert.equal(res.code, 0, res.err)
    assert.deepEqual(JSON.parse(res.out).foldersMoved, [
        { from: "./shopping-vtex-template-shared", to: `./${SHARED}` },
        { from: "./shopping-vtex-template-home", to: `./${HOME}` },
    ])
    assert.equal(existsSync(join(repo, "shopping-vtex-template-home")), false)

    const home = readFileSync(join(repo, HOME, "eitri-app.conf.js"), "utf8")
    assert.match(home, new RegExp(`'name': '${HOME}'`))
    assert.match(home, new RegExp(`'slug': '${HOME}'`))
    assert.match(home, /'id': 'ea-home'/)
    assert.match(home, /'public-key': 'pk-home'/)
    assert.match(home, /'applicationId': 'app-new'/)
    assert.match(home, /'organizationId': 'org-1'/)
    // The stale 0.1.9 pin follows the shared app to the version the repo pushes.
    assert.match(home, new RegExp(`'${SHARED}': \\{\\s*isEitriAppShared: true,\\s*version: '0\\.1\\.10'`))

    assert.match(readFileSync(join(repo, SHARED, "eitri-app.conf.js"), "utf8"), /'id': 'ea-shared'/)
    assert.equal(
        readFileSync(join(repo, HOME, "src", "views", "Home.jsx"), "utf8"),
        `import { Header } from '${SHARED}'\nexport default function Home() { return Header }\n`,
    )
    const appConfig = readFileSync(join(repo, "app-config.yaml"), "utf8")
    assert.match(appConfig, new RegExp(`- path: \\./${HOME}\\n\\s+workspace: ${HOME}\\n\\s+alias: home`))
    assert.match(appConfig, new RegExp(`- path: \\./${SHARED}\\n\\s+workspace: ${SHARED}\\n\\s+alias: shared`))
    assert.match(appConfig, new RegExp(`slug: "${HOME}"`))
    assert.match(appConfig, /\napplication-id: app-new$/)
    assert.match(readFileSync(join(repo, "dynamic-bottom-tab-view-spec.json"), "utf8"), new RegExp(`"slug": "${HOME}"`))
    assert.match(readFileSync(join(repo, "remoteConfig.json"), "utf8"), new RegExp(`"mainApp": "${HOME}"`))
    assert.deepEqual(JSON.parse(res.out).slugAliases, { [HOME]: ["home"] })
})

test("apply moves a repo wired with the old <project>-<alias> slugs to the convention, and reruns cleanly", () => {
    const repo = templateRepo()
    // Wire it the old way first: slugs loja-exemplo-*, folders still the template's.
    const files = [
        join(repo, "shopping-vtex-template-home", "eitri-app.conf.js"),
        join(repo, "shopping-vtex-template-shared", "eitri-app.conf.js"),
        join(repo, "shopping-vtex-template-home", "src", "views", "Home.jsx"),
        join(repo, "app-config.yaml"),
    ]
    for (const file of files) {
        const text = readFileSync(file, "utf8")
        writeFileSync(file, text.replace(/(['"])shopping-vtex-template-(home|shared)\1/g, "$1loja-exemplo-$2$1"))
    }
    const planFile = join(repo, "plan.json")
    writeFileSync(planFile, run("plan", "--repo", repo, "--project", "loja-exemplo").out)
    assert.deepEqual(JSON.parse(readFileSync(planFile, "utf8")).apps.map((a) => a.templateSlug), ["loja-exemplo-shared", "loja-exemplo-home"])
    const args = ["apply", "--repo", repo, "--plan", planFile, "--created", created(repo, { shared: "new-shared", home: "new-home" }), "--application", "app", "--organization", "org"]
    const res = run(...args)
    assert.equal(res.code, 0, res.err)
    assert.match(readFileSync(join(repo, HOME, "src", "views", "Home.jsx"), "utf8"), new RegExp(`from '${SHARED}'`))
    const home = readFileSync(join(repo, HOME, "eitri-app.conf.js"), "utf8")
    assert.match(home, new RegExp(`'${SHARED}': \\{`))
    assert.match(home, /'id': 'new-home'/)
    assert.match(readFileSync(join(repo, "app-config.yaml"), "utf8"), new RegExp(`slug: "${HOME}"`))
    // Rerun: everything is already in place.
    const again = run(...args)
    assert.equal(again.code, 0, again.err)
    assert.deepEqual(JSON.parse(again.out).foldersMoved, [])
})

test("apply refuses to move a mini-app onto an existing folder, and changes nothing", () => {
    const repo = templateRepo()
    const planFile = join(repo, "plan.json")
    writeFileSync(planFile, run("plan", "--repo", repo, "--project", "loja-exemplo").out)
    mkdirSync(join(repo, HOME))
    const before = readFileSync(join(repo, "app-config.yaml"), "utf8")
    const res = run("apply", "--repo", repo, "--plan", planFile, "--created", created(repo), "--application", "app", "--organization", "org")
    assert.notEqual(res.code, 0)
    assert.match(res.err, /already exists/)
    assert.equal(readFileSync(join(repo, "app-config.yaml"), "utf8"), before)
    assert.equal(existsSync(join(repo, "shopping-vtex-template-shared")), true)
})

test("apply accepts a recovered response with both newly created and reused mini-apps", () => {
    const repo = templateRepo()
    const planFile = join(repo, "plan.json")
    writeFileSync(planFile, run("plan", "--repo", repo, "--project", "loja").out)
    const createdFile = join(repo, "created.json")
    writeFileSync(createdFile, JSON.stringify({
        created: [{ id: "home", slug: "eitri-shopping-loja-home", publicKey: "pk-home" }],
        reused: [{ id: "shared", slug: "eitri-shopping-loja-shared", publicKey: "pk-shared" }],
        appGroupId: "group",
    }))
    const result = run("apply", "--repo", repo, "--plan", planFile, "--created", createdFile, "--application", "app", "--organization", "org")
    assert.equal(result.code, 0, result.err)
    assert.match(readFileSync(join(repo, "eitri-shopping-loja-shared", "eitri-app.conf.js"), "utf8"), /'id': 'shared'/)
})

test("apply refuses complete mini-app identities when their app group still failed", () => {
    const repo = templateRepo()
    const planFile = join(repo, "plan.json")
    writeFileSync(planFile, run("plan", "--repo", repo, "--project", "loja").out)
    const createdFile = join(repo, "created.json")
    writeFileSync(createdFile, JSON.stringify({ created: [
        { id: "home", slug: "eitri-shopping-loja-home", publicKey: "pk-home" }, { id: "shared", slug: "eitri-shopping-loja-shared", publicKey: "pk-shared" },
    ], appGroupError: "group failed" }))
    const before = readFileSync(join(repo, "app-config.yaml"), "utf8")
    const result = run("apply", "--repo", repo, "--plan", planFile, "--created", createdFile, "--application", "app", "--organization", "org")
    assert.notEqual(result.code, 0)
    assert.match(result.err, /reconcile/)
    assert.equal(readFileSync(join(repo, "app-config.yaml"), "utf8"), before)
})
