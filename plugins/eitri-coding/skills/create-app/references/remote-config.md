# Remote config per platform

`scripts/remote-config.mjs` builds the config from the template's own `remoteConfig.json` (the full shape each
template reads, documented in the template's `docs/remote-config.md`). The template's values are a sample store's:
every store-specific one is replaced or cleared, never carried over.

## What the script sets

| Field | VTEX | Wake | Shopify |
|---|---|---|---|
| `providerInfo.account` | detected VTEX account | detected Wake account | — |
| `providerInfo.host` | store origin | store origin | store origin |
| `providerInfo.faststore` | = account (see CMS) | — | — |
| `providerInfo.vtexCmsUrl` | kept (Eitri's partner VTEX account) | — | — |
| `providerInfo.eitriContentCmsUrl` / `cmsUrl` | — | cleared (see CMS) | cleared (see CMS) |
| `providerInfo.tcs_account` | — | from secrets, else empty + warning | — |
| `providerInfo.partnerByRegion` | — | `false` (the sample store's regional sellers) | — |
| `providerInfo.storefrontAccessToken`, `clientId`, `callbackUrl` | — | — | from secrets, else **needs** |
| `storePreferences.locale`, `currencyCode` | detected, default `pt-BR` / `BRL` | detected over the template's BR defaults | — |
| `appConfigs.headerLogo` | `--set appConfigs.headerLogo=<url>` (else empty + warning) | same | same |
| `appConfigs.headerName` | — | store name | — |
| `appConfigs.checkout.recaptchaKey` | the `xxxx…` placeholder is removed (checkout runs without reCAPTCHA) | — | — |
| `eitriConfig.mainApp`, `dynamicBottomBar.eitriApps[].slug` | the new real slugs | same | same |

`deeplinkResolver.slug` (`deeplink-resolver`) is a separate add-on mini-app the template does not include: deep links
do not resolve until it is licensed to the app. The script keeps the field and warns.

## Credentials only the user has

Ask once, in Phase 1, and keep them in `.eitri/secrets.json` (gitignored):

| Platform | Key in secrets.json | Where the store finds it |
|---|---|---|
| Shopify | `storefrontAccessToken` | Shopify Admin → Apps → develop apps → Storefront API access token |
| Shopify | `clientId` | Shopify Admin → Customer Account API → client id (headless/mobile client) |
| Shopify | `callbackUrl` | The redirect URI / deep link registered for that Customer Account API client |
| Wake | `tcsAccount` | The store's Wake integration (TCS) account; optional for the template itself |

Every config write runs the MCP's secret-leak scan; these values are expected in `providerInfo` — anything else it
flags is a real problem.

## CMS: where the home content comes from

All three CMSs are hosted by Eitri, not by the store:

- **VTEX**: pages live in Eitri's partner VTEX account (`providerInfo.vtexCmsUrl`, e.g. `https://eitripartnerbr.myvtex.com/`),
  under the store id `providerInfo.faststore` (set to the account). The VTEX template reads them with
  `Vtex.cms.getPagesByContentTypes`. Section schema rules: `site-clone/references/targets/eitri-vtex.md`.
- **Wake**: Eitri Content API at `providerInfo.eitriContentCmsUrl` (no query string — the template appends
  `?where[type][equals]=<page type>`). Code: `home/src/services/CmsService.js` + `ComponentService.js`.
- **Shopify**: Eitri Content API at `providerInfo.cmsUrl`, answering `data.docs[]` with `type` (`home` / `category`) and
  `sections`. Code: `home/src/services/cmsService.ts` + `src/utils/getMappedComponent.ts`.

Creating those pages is not automated yet, so a new app starts with an empty CMS. That is why Phase 4 puts the
captured copy and images in the section components' **defaults**: the home looks like the store until real CMS
pages exist. Tell the user who sets up the CMS at Eitri for a real launch.
