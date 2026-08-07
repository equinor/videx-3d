# Chunks (design proposal)

> **Status:** design / in progress. This document captures the architecture we are
> converging on for a **Chunk** component family, before implementation. The
> component skeleton (below) is considered settled enough to start building; the
> **outline system** is still in flux and is expected to grow more than one outline
> generation strategy.
>
> Background/prototype: the SDK builder `createSurfaceChunk` and the
> `Spikes/Surfaces/SurfaceChunk` story already produce grouped, clipped, walled
> chunks with a procedural/surface **basement**. This document is about promoting
> that into a reusable **component** architecture.

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

A scene is a **vertical stack of chunks**. There is one Chunk concept with a few
subtypes that differ only in their top/base semantics, material, and behavior:

- **`Chunk`** — a geological stack of surfaces (grouped into zones; see 2.3).
- **`OceanChunk`** — water at sea level (`y = 0`) down to a seabed, using the
  animated water shader; hosts buoyant children.
- **`BasementChunk`** — a block below the deepest surface with a **flat base** and a
  dark (optionally gradient) rock material.

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

### 2.3 Groups (zones) within a chunk

A chunk's surfaces are supplied as a **2D array**: each inner array is a *group*
(zone) whose first surface is its top and last is its base. Walls fill only the
intervals **within** a group; adjacent groups are separated by an **empty gap**.
Chunks are usually built from surfaces belonging to different groups/zones.

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
  surfaces={surfaceRefs}      // available surfaces / meta
  cutSource={...}             // default CutoutSource (polygon or wellbores)
>
  <OceanChunk seabed="topSurfaceId">
    {/* buoyant children (platforms, vessels) */}
  </OceanChunk>

  <Chunk
    groups={[['a','b'], ['c','d','e']]}
    outline="inherit"          // 'inherit' | 'own' | CutoutSource
    material={...}
  />

  <Chunk groups={[...]} outline={{ kind: 'wellbores', wellbores, options }} />

  <BasementChunk thickness={800} /> {/* or top: surface | procedural */}
</ChunkStack>
```

Responsibilities:

- **`ChunkStack`** (builder/provider): resolves shared data, CRS, LOD (via the
  existing `Distance` system), and the default cut source. Exposes derived data via
  context; may also offer a render-prop for the "map data → chunks" convenience.
- **`Chunk` / `OceanChunk` / `BasementChunk`**: declare their groups/surfaces, their
  outline choice (`inherit` | `own` | explicit `CutoutSource`), materials, and
  children. Each builds its geometry via a **worker generator** and applies
  appearance/interaction reactively.

### 5.1 Interactions

- **Focus well** (one concept, two effects): selecting a wellbore can drive *both*
  the outline (a cutaway around it) *and* peeling (transparent overburden above the
  target). Optionally view-dependent (which side is opened depends on camera).
- **Peeling / opacity** — per-chunk / per-surface, reactive (layer 3).
- **Picking + annotations** — chunk surfaces participate in the GPU-picking
  `EventEmitter` (click-to-focus, hover) and can carry labels via the annotation
  system.

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

**The array order of `Chunk.groups` IS the stratigraphic order.** Nothing in the
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

### 9.5.1 Which surface wins (shallow, deliberately)

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

### 9.7 A chunk's top layer and the chunk above

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

### 9.5 Out of scope

Faults with heave, reverse or overturned geometry **cannot** be represented by a
stack of height fields. Detect and report them; do not mangle them. Anything needing
true 3D volumes belongs to a different component.

## 10. Open decisions

1. **Outline strategies** — expect several (polygon, wellbore distance-field, convex
   / concave hull, corridor buffer). Pluggable interface, not a fixed algorithm.
2. **Inherit vs own vs shared outline** — API for per-chunk telescoping vs a coherent
   shared footprint.
3. **Component pattern** — context + declarative children (preferred) vs render-prop
   (Wells precedent); possibly both.
4. **Truncation edges** — terminations are refined along the thickness contour
   (§9.6), which removed the sawtooth but roughly doubled the triangle count.
   Inserting the contour as a *constraint edge* rather than as extra candidates
   would make the cut exact and might cost less; worth judging on a structurally
   complex dataset rather than a flat one.
5. **Per-surface truncation rule** — erosional vs onlap, per §9.5.1. Needs a flag on
   `SurfaceMeta` (or alongside it) and, for onlap, a way to cut a hole in the chunk
   above.
6. **Group unification** — ocean and basement are still separate slots rather than
   special group types, and `OceanChunk` still uses the per-layer builder.

## 11. Stack-level build

Each `Chunk` owns its tessellation, so its no-interpenetration guarantee is its
own. Two chunks whose footprints overlap could still cross where one's base meets
the next one's top. Different clipping shapes are *not* the obstacle — the clip
does not have to be part of the tessellation.

**Built (2026-08-06)** — declare the column on the stack:

```tsx
<ChunkStack outline={polygon} surfaces={column}>
  <Chunk groups={[column.slice(0, 4)]} />
  <Chunk groups={[column.slice(4, 8)]} />
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

1. **Component skeleton** (settled): `ChunkStack` provider + `Chunk` /
   `OceanChunk` / `BasementChunk` wrapping the existing SDK builder (still main-thread
   at first), with the three-layer separation in place.
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
