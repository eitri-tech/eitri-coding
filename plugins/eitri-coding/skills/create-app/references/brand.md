# Reading the brand from a capture

Inputs for `scripts/brand-theme.mjs`, all from the site-clone capture in `scrape/home/`. Read the generated
`README.md` (it has a styleguide with the most used colors and fonts) and look at
`screenshots/375-viewport.png` before choosing.

| Flag | Where to find it | Rule of thumb |
|---|---|---|
| `--primary` | Background of the main call-to-action (buy / add to cart buttons) — `design/tokens.json` and the button's style set in the header or product sections | The brand's strongest color. Not black or white unless the brand really is monochrome. |
| `--primary-content` | The text color *on* that call-to-action (its style set's `color`) | Pass it: without it the script picks white or dark by contrast alone, which can turn the store's white-on-color buttons dark. |
| `--secondary` | A second brand color: badges, prices, secondary buttons | Omit if the site has one brand color (defaults to primary). |
| `--secondary-content` | The text color on the secondary color | Same as `--primary-content`. |
| `--background` | `body` / main background | Usually `#ffffff`; keep the site's off-white if it has one. |
| `--text` | Body text color | Omit to let the script pick readable text for the background. |
| `--radius` | `border-radius` of buttons and cards (`css/used.css`) | `0rem` for square brands; the Console's scale is built around it. |
| `--font-primary` / `--font-main` + `--font-faces` | `design/fonts.json` → `usage` (families by element count, with sizes and weights) | `--font-primary`: the text/UI family (most elements); `--font-main`: the heading family, if different. Get their files with `scripts/font-faces.mjs "Family:200,400,600,700" …` (Google Fonts → `@font-face` rules with absolute woff2 URLs, `latin` subset) into `--font-faces`. Check `fontFaces`/`files`: a family the site *declares* but never loads (no `@font-face`, no Google Fonts link) is what its designers intended, but the site itself renders a fallback — say so. A self-hosted custom font: its files must be on a public https URL (not bundled in a mini-app); otherwise pass only the families and tell the user. |
| `--repo .` + `--color <name>=<color>` | `--repo` lists the theme colors the template's classes use beyond Tailwind and DaisyUI (the VTEX template's header: `bg-header-background`, `text-header-content`, also the cart badge) | Always pass `--repo .`. Give a `--color` for each name the app shows, from the capture (header background and icon color first); they go to `theme.extend.colors`. Undefined, a background/border in that color renders nothing (a transparent header) and a text in it takes the inherited color. Read each class site before defining a name: a template that pairs `bg-x` with `text-x` turns unreadable once `x` exists — leave such a name undefined and say so. |
| `--font` + `--font-import` | — | Legacy single-font form (`@import` + body font). Prefer the pair above. |

Fix every contrast warning the script prints and run it again: each one names the nearest shade of that color that passes with the same text color — use it (the store keeps its look: same hue, same text color), or drop the `-content` flag to let the script pick the text color. Say which in the confirmation summary.

Where each output goes:

- `v2` → `create_theme` `content`, then `publish_theme` (Console: Design System → Luminus V2.x; the components'
  DaisyUI colors and radius).
- `v1Css` → `create_global_css` `css`, then `publish_global_css` (Console: Design System → Luminus V1.x; fonts and
  body — fonts go through V1.x even on Luminus v2 apps). It is the intimissimi shape: `@font-face` per family and
  weight, `.font-primary` (text) and `.font-main` (headings) classes, and the text font on `body` so screens that use
  no class still get it. Use `font-main` on titles when you rebuild sections. manager-api inlines this CSS into every
  mini-app's `index.html` at publish, so `url()`s must be absolute: a relative one resolves against each mini-app's own
  folder (production apps have shipped fonts that 403 this way).
- The repo's `tailwind.config.js` theme (when the template has one) should match `v2` so `eitri app start` looks like
  the published app.

## Header logo

`appConfigs.headerLogo` is a URL the app loads at runtime. Use the store's own logo file on its CDN (the `<img>` or inline
SVG in the header section of the capture; `assets/images.json` lists the downloaded files with their source URLs).
Prefer the horizontal wordmark on a transparent background. An inline SVG has no URL: say so and leave it empty.
