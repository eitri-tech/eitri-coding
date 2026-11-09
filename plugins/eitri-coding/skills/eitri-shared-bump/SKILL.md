---
name: eitri-shared-bump
description: 'Awareness report for shared-library bumps in an Eitri project — what was FIXED, ADDED, BROKEN (breaking changes), which NEW REMOTE-CONFIG KEYS the new code needs, and which KNOWN ISSUES exist between the version a project pins and the version it is about to pin (or the latest). Covers every shared Eitri-App linked in `eitri-app-dependencies` (`isEitriAppShared: true`): the public `eitri-shopping-vtex-shared`, `eitri-shopping-wake-shared`, `eitri-shopping-shopify-shared` (repo `eitri-tech/eitri-shopping-services-shared`) and any sibling shared folder of the workspace (e.g. a client `*-shared` app listed in `app-config.yaml`). ALWAYS invoke this skill: (1) when a hook reports outdated or bumped shared pins; (2) right after any edit to a `version` inside `eitri-app-dependencies`, and before finishing a task whose diff changes one; (3) when the user asks to update/bump/upgrade a shared library, asks "what changed in the shared", "is it safe to bump", or reviews/opens a dependency-update PR. It reports; it never changes pins by itself.'
allowed-tools: Read, Grep, Glob, Bash, WebFetch, Agent
---

# SKILL.md — Eitri Shared Bump

Companion to `eitri-shopping` (what the commerce SDKs are and how to read them) and `eitri-specialist` (how Eitri code is written). This skill answers one question before a bump is made, or while it is being reviewed:

> **"If this project moves from version A to version B of a shared library, what gets fixed, what gets added, what can break, and what do I have to configure?"**

It is **awareness, not automation**: it produces a report and a recommendation. It never edits `eitri-app-dependencies`, never bumps `version`, never publishes. The user decides.

## Why this exists

`eitri-tech/eitri-shopping-services-shared` has **no CHANGELOG and no GitHub Releases**. Releases mix unrelated work (payments, anti-fraud fingerprinting, auth/refresh-token fixes, config sources moving) and some need **remote-config keys that live outside the code** (a typical bump PR says "the key was already added to remote config, outside this PR"). Teams were bumping blind. This skill rebuilds the changelog from git so the bump is an informed one.

If a `CHANGELOG.md` exists in the library directory one day, the script returns it (`changelogMd`) and it becomes the primary source; git stays as the way to verify it.

## What counts as a "linked" shared

Every key of `eitri-app-dependencies` with `isEitriAppShared: true`, in every `eitri-app.conf.js` of the project (single app) or workspace (`app-config.yaml`). Three kinds:

| Kind | Example | Where the history comes from |
| --- | --- | --- |
| `upstream` | `eitri-shopping-vtex-shared` | public repo `eitri-tech/eitri-shopping-services-shared`, directory of the same name — cached partial clone |
| `sibling` | `eitri-shopping-<client>-shared` (a sister folder in the workspace, `shared: true` in `app-config.yaml`) | the workspace's own git history |
| `external` | anything else | none — say so, and ask where its history lives |

A sibling shared usually **wraps an upstream one** (it pins `eitri-shopping-vtex-shared` itself *and* every app pins both). A bump therefore ripples: upstream pin → sibling `version` bump → apps re-pin the sibling. Report each layer; don't collapse them.

## Step 1 — Run the report

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/eitri-shared-bump/scripts/shared-changes.mjs" --root "<project or workspace root>"
```

- No flags: every linked shared, pinned (oldest pin) → latest.
- Bump in progress (the hook tells you `lib: A → B`): `--only <lib> --from A --to B`. The report then also includes `skipped` — what lies between B and the latest, so the user sees what they are *not* taking.
- `--pins-changed` lists pins changed in the working tree/branch vs the base branch (what triggered you). If the default branch is not `main`/`master`/`develop`/`trunk`, pass `--base <ref>`; when no base resolves the output carries a `warning` and only uncommitted bumps are visible.
- `--no-fetch` skips `git fetch` of the cache (a failed fetch is an error, not a silent stale read; if you use `--no-fetch` after one, tell the user the data may be stale); first run clones (~1 s, blobs are lazy, a full report can take tens of seconds).

Needs `git` and network for the upstream clone. If the clone/fetch fails, **say so and stop for that library** — do not reconstruct a changelog from memory or from this skill's notes.

Key fields per library: `status` (`outdated` / `up-to-date` / `ahead-of-main`), `versionSkew` (apps pin different versions of the same library — flag it), `changelogMd` (a `CHANGELOG.md` of the library, when it exists — prefer it), and `changelog`:

- `releases[]` — one per published version in the range, with its `messageVersion` (the publish message CI uses; usually the best one-liner). The tag commit carries it in the library's `eitri-app.conf.js`.
- `commits[]` — subject, body, files, `merge`, `touchesPublicSurface`, `touchesConf`. Merge commits carry the PR number/branch name.
- `remoteConfigKeys.added/removed` — keys the code in the range started/stopped reading (`getContent('…')`, `appConfigs.*`, `providerInfo.*`, `storePreferences.*`), with the files. A heuristic: confirm in the diff.
- `from` / `to` — anchors `{sha, via: tag|conf-history, ambiguous, why}`. **If `ambiguous` or `notes` is non-empty, tell the user the range may include or miss changes** (tags are shared by all `*-shared` libraries; versions get rolled back and re-bumped) and name the candidates.
- `unreleased` — commits on `main` after the target release; `exportDiff` — the `git diff` commands for the public surface; `skipped` — the same analysis for target → latest when the target is below the latest.
- `gitDir` (upstream) + anchor SHAs let you run `git --git-dir <gitDir> diff <from> <to> -- <lib>/<path>` yourself.

## Step 2 — Classify, from evidence

Subjects are written in two languages and are often vague ("chore: version", "antifraude da koin"). Do not classify on subject alone for anything that matters; open the diff.

```bash
git --git-dir "<gitDir>" show <sha> --stat
git --git-dir "<gitDir>" diff <fromSha> <toSha> -- <lib>/src/export.js   # public surface (or export.ts)
git --git-dir "<gitDir>" diff <fromSha> <toSha> -- <lib>/src/services/<Area>
```

| Bucket | What to look for |
| --- | --- |
| **Added** | `feat:` commits; new methods/namespaces in `export.js` or the facade; new tracking/fingerprint providers; new payment methods |
| **Fixed** | `fix:` commits; say *what symptom goes away* (e.g. "refresh-token race: user logged out after concurrent calls"), not the commit title |
| **Breaking / risky** | removed or renamed exports; changed signature or **return shape** (the SDK unwraps responses, so a shape change is silent); a method that used to throw now returns falsy (or vice-versa); config source moved (`providerInfo` / `storePreferences` / `appConfigs`); default values changed (sales channel, cart item id, token lifetime); behavior now gated by a remote-config key |
| **Needs setup** | `remoteConfigKeys` — for each key: where it is read, what happens when absent (silently disabled? error?), and that it must exist **in every environment (dev and prod)** *before* the build ships. Third-party keys (fingerprint, anti-fraud, analytics) need the vendor-side setup too |
| **Known issues / watch** | commits in `unreleased` that fix something introduced inside the range; `revert`/`rollback` commits and `rollbacks[]`; a `fix:` for an area also touched by an in-range `feat:` (regression chasing); version skew between apps; TODO/FIXME added in the range; anything the diff shows is half-done |

State your confidence per item: **verified in diff** vs **inferred from commit message**. If a range is large, group by area (cart, checkout, customer/auth, search, tracking, config) instead of listing every commit.

## Step 3 — Impact on *this* project

A release note is only useful relative to what the project calls. For every added/changed/removed symbol, grep the project:

```bash
grep -rEn "\b(Vtex|Wake|Shopify)\.<namespace>\.<method>\b" src */src 2>/dev/null
grep -rEn "<RemoteConfigKey>|<Method>" --include=*.js --include=*.jsx --include=*.ts --include=*.tsx .
```

Also check the sibling shared's service layer (the wrapper): it is where signature and return-shape changes should be absorbed, and where they bite first. Report "used in N places (files…)" or "not used here — no impact".

## Step 4 — The report

Write it in the user's language. Short, scannable, honest:

```
## <lib>  <pinned> → <target>   (latest: <latest>)   [outdated | up-to-date | skew: …]
Releases: 1.20.0 "<messageVersion>", 1.20.1 "…", …

✅ Fixed       - <symptom> (<sha>, verified)
➕ Added        - <capability> (<sha>)
⚠️ Breaking    - <what changes, who is affected in this project, what to do>
🔧 Needs setup - remote-config key `<key>` (dev + prod) — <what it enables / what happens if missing>
🐞 Known issues - <issue> (<evidence>)
🎯 Impact here  - <files/call sites or "none">
📌 Not taking   - <changes between target and latest, if target < latest>

Recommendation: <version to move to and why — the lowest that gives the user what they need,
unless a known issue in it is fixed in a later one> · <checklist>
```

Recommendation rules: move to the version that fixes the user's problem, not blindly to the newest (same rule as `eitri-shopping` Step 6); if the lowest good version has a known issue fixed later, say so; if apps pin different versions, recommend aligning them. Checklist after a bump: bump each touched app's own `version`; in a workspace with a sibling shared, bump the sibling's `version` (+ `versionMessage`) and re-pin it in the apps; shared libraries publish first; confirm remote-config keys exist in every environment; run on a device/simulator (`eitri-device`) through the flows the changes touch.

When invoked at the **end of a task** because pins changed, compare what the diff actually pinned against what you reported: flag a pin that does not match the target the user asked for, apps left on an old pin, or a sibling shared not re-bumped.

## What not to do

- Do not edit pins, versions or remote config. Offer, don't apply.
- Do not invent changes. No data → say "could not determine", with the reason.
- Do not treat the latest `main` as published: `unreleased` commits are not in any release yet.
- Tags `shared-<version>` are shared by all `*-shared` libraries and can point at another library's release; the script validates the library's own `version` at the tagged commit. Never `git checkout` a tag and assume it is this library's.
- Do not dump the raw commit list as the answer. The value is the classification and the impact.
