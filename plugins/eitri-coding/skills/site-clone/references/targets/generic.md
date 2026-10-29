# Target: any other framework

Next.js, Vite + React, Astro, SvelteKit, Nuxt, plain HTML — the loop in
`recreate.md` is the same. What changes is where each layer of the capture lands.

## Map the capture onto the project's existing layers

Before writing anything, find out how the project already does each of these and
follow it. Introducing a second styling system or a second component convention is
worse than a slightly lower-fidelity clone.

| Capture | Goes to |
|---|---|
| `design/tokens.json`, README scale tables | `tailwind.config.*` theme, CSS custom properties, or the project's token file |
| `design/fonts.json` + `assets/fonts/` | the project's font pipeline (`next/font`, `@font-face`, Fontsource) |
| repeated `styleSets` across sections | shared components |
| `layout/sections.json` | one component per section, composed by the page |
| `content/copy.md` | props, content collection, i18n messages, or CMS entries |
| `assets/images/` | the project's asset pipeline / image component |
| `assets/svgs.json` | an icon component or sprite |
| `design/states.json` | `:hover` / `:focus-visible` / `:active` styles |
| `layout/responsive.json` | breakpoint variants |
| `behaviors.json` | client components, transitions, carousel library |

## Decisions worth making explicitly

- **Where do the section props come from?** Hardcoded, a content collection, or a
  CMS. Ask if it isn't already established in the project — it changes every
  component's signature, and it is expensive to change later.
- **Which sections are static and which are interactive?** In an RSC-style app, keep
  `behaviors.json` entries in client components and leave the rest server-rendered.
- **Does the project have a component library already?** Rebuild with its Button and
  Card rather than new ones that merely look like the original's.

## Fidelity check

Render your build and compare against `screenshots/<bp>-fullpage.png` at every
captured breakpoint, then against the per-section shots. `snapshot.html` is the
ground truth you can open side by side with the rebuild — it is the original's
layout, running locally, with no analytics or consent walls in the way.
