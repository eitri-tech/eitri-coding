# Modern icon systems: Material You (Android) and Liquid Glass (iOS 26)

Both platforms now **re-color and re-light the icon themselves**. The brand's job is to give them clean ingredients — a simple glyph, a clear brand color and enough contrast — rather than a finished, pre-lit picture. Treat everything here as guidance to confirm against Apple's and Google's current documentation, since both systems keep evolving.

## Android — Material You / themed icons

- **What it is**: on Android 12+ the system derives a palette from the wallpaper (dynamic color); on Android 13+ users can turn on **themed icons**, where the launcher recolors each app icon using that palette. It uses the adaptive icon's **`monochrome` layer** — only its alpha matters — over a system-chosen background.
- **What to supply**: a `<monochrome>` layer in the adaptive-icon XML (`build.mjs` writes it, as a black silhouette of your glyph). Without it, a themed-icon launcher cannot recolor the icon; some recent Android versions try to auto-generate one, and results are unreliable.
- **Design for it**:
  - A **single, bold silhouette** inside the 66dp safe zone. Inner details must be separated by **gaps** (transparent), not by a different color — color differences disappear in a monochrome layer.
  - Avoid thin strokes and gradients that carry the logo's identity; they turn to mush when recolored.
  - Keep the full-color version distinctive too: foreground + a **solid brand-color background** layer. Do not bake shadows or highlights.
- **Brand reference**: themed mode intentionally gives up brand color, so the *shape* must carry recognition. Test the monochrome silhouette at 48dp: if it reads, it is good.
- **Check**: `check.mjs --role android-layer` on the foreground; `android-monochrome` appears when the logo has many colors (a plain alpha silhouette will lose inner detail).

## iOS 26 — Liquid Glass, Icon Composer

- **What it is**: iOS 26 renders icons with **Liquid Glass**: translucency, specular highlights, blur and depth, in several appearances — default, **dark**, **clear** and **tinted**. Icons are authored as **layers** in **Icon Composer** (Xcode 26), saved as an `.icon` file; the system composes and lights them.
- **What to supply**: a **foreground glyph on transparent** (SVG or PNG layers; `build.mjs` writes `ios/foreground-1024.png`), and a background fill (solid or simple gradient) set in Icon Composer. The classic 1024×1024 **opaque** PNG (`ios/AppIcon-1024.png`) is an optional artifact for pipelines that still take a flat icon (asset catalogs without an `.icon` file, other tools); Apple documents using the `.icon` file itself for the App Store and generating the images for older systems automatically — confirm in the current Icon Composer documentation.
- **Design for it**:
  - **Few, simple layers**; flat shapes and solid fills. Let the glass effect create depth: **no baked shadows, gloss, bevels or blur** (`baked-shadow` flags them).
  - **Transparency is a design material here** — use it deliberately in layers, but never in the flattened marketing PNG.
  - **Contrast is the brand's safety net.** In *tinted* and *clear* appearances color is replaced or washed out, so recognition rests on **luminance contrast between glyph and background** and on the glyph's **shape**. Aim for ≥ 4.5:1 between them; keep the brand color as the *background* or as a distinctive accent, and a high-contrast (often white/light) glyph on it.
  - Keep the brand's **original reference** — the recognisable mark or its signature shape — as the glyph, centered; do not redraw it to look "glassy".
  - Check **dark** appearance too: a dark glyph on a dark background vanishes. Provide a lighter glyph variant for dark if needed.
- **Test**: view the glyph at default, dark, clear and tinted in Icon Composer; verify small sizes (29–60 pt) in `preview.png`.

## Recommending it to the user

Offer both, briefly, after the check passes (or alongside the fixes), in the user's language:

- If the logo is a clean single-color or two-color glyph with good contrast → recommend the themed/monochrome layer and the Icon Composer layers; the build already produces the inputs.
- If it has gradients, shadows, thin lines or photographic detail → say what to simplify (flatten, thicken, remove effects) and offer a simplified glyph for the monochrome/glass layers while keeping the full artwork for the default icon.
- If contrast between glyph and background is under 3:1 → this is the first thing to fix; it hurts every appearance.
