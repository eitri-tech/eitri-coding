# Target: Eitri (Luminus + Bifrost)

Detect it by `app-config.yaml` or `eitri-app.conf.js` at the project root.

**The project's own skills outrank this file.** Invoke `eitri-coding:eitri-specialist`
first — it is mandatory in any Eitri project — then `eitri-coding:eitri-luminus` for
components and `eitri-coding:eitri-bifrost` for native APIs. Read the repo's
`.aiconfig`, which is the authoritative allowed-component list. This file only
covers what is specific to *cloning a website into* Eitri.

## Capture for a phone, not a desktop

Eitri apps are mobile-only mini-apps in a WebView. There is no desktop layout to
port. Capture accordingly:

```bash
node scrape.mjs <url> --bp 375,414 --primary 375
```

If the source site has no mobile layout worth cloning, capture the desktop as well
for content and hierarchy — but design the screens mobile-first from the 375px
capture, and say explicitly that the desktop layout was adapted rather than copied.

## Hard constraints that change how you translate

These invert the usual recreation rules, so read the tree with them in mind:

- **Luminus components only — no raw HTML tags.** A captured `<div>` becomes `View`,
  `<p>`/`<span>` become `Text`, `<img>` becomes `Image`, `<button>` becomes `Button`.
  The tree's `tag` field is a hint about *role*, never a component name.
- **No `style` prop.** Styling is Tailwind + DaisyUI through `className`. Every pixel
  value from a `styleSet` must land in a Tailwind class or the theme. Sizing props
  (`width`, `height`, `maxWidth`, `maxHeight`, `minWidth`, `minHeight`) are the
  exception — they are passed as direct props.
- **No `hover:` / `focus:` / `active:` / `focus-within:` utilities** — they stick on
  touchscreens. So most of `design/states.json` is *not* portable. Translate hover
  affordances into pressed/disabled states the platform supports, or drop them.
- **No `fetch` / `localStorage` / `navigator.*`** — Bifrost equivalents only.
- Main export is a `function` declaration; props are not destructured in the
  signature.

Check the project's `.aiconfig` and `tailwind.config.js` for the theme before
inventing token names — a DaisyUI theme is usually already defined.

## CMS sections depend on the commerce platform

An Eitri storefront home is CMS-driven, but **which CMS depends on the commerce
platform**, not on Eitri. Find the platform first — the `eitri-shopping-*-shared`
dependency in `eitri-app.conf.js` (the `eitri-coding:eitri-shopping` skill has the
full detection):

| Platform | CMS adapter |
|---|---|
| **VTEX** (`eitri-shopping-vtex-shared`) | `references/targets/eitri-vtex.md` |
| **Wake** (`eitri-shopping-wake-shared`) | not covered yet |
| **Shopify** (`eitri-shopping-shopify-shared`) | not covered yet |

For a platform without an adapter:

- **Do not apply the VTEX pattern.** Wake and Shopify apps do not read
  `public/sections.json`; a schema added there does nothing.
- **Do not silently hardcode the content either.** Read the project's own CMS service
  and component map and follow the pattern already there (in the templates: Wake →
  `src/services/CmsService.js` + `src/services/ComponentService.js`; Shopify →
  `src/services/cmsService.ts` + `src/utils/getMappedComponent.ts`).
- Tell the user this skill has no CMS adapter for that platform, and confirm where
  the section content should live before building more than one section.

Adding a platform means a new `eitri-<platform>.md` next to `eitri-vtex.md` and a row
in this table.

## Behaviour translation

- Sticky headers → the project's existing header components, not new CSS.
- Horizontal scrollers → the shared `Slider` / `CustomCarousel` primitive, never a
  hand-rolled overflow container.
- Navigation between apps → `Eitri.nativeNavigation.open({ slug, initParams })`;
  within an app → `Eitri.navigation.navigate({ path, state })`. Never an `<a href>`.
- Captured link URLs from `content/outline.json` are *intent*, not destinations —
  map each to the project's action resolver (product / category / search / landing
  page / external link).

## Verify on a device

There are no automated tests in these projects. Run `eitri app start` (add `-p` if
the installed CLI needs the playground flag), then use the `eitri-coding:eitri-device` skill's
tools — `webview_url`, `webview_dom`, `webview_console`, `screenshot` — and compare
against `screenshots/375-fullpage.png` and the per-section shots. Prefer the WebView
DOM/console commands over reading pixels.
