# Chunks

> **Status:** largely built. The component skeleton, the outline system, the shared
> tessellation and the worker-backed generator all exist; this document is now both a
> design record and a description of what is there. Sections marked **open** are
> genuinely unresolved — see §10.
>
> **§10 is the agreed direction** and supersedes parts of §9: coverage becomes a
> per-layer concern, the chunk outline becomes a pure user crop, and both `cap` and
> `optional` are scheduled for removal. Superseded sections are marked in place.

## 1. Motivation

The **Chunk** is the central concept for subsurface block visualization: a solid,
layered block built from a stack of depth surfaces, clipped to an XZ outline, with
coloured side walls between intervals. Everything a user does *after* a chunk is
created — opacity, surface peeling, top-material choices, cutaways — belongs to the
chunk. So the chunk should be a first-class **component**, not just an SDK builder
called from a story.

Target scale: an oil field (20–80 km²). Users zoom from a whole-field overview down
to individual wellbore detail, so the design must respect LOD, async geometry
building, GPU picking, and annotations from the start.

## 2. Core model

### 2.1 A scene is a ChunkStack

A scene is a **vertical stack of chunks**, all built by the same component:

- **`Chunk`** — an ordered run of boundaries (§2.3). Everything is one of these.
- **`OceanChunk`** — water at sea level down to a seabed, using the animated water
  shader; hosts buoyant children. Still built on the older per-layer builder.
- **Basement** — *not* a component. A `Chunk` takes a `basement` prop
  (`basement={{ thickness: 800 }}`) which closes the block off with a flat base and
  a dark rock material. A synthetic `offset` layer (§2.4) expresses the same thing
  in the layer list, and is the more consistent spelling; the `basement` slot
  predates it and is kept as sugar.

They all reuse the same **outline → clip → shared-rim → walls** machinery.

### 2.2 Shared interfaces are implicit

Interfaces between stacked surfaces are implicit in the chunking concept: **the first
surface added is the top, the last is the base, and every surface in between is
simultaneously the base of the interval above it and the top of the interval below.**

- `OceanChunk` with a single surface → that surface is the **seabed**.
- `OceanChunk` with more surfaces → they naturally become each other's tops/bases.

Where a watertight seam is wanted (e.g. water → seabed → geology), surfaces are
shared vertex-for-vertex on a common rim. Where a **gap** is wanted (between
geological groups), no wall bridges the interval. (See 2.3.)

### 2.3 Layers, and the interval below each one

A chunk's boundaries are supplied as a **flat, ordered array**, `layers:
ChunkLayer[]`, shallowest first. Each layer is a boundary, and it declares the
**interval BELOW it**:

- `material` — the cap drawn AT that boundary;
- `fill` — the volume between it and the next layer down. Omitted / `null` /
  `false` means no volume, so a bare sheet and a gap between zones are the same
  statement. `fill: true` reuses the layer's own `material`.

This replaced an earlier model in which layers were supplied as a **2D array** of
groups (zones), with walls filling only within a group and adjacent groups implicitly
separated by a gap. The flat form says the same things but locally, per layer,
instead of through nesting — which matters once layers also carry `cap`, `optional`
and synthetic definitions. `layersFromGroups(groups)` converts the old shape and is
kept for migration.

### 2.4 Synthetic layers

A layer does not need a surface behind it. Instead of `surface`, it may give:

- `depth` — a constant, **metres below sea level**;
- `offset` — metres below the layer ABOVE it;
- `relief` — a procedural perturbation of that plane (`procedural-relief.ts`:
  `duneRelief`, `ridgeRelief`, anchored in WORLD space via `featureSize` so the
  pattern does not swim when a chunk's footprint changes).

These are how water surfaces, flat basement floors and stand-in horizons are
expressed without inventing a data grid for them. They take part in the stack fully:
they are resolved, they carry walls, and they collapse.

**Depth convention: positive-down.** `depth: 0` is sea level, `depth: 105` is 105 m
below it. Distances (`offset`, relief `amplitude`, basement `thickness`) are positive
magnitudes. This matches how surfaces are given (`SurfaceMeta.min`/`.max` are positive
depths) even though the scene's Y axis points the other way.

## 3. The three reactive layers (the load-bearing decision)

The single most important architectural rule: keep these layers strictly separated so
that cheap changes never trigger expensive rebuilds.

1. **Outline** — the XZ footprint(s). Derived from a polygon *or* from wellbores.
   Changes when the cut source / cut parameters change.
2. **Geometry** — clipped surfaces + walls + caps for that outline. **Expensive**;
   should be **worker-backed** (a generator). Rebuilds *only* when the outline,
   the source surfaces, or tessellation parameters change.
3. **Appearance & interaction** — opacity, surface peeling, materials, colour
   gradients, highlight. **Reactive and cheap**; must **never** rebuild geometry.

At field scale, if opacity/peel ever rebuild geometry the interactive experience
collapses. The component boundaries must enforce layer 2 ≠ layer 3.

> Lesson already learned (OIT): transparency correctness needs materials rebuilt on
> some appearance changes, but that is a *material* concern — it must not cascade
> into a *geometry* rebuild.

## 4. Outline system (in flux — pluggable strategies)

An outline is a first-class, derived object. A chunk consumes an outline; it does not
own the raw cut inputs.

### 4.1 CutoutSource

```
CutoutSource =
  | { kind: 'polygon'; polygon: PlanarPolygonGeometry }
  | { kind: 'wellbores'; wellbores: string[]; options: OutlineOptions }
```

`OutlineOptions` (per chunk): `minRadius` / `maxRadius`, `feather` (soft edge width),
`shapeFn` (cos/sin-based radius modifier for organic edges), clustering thresholds,
and a **tighten ↔ loosen** knob (less noise per wellbore vs. more surrounding
context). We expect **more than one generation strategy** and treat this as a
pluggable interface rather than a fixed algorithm.

### 4.2 Wellbore-derived outline pipeline

For the surfaces **in a given chunk**:

1. **Crossings** — for each wellbore trajectory, compute where it enters/exits each
   surface in the chunk (sample the curve; compare its depth to the surface depth at
   that XZ via the existing world→grid + `sampleValidGrid`). Collect the min/max
   entry/exit XZ points → a rough point cloud. *(New SDK helper:
   trajectory-vs-surface crossings.)*
2. **Cluster** — cluster the point cloud in XZ. A shallow chunk whose wells share a
   template collapses to a **single** cluster; a deep chunk whose wells have deviated
   in different directions yields **multiple** clusters.
3. **Field + threshold** — build a distance field (min distance to the union of the
   buffered points/segments), threshold at the radius (clamped to min/max), apply
   `feather` (smoothstep) and `shapeFn`.
4. **Contour** — marching squares → one or more outline polygons (multi-component +
   holes, which `PlanarPolygonGeometry` already supports).

This is the "auto-mask from trajectories" idea, now **per chunk**.

> **Implemented (2026-07-12):** the SDK pipeline now exists as pure helpers —
> `createSurfaceDepthSampler` + `collectTrajectoryPoints` (footprint of a
> trajectory polyline within a chunk's depth window), `clusterPoints2D`, and
> `createWellboreOutline` (distance-field → threshold `radius` clamped to
> `min/max`, `feather`, `shapeFn`, `marchingSquares` → smoothed, grouped
> outer/hole components). `marchingSquares` and `ringsToPolygonCoordinates` are
> reusable building blocks. The `CutoutSource` (§4.1) is wired into
> `ChunkStack`/`Chunk`, which resolve a `{ kind: 'wellbores' }` source from the
> chunk's own top/base surfaces. Full pipeline still main-thread (no worker yet).

### 4.3 Per-chunk variation (a feature, with options)

Because chunks are made from different groups/zones, and their outlines are computed
independently, footprints legitimately differ with depth — a **feature**, controlled
per chunk:

- a **wide** seabed chunk,
- a **narrower** mid-zone,
- deeper zones (incl. the reservoir) **tightened** (less noise per wellbore) or
  **loosened** (more surrounding context),
- the deepest chunk possibly split into **multiple** outlines from divergent wells.

Vertically adjacent chunks with different footprints therefore "telescope"/step — this
is intended. When *not* wanted, a chunk can **inherit or share** an outline.

### 4.4 Shared outline

Optionally, a **single shared outline** encapsulates the *entire* set of trajectories
across the whole stack — a coherent "stack view" where every chunk shares one
footprint. This is the coherent alternative to per-chunk telescoping.

## 5. Component skeleton (settled — start here)

A **builder/provider** supplies shared inputs; declarative chunk children pull from
it. (`Wells` sets the precedent for a render-prop; for chunks we prefer
context + declarative children because each chunk carries its own materials,
children, and event handlers.)

```tsx
// Provider: shared data source, CRS, LOD, and the cut source(s).
<ChunkStack
  surfaces={column}           // the whole column, shallowest first
  outline={envelope}          // envelope: must contain every chunk
  cutSource={...}             // default CutoutSource (polygon or wellbores)
>
  {/* Water down to the seabed: a synthetic layer, then a real surface. */}
  <Chunk
    layers={[
      { depth: 0, material: '#3fa9d8', fill: '#2f7fa8' },
      { surface: seabed, material: '#c2b280' },
    ]}
  />

  <Chunk
    layers={[
      { surface: a, material: '#4e79a7', fill: true },
      { surface: b, material: '#f28e2c' },   // no fill: gap below b
      { surface: c, material: '#59a14f', fill: '#3d7a37' },
      { surface: d, material: '#e15759' },
    ]}
    outline="inherit"          // 'inherit' | polygon | CutoutSource
  />

  <Chunk
    layers={[...]}
    outline={{ kind: 'wellbores', wellbores, options }}
  />

  {/* Basement: a flat floor `thickness` below the last layer. */}
  <Chunk layers={[{ surface: deepest, material: '#6b6b6b', fill: '#4a4a4a' }]}
         basement={{ thickness: 800 }} />
</ChunkStack>
```

Responsibilities:

- **`ChunkStack`** (builder/provider): resolves shared data, CRS, LOD (via the
  existing `Distance` system), the shared column and the default cut source. Exposes
  derived data via context.
- **`Chunk`**: declares its `layers`, its outline choice (`inherit` | polygon |
  explicit `CutoutSource`), and children. It builds geometry via a **worker
  generator** and applies appearance/interaction reactively.
- **Materials are not part of the geometry.** `ChunkLayer.material` / `.fill` take a
  colour string or a `Material`, and are resolved in `ChunkMeshes` — the appearance
  layer. A `Material` instance is the CALLER's and is never disposed by the chunk; a
  colour produces a material the chunk owns and disposes. Changing either rebuilds
  nothing.

### 5.1 Interactions

- **Focus well** (one concept, two effects): selecting a wellbore can drive *both*
  the outline (a cutaway around it) *and* peeling (transparent overburden above the
  target). Optionally view-dependent (which side is opened depends on camera).
- **Peeling / opacity** — per-chunk / per-surface, reactive (layer 3).
- **Picking + annotations** — chunk surfaces participate in the GPU-picking
  `EventEmitter` (click-to-focus, hover) and can carry labels via the annotation
  system.

### 5.2 Build progress

Geometry building is asynchronous and can take seconds, so a host needs to know:

- `onBuild(metrics)` — per-chunk timings, counts and `diagnostics` once built;
- `onBuildStateChange(state)` — `ChunkBuildState`: `'building' | 'ready' | 'empty' |
  'failed'`;
- `ChunkStackProgress` — `{ total, building, completed, fraction }` from the stack.

`'empty'` is not a failure: a chunk whose outline is trimmed away entirely resolves
to nothing, and `onBuild` never fires for it. Without the state callback that is
indistinguishable from a hang — which is exactly how it presents.

## 6. Ocean & Basement specifics

- **Buoyancy is global and decoupled.** Floating objects use `useBuoyancy`, which
  samples a single global wave field published by the ocean. Therefore an
  `OceanChunk` can **clip the visible water** to a chunk outline **without**
  constraining where buoyant objects live. Keep one global ocean wave field for
  buoyancy/context; `OceanChunk` is just a clipped water surface + body view.
- **Basement** has a **flat base** `thickness` below its top; the top is the chunk's
  deepest surface (attached) or a standalone assigned/procedural (rocky) surface.
  Deferred: expand the base outward (a "bottom of the void" feel) and a vertical
  colour **gradient** (darker toward the base).

## 7. Cross-cutting: LOD, workers, picking

- **Worker generation** for geometry (async; loading/suspense states) — the SDK
  builder is synchronous today and must be promoted.
- **LOD** via `Distance`: coarse outline + low tessellation when far, refine when
  near (the builder already exposes `maxError` / `rimSpacing` / `segments`).
- **GPU picking + annotations** as first-class chunk capabilities.

## 8. Relationship to the existing SDK

The component wraps and reuses the current SDK:

- `createSurfaceChunk` (groups, walls, basement), `createClippedSurface`,
  `densifyPolygon`, `buildIntervalWalls`, the constrained-Delaunay triangulator, and
  the ocean-box builders.
- New SDK building blocks anticipated: **trajectory-vs-surface crossings**, the
  **outline generators** (distance-field / clustering / contour), and a **chunk
  worker generator**.

> **Implemented (2026-07-12):** the outline building blocks now ship in the SDK —
> `surface-outline.ts` (`createSurfaceOutline`: a surface's valid-data rim →
> `PlanarPolygonGeometry`, reusing `traceValidBoundary`/`smoothRings` +
> `surfaceGridToWorld`), `wellbore-outline.ts` (the trajectory pipeline),
> `marching-squares.ts`, and `polygon-outline.ts` (`ringsToPolygonCoordinates`).
> Still anticipated: the **chunk worker generator**.

## 9. Shared tessellation (settled — 2026-08-06)

A chunk is built on **one triangulation shared by every layer**, not one TIN per
surface. This is the load-bearing geometric decision, so it is worth stating why.

### 9.1 Why

Independently simplified TINs are each within `maxError` of their own grid, but with
different vertex sets. Two surfaces closer than `2 × maxError` can therefore
interpenetrate even where the underlying grids never cross — which is what the
z-fighting in the deep, thin units was. It is a *simplification* artefact, not a
depth-buffer one, and no amount of grid-level correction fixes it because the error
is introduced after that pass.

With one vertex set and one topology the guarantee is exact:

> if `y_above(v) ≥ y_below(v)` at every vertex, then it holds everywhere, because
> linear interpolation over the same triangle preserves the inequality.

This also survives vertical exaggeration (a monotone per-vertex scale) and makes
painter's-algorithm ordering exact for the stack, which is what transparency needs.

### 9.2 Pipeline

1. `buildStackReference` — the finest layer's grid, cropped to the outline (and
   decimated to a node budget), becomes a **common domain**. Every layer is
   bilinearly resampled onto it, converted to **scene Y**, and its holes filled from
   the nearest valid sample so the triangulator has no cliff to chase. A per-layer
   `mask` records where the data is real.
2. Per-layer refinement — independent and CPU-bound, so it runs across an internal
   worker pool (`refineStackChannels`). The **union** of the candidate nodes is what
   the shared TIN must carry.
3. `buildSurfaceStack` — tessellate once (rim as constraint edges), sample every
   layer's heights and coverage, resolve, collapse, and emit one geometry per layer.
   Use this entry point: resolving without collapsing leaves welded duplicate
   surfaces, which is the one thing a shared tessellation still z-fights on.

### 9.3 Ordering is the caller's contract

**The array order of `Chunk.layers` IS the stratigraphic order.** Nothing in the
library infers it, and it must not: depth is a *consequence* of the geology, not a
definition of it. In practice the host sorts by stratigraphic age from its own
column (surface name → unit `top`/`base` → age); that mapping is company-specific
and stays in the host app, like colour.

Measured on the demo field, ordering by `meta.max` (a surface's deepest sample over
its *whole* extent, not inside the chunk) put ~52 % of every pair inverted; ordering
by age reduced that to ~5 %, and agreed exactly with the order measured from the
data. If a surface has no age, **exclude it** — placing it by depth reintroduces
precisely the key that misorders the stack.

### 9.4 Resolve modes (`ChunkResolveOptions`)

- `mode: 'truncate'` (default) — clamp the height (so the block stays sealed) **and**
  mark the unit absent where it was cut away, so the redundant welded surface is
  dropped rather than drawn. `'clamp'` keeps it, for comparison only.
- `minGap` — default `0`. A shared tessellation does not need a gap, and a positive
  one gives every pinch-out an artificial thickness that exaggeration multiplies.
- `collapseThreshold` — thickness below which a unit counts as absent (default
  0.5 m). This is what removes coplanar duplicates.
- `coverageAbsence` — a surface mapped over a smaller area than the chunk is
  **absent** out there, not flat. Saying so explicitly (from the coverage mask)
  replaced an earlier feathered grid-level clamp, which only smoothed over the same
  question.
- `refineTerminations` — default on. See §9.6.

### 9.5 Which surface wins (shallow, deliberately)

Both resolvers cascade shallow → deep and clamp the **deeper** surface down to the
shallower one. The shallow surface never moves; the deeper one is truncated and
marked absent where it was cut.

That is **erosional truncation**: the younger surface cuts down into the older
units, which are genuinely absent above it. It is the dominant pattern here — the
Base Cretaceous Unconformity is exactly this, and it is why `VIKING GP. Base` and
`Eiriksson Fm. 2 JS Top` measure coincident over 90.8 % of their shared area.

The opposite case is real too: **onlap** onto a paleo-high, where the deeper
surface is topography that stood proud and the younger unit should thin against it
instead of flattening it. Commercial geomodelling carries this per horizon
(*erosional* vs *baselap*), and a real column mixes both; `SurfaceMeta` has no such
flag today.

Shallow-wins is kept as the conservative default because deep surfaces are the less
trustworthy ones (poorer imaging, fewer penetrations), so a deep surface poking
through a shallow one is more often an error than a paleo-high — and because the
alternative does not merely flip a comparison: a feature *poking through* the chunk
above needs a hole cut in that chunk and its walls closed around it, which ends the
sealed-block property. Expect a per-surface option eventually; the cascade
direction itself is a one-line change, the rendering is not.

### 9.6 Terminations follow the contour, not the triangles

A unit's triangles are dropped where it is thinner than `collapseThreshold` at all
three corners. That test is *exact*, not eager — thickness is the difference of two
linear interpolants over shared topology, so if all three corners are within the
threshold the whole triangle is. Nothing is over-dropped.

But the height refinement only ever looks at one surface at a time, so it puts no
vertices where two of them converge — and in flat areas its triangles are hundreds
of metres wide. The pinch-out could then only terminate on whatever edges happened
to be there, which came out as a coarse sawtooth.

`collectThicknessCrossings` closes that: the grid nodes where a pair's thickness
crosses the threshold are fed back in as refinement candidates, so the mesh is fine
along the termination and nowhere else. The raw test speckles wherever two surfaces
run nearly parallel a hair apart, so the thin/thick classification is majority-voted
over the 4-neighbourhood first — a patch a node or two across cannot control a
triangle anyway.

**It is not cheap.** Measured on the demo field (4 layers, `maxError` 5): triangles
roughly **doubled** (17.9k → 37.5k on the top chunk), tessellation time with them.
The de-speckling accounts for only ~2 % of that, so the cost is genuinely long
contours, not noise. `refineTerminations: false` turns it off for comparison.

### 9.7 A chunk is cut back to where it has data

> ⚠️ **Superseded by §10.1.8.** Trimming the chunk to its data is a whole-footprint
> answer to a per-layer question; once extents are per-layer the outline becomes a
> pure user crop and `trimPolygonToCoverage` goes. Kept here because it is what the
> code does today, and because the reasoning below — on why a wall at a data edge is
> the most confident of the available lies — is what §10.1.5 answers properly.

A surface's data extent is where the **survey** stopped, not where the geology did.
The difference caused the worst-looking defect on this branch: the outline included
ground where none of a chunk's surfaces were mapped, every layer was dropped there,
and what remained was a hole straight through a solid block with the wall still
standing around it — which reads as a rendering artefact, not as information.

Four things could be done about it, and three of them assert something false:

- **draw the hole fill** — claims the unit is flat out there;
- **drop the triangles** — the hole above;
- **put a wall at the data edge** — claims the unit *terminates* there. This is the
  most confident lie of the four, and it is why per-surface piecewise walls were
  considered and rejected: the case where they would fire is exactly the case where
  no wall should be drawn. (Terminations also occur in the chunk *interior*, where
  there is no rim to hang a wall on, so it would not even be complete.) Note that
  the common termination — a genuine pinch-out — needs no wall at all: the two
  surfaces already meet.
- **trim the outline** — this one. It converts a data edge into an *outline* edge,
  and an outline is an admitted arbitrary cut, so the wall drawn there keeps the
  only meaning a wall ever has: "this is where we chose to stop".

`trimPolygonToCoverage` combines the chunk's coverage masks, rasterises the outline
over them, traces the surviving region, smooths and simplifies it. When the outline
is fully covered the **original polygon is returned by identity**, so a chunk that
needs no trimming is bit-for-bit unaffected. Nothing covered at all ⇒ `null` ⇒ the
generator returns no chunk.

It runs before `densifyChunkRim`, so the walls and the basement follow the trimmed
footprint automatically and the block stays sealed.

**`coverageRule`** decides what "covered" means. `'all'` (default) keeps only where
every layer is mapped; it is the self-consistent rule, because inside the result no
layer is ever dropped for want of data, nothing stands on hole fill, and every wall
runs between two known surfaces. `'any'` keeps more of the requested footprint but
preserves exactly the inconsistency that made the defect — layers vanishing inside
the chunk, walls whose lower edge sits on fill.

Measured on the demo field (`surfaceFrom` 15 and 16): only one chunk of three
needed trimming, and it kept **98.5–98.7 %** of its footprint. Afterwards every
layer reports 100 % coverage and `droppedAbsent` falls to ~0. The earlier worry that
`'all'` would cost ~50 % came from a different surface pairing and did not
materialise here — but `outlineTrimmed` / `outlineCoverage` are reported in the
diagnostics precisely because a chunk silently shrinking must not be silent.

⚠️ The traced boundary is cell-quantised (honest — data extents *are*), then
smoothed and simplified with `simplifyRing`. Simplification is not cosmetic: a
traced ring carries one vertex per cell, and every one becomes an inserted vertex
and a constraint edge, which measured **28,689 triangles instead of 10,513** on the
same chunk. Note also that the *whole* boundary is retraced, not only the cut part,
so a trimmed chunk's outline is a reconstruction of the requested one to within the
simplification tolerance.

⚠️ Trimming happens in the worker, so the main-thread outline registry (used by
`coverAbove`) still holds the untrimmed polygon. That only makes the cover test
slightly generous.

### 9.8 A chunk's top layer and the chunk above

Dropping a zero-thickness fragment is safe *within* a chunk: layer *i* is only
dropped where it is coincident with layer *i−1*, which the same chunk draws with
the same outline, so something is always there to see.

The **top** layer is the exception. On a shared column its `absent` mask comes from
the column, so it is truncated against a surface belonging to the chunk *above* —
one this chunk does not draw. The drop is still needed where that chunk covers the
spot (two coincident surfaces from two independent tessellations z-fight), but
where it does not, the drop opens a hole into the block with the wall still standing
around it.

So the top layer's absence applies only inside `SurfaceChunkSpec.coverAbove`, the
outline of whichever chunk draws the surface above. Chunks are independent siblings
and cannot ask each other, so `ChunkStack` brokers it: each chunk registers the
surfaces it draws **on mount**, before any outline resolves, and publishes its
outline once resolved. A chunk can then tell *nobody draws that surface* (build now)
from *somebody does, their outline is coming* (wait one render) — and never builds
twice. A chunk that resolves to **no** footprint publishes `null` explicitly;
without that distinction every chunk beneath it would wait forever.

Coverage-driven absence is **not** gated: that fragment would be pure hole-fill, and
inventing geology to plug a gap is worse than the gap.

Known limitation: the test uses the neighbour's *outline*, not whether it actually
drew that spot — if the covering surface is itself dropped there, this still
suppresses. Chasing it needs cross-chunk drop state, and with it a build ordering
between chunks.

Diagnostic: `topKept` counts the vertices whose absence was overridden. On the demo
field it is ~0 — the chunk outlines nest closely enough that the case is rare — so
this is insurance, not a visible fix.

With `coverageRule: 'all'`, coverage-driven absence should never fire at all: the
outline has already been cut back to where every layer is mapped. It stays on as a
backstop, and matters under `'any'` and for optional layers (§9.9).

`SurfaceChunkLayerDiagnostics.coverage` is measured over the **requested** footprint,
before the trim. Measuring it after — at the surviving vertices — made it read 1 for
every layer of every chunk by construction, which looked like a clean bill of health
and was in fact no measurement at all. Read before the cut it answers the question
the field exists for: *which layer shrank my chunk?* On a trimmed chunk
`outlineCoverage` equals the smallest `coverage` among the layers that were allowed
to trim it.

### 9.9 Borrowed boundaries (`optional`)

> ⚠️ **Superseded by §10.1.** `optional` and `collapseOptionalChannels` are scheduled
> for removal: the clamp described below is what produces the near-vertical curtains
> at data edges, and the midpoint taper (§10.1.3) replaces it. Kept here because it is
> what the code does today.

A chunk is trimmed to where **all** of its layers are mapped (§9.8), which is the
right rule for the layers a chunk is *about* and the wrong one for a boundary it
merely **borrows** from the chunk next to it.

Two chunks that meet share a horizon: the wider one caps it, the narrower one carries
it with `cap: false` (§9.7). But `cap` only suppresses drawing — the layer is still a
full member of the stack, so it still votes in the trim. A detail chunk whose own
surfaces are mapped everywhere therefore shrinks to the extent of whatever survey
happens to define its floor. On the demo field the wellbore-cut chunk lost a fifth of
itself to `Basement Base`, a surface it does not even draw.

`optional: true` takes that vote away. The layer no longer cuts the outline, and
where it has no data of its own the interval it bounds is clamped to zero thickness
(`collapseOptionalChannels`) and dropped, so the chunk stops where its knowledge
stops.

The clamp is the load-bearing half. `buildStackReference` fills a layer's holes from
the nearest valid sample, which is invisible for a layer the chunk is trimmed to —
inside the trimmed footprint the fill is never reached. An optional layer is
deliberately not trimmed to, so its fill *is* reached, and a flat extrapolation of a
survey edge is the most confident lie the geometry can tell: a surface, and a solid
volume down to it, conjured out of nothing. Pinching the interval out instead asserts
only what is known.

The layer's coverage is still reported, so the trade stays visible rather than
silently buying area.

`optional` is expected to be **temporary**. Once sealing between chunks is inferred
rather than declared (§10.1.9), a borrowed boundary will be recognisable as such and
the flag can go.

### 9.10 Out of scope

Faults with heave, reverse or overturned geometry **cannot** be represented by a
stack of height fields. Detect and report them; do not mangle them. Anything needing
true 3D volumes belongs to a different component.

## 10. Direction (agreed 2026-08-10)

Coverage handling grew one fix at a time — trim the outline (§9.7), then exempt
borrowed boundaries (§9.9) — and each fix bought area by asserting something. The
agreed replacement is a single model, described here as the target. `cap` and
`optional` are both **scheduled for removal**; do not build on them.

### 10.1 The model

1. **A layer's extent is its own.** Each layer has a coverage mask on the shared grid
   (this exists). **Bounded fill** (§13.1) turns the raw mask into an *effective*
   extent: holes within `maxFill` metres of real data are filled as now, everything
   beyond stays absent. One threshold, in metres, covering interior holes and the
   space past a grid's edge alike — they are the same operation seen from two sides.

2. **Intervals are classified per region, not per surface pair.** For an interval
   bounded by A and B, take the **symmetric difference** of their effective masks —
   nodes where exactly one is known — and measure the maximum inward distance `D`
   across it. `D` quantifies how badly the two disagree about where they exist, using
   the chamfer transform `fillNearest` already runs.

   A *global* similarity score between two surfaces cannot work: hole area in real
   data spans three orders of magnitude (§13), so any single score is either too
   coarse to accept a small mismatch or too permissive to refuse a large one. `D` is
   local, so one bad region does not condemn the pair.

3. **Small `D` → mold to the midpoint.** Taper both surfaces toward their midpoint
   across the mismatch, so the interval closes on itself. Continuous (no cliff),
   symmetric (neither surface is privileged, unlike shallow-wins clamping), bounded
   (error ≤ `D`), and airtight without a cap. This supersedes
   `collapseOptionalChannels`, whose abrupt one-cell clamp is what produces the
   near-vertical curtains and spikes at data edges today.

4. **Large `D` → terminate, and say so.** The interval stops. Its boundary is traced
   to a ring and closed with a face.

5. **A data edge looks artificial, because it is.** Three different things end a
   surface and they must not look alike: a **user crop** (the chunk outline), a
   **geological pinch-out** (the unit genuinely thins to nothing), and a **data
   edge** (we stopped knowing). The third is drawn as a clean, obviously artificial
   cut.

6. **Terminations are walls on interior rings.** Per-layer extents do **not** require
   per-layer triangulations. The tessellation stays shared (§9.1); what varies per
   layer is which subset of the shared triangles is drawn — which is what
   `droppedAbsent` already does. The work is generalising wall generation from "the
   chunk rim ring" to *any* set of rings, fed by traced coverage boundaries. Same
   machinery, more rings.

7. **A carrier guarantees closure.** A group may declare a termination surface
   guaranteed complete over the area, against which its members terminate; a
   constant-depth plane is the degenerate case. This replaces the `basement` slot and
   bounds how far a wall can stretch. ⚠️ A carrier makes it easy to draw large
   invented volumes — it needs the same distance bound and the §10.1.5 appearance.

8. **The chunk outline becomes a pure user crop.** Once extents are per-layer,
   coverage stops being a cropping concern: the outline means "where the user wants
   to look", nothing more. `trimPolygonToCoverage` and `optional` go.

9. **Sealing is inferred.** Where one chunk's footprint contains another's, the wider
   one caps the shared horizon. `cap` goes. Partial overlap is the hard case and is
   why this comes last.

### 10.2 Sequence

Numbered by dependency, not importance.

0. **Synthetic surfaces** (§14) — nothing below can be calibrated against a single
   field without over-fitting to it.
1. **Bounded fill** — small, self-contained, improves current behaviour alone.
2. **Multi-ring walls** — the enabling geometry; testable with a hand-made mask.
3. **Taper vs terminate** — needs 1 and 2.
4. **Cut-face appearance** — needs 2.
5. **Outline as user crop** — needs 1–4; deletes `optional`.
6. **Carrier surfaces** — largely independent; retires the `basement` slot.
7. **Inferred sealing** — deletes `cap`; last, because partial overlap interacts with
   per-layer extents.

⚠️ Step 2 is where triangle count compounds with termination refinement, which
already roughly doubled it (§10.3.2). Measure before and after; do not assume.

### 10.3 Still open

1. **Outline strategies** — expect several (polygon, wellbore distance-field, convex
   / concave hull, corridor buffer). Pluggable interface, not a fixed algorithm.
2. **Truncation edges** — terminations are refined along the thickness contour
   (§9.6), which removed the sawtooth but roughly doubled the triangle count.
   Inserting the contour as a *constraint edge* rather than as extra candidates
   would make the cut exact and might cost less; worth judging on a structurally
   complex dataset rather than a flat one.
3. **Per-surface truncation rule** — erosional vs onlap, per §9.5. Needs a flag on
   `SurfaceMeta` (or alongside it) and, for onlap, a way to cut a hole in the chunk
   above.
4. **Ocean unification** — `OceanChunk` still uses the older per-layer builder rather
   than the shared tessellation. The open question is whether `Ocean` decomposes into
   a *material* plus a per-frame updater, in which case a water layer is just
   `{ depth: 0, material: oceanMaterial }` and `OceanChunk` retires; if `Ocean` must
   own its meshes it is a restructure.
5. **One stack or several, when grids differ** — *recorded, not urgent.* A stack welds
   together two separable things: a **resolve domain** (one depth-order pass, one
   shared rim, so chunks agree about cross-over) and a **sampling domain** (one
   reference grid every layer is resampled onto, decimated to `maxNodes` over the
   envelope). Only the first is a modelling concern. Because they are welded, a user
   whose surveys sit on different grids must choose: one stack, and the shared grid
   resamples both families and coarsens each to accommodate the other; or two stacks,
   keeping each family's lattice but losing cross-over resolution and the shared rim
   at the seam.

   The criteria today: **one stack wherever surfaces can interact** — if depth ranges
   overlap anywhere they can cross, and two independent resolves can disagree.
   **Two stacks only when the depth regions are genuinely disjoint** *and* the grids
   differ; connect them with `cap: false` as usual. The trap is that "disjoint depth
   regions" must hold everywhere in plan, not on average — comparing `min`/`max` is
   not sufficient evidence (§9.3).

   The eventual answer is probably to decouple them: one column (ordering, sealing,
   cross-over) over *several* reference grids, one per grid family, with cross-family
   resolve on a common grid only in the interval where the families actually overlap.
   That shares its shape with per-layer extents (§10.1) — both are about letting a
   layer keep its own extent and its own sampling instead of inheriting the chunk's —
   so it should be settled *after* the §10.2 sequence, which may well determine it.
   Likely an edge case in practice, and a pure capability addition when it comes: a
   single stack is the safe default and stays correct.

### 10.4 Resolved

- **Inherit vs own vs shared outline** — settled: `outline` takes `'inherit'`, a
  polygon, or a `CutoutSource`, and `ChunkStack` carries the shared default and the
  envelope.
- **Component pattern** — settled: context + declarative children.
- **Basement as a slot** — superseded. It becomes the degenerate carrier (§10.1.7).

## 11. Stack-level build

Each `Chunk` owns its tessellation, so its no-interpenetration guarantee is its
own. Two chunks whose footprints overlap could still cross where one's base meets
the next one's top. Different clipping shapes are *not* the obstacle — the clip
does not have to be part of the tessellation.

**Built (2026-08-06)** — declare the column on the stack:

```tsx
<ChunkStack outline={polygon} surfaces={column}>
  <Chunk layers={column.slice(0, 4).map(surface => ({ surface, fill: true }))} />
  <Chunk layers={column.slice(4, 8).map(surface => ({ surface, fill: true }))} />
</ChunkStack>
```

`ChunkStack.surfaces` is the whole column, shallowest first. When it is present,
the generator builds a **shared column context**, cached and keyed by the ordered
surface ids:

1. fetch every layer once,
2. resample onto one common grid over the stack's **envelope** footprint,
3. make the column monotone on that grid (`resolveStackGrid` — an elementwise `min`
   down the channels, since every layer shares the nodes),
4. refine the channels once.

Each chunk then tessellates **its own outline** against that shared, already
ordered reference and takes a view of the channels for its own layers. The first
chunk pays; the rest await the same promise.

Why this is enough: bilinear sampling is a convex combination, so an ordering that
holds at every grid node holds at every sample point, and each chunk's triangles
preserve it. A chunk is exactly as correct as one built with `resolveStackOrder`,
and now *agrees with its neighbours* because they all sampled grids ordered
together.

What it does not give: two chunks tessellate independently, so their meshes stay
within `2 × maxError` of each other — bounded, and only where footprints overlap.
The envelope for a wellbore cut source is resolved over the **full** depth window,
which by construction contains every chunk's narrower window.

**If that residual ever matters**, the remaining step is to hoist the tessellation
too: one triangulation with every chunk's outline as constraint edges, each chunk
taking the triangle subset inside its own outline (the same mechanism
`collapseStackTriangles` uses). That would make the guarantee exact across chunks —
at the cost of every chunk carrying the union of the whole column's detail
(measured ~11× a single layer's vertex count). Nothing built above needs to change
for it; the tessellation simply moves up a level.

## 12. Build order

1. **Component skeleton** (settled): `ChunkStack` provider + `Chunk` (with the
   `basement` slot) and `OceanChunk`, wrapping the existing SDK builder (still
   main-thread at first), with the three-layer separation in place.
2. **Outline SDK helpers** (in flux): trajectory-vs-surface crossings → clustering →
   distance field → contour, with per-chunk options. **— done (2026-07-12):**
   `createSurfaceOutline` (surface rim) and the `createWellboreOutline` pipeline
   (`collectTrajectoryPoints` → `clusterPoints2D` → distance field →
   `marchingSquares`), wired through the `CutoutSource` on `ChunkStack`/`Chunk`.
3. **Worker generator** for chunk geometry (async). **— done**, and rebuilt on the
   shared tessellation (§9) in 2026-08-06.
4. **Vertical exaggeration** — a `scale={[1, k, 1]}` group on `ChunkStack`; safe
   because of §9.1, and needing no shader or material work. *Deferred.*
5. **Interactions**: focus-well (outline cut + peel), picking, annotations, buoyancy
   children on `OceanChunk`.

## 13. What surface data actually looks like

The machinery in §9.8–9.10 exists because of the shape of real surface data, so it is
worth writing down what that shape is. Two independent things make a grid incomplete,
and they need different answers:

1. **The mapped area is not the rectangle.** A grid is a rectangle, but the surface
   was interpreted over some polygon inside it. Everything outside is nodata. This is
   large, it is not an error, and it is where two surveys of different vintage stop
   agreeing with each other.
2. **Interior holes.** Genuine gaps inside the mapped area — poor imaging, a salt
   body, an area nobody picked.

The demo dataset (Volve, 36 surfaces) is a useful calibration, with the caveat that
**it is one dataset and should not be over-fitted to**:

- Nodata is encoded as **`-1`**, in values stored **normalized** as
  `max - depth` — so valid values are `[0, max-min]` and the sentinel is
  unambiguous. Testing for `null`/`NaN` finds nothing and quietly reports full
  coverage.
- There are **two grids**, not 36: a shallow family (1001×1681) and a deep family
  (921×1357). Same 25 m increment, same 220° rotation, different origins and sizes.
  Eleven of the deep surfaces share one identical nodata mask — one interpreted
  polygon, reused.
- The two origins differ by a **non-integer** number of cells (23.33, 303.93), so a
  common grid still needs sub-cell interpolation even when increment and rotation
  match. Alignment of `xinc`/`rot` is common; lattice alignment is not.
- Interior holes exist in 9 of the 36, and their size spans **three orders of
  magnitude**: from 0.06 km² to 44.8 km² (ZECHSTEIN GP. Top).

That spread is the important part, and it is what makes hole filling a *policy*
rather than a yes/no. Filling 0.06 km² is obviously right; filling 44.8 km² flat is
obviously wrong; nothing distinguishes them today.

### 13.1 Bounded fill (§10.1.1)

`buildStackReference` fills every invalid node from the nearest valid one via a
two-sweep chamfer transform, so **the distance to real data is already computed and
then discarded**. Thresholding it costs almost nothing:

- within `maxFill` metres of real data → fill, and count the node as covered;
- beyond it → leave it absent, and let the existing absence/trim machinery deal with
  it.

One rule, in metres so it is independent of grid resolution, covering both cases
above: an interior hole and the space past a grid's edge are the same operation seen
from different sides. It also makes a surface's extent a matter of degree rather than
all-or-nothing, which is what §9.9's `optional` is crudely approximating.

Not built. The value needs judging against data, not argument.

## 14. Synthetic surfaces

A **shipped capability**, not test scaffolding. Two reasons, in order of importance:

1. **Lowering the barrier.** A user evaluating this library should be able to see
   chunks working without first mapping their own field into our data types. That is
   otherwise the single largest thing standing between opening the docs and seeing
   something on screen.
2. **Testing what one dataset cannot show.** Every decision in §10 needs data we do
   not have: holes of controlled size to calibrate `maxFill`, controlled extent
   mismatch to exercise taper-vs-terminate, differing rotations and origins for
   §10.3.5. Tuning constants against a single field and calling the result general is
   how you ship something that only works on Volve.

### 14.1 It must be DATA, not a layer type

Synthetic surfaces enter through the **store**, as `surface-meta` + `surface-values`
with the same nodata and normalization conventions as real data (§13). They then take
the identical path — `buildStackReference`, masks, resolve, tessellate — so what is
tested is the real pipeline and not a parallel one.

This is different from the synthetic *layers* of §2.4, which are data-free boundaries
(`depth`/`offset`/`relief`) evaluated during the build. Both are useful; they are not
the same thing, and a synthetic surface is the one that exercises coverage.

### 14.2 One store, so determinism is cheap

An earlier draft of this section claimed generated values had to be reproducible
across the main thread and the worker, and that the spec therefore had to be encoded
in the surface id. That was wrong. There is exactly **one** `MockStore`, living in the
`remote-mock-store` worker; the main thread and the generator worker both call it
through comlink. Generated values are produced once, memoized, and transferred as
buffers — the same path a fetched grid takes.

Determinism is still worth having, because a story that draws different geology on
each reload is not a fixture. But it is a property of the field functions (all
hash/trig-based, seeded, no RNG state), not a constraint on the API.

Generation is memoized rather than written to files: no build step, and no generated
data to drift out of step with the specs that describe it. Exporting to
`public/data/synthetic/` is a small script on top of the same generator if a static
fixture is ever wanted.

### 14.3 Scope

What the §10 sequence needs to be validated, and no more:

- a mapped polygon inset inside the grid rectangle (the real-world case, §13);
- interior holes of specified area, and ragged edges;
- controlled extent mismatch between two surfaces (to sweep `D`);
- deliberate cross-overs and pinch-outs;
- differing `xinc` / `rot` / origin, for §10.3.5.

Shared with `tests/`, which currently hand-rolls small grids.

⚠️ A terrain generator can absorb unlimited effort. Grow it on demand rather than
designing a general toolkit up front.

### 14.4 Consequence for the demo data

`public/data` was modified during development. Once synthetic surfaces exist, that is
no longer necessary: the **original open dataset is restored**, and any scenario it
cannot show is generated instead. Demo data should stay unmodified open data, so that
what a reader sees is reproducible from the published source.
