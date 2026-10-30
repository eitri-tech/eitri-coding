---
name: figma-to-eitri
description: Generate Eitri CMS sections and JSX components from a figma-scrape bundle. Use whenever the user wants to implement a Figma design into an Eitri Shopping project using the scraped bundle at figma/<project>/<view>/. Creates _cms/sections.json entries and JSX components in the correct module folder (home, pdp, cart, checkout, account). Detects the project's module prefix automatically (e.g. mahogany-home, intimissimi-pdp).
---

# figma-to-eitri

Read a figma-scrape bundle and generate production-ready Eitri CMS sections from it. One run per view.

## Architecture

```
figma/<project>/<view>/       →   _cms/sections.json              (schema entry)
  layout/frames.json               <prefix>-<view>/src/components/
  layout/tree.json                   CmsComponents/<Name>/<Name>.jsx   (component)
  design/tokens.json               <prefix>-<view>/src/utils/
  content/copy.md                    getMappedComponent.js             (registration)
  assets/images/
```

Each top-level frame in `layout/frames.json` becomes one CMS section + one component.

---

## Step 1 — Locate the bundle

Ask if not obvious from context:

> Qual bundle usar? (ex: `figma/mahogany/home`)

Read:
- `figma/<project>/<view>/layout/frames.json`
- `figma/<project>/<view>/layout/tree.json`
- `figma/<project>/<view>/design/tokens.json`
- `figma/<project>/<view>/content/copy.md`

---

## Step 2 — Detect the module prefix

Run `ls` (or Glob) on the project root to find module directories. They follow the pattern `<prefix>-<view>`. Examples:

```
mahogany-home/
mahogany-pdp/
mahogany-cart/
mahogany-checkout/
mahogany-account/
intimissimi-home/
intimissimi-pdp/
```

Extract the prefix from the directory names (the part before the first `-`). Use it for all paths below.

| View | Module directory |
|---|---|
| `home` | `<prefix>-home/` |
| `pdp` | `<prefix>-pdp/` |
| `cart` | `<prefix>-cart/` |
| `checkout` | `<prefix>-checkout/` |
| `account` | `<prefix>-account/` |

If the view directory does not exist, stop and tell the user.

---

## Step 3 — Derive section names

For each entry in `layout/frames.json`:
- Take the `name` field
- Convert to PascalCase (e.g. `"banner principal"` → `BannerPrincipal`)
- This becomes the component name and the `"name"` in `_cms/sections.json`

**Check for conflicts** — read `_cms/sections.json` first. If a name already exists, append the view name as suffix (e.g. `BannerPrincipalHome`).

---

## Step 4 — Infer CMS fields from the Figma tree

Walk each frame's subtree in `layout/tree.json`:

| Figma node signal | CMS field type |
|---|---|
| Single text node | `"type": "string"` — title, subtitle, label |
| Repeated sibling frames (cards, slides, items) | `"type": "array"` with `"items"` matching one frame's fields |
| Node with image fill / asset reference | `"type": "string"` image URL with `"widget": { "ui:widget": "media-gallery" }` |
| Button / CTA node | `action` object (standard schema below) |
| Rich text / long text node | `"type": "string"` with `"widget": { "ui:widget": "draftjs-rich-text" }` |
| Vector / icon | hardcoded in component — not a CMS field |
| Background covering full frame | `imageUrl` string with media-gallery widget |

Only expose fields the store operator needs to change. Layout, spacing, and structural wrappers are implementation details.

---

## Step 5 — Add schema entry to _cms/sections.json

Read `_cms/sections.json`. Add one entry per frame:

```json
{
    "name": "ComponentName",
    "requiredScopes": [],
    "schema": {
        "title": "Título legível no editor CMS",
        "description": "Descrição mostrada no CMS",
        "type": "object",
        "properties": {
            // inferred fields from Step 4
        }
    }
}
```

**Schema rules:**
- Property titles and descriptions in **Portuguese**
- Image fields use `"widget": { "ui:widget": "media-gallery" }`
- Rich text fields use `"widget": { "ui:widget": "draftjs-rich-text" }`
- Arrays use `"type": "array"` with `"items"` describing the repeated object
- Dropdowns use `"enum"` / `"enumNames"` pairs

**Standard action schema** — use this exact block for any CTA / button field:

```json
"action": {
    "title": "Destino da ação (Opcional)",
    "type": "object",
    "properties": {
        "type": {
            "title": "Tipo de ação",
            "enumNames": ["Nenhum", "Abrir Link Externo", "Abrir Produto (id ou slug)", "Abrir Coleção (Id da coleção)", "Abrir Categoria (cate1/cat2/cat3...)", "Abrir Busca (termo de busca)", "Abrir Landing Page (nome da landing page)", "Abrir Path do Site", "Abrir Marca"],
            "enum": ["none", "link", "product", "collection", "category", "search", "page", "path", "brand"],
            "default": "none"
        },
        "value": { "title": "Valor", "type": "string" },
        "title": { "title": "Título na tela de destino (opcional)", "type": "string" }
    }
}
```

---

## Step 6 — Create JSX components

Create one file per frame at:
```
<prefix>-<view>/src/components/CmsComponents/<ComponentName>/<ComponentName>.jsx
```

**Component template:**

```jsx
import { View, Text, Image } from 'eitri-luminus'
import { processActions } from '../../../services/ResolveCmsActions'

export default function ComponentName(props) {
    const { data } = props

    // Extract props — names MUST match schema.properties keys exactly
    const { title, items, imageUrl, action } = data || {}

    return (
        <View className="flex flex-col">
            {/* render design from figma bundle */}
        </View>
    )
}
```

**Component rules (MANDATORY):**
- Named default export function — never arrow function as default export
- Props received as `props`, destructured in body: `const { data } = props`
- All CMS data arrives via `props.data` — property names MUST match `schema.properties` keys
- Only use `eitri-luminus` components (`View`, `Text`, `Image`, `Button`, `ScrollView`, `Pressable`, etc.) — **NO HTML tags** (`div`, `img`, `p`, `span`, etc.)
- All styling via Tailwind/DaisyUI `className` — **NO `style` prop**
- `width`, `height`, `maxWidth`, `maxHeight`, `minWidth`, `minHeight` as **direct props** on the component, not in className
- No `hover:`, `focus-within:`, `active:` Tailwind utilities (causes stuck states on mobile)
- `useState` and `useEffect` are **globally available** — do NOT import them. Never write `import { useState, useEffect } from 'react'`
- Import Eitri from `'eitri-bifrost'` for navigation, HTTP, storage
- For CTA fields: call `processActions(item)` unconditionally — **never guard with `hasAction` or check `action.type !== 'none'`**
- Use copy from `content/copy.md` as placeholder text in mock data only — props come from CMS

**Mapping design tokens to Tailwind:**
- Colors from `design/tokens.json` → Tailwind arbitrary values: `bg-[#551525]`, `text-[#f0d9ae]`
- Spacing (px) → Tailwind scale ÷4: 8px → `p-2`, 16px → `p-4`, 24px → `gap-6`, 32px → `p-8`
- Font sizes → Tailwind text scale: 12px → `text-xs`, 14px → `text-sm`, 16px → `text-base`, 20px → `text-xl`
- Border radii → `rounded-[Npx]` if no standard class matches

---

## Step 7 — Register in getMappedComponent.js

Read `<prefix>-<view>/src/utils/getMappedComponent.js`.

Add the import:
```js
import ComponentName from '../components/CmsComponents/ComponentName/ComponentName'
```

Add to `componentMap`:
```js
const componentMap = {
    // ... existing entries
    ComponentName: ComponentName
}
```

The key MUST match the `"name"` field in `_cms/sections.json` exactly.

**If getMappedComponent.js does not exist yet**, create it:

```js
import ComponentName from '../components/CmsComponents/ComponentName/ComponentName'

const componentMap = {
    ComponentName: ComponentName
}

export const getMappedComponent = (content, reloadKey, index) => {
    const Component = componentMap[content.name]
    if (!Component) {
        console.error(`Component ${content.name} does not exist in the component map.`)
        return null
    }
    const key = (content.id || index) + (reloadKey || '')
    try {
        return <Component key={key} data={content.data} />
    } catch (error) {
        console.error(`Error rendering component ${content.name}:`, error)
        return null
    }
}
```

---

## Step 8 — Create mock data in CmsContentRender.jsx

Read `<prefix>-<view>/src/components/CmsContentRender/CmsContentRender.jsx`.

For each generated component, add a mock constant populated with **real content from the bundle**:

```jsx
// TODO: Remover apos validacao do ComponentName
const MOCK_COMPONENT_NAME = [
    {
        name: 'ComponentName',
        id: 'mock-component-name-1',
        data: {
            // populate with real values extracted from the bundle
        }
    }
]
```

**Where to get the mock values:**

| Field type | Source in bundle |
|---|---|
| Text strings | `content/copy.md` — use the copy from the matching frame/section |
| Image URLs | `assets/images.json` — use the signed export URL for the matching frame ID; note it may expire |
| Array items | Use 2–3 real items from the design (e.g. real category names, real banner texts from copy.md) |
| Action fields | `{ type: 'none' }` as default |
| Boolean toggles | `true` if the element is visible in the design |

**If image URLs from `assets/images.json` are expired** (fetch fails), use `https://placehold.co/<W>x<H>` with the exact pixel dimensions from `layout/frames.json`.

**Update `contentWithMocks`** to prepend the new mock:

```jsx
// If contentWithMocks already exists, append:
const contentWithMocks = [...MOCK_COMPONENT_NAME, ...existingMocks, ...(cmsContent || [])]

// If no mock pattern exists yet, create:
const contentWithMocks = [...MOCK_COMPONENT_NAME, ...(cmsContent || [])]
```

Replace the `.map()` call to use `contentWithMocks` instead of `cmsContent`.

**Goal:** after this step the developer can run the app locally and see the component rendered with content that matches the Figma design, enabling a direct visual comparison against the PNG exports in `assets/images/`.

---

## Step 9 — Verify

After all files are written:
- Every `"name"` in `_cms/sections.json` has a matching key in `componentMap`
- Every import path in `getMappedComponent.js` points to an existing file
- Component destructures `data` from `props` and uses the same property names as `schema.properties`
- Mock `data` keys match the component's destructured property names
- Mock `name` fields match the keys in `componentMap` exactly
- No HTML tags in any component
- No `style` prop anywhere
- No `hover:`/`focus-within:`/`active:` Tailwind utilities
- `processActions` called unconditionally on action fields

---

## Multiple frames in one view

If `layout/frames.json` has several frames, generate all in one pass:
1. All schema entries added to `_cms/sections.json`
2. All component files created
3. All entries registered in `getMappedComponent.js`

Do not pause between frames asking for confirmation — complete the full view in one shot.
