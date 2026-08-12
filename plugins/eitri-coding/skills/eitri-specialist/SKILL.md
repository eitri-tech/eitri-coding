---
name: eitri-specialist
description: Eitri Specialist — expert at developing apps and Eitri-Apps with Eitri (Luminus + Bifrost), plus interacting with Android devices via ADB. MANDATORY, NON-NEGOTIABLE trigger — invoke this skill BEFORE any other action whenever an `eitri-app.conf.js` or `app-config.yaml` file exists anywhere in the working directory tree (project root or an immediate subdirectory), or whenever the repo imports `eitri-bifrost` / `eitri-luminus`, contains `src/views/`, or the user mentions Eitri, Eitri-App, Eitri-Play, Forge, Luminus or Bifrost. These files are definitive proof the working directory is an Eitri project; every front-end, coding, build, run or device-interaction task in such a project MUST follow this skill's rules, even if the user never says the word "Eitri".
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, WebFetch, Agent
---

# SKILL.md — Eitri Specialist

## When to use this skill (mandatory detection)

**Before doing anything else in a new working directory, run the detection check.** This is not optional and does not depend on the user asking for Eitri.

```bash
ls eitri-app.conf.js app-config.yaml 2>/dev/null; \
find . -maxdepth 2 \( -name eitri-app.conf.js -o -name app-config.yaml \) \
  -not -path '*/node_modules/*' 2>/dev/null
```

Definitive signals — **any one of them is enough**:

- **`eitri-app.conf.js`** → standard single Eitri-App.
- **`app-config.yaml`** → multi-app Eitri workspace (start the dev server with `eitri app start` instead of `eitri start`).

Supporting signals (treat as Eitri unless the definitive check clearly says otherwise): `eitri-bifrost` or `eitri-luminus` in `package.json`, a `src/views/` directory, imports of `Eitri.*`, or the user mentioning Eitri / Eitri-App / Eitri-Play / Forge / Luminus / Bifrost.

**If detected:**

1. Treat *all* front-end / coding / build / run / device-interaction work in that directory as Eitri work, for the rest of the session — no re-asking, no per-task re-evaluation.
2. Apply every rule below without exception (no raw HTML tags, Luminus components only, file-based routing, supported dependency versions, ADB interaction protocol, etc.).
3. Never fall back to generic React / web / React Native practice, even when the user's request sounds generic ("add a button", "fix this screen", "run the app"). Generic advice in an Eitri project is a bug.
4. Chain to the companion skills as needed: `eitri-luminus` for UI components, `eitri-bifrost` for native capabilities, `eitri-claude-design-migrate` for Claude Design ports. This skill's project-wide rules always win on conflict.

Do not wait for the user to ask explicitly — the presence of these files is enough.

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
~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py
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
| `back`                    | Native back button (`KEYCODE_BACK`) — returns `screen_changed`                    |
| `wait_text "text" [secs]` | Block until text appears on screen (default 10s)                                  |
| `scroll_to_text "text" [direction] [max_swipes]` | Scroll repeatedly until the text appears (like Maestro's `scrollUntilVisible`). Default `direction=up` (reveals content below), `max_swipes=10`. Stops early when the screen stops changing (end of list) |
| `scroll_and_tap "text" [direction] [max_swipes]` | Same as `scroll_to_text` but taps the element once found                          |

Every command returns a JSON line on stdout. `tap_text` returns `screen_changed: true/false` — if `false`, the tap hit the target but the UI did not react (likely wrong element, disabled button, or overlay).

### WebView Inspection (Chrome DevTools Protocol)

Eitri-Apps render inside an Android **WebView**, so the native UI hierarchy (`uiautomator`) is useless for app content — it shows a single opaque `WebView` node. Instead, inspect the **live DOM** through the WebView's DevTools endpoint: the tool forwards `@webview_devtools_remote_<pid>` with `adb forward` and speaks CDP over a built-in WebSocket client (no extra Python packages).

This is the WebView equivalent of a `ui_tree`, and it is the **preferred observation tool when debugging generated code** — you see the real rendered markup, the Luminus/DaisyUI classes that were applied, and the actual computed boxes.

| Command                          | Description                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `webview_targets`                | List debuggable WebViews (socket, pid, package, page url/title, `eitri_env`). Start here when unsure. |
| `webview_foreground`             | Which WebView is actually on screen right now (see *One WebView per Eitri-App* below).               |
| `webview_dom [selector]`          | **Condensed DOM tree** for the LLM: tag, id, class, text, kept attributes, device-px `box`, `clickable`, `scrollable`, CSS `selector` for interactive nodes. Written to `/tmp/webview_dom.json` when large. |
| `webview_html [selector]`         | Full `outerHTML` — written to `/tmp/webview.html` (inline only when small). Read/Grep the file.       |
| `webview_find "text"`            | Locate elements by visible text / `aria-label`; returns CSS selectors + device-px boxes.             |
| `webview_tap "css-selector"`     | Scroll the element into view, convert its rect to device px (via `devicePixelRatio` + the native WebView offset) and tap it. Returns `screen_changed`. |
| `webview_eval "js"`              | Evaluate arbitrary JS in the page and return the value (`awaitPromise` enabled).                     |
| `webview_url`                    | Current `location.href`, `hash`, `title`, `readyState` — the fastest way to confirm the active route. |
| `webview_console [seconds]`      | Capture `console.*`, `Log.entryAdded` and uncaught exceptions for N seconds (default 5).             |
| `webview_reload`                 | Hard-reload the page (`ignoreCache`).                                                                |

Shared flags: `--match=<substring>` (pick the page by url/title/package), `--index=N` (pick among matches), `--no-foreground` (skip the on-screen probe), plus `--depth=N` / `--all` (include invisible nodes) for `webview_dom`, `--limit=N` for `webview_find` and `webview_console`, `--errors` for `webview_console`, `--out=path` to change the output file.

### One WebView per Eitri-App (and the native tab bar)

Eitri-Play keeps **every visited Eitri-App alive in its own WebView**, so `webview_targets` normally lists several live pages at once — and each bottom tab is usually a *different Eitri-App* (different UUID in the URL), not a route of the same one. The bottom tab bar itself is **native**, so it is invisible to the DOM and must be tapped through the native layer.

Two consequences:

1. **`document.visibilityState` is useless here** — backgrounded WebViews still report `visible`, `hasFocus()` is `false` everywhere, and `requestAnimationFrame` keeps firing. The reliable signal is that **only the on-screen WebView produces frames**, so `Page.captureScreenshot` answers for it and times out for the others. Every `webview_*` command uses this probe automatically (~10 s) to pick the right page; disable with `--no-foreground` plus an explicit `--match=`.
2. **To change tabs, use the native path.** `switch_tab "Perfil"` taps the native tab and then re-detects the WebView that came to front, returning its url/title — that is the page all subsequent `webview_*` commands will talk to.

| Command             | Description                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `tabs`              | List the native bottom-tab entries (label + coordinates) from the UI hierarchy.          |
| `switch_tab "Name"` | Tap a native tab and report the Eitri-App WebView now in foreground. Falls back to OCR.  |

### Finding tappable elements in Luminus views

Eitri views run React (Luminus) inside a WebView, so **there is no `onclick` attribute and usually no `cursor-pointer` class** — a naïve DOM walk finds almost nothing clickable. `webview_dom` therefore reads React's internal props (`__reactProps$*`) off each node and reports `clickable: true` plus the handler names in `handlers` (`onClick`, `onChange`, …), together with a ready-to-use CSS `selector`. Feed that selector straight into `webview_tap`.

**Eitri domains** — used to auto-rank targets and to label `eitri_env`:

- `api.eitri.tech` → `development`
- `release.eitri.calindra.com.br` → `production`
- `localhost` / `127.0.0.1` / `192.168.*` / `10.0.2.2` → `local` (dev server from `eitri start` / `eitri app start`)

When several pages are open, the tool picks the highest-ranked Eitri page automatically; override with `--match=api.eitri.tech` or `--match=release.eitri`. Override the whole list with the `EITRI_URL_HINTS` env var.

**Requirements:** device connected (`adb devices`), the Eitri-App in the foreground, and WebView debugging enabled in the host app (`WebView.setWebContentsDebuggingEnabled(true)` — standard in Eitri-Play debug builds). If `webview_targets` returns an empty list, fall back to the pixel-based commands below.

**Debug loop for generated code:**

```bash
python3 .../android.py webview_url                    # 1. which Eitri-App / route is on screen?
python3 .../android.py webview_dom "#page"            # 2. what markup did my code actually produce?
python3 .../android.py webview_console 5 --errors     # 3. runtime errors / failed Bifrost calls
python3 .../android.py webview_find "Finalizar"       # 4. get a CSS selector for the target
python3 .../android.py webview_tap "#page > div > button"   # 5. interact precisely
python3 .../android.py screenshot                     # 6. confirm visually
```

`webview_console` also **replays the console history** captured before it attached (`Runtime.enable` does the replay), so it shows errors that happened during app boot — not just what occurs during the capture window.

### Pixel-based fallback (no DevTools)

When WebView debugging is unavailable (release builds, DevTools disabled), use the pixel path:

- **Primary observation tool:** `screenshot` — the only reliable way to see the app's current state.
- **`tap_text` works over the rendered pixels** (OCR + template fallback), so it does find WebView content.
- **`wait_text` works** for the same reason — use it for elements that appear after loading/animation.
- **`tap_xy` / `tap_percent`** — fallback when `tap_text` cannot locate the target. Read coordinates from a fresh `screenshot`; never estimate from memory of a previous screen.
- **`tap_template`** — use for icons or non-textual targets (save a reference crop under the project and pass its path).

### Usage Rules

0. **In an Eitri-App, try `webview_targets` first.** If a debuggable page exists, prefer `webview_dom` / `webview_html` / `webview_console` over OCR — they give the real markup and real errors instead of guesses from pixels. Use `screenshot` alongside it to confirm what the user actually sees.
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
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py screenshot
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py tap_text "YOUR_WORKSPACE_NAME"
```

Then wait for the app to load and validate:

```bash
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py wait_text "YOUR_APP_INDICATOR"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py screenshot
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
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py screenshot
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py tap_text "Cart"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py wait_text "My Cart"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py screenshot
```

Never assume the current screen is the target — always verify.

### Standard Interaction Flow

```bash
# 1. Observe
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py screenshot

# 2. Interact (prefer text-based targeting)
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py tap_text "Login"
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py type "gabriel@email.com"

# 3. Navigate
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py swipe up
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py tap_text "Submit"

# 4. Wait for dynamic content
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py wait_text "Welcome"

# 5. Validate
python3 ~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/android.py screenshot
```

---

## iOS Simulator Interaction (macOS only)

`tools/ios.py` mirrors `android.py`'s command surface for the iOS Simulator. Same commands, same JSON output, same Eitri-domain classification — only the plumbing differs, and the injected JavaScript is literally the same code (both tools share `tools/webinspect.py`).

```
~/.claude/plugins/marketplaces/eitri-plugins/plugins/eitri-coding/skills/eitri-specialist/tools/ios.py
```

**Setup (once):**

```bash
brew install idb-companion ios-webkit-debug-proxy
pip install fb-idb
python3 .../ios.py doctor      # verifies every layer and prints what is missing
```

**Always start with `doctor`.** It reports the booted simulator, the binaries, the `webinspectord_sim` socket, the proxy state and how many inspectable pages exist — with a `hints` list telling you exactly what to fix.

| Layer | Android | iOS |
| ----- | ------- | --- |
| Screenshot / launch / deeplink | `adb` | `xcrun simctl io booted screenshot`, `simctl launch`, `simctl openurl` |
| Tap / swipe / type | `adb shell input` | `idb ui tap / swipe / text` |
| Native tree (tab bar, alerts) | `uiautomator dump` (XML) | `idb ui describe-all` (accessibility tree) |
| Debug bridge | `adb forward` on the abstract socket | `ios_webkit_debug_proxy` on the launchd unix socket |
| Protocol | Chrome DevTools Protocol | WebKit Inspector |

**iOS-only commands:** `doctor`, `device`, `launch <bundle-id> [--relaunch]`, `openurl <url>`, `button <HOME|LOCK|SIDE_BUTTON|SIRI>`, `ax_tree`, `proxy_start`, `proxy_stop`. Everything else (`screenshot`, `tap_text`, `wait_text`, `tap_xy`, `tap_percent`, `type`, `swipe`, `back`, `tabs`, `switch_tab`, and every `webview_*`) works exactly as documented above for Android.

Three differences that matter when reading output:

- **Coordinates are POINTS, not pixels.** `idb` taps in points while screenshots are in pixels, so `webview_dom` / `webview_find` report `units: "points"` and `screenshot` returns a `scale` (pixels per point, typically 2 or 3). Multiply by `scale` before comparing a box against a screenshot.
- **`back` is an edge swipe** — iOS has no back button.
- **`tap_text` uses accessibility labels**, not OCR, so it only finds native chrome (tab bar, alerts, system dialogs). For anything inside the Eitri-App, use `webview_find` → `webview_tap`.

**Requirement:** since iOS 16.4 the host app must set `webView.isInspectable = true` for the WKWebView to appear in the inspector — the analogue of Android's `setWebContentsDebuggingEnabled`. Without it, `webview_targets` returns empty (and `doctor` says so explicitly) while all native commands keep working.

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
