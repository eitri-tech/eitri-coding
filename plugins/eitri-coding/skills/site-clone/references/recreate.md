# The recreation loop

The capture is evidence, not a plan. This is how you turn one into the other.

## 0. Inventory before you build

Read, in this order, once:

1. `README.md` — scale tables, fonts, section list, behaviour summary.
2. `screenshots/<primary>-fullpage.png` — the target.
3. `layout/sections.json` — the section list you will work through.
4. `behaviors.json` — what has to move, stick, or open.

Then write a short build plan: the token set, the shared primitives, and the
section-to-component mapping. Show it to the user before writing code if the page
is large (more than ~8 sections) or if the mapping is not obvious.

**Look for repeats across captures.** If you captured home + PLP + PDP, the header,
footer, product card and section shell appear in all three. Those are components.
A block that appears once is a page section, not a component — don't over-abstract it.

## 1. Tokens

From `design/tokens.json` and the README frequency tables, derive:

- **Colour** — text, background, border, and interactive colours. The frequency
  tables rank by usage: the top 2–3 text colours and top 2–3 backgrounds are the
  real palette; the long tail is usually one-off states. Cross-check the accents
  against `design/states.json` (hover colours often reveal the true brand ramp).
- **Type** — family, size, weight, line-height, letter-spacing. `README.md`'s
  "Typography by tag" is the honest starting scale. Collapse near-duplicates
  (`15px` and `15.008px` are one size) — but only near-duplicates. If the original
  really does use 13/15/18/26/35, keep five sizes; don't round them into a tidy
  scale the design never had.
- **Space** — the gap / padding tables. Most sites cluster on a base unit; find it,
  and express spacing as multiples where the values genuinely fit. Where they don't,
  keep the literal value.
- **Radius, shadow, border** — usually a handful of values. All of them are tokens.

If `tokens.json` has CSS custom properties, prefer those names — the original team
already named their design system, and matching their names makes later diffs
against the source trivial.

## 2. Primitives

Build the repeated pieces before any section:

- section shell (max-width, horizontal padding, vertical rhythm — read it off the
  outermost `styleSets` entry of several sections; it is almost always identical)
- button variants (primary / secondary / ghost) — geometry from the tree, states
  from `design/states.json`
- link, heading levels, body text
- card / tile, if the page repeats one
- icon component fed from `assets/svgs.json` (it is deduplicated and ranked by use;
  the top entries are the icon set)

## 3. Sections, one at a time

For each entry in `layout/sections.json`:

1. Open `screenshots/sections/<NN>-<name>@<primary>.png` and the mobile one.
2. Read `layout/<primary>/<NN>-<name>.json`. Work outside-in: the root box gives you
   the band (background, vertical padding, min-height); the next level gives the
   container (max-width, side margins); below that is the actual content layout
   (`display`, `gap`, `gridTemplateColumns`, counts of repeated `s` indices).
3. Pull the copy from `content/copy.md` for that section — verbatim.
4. Pull images from `assets/images.json` (each entry records where it came from).
5. Build it with the target's components.
6. Render it and compare against the section screenshot. Fix the differences you
   can see, then the ones you can measure.
7. Apply `layout/responsive.json` for that section's paths.

**Do not batch.** Building five sections and then looking at them costs more than
building one and looking at it, every time.

## 4. Behaviour

Wire the interactions from `behaviors.json` plus your MCP probing notes:

- `pinned` → sticky/fixed positioning with the recorded offsets and z-index
- `horizontalScrollers` → the target's carousel primitive; match item count per
  view, peek, and snap behaviour
- `disclosure` → accordions and tabs, with the same default-open state
- `animated` → transitions, with the recorded duration and easing. Transitions are
  cheap fidelity: a rebuild with the right colours but no transitions reads as
  obviously fake.
- `forms` → the project's real form handling, never the original's action URL

## 5. Verify

Fidelity bar, in order of importance:

1. **Section order and vertical rhythm** — the page reads the same top to bottom.
2. **Layout** — same columns, same wrapping, same alignment at every captured breakpoint.
3. **Type and colour** — through tokens, not literals.
4. **Spacing** — within a few pixels; exact where the tree gives an exact value.
5. **States and motion** — hover, focus, active, transitions.
6. **Copy and assets** — verbatim, and served from the project.

Verify by screenshot comparison at every captured breakpoint — your build next to
`screenshots/<bp>-fullpage.png`:

```bash
node <skill-dir>/scripts/shot.mjs http://localhost:3000 build.png --bp 375
```

`shot.mjs` uses the same emulation the capture did, so the two screenshots are
directly comparable; it also reports horizontal overflow and console errors. The
Playwright MCP or the project's own run skill work too — just make sure the
viewport and mobile emulation match the capture, or the comparison lies. Reporting "done" without having looked at the rebuild rendered at
each breakpoint is not done.

## What not to carry over

- generated class names, wrapper divs that only exist to satisfy the original's CSS,
  and its component boundaries
- analytics, consent, chat, ad and A/B-test code
- inline styles that duplicate what a token already expresses
- absolute URLs pointing back at the original site
- brand identity — logo, wordmark, brand colours-as-identity, legal text — when the
  rebuild is not for that brand

## When the capture is not enough

Say so, and name the gap. Common ones:

- **Content behind auth or personalisation** — rebuild the shell, wire it to the
  project's data, mark the content as placeholder.
- **Canvas / WebGL / video-driven sections** — the capture holds a screenshot and
  nothing else. Reproduce the layout around it and agree a substitute with the user.
- **Server-driven layout (CMS)** — if the target project is CMS-driven (FastStore
  or Eitri both are), the sections are *content types*, not hardcoded markup. Model
  the schema first; see the target adapter.
