# Unified Trajectory component (design)

> **Status:** implemented. The design below has shipped as the `Trajectory` component.
> For usage see the [Trajectory guide](./trajectory.md); for upgrading existing
> `BasicTrajectory` + `TubeTrajectory` code see the
> [migration guide](./trajectory-migration.md). This document is retained as the
> original design rationale.

## Motivation

Today a wellbore trajectory is drawn by **two** components:

- [`BasicTrajectory`](../src/components/Wellbores/BasicTrajectory/BasicTrajectory.tsx)
  — a `Line` + `LineBasicMaterial`, ~1 px wide. Cheap (2 vertices per segment), used
  at field scale.
- [`TubeTrajectory`](../src/components/Wellbores/TubeTrajectory/TubeTrajectory.tsx)
  — a `mesh` + `TubeMaterial`. `radius` and `radialSegments` are **baked into the
  generated geometry**, so changing radius rebuilds the geometry. Used when the camera
  is close.

The intended UX is "always at least a 1 px line, gaining real thickness/depth as you
approach." Achieving this with two components has three costs that get worse at field
scale (1–1500 visible trajectories):

1. **Double generation + double memory** — two generators run per wellbore and two
   geometries are held on the GPU.
2. **Radius rebuilds geometry** — `TubeTrajectory` regenerates on every radius change,
   which is painful across many wellbores and blocks a smooth "thicken as you zoom"
   feel.
3. **No path to Y-axis scaling** — the planned vertical-exaggeration setting would
   otherwise require regenerating every trajectory geometry.

## Goals

- **One component, one generator, one geometry** per trajectory.
- **Radius as a shader uniform** — change thickness (and a future **Y-axis scale**)
  without rebuilding geometry.
- **Screen-space minimum radius (~1 px)** so the tube reads as a thin line at field
  scale and gains thickness continuously as the camera approaches — no LOD popping on
  the *radius*.
- **Reuse the `Casings` rendering pattern** (instanced segments + vertex-shader
  displacement + custom picking material + OIT variants) that is already proven in the
  codebase.
- **Keep it a good citizen** in the host R3F app: OIT-compatible, works with the
  `Highlighter` and the `EventEmitter` picking system, honours the standard
  `CommonComponentProps` / `CustomMaterialProps`.

Chosen approach: **Option 3** — a casing-style instanced tube with a coarse
**radial-segment geometry LOD**, rather than a flat screen-space ribbon (option 1) or
a fragment-shader cylinder impostor (option 2). Rationale: it keeps a *true round tube*
up close (matching casings/completion), reuses working infrastructure, and contains the
one real perf risk (field-scale vertex cost) behind a simple low/high geometry swap.

## Current architecture (what we're replacing)

The two components are **not** self-switching — they are composed manually by the host
app using [`WellboreBounds`](../src/components/Wellbores/WellboreBounds/WellboreBounds.tsx)
+ [`Distance`](../src/components/Distance/Distance.tsx). The canonical pattern (from
[`Wells.example.stories.tsx`](../src/storybook/examples/Wells.example.stories.tsx)):

```tsx
<WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
  <BasicTrajectory color={color} priority={9} />
  <Distance min={0} max={2000}>
    <TubeTrajectory radius={0.1 * sizeMultiplier} radialSegments={8} priority={8} />
  </Distance>
</WellboreBounds>
```

- `WellboreBounds` runs a `useFrame` that computes camera→wellbore distance (from a
  generated bounding sphere, divided by `camera.zoom`) into a `DistanceContext` ref
  **every frame**.
- `Distance` reads that ref in its own `useFrame` and toggles `group.visible`
  (or mounts/unmounts children when `onDemand`) based on `min`/`max`.

So what "rendered twice" actually means: **`BasicTrajectory` is always mounted and
drawn**, and within 2000 m `TubeTrajectory` is drawn *on top of it*. In the overlap
band (the near field, where the most detail — casings, completion — is also on) every
trajectory pays for **both** a line draw and a tube draw, plus two generators ran and
two geometries are resident. This is the concrete cost the unified component removes.

**Implication for the rework:** the unified component can *either* keep consuming the
existing `DistanceContext` to drive its internal radial LOD (no new machinery), *or*
run its own `useFrame` distance check. Reusing `DistanceContext`/`WellboreBounds` is the
lower-risk path and keeps the host composition (`<WellboreBounds>…</WellboreBounds>`)
unchanged — the user just drops one `<Trajectory/>` where two components used to be.

## Background: the pattern we are inheriting

The `Casings` component
([`CasingSection.tsx`](../src/components/Wellbores/Casings/CasingSection.tsx),
[`CasingMaterial.ts`](../src/components/Wellbores/Casings/CasingMaterial.ts),
[`casing-geometry.ts`](../src/components/Wellbores/Casings/casing-geometry.ts))
already does everything this rework needs:

- Geometry is an **`InstancedBufferGeometry`**. One *segment* of the tube is the
  instanced template (a small `vertex` attribute where `.x` = around the ring,
  `.y` = along the segment 0→1, `.z` = inner/outer wall). Per-segment data
  (`positionA/B`, `tangentA/B`, `curvePositionA/B`, `outerRadiusA/B`) lives in an
  interleaved **instanced** buffer, so the whole trajectory is **one draw call**.
- The **vertex shader**
  ([`shaders/vertex.glsl`](../src/components/Wellbores/Casings/shaders/vertex.glsl))
  reconstructs each vertex from the segment endpoints and applies the radius from
  uniforms: `segmentRadius = sizeMultiplier * mix(innerRadius, outerRadius, vertex.z)`.
  **Radius is never baked into the geometry** — exactly the property we want.
- Picking uses a dedicated
  [`CasingEmitterMaterial`](../src/components/Wellbores/Casings/CasingEmitterMaterial.ts)
  (extends `CustomPickingMaterial`) whose **vertex shader repeats the same
  displacement** so the picked silhouette matches what is drawn.
- Order-independent transparency is added with `attachOitVariants(...)` (the
  `TubeMaterial` already does this too).

## Proposed design

### Component

A single component (working name **`Trajectory`**) that supersedes both existing ones:

```tsx
<Wellbore id={wellbore.id}>
  <Trajectory color="red" radius={0.5} />
</Wellbore>
```

Props (superset of the two current components):

| Prop | Meaning |
| -- | -- |
| `color` | Line/tube colour (uniform, hot-swappable). |
| `radius` | Real-world tube radius in metres. Shader uniform — **no rebuild**. |
| `minPixelRadius` | Screen-space floor (default ~1 px) so it never thins below a line. |
| `radialSegments` | Cross-section resolution *for the high LOD* (default 8–16). |
| `yScale` | (future) vertical exaggeration; applied in the vertex shader. |
| `priority` | Generator scheduling priority (unchanged). |
| …`CommonComponentProps`, `CustomMaterialProps`, `PointerEvents` | As today. |

It reads `id`, `fromMsl`, `segmentsPerMeter`, `simplificationThreshold` from
`useWellboreContext()` like both current components.

### Geometry / generator

A new generator (working name `trajectory`) produces an **instanced single-wall tube**,
i.e. a simplified `casing-geometry` (no inner wall, no slice faces, optional end caps).
Per-segment instanced attributes: `positionA/B`, `tangentA/B`, and a normalized
`curvePosition` (for depth-based colouring / future along-hole effects). **Radius is NOT
an input to the generator** — it is applied in the shader.

Because `radialSegments` is baked into the *index buffer* of the instanced template, it
**cannot** be changed per frame in the shader. This is the crux of the LOD strategy
below.

### Material

A `TrajectoryMaterial` (hand-rolled `ShaderMaterial`, same lineage as `TubeMaterial` /
`CasingMaterial`):

- Uniforms: `diffuse` (color), `radius`, `sizeMultiplier`, `minPixelRadius`,
  `yScale`, plus the standard `ShaderLib.basic` uniforms.
- Vertex shader reconstructs the tube from segment endpoints (as casings do) and:
  - applies `radius * sizeMultiplier` to the ring,
  - applies the **screen-space minimum radius** clamp (see below),
  - applies `yScale` to the reconstructed world position.
- `attachOitVariants(this)` for OIT.
- Prop-driven values (`color`, `radius`, …) synced imperatively via
  `onMaterialPropertiesChange`, matching the existing components' pattern.

### Screen-space minimum radius (~1 px)

In the vertex shader, after computing the clip-space position of the axis point,
convert the desired 1 px into a world/clip radius at that depth and take the max with
the physical radius:

```glsl
// pseudo
vec4 clip = projectionMatrix * mvPosition;
float pxToClip = 2.0 / viewportHeight;              // 1 px in NDC-y
float minWorldRadius = clip.w * pxToClip * minPixelRadius; // perspective-correct
float effectiveRadius = max(physicalRadius, minWorldRadius);
```

This gives a continuous transition: at field scale `effectiveRadius` is the 1 px floor
(reads as a line); as the camera approaches, `physicalRadius` overtakes it and the tube
gains real thickness — **no discrete LOD switch on radius**.

**Pipeline realities to get `viewportHeight` right (verified in this repo):**

- **No automatic resolution uniform exists.** Three/R3F does not feed viewport size to a
  `ShaderMaterial`. Components that need it read `useThree(state => state.size)` and set
  it manually (e.g. `BoxGrid` calls `setGridSize(state.size)`); the AA resolvers keep a
  `resolution: Uniform(Vector2)` (see
  [`fxaa-resolver.ts`](../src/rendering/fxaa-resolver.ts)). The unified component must
  sync a `resolution` uniform the same way.
- **`viewportHeight` must be the *render-target* height, not CSS pixels.** The custom
  pipeline renders into a buffer of `cssSize × dpr × supersample`
  ([`RenderingPipeline.tsx`](../src/rendering/RenderingPipeline.tsx) reads
  `useThree(size, viewport)` and takes a `supersample` prop). If `minPixelRadius` is
  meant as *displayed* CSS pixels, the shader floor must be multiplied by
  `dpr × supersample` so a "1 px" line is 1 px **after** downsampling — otherwise the
  line thins by the supersample factor at SSAA > 1. `supersample` is a pipeline prop, not
  currently exposed to components via context; feeding it in (or exposing it on
  [`rendering-state.ts`](../src/rendering/rendering-state.ts) alongside
  `transparencyMode`) is an open design point.
- **Log-depth compatibility.** The pipeline can run with a logarithmic depth buffer
  (`logDepth` in the debug harness). The vertex path already includes
  `<logdepthbuf_vertex>`; the screen-space clamp operates on `clip.w`/`mvPosition` before
  the log-depth remap, so it is unaffected — but this must be verified in the spike
  across `logDepth`, `dpr`, and `supersample` combinations (the AA/pipeline notes in
  `AGENTS.md` call these out as the usual footguns).
- **Orthographic camera.** The `clip.w`-based perspective scaling degenerates under an
  orthographic projection (constant `w`); if ortho is a supported camera, the pixel
  math needs an ortho branch (use the projection's world-units-per-pixel directly).

### Radial-segment LOD (the one real perf lever)

Because ring resolution is fixed at build time, provide **two prebuilt geometries** per
trajectory: a **low** LOD (e.g. `radialSegments = 3–4`, essentially a prism that still
reads as a line/thin tube at distance) and a **high** LOD (8–16, round up close). The
component swaps which geometry is bound based on the trajectory's projected size /
camera distance. This is the *only* LOD left, and it is a cheap geometry-binding swap —
not two React trees, not two generators.

**Reuse the existing distance machinery.** `WellboreBounds` already publishes a
per-frame camera distance via `DistanceContext` (see
[Current architecture](#current-architecture-what-were-replacing)). The component can
`useContext(DistanceContext)` and pick low vs high LOD from that ref in a lightweight
`useFrame` (swap `mesh.geometry`), matching how `Distance` already consumes it — no new
distance system. When no `DistanceContext` is present (component used bare), fall back
to always-high, or a self-contained bounding-sphere distance check.

**Memory note:** two LOD geometries per wellbore sounds like more, but the low LOD is
tiny (3–4 radial segments) and — crucially — radius is *not* baked, so we no longer keep
a full high-res tube *and* a separate line as today. Net resident geometry per wellbore
should be comparable-to-lower, and generation is one generator instead of two.

> This is what keeps field-scale vertex cost bounded. See [Performance](#performance).

### Material & shading behaviour

The existing `TubeMaterial`
([shaders](../src/sdk/materials/shaders/trajectory/)) already carries readability logic
worth preserving in `TrajectoryMaterial`:

- **`DEPTH_SHADE` define (on today):** view-space silhouette-rim darkening with
  **analytic AA** (`ndvAA = max(ndv, fwidth(ndv))`) to stop the sub-pixel edge fringe
  that SMAA/TAA can't fix, plus a distance darken (`vViewPosition.z / 5000`). Keep this;
  it's the tube's built-in edge AA and directly relevant to the thin-line look.
- **Non-`DEPTH_SHADE` branch:** fades **alpha** with distance
  (`1 - clamp(z/100000, 0, 0.9)`) instead of darkening. Decide which default the unified
  component ships.
- **Transparency defaults differ between today's components** and must be reconciled:
  `BasicTrajectory`'s line is `transparent, opacity 0.95` (via `makeOitCompatible` on
  `LineBasicMaterial`); `TubeTrajectory` is effectively opaque. Pick one default
  (probably opaque, with opacity opt-in) so the unified look is consistent across the
  zoom range.
- **OIT:** follow `TubeMaterial`/`CasingMaterial` and call `attachOitVariants(this)`;
  the fragment shader already guards `#ifdef USE_OIT`. Update
  [`oit-component-status.md`](./oit-component-status.md) when done.

### Picking

Picking goes through the `EventEmitter` /
[`PickingHelper`](../src/components/EventEmitter/EventEmitter.tsx) system, **not** the
mesh's visible material. The mechanism (verified):

- A component registers via `eventHandler.register({ object, handlers, ref,
  customMaterial })` (see `CasingSection`'s effect). The helper renders the *same*
  object/geometry with `customMaterial` into a small pick buffer cropped around the
  pointer, reading `object.userData.__emitterID` to identify the hit.
- `customMaterial` is a
  [`CustomPickingMaterial`](../src/components/EventEmitter/picking-material.ts)
  (`allowOverride = false`, `emitterId` uniform).

So add a `TrajectoryEmitterMaterial` (extends `CustomPickingMaterial`) whose vertex
shader **replicates the radius + screen-space + `yScale` displacement**, exactly as
[`CasingEmitterMaterial`](../src/components/Wellbores/Casings/CasingEmitterMaterial.ts)
mirrors `CasingMaterial`. Because it renders the *same* `InstancedBufferGeometry`, the
per-segment instanced attributes are already present. Attach it only when pointer
handlers are present (same conditional as `CasingSection`).

**Bonus:** the emitter's screen-space floor can use a **larger** `minPixelRadius` than
the visible material (e.g. a few px), so a hair-thin far-field trajectory stays easy to
hit even though it *draws* as ~1 px. The current `Line`-based `BasicTrajectory` has no
such control and is genuinely hard to pick at distance — this is a real UX win, and it
stacks with the `PickingHelper`'s existing `threshold` radius.

> Note: the pick buffer has its own resolution/crop, so the emitter's screen-space math
> must derive its pixel scale from the pick render target — not the main viewport — or
> the pickable silhouette won't match. Confirm during the picking phase.

### Highlighter — confirmed issue, must be addressed

The [`Highlighter`](../src/components/Highlighter/Highlighter.tsx) builds a "ghost"
object by **reusing the source object's `geometry`** but assigning a stock
`MeshBasicMaterial` (additive blend, `depthWrite:false`, `DoubleSide`), then tags it
`LAYERS.EMISSIVE` so `OITRenderPass` draws it in the emissive pass between the opaque
and transparent layers. It branches on `InstancedMesh` / `Mesh` / `Line`.

Our object is a `Mesh` wrapping an `InstancedBufferGeometry`, so it takes the **`Mesh`
branch** and reuses the geometry with `MeshBasicMaterial` — which knows nothing about
the per-segment instanced attributes or the vertex displacement. Result: the ghost
renders the raw, undisplaced unit template (wrong radius, no screen-space floor, no
`yScale`). **Confirmed broken.**

> Note: `MeshBasicMaterial` on an `InstancedBufferGeometry` whose real vertex data lives
> in a custom `vertex` attribute (not `position`) may not even render a sensible shape —
> so this isn't just "wrong radius", it may be garbage. Verify early.

Options (to decide during the highlighter phase):

1. **Let the highlighter reuse the object's real material** (or a cloned highlight
   variant of it) when the object opts in — so the displacement is reproduced. Cleanest
   result but touches the shared `Highlighter` (and would need an additive/emissive
   variant of `TrajectoryMaterial`).
2. **Expose a `highlightMaterial` on `userData`** that the highlighter prefers over
   `MeshBasicMaterial` when present — smallest change to the shared component, opt-in.
3. Emit a dedicated additive **highlight variant** of `TrajectoryMaterial` and register
   it (the picking pattern already establishes "a component supplies its own variant").

Option 2 is likely the best cost/benefit. This is the highest-risk integration point and
should be **tested first**, before polishing visuals.

### Y-axis scale (future)

The planned vertical-exaggeration setting is a **new capability with no existing
infrastructure** in the repo (confirmed: no `yScale`/`verticalExaggeration` scene
concept exists today outside unrelated grid helpers). Two decisions to make:

- **Where it lives.** A per-`Trajectory` prop is simplest, but a vertical-exaggeration
  setting is inherently *scene-wide* — every depth-bearing component (surfaces, seismic,
  casings…) must agree or the view desyncs. A shared store/context (mirroring the
  `rendering-state.ts` per-scene store, or `DistanceContext`) is the more consistent
  home; the trajectory work should not invent a one-off prop that later fights a global
  setting. **Flag for a separate design** — this component just needs to *consume* it.
- **Shader correctness.** Applying a non-uniform `yScale` to world position in the
  vertex shader **breaks tangents and normals** unless they are rescaled too. The tube
  cross-section is built from the curve tangent (`positionA/B`); after scaling Y, the
  effective tangent changes, so lighting/`DEPTH_SHADE` rim and the ring orientation must
  use the *scaled* tangent (normals transform by the inverse-transpose of the scale).
  This is a genuine correctness item, not a cosmetic one, and applies equally to the
  emitter and any depth material.

## Performance

Honest assessment — the guaranteed wins are **memory, generation, and flexibility**,
not automatically per-frame speed:

- **Wins:** one generator + one geometry per wellbore (was two); radius/`yScale`
  changes never rebuild geometry; smooth screen-space thinning with no popping.
- **Risk — field-scale vertex cost:** "always a tube" processes `radialSegments`× more
  vertices than the current `Line` at field scale. With 1500 trajectories this is the
  worst case. **Mitigation:** the low radial-segment LOD (3–4) keeps the far-view vertex
  count close to the old line while still using the unified path.
- **Draw calls unchanged:** one draw per trajectory (~1500 at field view), same as
  today — each centerline differs, so cross-trajectory instancing is not feasible here.
  Batching/merging is a separate, orthogonal optimization.
- **Fill rate:** a tube clamped to ~1 px covers roughly the same fragments as the line,
  so fill is not the concern; vertex processing is.

**The spike must measure** field-view frame time at 1500 trajectories (low LOD) against
the current two-component setup before this is committed.

## Migration / compatibility

- Keep `BasicTrajectory` and `TubeTrajectory` exported initially; add `Trajectory`
  alongside them. Migrate stories/examples, then deprecate.
- Must work with React 18 and 19 and current Three.js (WebGL2), per repo constraints.
- Run prettier with the repo config; typecheck with
  `npx tsc --noEmit -p tsconfig.json`; unit tests with `npx vitest run`.

## Open questions / risks (validate in the spike)

1. **Highlighter** — confirm which of the three fixes above is acceptable, and verify
   the highlight silhouette matches the displaced tube; also confirm `MeshBasicMaterial`
   on the custom-`vertex`-attribute geometry doesn't render garbage. (Highest risk.)
2. **Field-scale vertex cost** — measure 1500 trajectories at the low LOD; confirm no
   regression vs. the current `Line`.
3. **Low-LOD appearance** — does a 3–4-sided prism read acceptably as a "line" at
   distance, or do we need a genuinely line-like lowest LOD?
4. **Screen-space clamp under log-depth / supersample / dpr** — verify the pixel math
   holds across the pipeline's render settings; decide whether `supersample` is exposed
   to the component (via `rendering-state.ts`) so "1 px" means 1 *displayed* px.
5. **Pick-buffer pixel scale** — the emitter's screen-space floor must use the pick
   render target's resolution, not the main viewport, to keep the pickable silhouette
   aligned with the drawn tube.
6. **Transparency default** — reconcile `BasicTrajectory` (semi-transparent 0.95 line)
   vs `TubeTrajectory` (opaque) into one consistent default; decide `DEPTH_SHADE` (depth
   darken) vs the alpha-fade branch as the shipped behaviour.
7. **`yScale` ownership + normal/tangent correctness** — decide scene-wide store vs prop
   (likely a separate design), and rescale tangents/normals in every variant (visible,
   emitter, depth).
8. **`customDepthMaterial` / shadows** — if trajectories cast/receive shadows, the depth
   material needs the same vertex displacement (as with picking).

## Phased plan

1. **Spike (read-only-ish, measurable):** new instanced-tube generator +
   `TrajectoryMaterial` with radius uniform and screen-space clamp; render 1500
   trajectories at low LOD and **measure** vs. current. Gate on this number.
2. **Highlighter probe (do this inside/right after the spike):** because it is the
   highest risk and can invalidate the whole approach, verify a highlight can be made to
   match the displaced tube before investing further.
3. **Picking:** `TrajectoryEmitterMaterial`; verify hover/click hit-tests and the
   larger-pick-radius UX win.
4. **LOD:** wire the low/high radial-segment geometry swap, driven by the existing
   `DistanceContext` where present.
5. **`yScale`:** add the uniform + vertex application with correct tangent/normal
   rescale (coordinated with the separate vertical-exaggeration design).
6. **Migrate** stories/examples; reconcile transparency default; deprecate the old
   components; update `generators.md`, `oit-component-status.md`, and add a
   `trajectory.md` usage page.
```