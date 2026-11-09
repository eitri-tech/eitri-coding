# Why the paths decide whether an SVG icon renders right

A browser implements the whole SVG spec. An icon pipeline does not: Android's VectorDrawable converter, Icon Composer / Xcode, design-system exporters and most rasterizers each support a **subset**, and each treats the rest differently — drops it, approximates it, or renders it wrong. The safe icon SVG is therefore the boring one: **filled `<path>` shapes with explicit colors on a square `viewBox`**, nothing that needs interpretation at render time.

`check.mjs` flags each of the cases below (id in parentheses) and compares the static path extents with what the renderer actually drew (`svg-render-mismatch`): if they disagree, the art is not rendering as written.

## What breaks and how to fix it

| Construct | What goes wrong | Fix |
| --- | --- | --- |
| **Strokes** (`svg-stroke`, `svg-dash`) | Joins, caps, miter limits and widths are re-implemented per renderer; they scale unevenly when the icon is resized; dashes are not portable | **Outline the stroke** to a filled path. Figma: *Outline stroke* (⌘⌥O). Illustrator: *Object ▸ Path ▸ Outline Stroke*. Inkscape: *Path ▸ Stroke to Path* |
| **Text** (`svg-text`) | Depends on installed fonts; VectorDrawable and Icon Composer do not render it | Convert to outlines: Figma *Outline text* / *Flatten*, Illustrator *Create Outlines*, Inkscape *Object to Path* |
| **Transforms** (`svg-transform`) | Nested rotate/scale/skew is where converters shift or distort art | Bake into the coordinates: svgo `convertPathData` applies transforms set directly on a path; for rotated/skewed groups re-export *flattened* from the design tool |
| **`<style>` / classes** (`svg-css`) | CSS is applied by browsers but ignored or partly resolved by Android Studio, Icon Composer and many exporters → colors vanish or turn black | Inline as attributes (`fill="#…"`); svgo `inlineStyles`; Inkscape *Save as Plain SVG* |
| **Filters** — blur, drop-shadow, glow (`svg-filter`) | Unsupported by Android vectors; flattened or dropped elsewhere | Delete. The platforms add their own depth; bake only flat shapes |
| **`<mask>`, `<clipPath>`, `<pattern>`, `<marker>`** (`svg-mask`, `svg-clippath`, …) | Mask/pattern/marker unsupported on Android; clip only partly | Boolean-combine into one path: Figma *Union/Subtract/Intersect → Flatten*, Inkscape *Path ▸ Difference / Intersection* |
| **Gradients** (`svg-gradient`) | Android vectors need user-space gradients and often break with `gradientTransform` or `objectBoundingBox` units | Prefer solid fills. If needed: `gradientUnits="userSpaceOnUse"`, absolute coordinates, no `gradientTransform` |
| **`<use>` / `<symbol>`** (`svg-use`) | References are not resolved by several converters | Inline them as real shapes (Inkscape *Edit ▸ Clone ▸ Unlink Clone*; Figma *Detach instance* then *Flatten*) |
| **Embedded `<image>`** (`svg-embedded-raster`) | It is a bitmap in an SVG envelope: blurry at large sizes, dropped by converters | Re-trace as real vectors, or ship a ≥ 1024 px PNG instead |
| **`currentColor`** (`svg-currentcolor`) | No CSS context in an icon → black | Use explicit hex colors |
| **Group `opacity`** (`svg-group-opacity`) | Composited differently per renderer; VectorDrawable has no group alpha | Put `fill-opacity` on each shape or flatten colors |
| **`fill-rule="evenodd"`** (`svg-evenodd`) | Android vectors support it only on API 24+; holes must be real holes either way | Keep it, or redraw compound shapes with opposite winding under the default `nonzero` |
| **Arcs `A`/`a`** (`svg-arcs`) | Older converters approximate arcs badly | If a curve looks off after conversion, redraw or re-export it as cubic Béziers (Figma *Flatten*; Inkscape *Object to Path* then *Path ▸ Simplify*) |
| **Scientific notation `1e-5`** (`svg-scientific-notation`) | Some path parsers mis-read it and distort the shape | Re-serialise with fixed decimals (svgo `floatPrecision: 3`) |
| **Excess precision / very long paths** (`svg-precision`, `svg-long-path`) | Bloat, float noise; Android lint flags path data over ~800 characters | Round to ≤ 3 decimals; *Path ▸ Simplify*; split into several paths |
| **Basic shapes** (`svg-basic-shapes`) | `rect rx/ry`, `ellipse`, `line`, `polyline` handled inconsistently, especially with strokes/transforms | Convert to `<path>` (svgo `convertShapeToPath`) |
| **Invalid path data** (`svg-path-invalid`) | Per spec, rendering stops at the first error → truncated or empty shape | Repair or re-export; svgo `convertPathData` normalises it |
| **Missing / non-square / offset `viewBox`** (`svg-no-viewbox`, `svg-not-square`, `svg-viewbox-origin`) | Scaling is undefined or the art shifts | `viewBox="0 0 N N"`, square, origin at 0 0, `xmlns="http://www.w3.org/2000/svg"` |
| **Art outside the `viewBox`** (`svg-outside-viewbox`) | Cut off | Move/scale inside the artboard |
| **Hidden / invisible layers** (`svg-hidden`, `svg-invisible`) | Some tools export them anyway | Delete |

## A safe cleanup recipe

1. In the design tool, before export: outline strokes and text, flatten boolean shapes, apply the mask as a real intersection, replace gradients and effects with flat fills (or keep a gradient only as user-space), put the art on a square artboard (1024×1024 is ideal), name nothing important by layer — it is ignored.
2. Export as SVG with **presentation attributes** (not CSS), no IDs/metadata if the option exists.
3. Optionally normalise with svgo (`npx svgo -i in.svg -o out.svg --config svgo.config.mjs`):

```js
// svgo.config.mjs
export default {
  multipass: true,
  floatPrecision: 3,
  plugins: [
    { name: 'preset-default', params: { overrides: { removeViewBox: false } } }, // keep the viewBox!
    'convertStyleToAttrs',
  ],
};
```

   svgo does **not** outline strokes or text; those need the design tool. Re-run `check.mjs` on the result and compare the render with the original — normalisation can change things too.
4. For Android specifically, you can also import the SVG through **Android Studio ▸ New ▸ Vector Asset ▸ Local file**; its warnings list exactly what it could not convert. `build.mjs` produces PNG layers instead, which avoids the converter altogether.

## Reading the numbers

- `svg-render-mismatch` — the coordinates say the art spans X% of the viewBox but the renderer drew Y%: transforms, clip/mask or strokes are being interpreted differently than you expect. Fix the flagged constructs first.
- Renderer "approximate" (ImageMagick) — its built-in SVG reader ignores much of the spec. A clean report from it does not guarantee a clean render elsewhere; prefer `resvg` / `rsvg-convert` / Inkscape.
