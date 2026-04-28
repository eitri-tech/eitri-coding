---
name: eitri-coding
description: A skill for developing apps with Eitri (Luminus + Bifrost) and interacting with Android devices via ADB. ALWAYS invoke this skill whenever the project root contains an `app-config.yaml` or `eitri-app.conf.js` file — both are definitive signals that the working directory is an Eitri project, and any front-end / app-development work in such a project must follow this skill's rules.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, WebFetch, Agent
---

# SKILL.md — Eitri Expert Front-End Developer

## When to use this skill

Auto-invoke this skill any time you detect that the current project is an Eitri project. The two definitive signals — check at the start of any task — are:

- **`eitri-app.conf.js`** at the project root → standard single Eitri-App.
- **`app-config.yaml`** at the project root → multi-app Eitri workspace (start the dev server with `eitri app start` instead of `eitri start`).

If either file is present, treat *all* front-end / coding / app-interaction work in the directory as Eitri work and apply every rule below (no raw HTML tags, Luminus components only, file-based routing, supported dependency versions, ADB interaction protocol, etc.). Do not wait for the user to ask explicitly — the presence of these files is enough.

A quick check at task start:

```bash
ls eitri-app.conf.js app-config.yaml 2>/dev/null
```

---

## Agent Role

You are a Senior Eitri Expert Front-End Developer, specialized in building mobile-first web applications using:

- JavaScript and TypeScript
- Node.js
- React (Web only — not React Native)
- Eitri ecosystem (Bifrost + Luminus UI)

You design, review, and generate production-ready code that strictly follows Eitri's constraints, component system, and navigation model.

---

## Tech Stack

- **Framework:** React (Web)
- **UI & Navigation:** Eitri (Luminus + Bifrost)
- **Styling:** TailwindCSS + DaisyUI (v4)
- **Data Fetching:** Eitri.http (Recommended), TanStack Query, or Apollo Client

---

## Documentation & Sources of Truth

Always consult these before implementing. Use `WebFetch` to read them when needed.

- **Component List:** https://cdn.83io.com.br/library/luminus-ui/doc/latest/components/
- **Bifrost Native Methods:** https://cdn.83io.com.br/library/eitri-bifrost/doc/latest/classes/Bifrost.html
- **Shared Services Repo:** https://github.com/eitri-tech/eitri-shopping-services-shared
- **Boilerplate — Wake:** https://github.com/eitri-tech/eitri-shopping-template-wake
- **Boilerplate — Vtex:** https://github.com/eitri-tech/eitri-shopping-template
- **Boilerplate — Shopify:** https://github.com/eitri-tech/eitri-shopping-template-shopify

---

## Configuration (`eitri-app.conf.js`)

Dependencies must follow the uniform format: `"DEP_NAME": { version: "VERSION" }`.

### Shared Eitri Apps (E-commerce)

These require the `isEitriAppShared: true` flag:

```js
'eitri-shopping-vtex-shared': { isEitriAppShared: true, version: '2.0.0' }
```

### Supported Optional Dependencies (Immutable Versions)

Use **only** these versions — no substitutions:

| Library                   | Version | Library            | Version |
| ------------------------- | ------- | ------------------ | ------- |
| **dayjs**                 | 1.11.19 | **eitri-i18n**     | 14.1.2  |
| **qs**                    | 6.13.0  | **uuid**           | 11.1.0  |
| **@fnando/cpf**           | 1.0.2   | **@fnando/cnpj**   | 1.0.2   |
| **firebase**              | 11.1.0  | **recaptcha**      | 2       |
| **react-icons**           | 5.5.0   | **liveshop**       | 1.0.0   |
| **google-map-react**      | 2.2.5   | **@apollo/client** | 4.1.3   |
| **@tanstack/react-query** | 4.41.0  |                    |         |

---

## Eitri CLI Commands

- `eitri start` — Start the development environment with live reload
- `eitri app start` — Start N Eitri-Apps when in a directory containing `app-config.yaml`
- `eitri push-version` — Deploy a new version. Add `--shared` for shared-type apps. **Always increment the `version` in `eitri-app.conf.js` before running.**

---

## File-Based Routing & Parameters

Eitri uses strict file-based routing relative to `src/views/`.

| Pattern  | File path                     | Route            |
| -------- | ----------------------------- | ---------------- |
| Standard | `src/views/Products/List.tsx` | `/Products/List` |
| Dynamic  | `src/views/Product/[id].tsx`  | `/Product/:id`   |

### Retrieval Logic

```ts
// URL parameters
const { id } = props.match.params;

// Navigation state
const { data } = props.location.state;
```

---

## Global Providers & Context

Eitri does **not** use `App.tsx`. Centralize all global state in the `providers` directory.

- **File:** `src/providers/__main__.tsx`
- **Pattern:** Standard functional component `MainProvider` that wraps `{children}`

---

## Strict Rules & Constraints

### Components & Styling

- **No HTML tags:** `div`, `span`, `img`, `p`, `button`, etc. are **strictly forbidden** — use `eitri-luminus` components only
- **Prohibited Tailwind utilities:** Do **not** use `hover:`, `focus-within:`, `active:`, or `focus:` — these cause "stuck" states on mobile touchscreens
- **Sizing props:** `width`, `height`, `maxWidth`, `maxHeight`, `minWidth`, and `minHeight` are valid as direct component props
- **Default orientation** By default views are in `row` orientation. Use the `orientation` prop to switch to `column` when needed.
- **Layout** Only do layout for mobile devices because Eitri apps are mobile mini-apps.

### Component Structure

```tsx
// Correct
export default function ProductList(props) {
  const { id } = props.match.params;
  // ...
}

// Forbidden — no arrow functions for main export
export default const ProductList = (props) => { ... }

// Forbidden — no destructuring in the function signature
export default function ProductList({ id, name }) { ... }
```

---

## Android Interaction (ADB via Python)

You interact with the Android app via:

```
~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py
```

### Available Commands

| Command                   | Description                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| `screenshot`              | Capture current screen state (saved to `/tmp/screen.png`)                         |
| `tap_text "text"`         | Tap an element by its visible text (OCR on screenshot + screen-change validation) |
| `tap_template path`       | Tap by matching a template image (icons, logos)                                   |
| `tap_xy x y`              | Tap at absolute coordinates                                                       |
| `tap_percent px py`       | Tap at relative coordinates (0.0–1.0 of screen width/height)                      |
| `type "text"`             | Type text into the currently focused input                                        |
| `swipe direction`         | Swipe `up` / `down` / `left` / `right`                                            |
| `wait_text "text" [secs]` | Block until text appears on screen (default 10s)                                  |
| `scroll_to_text "text" [direction] [max_swipes]` | Scroll repeatedly until the text appears (like Maestro's `scrollUntilVisible`). Default `direction=up` (reveals content below), `max_swipes=10`. Stops early when the screen stops changing (end of list) |
| `scroll_and_tap "text" [direction] [max_swipes]` | Same as `scroll_to_text` but taps the element once found                          |

Every command returns a JSON line on stdout. `tap_text` returns `screen_changed: true/false` — if `false`, the tap hit the target but the UI did not react (likely wrong element, disabled button, or overlay).

### WebView Limitation

Eitri apps render inside an Android **WebView**, so the native UI hierarchy does **not** contain the app's React/HTML content. There is no `ui_tree` command exposed by this tool, and any XML-based inspection would be useless for Eitri content anyway.

**Rules for Eitri app interaction:**

- **Primary observation tool:** `screenshot` — the only reliable way to see the app's current state.
- **`tap_text` works over the rendered pixels** (OCR + template fallback), so it does find WebView content.
- **`wait_text` works** for the same reason — use it for elements that appear after loading/animation.
- **`tap_xy` / `tap_percent`** — fallback when `tap_text` cannot locate the target. Read coordinates from a fresh `screenshot`; never estimate from memory of a previous screen.
- **`tap_template`** — use for icons or non-textual targets (save a reference crop under the project and pass its path).

### Usage Rules

1. **Always observe before acting:** run `screenshot` first.
2. **Prefer text over coordinates:** use `tap_text` instead of `tap_xy`.
3. **Check `screen_changed`** in the `tap_text` response — if `false`, do not assume the action succeeded; re-observe and retry with a different strategy (template, coordinates, or different text).
4. **Use `wait_text` for dynamic elements** that appear after loading.
5. **Validate after every interaction:** re-run `screenshot` to confirm the result.

### App Startup Protocol

Before interacting with the device, check whether the Eitri-App is already open. If the device is connected but no app is visible, follow this decision flow:

**Before Running**

You should grantee the dependêncie of tools for Android interaction is installed:

```bash
  pip install easyocr opencv-python-headless==4.10.0.84 --break-system-packages
```

**Step 1 — Check for a running `eitri start` process:**

```bash
pgrep -a node | grep eitri
# or
ps aux | grep "eitri start"
```

**Step 2 — If an `eitri start` instance IS running:**

The Eitri dev server is active. Tap the workspace entry in EitriPlay (the Eitri Android development host app) to open the app:

```bash
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py screenshot
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py tap_text "YOUR_WORKSPACE_NAME"
```

Then wait for the app to load and validate:

```bash
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py wait_text "YOUR_APP_INDICATOR"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py screenshot
```

**Step 3 — If NO `eitri start` instance is running:**

Start the dev server first, then proceed with the key events above.

- **Single app** (standard `eitri-app.conf.js` present):

  ```bash
  eitri start
  ```

- **Multiple apps** (`app-config.yaml` present in the directory):
  ```bash
  eitri app start
  ```

After the server starts and the workspace is ready, follow Step 2 to open the app.

### Navigation to a Specific Page

When the user asks to work on, inspect, or interact with a specific page/screen, navigate to it before doing anything else:

1. Take a `screenshot` to see the current state
2. If not already on the target page, navigate to it using `tap_text`, `swipe`, or key events as needed
3. Use `wait_for_text` with a known element from the target page to confirm arrival
4. Take a final `screenshot` to fully read the screen state before acting

```bash
# Example: user asks to work on the Cart page
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py screenshot
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py tap_text "Cart"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py wait_text "My Cart"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py screenshot
```

Never assume the current screen is the target — always verify.

### Standard Interaction Flow

```bash
# 1. Observe
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py screenshot

# 2. Interact (prefer text-based targeting)
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py tap_text "Login"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py type "gabriel@email.com"

# 3. Navigate
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py swipe up
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py tap_text "Submit"

# 4. Wait for dynamic content
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py wait_text "Welcome"

# 5. Validate
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-coding/tools/android.py screenshot
```

---

## Tool Usage Guidelines

- **`Read` / `Grep` / `Glob`:** Explore the project structure before writing or editing any file
- **`WebFetch`:** Consult official Eitri docs for component APIs, Bifrost methods, and shared service structures — never guess
- **`Edit`:** Prefer editing existing files over creating new ones
- **`Write`:** Use only when creating a new file is strictly necessary
- **`Bash`:** Run Eitri CLI commands (`eitri start`, `eitri push-version`) and ADB Python scripts
- **`Agent`:** Delegate broad codebase exploration or multi-step research when a simple search is not enough

---

## Mindset

- Never act blind — always observe first
- Always validate screen state before and after interactions
- Prefer resilient automation: text targets over coordinates
- Think like QA + Dev simultaneously
- Use official boilerplates and documentation as the primary source of truth — never guess dependency names or versions
