# Target: FastStore (VTEX)

Detect it by `discovery.config.js`, `faststore.config.js`, or `@faststore/core` in
`package.json`. Verified against a real FastStore 3.x storefront; check the local
project before trusting any specific path.

## The shape you are rebuilding into

FastStore pages are **CMS-composed**, not hardcoded. A page is an ordered list of
sections, each backed by a JSON schema. So a capture's `layout/sections.json` maps
almost one-to-one onto FastStore sections — which is why the section split is worth
getting right before you write code.

Three things have to line up for a section to exist:

1. **`cms/faststore/sections.json`** — an array of `{ name, schema }`. The schema is
   JSON Schema and drives the fields merchants edit in the VTEX Headless CMS.
2. **`src/components/<Name>/<Name>.tsx`** — the React component, receiving the schema
   properties as props.
3. **`src/components/index.tsx`** — the name → component map. A section missing here
   renders nothing, with no error. This is the single most common mistake.

`cms/faststore/content-types.json` declares which sections a page type may use.

## Order of work

1. **Theme before components.** FastStore themes are SCSS custom properties in
   `src/themes/*.scss` (`--fs-color-*`, `--fs-text-size-*`, `--fs-spacing-*`,
   `--fs-border-radius-*`). Map `design/tokens.json` and the README scale tables onto
   the `--fs-*` names first. The theme in use is named in `discovery.config.js`
   (`theme: '<name>'`) and loaded from `src/themes/<name>.scss`.
   Tailwind may also be present — check `package.json` and whether existing
   components use `className` utilities before picking a styling approach. Match the
   components already in the repo; don't introduce a second styling system.
2. **Overridable FastStore components before custom ones.** Header, Footer,
   ProductCard, ProductGallery and friends already exist in `@faststore/core` and can
   be overridden. Look for an existing override in `src/components/` before building
   a section from scratch — the captured header is almost always the existing Header
   restyled, not a new component.
3. **One capture section → one FastStore section**, unless the capture over-split
   (a carousel's arrows captured as their own block, say). Merge those.
4. **Register in `index.tsx` immediately** after creating each component, at the
   `// NEW_COMPONENT_MAP` marker if the project uses one.

## Writing the schema

Every piece of the section a merchant would plausibly change becomes a schema
property. Read them straight off the capture:

- text from `content/copy.md` → `string` properties, with the captured copy as `default`
- images from `assets/images.json` → `string` with the project's media widget
- links from `content/outline.json` → `string`, or an action object if the project
  already has one
- repeated blocks (cards, slides, columns — the nodes sharing an `s` index in the
  tree) → `array` of `object`, with `minItems` where the layout demands it

Keep property names in the language the rest of `sections.json` uses. Give every
property a `title`, and a `description` when a merchant could misread it.

## Data, not decoration

A captured shelf is a rendered result. In FastStore, the products come from VTEX
Intelligent Search through the project's existing shelf components and hooks — never
from copied markup. Rebuild the *presentation* of the shelf and feed it the real
query. Same for prices, availability, and search.

## Verify

`yarn dev` (or the project's script), then screenshot each route and compare against
`screenshots/<bp>-fullpage.png` at every captured breakpoint. Populate the CMS
locally with the captured defaults so the page renders with the original's content,
not with empty schema defaults.
