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

## Sections become CMS content types

An Eitri storefront home is CMS-driven the same way FastStore's is. The pattern
(verify the local names — they differ per project):

1. `public/sections.json` — the schema a merchant edits, `{ name, schema }` entries
   with `title` / `description` in the project's language.
2. `public/content-types.json` — which sections each page may use.
3. `src/components/CmsComponents/<Name>.tsx` — the Luminus component.
4. The project's component map (commonly `src/utils/getMappedComponent.tsx`) —
   `content.name` → component. Unregistered sections render nothing.

So a captured section becomes: a schema entry, a component, and a map entry. Same
three-part rule as FastStore.

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
