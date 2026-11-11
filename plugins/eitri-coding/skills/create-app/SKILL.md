---
name: create-app
description: Create a complete Eitri shopping app for a store from its URL — organization, application, environments, mini-apps, slug aliases, remote config, Luminus v1 + v2 theme and app icon in the Eitri Console, plus a local repo built from the platform's template, rebuilt to look like the store (site-clone), pushed and published to dev for preview in Eitri Play. Use when the user says "create an Eitri app for the store <url>", "criar um app Eitri para a loja <url>", "new Eitri app from <site>", "demo app for this prospect", or otherwise wants a new Eitri app made from an existing VTEX, Wake or Shopify store.
---

# create-app

Turns a store URL into a working Eitri app. Three tools do the work — never mix up who does what:

| Who | Does |
|---|---|
| **eitri-manager MCP** (plugin `eitri-manager` server) | Every Console write: org, app, icon, mini-apps, aliases, config, themes, publish. Each write previews first and applies only with `confirm: true`. |
| **Scripts in `${CLAUDE_SKILL_DIR}/scripts/`** (Node, no dependencies) | Deterministic local steps: `detect-store.mjs`, `wire-app.mjs`, `remote-config.mjs`, `brand-theme.mjs`. |
| **`site-clone` skill + Eitri CLI** | Capture the store, rebuild its look in the repo, `eitri push-version`. |

`${CLAUDE_SKILL_DIR}` is this skill's folder; `site-clone` is its sibling (`${CLAUDE_SKILL_DIR}/../site-clone`).

**Supported platforms: VTEX, Wake, Shopify.** Anything else: stop and say so.

## Rules

- **One confirmation for all Console writes.** Gather and preview everything first (Phase 2), show the user one summary, and write only after they approve it. Never call a write tool with `confirm: true` before that.
- **Record every write in `.eitri/create-app.state.json`** (in the repo) right after it succeeds. On a rerun, read it first and skip what is done — never create a second org, app or mini-app.
- **Never invent store facts or credentials.** What `detect-store` can't find and only the user knows (Shopify tokens, a Wake integration account) is asked for. Secrets go to `.eitri/secrets.json`, which must be gitignored.
- **Only the store's own brand.** This builds the store's app with its own name, logo and colors. If the user wants a *different* company's site as a design reference, use `site-clone` alone and swap the brand.
- **English and Portuguese.** Every mini-app ships `src/locales/en` and `src/locales/pt` with the same keys, and every interface text you add goes through `t()` in both (Phase 2 → Translations; `i18n.mjs check` is the gate before each push). The store's own copy — captured sections, CMS defaults, product data — stays in the store's language.
- **Production writes are explicit.** A new app's `prod` environment is empty, so writing its config/aliases with `allowProduction: true` is expected — but say so in the confirmation summary.

## Phase 0 — Preconditions

Check, and stop with the fix if one fails:

1. The MCP is connected: call `list_my_organizations`. If it fails, tell the user to run `/mcp` and log in to `plugin:eitri-coding:eitri-manager`.
2. The Eitri CLI: `eitri --version` (install: `npm i -g eitri-cli`) and a **working** login: `eitri workspace list` must exit 0 — it is the cheap call that authenticates (`eitri workspace current` only reads local files and passes with expired credentials, which then fail the first `push-version` with `403 WrongUserOrPwd`, after every Console write). If it fails, ask the user to run `! eitri login` (interactive). Still failing after a login with `EITRI_CLI_CLIENT_ID` / `EITRI_CLI_CLIENT_SECRET` set in the environment: the CLI authenticates with that client credential instead of the login (`env | grep EITRI_CLI_CLIENT`). Say so; with the user's go-ahead, prefix every `eitri` command with `env -u EITRI_CLI_CLIENT_ID -u EITRI_CLI_CLIENT_SECRET`.
3. `node --version` ≥ 20 and `git`.

## Phase 1 — Detect

```bash
node ${CLAUDE_SKILL_DIR}/scripts/detect-store.mjs <url> > /tmp/profile.json
```

Read `platform`, `account` (VTEX/Wake) or `shopDomain` (Shopify), `storeName`, `locale`, `currency`, `iconCandidates`.
`platform: null` → unsupported or undetectable: ask the user which platform it runs on; stop if it isn't one of the three.

Then ask, **in one message**, only what isn't known:

- **Organization**: default is a *new* organization named after the store (needs the platform ADMIN role: `create_organization` is only listed for admins). Otherwise list `list_my_organizations` and let them pick.
- **App name**: default a lowercase-hyphen slug of the store name (`C&A` → `cea`). It prefixes every mini-app slug.
- **Shopify only**: Storefront API token, Customer Account API client id and callback URL (`references/remote-config.md`). They may answer "later" — the app is created with empty values and the handoff lists them.
- **Demo or client app** (adds a `demo` label).

## Phase 2 — Prepare and preview (no Console writes)

1. **Template.** `list_templates` with `type: "APPLICATION"` and the platform. Prefer the official one (`eitri-tech/eitri-shopping-template`, `-template-wake`, `-template-shopify`); ask if several fit. If the catalogue has none, use that public repo directly.
2. **Repo.** In the working directory:
   ```bash
   git clone --depth 1 <gitUrl> <app-name> && cd <app-name> && rm -rf .git && git init -q
   printf '\n/scrape/\n/preview/\n.playwright-mcp/\n.eitri/secrets.json\n' >> .gitignore
   git add -A && git commit -qm "chore: <template name> template"
   ```
   Move `/tmp/profile.json` to `.eitri/profile.json`. Create `.eitri/create-app.state.json` with the URL, profile and choices.

   **Translations (English and Portuguese).** Eitri Play opens each mini-app in the phone's language, and the templates ship Portuguese only (`src/locales/pt-BR`): on a phone set to English every label is a raw key (`emptyCart.txtEmptyCart`). In each mini-app, `git mv src/locales/pt-BR src/locales/pt` (a language-only folder serves pt-BR and pt-PT alike; a regional one only that exact language), write `src/locales/en/translation.json` with the same keys and every value translated (keep `{{placeholders}}`), and add the keys the code uses that no file defines. Then
   `node ${CLAUDE_SKILL_DIR}/scripts/i18n.mjs check --repo .` must exit 0 (its warnings list values left in Portuguese). Commit.
3. **Capture** the store with `site-clone` (read its SKILL.md first), into the repo, phone-sized:
   ```bash
   node ${CLAUDE_SKILL_DIR}/../site-clone/scripts/scrape.mjs <url> --out scrape --name home --bp 375,414 --primary 375
   ```
   Re-run detection on the capture — rendered pages expose icons the raw HTML hides:
   `node ${CLAUDE_SKILL_DIR}/scripts/detect-store.mjs <url> --capture scrape/home > .eitri/profile.json`

   The home is one screen of six. Capture the pages the other mini-apps copy, from `profile.pages` (a product link found on the home, and the platform's cart and login paths), with the same flags: `--name pdp` (`pages.product`; when it is `null`, pick any product link from `scrape/home/content/outline.json`), `--name login` (`pages.login`) and `--name cart` (`pages.cart`). Without a session a VTEX cart usually shows the checkout's identity step instead of the cart: keep that capture as a reference for the checkout look only and say so — the cart then follows the PDP's cards, buttons and prices.
4. **Brand** (`references/brand.md`): pick primary / secondary / background / text colors, radius, the text and heading fonts and the header logo URL from the capture, then
   `node ${CLAUDE_SKILL_DIR}/scripts/font-faces.mjs "<Text font>:<weights>" "<Heading font>:<weights>" --capture scrape/home > .eitri/font-faces.css` (the store's own self-hosted faces from the capture, with absolute URLs and a CORS check; families it doesn't host come from Google Fonts)
   `node ${CLAUDE_SKILL_DIR}/scripts/brand-theme.mjs --primary … --primary-content … [--secondary … --secondary-content …] [--background …] [--text …] [--radius …] --font-primary "<Text font>" --font-main "<Heading font>" --font-faces .eitri/font-faces.css --repo . [--color <name>=<color> …] > .eitri/theme.json`
   Fix every warning before going on: contrast (use the shade it names) and theme colors the repo's classes use that the theme lacks (`--color`, values from the capture).
5. **Mini-app plan.**
   `node ${CLAUDE_SKILL_DIR}/scripts/wire-app.mjs plan --repo . --prefix <app-name> > .eitri/plan.json`
6. **Remote config.**
   `node ${CLAUDE_SKILL_DIR}/scripts/remote-config.mjs --repo . --profile .eitri/profile.json --plan .eitri/plan.json [--secrets .eitri/secrets.json] --set appConfigs.headerLogo=<logo url> > .eitri/remote-config.json`
   Each `needs` entry is a value to ask for; carry the `warnings` to the summary.
7. **Preview** `create_application` without `confirm` when the organization already exists (`organizationId`, `name`, `eitriShop: { provider, storeName }`, `labels`). A same-name warning means a previous run may exist: check the state file and ask. (With a new organization there is nothing to collide with.) The mini-app and icon checks need the application, so they run in Phase 3, right before their writes.

**Confirmation gate.** Show one summary: organization (new or existing), application name and labels, the mini-app slugs, the environments (`dev`, `prod`) and the config highlights (`providerInfo`, main app, tabs) with the warnings, the theme colors and font, the icon URL, and that `prod` gets the config with `allowProduction`. Ask for one yes. Nothing is written before it.

## Phase 3 — Write (in this order; save state after each)

1. `create_organization` `confirm: true` (if new) → `organizationId`. It also adds you to it as `ORG_ADMIN`: check `membership.verified` is true — without membership, creating mini-apps, aliases, config and pushes answer 403 even for platform admins.
2. `create_application` `confirm: true` → `applicationId` and the `dev` / `prod` environment ids. **manager-api creates both environments — don't create them.**
3. `upload_application_icon`: preview each `iconCandidates` URL in order until one passes, then `confirm: true`. The list goes from the best (square PNG/JPEG/WebP, ≥ 180 px: it is the Console / Eitri Play avatar) to the store's `.ico` favicon, which the MCP converts to PNG — small, but the store's own mark: use it rather than no icon, and note in the handoff that a larger icon would look sharper. Skip the icon only when no candidate passes.
4. `create_eitri_apps` with `.eitri/plan.json` → `createEitriApps.apps`: preview first. Taken slugs → redo Phase 2 steps 5–6 with another prefix (e.g. `<app-name>-app`; the application keeps its name) and preview again. Then `confirm: true` and save the structured result to `.eitri/created.json`. A partial failure (`failed` in the result) creates no app group: record the created mini-apps in the state file, stop, and report — retrying only the rest would leave the app group incomplete. To start over, clean up first (see Cleanup).
5. Wire the repo, then commit:
   `node ${CLAUDE_SKILL_DIR}/scripts/wire-app.mjs apply --repo . --plan .eitri/plan.json --created .eitri/created.json --application <applicationId> --organization <organizationId>`
   `git add -A && git commit -qm "chore: wire to <app-name>"`
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

## Phase 4 — Make it look like the store

Follow `site-clone` Phase 2–3 with its Eitri target (`references/targets/eitri.md`) and the platform's CMS adapter — VTEX: `eitri-vtex.md`; Wake/Shopify: see `references/remote-config.md` → CMS. Load `eitri-specialist`, `eitri-luminus`, `eitri-bifrost` and `eitri-shopping` first; the repo's own `AGENTS.md` / `CLAUDE.md` / `.aiconfig` win over them.

Scope for the first version — every screen, not only the home, each as close to 1:1 with its 375 px capture as Luminus allows:

1. **The shared primitives first**, from the PDP and login captures: the shared lib's card (`GenericBox`), button (`CustomButton`) and input (`CustomInput`) — radius, height, border, shadow, label case and size. Every screen of every mini-app is built from them (the VTEX template uses them in 60+ files), so this is what makes the PDP, cart, account and checkout look like the store; leaving them as the template ships them is why those screens keep the template's look while the home matches. A screen that needs another shape passes a class (`CustomButton` → `className`, `labelClassName`) rather than forking the primitive. Bump the shared version and every dependent's pin.
2. **Header and home**: logo, search, cart, account; the home sections; footer content as an account/menu entry.
3. **Product card**, in the shared lib (presentational, texts passed in translated by each mini-app's wrapper), used by home, PDP shelves and the account's wishlist alike — the template keeps a separate wrapper per mini-app, all pointing at its own card.
4. **PDP** against `scrape/pdp`: gallery, the name/price/buy block, delivery, specifications, description, related shelf. Render with `--app pdp --init "slug=<the captured product's slug>"`.
5. **Account / sign-in** against `scrape/login` (`--app account --init route=SignIn`), and the **cart** and **checkout** through the primitives above. Start from the template's component for each piece, but its look gives way to the capture: change spacing, type, colors, radius and layout until the section matches, and replace a component that cannot. Captured copy and images become section **defaults** (the store's CMS is empty at first — see the CMS note in `references/remote-config.md`). The VTEX template's CMS views do not survive an empty CMS: `getCmsContent` answers `null`, `Home.jsx` and `Categories.jsx` destructure it (the home stays on its skeleton forever, Categories throws), and `LandingPage.jsx` — the "Ofertas" tab — renders nothing (and, opened from its tab, shows a back arrow: the tab sends `tabIndex`, not the `openInBottomBar` it checks). VTEX FastStore product URLs are `/<linkText>-<skuId>/p` (`/kit-netflix-81/p` is linkText `kit-netflix`, SKU 81), but the template's PDP looks a `slug` up as a linkText: a section default that opens a product uses its product id (`{ type: 'product', value: '74' }`), and the PDP's slug lookup should retry without the `-<digits>` suffix. Give each a local default with the same `{ id, name, data }` shape as CMS sections (e.g. `src/utils/defaultHome.js`), used when the page is missing or has no sections: the captured home; for Categories the store's live category tree (`CategoryListVtex`, `exclusionList` is a `;`-separated string); for landing pages the catalog by biggest discount (`ProductInfiniteScroll`, `sort: discount:desc`). Preview each with `--init "route=Categories"` / `"route=LandingPage"`.

**Work in the render–compare loop** (site-clone `references/targets/eitri.md` → Verify). Keep `eitri app start` running in the background (it rebuilds the dev workspaces on save; after each change wait for that app's "✓ Forjado em …" line), and render after every section:
```bash
node ${CLAUDE_SKILL_DIR}/../eitri-device/tools/browser-preview.mjs --app home --config .eitri/remote-config.json \
     --compare scrape/home/screenshots/375-fullpage.png --out preview
```
Read `preview/home/compare/NN.png` (store | app, one screen each) and fix what differs before moving to the next section; `report.json` → `pageErrors` must stay empty. No device is needed: this renders the real build with the real theme and catalog in Chromium. Use `--init "route=…"` for other views and `--app account` (etc.) for other mini-apps; a device, when attached, is the final check (`eitri-device`). Gitignore `preview/`.

Render once with `--locale en-US` as well: no screen may show a raw key or a Portuguese interface text. Run `i18n.mjs check --repo .` again before pushing.

When the home and the other screens in scope match, for each changed mini-app: bump `version` in its `eitri-app.conf.js` (and the dependents' pin when the shared app changes), `eitri push-version -m "<what changed>" -y` (`--shared` for shared), then `publish_revision` to `dev`. Commit. Verify the publish with `list_revisions` (each revision's `environments`; `list_published_revisions` can lag several minutes behind a publish).

## Phase 5 — Preview and hand off

**Preview:** open **Eitri Play** on a phone → log in with the Eitri account → pick the organization → the app → `dev`. (Guests without Console access can't open it yet.)

Write `EITRI_APP.md` at the repo root from `references/handoff.md`, commit, and finish with a short summary: what was created (with ids), how to preview, what is placeholder (CMS content, Shopify credentials, reCAPTCHA, deep links), and next steps.

## Cleanup

There is no delete tool on purpose. For a failed or throwaway run, list what was created from `.eitri/create-app.state.json` (organization, application, mini-app ids and slugs) and ask the user to remove it in the Console, or to ask an Eitri admin. Never try to delete through other tools.
