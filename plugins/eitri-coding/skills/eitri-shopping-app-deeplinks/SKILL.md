---
name: eitri-shopping-app-deeplinks
description: Fetch the Android (`assetlinks.json`) and iOS (`apple-app-site-association`) App Links / Universal Links files for a brand built from the `eitri-shopping-app` app-generator (bitbucket.org/smartsolutionteam/eitri-shopping-app). ALWAYS invoke this skill whenever the user asks for a brand's deeplink files, `assetlinks.json`, `apple-app-site-association`, App Links / Universal Links config, or wants to run `app-generator`'s `generate` command to produce them. Covers locating or cloning the `eitri-shopping-app` repo, resolving the app folder under `app-generator/apps`, running the generator, reading the resulting files from `generated-apps/<app>`, and — critically — reconstructing the iOS file by hand from `appConfig.js` when generation silently fails to produce it, which is expected on any machine that is not a Mac. NOT for the `Eitri.deeplink.*` runtime API (opening/checking a deeplink from inside app JS) — that's `eitri-bifrost`.
allowed-tools: Read, Grep, Glob, Bash, Write
---

# SKILL.md — Eitri Shopping App Deeplinks

Fetches the two files a brand needs to register **App Links (Android)** and **Universal Links (iOS)** for an `eitri-shopping-app` brand: `assetlinks.json` and `apple-app-site-association`. Both are produced by running that repo's `app-generator`, then reading its output — this skill does not compute them from scratch except as an iOS fallback (Step 5).

For the bigger picture — the deeplink URL format (`prefix://action?params`), supported actions, and why these platform files must be published under `.well-known/` on the brand's own domain — see the official docs: https://docs.eitri.tech/en/eitri-shopping/deeplinks/. That page covers the deeplink resolver addon and URL scheme; it does not cover `app-generator` or `appConfig.js`, which is what this skill is for.

**Not what this skill is for:** opening or checking a deeplink from inside an Eitri-App's own JavaScript (`Eitri.deeplink.canOpen` / `Eitri.deeplink.open`) — that's the `eitri-bifrost` skill's runtime API, sourced from its own typedoc. This skill is about the *native-shell registration* side: the platform files that let the OS route a tapped link to the app at all.

Unless the user asks for only one platform, **assume they want both.**

> **Unlike Bifrost/Luminus, there is no live doc for `app-generator`'s internals.** Everything below (file paths, the plutil root cause, the reconstruction algorithm) was read directly out of `app-generator/services/deepLinkHandler/*.ts` and `plistTools.ts` at one point in time — there's no typedoc or docs page to re-check against. If behavior here doesn't match what you see in a real run, prefer re-reading that source over trusting this snapshot.

---

## Step 1 — Locate or update `eitri-shopping-app`

The repo is `https://bitbucket.org/smartsolutionteam/eitri-shopping-app` (private Bitbucket, org `smartsolutionteam`).

1. Look for an existing local checkout first — check common workspace roots (siblings of the current project, e.g. `~/workspace/calindra/eitri/eitri-shopping-app`) and ask the user if none is found nearby. Confirm it really is this repo (`git -C <path> remote -v` should mention `smartsolutionteam/eitri-shopping-app`).
2. **If found locally:** before doing anything else, get it current — check `git status` first (per the usual safety rule: never discard uncommitted work silently), then:
   ```bash
   git -C <path> checkout main
   git -C <path> pull
   ```
   If the checkout has local changes or isn't on `main`, stop and ask the user how to proceed rather than switching branches or pulling over their work.
3. **If not found anywhere:** clone it fresh. A plain clone already checks out `main`, so no extra step is needed:
   ```bash
   git clone https://bitbucket.org/smartsolutionteam/eitri-shopping-app.git
   ```
   Ask the user where they'd like it cloned if there's no obvious sibling location.

From here on, `<repo>` means this checkout's root.

## Step 2 — Resolve the app name

`<app-name>` is a folder under `<repo>/app-generator/apps`, organized in up to **two levels**: either `apps/<AppName>` directly, or `apps/<Group>/<AppName>` (groups seen in the wild: `working`, `production`, `mobfiq`, `pocs`, `disabled`, `mobfiq-pocs`). The generator itself resolves both levels automatically — you only need the leaf name (`Seara`, not `working/Seara`) — so find it with:

```bash
find <repo>/app-generator/apps -maxdepth 2 -type d -iname "<app-name>"
```

If it doesn't match anything, list the group folders and ask the user to confirm the exact name/casing — app names are case-sensitive folder names (`OscarCalcados`, `MonteCarlo`, ...).

Each app folder contains an `appConfig.js` — the single source of truth for that brand's deeplink data (Step 5 leans on it directly):

- `universalDeeplink.urlMapping.hosts[]` — one entry per domain (`host`), each with its `routes[].path` and (Android-only) `androidSHA256CertFingerprints`
- `androidProperties.packageName`
- `iosProperties.{bundleId, developerTeam}`
- `useWebAuthService.active` — when true, the iOS file also gets a `webcredentials` block

## Step 3 — Run the generator

From `<repo>/app-generator`:

```bash
cd <repo>/app-generator
npm install   # only if node_modules is missing
node --run generate <app-name>
```

If the Node version doesn't support `--run` (added in Node 22; check with `node --version`), fall back to:

```bash
npm run generate <app-name>
```

Notes:
- You can restrict to one platform by appending `android` or `ios` (e.g. `... generate Seara android`) — useful if the user only wants one file, since a full run does real image/Xcode-project work for both platforms.
- **Do not add `--dev`** unless the user explicitly wants a dev build's deeplink files — `--dev` suffixes `packageName`/`bundleId` with `.dev`, which produces files that don't match the real store listing.
- A non-zero exit or `[ FAILED ]` in the log for one platform doesn't necessarily block the other — check `generated-apps/<app-name>` regardless (next step) before concluding nothing was produced.

## Step 4 — Read the generated files

Output lands in `<repo>/generated-apps/<app-name>/`, one subfolder per configured host (from `universalDeeplink.urlMapping.hosts` in `appConfig.js` — a brand can have more than one, so check for all of them):

| Platform | Path |
| --- | --- |
| Android | `generated-apps/<app-name>/android/deeplinks/<app-host>/assetlinks.json` |
| iOS | `generated-apps/<app-name>/ios/deeplinks/<app-host>/apple-app-site-association` |

`<app-host>` is the `host` value itself (e.g. `www.seara.com.br`), used verbatim as the folder name.

Android's `assetlinks.json` is plain JS with no OS dependency, so it reliably appears after Step 3 regardless of platform. If it's missing, something else went wrong in generation — check the log, don't assume it's the same macOS trap described next.

## Step 5 — The iOS trap (non-Mac machines) and its fallback

**`apple-app-site-association` generation only succeeds on macOS**, and it fails **silently** — the `generate` command still reports overall success. Root cause, confirmed straight from `app-generator/services/deepLinkHandler/`:

- `iosDeepLinkHandler.ts`'s `processDeeplinks` first patches the `.entitlements` files via `plistTools.ts`, which is a documented macOS-only wrapper around `/usr/bin/plutil` ("macOS-only: wraps /usr/bin/plutil. Used by ios* handlers; no Windows/Linux fallback.").
- On Linux/Windows, `/usr/bin/plutil` doesn't exist, that call throws, and the **whole method** is wrapped in one `try/catch` that just logs and swallows the error.
- Because `generateAppSiteAssociationFile()` (the function that actually writes `apple-app-site-association`) runs *after* the plutil step **in the same try block**, it never executes. Only `ios/deeplinks/DeeplinksTutorial.md` ends up on disk — no per-host folder, no file.

So: **on a non-Mac machine, expect `ios/deeplinks/<app-host>/` to not exist after Step 3.** This is not a bug to troubleshoot — it's expected, and it is exactly what the user is asking this skill to work around.

**Fallback — reconstruct it from `appConfig.js`.** The generation logic itself is pure JSON assembly (nothing macOS-specific about the *content*), so reproduce it directly:

```js
// one output file per host in universalDeeplink.urlMapping.hosts
const appID = `${iosProperties.developerTeam}.${iosProperties.bundleId}`
const paths = hosts
  .filter(h => h.host === currentHost)
  .flatMap(h => h.routes.map(route => route.path.replace(".*", "*")))

const content = {
  applinks: {
    apps: [],
    details: [{ appID, paths }],
  },
  // only when useWebAuthService.active is true
  ...(useWebAuthServiceActive ? { webcredentials: { apps: [appID] } } : {}),
}
```

Read the needed fields straight from `<repo>/app-generator/apps/**/<app-name>/appConfig.js` (Step 2), build this JSON per host, and either hand it directly to the user or write it to the same path the real generator would have used (`generated-apps/<app-name>/ios/deeplinks/<app-host>/apple-app-site-association`) so it's discoverable the same way. **Always tell the user this file was hand-reconstructed, not generated by the real pipeline** — if a Mac-generated copy exists in CI artifacts or a release, that one is authoritative; this is a stand-in.

## Step 6 — Deliver

Default to returning **both** files' contents (or paths, if the user just wants to know where they landed) unless the user asked for only one platform. If a brand has multiple hosts, return all of them and say which host each file belongs to — don't silently pick one.

## What not to assume

- App names are exact folder names — don't guess casing or abbreviate.
- A missing `assetlinks.json` is a real failure (investigate); a missing `apple-app-site-association` on a non-Mac machine is expected (Step 5).
- Never use `--dev` output as if it were the production deeplink files — the package/bundle IDs won't match the store listing.
- `appConfig.js` is a live source of truth, not a cache — if the generated file and `appConfig.js` disagree, re-run generation or re-derive from `appConfig.js` rather than trusting a stale `generated-apps/` output.
