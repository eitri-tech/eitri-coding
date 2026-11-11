# Target: Eitri + VTEX — CMS sections

Read `eitri.md` first; this file only covers how captured sections become CMS
content in an Eitri app backed by **VTEX**. It does not apply to Wake or Shopify
apps — they use a different CMS (see `eitri.md` → "CMS sections").

Detect it by `eitri-shopping-vtex-shared` in the app's `eitri-app.conf.js`, or a
`public/sections.json` next to a CMS service calling `Vtex.cms.getPagesByContentTypes`.

## Same CMS as FastStore

The home (and landing pages) are pages in the **VTEX Headless CMS** — the same CMS a
FastStore storefront uses. The app fetches them with
`Vtex.cms.getPagesByContentTypes(Vtex.configs.faststore, contentType, …)` and renders
each section through a component map. So the schema rules in `faststore.md` →
"Writing the schema" apply here unchanged: every piece a merchant would change is a
schema property, captured copy goes in as `default`, repeated blocks become arrays.

The pattern (verify the local names — they differ per project):

1. `public/sections.json` — the schema a merchant edits, `{ name, requiredScopes, schema }`
   entries with `title` / `description` in the project's language.
2. `public/content-types.json` — which sections each page type may use.
3. `src/components/CmsComponents/<Name>/<Name>.jsx|tsx` — the Luminus component. It
   receives the section's fields as `props.data`.
4. The component map (commonly `src/utils/getMappedComponent.js|tsx`) —
   `content.name` → component. Unregistered sections render nothing, with no error.

So a captured section becomes: a schema entry, a component, and a map entry. Same
rule as FastStore.

## Reuse before you add

The VTEX template already ships sections like `MultipleImageBanner`, `ProductShelf`,
`CategoryListSwipe`, `CategoryTree` and `RichText`. A captured hero carousel or banner
grid is usually an existing section with a different mode or new fields — extend it
before creating a new one. Read `sections.json` and the component map first.

## Fields that have a house shape

- **Images** — `string` with `"widget": { "ui:widget": "media-gallery" }`, so the
  merchant uploads to VTEX. Upload the captured images there; never ship a URL
  pointing at the original site.
- **Links** — reuse the `action` object already defined in `sections.json` (product,
  category, collection, search, landing page, external link). It is resolved by the
  project's action handler (commonly `src/services/ResolveCmsActions.js`); map each
  captured URL from `content/outline.json` to one of those action types. A FastStore
  product URL is `/<linkText>-<skuId>/p`: its path segment is not a slug the catalog knows —
  map it to a product action by product id (the catalog's `fq=skuId:<skuId>` answers it).
- **Shelves** — the schema holds the *query* (collection, category, sort, limit),
  never product data. Products come from VTEX search through the existing shelf
  components.
