---
name: mobile-icon
description: Check whether an image (SVG or PNG) is good enough to be an app icon on iOS and Android, explain what is wrong, and generate store-ready assets. Use whenever the user mentions an app icon, launcher icon, adaptive icon, Play Store / App Store icon, ícone do app, "logo as icon", icon rejected by a store, an SVG that renders wrong or looks different on device, Material You / themed / monochrome icons, or iOS Liquid Glass / Icon Composer / dark and tinted icons. Runs check.mjs (SVG lint with path/stroke/transform/CSS analysis + render + safe-zone, contrast, alpha, size checks) and build.mjs (iOS 1024 without alpha, Android adaptive foreground/monochrome/background, Play 512, preview sheet). Pure Node, no npm install; SVG pixel checks need resvg, rsvg-convert, Inkscape or ImageMagick.
allowed-tools: Read, Grep, Glob, Bash
---

# mobile-icon

Decide whether a logo can be an app icon on **iOS and Android**, say exactly what blocks it, and produce the files that fix it. SVGs get extra scrutiny: an SVG that looks perfect in a browser can lose shapes, colors or alignment once an icon pipeline re-renders it, and **how the paths are built is what decides that** (strokes, transforms, CSS, clip/mask, text, arcs, precision — see `references/svg-paths.md`).

Scripts live in `${CLAUDE_SKILL_DIR}/scripts/` (in other clients, the `scripts/` folder next to this file). Both are zero-dependency Node (≥ 18):

| Script | Does |
| --- | --- |
| `check.mjs` | Lints the SVG, renders it, measures the pixels, reports per platform: ✅ ready / ⚠️ caveats / ❌ blocked, with the fix for each finding. Optional contact-sheet preview. |
| `build.mjs` | Produces `ios/AppIcon-1024.png` (RGB, no alpha), `ios/foreground-1024.png` (glyph layer), Android adaptive foreground + monochrome per density + XML + background color, `play/play-store-512.png`, `preview.png`. |

Specs, thresholds and the reasoning behind them: `references/platform-specs.md`. Material You and Liquid Glass advice: `references/modern-icons.md`.

---

## Step 1 — Get the source

Use the file the user named; otherwise look for the likely logo (`Glob` for `*.svg`, `logo*`, `icon*` outside `node_modules`) and confirm which one. Prefer the **SVG** over any PNG of it: every size is then rendered crisp.

Ask once, one line, only if it is not already clear from the conversation or the project:

> Qual é a cor principal da marca (hex)? Vou usar como fundo do ícone, a menos que você prefira outro.

**Never overwrite the user's file.** Everything is written to a new folder (default `./mobile-icon-out`).

## Step 2 — Run the check

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check.mjs" <logo.svg|logo.png> \
  --bg "<brand hex, if known>" \
  --preview "<out-dir>/check-preview.png" --render-out "<out-dir>/render.png"
```

- Exit code `1` = at least one blocking error; `2` = unreadable input; `3` = incomplete (an SVG that could not be rendered — the verdict is "incomplete", never "ready"). `--json` gives machine-readable output.
- `--role` judges a file for what it is: `source` (default, a logo), `ios-icon` (the 1024 App Store file), `play-icon` (512 Play file), `android-layer` (adaptive foreground/monochrome). Use it when verifying generated outputs.
- If the report says the render came from ImageMagick ("approximate renderer"), the pixel numbers are a good guide but colors/edges may differ from a real SVG engine. Say so, and suggest `resvg` or `librsvg` if the result will be shipped.
- No renderer installed → only the static SVG lint runs. Tell the user what is missing instead of guessing the pixel checks.

**Look at the preview image** with `Read` — the numbers do not replace eyes. The sheet shows: the art with the Android guides (red circle = 66dp safe zone, blue square = 72dp visible area) · iOS squircle on light and dark · Android circle and rounded square on light and dark · small sizes (iOS 120/60/40/29, Android 96/48). Judge legibility at the smallest sizes yourself: thin lines and fine detail vanish at 29–48px.

## Step 3 — Report

Give the verdict per platform first, then the blocking items and the caveats, each with its fix, in the user's language. Keep it short; do not paste the whole report. Typical shape:

```
iOS      ⚠️  needs a background (marketing icon cannot be transparent)
Android  ✅  glyph is inside the safe zone
SVG      ⚠️  3 strokes and 1 <style> block — outline/inline them (see below)
```

Be honest about the limits: the tool verifies geometry, alpha, size, contrast, color profile and SVG constructs. It does **not** judge brand quality, trademark use, or legibility — those are visual calls.

## Step 4 — Improve

Offer, in this order, and only do what the user accepts:

1. **Fix the SVG** (only when the lint has findings). Work on a **copy** (`<name>.fixed.svg`), never the original. Mechanical fixes you can apply directly: add `xmlns`/`viewBox`, inline `<style>` into attributes, convert basic shapes to `<path>`, remove metadata/hidden layers, round to 3 decimals, drop `<use>`/transform by inlining. Fixes that need a design tool — outline strokes, outline text, boolean-combine clip/mask, flatten gradients — tell the user how (`references/svg-paths.md`: Figma / Illustrator / Inkscape steps) instead of approximating them by hand. Re-run `check.mjs` on the fixed copy and confirm the lint is clean **and** the render matches the original.
2. **Build the assets**:
   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/build.mjs" <logo.svg|logo.png> --out <out-dir> --bg "<brand hex>"
   ```
   Tunables: `--ios-fill` (glyph size on iOS/Play, default 0.6 of the canvas), `--android-fill` (fraction of the 66dp safe circle, default 0.9). A transparent logo yields the full set; an already-flat opaque image only yields the iOS and Play files (layers cannot be recovered from a flat picture — ask for the SVG or a transparent PNG).
   Without `--bg` it picks white or near-black by contrast and says so — treat that as a placeholder and ask for the brand color.
3. **Verify the outputs**: run `check.mjs --role ios-icon` on `ios/AppIcon-1024.png`, `--role android-layer` on `android/res/drawable-xxxhdpi/ic_launcher_foreground.png`, `--role play-icon` on the Play file; open `<out-dir>/preview.png` with `Read`.
4. **Suggest the modern look** (read `references/modern-icons.md` first): Material You themed (monochrome) icon on Android and Liquid Glass layers / Icon Composer on iOS 26. Recommend it when the logo has a clean glyph and strong contrast; say plainly when the logo (heavy gradients, photo-like art, tiny detail) will not translate and what to simplify. For iOS 26, `ios/foreground-1024.png` is the glyph layer to bring into Icon Composer; the background and the dark/clear/tinted appearances are authored there, not by these scripts.

## Step 5 — Hand over

List what was written and where. Where the files go depends on the project: Android resources under `res/`, the iOS 1024 in the asset catalog / Xcode, and, for Eitri-Apps, wherever the project or the Eitri console takes the app icon. **Do not invent that path**: look at the project (`Glob` for `res/`, `Assets.xcassets`, `AppIcon`, the app config) or ask the user. Copy files into the project only when asked.

---

## Rules of thumb (details in the references)

- iOS marketing icon: **1024×1024 PNG, opaque, no alpha channel, square, not pre-rounded** — the system applies the mask and, on iOS 26, the glass effects.
- Android adaptive icon: **108dp canvas, 72dp visible, 66dp circular safe zone**; foreground on transparent, separate background, optional monochrome layer; Play Store icon **512×512, ≤ 1024 KB, full-bleed**.
- Do not bake shadows, glows, glossy highlights or fake rounded corners into any layer — the platforms add depth themselves and a baked one doubles up.
- Contrast between glyph and background matters more than ever: tinted, dark and themed appearances flatten color and lean on luminance.
- SVG: outline strokes and text, no CSS classes, no filters/masks, apply transforms, 3-decimal paths, `viewBox="0 0 N N"` square, `xmlns` present. If it looked right in a browser but wrong on device, the paths are the first suspect.
- Facts about OS features (Liquid Glass, themed icons, store limits) evolve. For anything outside the references or near a store submission, say it should be confirmed against Apple's and Google's current documentation.
