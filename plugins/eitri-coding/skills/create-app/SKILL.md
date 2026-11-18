---
name: create-app
description: Create a complete Eitri shopping app for a store from its URL — organization, application, environments, mini-apps, slug aliases, remote config, Luminus v1 + v2 theme and app icon in the Eitri Console, plus a local repo built from the platform's template, rebuilt to look like the store (site-clone), pushed and published to dev for preview in Eitri Play. Use when the user says "create an Eitri app for the store <url>", "criar um app Eitri para a loja <url>", "new Eitri app from <site>", "demo app for this prospect", or otherwise wants a new Eitri app made from an existing VTEX, Wake or Shopify store.
---

# create-app

Turns a store URL into a working Eitri app. Three tools do the work — never mix up who does what:

| Who | Does |
|---|---|
| **eitri-manager MCP** (plugin `eitri-manager` server) | Every Console write: org, app, icon, mini-apps, aliases, config, themes, publish. Each write previews first and applies only with `confirm: true`. |
| **Scripts in `${CLAUDE_SKILL_DIR}/scripts/`** (Node; rendering uses site-clone's Playwright) | Deterministic local steps: detection, analysis, wiring, config, theme, icon, bottom bar, screen checks. |
| **`site-clone` skill + Eitri CLI** | Capture the store, rebuild its look in the repo, `eitri push-version`. |

`${CLAUDE_SKILL_DIR}` is this skill's folder; `site-clone` is its sibling (`${CLAUDE_SKILL_DIR}/../site-clone`).

**Supported platforms: VTEX, Wake, Shopify.** Anything else: stop and say so.

## Rules

- **One confirmation for all Console writes.** Gather and preview everything first (Phase 2), show the user one summary, and write only after they approve it. Never call a write tool with `confirm: true` before that.
- **Record every write in `.eitri/create-app.state.json`** (in the repo) right after it succeeds. Save each creation tool's structured response to a JSON file and run `node ${CLAUDE_SKILL_DIR}/scripts/state.mjs record --repo . --tool <create_organization|create_application|create_eitri_apps> --result <response.json>` immediately, **including partial results**. The script atomically persists only allowed identity fields and refuses to overwrite a conflicting id. On a rerun, read it first and skip what is done — never create a second org or app. Reconcile partial mini-app creation with `resume=true` (Phase 3).
- **Never invent store facts or credentials.** What `detect-store` can't find and only the user knows (Shopify tokens, a Wake integration account) is asked for. Credentials go to `.eitri/secrets.json`; both that file and the derived `.eitri/remote-config.json` must be gitignored. Shopify remote config is client-readable: accept only a public, client-safe Storefront token, never an Admin API token or client secret. Version the generated `.eitri/remote-config.example.json`, which has credential values cleared. If a resolved config is already tracked, remove it from the index before committing; gitignore alone does not untrack files.
- **Only the store's own brand.** This builds the store's app with its own name, logo and colors. If the user wants a *different* company's site as a design reference, use `site-clone` alone and swap the brand.
- **English and Portuguese.** Every mini-app ships `src/locales/en` and `src/locales/pt` with the same keys, and every interface text you add goes through `t()` in both (Phase 2 → Translations; `i18n.mjs check` is the gate before each push). The store's own copy — captured sections, CMS defaults, product data — stays in the store's language.
- **Production writes are explicit.** A new app's `prod` environment is empty, so writing its config/aliases with `allowProduction: true` is expected — but say so in the confirmation summary.

## Phase 0 — Preconditions

Check, and stop with the fix if one fails:

1. The MCP is connected: call `list_my_organizations`. If it fails, tell the user to run `/mcp` and log in to `plugin:eitri-coding:eitri-manager`.
2. The Eitri CLI, **on its latest release** (install: `npm i -g eitri-cli`). An old CLI passes every check here and then breaks the dev cycle mid-run, after the Console writes, so update it now, without asking:
   ```bash
   installed=$(eitri --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
   latest=$(npm view eitri-cli version 2>/dev/null)
   # sort -V puts the older first; an unreachable registry leaves latest empty and skips the update
   [ "$(printf '%s\n' "$installed" "$latest" | sort -V | head -1)" != "$latest" ] && eitri self-update
   eitri --version
   ```
   `self-update` failing (permissions on a global install): stop and ask the user to run `! npm i -g eitri-cli@latest`. This is the only update: never update the CLI, or run `eitri app clean`, later in the run without asking.
3. A **working** Eitri login: `eitri workspace list` must exit 0 — it is the cheap call that authenticates (`eitri workspace current` only reads local files and passes with expired credentials, which then fail the first `push-version` with `403 WrongUserOrPwd`, after every Console write). If it fails, ask the user to run `! eitri login` (interactive). Still failing after it: `EITRI_CLI_CLIENT_ID` / `EITRI_CLI_CLIENT_SECRET` in the environment override the login (`env | grep EITRI_CLI_CLIENT`); with the user's go-ahead, prefix every `eitri` command with `env -u EITRI_CLI_CLIENT_ID -u EITRI_CLI_CLIENT_SECRET`.
4. `node --version` ≥ 20 and `git`.

## Phase 1 — Detect

```bash
node ${CLAUDE_SKILL_DIR}/scripts/detect-store.mjs <url> > /tmp/profile.json
```

Read `platform`, `account` (VTEX/Wake) or `shopDomain` (Shopify), `storeName`, `locale`, `currency`.
`platform: null` → unsupported or undetectable: ask the user which platform it runs on; stop if it isn't one of the three.

Then ask, **in one message**, only what isn't known:

- **Organization**: default is a *new* organization named after the store (needs the platform ADMIN role: `create_organization` is only listed for admins). Otherwise list `list_my_organizations` and let them pick. If the user does not say the organization is a different brand, it gets the store's name and the app's icon; a different one (store Drogarias Pacheco, organization DPSP) needs its name and its image URL or site.
- **App name**: default a lowercase-hyphen slug of the store name (`C&A` → `cea`). It prefixes every mini-app slug.
- **Shopify only**: Storefront API token, Customer Account API client id and callback URL (`references/remote-config.md`). They may answer "later" — the app is created with empty values and the handoff lists them.
- **Demo or client app** (adds a `demo` label).

## Phase 2 — Prepare and preview (no Console writes)

1. **Template.** `list_templates` with `type: "APPLICATION"` and the platform. Prefer the official one (`eitri-tech/eitri-shopping-template`, `-template-wake`, `-template-shopify`); ask if several fit. If the catalogue has none, use that public repo directly.
2. **Repo.** In the working directory:
   ```bash
   git clone --depth 1 <gitUrl> <app-name> && cd <app-name> && rm -rf .git && git init -q
   printf '\n/scrape/\n/preview/\n.playwright-mcp/\n.eitri/secrets.json\n.eitri/remote-config.json\n' >> .gitignore
   git add -A && git commit -qm "chore: <template name> template"
   ```
   Move `/tmp/profile.json` to `.eitri/profile.json`. Create `.eitri/create-app.state.json` with the URL and the choices — `screens.mjs` reads `template.gitUrl` from it, so keep this shape:
   ```json
   { "url": "<url>", "template": { "id": "…", "name": "…", "gitUrl": "…" },
     "organization": { "id": "… or null", "name": "…", "new": false }, "appName": "<app-name>", "labels": [], "created": {} }
   ```
   `created` gets each Phase 3 write's ids as it succeeds.

   **Translations (English and Portuguese).** The templates ship Portuguese only (`src/locales/pt-BR`), so on a phone in English every label is a raw key. In each mini-app, `git mv src/locales/pt-BR src/locales/pt` (a language-only folder serves pt-BR and pt-PT alike; a regional one only that exact language), write `src/locales/en/translation.json` with the same keys and every value translated (keep `{{placeholders}}`), and add the keys the code uses that no file defines. Then
   `node ${CLAUDE_SKILL_DIR}/scripts/i18n.mjs check --repo .` must exit 0 (its warnings list values left in Portuguese). Commit.
3. **Capture** the store with `site-clone` (read its SKILL.md first), into the repo, phone-sized:
   ```bash
   node ${CLAUDE_SKILL_DIR}/../site-clone/scripts/scrape.mjs <url> --out scrape --name home --bp 375,414 --primary 375
   ```
   Re-run detection on the capture — rendered pages expose what scripts inject:
   `node ${CLAUDE_SKILL_DIR}/scripts/detect-store.mjs <url> --capture scrape/home > .eitri/profile.json`

   Every screen is compared with its store page, so the script finds the pages, never you: `profile.pages.listing` is the home's most repeated link (its navigation) whose page lists products, `profile.pages.product` is that listing's product with the most variants in stock (a PDP with a size/color selector), plus the platform's `cart` and `login` paths. Plan the screens and capture each one with the component probe:
   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/screens.mjs plan --repo .     # → .eitri/screens.json
   ```
   Run every screen's `commands.capture` from `.eitri/screens.json`, one at a time (the home again too: the first capture had no `--probe`), then `screens.mjs plan` again — the listing's facets (what the app opens to show the same products) come from its capture. `pages.listing: null` means no home link lists products: say so and add one by hand to `.eitri/profile.json` before planning. Each capture's `probe.json` is what the app will be measured against: open it and check it found the components (`cards` on the listing, `pdp.title`/`price`/`buyButton` on the PDP); an empty part there means the page needs a `--click` (a closed drawer, a tab) before capturing. On VTEX both carts hold the PDP's product (`pages.skuId`): the store's capture adds it, the app's render opens an order form `screens.mjs order-form` makes with it — never two empty states. Capture the store's identification step too, the first checkout screen: `scrape.mjs "<host>/checkout/?orderFormId=$(node <scripts>/screens.mjs order-form --repo .)#/email" --out scrape --name checkout-email --bp 375 --primary 375`; never type personal data into the store to reach the later steps.

   **Analyze** what the store has beyond its look — the screenshots do not show it:
   `node ${CLAUDE_SKILL_DIR}/scripts/analyze-store.mjs <url> --capture scrape/home --capture scrape/listing --capture scrape/pdp --capture scrape/login --capture scrape/cart --profile .eitri/profile.json > .eitri/store-features.json`
   - `integrations`: every third-party service the pages loaded (reviews, video stories, chat, analytics, marketing…) with its `support`: `rebuild` (a client-side widget you recreate in Phase 4 from the store's code and requests; `config` holds the ids found), `config` (the template supports it but the store decides: `optIn`), `native` (needs the native app build) or `none` (not in the app). A widget still loading when captured is flagged `placeholder`.
   - `home`: on VTEX IO, the home's sections read from the page's block tree — banners with their links, shelves with their **real collections and sort**, tabs, countdown dates — and as the template's CMS sections (`home.cmsSections`), the starting point of the home defaults in Phase 4; `home.skipped` has no app section. Every page a banner or the countdown links to is fetched and its action becomes what that page lists: a VTEX landing page (`store.custom` with a `customQuery`) opens its collection, titled with the page's name; a page without products opens in the in-app browser. A link it could not open is a warning. Without a block tree (deco.cx, FastStore, legacy CMS) the home's **banners** come from the capture's linked images instead — one section per row, its layout (slider, grid, mosaic, round tiles…) and ratio from the rendered boxes, the original files behind image proxies, each link opening the base facets its listing shares. Rows of product cards (product links with a price) are shelves, not banners. The rendered page also gives the store's **countdown** (its end date, even hidden) and a **StreamShop** video carousel, placed where the store has them. Sections the template lacks (`Countdown`, `VideoStories`, `TabbedProductShelf`, `GridList`, `Mosaic`) you build in Phase 4. App-download banners are left out (a `gap`); a section with text but no banner (a benefits row, a note) is a `text block` gap with its texts — rebuild it by hand. Shelves still come from the screenshots.
   - `productCard`: the store's card features and, from the catalog of the captured products, `badges` (VTEX highlights, specification values, their colors).
   - `search` (VTEX): whether the store's GraphQL search narrows by facet. A legacy one (`legacy: true`: by facet it counts the whole catalog) needs the app's catalog to send its facets as query/map, its filters reading the legacy facet lists (no price ranges).
   - `gaps`: everything the app will not reproduce. Nothing the store shows is dropped silently: each gap goes to the confirmation and the handoff.
4. **Brand** (`references/brand.md`): pick primary / secondary / background / text colors, radius, the text and heading fonts and the header logo URL from the capture, then
   `node ${CLAUDE_SKILL_DIR}/scripts/font-faces.mjs "<Text font>:<weights>" "<Heading font>:<weights>" --capture scrape/home > .eitri/font-faces.css` (the store's own self-hosted faces from the capture, with absolute URLs and a CORS check; families it doesn't host come from Google Fonts)
   `node ${CLAUDE_SKILL_DIR}/scripts/brand-theme.mjs --primary … --primary-content … [--secondary … --secondary-content …] [--background …] [--text …] [--radius …] --font-primary "<Text font>" --font-main "<Heading font>" --font-faces .eitri/font-faces.css --repo . [--color <name>=<color> …] > .eitri/theme.json`
   Fix every warning before going on: contrast (use the shade it names) and theme colors the repo's classes use that the theme lacks (`--color`, values from the capture).
   **App icon** (the avatar in the Console and Eitri Play: a square PNG, 512 px target, 180 px minimum, never upscaled):
   `node ${CLAUDE_SKILL_DIR}/scripts/app-icon.mjs <url> --capture scrape/home --logo <header logo URL> --background <the header color the logo sits on>`
   It downloads every source the store exposes — web app manifest icons, apple-touch-icon, `<link rel=icon>` (SVG too), `/favicon.ico` (largest frame) and the logo — into `.eitri/icon/candidates/`, measures each from its bytes, ranks them (a square ≥ 512 px or SVG first, then squares ≥ 180 px, then the logo centered on `--background`) and renders the result to `.eitri/icon/icon.png`; `.eitri/icon/icon.json` holds every candidate with its real size and verdict, and `upload`, the `upload_application_icon` arguments. Look at `icon.png`. Exit 3: the logo won and needs `--background`. Exit 4: nothing reaches 180 px and no logo can be padded — no icon; say so at the gate and in the handoff, never upload a smaller one. A "barely visible" warning means the wrong background: use the header's.
   **Organization icon** (a different brand only): the same command on its image or site, without `--capture`, with `--out .eitri/org-icon`.
5. **Mini-app plan**, then plan the screens again so they point at the real mini-app folders:
   `node ${CLAUDE_SKILL_DIR}/scripts/wire-app.mjs plan --repo . --prefix <app-name> > .eitri/plan.json && node ${CLAUDE_SKILL_DIR}/scripts/screens.mjs plan --repo .`
6. **Remote config.**
   `node ${CLAUDE_SKILL_DIR}/scripts/remote-config.mjs --repo . --profile .eitri/profile.json --plan .eitri/plan.json --features .eitri/store-features.json [--secrets .eitri/secrets.json] --set appConfigs.headerLogo=<logo url> > .eitri/remote-config.json`
   `--features` turns each opt-in into a warning; one the user accepts at the gate is added with `--set` (e.g. `--set appConfigs.clarityId=<id>`).
   Each `needs` entry is a value to ask for; carry the `warnings` to the summary.

   **Bottom bar** (`references/bottom-bar.md` — read it): the native tab bar is part of every screen and is made as close to the store's mobile tab bar as the platform allows — shape (floating pill or glued to the bottom), colors, the store's own icons, tab order and labels. Never leave the template's white bar with generic icons.
   `node ${CLAUDE_SKILL_DIR}/scripts/bottom-bar.mjs capture --capture scrape/home --out .eitri/bottom-bar`
   measures the store's bar and turns its icons into the PNGs the bar takes; set the tabs in `.eitri/remote-config.json` from its `tabs`, pick each icon's https URL (the store's icons once hosted, else the closest Material icon the reference lists), then `bottom-bar.mjs apply` (layout + icons) and `bottom-bar.mjs sync` (the repo's simulation files). What the platform cannot draw is a gap, never a reason to skip the rest.
7. **Preview** `create_application` without `confirm` when the organization already exists (`organizationId`, `name`, `eitriShop: { provider, storeName }`, `labels`). A same-name warning means a previous run may exist: check the state file and ask. (With a new organization there is nothing to collide with.) The mini-app and icon checks need the application, so they run in Phase 3, right before their writes.

**Confirmation gate.** Show one summary: organization (new or existing), application name and labels, the mini-app slugs, the environments (`dev`, `prod`) and the config highlights (`providerInfo`, main app, tabs) with the warnings, the theme colors and font, the bottom bar (store vs app: shape, tabs, icons and their host, `bar.json` warnings), the icon (chosen source, its real size, how it is prepared, the local file `.eitri/icon/icon.png`, and the rejected candidates with why) and the organization's (same, own, or kept), the integrations from `.eitri/store-features.json` (to rebuild, opt-in — ask —, native build, not in the app) and its `gaps`, and that `prod` gets the config with `allowProduction`. Ask for one yes. Nothing is written before it.

## Phase 3 — Write (in this order; save state after each)

1. `create_organization` `confirm: true` (if new) → `organizationId`. It also adds you to it as `ORG_ADMIN`: check `membership.verified` is true — without membership, creating mini-apps, aliases, config and pushes answer 403 even for platform admins. Then `upload_organization_icon` with `.eitri/org-icon/icon.json` → `upload` (the app's `.eitri/icon/icon.json` for the same brand): preview, then `confirm: true`. An existing organization with an `imageUrl` keeps it unless the user asks.
2. `create_application` `confirm: true` → `applicationId` and the `dev` / `prod` environment ids. If `environmentsError` is returned, record the created application id and call `list_environments`; never repeat creation for a failed read. **manager-api creates both environments — don't create them.**
3. `upload_application_icon` with `.eitri/icon/icon.json` → `upload` (`imageUrl`, and `background` for a logo): preview — its size must match `icon.json` → `icon` — then `confirm: true`. The MCP refuses anything under 180 px; when app-icon found nothing, skip the icon and list it in the handoff.
4. `create_eitri_apps` with `.eitri/plan.json` → `createEitriApps.apps`: preview first. Taken slugs → redo Phase 2 steps 5–6 with another prefix (e.g. `<app-name>-app`; the application keeps its name) and preview again. Then `confirm: true` and save the structured result to `.eitri/created.json`. A partial failure (`failed` or `appGroupError`) still returns the created mini-apps: record the result immediately with `state.mjs`, stop the dependent writes and report. To resume, keep the **complete original apps list** and preview `create_eitri_apps` with `resume: true`: it reuses only slugs owned by this application, creates missing mini-apps and reconciles the exact app group. Then confirm and record the new result, including `reused`. Do not run concurrent creation jobs for the same application. Continue only when `appGroupId` is present and neither failure field is set; `wire-app.mjs` accepts both `created` and `reused`. If existing group membership differs from the plan, report it for manual reconciliation.
5. Wire the repo, then commit:
   `node ${CLAUDE_SKILL_DIR}/scripts/wire-app.mjs apply --repo . --plan .eitri/plan.json --created .eitri/created.json --application <applicationId> --organization <organizationId>`
   `node ${CLAUDE_SKILL_DIR}/scripts/bottom-bar.mjs sync --repo . --config .eitri/remote-config.json` (the wiring renames only slugs: the simulation files must carry the store's bar, or every `eitri app start` session and snapshot shows the template's white one)
   `git add -A && git commit -qm "chore: wire to <app-name>"`
   The store's CMS is still empty and the template's `getCmsContent` answers `null`, which crashes `Home.jsx`, `Categories.jsx` and `LandingPage.jsx` (they destructure `sections`): make them fall back to local defaults — the home's are `home.cmsSections` from `.eitri/store-features.json`, written as a module in the home mini-app (e.g. `src/utils/defaultHome.js`) — so the first push opens. Commit.
6. `set_slug_aliases` with `plan.slugAliases` on `dev`, then on `prod` with `allowProduction: true`.
7. `update_environment_config` with `.eitri/remote-config.json` → `config` on `dev`, then `prod` (`allowProduction: true`). Review each preview's leak scan; never write a config the scan flags without the user's say.
8. `create_theme` (`content` = `theme.json` → `v2`, name "Brand") then `publish_theme`.
9. `create_global_css` (`css` = `theme.json` → `v1Css`, `allowProduction: true`) then `publish_global_css` (`allowProduction: true`). Creating is what counts: every environment ships the newest created build, inlined into each mini-app's `index.html` when that mini-app is published — so do this **before** step 10, and after any later CSS change republish every mini-app (`publish_revision` of its current revision). `publish_global_css` only marks the build in the Console.
10. **First push — the template as is, so the app opens before any custom code.** In each mini-app folder, shared ones first, **one at a time** (pushes share the developer's remote build workspace: concurrent ones fail with `Runner timeout após 20000ms … build.cjs`):
    ```bash
    (cd <shared path> && eitri push-version --shared -m "create-app: template" -y)
    (cd <app path> && eitri push-version -m "create-app: template" -y)
    ```
    Then for each mini-app: `list_revisions` (`eitriAppId`, or `applicationId` for all at once) → newest → `publish_revision` to `dev` with `confirm: true`. (`eitri publish -e <dev environment id>` from the folder does the same.)

**Checkpoint:** the app now opens in Eitri Play with the store's catalog, theme and icon. Tell the user (preview steps below) and keep going.

## Phase 4 — Make every screen look like the store

Load `eitri-specialist`, `eitri-luminus`, `eitri-bifrost` and `eitri-shopping` first, and read `site-clone`'s Eitri target (`references/targets/eitri.md`) and the platform's CMS adapter — VTEX: `eitri-vtex.md`; Wake/Shopify: see `references/remote-config.md` → CMS. The repo's own `AGENTS.md` / `CLAUDE.md` / `.aiconfig` win over them.

You own this phase in this session and judge every screen by eye against the captures — alone, or with agents doing whole mini-apps for you (**Splitting the work** below). **Every screen in `.eitri/screens.json` gets its own pass — home, listing, pdp, login, cart.** Restyling the shared primitives is where it starts, never where it ends: the template's card, PLP and PDP keep the template's look until their own files change — that is how earlier runs ended with a store-like home and template screens everywhere else.

Keep `eitri app start` running in the background (it rebuilds the dev workspaces on save; after a batch of changes wait for that app's "✓ Forjado em …" line).

**Per screen, at most two rounds:**
1. Render it with its `commands.render` from `.eitri/screens.json` (it writes `preview/<screen>/compare/NN.png`, store | app, and `probe.json`), then `node ${CLAUDE_SKILL_DIR}/scripts/fidelity.mjs check --repo . --screen <screen>` once: it compares the two probes (no render, instant) and lists the measured differences — `cards.card.name.fontWeight`, both values and the template files that draw it. It is a **spec sheet, not a gate** (it always exits 0).
2. Read the compare tiles with that list and fix **everything you see in one batch**: layout, block order, spacing, type, colors, radius, icons. Translate measured values straight into classes (`fontWeight` 300 → `font-light`, `fontSize` 12 → `text-xs`, ratio 0.67 → image height from its width, `columns` 2 `gapX` 4 → `grid-cols-2 gap-x-1`); a color used in more than one place becomes a theme color first.
3. Render again and fix what is still clearly off. Then move on — what is left (Luminus cannot draw it, the app lists other products, a font it cannot load) goes to the handoff, it does not earn a third round.

**Order and what each screen needs:**
1. **Primitives** — the shared lib's button (`CustomButton`), input (`CustomInput`) and box (`GenericBox`), from the PDP buy button and size options, the listing's filter bar and the login capture: height, radius (`pill` is `rounded-full`), border, background, label size, weight and case. A screen that needs another shape passes a class (`className`, `labelClassName`) rather than forking the primitive. Bump the shared version and every dependent's pin.
2. **listing / product card** — the card and its grid live here. The card is the shared lib's (`ProductCardFullImage`, presentational, texts passed in translated by each mini-app's wrapper), used by the PLP, the home's shelves, the PDP's related shelf and the wishlist, so restyling it once fixes all of them. Match image ratio, name, price, list price, installments, discount badge and wishlist, plus the store's badges (`productCard.badges`, drawn through `BadgeRender`) and rating stars (step 6). Then the PLP: columns, gaps, title, filter/sort bar.
3. **pdp** — gallery, name/price/buy block, size/color options, delivery, specifications, description, related shelf.
4. **home** — header (logo, search, cart, account), the bottom bar (compare it in Eitri Play with `.eitri/bottom-bar/store-bar.png`; fixes go through `references/bottom-bar.md` → Write) and the sections. The defaults are the `home.cmsSections` you wrote in Phase 3; build the section components the template lacks (countdown, video carousel, tabbed shelf, grid, mosaic) from their captures, style the sections and add the shelves and texts the analysis could not read — **do not research banner targets or collections by hand** (fetching landing pages, guessing collections): a link the analysis could not resolve keeps its action and goes to the handoff as a gap. A section default that opens a product uses its product id (`{ type: 'product', value: '74' }`): VTEX FastStore product URLs are `/<linkText>-<skuId>/p`, but the template's PDP looks a `slug` up as a linkText. Categories default to the live category tree (`CategoryListVtex`, `exclusionList` is a `;`-separated string), landing pages to the catalog by biggest discount (`ProductInfiniteScroll`, `sort: discount:desc`): preview them with `--init "route=Categories"` / `"route=LandingPage"`.
5. **login / cart / checkout** — the sign-in box against `scrape/login`; the cart against `scrape/cart` and the first checkout step against `scrape/checkout-email` (render the checkout mini-app with the same `--init "orderFormId=…"`). A store's checkout is often a look of its own — VTEX's checkout theme: a gray page, blue links, green buttons, an item card with a colored top border — so it gets its own theme tokens and is applied to the cart and checkout mini-apps as a whole (a file in their `src/providers/` sets the page color and the buttons' tone), not left in the template's brand style. `report.json` → `pageErrors` must stay empty on every render.
6. **Integrations** — each `rebuild` entry in `.eitri/store-features.json` (reviews, video stories…), where the store shows it. Read how the store does it — `scrape/<screen>/network.json` (API calls keep method, body and an answer sample) and its rendered HTML/JS — and call the endpoint to see the full answer. Rebuild it with `Eitri.http`, styled like the capture, its store values (website id, slug, key) in remote config, not hardcoded. Check it in browser-preview: a key restricted by `Origin`/`Referer` fails there as in the app. One that cannot work goes to the handoff as a gap.

**Splitting the work.** The screens live in separate mini-apps, so once the shared ground is laid they can be rebuilt in parallel. This is optional: use it when a subagent tool is available and three or more screens remain. It runs several sessions at once and roughly multiplies the token cost, so with a small store or a tight budget do the same steps in order yourself.
1. **Shared ground first, by you alone.** Step 1 above (the primitives), then the product card and anything every screen's header uses (the store's header row, a bar under it). Render one screen of another mini-app to confirm that a shared change reaches it in the dev build before anyone builds on it.
2. **Every token up front.** Turn each color used in more than one place, on any captured screen, into a named theme color — including screens with a look of their own (a platform checkout, a hosted login). Write the theme once, publish it, and restart `eitri app start`: agents then write class names, not hex values, and nobody edits the theme in the middle of the work.
3. **One agent per mini-app.** Take the split from `.eitri/plan.json` and `.eitri/screens.json`: each non-shared mini-app with a screen to rebuild goes to one agent, and mini-apps that share a look or a flow (the cart and the checkout) go to the same one. Keep for yourself the screen that leans most on the shared card (usually home and listing). Brief each agent from `references/phase4-brief.md`, filled in for this run: its folders, its screens with their exact render commands, the values you measured from the section trees, the tokens and shared components it can use. A brief that only points at the captures gets a generic screen back.
4. **Agents stay inside their folders.** They never edit the shared mini-app, commit, push, publish or write to the Console, and never start or stop `eitri app start`. A shared change they need comes back in their report.
5. **Check before you commit.** Read at least one compare tile per screen an agent reports before committing its folder: a report is not a render. Then commit per mini-app, and do the version bumps, pushes and publishes yourself once every screen is in.
6. An agent stopped by a usage or rate limit keeps its transcript: resume it with a message when the limit clears instead of starting a new one.

**Before calling a screen done, go through the store page top to bottom** (`scrape/<screen>/layout/sections.json` and its section screenshots) and account for every section: built in the app, or listed as a gap with its reason. `fidelity.mjs` compares the product components only — a missing countdown, an icon row or a video carousel never shows up in its diffs.

**A page background goes on the page, not on an inner View** (a dark campaign home): a fixed full-screen layer behind the content plus the content's own background. The header's spacer and the scroll bounce show whatever is behind the content — a phone shows both, browser-preview neither.

Render once with `--locale en-US --name <screen>-en` as well (without `--name` it overwrites the screen's preview): no screen may show a raw key or a Portuguese interface text. Run `i18n.mjs check --repo .` again.

`bottom-bar.mjs sync --repo . --config .eitri/remote-config.json --check` must exit 0 (run `sync` without `--check` and commit when it does not).

Then, for each changed mini-app: bump `version` in its `eitri-app.conf.js` (and the dependents' pin when the shared app changes), `eitri push-version -m "<what changed>" -y` (`--shared` for shared), then `publish_revision` to `dev`. Commit. Verify the publish with `list_revisions` (each revision's `environments`; `list_published_revisions` can lag several minutes behind a publish).

## Phase 5 — Preview and hand off

**Preview:** open **Eitri Play** on a phone → log in with the Eitri account → pick the organization → the app → `dev`. (Guests without Console access can't open it yet.)

**Snapshot (when asked, or when the store already has its own native app):** a snapshot keeps the repo's bottom-bar simulation, not the environment's bar: `bottom-bar.mjs sync --check` first. With everything committed and `eitri app start` stopped, run `eitri app snapshot -v` from the repo root (`eitri-specialist` → *Snapshots*). It prints a deeplink and a QR code, `<protocol>-dev://app-snapshot/…`; the protocol is the application's `snapshotDeeplinkProtocol`. It opens only in the application's native **dev** build, never in Eitri Play: a new application without a native app cannot open it yet. Say that with the link, and put the link in `EITRI_APP.md`.

Write `EITRI_APP.md` at the repo root from `references/handoff.md`, commit, and finish with a short summary: what was created (with ids), how to preview, **each screen's status** (matches, or what is still different and why — never say a screen looks like the store unless its compare tiles show it), what is placeholder (CMS content, Shopify credentials, reCAPTCHA, deep links), the integrations and every gap from `.eitri/store-features.json` (plus any the rebuild found), and next steps.

## Cleanup

There is no delete tool on purpose. For a failed or throwaway run, list what was created from `.eitri/create-app.state.json` (organization, application, mini-app ids and slugs) and ask the user to remove it in the Console, or to ask an Eitri admin. Never try to delete through other tools.
