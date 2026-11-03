---
name: figma-to-eitri
description: Port a Figma design into an Eitri-App — from a figma-scrape bundle at figma/<project>/<view>/ or from a local `.fig` file (Figma → File → Save local copy), which is converted to the same bundle offline. Use whenever the user wants to implement a Figma screen, section or component in an Eitri project, or hands over a `.fig` file to port. Detects how the project wires CMS content (file-based `_cms/sections.json`, a CMS reached through MCP tools, or no CMS), follows the project's own conventions, splits screens into blocks, handles state variants, maps design variables to the theme, and validates the result on device.
---

# figma-to-eitri

Turn a Figma design into Eitri components that follow **the target project's** conventions. The bundle tells you what to build; the project tells you how.

**Precedence when rules conflict:** the project's `AGENTS.md` / `CLAUDE.md` → the `eitri-specialist` skill (and `eitri-luminus` / `eitri-bifrost`) → this skill. This skill only covers reading the design and mapping it; it never overrides how the project writes code.

```
Step 0  detect the project          → CMS mode, language, conventions
Step 1  get the bundle (+ PNGs)     → figma/<project>/<view>/
Step 2  screen, states, rules       → state matrix + requirements
Step 3  split into blocks           → block plan, confirmed by the user
Step 4  fields and behavior         → schema, visibility, CTAs → real routes
Step 5  theme                       → variables ↔ theme tokens
Step 6  generate                    → per CMS mode
Step 7  verify                      → static checks + device, per state
```

---

## Step 0 — Detect the project

Do this before reading the design. Generation that ignores the project's architecture gets thrown away.

1. Read `AGENTS.md`, `CLAUDE.md` and any contributing docs at the workspace root and in the target app. Note hard rules (e.g. "never edit CMS data outside its MCP", "every import is explicit", "no hex colors").
2. Invoke `eitri-specialist` if it is not loaded yet.
3. Find how CMS content reaches the screen and pick **one mode**:

| Signal | Mode |
|---|---|
| `_cms/sections.json` + a component map (`getMappedComponent.*`, `componentMap`) | **file** — schema entries live in the repo |
| CMS tools available as MCP tools (names like `mcp__*CMS*`, `create…Components`, `update…ContentTypes`) and/or docs saying the CMS is edited through them | **MCP** — schemas and content live in the CMS; never write them as files |
| Neither | **components only** — build the UI with props; no schema |

4. Read **one existing CMS-driven component end to end** (schema/definition → render map → component) and copy its patterns: file extension (`.jsx`/`.tsx`), the key the render map uses to pick a component (`name`, `blockType`, …), how props arrive, the action/navigation helper, how images and optional colors are handled, and where shared components live.
5. List the routes/screens and data helpers the project already has (navigation helpers, date utilities, shared libraries). CTAs and computed data must reuse them (Step 4).

Tell the user which mode you detected and the conventions you will follow, in two or three lines, then continue.

---

## Step 1 — Get the bundle

Ask if not obvious from context:

> Qual bundle usar? (ex: `figma/<projeto>/home`) — ou qual arquivo `.fig`?

### From a `.fig` file

A `.fig` holds the whole Figma file (every page, the libraries' variables and styles, the original images). Convert it first — offline, no token:

```bash
FIG=~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/figma-scrape/scripts/fig-extract.mjs

# 1. pages → sections → frames, with ids and sizes
node $FIG "<file.fig>" --list

# 2. extract a screen (id from the listing; names repeat, ids don't)
node $FIG "<file.fig>" --node <id> --out figma/<project> --name <view>
```

Pick **screen frames** (phone-sized `FRAME`s), not the `SECTION` grouping them. Extract every state variant of the screen you are porting (Step 2), each with its own `--name`.

**PNG renders are mandatory for `.fig` sources.** The tree misses things only pixels show (masks, effects, image crops, layering). Before generating, ask:

> Exporta do Figma os frames `<ids>` em PNG 2× e salva em `figma/<project>/<view>/assets/images/<id>.png`?

Wait for them. Read each PNG before Step 3.

`.fig` bundle differences:

| Path | Contents |
|---|---|
| `assets/images/` | Only `file-thumbnail.png` until the user adds the PNG exports |
| `assets/fills/` + `assets/fills.json` | Original image files, keyed by image ref, with the nodes that use each |
| `assets/vectors/` | Icons and vector glyphs rebuilt as SVG, deduplicated; tree nodes point at them via `svg` |
| `design/variables.json` | Variables resolved per mode, with `aliasOf` (semantic → core) and designer descriptions |
| `design/styles.json` | Text/fill styles with resolved values |
| `README.md` → Warnings | Vectors that could not be exported — check them in the PNG |

### Bundle files

Read `README.md`, `layout/tree.json`, `design/tokens.json`, `design/variables.json`, `content/copy.md`, and the PNGs in `assets/images/`.

### Reading `layout/tree.json`

| Field | Meaning → Eitri |
|---|---|
| `layout.mode` `HORIZONTAL`/`VERTICAL` | `flex flex-row` / `flex flex-col`; `gap` → `gap-*`; `padding` is `[top, right, bottom, left]` |
| `layout.align` (main axis) | `MIN` → `justify-start`, `CENTER` → `justify-center`, `MAX` → `justify-end`, `SPACE_BETWEEN` → `justify-between` |
| `layout.crossAlign` | `MIN` → `items-start`, `CENTER` → `items-center`, `MAX` → `items-end`, `BASELINE` → `items-baseline` |
| `sizing` `[horizontal, vertical]` | `FILL` → `w-full`/`flex-1` (main axis) or `self-stretch` (cross axis); `HUG` → no size; `FIXED` → size from `box` |
| `box` / `rel` | Absolute `[x, y, w, h]` on the canvas / `[x, y]` relative to the extracted frame — use `rel` for vertical bands |
| `overlaps` | Sibling ids this node intersects. Siblings paint in array order: later ones are on top |
| `absolute: true` | Positioned outside auto-layout |
| `fill` / `fillVar` | Hex color / design variable bound to it — map the variable to a theme token (Step 5) |
| `radius` | Number, or `[tl, tr, br, bl]`; `9999` means fully rounded |
| `shadow` / `stroke` | CSS box-shadow strings / `{ color, weight, var }` |
| `image` `{ ref }` | Image fill — CMS image field; original file via `assets/fills.json` |
| `svg` | Icon/vector already exported — use the file, don't rebuild it from children |
| `font` / `runs` | Text style; `runs` lists mixed-style spans (bold word, colored price) |
| `component` | Design-system component the instance comes from. Trust the SVG/PNG over the name — library names can be stale |
| `styleRefs` / `vars` | Named text/fill style; variables bound to fields (`STACK_SPACING`, `CORNER_RADIUS`, …) |
| `hidden: true` | Off in the design — usually an alternative state, not something to render |

---

## Step 2 — Screen, states and rules

1. **State variants.** Frames that are the same screen in different situations (logged out, empty, filled, campaign, pending/done…) are states, not separate screens. Build a matrix:

   | Block | State A | State B | State C |
   |---|---|---|---|
   | Greeting | ✓ | ✓ | ✓ |
   | Onboarding banner | ✓ | — | — |

2. **Annotations.** Loose `TEXT` nodes next to the frames (inside the `SECTION`, outside the phone frame) are designer notes. Turn each into an explicit requirement in your plan. For every configurable value in them (a day, a limit, a period), ask: *does this come from the CMS, from user data, or is it fixed?*
3. **Done criteria.** For interactive blocks (tasks, check-ins, forms), derive from the design what the user must do for the block to change state — the CTAs shown in each state frame are the spec. Confirm with the user when the design and the annotations disagree.

---

## Step 3 — Split into blocks

Top-level children of a screen are rarely sections: they include loose background rectangles, decorations, status bars and native navigation.

1. **Drop native chrome** by default and list what you dropped: status bar (time, signal, battery), native tab bar / bottom navigation, native header and home indicator. Ask if unsure whether a header is native or part of the page.
2. **Group by vertical band** using `rel` and `overlaps`: a background shape plus the texts/images on top of it form one block. Decorations crossing several bands (`overlaps` with nodes of two blocks) belong to the page layout, not to one block — note their z-order.
3. **Reuse before creating.** If a block matches an existing CMS component or shared component, reuse or extend it.
4. **Propose the plan and wait for confirmation:**

   | # | Block | Y range | Content | States | New / reuse |
   |---|---|---|---|---|---|

---

## Step 4 — Fields and behavior

Infer editable fields per block:

| Figma node signal | Field |
|---|---|
| Single text node | string — title, subtitle, label |
| Repeated sibling frames (cards, slides, items) | array whose items match one frame's fields |
| Node with image fill | image URL using the project's media widget |
| Button / CTA node | the project's action shape (Step 0) |
| Rich / long text | rich-text widget if the project has one |
| Vector / icon (`svg`) | hardcoded in the component — not a field |

Only expose what the store operator needs to change. Layout and spacing are implementation details.

- **Visibility by state.** Blocks that appear only in some states get a visibility field (e.g. an audience/state enum) filtered at render time, instead of duplicated sections per state.
- **CTAs → real navigation.** Map each CTA in the design to an existing route or helper found in Step 0. Use a generic action field only when the destination is meant to be editable in the CMS.
- **Computed data** (week counters, progress, dates, prices) must come from the helper the project already uses elsewhere, so the same number shows the same everywhere.

---

## Step 5 — Theme

1. Read `design/variables.json` and the project's theme (Tailwind/DaisyUI config, Luminus theme). Build a table:

   | Figma variable | Value | Theme token | Status |
   |---|---|---|---|
   | `semantic/btn-primary-bg` | `#1f6feb` | `primary` | exists |
   | `color/accent/700` | `#3a7d44` | — | missing |

2. Missing colors become theme tokens before any component uses them, following *Colors* and *Theme* in `eitri-specialist` (sync → edit → create → publish with confirmation, then restart the dev server). Name new tokens after the Figma variable's scale (`accent-700`), not after the screen.
3. Fonts in `tokens.json` must already be loaded by the app (Theme CSS in the Eitri Console); if one isn't, give the user the snippet instead of importing it in a component.

---

## Step 6 — Generate

### Component rules

Follow `eitri-specialist` and `eitri-luminus` (imports, colors, `style` only for runtime values, icons, sizing props, *Silent pitfalls*) and the component you read in Step 0. What is specific to porting a design:

- **Tappable texts and links** from the design (`ver mais`, `editar`) go in a `View onClick` — `Text` drops the handler.
- **Decorations with `overlaps`** that sit behind neighboring blocks: layer them as in *Silent pitfalls* (no negative z-index).
- **Shared components that look different in the design** (header, tab bar, cards from a shared lib) get a caller-controlled prop and a new version — not an override in the screen.
- **Icons** from `assets/vectors/`: first look for the same icon in `react-icons` or the project's icon components; otherwise the SVG becomes a new icon component.
- **Dates and numbers** in the design are formatted with the project's helper or `dayjs`, never bare `toLocale*`.
- Use the copy from `content/copy.md` verbatim.

### Mode: file (`_cms/sections.json`)

1. **Schema entry** per block in `_cms/sections.json`, using the same structure, widgets and action schema as existing entries. Titles and descriptions in Portuguese. If a name already exists, suffix it with the view name.
2. **Component** at the path existing CMS components use, with the extension they use. Props names must match `schema.properties` keys exactly.
3. **Register** in the component map using the same key field the map already uses.
4. **Preview data:** only if there is no way to publish content for the developer to see it. Add mock entries the way the project already does (or prepend to the content list), marked `// TODO: remover após validação`. Images: `placehold.co/<W>x<H>` with the node's size, or the bundle's export URLs (they expire).

### Mode: MCP (CMS reached through tools)

Publishing through these tools is **live** — for a production tenant it is immediately visible to users. Before each write, tell the user what will change and get confirmation.

1. Read existing component definitions and content types to mirror their schema conventions.
2. Create the component definitions, then add them to the allowed sections of the content type, then add the blocks to the content.
3. **Read the whole content document before updating it.** Updates usually replace the sections array entirely — send the full list with your blocks inserted, never only the new ones.
4. **Images:** upload the original from `assets/fills/` (resized/compressed to a sensible size) or use the asset already in the CMS media library. Read the full media document to get its public URL — partial `select` projections can omit path parts — and check that the URL answers 200 before saving it. When the CMS asset differs from the Figma one (different crop or version), tell the user.
5. Don't add mocks to the render code — publish real content instead.

### Mode: components only

Build the components with typed props and a usage example in the screen. No schema.

---

## Step 7 — Verify

**Static checks**
- Every block in the plan exists; render-map keys match the definition names.
- Props names match schema fields; hidden-in-design nodes are not rendered.
- No rule from `AGENTS.md` / `eitri-specialist` broken (imports, colors, HTML tags, `style`, hover utilities).

**On device** — use the `eitri-device` skill:
1. Confirm which WebView/screen is in front before reloading or capturing — the user may have switched tabs.
2. Screenshot **every state** from the Step 2 matrix (logged out included) and read `webview_console --errors` in each.
3. Tap **every CTA** and confirm it reaches the intended screen.
4. Compare each screenshot side by side with the PNG export and list remaining differences.

**Report to the user**
- What was published (CMS components, content, theme) — it is already live.
- Versions bumped, if the project versions apps/shared libraries.
- Open questions (annotation rules, configurable values, differing assets) and remaining visual differences.
