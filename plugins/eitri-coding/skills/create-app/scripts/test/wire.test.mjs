import { test } from "node:test"
import assert from "node:assert/strict"
import { parseAppConfig, rewriteApplicationId, rewriteConf, rewriteImports, rewriteSlugRefs } from "../lib/wire.mjs"

const APP_CONFIG = `eitri-apps:
    - path: ./shopping-vtex-template-shared
      workspace: shared
      alias: shared
      focus: false
      shared: true
    - path: ./shopping-vtex-template-home
      workspace: home
      alias: home
      focus: true
      shared: false
bottom-tab-view-simulation:
  eitri-apps:
    - slug: "shopping-vtex-template-home"
      title: "Inicio"
`

test("parseAppConfig lists the mini-apps with their alias and whether they are shared", () => {
    assert.deepEqual(parseAppConfig(APP_CONFIG), [
        { path: "./shopping-vtex-template-shared", workspace: "shared", alias: "shared", shared: true },
        { path: "./shopping-vtex-template-home", workspace: "home", alias: "home", shared: false },
    ])
})

// The VTEX template's checkout conf, as published (note the stale shared pin 0.1.9).
const CHECKOUT_CONF = `module.exports = {
	'name': 'shopping-vtex-template-checkout',
	'title': 'shopping-vtex-template-checkout',
	'slug': 'shopping-vtex-template-checkout',
	'eitri-luminus': '2.3.6',
	'eitri-bifrost': '3.10.0',
	'eitri-commons': '2.1.2',
	'version': '0.2.0',
	'versionMessage': 'ajuste checkout',
	'public-key': 'a161f79d-dee9-4e67-932f-6f8b5c7828ce',
	'applicationId': '9022c0fb-885f-4a5f-b99f-7e065189b893',
	'id': '0ce609ca-17c0-4183-9138-0a011d4bb6ee',
	'organizationId': 'cf5660ee-bf90-42cd-9a43-9d2c69ee3c89',
	'organization': {},
	'eitri-app-dependencies': {
		'shopping-vtex-template-shared': {
			isEitriAppShared: true,
			version: '0.1.9'
		},
		'eitri-shopping-vtex-shared': {
			isEitriAppShared: true,
			version: '1.18.0'
		}
	},
	'type': 'module'
}
`

const IDENTITY = {
    slug: "loja-exemplo-checkout",
    title: "Checkout",
    id: "ea-checkout",
    publicKey: "pk-checkout",
    applicationId: "app-new",
    organizationId: "org-1",
    versionMessage: "create-app: first version",
}

test("rewriteConf points a conf at its new mini-app and the renamed shared app at its real version", () => {
    const out = rewriteConf(CHECKOUT_CONF, IDENTITY, {
        renames: { "shopping-vtex-template-shared": "loja-exemplo-shared" },
        versions: { "loja-exemplo-shared": "0.1.10" },
    })
    assert.equal(
        out,
        `module.exports = {
	'name': 'loja-exemplo-checkout',
	'title': 'Checkout',
	'slug': 'loja-exemplo-checkout',
	'eitri-luminus': '2.3.6',
	'eitri-bifrost': '3.10.0',
	'eitri-commons': '2.1.2',
	'version': '0.2.0',
	'versionMessage': 'create-app: first version',
	'public-key': 'pk-checkout',
	'applicationId': 'app-new',
	'id': 'ea-checkout',
	'organizationId': 'org-1',
	'organization': {},
	'eitri-app-dependencies': {
		'loja-exemplo-shared': {
			isEitriAppShared: true,
			version: '0.1.10'
		},
		'eitri-shopping-vtex-shared': {
			isEitriAppShared: true,
			version: '1.18.0'
		}
	},
	'type': 'module'
}
`,
    )
})

test("rewriteConf handles unquoted keys and double quotes, and adds a missing versionMessage", () => {
    const conf = `module.exports = {
  name: "eitri-play",
  title: "eitri-play",
  slug: "eitri-play",
  version: "2.16.2",
  "public-key": "cf6d",
  applicationId: "289a",
  id: "052a",
  organizationId: "aad0",
};
`
    assert.equal(
        rewriteConf(conf, { ...IDENTITY, slug: "loja-play", title: "Play" }, { renames: {}, versions: {} }),
        `module.exports = {
  name: "loja-play",
  title: "Play",
  slug: "loja-play",
  version: "2.16.2",
  versionMessage: "create-app: first version",
  "public-key": "pk-checkout",
  applicationId: "app-new",
  id: "ea-checkout",
  organizationId: "org-1",
};
`,
    )
})

test("rewriteImports renames module specifiers only, subpaths included", () => {
    const source = `import { Header } from 'shopping-vtex-template-shared'
import Badge from "shopping-vtex-template-shared/components/Badge"
const lazy = () => import('shopping-vtex-template-shared')
import other from 'shopping-vtex-template-shared-extra'
const label = 'shopping-vtex-template-shared'
`
    assert.equal(
        rewriteImports(source, { "shopping-vtex-template-shared": "loja-exemplo-shared" }),
        `import { Header } from 'loja-exemplo-shared'
import Badge from "loja-exemplo-shared/components/Badge"
const lazy = () => import('loja-exemplo-shared')
import other from 'shopping-vtex-template-shared-extra'
const label = 'shopping-vtex-template-shared'
`,
    )
})

test("rewriteSlugRefs renames exact slug values in app-config.yaml and the bottom bar spec, not paths", () => {
    const renames = { "shopping-vtex-template-home": "loja-exemplo-home" }
    assert.equal(
        rewriteSlugRefs(APP_CONFIG, renames),
        APP_CONFIG.replace('slug: "shopping-vtex-template-home"', 'slug: "loja-exemplo-home"'),
    )
    assert.equal(
        rewriteSlugRefs(`{ "eitriApps": [ { "slug": "shopping-vtex-template-home", "title": "Inicio" } ] }`, renames),
        `{ "eitriApps": [ { "slug": "loja-exemplo-home", "title": "Inicio" } ] }`,
    )
})

test("rewriteApplicationId points app-config.yaml at the new application, keeping the rest byte for byte", () => {
    // The template ships its own application's id, without a trailing newline.
    const yaml = `eitri-apps:\n    - path: ./home\n\napplication-id: 9022c0fb-885f-4a5f-b99f-7e065189b893`
    assert.equal(rewriteApplicationId(yaml, "app-new"), `eitri-apps:\n    - path: ./home\n\napplication-id: app-new`)
    assert.equal(rewriteApplicationId(`application-id: "tpl"\r\nother: 1\r\n`, "app-new"), `application-id: "app-new"\r\nother: 1\r\n`)
    // No line yet: add one, so `eitri app start` runs against the new application.
    assert.equal(rewriteApplicationId("eitri-apps:\n", "app-new"), "eitri-apps:\napplication-id: app-new\n")
})
