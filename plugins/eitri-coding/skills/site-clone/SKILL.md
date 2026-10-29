---
name: site-clone
description: Scrape a live website with Playwright and rebuild it 1:1 in the current project's framework — components, styles, tokens, images, copy, responsive behaviour and interaction logic. Use whenever the user wants to clone, replicate, port, recreate, "copy this site", "rebuild this page", or reference an existing storefront/landing page while building in FastStore, Eitri (Luminus + Bifrost), Next.js/React, or any other framework. Also use to capture a design reference bundle from a URL before implementing.
---

# site-clone

Turn a live URL into a **reference bundle**, then rebuild it section by section in
whatever framework the current project uses. Two separate jobs — do not mix them:

| Phase | Tool | Why |
|---|---|---|
| **Capture** | `scripts/scrape.mjs` (bundled Playwright) | Deterministic, complete, costs no context. One run gets the DOM, every matching CSS rule, computed-style deltas per breakpoint, assets, copy, and behaviour hints. |
| **Render & compare** | `scripts/shot.mjs` (bundled Playwright) | Screenshot `snapshot.html`, or your rebuild, with the *same* emulation the capture used — so the comparison is apples to apples. |
| **Probe** | **Playwright MCP**, if available | Anything the script can't see standing still: open menus, click carousels, expand accordions, submit forms. |

**The Playwright MCP is optional.** Both scripts carry their own Playwright, so
capture and verification work without it. It only makes Phase 2 easier — driving a
live page interactively and looking at the result turn by turn. Without it, do the
same thing with `--click` on either script, or a short companion script; you lose
convenience, not capability.

Either way, never scroll a site with the MCP to "read" it into context. The capture
already holds more than the MCP snapshot would, in files you can read selectively.

---

## Phase 1 — Capture

```bash
node ${CLAUDE_SKILL_DIR}/scripts/scrape.mjs <url> --out scrape --name <slug>
```

Capture **into the project root** (`--out scrape`, i.e. `<project>/scrape/<slug>/`), never
into a scratchpad or other session-scoped temp directory. The bundle is expensive to
regenerate and has no reason to expire with the conversation — the next session (yours
or a teammate's) should be able to read it straight off disk instead of re-scraping.
The first time you create `scrape/` in a project, add it to that project's
`.gitignore` (a line like `/scrape/`) unless the user asks to commit it — these
bundles run tens of MB and are a reference artifact, not source. If Phase 2 uses
the Playwright MCP, it writes its own snapshots/screenshots/console logs into a
`.playwright-mcp/` folder at the project root — gitignore that too (`.playwright-mcp/`).

First run, and again after each plugin update (the plugin folder is replaced on
update): `cd "${CLAUDE_SKILL_DIR}/scripts" && npm ci && npx playwright install chromium`.
The scripts print this command themselves when Playwright is missing.

`${CLAUDE_SKILL_DIR}` is this skill's folder (the one holding this `SKILL.md`).
Claude Code expands it; in other clients, substitute that path. The reference files
write it as `<skill-dir>`.

Useful flags (`--help` for all):

| Flag | Use it when |
|---|---|
| `--bp 375,768,1440` | Match the project's real breakpoints. Mobile-only target (Eitri)? Use `--bp 375,414 --primary 375` — anything under 700px is captured with touch and a mobile UA emulated, so you get the site's real phone layout, not a squeezed desktop. |
| `--click "sel,sel"` | A menu, tab, or "load more" must be open for the content to exist. |
| `--sections "sel"` | The auto split is wrong — force the section roots yourself. |
| `--max-nodes 800` | A section came back `truncated`. |
| `--max-repeat 5` | You need more exemplars of a repeated item (default 3 per group). |
| `--storage auth.json` | The page needs a login. Create the state file with `npx playwright open --save-storage=auth.json <url>` and log in by hand. |
| `--header "K: V"` | The site keys off a header (locale, A/B cohort, an API token). |
| `--headed` | A bot wall or a consent flow you need to watch. |
| `--full-css` | You need to grep the original stylesheets, not just the matching rules. |

Capture **every page you intend to rebuild** (home, PLP, PDP, cart…) into the same
`scrape/` root. Shared chrome — header, footer, product card — shows up in all of
them; that repetition is what tells you which components are shared.

### Check the capture before you build on it

1. Read `scrape/<slug>/README.md` — it is generated per capture and indexes everything.
2. Render `snapshot.html` — `node ${CLAUDE_SKILL_DIR}/scripts/shot.mjs
   scrape/<slug>/snapshot.html check.png --bp <primary>` — and look at it. It is the
   cleaned DOM wired to `css/used.css` and the downloaded assets. **If it renders
   like the original, the capture is complete enough to rebuild from.** If it comes
   back unstyled or without images, fix the capture before writing any code.
   It runs no JavaScript, so JS-driven appearance — lazy-load fade-ins, a drawer's
   runtime state — can differ; that is expected and not a reason to re-run. The
   screenshots are the pixel truth.
3. Skim `layout/sections.json`. If sections are merged or over-split, re-run with
   `--sections`. Everything downstream keys off these indices.

### What lands in the bundle

```
scrape/<slug>/
  README.md              generated index + styleguide — read this first
  snapshot.html          offline-renderable copy of the page (fidelity gate)
  page.rendered.html     post-JS DOM, verbatim
  page.raw.html          server HTML before hydration
  layout/
    sections.json        the section split; every index below refers to it
    <bp>/<NN>-<name>.json   per-section element tree (see below)
    responsive.json      per-node property deltas between breakpoints
  css/used.css           every CSS rule that matches this DOM, in source order
  design/
    tokens.json          CSS custom properties + value frequencies
    states.json          :hover / :focus / :active rules — invisible to computed styles
    fonts.json           families in use, @font-face, downloaded files
  content/
    copy.md              all human copy, grouped by section
    outline.json         headings, links, buttons, inputs, alts, in document order
  assets/
    images/ fonts/       only assets the DOM or a matching rule actually references
    images.json svgs.json   inline SVGs deduplicated, most-used first
  behaviors.json         sticky bars, carousels, accordions, dialogs, transitions, forms
  screenshots/           <bp>-fullpage, <bp>-viewport, sections/<NN>-<name>@<bp>
  network.json manifest.json
```

**Reading a section tree.** Each file is `{ styleSets, tree }`. A node carries
`tag`, `cls`, `box: [x, y, w, h]` relative to the section, `s` (an index into
`styleSets`), plus `text`, `attrs`, `img`, `svg`, `bgImage` when present. A style
set lists **only** what differs from the browser default for that tag — and for
inherited properties, only what differs from the parent. Nodes sharing an `s` are
the same component instance repeated: that is your strongest signal for where a
component boundary belongs. `repeats: n` on a node means it had *n* identical
siblings and only a few exemplars were kept — a product grid of 40 cards arrives as
3 cards and `repeats: 40`. Build the component once and map over real data.

`css/used.css` is authoritative. When the tree and the CSS disagree, or you need
the authored value (`100%`, `clamp()`, a variable) rather than the resolved pixel
value, read the rule.

### When the capture comes back wrong

The script prints warnings and repeats them at the top of the generated `README.md`
and in `manifest.json` → `warnings`. **Read them before building.** Each phase is
independent: if one fails, the run continues without it and says so, so a partial
bundle is normal, not a reason to start over.

Work down this list — the fix is almost always a flag, not a code change:

| Symptom | Fix |
|---|---|
| 0–2 sections, or one section covering the whole page | `--sections "<selector>,<selector>"` |
| Sections merged, split mid-block, or overlays captured as blocks | same — force the roots |
| `truncated` sections | `--max-nodes 900` |
| Only a few CSS rules matched; page renders unstyled in `snapshot.html` | Check the console for a failed sheet, then `--full-css` and read the source directly |
| Content missing that needs a click (menu, tab, "load more") | `--click "sel,sel"` |
| Content missing that needs login | `npx playwright open --save-storage=auth.json <url>`, log in by hand, then `--storage auth.json` |
| Nothing loads / bot wall | `--headed`, `--wait 8000`, `--timeout 120000` |
| Lazy images missing | `--wait 6000` (the script already scrolls the full page) |
| Layout is desktop at a mobile breakpoint | already handled below 700px; check the site isn't serving by UA — try `--header "User-Agent: …"` |
| Warned about shadow roots | Expected. Trees include shadow content; scoped rules are in `css/shadow.css` and are **not** applied by `snapshot.html`, so that page will look wrong while the data is fine. |
| Warned about a cross-origin iframe | Not capturable. Capture the iframe's own URL as a second bundle, or rebuild that block from screenshots. |
| Warned about `<canvas>` | No structure exists to capture. Screenshots only; agree a substitute with the user. |

Only after the flags are exhausted is the capture itself the problem.

### If you have to go beyond the flags

The script is shared by every project on this machine, and the plugin install
overwrites it on every update. **Do not edit it to make one site work.** In order of preference:

1. **Probe with the Playwright MCP** and write what you find into the bundle by hand
   — `behaviors.md`, or a JSON file alongside the generated ones. Most one-off gaps
   (one component's internals, one interaction) are three `browser_evaluate` calls,
   not a script change.
2. **Write a small companion script** next to the project (`scripts/capture-x.mjs`),
   importing `playwright` from the skill's `node_modules`. Use it for site-specific
   extraction — a bespoke API dump, a route sweep, a component that needs driving.
   Site-specific code belongs in the project, not in the skill.
3. **Fix `scripts/scrape.mjs` itself only when the bug is general** — a whole class
   of sites is affected, not this one URL. If you do:
   - keep every existing output file and its shape; downstream docs and any earlier
     capture depend on them
   - wrap new in-page work in the existing `safe()` helper so it can never take the
     rest of the run down with it
   - re-verify against two sites with different stacks before you call it done
     (one CSS-in-JS, one utility-CSS; the two used to build this were
     `preciousmetals.td.com` and `oscarcalcados.com.br`), and check `snapshot.html`
     still renders
   - tell the user you changed a shared tool, and what changed

Adding a **flag** is nearly always the right shape for a general fix — it leaves
every existing capture reproducible.

---

## Phase 2 — Probe what standing still can't show

The capture is one state: logged out, default locale, nothing clicked. Before
rebuilding anything interactive, drive the real site — with the **Playwright MCP**
if you have it, otherwise `shot.mjs --click "<selector>"` one interaction at a time —
and write findings into `scrape/<slug>/behaviors.md`:

- open each nav menu / dropdown — structure, trigger, animation
- advance every carousel `behaviors.json` flagged — autoplay? loop? peek? dots?
- expand accordions and tabs, open modals, toggle filters
- focus and hover the primary controls (`design/states.json` gives you the CSS;
  confirm what actually changes)
- run a real search / add to cart if the flow is in scope — note the requests in
  `network.json` that back it

Skip this only for a purely static page. Without the MCP this is slower but not
blocked: each `--click` run answers one question, and `behaviors.json` already tells
you which elements to aim at.

---

## Phase 3 — Rebuild

Read the adapter for the target framework **before** writing code:

- **FastStore / VTEX** → `references/targets/faststore.md`
- **Eitri (Luminus + Bifrost)** → `references/targets/eitri.md`
- **Anything else** (Next.js, Vite, Astro, plain React) → `references/targets/generic.md`

Identify the target from the project, not from the user's phrasing: `faststore.config.js`
or `@faststore/core` → FastStore; `app-config.yaml` or `eitri-app.conf.js` → Eitri
(and that project's own skills and `.aiconfig` outrank anything here).

Then follow `references/recreate.md` — the loop, the fidelity bar, and the rules
about what to translate versus copy verbatim. In short:

1. **Tokens first.** Turn `design/tokens.json` + the README's scale tables into the
   target's theme layer (Tailwind config, CSS variables, DaisyUI theme). Never let a
   raw hex or px value from a section tree reach a component before it exists as a token.
2. **Shared primitives next** — button, link, heading, card, section shell. Find them
   by looking for `styleSets` entries repeated across sections and captures.
3. **Then one section at a time**, top to bottom. For each: read its tree + section
   screenshot, build it, render it, compare against `screenshots/sections/<NN>-*@<bp>.png`,
   fix, move on. Never batch several sections before looking at any of them.
4. **Responsive last per section**, from `layout/responsive.json` — not guessed.
5. **Copy verbatim** from `content/copy.md`. Do not paraphrase, translate, or improve
   the original's words unless asked.

---

## Rules

- **Structure is translated, never transliterated.** The original's div nesting is an
  artifact of its framework. Reproduce the *rendered result* with the target's idioms
  and component model. A 6-deep wrapper chain that only centres content is one
  container component in the rebuild.
- **A generated class name is not a name.** `sc-12fsica-4`, `css-1x0f9k`, `_ngcontent`
  are compiler output. Name components after what they show — `SecureStorageBanner`,
  not `Sc12fsica4`.
- **Copy assets, don't hotlink.** Move files from `assets/` into the project's asset
  pipeline (or the CMS/media library). Never ship a URL pointing at the original site.
- **Don't copy the original's third-party junk.** Analytics, consent walls, chat
  widgets and ad pixels are excluded from the capture on purpose. Leave them out
  unless the user asks for a specific one.
- **Flag what you cannot reproduce.** Live pricing tickers, personalised blocks,
  A/B-test variants and logged-in state are in the capture as *rendered output*, not
  as logic. Rebuild the presentation, wire it to the project's real data source, and
  say plainly which parts are placeholder.
- **This clones layout and behaviour, not identity.** Do not reproduce another
  company's logo, wordmark, brand name, or copyright notice into a project that is
  not theirs. If the capture is a competitor's site being used as a design reference,
  rebuild the structure and swap the brand assets for the project's own — and say so.
