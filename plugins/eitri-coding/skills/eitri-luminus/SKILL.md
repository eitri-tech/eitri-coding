---
name: eitri-luminus
description: Reference and authoring guide for the eitri-luminus UI library — Eitri's React + TypeScript + Tailwind + DaisyUI component system used to build native mobile interfaces compiled by Forge and rendered in Eitri-Play. ALWAYS invoke this skill whenever the user asks about Luminus UI components, props, imports, or correct usage; whenever the user is writing/editing JSX that imports from `eitri-luminus`; whenever the user asks "which Luminus component should I use for X?"; or whenever a question requires consulting the official Luminus docs at https://cdn.83io.com.br/library/luminus-ui/doc/latest/. Also use when reviewing Eitri view code for Luminus-correctness (no raw HTML tags, valid component names, valid props, sizing as direct props, Tailwind/DaisyUI classes via `className`).
allowed-tools: Read, Grep, Glob, Write, Edit, WebFetch
---

# SKILL.md — eitri-luminus

Authoring + reference skill for **Luminus UI** (`eitri-luminus`), the component library used inside every Eitri project. This skill is the source of truth for *what components exist*, *how to import them*, *which props they accept*, and *which rules must be followed* when writing Luminus code. For deep API questions, fall back to the official docs (see **Live docs** below).

## When to use

Trigger automatically when any of these are true:

- The user asks about a Luminus component, prop, or category ("how do I use `Card`?", "what's the prop for full-width Button?", "is there a `Stories` component?").
- The user is editing/creating files that import from `eitri-luminus`.
- The user asks for a component recommendation for a UI need (form, list, modal, hero, etc.).
- A code review involves Luminus correctness (no raw HTML, valid component names, sizing via props, etc.).
- The user explicitly mentions Luminus, Forge, or Eitri-Play in a UI context.

This skill **complements** `eitri-coding` (which governs the whole Eitri project) and `eitri-claude-design-migrate` (which handles Claude Design ports). When all three could apply, follow `eitri-coding` for project-wide rules and use this skill as the component reference.

---

## Live docs

Always treat the official docs as the authoritative reference for prop signatures and edge cases:

- **Root:** https://cdn.83io.com.br/library/luminus-ui/doc/latest/
- **Components index:** https://cdn.83io.com.br/library/luminus-ui/doc/latest/components/
- Per-component pages: `?path=/docs/components-<category>-<name>--docs` (e.g. `components-basic-view--docs`, `components-input-button--docs`).

When in doubt about a prop, default value, or signature, **`WebFetch` the relevant component page** rather than guessing. Cite the page back to the user when answering.

---

## Stack & runtime

| Layer | Tech |
|---|---|
| Component layer | React + TypeScript |
| Styling | Tailwind CSS 3.4.4 |
| Component primitives | DaisyUI 4.12.2 |
| Compiler | Forge (server-side) |
| Runtime | Eitri-Play (Android/iOS device or simulator) |

Forge transforms the React/Tailwind source into a native mobile interface — so the JSX you write is **not** running in a browser. Browser-only primitives (`window` access, raw DOM APIs, CSS that depends on browser layout quirks) are not safe.

---

## Hard rules (non-negotiable)

1. **No raw HTML tags.** `div`, `span`, `p`, `img`, `button`, `input`, `a`, `ul`, `li`, `h1..h6`, `section`, `header`, `footer`, etc. are **forbidden**. Use the Luminus equivalent.
2. **Imports come from `eitri-luminus` only.**
   ```jsx
   import { View, Text, Button, Card } from 'eitri-luminus'
   ```
3. **Sizing props are first-class props, not styles.** Use `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight` directly on the component:
   ```jsx
   <View width="100%" maxWidth={420} height="auto">…</View>
   ```
4. **Styling uses `className` with Tailwind / DaisyUI utilities.** Do not write raw `style={{}}` unless a Tailwind utility truly cannot express it.
5. **Text always lives inside `<Text>`** (or a component that itself renders text, like `Button`). Never put bare strings inside layout components like `View` directly when avoidable.
6. **Pages are routed file-based** under `src/views/` (governed by `eitri-coding`); each page wraps its content in `<Page>`.

If a user-supplied snippet violates any of these, fix it as part of the answer.

---

## Component catalogue

Categories and component names mirror the official docs. Use this as a quick lookup; consult per-component pages for full prop tables.

### Basic
`View`, `Text`, `Image`, `Video`, `Markdown`, `Page`

- `Page` — top-level container for a route under `src/views/`.
- `View` — generic flex container; replaces `div`. Accepts sizing props + `className`.
- `Text` — replaces `p`/`span`/headings; size/weight via Tailwind utilities (`text-lg`, `font-semibold`).
- `Image` — replaces `img`; supports `src`, `alt`, sizing props.
- `Video` — video playback.
- `Markdown` — renders markdown content.

### Display
`Accordion`, `Avatar`, `Badge`, `Card`, `Carousel`, `Swiper`, `Chat`, `Collapse`, `Countdown`, `Lottie`, `Stats`, `Tab`, `Timeline`, `Diff`, `Kbd`, `List`, `Code`

### Input
`Button`, `Checkbox`, `Dropdown`, `OTPInput`, `PullToAction`, `Radio`, `Range`, `Rating`, `Select`, `TextInput`, `Textarea`, `Toggle`, `Swap`, `FileInput`, `FormControl`

- `Button` — replaces `button`; DaisyUI variants via `className` (`btn-primary`, `btn-outline`, `btn-block`).
- `TextInput` / `Textarea` — replace `input[type=text]` / `textarea`.
- `FormControl` — wraps a labelled input group.
- `OTPInput` — one-time-password input (auth flows).
- `PullToAction` — pull-to-refresh affordance.

### Feedback
`Alert`, `Loading`, `Progress`, `Skeleton`, `Toast`, `Tooltip`

### Layout
`Hero`, `Stack`, `Divider`, `Artboard`, `Indicator`, `Mask`, `Stories`

- `Stack` — layered/stacked layout.
- `Hero` — banner-style top section.
- `Stories` — story-carousel pattern (Instagram-like).
- `Artboard` — fixed mobile artboard frame.

### Navigation
`Breadcrumbs`, `Modal`, `Steps`

### Others
`HTMLRenderer`, `Webview`, `QRCode`, `Fullscreen`

> If a component you need is **not** in this list, fetch the components index before assuming it doesn't exist — the library evolves. URL: `https://cdn.83io.com.br/library/luminus-ui/doc/latest/components/`.

---

## HTML → Luminus mapping (cheat sheet)

| Raw HTML | Use |
|---|---|
| `<div>` | `<View>` |
| `<span>` / `<p>` / `<h1..h6>` | `<Text>` (with Tailwind size/weight utilities) |
| `<img>` | `<Image>` |
| `<button>` | `<Button>` |
| `<input type="text">` | `<TextInput>` |
| `<textarea>` | `<Textarea>` |
| `<select>` | `<Select>` |
| `<a>` (in-app navigation) | Bifrost navigation API (see `eitri-coding`) — not an HTML anchor |
| `<ul>` / `<ol>` + `<li>` | `<List>` or `<View>` + mapped `<View>`/`<Text>` rows |
| `<hr>` | `<Divider>` |
| `<section>` / `<header>` / `<footer>` | `<View>` with semantic className |

---

## Canonical examples

### Page skeleton

```jsx
import { Page, View, Text, Button } from 'eitri-luminus'

export default function Home() {
  return (
    <Page className="bg-base-100">
      <View className="flex flex-col gap-4 p-4">
        <Text className="text-2xl font-bold">Welcome</Text>
        <Text className="text-base-content/70">Sign in to continue.</Text>
        <Button className="btn-primary btn-block" onClick={() => {}}>
          Continue
        </Button>
      </View>
    </Page>
  )
}
```

### Card with image + actions

```jsx
import { Card, View, Text, Image, Button } from 'eitri-luminus'

<Card className="bg-base-100 shadow-md">
  <Image src={item.thumb} alt={item.title} width="100%" height={180} className="object-cover" />
  <View className="p-4 flex flex-col gap-2">
    <Text className="text-lg font-semibold">{item.title}</Text>
    <Text className="text-sm text-base-content/60">{item.subtitle}</Text>
    <Button className="btn-primary btn-sm self-start" onClick={onOpen}>Open</Button>
  </View>
</Card>
```

### Form group

```jsx
import { FormControl, TextInput, Button, View } from 'eitri-luminus'

<View className="flex flex-col gap-3 p-4">
  <FormControl label="Email">
    <TextInput value={email} onChange={setEmail} placeholder="you@example.com" />
  </FormControl>
  <FormControl label="Password">
    <TextInput type="password" value={pwd} onChange={setPwd} />
  </FormControl>
  <Button className="btn-primary btn-block" onClick={submit}>Sign in</Button>
</View>
```

---

## Authoring workflow

When asked to write or edit Luminus code:

1. **Identify the screen/feature** — translate the requirement into a small component tree.
2. **Pick components from the catalogue.** Prefer the most specific component (e.g. `Card` over `View`+manual styling for grouped content; `Stories` over a custom carousel).
3. **Use Tailwind + DaisyUI classes via `className`.** Reach for sizing props for width/height. Avoid `style={{}}`.
4. **Wrap routed screens in `<Page>`.**
5. **No raw HTML — verify before finishing.** Quickly grep your own output for `<div`, `<span`, `<img`, `<button`, `<input`, `<p ` / `<p>`, `<h1`..`<h6` and replace.
6. **For unknowns, `WebFetch` the component's docs page** and cite it.

When reviewing existing code, run the same checklist plus: confirm sizing isn't being done via `style={{ width: ... }}`, and confirm DaisyUI utility class names match v4.12.2 (e.g. `btn-primary`, not `button-primary`).

---

## When the docs disagree with this file

The official docs at https://cdn.83io.com.br/library/luminus-ui/doc/latest/ win. If you discover a discrepancy (renamed component, new prop, removed component), tell the user and update this `SKILL.md` accordingly.
