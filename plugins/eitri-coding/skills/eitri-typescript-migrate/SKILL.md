---
name: eitri-typescript-migrate
description: How to migrate an Eitri-App workspace — a single app or a multi-app bundle (e.g. an Eitri Shopping storefront: home/pdp/cart/checkout/account plus a shared library) — from JavaScript to TypeScript by finding a sibling workspace built from the same boilerplate that already completed the migration, and replaying it mechanically instead of converting file-by-file. ALWAYS invoke this skill whenever the user asks to migrate, convert, or port an Eitri-App workspace from JS to TS; whenever `.js`/`.jsx` files coexist with an incoming TypeScript target; or whenever the user mentions a sibling, fork, or another client/environment's workspace built from the same template — this is common in Eitri, since bundles are frequently cloned per client from a shared boilerplate. Also invoke when interpreting a `tsc --noEmit` result in a workspace that consumes a published shared Eitri-App library, or when reviewing a TypeScript-migration PR for an Eitri workspace.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, WebFetch, Agent
---

# SKILL.md — Eitri TypeScript Migration

Companion to `eitri-specialist` (the Runtime Safety rules that Step 6 extends, not duplicates) and `eitri-shopping` (when the workspace being migrated is a commerce bundle, the SDK call sites you touch change type too). This skill covers one workflow: **moving an Eitri-App workspace from JavaScript to TypeScript by replaying a sibling's migration**, when one exists.

It applies to any Eitri workspace — a single Eitri-App or a multi-app bundle (an Eitri Shopping storefront — `home`/`pdp`/`cart`/`checkout`/`account` plus a client `shared` library — is the most common shape, but not a requirement). Eitri workspaces are frequently cloned per client/environment from the same boilerplate, so a sibling that already migrated is the rule, not the exception.

> **This skill assumes a sibling exists and stays comparable — verify both, every time.** A candidate sibling may have drifted since its own migration, may cover a different commit range, or may not exist at all. Steps 1–2 exist to prove the premise before you act on it; do not skip them because a fork "obviously" looks like the same app.

---

## Step 1 — Find out if this has already been done for a sibling

Before converting anything by hand, check whether another workspace built from the same boilerplate has already migrated.

Signals that a sibling might exist:

- The workspace is one of a **named fleet** — client/environment bundles typically share an otherwise identical `app-config.yaml` shape (same app roster) with only a name/id differing. Seeing several similarly-structured entries for different clients is itself the signal.
- The user mentions another client, another store, or "we did this already for X".
- A workspace with the same boilerplate origin is reachable in the same `~/workspace/<org>/` tree.

```bash
# locate candidate siblings under the usual workspace root
find ~/workspace -maxdepth 3 \( -name 'app-config.yaml' -o -name 'eitri-app.conf.js' \) 2>/dev/null

# does the candidate already have TypeScript, and does this workspace not?
find <candidate-sibling-root> -name '*.tsx' -o -name '*.ts' | head -1   # non-empty => sibling migrated
find <this-workspace-root>    -name '*.tsx' -o -name '*.ts' | head -1   # empty => not yet migrated here

# same app roster is a strong signal of "same boilerplate"
diff <(cd <candidate-sibling-root> && ls -d */ 2>/dev/null | sort) \
     <(cd <this-workspace-root>     && ls -d */ 2>/dev/null | sort)
```

If no sibling exists, or the app roster genuinely differs, this skill does not apply — fall back to a normal file-by-file JS→TS conversion (still governed by `eitri-specialist`'s Runtime Safety rules, since you'll be touching every file anyway).

If a sibling exists, **do not assume it's usable yet.** Go to Step 2.

## Step 2 — Verify true parity before trusting the replay

"Looks like a fork" is not proof. Prove it by diffing every file, after normalizing away the one expected difference — the client/project name baked into paths and strings.

```bash
SIBLING=<path-to-sibling-repo>        # already migrated
MINE=<path-to-this-repo>              # not yet migrated
SIBLING_TOKEN=<sibling-project-name>  # e.g. the sibling's app/repo name
MINE_TOKEN=<this-project-name>        # e.g. this app/repo name

diverged=0
while IFS= read -r -d '' f; do
	rel="${f#$MINE/}"
	sib="$SIBLING/$rel"
	if [ -f "$sib" ]; then
		if ! diff -q \
			<(sed "s/$MINE_TOKEN/@@/g" "$f") \
			<(sed "s/$SIBLING_TOKEN/@@/g" "$sib") >/dev/null 2>&1; then
			echo "DIVERGED: $rel"
			diverged=$((diverged + 1))
		fi
	else
		echo "ONLY IN MINE (no sibling counterpart): $rel"
	fi
done < <(find "$MINE" -type f \( -name '*.js' -o -name '*.jsx' \) -print0)

echo "total diverged / mine-only: $diverged"
```

Interpret the result against the migration's own commit range (Step 3), not in isolation:

- **Expected, harmless divergence:** files the migration commit range never touched — per-app config files (different ids/versions per client), CI scripts, anything client-specific by design. A handful of these is normal and does not invalidate the replay.
- **Disqualifying divergence:** any file the migration range *did* modify that also differs here for reasons unrelated to the project-name token. If that happens, the two trees are not close enough to replay blindly — narrow the replay to the unaffected subset, or fall back to manual conversion for the divergent files.

Only proceed to Step 3 once you can account for every diverged file.

## Step 3 — Generate, rewrite, and stage the patches

Once parity is confirmed, get the sibling's migration as a sequence of patches and adapt them to this project — without redoing the work.

```bash
# 1. In the SIBLING repo, generate one patch per migration commit, in the order
#    the migration actually happened (shared library first, then each consumer
#    app, doc commits last).
cd "$SIBLING"
git format-patch --no-signature -o /tmp/patches <before-sha>..<after-sha>

# 2. Rewrite paths AND contents in one pass. git format-patch output is plain
#    unified-diff text, so a global sed both renames files and rewrites every
#    import/string reference inside them.
sed -i "s/$SIBLING_TOKEN/$MINE_TOKEN/g" /tmp/patches/*.patch

# 3. Strip anything sibling-specific that has no meaning here — e.g. an
#    internal ticket reference baked into commit messages.
grep -l '<sibling-ticket-prefix>-[0-9]\+' /tmp/patches/*.patch
sed -i -E "s/<sibling-ticket-prefix>-[0-9]+ ?//g" /tmp/patches/*.patch

# 4. Fix the Co-Authored-By trailer to whoever/whatever is actually doing this
#    replay — do not carry the sibling session's attribution forward.
sed -i "s/^Co-Authored-By: .*/Co-Authored-By: <correct-author>/" /tmp/patches/*.patch

# 5. Verify nothing sibling-specific leaked before applying anything.
grep -ril "$SIBLING_TOKEN\|<sibling-ticket-prefix>" /tmp/patches
# must return nothing — if it does, fix the patch files and re-check
```

## Step 4 — Apply in small, logical batches; type-check after each one

Apply one batch at a time — typically one app per batch, in dependency order (shared library alone first, then each consumer app, doc-only patches last) — and run a full type-check after every batch. This makes a regression attributable to a specific batch instead of an undifferentiated wall of errors at the end.

**Capture a baseline before applying anything:**

```bash
cd "$MINE"
npx -y -p typescript@5 tsc --noEmit -p tsconfig.json 2>&1 | tee /tmp/tsc-baseline.txt
wc -l /tmp/tsc-baseline.txt
```

> **`npx -p` is mandatory, not a style choice.** Eitri workspaces typically have no `package.json` and no local `typescript` install anywhere in the tree. Plain `npx tsc` fails with *"could not determine executable to run"* — you must pin the package explicitly: `npx -y -p typescript@5 tsc --noEmit -p tsconfig.json`.

Record what the baseline errors actually are, not just the count — in a healthy replay candidate, baseline errors live entirely **outside the repo**, inside the Eitri CLI's auto-generated `~/.eitri/<application-id>/@types/` cache, and are not fixable from application code. Anything outside that location in the baseline is a pre-existing issue worth flagging to the user before you start.

**Apply and check, batch by batch:**

```bash
git am --no-signature /tmp/patches/0001-shared-*.patch
npx -y -p typescript@5 tsc --noEmit -p tsconfig.json 2>&1 | tee /tmp/tsc-after-shared.txt
diff /tmp/tsc-baseline.txt /tmp/tsc-after-shared.txt   # anything new here is real

git am --no-signature /tmp/patches/0002-home-*.patch /tmp/patches/0003-home-*.patch
npx -y -p typescript@5 tsc --noEmit -p tsconfig.json 2>&1 | tee /tmp/tsc-after-home.txt
diff /tmp/tsc-after-shared.txt /tmp/tsc-after-home.txt

# ...repeat per app, doc-only patches last
```

**If `git am` fails, stop and investigate — never force through.** The entire premise of a replay is that the two trees are close enough to be treated as one, modulo the project-name token. A failed apply means that premise broke somewhere Step 2 didn't catch. Do not silently retry with `git am --3way` to push past it; find out what actually diverged first, since `--3way` can silently produce a merge that compiles but doesn't match either intended state.

## Step 5 — Interpreting the type-check: the shared-library `@types` cache trap

> **Read this before trusting any post-replay error count, including a "clean" one. This is the single most valuable, least obvious thing this skill knows.**

Once a shared Eitri-App library has been **published** at least once, the Eitri CLI drops a generated stub into the consuming app's local cache: `~/.eitri/<application-id>/@types/<shared-app-name>/index.d.ts`. That stub is generated from whatever the library looked like when it was still JavaScript, and types every export as loosely as possible — for example, `declare module "components/X" { function X(props: any): JSX.Element }` for every single component.

TypeScript's module resolution **prefers that generated `.d.ts` over the real `tsconfig.json` `paths` mapping into `src/export.ts`.** So in any workspace where the shared library has already been published — even once, even long ago — `tsc` silently stops checking the app↔shared-library boundary. Everything crossing that boundary resolves to `any`, and prop-mismatch or shape-mismatch bugs at that boundary go undetected, with no error and no warning.

The consequence: **a sibling repo's `tsc --noEmit` being clean is not proof that your migration will be too — and it isn't even proof that the sibling's own migration was checked at the boundary that matters most.** It can be the opposite: a workspace where the shared library has *never* been published locally sees the real boundary and may surface *more* genuine errors than the sibling ever could. Check for the cache before comparing baselines:

```bash
ls ~/.eitri/*/@types/<shared-app-name>/ 2>/dev/null
```

- **If this path exists:** the tsc run in that workspace is not checking against the local shared source. Expect false negatives at the app↔shared boundary specifically. If possible, remove or rename the cached `@types/<shared-app-name>` directory (or otherwise force resolution to the `paths` entry) before trusting a "clean" result as meaningful.
- **If it does not exist:** `tsc` resolves the real `src/export.ts`, and your check is *stricter* than the sibling's own — expect to find genuine errors at the boundary that the sibling's migration never had to face, because its `tsc` literally could not see them.

Treat any new errors surfaced this way as real findings, not replay noise — they are exactly the class of bug this skill exists to catch. Go to Step 6.

## Step 6 — Fixing boundary errors: the recurring pattern, and which fixes are real bugs

Boundary errors uncovered by Step 5 tend to reduce to **one recurring shape**: a shared library's TypeScript interface declares a field as *required* when the actual backend payload (VTEX, Wake, Shopify, or any other API) can omit it, while the call site — or the app's own local duplicate type — already treated it as optional. The correct fix is never "just add `?` to the type." It's **widen the type and add the runtime guard the type was pretending wasn't necessary**, because several of these turn out to be genuine, previously-undetected runtime bugs.

Checklist — for each "field should be optional" finding, classify it and fix accordingly:

- **Iteration over a possibly-missing array, inside a truthy check on the parent only.** `if (cart) { cart.items.reduce(...) }` checks `cart` but not `cart.items` — a cart without an items array crashes the consuming component. Fix: `(cart.items ?? []).reduce(...)`, not just widening the type.
- **String method on an optional text field with no fallback.** `sla.shippingEstimate.indexOf('h')` — a shipping option missing the estimate string crashes the screen that calls it. Fix: `(sla.shippingEstimate ?? '').indexOf('h')`.
- **Numeric accumulation on a possibly-missing numeric field.** `existing.price += sla.price` / `acc + current.price` where `price` can be `undefined` doesn't crash — it silently produces `NaN`, which then renders as a literal wrong number (e.g. `"R$ NaN"`) in the UI. This is worse than a crash: it's visible-but-wrong, and nobody notices until a user reports it. Fix: `?? 0` at every accumulation site touching that field — but only where zero is genuinely the correct business value (see `eitri-specialist`'s Runtime Safety guidance on choosing a fallback by meaning, not convenience).
- **Type-accuracy fixes with no runtime behavior change** — still worth doing, but don't need a guard: an interface missing fields the rendering component actually reads (forcing consumers into `unknown[]` workarounds); a prop typed `string` when the component genuinely accepts JSX and a real call site passes JSX; a prop passed to a component that silently never reads it (a dead no-op prop — confirm with a repo-wide grep before deleting, then delete it).
- **A native API whose `.d.ts` declares a required parameter that the JSDoc and runtime both treat as optional** (Bifrost APIs are a common source of this). Before inventing a new workaround, `grep` the repo for an existing defensive-cast pattern already used against the same API elsewhere — reuse it instead of writing a new one. Note the trap here: a naive `() => Api.method()` wrapper still fails type-check, because TypeScript forwards the arity of the *outer* function's declared type, not the call expression inside it.

Every fix in this step should answer the same question `eitri-specialist`'s Runtime Safety section asks of any optional data: *what does the user see when this field is actually missing?* If the honest answer before your fix was "a crash" or "a wrong number that looks correct," you found a real bug, not type noise — say so explicitly when reporting the migration's results.

## Step 7 — Port and correct the sibling's project doc

If the sibling wrote an `AGENTS.md` / `CLAUDE.md` project-map doc during its own migration, replay those commits too, through the same patch-and-token-substitution mechanism as Step 3. Do not treat this as pure find/replace — verify and correct the facts that a token swap cannot fix:

- The Eitri `application-id` UUID(s) — these are per-workspace, never derived from the project name.
- Per-app version numbers in each app's config — these diverge by design (Step 2's expected-divergence list).
- Any "see commit `<hash>`" reference — a hash from the sibling's own git history means nothing in this repo and must point at the equivalent commit here (or be rephrased if there is no equivalent).

Then **add** a new paragraph to that doc — don't just port — documenting the `@types/<shared-app-name>` cache-shadowing trap from Step 5, scoped to this specific shared library. It's a landmine for whoever publishes that library next, and the doc is the only place that knowledge will survive past this session.

## Step 8 — Verify before calling it done

- **Re-run the Step 2 byte-parity diff** across the full migrated file set (now including any doc commits). It should show **zero divergences beyond the already-accounted-for config/CI set** — this proves the replay was mechanically faithful *before* you layer manual fixes on top, and it's cheap enough to run again after Step 6's fixes too.
- **`tsc --noEmit` final error count equals the Step 4 baseline exactly** — not "close to." Any gap is either an unfixed boundary error (back to Step 6) or a fix that introduced a new one.
- **Enumerate every remaining `.js`/`.jsx` file and justify it.** Deliberate holdouts are normal (a Service Worker — converting collides `lib.dom` vs `lib.webworker` global typing; vendored third-party files; minified vendor bundles) but every one should have a stated reason, not just be an oversight.
- **Build every app** (`eitri app start -p` or the workspace's equivalent build command) — all apps in the bundle must compile, not just type-check clean.
- **Flag the device smoke test as still required, explicitly, before merge.** Type-check and build passing is necessary but not sufficient — neither exercises the runtime branches gated on actual data shape, which is exactly where Step 6's real bugs lived. Call this out especially for cart/checkout purchase-path screens, and hand off to `eitri-device` for the actual device/simulator pass rather than claiming completion without it.

---

## What not to assume

- **Don't assume the sibling stays identical forever.** Forks drift the moment either repo gets its next independent commit — run Step 2's parity check fresh every time, never from memory of a previous comparison.
- **Don't assume a clean sibling `tsc` means your migration will be too.** The `@types/<shared-app-name>` cache (Step 5) can be hiding the exact app↔shared boundary you most need checked — verify the cache's presence before trusting any baseline comparison, in either repo.
- **Don't force `git am --3way` through a failure.** The premise of replay is that the trees are identical modulo one token; a failed apply means that premise broke, and finding out where is more valuable — and safer — than muscling past it with a three-way merge that might compile without matching either intended state.
- **Don't assume every diverged file blocks the replay.** Config files the migration's commit range never touched are expected to diverge and don't invalidate the technique. Only divergence inside files the migration range *did* touch is disqualifying.
- **Don't skip the device smoke test because build + type-check passed.** This skill's own case study found real crash/`NaN` bugs that only a runtime path would surface — a green `tsc` run is not evidence the purchase path works.
- **Don't port doc facts blindly.** Commit hashes, UUIDs, and version numbers are sibling-specific even after a clean token substitution, and must be re-verified against this repo's own history and config — not assumed correct because the surrounding prose ported without incident.
