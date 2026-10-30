---
name: figma-scrape
description: Extract a Figma selection from a URL into a structured design bundle. Use whenever the user provides a figma.com URL with a node-id. Ask which view/screen this is, then run the extract.mjs script using $FIGMA_TOKEN from the environment — no token prompts, no Puppeteer, no Figma MCP.
---

# figma-scrape

**Ask which view, then run the script. Do not ask for tokens. Do not use the Figma MCP. Do not use Puppeteer.**

`$FIGMA_TOKEN` is already set in the user's environment. The script reads it automatically.

---

## Step 1 — Parse the URL

From a URL like:
```
https://www.figma.com/design/qJmz3q74nLuFjeFB0914b4/Mahogany-Project?node-id=412-5744
```

Extract:
- **fileKey** = `qJmz3q74nLuFjeFB0914b4`
- **project** = slugified filename segment → `mahogany` (take the part after the fileKey, strip `-Project`/`-App`/`-Design` suffixes, lowercase)

---

## Step 2 — Ask which view

Ask the user exactly this, one line:

> Qual view é essa? (ex: home, pdp, categorias, busca, carrinho, checkout, conta, onboarding, outro)

Wait for the answer. Use the answer as the `<view>` name, slugified (lowercase, hyphens). Examples: `home`, `pdp`, `categorias`, `busca`, `carrinho`, `checkout`, `conta`, `onboarding`. If the user says "outro" or something custom, use what they typed.

---

## Step 3 — Run the extraction script

```bash
node ~/.claude/skills/figma-scrape/scripts/extract.mjs \
  "<figma-url>" \
  --out "figma/<project>" \
  --name "<view>"
```

Output lands in `figma/<project>/<view>/`. Example: `figma/mahogany/home/`.

The script handles everything:
- Calls the Figma REST API with `$FIGMA_TOKEN`
- Downloads node data, styles, variables
- Exports PNG and SVG for each frame
- Extracts design tokens, text content, simplified tree
- Writes `figma/<project>/<view>/README.md`

---

## Step 4 — Check the bundle

Read `figma/<project>/<view>/README.md` — generated index with design summary.

---

## If the script fails

| Error | Fix |
|---|---|
| `Figma token required` | `echo $FIGMA_TOKEN` — if empty, run `source ~/.zshrc` first |
| `API 404` | Re-parse the URL — wrong fileKey or node-id format |
| `API 403` | Token doesn't have access to this file |
| `Variables not available` | Normal for Free plan — bundle is still complete without variables |

**Do not present options to the user. Do not ask for tokens. Fix the error and re-run.**

---

## Output structure

```
figma/
  <project>/              derived from Figma file name (e.g. mahogany)
    home/
    pdp/
    categorias/
    busca/
    carrinho/
    checkout/
    ...
      README.md           index + design summary
      node.json           raw Figma node data
      design/
        tokens.json       colors, typography, spacing, radii
        styles.json       named styles
        variables.json    variable collections (Pro/Org)
      layout/
        tree.json         simplified node tree
        frames.json       top-level frames
      content/
        copy.md           all text content
      assets/
        images/           PNG exports at 2x
        vectors/          SVG exports
        fills.json        image fill URLs
```

---

## Using the bundle

- **Tokens first** → `design/tokens.json` before writing any component
- **Structure** → `layout/tree.json` for hierarchy and auto-layout
- **Copy verbatim** → `content/copy.md` — do not paraphrase
- **Images** → `assets/images/` as pixel reference only, never ship as implementation assets
