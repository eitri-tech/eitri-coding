import { test } from "node:test"
import assert from "node:assert/strict"
import { parseAppConfig, rewriteApplicationId, rewriteImports, rewriteSlugRefs } from "../lib/wire.mjs"

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
