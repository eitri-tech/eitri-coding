# EITRI_APP.md template

Write this at the repo root at the end of a run, filled from `.eitri/create-app.state.json`. Keep it factual: ids,
links, what is real and what is placeholder.

```markdown
# <Store name> — Eitri app

Created by the create-app flow on <YYYY-MM-DD> from <store URL> (<platform>, <account or shop domain>).

## Console

| | |
|---|---|
| Organization | <name> (`<organizationId>`) — icon: <same as the app / its own from <source> / kept (it had one)> |
| Application | <name> (`<applicationId>`) — https://console.eitri.tech/applications/<applicationId> |
| Environments | dev `<envId>` (appKey `<appKey>`), prod `<envId>` (appKey `<appKey>`) |
| Template | <template name> — <gitUrl> |
| Theme | Luminus v2 "Brand" (build <n>), global CSS build <n> |

## Mini-apps

| Folder | Slug | Alias | Id | Published on dev |
|---|---|---|---|---|
| ./shopping-…-home | <app>-home | home | `<id>` | <version> |
| … | | | | |

## Preview

Eitri Play → log in → <organization> → <application> → dev.

Snapshot <if one was made>: `<protocol>-dev://app-snapshot/snapshot-[<branch>]-<n>-<uuid>` (also in Console →
Snapshots). It opens only in the application's native dev build, not in Eitri Play. Make a new one with
`eitri app snapshot -v` from the repo root.

## Screens

| Screen | Store page | Status | Still different |
|---|---|---|---|
| listing | <pages.listing> | matches / partial | <what differs and why> |
| pdp | <pages.product> | … | … |
| home / login / cart | … | … | … |

Compare images: `preview/<screen>/compare/*.png` (store | app).

## Bottom bar

| | Store | App |
|---|---|---|
| Shape | <floating pill / glued to the bottom, labels or not> | <theme, labelVisibility, indicator> |
| Tabs | <store labels, in order> | <app titles → mini-app/route> |
| Icons | `.eitri/bottom-bar/icons/*.png` (the store's, as PNG) | <hosted URLs, or the Material stand-ins in use> |

Compare: `.eitri/bottom-bar/store-bar.png`. Still different: <each `bar.json` warning and gap, one line each>.

## Integrations (from `.eitri/store-features.json`)

| Service | In the app |
|---|---|
| <name> | rebuilt (<files>, config <path>) / not rebuilt: <why> / opt-in, not set / needs the native build / not in the app: <what it would take> |

## Gaps — what the store has and the app does not

- [ ] <area>: <item> — <detail>   (one line per `gaps` entry, plus any the rebuild found)

## Placeholders and next steps

- [ ] CMS pages for the home (the sections show the captured content as defaults until then)
- [ ] <Shopify: Storefront token / Customer Account client id / callback URL> <if still empty>
- [ ] reCAPTCHA site key for checkout (`appConfigs.checkout.recaptchaKey`) <VTEX>
- [ ] Deep links: license the deeplink-resolver add-on
- [ ] Bottom bar icons <if Material stand-ins are in use>: host `.eitri/bottom-bar/icons/*.png` (e.g. `https://media-eitri-content.eitri.tech/<app-name>/`), then `bottom-bar.mjs apply --icon …` + `sync`, and write the config to dev/prod
- [ ] Publish to prod when the store approves: `publish_revision` with `allowProduction`
- [ ] Native app build (out of scope here)

## Local development

`eitri app start` from the repo root runs every mini-app with the bottom-bar simulation
(`app-config.yaml`, `dynamic-bottom-tab-view-spec.json`), which replaces the environment's bar in that session
and in snapshots: after changing `eitriConfig.dynamicBottomBar`, run `bottom-bar.mjs sync` (create-app skill). Push a mini-app with
`eitri push-version -m "<message>" -y` (`--shared` for shared ones) after bumping its `version`.
```
