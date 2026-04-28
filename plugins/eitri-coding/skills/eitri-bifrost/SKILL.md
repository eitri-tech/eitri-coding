---
name: eitri-bifrost
description: Reference and authoring guide for eitri-bifrost — Eitri's native bridge that exposes device capabilities (navigation, storage, HTTP, camera, code scanner, geolocation, biometrics, clipboard, share, haptic, notifications, file system, deeplinks, tracking, event bus, etc.) to Eitri-app JavaScript. ALWAYS invoke this skill whenever the user asks about Bifrost APIs, calls `Eitri.<x>` / imports from `eitri-bifrost`, asks "how do I navigate / store / take a photo / scan a QR code / track an event / open a deeplink / call an HTTP API in Eitri?", or whenever a question requires consulting the official Bifrost typedoc at https://cdn.83io.com.br/library/eitri-bifrost/doc/5.1.0/. Also use when reviewing Eitri code for Bifrost-correctness (no `fetch`/`localStorage`/`navigator.*` — use Bifrost equivalents; `await` async APIs; `canIUse` guards for capability gating; permission flow before sensor APIs).
allowed-tools: Read, Grep, Glob, Write, Edit, WebFetch
---

# SKILL.md — eitri-bifrost

Authoring + reference skill for **eitri-bifrost** (`Eitri` global / `eitri-bifrost` package), the native bridge every Eitri-app uses to talk to the host (EitriPlay / production shell). This skill is the source of truth for *which capabilities exist*, *how to call them*, and *which rules must be followed* when wiring native features into Luminus views. For exact prop/return shapes, fall back to the official typedoc (see **Live docs**).

## When to use

Trigger automatically when any of these are true:

- The user asks about a Bifrost capability ("how do I get the user's location?", "how do I save data between sessions?", "how do I open a deeplink?").
- The user is editing/creating files that import from `eitri-bifrost` or use the `Eitri` global.
- The user is asking how to do something that, in a normal web app, would use `fetch`, `localStorage`/`sessionStorage`, `navigator.*`, `window.open`, `<a href>`, browser geolocation, browser camera — in Eitri these all map to Bifrost.
- A code review involves Bifrost correctness (`await` on async APIs, `canIUse` capability checks, permission flow before sensors, no use of forbidden web primitives).
- The user explicitly mentions Bifrost, native bridge, EitriPlay capabilities, modules metadata, or "is this API available?".

This skill **complements** `eitri-coding` (project-level rules) and `eitri-luminus` (UI library reference). UI questions go to `eitri-luminus`; native capability questions go here.

---

## Live docs

Official typedoc — authoritative for parameter and return-type shapes:

- **Root:** https://cdn.83io.com.br/library/eitri-bifrost/doc/5.1.0/
- **Bifrost class (entry point):** https://cdn.83io.com.br/library/eitri-bifrost/doc/5.1.0/classes/Bifrost.html
- **Per-namespace class pages:** `https://cdn.83io.com.br/library/eitri-bifrost/doc/5.1.0/classes/_internal_.<ClassName>.html`
  Examples:
  - `_internal_.Storage.html`
  - `_internal_.Navigation.html`
  - `_internal_.Http.html`
  - `_internal_.Camera.html`
  - `_internal_.Geolocation.html`
  - `_internal_.Biometrics.html`
  - `_internal_.Clipboard.html`
  - `_internal_.Share.html`
  - `_internal_.EventBus.html`
  - `_internal_.CodeScanner.html`
  - `_internal_.Deeplink.html`
  - `_internal_.Notification.html`
  - `_internal_.MediaNotification.html`
  - `_internal_.Device.html`
  - `_internal_.System.html`
  - `_internal_.Screen.html`
  - `_internal_.Environment.html`
  - `_internal_.FileSystem.html`
  - `_internal_.SharedFileSystem.html`
  - `_internal_.SharedStorage.html`
  - `_internal_.Tracking.html`
  - `_internal_.Speech.html`
  - `_internal_.Haptic.html`
  - `_internal_.Keyboard.html`
  - `_internal_.AppStore.html`
  - `_internal_.GooglePay.html`
  - `_internal_.WebFlow.html`
  - `_internal_.BottomBar.html`
  - `_internal_.SmsUserConsent.html`
  - `_internal_.NativeNavigation.html`

When unsure about a method signature, default value, return shape, or platform availability, **`WebFetch` the relevant `_internal_.<Class>.html` page** rather than guessing. Cite the page back to the user when answering.

Current target version: **5.1.0** (update this skill if the project pins a different version — check `package.json`).

---

## How Bifrost is consumed

```js
import Eitri from 'eitri-bifrost'

// Most APIs are async — always await.
const pos = await Eitri.geolocation.getCurrentLocation()
await Eitri.storage.setItem('token', value)
const token = await Eitri.storage.getItem('token')
await Eitri.navigation.navigate({ path: 'Details', state: { id: 42 } })
```

- `Eitri` is the singleton instance of the `Bifrost` class.
- Capabilities are grouped on the instance as namespaces (e.g. `Eitri.navigation`, `Eitri.storage`, `Eitri.camera`).
- Almost every method is `Promise<…>` — **always `await`** (or `.then`).
- The bridge is asynchronous because it crosses into native code; do not assume synchronous behavior even for "cheap" calls.

---

## Hard rules (non-negotiable)

1. **No browser web primitives for native concerns.** In an Eitri app, replace:
   | Web primitive | Bifrost replacement |
   |---|---|
   | `fetch` / `XMLHttpRequest` | `Eitri.http.*` (also `Eitri.http.fetch` for fetch-style syntax) |
   | `localStorage` / `sessionStorage` | `Eitri.storage.*` |
   | `navigator.geolocation` | `Eitri.geolocation.*` |
   | `navigator.clipboard` | `Eitri.clipboard.*` |
   | `navigator.share` | `Eitri.share.link` / `Eitri.share.text` |
   | `navigator.mediaDevices` (camera) | `Eitri.camera.*` / `Eitri.codeScanner.*` |
   | `window.open(url)` | `Eitri.openBrowser({ url })` (HTTPS only) |
   | `<a href>` for in-app routing | `Eitri.navigation.navigate(...)` |
   | URL-based deep linking | `Eitri.deeplink.*` |
   | `window.addEventListener('online'/'offline')` | `Eitri.isOnline()` + `Eitri.eventBus` |
   | Push/local notifications | `Eitri.notification.*` / `Eitri.mediaNotification.*` |
   | Analytics SDKs (GA, Clarity, Datadog) | `Eitri.tracking.GA` / `.clarity` / `.dataDog` |

2. **Always `await` Bifrost calls.** Forgetting to await is the #1 source of bugs.

3. **Permission flow comes before sensor calls.** For `camera`, `geolocation`, `notification`: `checkPermission()` → if not granted, `requestPermission()` → only then call the actual capability (`takePicture`, `getCurrentLocation`, `sendLocalPush`).

4. **Guard optional capabilities with `Eitri.canIUse(apiLevel)`** when targeting features that may not exist on every host/version.

5. **`Eitri.openBrowser` requires HTTPS.** HTTP URLs are rejected. For in-app navigation use `Eitri.navigation`, not `openBrowser`.

6. **`Eitri.sharedStorage` and `Eitri.exposedApis` are deprecated.** Use `Eitri.storage` and `Eitri.modules()` (with `Eitri.modulesMetadata()`).

7. **Platform restrictions matter.**
   - `Eitri.smsUserConsent` — Android only.
   - `Eitri.googlePay` — Android only.
   - `Eitri.nativeNavigation` — host-controlled / restricted.

If a user-supplied snippet violates any of these, fix it as part of the answer.

---

## Top-level methods on `Eitri`

| Method | Signature | Purpose |
|---|---|---|
| `getConfigs()` | `Promise<AppConfigs>` | Fetch app-specific configuration. |
| `modules()` | `Promise<any>` | Access privileged native modules with introspection. |
| `modulesMetadata()` | `Promise<ModulesMetadata>` | Module version & availability map. |
| `getInitializationInfos()` | `Promise<object>` | Initialization data passed by host. |
| `openBrowser(config)` | `Promise<void>` | Open an HTTPS URL in the system browser. |
| `canIUse(apiLevel)` | `boolean` | Check whether a given API level is supported. |
| `close()` | `Promise<void>` | Close the current eitri-app. |
| `isOnline()` | `Promise<boolean>` | Connectivity check. |
| `version` | `string` | Current `eitri-bifrost` version. |

---

## Namespace catalogue (with real signatures from typedoc 5.1.0)

> Signatures below are excerpted from `_internal_.<Class>.html`. When in doubt, refetch the page — the bridge evolves.

### `Eitri.navigation` — in-app routing
| Method | Signature |
|---|---|
| `navigate` | `(config: NavigationConfig) => Promise<void>` — push a screen from `src/views/` |
| `back` | `(steps: number) => void` — pop one or several screens |
| `backToTop` | `() => void` — pop to the first screen |
| `open` | `(config: OpenInput) => Promise<void>` — open another eitri-app with init params |
| `close` | `(options?: CloseOptions) => Promise<void>` — close the current eitri-app |
| `reload` | `() => Promise<void>` |
| `setOnResumeListener` | `(cb: () => void) => Promise<void>` — register (replaces prior) |
| `addOnResumeListener` | `(cb: () => void) => Promise<void>` — register additional |
| `addOnLostUserFocusListener` | `(cb: () => void) => Promise<void>` |
| `clearOnResumeListener` | `() => Promise<void>` |
| `addBackHandler` | `(fn: BackHandler) => void` — intercept back navigation |
| `clearBackHandlers` | `() => void` |

### `Eitri.storage` — key/value persistence (per-app)
| Method | Signature |
|---|---|
| `setItem` | `(key: string, value?: string, options?: StorageOptions) => Promise<void>` |
| `setItemJson` | `(key: string, value?: any, options?: StorageOptions) => Promise<void>` |
| `getItem` | `(key: string, options?: StorageOptions) => Promise<string>` |
| `getItemJson` | `(key: string, options?: StorageOptions) => Promise<any>` |
| `removeItem` | `(key: string, options?: StorageOptions) => Promise<void>` |
| `clear` | `(options?: StorageOptions) => Promise<void>` — clear current namespace |
| `clearAll` | `() => Promise<void>` — clear all namespaces of this app |
| `keys` | `(options?: StorageOptions) => Promise<string[]>` |
| `keysAll` | `() => Promise<StorageKeyEntry[]>` |

### `Eitri.http` — HTTPS-only network
Standard verbs all return `Promise<HttpResponse>` (or `HttpStreamResponse` for streams).
| Group | Methods |
|---|---|
| Request | `get(url, config?)`, `post(url, data?, config?)`, `put(url, data?, config?)`, `patch(url, data?, config?)`, `delete(url, config?)`, `head(url, config?)`, `options(url, config?)`, `request(config: RequestConfig)`, `fetch(url, fetchConfig?)` |
| Streaming | `getStream`, `postStream`, `putStream`, `patchStream`, `deleteStream`, `headStream`, `optionsStream`, `requestStream`, `startStream({ dataChannel })`, `cancelStream({ dataChannel })` |
| Files | `download(args: DownloadFileInput) => Promise<EitriFile>`, `upload(args: UploadFileInput) => Promise<HttpResponse>` |

> Streaming APIs use `eventBus` data channels — subscribe before calling `startStream`.

### `Eitri.geolocation`
| Method | Signature |
|---|---|
| `checkPermission` | `(input: GeolocationPermissionInput) => Promise<GeolocationPermissionOutput>` |
| `requestPermission` | `(input: GeolocationPermissionInput) => Promise<GeolocationPermissionOutput>` |
| `getCurrentLocation` | `() => Promise<GeolocationRequestOutput>` |
| `upgradeToBackgroundPermission` | `() => Promise<GeolocationPermissionOutput>` |

### `Eitri.camera`
| Method | Signature |
|---|---|
| `checkPermission` | `() => Promise<CameraPermissionResponse>` |
| `requestPermission` | `() => Promise<CameraPermissionResponse>` |
| `takePicture` | `(input: CameraTakePictureInput) => Promise<EitriFile>` |

### `Eitri.codeScanner`
| Method | Signature |
|---|---|
| `startScanner` | `(input?: CodeScannerInput) => Promise<string>` — supports QR, Aztec, DataMatrix, PDF417, Code128, EAN13 |

### `Eitri.biometrics`
| Method | Signature |
|---|---|
| `checkStatus` | `() => Promise<BiometricCheckStatusOutput>` |
| `authenticate` | `(input: BiometricAuthenticateInput) => Promise<BiometricAuthenticateOutput>` |

### `Eitri.clipboard`
| Method | Signature |
|---|---|
| `setText` | `(args: ClipboardTextInput) => Promise<void>` |
| `getText` | `() => Promise<string>` |

### `Eitri.share`
| Method | Signature |
|---|---|
| `link` | `(args: ShareLinkInput) => Promise<void>` |
| `text` | `(args: ShareTextInput) => Promise<void>` |

### `Eitri.eventBus`
| Method | Signature |
|---|---|
| `subscribe` | `(input: SubscribeInput) => void` |
| `clear` | `(input: ClearInput) => void` |
| `clearChannel` | `(channel: string) => void` |
| `publish` | `(input: PublishInput) => void` |

### `Eitri.deeplink`
| Method | Signature |
|---|---|
| `canOpen` | `(args: DeeplinkInput) => Promise<boolean>` |
| `open` | `(args: DeeplinkInput) => Promise<void>` |

### `Eitri.notification`
| Method | Signature |
|---|---|
| `checkPermission` | `() => Promise<NotificationPermissionOutput>` |
| `requestPermission` | `(input: NotificationPermissionInput) => Promise<NotificationPermissionOutput>` |
| `checkSchedulePermission` | `() => Promise<NotificationPermissionOutput>` |
| `requestSchedulePermission` | `() => Promise<NotificationPermissionOutput>` |
| `sendLocalPush` | `(input: LocalPushNotificationInput) => Promise<void>` |
| `listLocalPushes` | `() => Promise<NotificationSchedules>` |
| `cancelLocalPush` | `(input: CancelLocalPushInput) => Promise<void>` |

### `Eitri.device`
| Method | Signature |
|---|---|
| `getInfos` | `() => Promise<DeviceInfosOutput>` — platform, OS, brand, model, API level (Android) |

### `Eitri.fs` — FileSystem
| Method | Signature |
|---|---|
| `download` | `(args: DownloadFileInput) => Promise<EitriFile>` |
| `list` | `() => Promise<EitriFile[]>` |
| `delete` | `(args: DeleteFileInput) => Promise<void>` |
| `open` | `(args: OpenFileInput) => Promise<void>` |
| `share` | `(args: ShareFileInput) => Promise<EitriFile>` |
| `openFilePicker` | `(args: OpenFilePickerInput) => Promise<EitriFile[]>` |
| `openImagePicker` | `(args: OpenImagePickerInput) => Promise<EitriFile[]>` |

### `Eitri.haptic`
| Method | Signature |
|---|---|
| `vibrate` | `() => Promise<void>` |

### `Eitri.tracking`
Not a method API — exposes service instances:
- `Eitri.tracking.GA` — Google Analytics
- `Eitri.tracking.clarity` — Microsoft Clarity
- `Eitri.tracking.dataDog` — Datadog

Use the underlying instance's API to send events. Fetch `_internal_.Tracking.html` (and the linked GA/Clarity/Datadog pages) for the exact methods.

### Other namespaces (consult typedoc for signatures)
`Eitri.system`, `Eitri.screen`, `Eitri.environment`, `Eitri.nativeNavigation`, `Eitri.sharedStorage` (deprecated), `Eitri.sharedFs`, `Eitri.keyboard`, `Eitri.mediaNotification`, `Eitri.speech`, `Eitri.smsUserConsent` (Android), `Eitri.appStore`, `Eitri.googlePay` (Android), `Eitri.webFlow`, `Eitri.bottomBar`.

> If a capability you need isn't listed, fetch the Bifrost class typedoc — the bridge evolves. URL: https://cdn.83io.com.br/library/eitri-bifrost/doc/5.1.0/classes/Bifrost.html

---

## Canonical examples

### Navigation

```js
import Eitri from 'eitri-bifrost'

await Eitri.navigation.navigate({ path: 'ProductDetails', state: { productId: '42' } })
Eitri.navigation.back(1)

// Intercept hardware back
Eitri.navigation.addBackHandler(() => {
  // return true to prevent default back
  return true
})
```

### Storage (string + JSON)

```js
await Eitri.storage.setItem('authToken', token)
await Eitri.storage.setItemJson('user', { id, name })
const user = await Eitri.storage.getItemJson('user')
await Eitri.storage.removeItem('authToken')
```

### HTTP request + file upload

```js
const res = await Eitri.http.get('https://api.example.com/items', {
  headers: { Authorization: `Bearer ${token}` }
})
const items = res.data

await Eitri.http.upload({ url: 'https://api.example.com/upload', file, fields: { kind: 'avatar' } })
```

### Geolocation with permission flow

```js
let perm = await Eitri.geolocation.checkPermission({ precision: 'high' })
if (perm.status !== 'granted') {
  perm = await Eitri.geolocation.requestPermission({ precision: 'high' })
}
if (perm.status === 'granted') {
  const { coords } = await Eitri.geolocation.getCurrentLocation()
  console.log(coords.latitude, coords.longitude)
}
```

### Take a photo

```js
let perm = await Eitri.camera.checkPermission()
if (perm.status !== 'granted') perm = await Eitri.camera.requestPermission()
if (perm.status === 'granted') {
  const file = await Eitri.camera.takePicture({ quality: 0.8 })
  // file: EitriFile
}
```

### Scan a QR code

```js
const value = await Eitri.codeScanner.startScanner({ formats: ['QR'] })
if (value) {
  await Eitri.navigation.navigate({ path: 'Result', state: { code: value } })
}
```

### Share + clipboard

```js
await Eitri.share.link({ url: 'https://example.com', title: 'Check this out' })
await Eitri.clipboard.setText({ text: 'hello' })
const copied = await Eitri.clipboard.getText()
```

### Biometric auth

```js
const status = await Eitri.biometrics.checkStatus()
if (status.available) {
  const result = await Eitri.biometrics.authenticate({ reason: 'Unlock your wallet' })
  if (result.success) { /* proceed */ }
}
```

### Local notification

```js
const perm = await Eitri.notification.requestPermission({})
if (perm.status === 'granted') {
  await Eitri.notification.sendLocalPush({
    id: 'reminder-1',
    title: 'Reminder',
    body: 'Time to check in',
    fireAt: Date.now() + 60_000
  })
}
```

### Event bus (pub/sub)

```js
Eitri.eventBus.subscribe({
  channel: 'cart:updated',
  callback: payload => { /* react */ }
})
Eitri.eventBus.publish({ channel: 'cart:updated', data: { itemId: 1 } })
Eitri.eventBus.clearChannel('cart:updated')
```

### Open external HTTPS URL

```js
await Eitri.openBrowser({ url: 'https://help.example.com' })
```

### Connectivity gate

```js
if (!(await Eitri.isOnline())) {
  // show offline state
}
```

---

## Authoring workflow

When asked to write or edit Bifrost-using code:

1. **Identify the capability** the feature needs (storage? camera? deeplink?).
2. **Pick the right namespace** from the catalogue. Prefer the most specific (`codeScanner` over generic `camera`; `storage` over `fs` for key/value).
3. **`await` every call.** No fire-and-forget unless the API is genuinely sync (`canIUse`, `version`, `eventBus.publish/subscribe/clear/clearChannel`, `navigation.back/backToTop/addBackHandler/clearBackHandlers`).
4. **Run the permission flow** for sensors (`camera`, `geolocation`, `notification`): `checkPermission` → `requestPermission` if needed → real call.
5. **Guard with `canIUse`** for optional / platform-gated capabilities.
6. **Replace browser primitives** (`fetch`, `localStorage`, `navigator.*`, `window.open`).
7. **Handle errors.** Native bridges reject promises on permission denial, missing capability, or user cancel — wrap risky calls in `try/catch` and surface a Luminus `Toast`/`Alert` to the user.
8. **For unknowns, `WebFetch` `_internal_.<Class>.html`** and cite the URL.

When reviewing existing code, run the same checklist plus: hunt for `fetch(`, `localStorage`, `sessionStorage`, `navigator.`, `window.open`, raw `<a href`, and replace each with the Bifrost equivalent.

---

## When the docs disagree with this file

The official typedoc at https://cdn.83io.com.br/library/eitri-bifrost/doc/5.1.0/ wins. If you discover a discrepancy (renamed namespace, new method, removed capability, version bump), tell the user and update this `SKILL.md` accordingly.
