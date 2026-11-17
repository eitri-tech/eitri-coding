# Phase 4 agent brief

The brief for an agent that rebuilds one mini-app's screens (SKILL.md → Phase 4 → **Splitting the work**). Fill in
every `<…>` for this run, from `.eitri/plan.json`, `.eitri/screens.json`, the theme you published and the captures.
What makes a brief work is step 3: the values you already measured from the section trees. An agent that has to
find them itself spends its rounds reading captures, and returns a screen that is only roughly like the store.

```markdown
You are rebuilding <screens> of an Eitri (Luminus + Bifrost) shopping app so they look like the real store,
<store name> (<store URL>, <platform>). Repo: <repo path>. YOUR SCOPE: <mini-app folder(s)> ONLY.

## First, load the rules
Invoke the skills `eitri-coding:eitri-specialist` and `eitri-coding:eitri-luminus` before writing code, and read
the repo's `.aiconfig` (and `AGENTS.md` / `CLAUDE.md` if present). Luminus components only, Tailwind/DaisyUI
classes (no hover:/focus:/active:), `style` only for runtime values, explicit imports, code defensive against null
API data. Restyle; keep the screens' business logic (cart, checkout, login…) working.

## Already done by the lead (do not redo, do not edit)
- Theme (published): <DaisyUI slots: primary, secondary, base-100, base-content, radius, fonts>.
  Named colors usable as classes: <name → hex, one per token, including this screen's own palette>.
- Shared mini-app `<shared folder>` (imported as '<shared slug>') — DO NOT EDIT IT. What it gives you:
  <each restyled component and its props: buttons and their variants/overrides, inputs, boxes, the product card,
  header pieces and slots>. A shared change you need goes in your report.
- `eitri app start` is already running (log: `<log path>`). Never start or stop it, never push, publish or commit,
  never write to the Console. After saving, wait for your app's rebuild line in the log before rendering.

## The store (reference)
Captures: <scrape/<screen>/ for each screen> — README.md, screenshots/375-fullpage.png (crop it to view),
layout/375/*.json (section trees: boxes and style sets), content/copy.md, css/used.css.
Measured values, top to bottom (375 px):
- <section>: <sizes, colors as token names, type size/weight, radius, spacing, copy>
- …
<Anything this app has that the store page does not show (more steps, logged-in pages): say how to style it.>
Integrations to rebuild on these screens (`rebuild` in `.eitri/store-features.json`): <service, its requests in
network.json, the remote config path for its ids>. Rebuild each with `Eitri.http` from the store's own requests and
code, check it in browser-preview; one that cannot work in the app goes in your report as a gap.

## The loop (at most two fix rounds after the first render)
Render: `<commands.render from .eitri/screens.json, one per screen>`
Each writes `preview/<name>/compare/NN.png` (store | app per screen) and `report.json` (`pageErrors` must stay
empty). Run `<fidelity.mjs check … --screen <screen>>` once: a spec sheet, not a gate. Look at every tile, fix
everything you see in one batch, render again, fix what is still clearly off, final render, stop. Render once more
with `--locale en-US` (`--name <screen>-en`): no raw keys, no Portuguese interface text.

## Translations
Every interface text you add goes through `t()` with the key in both `src/locales/pt` and `src/locales/en` of your
mini-app (pt: the store's wording). Store and catalog content stays as is. Finish with `<i18n.mjs check …>`:
your mini-app with no errors.

## Report back (concise)
Files changed; final compare tile paths; what matches the store; what still differs and why; gaps (store parts
not rebuilt, and why); shared changes you need; new i18n keys; anything you changed in the app's behavior.
Do not commit.
```

Fill it per agent, not once for all: the measured values and the tokens a checkout agent needs are not the ones a
PDP agent needs. Keep the brief in your own words where this run differs (a capture taken on another host, an
order form id to render the cart with, a screen reached only through a route parameter).
