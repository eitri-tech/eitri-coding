# EITRI_APP.md template

Write this at the repo root at the end of a run, filled from `.eitri/create-app.state.json`. Keep it factual: ids,
links, what is real and what is placeholder.

```markdown
# <Store name> — Eitri app

Created by the create-app flow on <YYYY-MM-DD> from <store URL> (<platform>, <account or shop domain>).

## Console

| | |
|---|---|
| Organization | <name> (`<organizationId>`) |
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

## Placeholders and next steps

- [ ] CMS pages for the home (the sections show the captured content as defaults until then)
- [ ] <Shopify: Storefront token / Customer Account client id / callback URL> <if still empty>
- [ ] reCAPTCHA site key for checkout (`appConfigs.checkout.recaptchaKey`) <VTEX>
- [ ] Deep links: license the deeplink-resolver add-on
- [ ] Publish to prod when the store approves: `publish_revision` with `allowProduction`
- [ ] Native app build (out of scope here)

## Local development

`eitri app start` from the repo root runs every mini-app with the bottom-bar simulation
(`app-config.yaml`, `dynamic-bottom-tab-view-spec.json`). Push a mini-app with
`eitri push-version -m "<message>" -y` (`--shared` for shared ones) after bumping its `version`.
```
