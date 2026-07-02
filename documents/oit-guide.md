# Opting in to Order-Independent Transparency (OIT)

A practical, end-to-end guide for using the OIT pipeline in videx-3d: how to set it
up, how to make your own materials participate, the optional features, and the
gotchas that bite most people.

- For *why* OIT is needed and how the technique works, see
  [oit-report.md](./oit-report.md).
- For the short non-technical pitch, see the
  [executive summary](./oit-report.md#executive-summary-the-what--how--why-in-plain-terms)
  at the top of the technical report.
- For which built-in components are already wired, see
  [oit-component-status.md](./oit-component-status.md).

OIT is **entirely opt-in**. If you do nothing, the library renders with the standard
sorted-transparency pipeline. You enable OIT by composing an `OITRenderPass` into a
`RenderingPipeline`. Only materials that are *OIT-capable* are affected; everything
else renders exactly as before.

---

## 1. Setting up the pipeline

OIT requires you to take control of the render loop with a `RenderingPipeline` and
an ordered list of passes. The minimal pipeline is `OITRenderPass` → `OutputPass`:

```tsx
import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  OITRenderPass,
  OutputPass,
  Pass,
  RenderingPipeline,
} from '@equinor/videx-3d'; // or your local import paths

function Pipeline() {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);

  const passes = useMemo<Pass[]>(
    () => [new OITRenderPass(scene, camera), new OutputPass()],
    [scene, camera],
  );

  return <RenderingPipeline passes={passes} />;
}
```

Mount `<Pipeline />` inside your `<Canvas>`. The `RenderingPipeline` runs in a
`useFrame` at priority `1` by default and disables `renderer.autoClear` while
mounted.

### Canvas requirements

The pipeline expects a single-sample main buffer so the auxiliary OIT targets can
share the resolved depth texture. A typical canvas config:

```tsx
<Canvas
  gl={{
    logarithmicDepthBuffer: true,
    autoClear: false,        // the pipeline manages clearing
    antialias: true,
  }}
>
```

> **Tone mapping is your choice.** The library's Storybook examples set
> `toneMapping: NoToneMapping` only so colors are easy to reason about (unbiased by a
> tone-mapping curve while developing). It is **not** an OIT requirement — use
> whatever tone mapping (ACES, AgX, …) suits your application. The pipeline buffer is
> FP16/linear, so tone mapping is applied at output as usual.

### Adding annotations and anti-aliasing

A fuller pipeline adds an `AnnotationsPass` before the `OutputPass`. Anti-aliasing is
built into `OITRenderPass` via its `antialias` property (see §6), so no separate AA
pass is needed:

```tsx
const passes = useMemo<Pass[]>(() => {
  const oit = new OITRenderPass(scene, camera);
  oit.antialias = 'taa'; // default; also 'temporal' | 'smaa' | 'temporal-smaa' | 'fxaa' — see §6

  return [
    oit,
    new AnnotationsPass(camera, clock, pointer, 1000),
    new OutputPass(),
  ];
}, [scene, camera, clock, pointer]);
```

> **Order matters.** `OITRenderPass` must come first (it resolves the 3D scene into
> the buffer); AA passes operate on that buffer; `AnnotationsPass` composites 2D
> labels using the buffer's depth texture; `OutputPass` blits to the screen.

---

## 2. Making a material OIT-compatible

The OIT pass only routes a material through the transparency passes if it is
*OIT-capable*. **An unwired transparent material is silently treated as opaque** and
will occlude OIT geometry behind it — this is the single most common mistake.

There are three ways to make a material OIT-capable. Pick based on what kind of
material you have:

| You have… | Use | Notes |
|-----------|-----|-------|
| A stock Three.js material (`MeshStandardMaterial`, `LineBasicMaterial`, …) or a custom `ShaderMaterial` whose shader does **not** include `oit.glsl` | `makeOitCompatible(material)` | Patches the shader at compile time. `vViewPosition` is auto-injected if missing. |
| A library `ShaderMaterial` whose fragment shader already `#include`s `oit.glsl` and calls `oitProcess(gl_FragColor)` | `attachOitVariants(material)` | Just wires the variant machinery — no shader patching. |
| An inline `<shaderMaterial>` / `<meshStandardMaterial>` declared in JSX | `<OitMaterial />` | Declarative; drop it as a sibling of the material inside the mesh. |

### 2a. `makeOitCompatible` — stock & custom materials

```tsx
import { makeOitCompatible } from '@equinor/videx-3d';
import { MeshStandardMaterial, DoubleSide } from 'three';

const material = useMemo(() => {
  const m = new MeshStandardMaterial({ color: 'tomato', transparent: true });
  m.opacity = 0.5;
  // syncProperties keeps these live through the transparent passes if you recolor
  // (or change scalars) at runtime — see §3.
  return makeOitCompatible(m, { side: DoubleSide, syncProperties: ['color'] });
}, []);

return <mesh geometry={geometry} material={material} />;
```

`makeOitCompatible` works with any material Three.js compiles (built-ins and
`ShaderMaterial`/subclasses). Lit materials already expose `vViewPosition`; for ones
that don't (e.g. `LineBasicMaterial`) it is injected automatically. All injected
code is guarded by `#ifdef USE_OIT`, so the base program is untouched outside the
OIT pipeline. (Plain `RawShaderMaterial`, which has no Three.js shader prelude, is
not auto-patched — author the `oit.glsl` include yourself and use
`attachOitVariants`.)

### 2b. `attachOitVariants` — library shaders

If you author the shader, add the OIT hook directly (guarded so it stays a no-op in
the standard pipeline):

```glsl
// fragment shader, near the end of main(), after gl_FragColor is computed:
#ifdef USE_OIT
  #include <.../sdk/materials/shaderLib/oit.glsl>
#endif

void main() {
  // ... compute gl_FragColor ...
  #ifdef USE_OIT
    gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
```

```ts
const material = new ShaderMaterial({ /* ... */ });
attachOitVariants(material, { side: DoubleSide });
```

The fragment shader must provide `vViewPosition` (lit chunks like
`lights_lambert_pars_fragment` already declare it — don't redeclare).

### 2c. `<OitMaterial>` — declarative inline materials

For materials declared in JSX, drop `<OitMaterial>` in as a sibling of the material:

```tsx
<mesh geometry={geometry}>
  <shaderMaterial
    uniforms={uniforms}
    vertexShader={vertexShader}
    fragmentShader={fragmentShader}
    transparent
  />
  <OitMaterial side={DoubleSide} />
</mesh>
```

Props:
- `side` — force a side on the variants (e.g. `DoubleSide`).
- `mode` — `inject` (default, equivalent to `makeOitCompatible`) or `attach` (the
  shader already includes `oit.glsl`, equivalent to `attachOitVariants`).
- `shareUniforms` — see §3.

---

## 3. Live appearance updates (the color/opacity gotcha)

> **This is important.** Whether runtime changes to a material's appearance
> (`color`, `metalness`, `map`, custom uniforms, …) are reflected in the transparent
> render depends on the material *type*.

Under the hood each OIT-capable material gets a small set of per-pass **variant**
materials. How those variants track the base material differs:

| Base material | Variants built by | What updates live | What is snapshotted |
|---------------|-------------------|-------------------|---------------------|
| `ShaderMaterial` / subclass | `.copy()` **sharing the same `uniforms` object** | **everything driven by uniforms** (color, opacity, custom params) | only program-level state (`defines`, `wireframe`, …) — re-synced automatically when it changes |
| Stock built-ins (`MeshStandardMaterial`, …) | `.clone()` | `opacity` always; plus any properties you list in `syncProperties` | `color`, `metalness`, `map`, etc. **unless listed** in `syncProperties` |

**Consequences and recommendations:**

- For a **stock built-in material**, `opacity` is always kept live. To also keep
  other appearance properties live (the common case: **recoloring**), pass their
  names via `syncProperties`:

  ```ts
  import { makeOitCompatible, COMMON_OIT_SYNC_PROPS } from '@equinor/videx-3d';

  // keep color + a couple of scalars live through the transparent passes
  makeOitCompatible(material, { syncProperties: ['color', 'metalness'] });

  // or use the convenience set (color, emissive, emissiveIntensity, metalness, roughness)
  makeOitCompatible(material, { syncProperties: [...COMMON_OIT_SYNC_PROPS] });
  ```

  Each listed property is synced from the base onto every variant each frame.
  Copyable value objects (`color`, `emissive` — `Color`; `Vector2/3/4`) are copied
  **in place** (no allocation, no recompile); primitives (`metalness`, `roughness`,
  …) are assigned. Both are cheap, so this is safe to leave on. Properties not
  present on the material are ignored, and `opacity` need not be listed.

  > **Restriction (by design):** `syncProperties` only supports **value** properties
  > that don't change the shader program. Do **not** list textures (`map`,
  > `normalMap`, …) or `vertexColors` — changing those needs a per-frame recompile
  > and is intentionally unsupported through this fast path. If you need live texture
  > swaps on a transparent object, use a `ShaderMaterial` driven by uniforms instead.

- If you'd rather not enumerate properties at all — or you need live **textures** or
  other program-affecting changes — **prefer a `ShaderMaterial`** that drives
  appearance via `uniforms`. Because variants share the `uniforms` object by
  reference, every update propagates to all passes automatically.
- `program`-affecting changes on a `ShaderMaterial` (toggling `defines`,
  `wireframe`, `flatShading`, `vertexColors`, `uniformsGroups`) are detected via a
  signature and the variants are re-synced — so e.g. toggling a color-ramp or
  contours `#define` on a surface is reflected.
- `shareUniforms: ['uniforms']` — for a *cloned* (built-in-based) material that
  reads a custom uniform container in its own `onBeforeCompile` (e.g. the casing
  slice uniforms), list those property names so the container is shared by
  reference with the variants and per-frame updates reach them. (This shares a
  whole uniform *container*; for plain material value props like `color`, use
  `syncProperties` instead.)

In short: **uniform-driven `ShaderMaterial` = fully live; cloned built-in = live
`opacity` + whatever you list in `syncProperties`.**

---

## 4. Routing and escape-hatch layers

By default an OIT-capable material is routed through the transparency passes only
when it is actually transparent. A fully-opaque OIT material (opacity ≥ 1) is drawn
in the opaque pass as a real depth-writing occluder. You can override routing
per-object with layers from `LAYERS` (`src/layers/layers.ts`):

| Layer | Effect |
|-------|--------|
| `LAYERS.OIT_EXCLUDED` (25) | Draw the object in the opaque pass, **material properties left intact** (no forced depthWrite/transparent). Use when you don't want the object's transparency resolved by OIT but also don't want its material mutated. |
| `LAYERS.FORCE_OPAQUE` (26) | Draw the object in the opaque pass as a depth-writing occluder, **temporarily forcing** `depthWrite=true, transparent=false` even if the material is transparent. |
| `LAYERS.OVERLAY` (27) | Always-on-top. Drawn **last**, after transparency is resolved, with the object's own material/blend. |
| `LAYERS.EMISSIVE` (28) | Additive/glow. Drawn **between** the opaque and transparent layers, so transparent surfaces in front attenuate it. |

Enable a layer while keeping layer `0` so the standard pipeline still renders the
object:

```tsx
import { createLayers, LAYERS } from '@equinor/videx-3d';

// declarative
const layers = useMemo(() => createLayers(0, LAYERS.OIT_EXCLUDED), []);
<line layers={layers} />

// imperative
object.layers.enable(LAYERS.OVERLAY); // keep layer 0 enabled too
```

> **Do not nest opaque children under an OIT mesh.** During the opaque pass a pure
> OIT mesh is hidden, and Three.js skips its entire subtree — so opaque children
> (e.g. drei `<Text>` labels) never render. Keep opaque decorations as **siblings**
> of OIT meshes, not children.

---

## 5. Optional features

All of these are fields on the `OITRenderPass` instance and default to off/cheap.
Set them after constructing the pass (e.g. in an effect), not via the constructor,
so you don't recreate the pass:

```tsx
const oitPass = passes[0] as OITRenderPass;
useEffect(() => { oitPass.occlusionDepthStamp = true; }, [oitPass]);
```

| Field | Default | Purpose |
|-------|---------|---------|
| `skipFront` | `false` | Debug: disable the exact depth-peeled front layer; resolve *every* transparent fragment through the WBOIT tail. Useful for isolating tail behaviour. |
| `occlusionDepthStamp` | `false` | Let sufficiently-opaque **transparent surfaces** occlude 2D annotation labels behind them. Transparent surfaces normally write no depth, so labels are never occluded; this stamps depth where a surface's own alpha ≥ `occlusionDepthThreshold`. |
| `occlusionDepthThreshold` | `0.5` | Alpha threshold for `occlusionDepthStamp`. |
| `emitterDepthStamp` | `false` | Let the dense core of an additive **emitter** (e.g. perforation jets, `LAYERS.EMISSIVE`) occlude transparent surfaces *behind* it, preventing wash-out. The emitter opts in by exposing a depth-stamp material on `material.userData.occlusionDepthMaterial`. |
| `emitterDepthThreshold` | `0.5` | Strength threshold for `emitterDepthStamp`. |
| `debugTargets` | `false` | Draw thumbnails of the internal min-depth and accumulation targets in the bottom-left, for debugging. |
| `profile` | `false` | Measure per-segment GPU time via timer queries and expose it on `oitPass.timings`. The key figure for transparent cost is `timings.tail`. No-op where `EXT_disjoint_timer_query_webgl2` is unavailable. |

`oitPass.stats` (read-only) gives per-frame object counts (`opaque`, `oit`,
`oitOpaque`, `emissive`, `overlay`, …) — handy for verifying an object is actually
routed through OIT rather than silently treated as opaque.

These features cost nothing when off — the extra variant programs are only compiled
by Three.js the first time a pass actually renders them.

---

## 6. Anti-aliasing

OIT renders into an FP16 (linear) buffer, which interacts with AA in a few
non-obvious ways.

### MSAA is not recommended with OIT

Leave **both** MSAA knobs off with OIT — the pipeline's `samples` prop **and** the
`OITRenderPass.opaqueSamples` field. Use the built-in `antialias` modes below
(temporal / SMAA) or `supersample` instead.

Why MSAA cannot be made clean here: the OIT auxiliary buffers (min-depth, tail
accumulation) must be single-sample, because WebGL2 cannot sample a multisample
texture. So the transparent **tail** is composited as a single-sample fullscreen
pass over the multisample opaque edges. During the opaque pass every opaque edge is
matted against the cleared background *before* the transparent surfaces exist, and
the single-sample composite then cannot reconstruct per-sample coverage — so a
background-coloured fringe survives along opaque and thin-line edges over
transparent surfaces. This is structural: the no-AA single-sample image is clean, so
the fringe is introduced by MSAA. Deferring the background does not help (the
background enters the edge with the same weight no matter when it is added); only
supersampling the whole composite (temporal or SSAA) removes it.

```tsx
// Recommended: no MSAA. 'taa' is the default; 'temporal' / 'temporal-smaa' also work.
const oitPass = new OITRenderPass(scene, camera);
oitPass.antialias = 'taa';

<RenderingPipeline passes={passes} samples={0} />;
```

`opaqueSamples` remains available for the narrow case of an **opaque-only** close-up
(no transparent surfaces composited in front — e.g. a casing detail view), where the
fringe cannot occur. The pipeline `samples` prop remains valid for a plain opaque
`RenderPass` pipeline with no OIT.

### Supersampling (`RenderingPipeline supersample`)

```tsx
<RenderingPipeline passes={passes} supersample={2} />
```

Renders the whole pipeline at a higher resolution and box-downsamples on output.
This is the most uniform AA (it also smooths shading aliasing) but costs ~`N²×`
fill/memory.

### Built-in AA (`OITRenderPass.antialias`)

`OITRenderPass` anti-aliases the composited result itself, so no separate AA pass is
needed. Set `antialias` to one of (the default is **`'taa'`**):

- **`'taa'`** (default) — reprojected temporal anti-aliasing. Like `'temporal'` the
  camera is sub-pixel jittered, but the history is **reprojected every frame** using
  the depth of the nearest visible surface (opaque hardware depth refined by the OIT
  front-layer depth), so anti-aliasing is retained *during* camera motion — it
  anti-aliases both still and moving frames. The scene is effectively static (only the
  camera moves), so no per-object velocity buffer is needed. Ghosting from content the
  reprojection cannot follow (additive highlights, animated objects, disocclusions) is
  bounded by clamping the history into the current frame's local colour range; the
  anti-ghost knobs (`restClampStrength`, `restBoxGamma`, `restNeighbourhoodRadius`) are
  exposed on `oitPass.taaResolver` for tuning. Prefer `'temporal'` instead only if you
  need guaranteed ghost-free stills and don't mind losing motion AA.
- **`'temporal'`** — temporal supersampling: the camera is sub-pixel jittered and the
  frame is accumulated into a running average **while the camera is still**, converging
  to a genuinely supersampled image (it is the only mode that anti-aliases thin 1px
  lines well). No reprojection, so nothing ghosts; the moving frame is shown as-is.
- **`'smaa'`** — subpixel morphological AA every frame (quality via `smaaQuality`:
  `'low' | 'medium' | 'high' | 'ultra'`). Anti-aliases moving frames too, but (like all
  morphological techniques) cannot recover sub-pixel 1px lines. It sRGB-encodes the
  linear FP16 buffer for edge detection so its contrast thresholds behave correctly.
- **`'temporal-smaa'`** — both, mutually exclusive per frame: temporal while still
  (crisp, recovers 1px lines), SMAA while moving. SMAA never softens the converged
  still image and only costs GPU time during motion.
- **`'fxaa'`** — fast approximate AA: a single cheap spatial post pass every frame,
  running in the pipeline's linear FP16 space. Cheaper and softer than `'smaa'`, with
  no OIT or temporal coupling. Like all spatial techniques it cannot recover sub-pixel
  features (thin 1px lines/tubes that fall between samples). Also available standalone
  as `FXAAPass` for non-OIT pipelines (see below).

Do **not** pair the temporal modes (`'temporal'` / `'temporal-smaa'` / `'taa'`) with
MSAA (`opaqueSamples` or the pipeline `samples` prop) when transparent surfaces are
present — MSAA leaves a background-coloured fringe over transparent surfaces (see
“MSAA is not recommended with OIT” above), and it is wasteful to rasterise MSAA on
top of temporal supersampling that already anti-aliases the same edges.

### Standalone FXAA (non-OIT pipelines)

FXAA is also exposed as a standalone `FXAAPass`. Unlike the OIT-internal `antialias`
modes it does **not** require order-independent transparency, so it works after a
plain `RenderPass` too. Insert it between the base pass and the `OutputPass`:

```tsx
import { FXAAPass, OutputPass, RenderPass } from '@equinor/videx-3d';

const passes = useMemo<Pass[]>(
  () => [new RenderPass(scene, camera), new FXAAPass(), new OutputPass()],
  [scene, camera],
);
```

Inside an OIT pipeline, prefer `OITRenderPass.antialias = 'fxaa'` over adding a
separate `FXAAPass` — it's the same resolver wired into the pass.

### Shading aliasing is a separate problem

Edge-AA modes (SMAA/temporal) fundamentally **cannot** fix *shading* aliasing —
sub-pixel shimmer from sharp view/normal-dependent terms (specular highlights on
curved low-roughness metal, rim/Fresnel ramps). Only supersampling mitigates it via
brute force; the proper fix is analytic widening in the shader (clamp the ramp to
its screen-space footprint with `fwidth`, or roughness widening for specular). The
library already does this for the tube trajectories. If you author a material with a
sharp view-dependent term, apply the same technique.

---

## 7. Tone mapping and color

The pipeline renders the scene into a **linear, high-dynamic-range (FP16) buffer**
and applies tone mapping **once, at the very end**, in `OutputPass`. `OutputPass`
blits that buffer to the screen with a `MeshBasicMaterial` that has
`toneMapped: true`, so it applies `renderer.toneMapping` /
`renderer.toneMappingExposure` and the sRGB output encoding in a single step.

This is deliberate: OIT accumulation and additive/emissive glow must composite in
**linear** light, and tone mapping is non-linear
(`tonemap(a + b) ≠ tonemap(a) + tonemap(b)`), so it has to run **after** everything
is composited — not per material.

Two consequences follow.

**1. Scene materials must render linear (`toneMapped: false`).** A material left at
the Three.js default `toneMapped: true` would be tone-mapped in its own fragment
shader *and* again by `OutputPass` — a double tone-map (dark, desaturated). The OIT
variants set `toneMapped = false` automatically, but the **base** material (which
still renders in the opaque pass for fully-opaque objects) and any plain, non-OIT
material do not. If you author or add stock materials to an OIT pipeline, set
`toneMapped = false` on them.

**2. The per-material `toneMapped = false` opt-out is not honored as an opt-out.**
In stock Three.js, `toneMapped = false` means "leave this material's color alone."
Here it cannot: `OutputPass` tone-maps the whole buffer, so a material can neither
exclude itself from tone mapping nor preserve an authored, display-referred color.
This is the same limitation as Three.js's own post-processing `OutputPass` —
deferring tone mapping to a pass trades per-material granularity for HDR-correct
compositing. If you need content to bypass tone mapping (UI, gizmos, authored-sRGB
markers), composite it **on top of** `OutputPass` yourself (a separate overlay drawn
after the pipeline), rather than relying on `toneMapped = false`.

> Under the default storybook/dev canvas (`renderer.toneMapping = NoToneMapping`)
> none of this is visible: both the in-shader and the `OutputPass` tone-mapping steps
> are inert, and only the sRGB output encoding runs (once). The double-tone-map and
> the lost opt-out only appear once the host sets a real operator (ACES, AgX, …).

---

## 8. Gotchas checklist

- **Unwired transparent material → treated as opaque.** Any transparent material
  that isn't OIT-capable is drawn in the opaque pass and will occlude OIT geometry
  behind it. Wire it (§2), or verify via `oitPass.stats.oit`.
- **Routing reads `material.opacity` or `material.uniforms.opacity.value`.** A
  material that drives alpha through a differently-named custom uniform (e.g.
  `uOpacity`) is classified *opaque* and never routed through OIT. Mirror the value:
  set `material.opacity = yourAlpha` (or expose an `opacity` uniform) so the router
  sees it.
- **Cloned built-in variants snapshot appearance** (§3). To keep value properties
  live (e.g. `color`), pass `syncProperties` to `makeOitCompatible`; for live
  textures/program changes use a uniform-driven `ShaderMaterial`.
- **Don't nest opaque children under an OIT mesh** (§4) — they vanish in the opaque
  pass. Keep them as siblings.
- **`samples={0}` on the pipeline for OIT, and avoid `opaqueSamples` too.** The OIT
  auxiliary passes share the buffer's resolved single-sample depth texture and the
  result is composited single-sample, so MSAA (either the pipeline `samples` prop or
  `opaqueSamples`) adds cost and leaves a background-coloured fringe over transparent
  surfaces instead of anti-aliasing them (§6). Use `antialias` (temporal / SMAA) or
  `supersample` instead. (The pipeline `samples` prop is for plain opaque
  `RenderPass` pipelines with no OIT.)
- **Shading aliasing needs analytic widening, not an AA pass** (§6).
- **Tone mapping is applied once at `OutputPass`, for the whole buffer** (§7). Scene
  materials must render linear (`toneMapped = false`) or they double-tone-map, and
  the per-material `toneMapped = false` opt-out is **not** honored — composite
  display-referred content on top of the pipeline instead.

---

## 9. API reference

- `OITRenderPass` — [src/rendering/passes/OITRenderPass.ts](../src/rendering/passes/OITRenderPass.ts)
- `RenderingPipeline` — [src/rendering/RenderingPipeline.tsx](../src/rendering/RenderingPipeline.tsx)
- `makeOitCompatible`, `attachOitVariants`, `isOitCapable` — [src/rendering/oit-material.ts](../src/rendering/oit-material.ts)
- `OitMaterial` — [src/rendering/OitMaterial.tsx](../src/rendering/OitMaterial.tsx)
- `LAYERS`, `createLayers` — [src/layers/layers.ts](../src/layers/layers.ts)
- AA passes — [src/rendering/passes](../src/rendering/passes)
- `FXAAPass` (standalone FXAA post pass) — [src/rendering/passes/FXAAPass.ts](../src/rendering/passes/FXAAPass.ts)
- Live example — [src/storybook/examples/OITRenderPass.example.stories.tsx](../src/storybook/examples/OITRenderPass.example.stories.tsx)
