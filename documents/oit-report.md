# Order-Independent Transparency (OIT) in videx-3d — Technical Report

_Last updated: 2026-06-19. Describes the current, shipped OIT implementation._

This document explains **why** videx-3d needs order-independent transparency, **how**
the current implementation works, and the **design decisions and trade-offs** behind
it. It is the technical companion to:

- [oit-guide.md](./oit-guide.md) — practical "how do I use it" guide.
- [oit-component-status.md](./oit-component-status.md) — which components are wired.

---

## Executive summary (the what / how / why, in plain terms)

**The problem.** When you draw see-through things on a screen, the order in which you
draw them matters. A red glass in front of a blue glass looks different from a blue
glass in front of a red glass. Traditional real-time graphics handles this by sorting
all the transparent objects back-to-front and painting them in that order. That works
for a handful of well-separated objects, but it falls apart for the kind of scenes
videx-3d renders: large, overlapping, curved **geological surfaces and horizons** that
intersect each other and even fold over themselves. There is no single correct draw
order for a surface that wraps around — so you get flickering, surfaces that "pop" in
front of each other as you orbit the camera, and colors that look wrong.

**The goal.** We want transparency that looks correct **regardless of draw order** —
hence "order-*independent*" transparency. The viewer should be able to fly around an
oil field, zoom from a 50 km overview down to a single wellbore, and see stacked
semi-transparent horizons blend correctly the whole time, on a mid-range laptop.

**The approach.** Instead of sorting, we use a **hybrid technique**. For every pixel
we split the transparent fragments into two groups:

1. The **front layer** — the single nearest transparent surface at that pixel. This
   one we render *exactly* (a normal "paint it over" blend), because the nearest layer
   contributes the most and our eyes are most sensitive to it.
2. The **tail** — everything behind the front layer. These get **weighted blended**:
   we accumulate their colors with a weight derived from how opaque each one is, then
   average them. The math is associative, so the *order they were drawn in doesn't
   matter* — that is what makes it order-independent.

To know which fragment is the "front" one, we first do a cheap **depth pre-pass** that
records, per pixel, how far away the nearest transparent surface is. Everything else is
classified as tail.

**Why this design.** It is a deliberate balance:

- **Quality where it counts.** Peeling the exact front layer keeps the dominant,
  most-visible surface crisp and correctly colored. Pure weighted-blended OIT (without
  the front peel) tends to look washed out; pure depth peeling (peeling *every* layer)
  is accurate but needs many passes and is too slow at this scale.
- **Speed.** The tail is resolved in a single accumulation buffer — no per-pixel sorted
  lists, no multiple peels. Modern trick: we weight the tail by *optical depth*
  (`-ln(1 - alpha)`) so a **single** buffer reconstructs both the blended color and the
  coverage, which removed an entire full-screen pass we used to need.
- **Opt-in and non-invasive.** OIT is entirely optional. If you do nothing, the library
  uses the standard sorted pipeline. You turn OIT on by composing one render pass into a
  pipeline, and only materials that have been explicitly "OIT-wired" are affected —
  everything else renders exactly as before.
- **Portability-minded.** The whole thing is built on Three.js' public WebGL API
  (no raw GL state poking), so it maps cleanly onto the future WebGPU/TSL rewrite.

**The trade-offs we accept.** The tail is an *approximation*: where three or more
semi-transparent layers overlap behind the front layer, the blend is "good enough"
rather than physically exact. Additive effects (glowing perforation jets, highlights)
and always-on-top markers are handled through dedicated render *layers* rather than the
OIT math. And a transparent material that someone forgets to wire is silently treated
as opaque — the single most common mistake (see the guide). These are conscious choices
that keep the common case fast and correct.

---

## 1. Background: why sorted transparency fails here

Standard alpha blending requires fragments to arrive **back-to-front**:

$$C_\text{out} = \alpha_\text{src} C_\text{src} + (1 - \alpha_\text{src})\, C_\text{dst}$$

This operator is **not commutative** in the source/destination roles, so the draw order
determines the result. Three.js approximates the required order by sorting transparent
objects by their bounding-box distance to the camera. That breaks down for videx-3d's
workloads because:

- **Self-overlap.** A single folded/draped horizon overlaps itself; one object cannot be
  sorted against itself with a single distance.
- **Mutual intersection.** Horizons and seismic fences cross each other; no per-object
  ordering is globally correct where they interpenetrate.
- **Scale.** With `camera.far` up to tens of thousands of units (a whole field) and a
  logarithmic depth buffer, naive per-object sorting produces visible popping as the
  camera orbits.

The symptom users saw before OIT: surfaces swapping which one looks "in front" as you
orbit, banded cross-bleed at intersection lines, and flicker.

---

## 2. The technique: hybrid depth-peeled front + weighted-blended tail

For each pixel, the transparent fragments are partitioned into:

- **Front layer** — the nearest transparent fragment. Composited *exactly* with normal
  alpha-over blending. Carries the dominant visual contribution.
- **Tail** — all remaining transparent fragments. Resolved with **weighted blended OIT
  (WBOIT)**, which is order-independent because it only uses commutative operations
  (addition).

### 2.1 Classifying front vs. tail

A **min-depth pre-pass** rasterizes all transparent geometry writing the per-pixel
*nearest* normalized view-space depth into a single-channel target using
`MinEquation` blending (`NearestFilter`, no bilinear bleed). In the color/peel passes
each fragment computes its own `linZ` and compares against the stored minimum:

```glsl
float tol = minZ * 1e-3 + 1e-6;          // depth-relative epsilon
bool isFront = (linZ - minZ) <= tol;
```

The tolerance is **depth-relative**, not a fixed slab and not derived from `fwidth`.
An earlier fixed-epsilon slab caused two distinct surfaces that grazed within the slab
to *both* be classified as front (color swaps + banded bleed). A later `fwidth`-based
tolerance spiked at self-overlap silhouettes (the 2×2 derivative quad straddles the
depth discontinuity), producing hard bands. Because the min-depth pre-pass and the
front pass rasterize the **same geometry with the same vertex transform** (the pass
defines only branch the fragment stage), the true front fragment's `linZ` matches the
stored `minZ` to near bit-exactness, so a tiny relative epsilon is both sufficient and
robust.

### 2.2 Resolving the tail (single-buffer b-weighted WBOIT)

The tail used to need two buffers (an "accumulation" buffer and a "revealage" buffer).
The current implementation collapses this to **one** RGBA16F accumulation buffer by
weighting each fragment by its **optical depth** instead of its alpha:

$$b = -\ln\!\big(1 - \mathrm{clamp}(\alpha, 0, 0.9999)\big)$$

Each tail fragment contributes `(color.rgb · b, b)` with additive blending
(`ONE, ONE`). The accumulation buffer therefore holds:

- `accum.rgb = Σ (color.rgb · b)`
- `accum.a   = Σ b`

The composite reconstructs the averaged color and coverage:

```glsl
vec3  averageColor = accum.rgb / max(accum.a, 1e-5);
float coverage     = 1.0 - exp(-accum.a);   // = 1 - ∏(1 - α)
```

`1 - exp(-Σb) = 1 - ∏(1-α)` is **bit-identical** to what the old multiplicative
revealage pass produced — but with no second buffer, no MRT, and no GLSL3, so it stays
fully portable to TSL. The optical-depth weighting is FP16-safe (`b ≤ 9.21`), and it
differs from alpha-average weighting only where **two or more** semi-transparent tail
layers overlap a pixel (it favors the more opaque layer there — arguably more correct).
This change removed a full-screen tail render (~25% of the pass's frame cost).

The front layer is then drawn in its own pass directly over the composited result with
exact alpha-over blending.

---

## 3. Pipeline architecture

OIT is implemented as a `Pass` you compose into a `RenderingPipeline`:

```
RenderingPipeline
 └─ passes: [ OITRenderPass, (AA pass?), AnnotationsPass?, OutputPass ]
```

- **`RenderingPipeline`** (`src/rendering/RenderingPipeline.tsx`) — owns the main
  RGBA16F/linear render target with a **shared `DepthTexture`**, runs the pass list in a
  `useFrame` (priority 1), disables `renderer.autoClear`. The buffer is single-sample so
  the auxiliary OIT targets can share the resolved depth texture.
- **`OITRenderPass`** (`src/rendering/passes/OITRenderPass.ts`) — constructed with
  `(scene, camera)`. Resolves the 3D scene (opaque + transparent) into the buffer.
- **Anti-aliasing** — built into `OITRenderPass` via its `antialias` property
  (`'temporal' | 'smaa' | 'temporal-smaa'`), or supersampling via the pipeline's
  `supersample` prop (see §8).
- **`AnnotationsPass`** — composites 2D labels using the buffer's depth texture for
  occlusion.
- **`OutputPass`** — tone-maps and blits the FP16 buffer to the screen.

A small **rendering-state store** (`src/rendering/rendering-state.ts`, a per-scene
zustand store) tracks `TransparencyMode` (`'standard' | 'oit'`). `OITRenderPass`
ref-counts `acquireOit()` on construction and releases on dispose, so components like
`Surface` can ask "is OIT active?" and skip their standard self-transparency depth-mask.

### 3.1 Per-frame passes inside `OITRenderPass.render()`

When transparent geometry is present, a frame runs roughly:

1. **Opaque pass** — opaque geometry + `scene.background`. OIT meshes are swapped to a
   no-op material (or hidden); fully-opaque OIT materials are forced to write depth here
   (see §5). `scene.background` is nulled afterward so it doesn't contaminate the
   auxiliary targets.
2. **Emissive pass (1b)** — `LAYERS.EMISSIVE` objects (additive glow) drawn *between*
   opaque and transparent so transparent surfaces in front attenuate them.
3. **Min-depth pre-pass** — nearest transparent depth → single-sample R32F target
   (`MinEquation`). Skipped when `skipFront` is on.
4. **Tail (accum) pass** — single additive RGBA16F accumulation buffer (§2.2).
5. **Composite** — average color + reconstructed coverage blended over the buffer.
6. **Front pass** — exact alpha-over of the peeled nearest layer.
7. **Overlay pass** — `LAYERS.OVERLAY` objects drawn last, always on top.

Auxiliary targets share the main buffer's depth texture and clear **color only**.
`renderer.sortObjects` is disabled for the OIT sub-passes (they are all order
independent), trimming both sort work and per-object screen-space-z computation; the
opaque pass keeps front-to-back sorting for early-Z.

Performance guards: if no OIT-routed objects are currently transparent, the entire
OIT machinery (steps 3–6) is skipped; the overlay/emissive blocks are skipped when
those lists are empty.

---

## 4. Making materials OIT-capable

The pass only routes a material through the transparency passes if it is *OIT-capable*.
**An unwired transparent material is silently treated as opaque** and will occlude OIT
geometry behind it. Three wiring mechanisms exist (`src/rendering/oit-material.ts`):

| Mechanism | For | What it does |
|-----------|-----|--------------|
| `attachOitVariants(material)` | Library `ShaderMaterial`s whose shader already `#include`s `oit.glsl` and calls `oitProcess(gl_FragColor)` | Adds OIT uniforms; installs the lazy per-pass variant materials. No shader patching. |
| `makeOitCompatible(material)` | Stock Three.js materials (`MeshStandardMaterial`, `LineBasicMaterial`, …) or custom shaders without the OIT chunk | Wraps `onBeforeCompile` to inject the OIT GLSL + call, auto-injecting `vViewPosition` if absent. |
| `<OitMaterial />` | Inline `<shaderMaterial>` / `<meshStandardMaterial>` in JSX | Declarative sibling component; locates the parent mesh's material and applies one of the above. |

### 4.1 Per-pass variants

Each OIT-capable material exposes `getOitVariants()` returning the materials used for
each sub-pass (`depthMin`, `accum`, `front`). Variants are built once and **cached per
material**, then re-synced in place when the base material's *program state* changes
(defines such as `USE_COLOR_RAMP`/`USE_CONTOURS`, `wireframe`, `flatShading`,
`uniformsGroups`, `vertexColors`). A `programSignature` is compared each frame; the
variants are only rebuilt when it changes.

- **`ShaderMaterial` variants** are `new ShaderMaterial().copy(base)` and **share the
  base `uniforms` object by reference**, so uniform-driven appearance (color, opacity,
  contours, color ramps) updates live through transparency every frame.
- **Built-in material variants** are `base.clone()`, which **snapshots** value props at
  build time; only `opacity` is re-synced live by default. An opt-in `syncProperties`
  list (and the convenience `COMMON_OIT_SYNC_PROPS`) lets you keep specific value props
  (`color`, `emissive`, `metalness`, …) live by copying them in place each frame —
  restricted to value props only, never program-affecting ones (textures, define
  toggles) which would force per-frame recompiles. This is why the library deliberately
  does **not** ship ready-made OIT subclasses of built-in materials: they would be
  misleading about which properties are live.

Per-pass `defines` (`USE_OIT` plus a pass marker) give each variant a distinct program
and blend mode. The shared GLSL chunk `src/sdk/materials/shaderLib/oit.glsl` (guarded by
`#ifdef USE_OIT`) implements `oitProcess()` and requires `vViewPosition` in the fragment
stage.

---

## 5. Opacity-aware routing

Classification ("is this material OIT or opaque?") is based on material identity, but
**routing** at render time also checks current opacity:

- A fully-opaque OIT-capable object (`opacity >= 1`) is drawn in the **opaque pass** as a
  real depth-writing occluder and skips the OIT sub-passes entirely (`applyForcedOpaque`
  temporarily sets `depthWrite=true, transparent=false`, restored after). At
  `opacity = 1` the alpha-over front layer is identical to opaque, so there is no visual
  regression — but it now correctly writes opaque depth and occludes transparent
  geometry behind it.
- A material that drives alpha through a **differently-named custom uniform**
  (e.g. Grid's `uOpacity`) must mirror it onto `material.opacity` (or a
  `uniforms.opacity` value), because the router only reads those two. This is the same
  class of fix used for casing opacity and grid opacity.

---

## 6. Special layers (additive, overlay, escape hatches)

Some effects don't belong in the peel/average math and are handled through dedicated
render layers (`src/layers/layers.ts`), tagged via the component `layers` prop +
`createLayers()` or imperatively:

| Layer | Value | Behavior |
|-------|-------|----------|
| `OIT_EXCLUDED` | 25 | Drawn in the opaque pass, material props left intact; skips OIT. |
| `FORCE_OPAQUE` | 26 | Drawn in the opaque pass, temporarily forced to a depth-writing occluder. |
| `OVERLAY` | 27 | Always-on-top; drawn **last**, after transparency is resolved (e.g. `CameraTargetMarker`). |
| `EMISSIVE` | 28 | Additive glow drawn **between** opaque and transparent passes, so surfaces in front attenuate it (e.g. `Perforations`, `Highlighter`). |
| `NOT_EMITTER` / `EMITTER` | 29 / 30 | GPU-picking (`EventEmitter`) routing. |

The escape-hatch layers (`OIT_EXCLUDED`, `FORCE_OPAQUE`) let a host app pull a specific
transparent object out of OIT routing without modifying the component or its material.

---

## 7. Optional features on `OITRenderPass`

All default **off** with zero GPU cost when disabled:

- **`skipFront`** — resolve *every* transparent fragment through the WBOIT tail (skip the
  exact front peel). Useful for debugging or pure-WBOIT comparison.
- **`occlusionDepthStamp`** (+ `occlusionDepthThreshold`) — lets sufficiently-opaque
  *transparent* surfaces occlude annotation labels. Transparent surfaces have
  `depthWrite=false`, so by default only opaque geometry occludes labels; this stamps a
  thresholded, log-encoded depth of qualifying transparent fragments into the shared
  depth texture that `AnnotationsPass` reads.
- **`emitterDepthStamp`** (+ `emitterDepthThreshold`) — stops a *far* transparent surface
  from washing out an additive emitter core (e.g. perforation jets). The emitter opts in
  by exposing `userData.occlusionDepthMaterial` (a depth-only stamp material); the pass
  stamps the dense jet cores into depth so surfaces behind them are depth-rejected, while
  surfaces genuinely in front still attenuate the glow.
- **`debugTargets`** — draws GPU thumbnails of the auxiliary targets (min-depth, accum,
  front) inlaid at the bottom of the buffer via per-draw viewport scoping (no pixel
  readback).
- **`profile`** + `timings` — `EXT_disjoint_timer_query_webgl2` GPU timing per sub-pass
  (opaque / emissive / overlay / minDepth / tail / composite / front / total). Debug-only
  raw-GL measurement; no-op when the extension is missing.

Both depth-stamp features build on a single primitive: a depth-only, alpha-thresholded
stamp (`colorWrite=false, depthWrite=true, NoBlending`) that renders the geometry's real
shader and `discard`s below threshold, letting the hardware depth test merge the nearest
qualifying fragment.

---

## 8. Anti-aliasing

AA is built into `OITRenderPass` via its `antialias` property:

- **`'temporal'`** — temporal supersampling: sub-pixel camera jitter accumulated into a
  running average while the camera is still (the only mode that AAs 1-pixel lines well).
  No reprojection, so nothing ghosts; the moving frame is shown as-is. Motion is detected
  from the view-projection delta, which resets the accumulation.
- **`'smaa'`** — subpixel morphological AA every frame (quality via `smaaQuality`).
  Reuses the three-stdlib SMAA shaders/LUTs through an internal resolver; clears its
  edge/weight targets every frame (both sub-passes use `discard`) and sRGB-encodes the
  linear FP16 buffer for edge detection so its contrast thresholds behave correctly.
- **`'temporal-smaa'`** — both, mutually exclusive per frame: temporal while still, SMAA
  while moving.
- **MSAA via `OITRenderPass.opaqueSamples`** (keep the pipeline `samples` at `0` when
  using OIT) and **supersampling via `supersample`** are also available; the pipeline
  `samples` prop applies MSAA only to a plain opaque `RenderPass` pipeline.

Note: **shading aliasing** (thin view-dependent rim/specular terms on curved geometry,
e.g. the tube trajectory's depth-shade rim) is sub-pixel and cannot be fixed by edge-AA
passes — it is handled analytically in the shader by widening the ramp to its
screen-space footprint (`max(ndv, fwidth(ndv))`).

---

## 9. Performance characteristics

At oilfield scale a frame rasterizes scene geometry several times (opaque, emissive,
min-depth, tail, front, plus an `EventEmitter` picking render) and runs a few full-screen
passes. The implementation is **mixed CPU/GPU bound** depending on zoom:

- **Zoomed out** over heavy transparent geometry → GPU-bound on fill (the RGBA16F tail
  blending and repeated full-scene transparent passes dominate).
- **Zoomed in / moderate geometry** → fixed CPU overhead dominates (scene traversals for
  `collect()`, picking, plus annotation layout on the main thread).

Shipped optimizations: single-buffer tail (removed a full-screen pass), `sortObjects`
disabled in OIT sub-passes, OIT machinery skipped when nothing is transparent, opacity-
aware routing keeps opaque OIT objects out of the transparency passes, and per-object
renderable caching. The `profile` flag is the definitive way to confirm CPU vs. GPU
bound for a given scene.

---

## 10. Known limitations & future direction

- **Tail is an approximation.** Three or more overlapping semi-transparent layers behind
  the front layer blend "good enough", not physically exact. The peeled front layer
  carries the dominant contribution, so this is rarely objectionable.
- **Additive/overlay effects** are outside the OIT math (handled by layers). Additive
  glow over a bright background can clip without a tone-mapper (dev uses `NoToneMapping`).
- **Unwired transparent materials** are treated as opaque — the most common integration
  mistake. See [oit-component-status.md](./oit-component-status.md) for what's wired.
- **WebGPU / TSL migration.** The entire OIT stack (GLSL chunks, `onBeforeCompile`
  injection, per-pass `defines` variants, manual render-target orchestration) is
  WebGL/GLSL-bound and will become a TSL node-material rewrite when WebGPU becomes
  Three's recommended renderer. A hard constraint on all current rendering work is **no
  raw-GL API calls** (no indexed per-attachment blend, no `gl.blendFunci`, etc.) so the
  code maps cleanly onto TSL later — the single-buffer tail was chosen partly for this
  reason. Debug-only GPU timing is the only sanctioned raw-GL exception.

---

## Key files

- `src/rendering/passes/OITRenderPass.ts` — the pass and its sub-pass orchestration.
- `src/rendering/RenderingPipeline.tsx` — main target + shared depth texture + loop.
- `src/rendering/rendering-state.ts` — per-scene transparency-mode store.
- `src/rendering/oit-material.ts` — `makeOitCompatible` / `attachOitVariants` / variants.
- `src/rendering/OitMaterial.tsx` — declarative JSX wiring helper.
- `src/sdk/materials/shaderLib/oit.glsl` — shared `oitProcess()` chunk.
- `src/rendering/shaders/oit-composite-frag.glsl` — tail composite.
- `src/layers/layers.ts` — `OVERLAY` / `EMISSIVE` / escape-hatch / picking layers.
- `src/storybook/examples/OITRenderPass.example.stories.tsx` — reference setup + controls.
