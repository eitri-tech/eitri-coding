---
name: eitri-shopping
description: How to use Eitri Shopping's commerce integration libraries — the public SDKs in `eitri-tech/eitri-shopping-services-shared` that connect an Eitri-App to a commerce backend (VTEX, Wake, Shopify) for catalog, search, cart, checkout, payment, customer, orders and wishlist. ALWAYS invoke this skill when an Eitri-App consumes or should consume one of these libraries — `eitri-app-dependencies` lists `eitri-shopping-*-shared`, the code calls `Vtex.*` / `Wake.*` / `Shopify.*`, or the user wants to add e-commerce capability to an Eitri-App. Also invoke when the task is to identify which commerce platform a project runs on, find out what an SDK method does or whether one exists, debug a failing integration call, or decide on an SDK version bump.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, WebFetch, Agent
---

# SKILL.md — Eitri Shopping

Companion to `eitri-specialist` (how Eitri code is written) and `eitri-device` (how it is run). This skill covers the **commerce integration layer**: the SDKs that let an Eitri-App talk to a store backend, how to find what they offer, and how to use them correctly.

It applies to any Eitri-App that consumes one of these libraries — a single app adding a product listing, or one module of a large shopping bundle. Multi-app bundles (home / pdp / cart / checkout / account plus a client shared library) are the common shape, not a requirement.

Deliberately **not** covered: component names, folder layout, provider patterns, state conventions. Those are decided per project and per team; the repository's own `AGENTS.md` / `CLAUDE.md` is the authority, and where it contradicts this skill, it wins.

> **This file goes stale; the libraries do not stop moving.** `eitri-tech/eitri-shopping-services-shared` is a **public repo** — anything here about namespaces, method names, signatures or behavior is a snapshot, and the live source is one command away. Consult it whenever a detail matters, and always before telling the user a method does or does not exist. Step 2 has the how.

---

## Step 1 — Know which library you need

One published library per commerce platform, each an independently versioned Eitri shared app:

```
eitri-shopping-vtex-shared/          # VTEX — REST + Intelligent Search (+ some GraphQL)
eitri-shopping-wake-shared/          # Wake — GraphQL
eitri-shopping-shopify-shared/       # Shopify — Storefront GraphQL, TypeScript, typed models
eitri-shopping-vtex-sales-app/       # assisted / in-store selling on top of VTEX
eitri-shopping-addons-integrations/  # third-party add-ons
```

**On an existing project, identify the platform before writing any integration code.** It changes the whole vocabulary — method names, data shapes, whether search is REST or GraphQL, what "checkout" means.

```bash
# 1. the dependency pin — definitive
grep -rn "eitri-shopping-\(vtex\|wake\|shopify\)-shared" --include=eitri-app.conf.js .

# 2. what the code imports
grep -rn "from 'eitri-shopping-.*-shared'" --include=*.js --include=*.jsx --include=*.ts --include=*.tsx src | head

# 3. the facade in use
grep -rEn "\b(Vtex|Wake|Shopify)\." src | head
```

| Signal in the code | Platform |
| --- | --- |
| `Vtex.*`, `orderForm`, `sellers`, `commertialOffer`, Intelligent Search | **VTEX** |
| `Wake.*`, `checkoutId`, GraphQL throughout, partner/seller tokens | **Wake** |
| `Shopify.*`, Storefront GraphQL, `cartLines`, `buyerIdentity`, gid URIs | **Shopify** |

Two traps: a migrated store often keeps its **previous platform's implementation as dead code** — confirm with the repo doc before copying from it; and what matters is the **pinned version**, not the latest.

**On a new project**, declare the library as a shared Eitri-App dependency and configure it once at startup:

```js
// eitri-app.conf.js
'eitri-app-dependencies': {
  'eitri-shopping-vtex-shared': { isEitriAppShared: true, version: '<pick a version>' }
}
```

```js
import { App } from 'eitri-shopping-vtex-shared'

await App.tryAutoConfigure()   // idempotent; safe to call from the app's root view
```

Configuration comes from the **environment's remote config**, not from constants in your code: `providerInfo` carries the account/host, `storePreferences` the locale/currency/segment defaults, `appConfigs` the feature toggles. That is set per environment in the Eitri Console, which is why the same build behaves differently in dev and prod. `tryAutoConfigure(overwrites)` deep-merges an object over that config — the supported way to override locally. SDKs generally also configure lazily on first use, but doing it explicitly at startup avoids a race on the first screen.

## Step 2 — The source of truth is the code, and it is public

**There is no published API documentation for these SDKs.** The repository is public, so read it directly. Three ways, in order of preference:

1. **The installed copy** — exactly the version the app resolves:
   `~/.eitri/<eitri-app-name>/node_modules/.store/eitri-shopping-*-shared@<version>-*/node_modules/eitri-shopping-*-shared/`
2. **The repo** — `gh api repos/eitri-tech/eitri-shopping-services-shared/contents/<path>`, or a shallow clone. `main` is usually ahead of what any app runs, so pin your reading. Release tags look like `shared-1.16.4`, but the tag name is derived from the directory's last dash-separated word, so **all three `*-shared` libraries emit `shared-<version>` tags** and the prefix does not identify the library. More reliable: `git log --oneline -- <library-dir>/` and match the version bump in that directory's `eitri-app.conf.js`.
3. `WebFetch` on the GitHub blob URL for a quick single-file read.

None of this needs credentials or a checkout of the consuming project.

Never invent a method name. If it is not in the pinned source, it does not exist *for that app* — but check the repo before concluding it does not exist at all: it may have landed later, which turns the answer into a version bump rather than a workaround.

## Step 3 — The shape every library shares

All of them follow one skeleton, so learning to read one is learning to read the rest.

**`src/export.js` / `export.ts` is the public surface.** Nothing outside it is importable. Start every investigation there.

```js
import { Vtex, App } from 'eitri-shopping-vtex-shared'
```

**A single static facade class** — `Vtex`, `Wake`, `Shopify`, `Sales` — never instantiated, holding:

- `static configs` — account, host, api base, locale, sales channel, search options, segments. Filled at boot, read by every sub-service.
- `static configure(remoteConfig)` — wires the SDK to the store: reads `providerInfo` / `storePreferences`, establishes the session, subscribes to cross-app updates.
- `static tryAutoConfigure(overwrites)` — the entry point you actually call. Initializes remote config, calls `configure`, and is idempotent.
- **Domain namespaces as static properties** — the map you navigate (Step 4).

Alongside the facade, the libraries commonly export:

- `RemoteConfig` — wraps `Eitri.environment.getRemoteConfigs()`; `getContent('a.b.c')` does dotted lookups and returns `null` when absent. Feature toggles live here.
- `EventBus` — broadcasts across the Eitri-Apps of a bundle, so a login in one app reaches the cart in another.
- `Tracking` — fans analytics events out to whatever providers the store configured.
- Shopify additionally exports **TypeScript models and error classes** — import those types instead of redeclaring shapes.

## Step 4 — The namespace map

**A finding aid, not a reference.** Read off the monorepo at one point in time; methods get added, renamed and deprecated, and your app pins an older version anyway. Use it to know *which namespace to open*, then read the real file — and go to the repo when the answer must be current:

```bash
# the whole public surface of a library, from the source
gh api repos/eitri-tech/eitri-shopping-services-shared/contents/eitri-shopping-vtex-shared/src/export.js --jq '.content' | base64 -d

# or clone once and grep freely
git clone --depth 1 https://github.com/eitri-tech/eitri-shopping-services-shared
```

A method missing from this map means nothing — verify before concluding it is unavailable.

### VTEX — `Vtex.<namespace>`

| Namespace | Covers |
| --- | --- |
| `catalog` | product by id/slug/sku, `searchProduct`, facets, similar products, "who saw also saw", `showTogether`, category tree, suggestions, legacy search |
| `intelligentSearch` | `productSearch`, `facets`, `getProduct`, autocomplete, `correctionSearch`, `topSearches`, `banners`, `pickupPointAvailability` |
| `searchGraphql` | GraphQL flavour of search: `productSearch`, `facets`, `product`, `productRecommendations`, `autocomplete` |
| `cart` | `getCurrentOrCreateCart`, add/update/remove items, `clearCart`, `simulateCart`, `resolvePostalCode`, `listPickPoints`, marketing data, offerings, attachments, gifts |
| `checkout` | shipping address, `setLogisticInfo`, promo codes, user data, payment selection, `startTransaction`, `payV2` and the per-method pay calls (card, boleto, PIX, gift card, external), `getPixStatus` |
| `customer` | login (password, access key, Google, Facebook), logout, token/refresh, profile, orders, addresses, saved cards, region, UTM params, newsletter |
| `session` | create/get/update session, segments, session token |
| `wishlist`, `store`, `cms`, `stockAlert`, `googlePay` | favourites; login providers; CMS pages and content types; availability subscription; Google Pay availability and payment data |
| `http` | the raw caller (`get`/`post`/…) — escape hatch |

### Wake — `Wake.<namespace>`

| Namespace | Covers |
| --- | --- |
| `product` | `findAll`, by category, by term, by id, `search`, recommendations, images, restock alert |
| `category` | `findAll`, `categories` |
| `cart` | `getCurrentOrCreateCart`, `getCheckout`, add/remove items, `clearCart`, `forceCartId` |
| `checkout` | associate customer/address, shipping quotes and selection, payment methods, installments, coupons, `checkoutComplete` (single and multi-payment), reset/clone, partner association |
| `customer` | login (authenticated and simple/OTP), create/update, password recovery, profile, orders, wishlist, addresses, ZIP lookup, checking account |
| `store` | shop data, partner/seller resolution by ZIP or region, partner access tokens |
| `graphQl` | raw GraphQL client |

### Shopify — `Shopify.<namespace>`

| Namespace | Covers |
| --- | --- |
| `catalog` | `search`, `collection`, `predictiveSearch`, `productRecommendations`, `product` |
| `cart` | create/get, add/update/remove lines, buyer identity, delivery address, delivery options with carrier rates, gift cards, discount codes, attributes |
| `customer` | profile, orders, update, address CRUD, default address, auth state (login/refresh/logout in the auth service) |
| `address`, `http` | ZIP lookup; raw caller |

## Step 5 — Read a method before calling it

Signatures are positional and largely untyped outside Shopify. Opening the file takes seconds and prevents an entire class of bugs. Look for three things:

1. **What it takes.** `(term, options = {})` is the common shape, where `options` is merged over defaults pulled from `configs` (sales channel, locale, search options) and flattened into the request.
2. **What it returns.** This is where assumptions break. Methods often unwrap the response themselves and return heterogeneous values: the payload, an inner `data`, `[]` for an empty result, `undefined` when the response was falsy. "No results" and "the call failed" can arrive as different values, and your UI must treat them differently.
3. **What it throws.** Many wrap in try/catch and log rather than throw, so a failure surfaces as a falsy return, not a rejected promise. `await` inside `try/catch` is not enough — check the returned value too.

This is where the *Runtime Safety* rules from `eitri-specialist` bite hardest: commerce payloads are deeply nested, optional at every level, and a field populated for one seller is `null` for another.

**Authentication and session are the caller's job, not yours.** The SDK's HTTP layer assembles auth cookies, session and segment tokens on each request. Passing your own `headers.Cookie` into a call can overwrite that and silently strip authentication — a failure that looks like "logged in, but this one operation is denied". When a call fails only after login, inspect the outgoing headers before suspecting your own logic.

Reach for the raw `http` / `graphQl` namespace only for endpoints the SDK does not cover, and keep it in your app's service layer.

## Step 6 — Building and fixing

**Where code goes.** View → your app's own service module → the SDK. Views should not call the commerce backend directly; your service layer is where you normalize shapes, map errors and decide fallbacks. This is the one structural convention worth holding everywhere, because it is what makes an SDK version bump survivable.

**Is the bug mine or the SDK's?** Read the pinned version's source first. These libraries have shipped real integration defects — auth-scheme changes, headers assembled wrongly for one operation — that no app-side change can fix. `git log` on the file usually settles it, and the fix is a version bump, not a workaround.

**Bumping is a deliberate change.** Update the pin in `eitri-app-dependencies`, bump your own app's `version` too, and read the diff between the two SDK versions: releases mix unrelated work (payment changes, config sources moving, a search engine swap), each with its own risk. Move to the version that fixes your problem, not to the newest.

**Contributing to an SDK.** Add the method to the right domain sub-service, expose it through the facade namespace if it is a new area, and respect the release order — shared libraries publish first (`--shared`), then consumers update the pin and bump. The monorepo publishes a subdirectory only when its `version` changed.

## What not to assume

- **Project conventions are local.** Component names, provider names, whether a client shared library exists and what it is called — read the repo instead of pattern-matching from another one.
- **Not everything goes through the SDK.** Projects legitimately call endpoints directly with `Eitri.http` where the library has no coverage. Check the local service layer before assuming a facade method is in use.
- **Coverage differs by platform.** A namespace that exists for one backend may simply not exist for another, where the same job is done through the raw GraphQL client. Never port a method name across platforms.
- **The remote config drives behavior.** Toggles, sales channel, store preferences and search options come from the environment, so identical code behaves differently per environment. Check the config before concluding the code is wrong.
