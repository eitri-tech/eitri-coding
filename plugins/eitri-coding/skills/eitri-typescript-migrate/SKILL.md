---
name: eitri-typescript-migrate
description: How to migrate a pre-existing Eitri-App workspace — a single app or a multi-app bundle (e.g. an Eitri Shopping storefront: home/pdp/cart/checkout/account plus a shared library) — from JavaScript to TypeScript, file by file, following Eitri-specific typing conventions (Luminus/Bifrost prop shapes, VTEX/Wake/Shopify payload types, file-based routing props). ALWAYS invoke this skill whenever the user asks to migrate, convert, or port an Eitri-App workspace from JS to TS; whenever a workspace has `.js`/`.jsx` source with no `tsconfig.json`; or whenever the user wants to add TypeScript to an existing Eitri project. Also invoke when interpreting a `tsc --noEmit` result in an Eitri workspace that consumes a published shared Eitri-App library, or when reviewing a TypeScript-migration PR for an Eitri workspace.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, WebFetch, Agent
---

# SKILL.md — Eitri TypeScript Migration

Companion to `eitri-specialist` (the Runtime Safety rules that Step 7 extends, not duplicates — every type fix here is, underneath, a runtime-safety fix) and `eitri-shopping` (when the workspace being migrated is a commerce bundle, the SDK call sites you touch gain types too). This skill covers one workflow: **converting a pre-existing Eitri-App workspace from JavaScript to TypeScript**, file by file.

It applies to any Eitri workspace — a single Eitri-App or a multi-app bundle (an Eitri Shopping storefront — `home`/`pdp`/`cart`/`checkout`/`account` plus a client `shared` library — is the most common shape, but not a requirement).

> **Typing honestly reveals runtime bugs that JavaScript was hiding.** Every time `tsc` flags a field as "required here, but you treated it as optional there," treat that as a bug lead, not type noise to silence with `as any`. Steps 6–7 exist because this happened repeatedly in a real migration and is the main payoff of doing this work carefully.

---

## Step 1 — Inventory the scope

Find out whether you're converting a single Eitri-App (`eitri-app.conf.js` at the root) or a multi-app bundle (`app-config.yaml` listing several apps, one of them typically `shared`). Enumerate every `.js`/`.jsx` file under each app's `src/`.

```bash
find <workspace-root> -name '*.js' -o -name '*.jsx' | grep -v node_modules
```

Identify up front the files that should **stay JavaScript on purpose**:

- **Service Workers** (`src/workers/*.js`) — converting collides `lib.dom` vs `lib.webworker` global typing (`self`, `caches`, `FetchEvent`) in the shared tsconfig. Typing one properly needs an isolated tsconfig, which is out of scope for a normal migration.
- **Vendored / minified third-party files** — a vendored React binding for a slider library, a minified vendor bundle, anything not authored by this project. Leave as `.js`, optionally add a `.d.ts` alongside it (Step 5) if the app imports symbols from it.

## Step 2 — Set up the TypeScript toolchain

Eitri workspaces typically have **no `package.json` and no local `typescript` install** anywhere in the tree.

- **Generate `tsconfig.json`:** run `eitri start` (single app) or `eitri app start` (bundle) once — the Eitri CLI auto-generates a root `tsconfig.json`, mapping `@/*` → `./src/*` and resolving `eitri-luminus` / `eitri-bifrost` / `eitri-i18n` / shared libraries into `~/.eitri/<application-id>/node_modules`. **This file is auto-generated — never hand-edit it.** If module resolution breaks later, regenerate it by running the CLI again, don't patch it manually. Make sure `/tsconfig.json` is gitignored.
- **Type-check via `npx`, always pinned:**
  ```bash
  npx -y -p typescript@5 tsc --noEmit -p tsconfig.json
  ```
  Plain `npx tsc` fails with *"could not determine executable to run"* in these workspaces — `-p typescript@5` is mandatory, not a style choice.
- **Capture a baseline before converting anything.** Even with zero `.ts` files, `tsc` already runs against the `.d.ts` files the CLI downloaded for Eitri packages, and can report errors that live entirely inside `~/.eitri/<application-id>/@types/` — outside the repo, not fixable from application code. Record that count; it's the "zero" you compare against later, not literally zero.

## Step 3 — Conversion order

Convert by dependency, not alphabetically: if it's a bundle, the `shared`/library app first, then each consumer app. Within an app, in this order:

1. `types/` — doesn't exist yet, create it first (Step 4).
2. `utils/` / `services/` → become `.ts`.
3. `providers/` / `components/` / `views/` → become `.tsx` (they use JSX).

This order means that by the time you convert a component, the types it imports already exist. Rename with `git mv file.js file.ts` (preserves history) in small batches — one directory or one feature at a time — running the Step 2 type-check after every batch, never only at the end. An error is far easier to attribute to a small change than to a 300-file conversion done in one shot.

## Step 4 — Local domain types

Create `src/types/` per app (or in `shared`, if the bundle has one):

- **One file per backend integration** (`vtex.ts`, `wake.ts`, `shopify.ts` — whichever applies) with **partial** interfaces for the payloads you touch (product, cart/OrderForm, SKU, etc.), always with an index signature `[key: string]: unknown` — the real payload always has more fields than any local code consumes, and the index signature avoids forcing a complete typing nobody will maintain.
- **A `route.ts`** with the shape Eitri's file-based routing injects into every view:
  ```ts
  export interface RouteProps<TState = Record<string, any>> {
  	match?: { params?: Record<string, string> }
  	location?: { state?: TState; pathname?: string }
  	history?: { location?: { state?: TState } }
  }
  ```
  Used in practically every view — worth centralizing once.
- **Decide required vs. optional by looking at the real payload, not at "it would be nice if it always came."** This is the single most important decision in the whole file: declaring a field required when the backend can omit it pushes the bug to later (a crash or a silent `NaN` in production); declaring it optional forces whoever consumes it to decide now what happens when it's missing. Step 7 covers the bug patterns this decision prevents.

## Step 5 — Component and prop conventions

- `interface XProps { ...optional fields...; [key: string]: unknown }`, signature `export default function X(props: XProps)` — never an arrow function for the main export, never destructure in the signature (destructure in the body). (Inherited from `eitri-luminus`/`eitri-specialist` — cite those, don't duplicate the UI rules here.)
- Spread `...rest` onto the root element when the component accepts pass-through props.
- **Libraries with no adequate `.d.ts` get a shim next to the actual usage, not a generic `any` sprinkled around.** Write a `.d.ts` with only the symbols actually used — a subset of `react-icons` icons, a minimal declaration for a vendored third-party binding. Prefer this over scattering `@ts-ignore`.
- **Where an installed Eitri library's `.d.ts` (`eitri-luminus`, `eitri-bifrost`) is provably tighter than its real runtime behavior** (e.g. it only documents `CommonProps` but the component accepts several "shorthand" style props already used throughout the existing code), declare a permissive local override with a comment explaining it's a library typing gap, not an app error — never rewrite the component to avoid a real prop it already uses.

## Step 6 — The shared-library `@types` cache trap

> **Read this before trusting any `tsc` result on an app that consumes a shared library — including a clean one.**

Once a shared Eitri-App library has been **published** at least once, the Eitri CLI drops a generated stub into the consuming app's local cache: `~/.eitri/<application-id>/@types/<shared-app-name>/index.d.ts`. That stub is generated from whatever the library looked like when it was still JavaScript, and types every export as loosely as possible — for example, `declare module "components/X" { function X(props: any): JSX.Element }` for every single component.

TypeScript's module resolution **prefers that generated `.d.ts` over the real `tsconfig.json` `paths` mapping into `src/export.ts`.** So in any workspace where the shared library has already been published — even once, even long ago — `tsc` silently stops checking the app↔shared-library boundary. Everything crossing that boundary resolves to `any`, and prop-mismatch or shape-mismatch bugs at that boundary go undetected, with no error and no warning.

Practical consequence: if you're converting an app that consumes an already-published shared library, **a clean `tsc` at that boundary is not proof of anything** — it may just mean the boundary isn't being checked. Check for the cache before trusting a result:

```bash
ls ~/.eitri/*/@types/<shared-app-name>/ 2>/dev/null
```

If it exists, treat any "zero errors" there with suspicion, and remove or rename that cached directory (or otherwise force resolution to the real `paths` entry) before trusting the result as meaningful.

## Step 7 — The bug pattern honest typing reveals (checklist)

Every time `tsc` complains that a field "should be required here, but you typed it optional there," stop before simply widening the type — classify it:

- **Iteration over a possibly-missing array, inside a truthy check on the parent only.** `if (cart) { cart.items.reduce(...) }` checks `cart` but not `cart.items` — without the array, this crashes at runtime. Fix: `(cart.items ?? []).reduce(...)`, not just widening the type.
- **String method on an optional text field with no fallback.** `sla.shippingEstimate.indexOf('h')` crashes if the estimate is missing. Fix: `(field ?? '').indexOf(...)`.
- **Numeric accumulation on a possibly-missing numeric field.** `total += item.price` where `price` can be `undefined` doesn't crash — it silently produces `NaN`, which then renders as a visibly wrong number on screen (worse than a crash, because nobody notices until a user reports it). Fix: `?? 0`, but only where zero is genuinely the correct business value.
- **Type-accuracy fixes with no runtime behavior change:** an interface missing fields the consuming component actually reads (forcing `unknown[]`/`any` instead of a real type); a prop typed `string` when the component genuinely accepts JSX; a prop passed that the component never reads (confirm with a repo-wide grep before deleting, then delete it).
- **A native (Bifrost) API whose `.d.ts` declares a required parameter that the JSDoc/runtime treat as optional.** Before inventing a new cast, `grep` the repo for a defensive-cast pattern already used against the same API elsewhere — reuse it instead of writing a new one. Watch out: a naive `() => Api.method()` wrapper still fails type-check, because TypeScript forwards the arity of the *outer* function's declared type, not the call expression inside it.

Close every finding with `eitri-specialist`'s question: *what does the user see when this field is actually missing?* If the honest answer before your fix was "a crash" or "a wrong number that looks correct," you found a real bug — report it as one, not as a type tweak.

## Step 8 — Verify before calling it done

- **Final `tsc --noEmit` vs. the Step 2 baseline** — any error beyond the baseline is yours to fix, not pre-existing.
- **Enumerate and justify every remaining `.js`/`.jsx` file** — Step 1 already flagged the legitimate holdouts (Service Worker, vendor, minified).
- **Build every app in the bundle** (`eitri start` / `eitri app start`, or the equivalent production build) — compiling cleanly is not the same as type-checking cleanly.
- **Flag the device smoke test as still required, explicitly, before merge** — even with green build and type-check. Neither exercises the runtime branches gated on actual data shape, which is exactly where Step 7's bugs live. Hand off to `eitri-device` for the actual pass, especially for cart/checkout purchase-path screens.
- **If the workspace has no `AGENTS.md`/`CLAUDE.md` yet**, consider writing one summarizing the conventions adopted during the conversion (`.ts`/`.tsx` split, where domain types live, which files were deliberately left as JS and why) — not mandatory, but it saves the next session from rediscovering all of this from scratch.

---

## What not to assume

- **Don't assume widening the type (`?`) is enough.** The runtime guard the type made visible needs to be written too (Step 7).
- **Don't assume a clean `tsc` proves the app works.** The device smoke test is still required (Step 8) — neither build nor type-check exercises the data-shape-dependent branches where real bugs hide.
- **Don't assume an installed Eitri library's `.d.ts` is authoritative.** When it contradicts real behavior, read the installed package under `~/.eitri/<application-id>/node_modules/` (or its `.store/` equivalent) before rewriting code that already works.
- **Don't convert the whole tree before the first type-check.** Small batches (Step 3) make errors attributable; converting everything at once produces a wall of errors with no clear root cause.
- **Don't reach for `as any` / `@ts-ignore` as the default response to a type error.** It's always the last resort, after checking whether the type itself is wrong, whether a runtime guard is missing, or whether a `.d.ts` shim is needed (Step 5).
