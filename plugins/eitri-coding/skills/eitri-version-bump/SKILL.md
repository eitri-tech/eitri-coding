---
name: eitri-version-bump
description: >-
  Semver bump reminder and automation for Eitri projects. ALWAYS activate
  when finishing any coding task in an Eitri project — remind the user to
  increment the version in eitri-app.conf.js (patch or minor) and offer to
  run the bump through the Python script. Also activate BEFORE creating or
  updating a pull request (or committing to one) in an Eitri project, and
  whenever the user mentions "bump", "version", "versão", "push-version",
  "deploy", "publish", "publicar", "pull request" or "PR" in the context
  of an Eitri-App.
---

# Eitri Version Bump

## When to activate

**When finishing any coding task** in an Eitri project (detected by
`eitri-app.conf.js` or `app-config.yaml`), this skill must be invoked to
remind the developer to bump the version.

**Before creating or updating a pull request** in an Eitri project, check
whether the version in `eitri-app.conf.js` has already been incremented
relative to the base branch. This is the moment the bump is most often
forgotten, because the code is already written and nothing else triggers
the reminder. If the version did not change, run the flow below **before**
opening the PR; if it did, just confirm the version to the user.

Also activate when the user mentions "bump", "version", "versão",
"push-version", "deploy", "publish", "publicar", "pull request" or "PR".

## Flow

1. **Read the current version** from `eitri-app.conf.js` and show it to
   the user:

   > 📦 **Current version:** `X.Y.Z` (in `eitri-app.conf.js`)

2. **Remind the user** that the version must be incremented before
   `eitri push-version`:

   > ⚠️ **Version reminder:** Before running `eitri push-version`,
   > increment the version in `eitri-app.conf.js`.

3. **Ask for the bump type:**
   - **patch** (e.g. `1.2.3` → `1.2.4`) — fixes, visual tweaks, internal
     refactors
   - **minor** (e.g. `1.2.3` → `1.3.0`) — new feature, new view, new
     integration
   - **major** (e.g. `1.2.3` → `2.0.0`) — breaking changes, significant
     rewrite
   - **Not now** — the user will bump manually later

4. **Suggest a `versionMessage`** based on the changes made in the task.
   The message is **mandatory** — every bump must have a description. It
   should be short and descriptive (one line). Examples:

   - `"Fix shipping cost calculation at checkout"`
   - `"New product detail screen"`
   - `"Refactor authentication providers"`

   Present the suggestion and ask whether the user wants to use it or
   edit it. **Do not proceed without a defined message.**

5. **Run the script** with the `--message` flag (always required):

   ```bash
   python3 "<SKILL_DIR>/scripts/bump_version.py" <patch|minor|major> <path/to/eitri-app.conf.js> --message "description of the changes"
   ```

   Replace `<SKILL_DIR>` with the absolute path of this skill's directory.

6. **If the user declines the bump**, respect that — they may want to do
   it manually later. Just confirm they are aware:

   > 👍 No problem. Remember to increment the version before the next
   > `eitri push-version`.

## Rules

- **Never bump without asking.** Always offer and wait for explicit
  confirmation from the user.
- **The `versionMessage` is mandatory.** Every bump must include a message
  describing the changes. Never run the script without `--message`.
  Suggest a message based on what was done in the task.
- **If the task was trivial** (e.g. only read code, answered a question,
  changed no files), there is no need to remind.
- **In multi-app workspaces** (`app-config.yaml`), identify which app was
  changed and offer the bump only for it.
- **Show the current version** before proposing the bump so the user has
  context.
- **After the bump**, show the new version and confirm the file was
  updated.
- **Reply in the user's language.** The quoted messages above are
  templates; translate them to the language the user is writing in.

## Script location

The Python script lives at:
[bump_version.py](./scripts/bump_version.py)
