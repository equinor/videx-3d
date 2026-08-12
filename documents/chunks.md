# Chunks

> **Status:** largely built. The component skeleton, the outline system, the shared
> tessellation and the worker-backed generator all exist; this document is now both a
> design record and a description of what is there. Sections marked **open** are
> genuinely unresolved — see §10.
>
> §10 is the agreed direction. Coverage is now a per-layer concern, the chunk
> outline is a pure user crop, and `optional` has been removed; `cap` has been
> removed too (§10.8). Superseded sections are marked in place.

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
- **Water** — not a component: a synthetic layer (§2.4) at `depth`, whose interval
  below it is the water body. It shares the tessellation with the sea bed under it.
- **A floor** — not a component either: the column's **carrier** (§10.9), one flat
  plane declared on the `ChunkStack` and drawn by the chunk that closes the block.

⚠️ There were once an `OceanChunk` component and a `basement` slot on `Chunk`,
both built on a separate per-layer builder. Both are **removed**: a tier of water
and a block of basement rock are ordinary chunks, and saying so in one vocabulary
is the whole point of the interval model. The animated water shader is a separate
question — see §10.3.4.

They all reuse the same **outline → clip → shared-rim → walls** machinery.

### 2.2 Shared interfaces are implicit

Interfaces between stacked surfaces are implicit in the chunking concept: **the first
surface added is the top, the last is the base, and every surface in between is
simultaneously the base of the interval above it and the top of the interval below.**

- A water layer over a single surface → that surface is the **seabed**.
- More surfaces below it → they naturally become each other's tops/bases.

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
instead of through nesting — which matters once layers also carry synthetic
definitions. `layersFromGroups(groups)` converts the old shape and is
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

`'empty'` is not a failure: a chunk whose outline resolves to nothing, or whose
layers have no data anywhere inside it (§9.9.1), has nothing to draw. Without the
state callback that is indistinguishable from a hang — which is exactly how it
presents.

## 6. Water specifics

- **Buoyancy is global and decoupled.** Floating objects use `useBuoyancy`, which
  samples a single global wave field published by the ocean. So the visible water
  can be clipped to a chunk outline **without** constraining where buoyant objects
  live — keep one global wave field for buoyancy and context, and let the drawn
  water be an ordinary chunk layer.
- ⚠️ The water layer is currently drawn with the standard chunk material. Putting
  the animated `Ocean` shader on it is open — §10.3.4.

## 7. Cross-cutting: LOD, workers, picking

- **Worker generation** for geometry (async; loading/suspense states) — the SDK
  builder is synchronous today and must be promoted.
- **LOD** via `Distance`: coarse outline + low tessellation when far, refine when
  near (the builder already exposes `maxError` / `rimSpacing` / `segments`).
- **GPU picking + annotations** as first-class chunk capabilities.

## 8. Relationship to the existing SDK

The component wraps and reuses the current SDK:

- `assembleChunk` (walls + metrics), `createClippedSurface`, `densifyPolygon`,
  `buildIntervalWalls`, the constrained-Delaunay triangulator, and the ocean-box
  builders. ⚠️ `createSurfaceChunk` / `clipChunkLayer` — the per-layer builder the
  component originally wrapped — are **removed**: the shared tessellation replaced
  them, and once the ocean and basement slots went, nothing but their own story and
  tests still called them.
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

#### 9.6.1 Coverage is read per corner, thickness per triangle

The same all-three-corners rule applied to a layer's **coverage** mask is not exact
— coverage is *binary* and interpolates nothing, so "all three corners uncovered"
means "draw wherever any corner has data", and a layer is then drawn up to a whole
triangle past the edge of its survey. Out in an unmapped flat there is nothing for
the refinement to chase, so that triangle can be enormous: the symptom was long
teeth hanging off an otherwise finely refined data edge.

⇒ A triangle is dropped as soon as **one** corner is uncovered, which keeps what is
drawn inside what is mapped. Truncation (`absent`) keeps the all-three rule: it is
derived from the heights, so it is exact in the same way the thickness test is.
Both live in `makeAbsentTriangleTest`, shared with `stackIntervalTriangles` so the
walls stop exactly where the surfaces do.

The cost is the mirror error: a triangle with one corner off the survey is dropped
whole, so the unit is bitten *inward* instead of spilling outward, worst as a
chamfer at a convex corner. Inward is the honest direction — never draw where there
is no data — and the bevel was judged acceptable.

⚠️ **Do not assume the bite is bounded by `maxError`.** The obvious model (finer
mesh ⇒ smaller edge triangles ⇒ smaller bite) predicts the opposite of what was
measured: a HIGHER `maxError` made the bevel SMALLER. Coverage crossings are
*forced* insertions, so the edge chain is at 1-cell spacing whatever `maxError` is,
and how that dense chain meets a sparse interior is evidently what governs the
bite. Unexplained; measure before theorising (a per-layer m² of "dropped triangles
that had a corner on data" would settle it).

#### 9.6.2 `constrainCoverage` — the exact version

`ChunkResolveOptions.constrainCoverage` traces each layer's mask boundary and
inserts it as **constraint edges** in `tessellateStack`, exactly as the outline rim
already is. No triangle then straddles a data edge, so the drop rule reads a
per-triangle flag (`StackTessellation.coverage`, a centroid test that is exact
*because* the ring is constrained) instead of the corners, and the bite and the
comb of slivers both disappear — the drawn area IS the mapped area. Default off.

It **replaces** `refineCoverage`, which defaults off when it is on: that pass exists
only to put vertices *near* an unconstrained data edge, and a constraint puts them
*on* it. That is also why it is not the cost it looks like — measured, the triangle
count went DOWN:

| | triangles, off | on | boundary vertices |
| --- | ---: | ---: | ---: |
| SeabedConnection, detail | 139,656 | 136,590 | 8,118 |
| SeabedConnection, basement | 241,088 | 221,532 | 8,102 |
| SyntheticColumn (`maxFill` 250) | 323,564 | 321,134 | 2,560 |
| SyntheticColumn (`maxFill` 0) | 320,507 | 316,671 | 15,216 |

`constraintFailures` is 0 in all of them, which is the check that matters: a
boundary that is not enforced is a claim the mesh does not support.

⚠️⚠️ The traced rings are deliberately **not simplified**, even though they carry
one vertex per cell. Ramer-Douglas-Peucker makes a rectilinear ring cross *itself*
where two arms of a staircase pass within the tolerance, and `nodeGridRings` does
not node a ring against itself — measured, a one-cell tolerance produced 36
constraint failures where the raw trace produces none. The raw trace follows cell
edges and cannot cross itself. (Simplification would need self-noding first; the
saving is an order of magnitude in boundary vertices, so it is worth revisiting if
a survey boundary ever dominates a build.)

Rings are deduped by mask **identity**, so a set of surfaces sharing one interpreted
polygon — 11 of the demo set do — is traced once, not once per layer.

⚠️ All of this only shows with `seal: false` — sealing invents a surface across the
gap and switches coverage-driven absence off.

### 9.7 A chunk is cut back to where it has data — REMOVED

> ⚠️ **Removed (§10.2 step 5).** `trimPolygonToCoverage` and `coverageRule` are
> gone; the outline is a pure user crop (§10.1.8) and coverage is measured, not
> acted on (`measureStackCoverage`). The reasoning below is kept because the
> question it answers is real and the answer moved rather than disappeared: the
> seal now closes a data edge (§10.7) instead of the outline retreating from it,
> and what is drawn there is marked as invention (§10.6).
>
> ⭐ What made trimming wrong was not the reasoning but the SCOPE: it is a
> whole-footprint answer to a per-layer question. One layer's survey edge reshaped
> the entire chunk, including the layers that were mapped perfectly well — and
> because the trim ran before the rim was densified, a chunk could silently come
> back a different shape than the one asked for.

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

⚠️ **This whole section describes removed code.** `coverageRule` is gone with the
trim; what follows is kept for the measurement it records, which is why the trim's
replacement reports the same figures per layer.

`trimPolygonToCoverage` combined the chunk's coverage masks, rasterised the outline
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

Coverage-driven absence is now the ordinary case rather than a backstop: nothing
cuts the outline back, so wherever a layer is not covered it is either sealed
(§10.7), dropped (`coverageAbsence`), or drawn on fill and marked as inferred
(§10.6).

`SurfaceChunkLayerDiagnostics.coverage` is measured over the footprint the caller
asked for, which is now the only footprint there is. It answers the question the
field exists for: *which layer is standing on nothing?* A layer at 0 is voided
(§9.9.1) and says so.

### 9.9 Borrowed boundaries (`optional`) — REMOVED

> ⚠️ **Removed (§10.2 step 5)**, along with `collapseOptionalChannels`. `optional`
> existed only to take a layer's vote away in the trim, and there is no trim
> (§9.7). A borrowed boundary now shrinks nothing, because nothing shrinks.
>
> The clamp it carried is replaced twice over: by the taper where a layer is
> partly mapped (§10.7), and by **voiding** where it is not mapped at all (below).

The reasoning it was built on still holds and is worth keeping. Two chunks that
meet share a horizon: the wider one caps it, the narrower one carries it without
drawing it (declared by hand as `cap: false` then, inferred now — §10.8). Not
drawing a layer never took it out of the stack, so under the old trim it still
voted, and a detail chunk whose own surfaces were mapped everywhere shrank to the
extent of whatever survey happened to define its floor. On the demo field the
wellbore-cut chunk lost a fifth of itself to `Basement Base`, a surface it does not
even draw.

#### 9.9.1 A layer with no data in the chunk is VOIDED

The genuinely hard case the flag was hiding: a layer mapped **nowhere the chunk is
drawn**. Sealing it would extend a survey that exists only outside the crop across
the whole chunk and draw a smooth, plausible horizon with no local evidence behind
it at all — exactly the large invented volume §10.1.7 warns about, and the taper's
own justification ("keep the relative depth it had where it was last mapped")
evaporates, because inside this chunk there is no such place.

So it is **voided**: no cap, and **both** intervals it bounds are left unfilled. Its
top and bottom are equally undefined, so open space from the layer above to the layer
below is the only statement the data supports — and, like `sealMode: 'void'`, the
hole IS the message and needs no legend.

coverage is 0. `maxFill` again draws the line: coverage counts bounded fill, so a
surface mapped just beyond the crop still has evidence reaching in and is sealed
normally. Only a layer with nothing within `maxFill` of the footprint is voided.
Same threshold as everywhere else, no new knob.

⚠️ It overrides `sealMode`, and is reported as
`SurfaceChunkLayerDiagnostics.voided` rather than left to be inferred from
`coverage: 0`.

⚠️ Implementation detail with teeth: a voided layer's channel is laid onto its
nearest surviving neighbour (as `buildStackReference` already does for a layer empty
over the whole grid) and its mask marked complete, so a surface nobody draws cannot
clamp the one below it in the monotone resolve or attract a taper. The honest figure
is the one already measured.

When **every** layer is voided the chunk has nothing to draw and resolves to
`'empty'` — which is a better trigger for that state than the trim returning no
polygon.

### 9.10 Out of scope

Faults with heave, reverse or overturned geometry **cannot** be represented by a
stack of height fields. Detect and report them; do not mangle them. Anything needing
true 3D volumes belongs to a different component.

## 10. Direction (agreed 2026-08-10)

Coverage handling grew one fix at a time — trim the outline (§9.7), then exempt
borrowed boundaries (§9.9) — and each fix bought area by asserting something. The
agreed replacement is a single model, described here as the target. `optional` and
the trim are **gone** (§10.2 step 5); `cap` is **gone** too (§10.8) — do not
build on it.

### 10.1 The model

1. **A layer's extent is its own.** Each layer has a coverage mask on the shared grid
   (this exists). **Bounded fill** (§13.1) turns the raw mask into an *effective*
   extent: holes within `maxFill` metres of real data are filled as now, everything
   beyond stays absent. One threshold, in metres, covering interior holes and the
   space past a grid's edge alike — they are the same operation seen from two sides.
   **Built**, and it behaves as an erosion radius rather than a size test, so a
   single value stays sane across the three orders of magnitude §13 measures.

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

   **Superseded by §10.7**: the taper is kept, but it applies at every scale rather
   than only to small mismatches, and it leans on the NEAREST neighbour instead of
   the midpoint — which pinches out the unit we have no data for rather than
   halving both. The one-cell clamp it replaced is gone with `optional` (§9.9).

4. **Large `D` → terminate, and say so.** The interval stops. Its boundary is traced
   to a ring and closed with a face.

   **Superseded by §10.7.** Leaving it open was tried on paper and rejected: a
   surface with no data still has mapped neighbours, so every interval it bounds
   disappears while they are drawn, and the chunk becomes a cap floating over a
   floor. `D` survives as `taperDistance`, but it now decides how far the inference
   is *drawn out*, not whether the block closes.

5. **A data edge looks artificial, because it is.** Three different things end a
   surface and they must not look alike: a **user crop** (the chunk outline), a
   **geological pinch-out** (the unit genuinely thins to nothing), and a **data
   edge** (we stopped knowing). The third is drawn as a clean, obviously artificial
   cut. **Superseded by §10.6** — it needs no appearance at ALL, let alone three.
   A pinch-out face has no height, so it cannot be seen; a data edge is closed by
   the seal rather than left standing; and a crop is the user's own cut. What is
   marked instead is the *invention* the seal put there, which is the thing a
   reader cannot otherwise tell from geology.

6. **Terminations are walls on interior rings.** Per-layer extents do **not** require
   per-layer triangulations. The tessellation stays shared (§9.1); what varies per
   layer is which subset of the shared triangles is drawn — which is what
   `droppedAbsent` already does. The work is generalising wall generation from "the
   chunk rim ring" to *any* set of rings, fed by traced coverage boundaries. Same
   machinery, more rings. **Built** — and it went further than "more rings": an
   interval's wall is now traced around the area that interval occupies, so the rim
   is not a special case but simply the part of that boundary which happens to lie
   on the outline (§10.5).

7. **A carrier guarantees closure.** A group may declare a termination surface
   guaranteed complete over the area, against which its members terminate; a
   constant-depth plane is the degenerate case. This replaced the `basement` slot
   (now **removed**) and bounds how far a wall can stretch. ⚠️ A carrier makes it
   easy to draw large invented volumes — it needs the same distance bound and the
   §10.1.5 appearance.

   ⭐ **ANSWERED: the carrier belongs to the COLUMN.** Built — see §10.9. Both open
   questions pointed the same way: `sealMode: 'void'` cannot move to the column
   while the deepest column surface has nothing below it, and the column seal fell
   back to its one-neighbour rule for that same surface. The justification for that
   fallback — two chunks may hang DIFFERENT floors under one horizon, so a
   chunk-private boundary must not set a shared height — is really an argument for
   declaring the floor where there is exactly one of it. A per-CHUNK carrier may
   still be worth having later (a chunk terminating against something of its own,
   shaped rather than flat); it is a different feature and is not built.

8. **The chunk outline becomes a pure user crop.** Once extents are per-layer,
   coverage stops being a cropping concern: the outline means "where the user wants
   to look", nothing more. **Built** — `trimPolygonToCoverage`, `coverageRule` and
   `optional` are gone, replaced by `measureStackCoverage`, which reports and
   changes nothing. A layer with no data anywhere inside the outline is voided
   rather than sealed across it (§9.9.1).

9. **Sealing is inferred.** Where one chunk's footprint contains another's, the wider
   one caps the shared horizon. `cap` goes. **Built — see §10.8.**

### 10.2 Sequence

Numbered by dependency, not importance.

0. **Synthetic surfaces** (§14) — nothing below can be calibrated against a single
   field without over-fitting to it. **— done.**
1. **Bounded fill** — small, self-contained, improves current behaviour alone.
   **— done (§13.1).**
2. **Multi-ring walls** — the enabling geometry; testable with a hand-made mask.
   **— done (§10.5).**
3. **Taper vs terminate** — needs 1 and 2. **— done** (geometry §10.7; the marking
   that makes it honest §10.6).
4. **Marking the inference** — needs 2 and 3. **— done (§10.6).**
5. **Outline as user crop** — needs 1–4; deletes `optional`. **— done (§9.7, §9.9).**
6. **Carrier surfaces** — largely independent; retires the `basement` slot.
   **— done, at COLUMN level (§10.9); the slot is deleted.**
7. **Inferred sealing** — deletes `cap`; last, because partial overlap interacts with
   per-layer extents. **— done (§10.8).**

⚠️ Step 2 is where triangle count compounds with termination refinement, which
already roughly doubled it (§10.3.2). Measure before and after; do not assume.
**Measured** — it does not compound: wall cost follows the PERIMETER of a
termination, not its area (§10.5).

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
4. **The water shader** — `OceanChunk` and the builder's `oceanTop` slot are gone,
   so water is now an ordinary layer drawn with the standard chunk material. The
   open question is whether `Ocean` decomposes into a *material* plus a per-frame
   updater, in which case a water layer is just
   `{ depth: 0, material: oceanMaterial }` and the standalone `Ocean` component
   retires too; if `Ocean` must own its meshes it is a restructure. ⚠️ Two known
   snags: `volume-vertex.glsl` reads `uv.y` as a normalised 0..1 down the wall while
   chunk walls write METRIC uvs (so the wall needs its own normalised attribute),
   and a flat synthetic layer contributes no refinement candidates, so the water lid
   inherits the sea bed's TIN and is too coarse for vertex displacement.
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
   differ; connect them by declaring the shared boundary in both, as usual. The trap
   is that "disjoint depth
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

6. **Sidedness, opacity and seeing inside** — *recorded 2026-08-10, deferred.* Chunk
   materials are `DoubleSide` unconditionally, which is right for a sealed block seen
   at `opacity < 1` (the ray crosses an entry *and* an exit interface) and wasted work
   when opaque (back faces cannot be seen, yet they are rasterised in every OIT pass).
   `Surface` does the opposite — double-sided when opaque, front-only when transparent
   — which is a self-transparency mitigation for the **non-OIT** path. Under OIT it
   does not apply: `SurfaceMaterial` forces `DoubleSide` on its pass variants, so back
   faces do render there. The result is a path disagreement rather than a missing
   feature: the same scene is double-sided under `OITRenderPass` and front-only under a
   plain `RenderPass`, where a transparent surface is invisible from below.

   Three things to settle together, since they interact:

   - **Derive sidedness from sealedness**, not from opacity: opaque *and* sealed →
     front faces only; transparent, or a block left open (an unfilled base, `cap:
     false`) → both. A chunk is sealed exactly when every interval between drawn layers
     is filled and it is terminated below, so this is computable rather than assumed.
   - **Peeling before transparency.** Alpha compounds — a 20-layer stack at 0.5 is
     effectively opaque — so a uniform opacity slider cannot answer "what is
     underneath". The layer index is a strict depth order, so simply not drawing layers
     `0..k` is exact and free. Per-layer `side` (drawing only the *back* of a cap) gives
     a cutaway into a sealed block by the same reasoning.
   - **Transparency then keeps the case peeling cannot serve**: seeing a wellbore, or
     another object, through overburden that must stay present.

   ⭐ **Opacity is a CHUNK property and should be a LAYER one** — observed
   2026-08-11 on `SeabedConnection`, and the sharpest evidence for it. Looking down
   through the translucent water, you see the inside of the detail chunk's walls
   with no lid. The lid IS drawn — the ocean chunk caps the seabed over the whole
   field — but it is drawn at the OCEAN chunk's opacity, so the detail block, which
   is opaque, is covered by a see-through cap.

   ⇒ **Fixed by §10.8.** A shared horizon is now drawn with the material and
   opacity of the chunk it is the TOP of, so the caller no longer has to correct
   for a decision another chunk made. `ChunkLayer.opacity` stays, for what it was
   really for: opacity is a property of the UNIT, and water at 0.45 over an opaque
   sea bed is one chunk, not two.

   ⇒ **Built: `ChunkLayer.opacity`**, overriding the chunk's `surfaceOpacity` /
   `wallOpacity` for that layer's cap and the volume below it. An OVERRIDE rather
   than a multiplier, because a multiplier cannot express "opaque inside a
   translucent chunk", which is the whole case. ⚠️ So an explicit value also takes
   that layer out of a global transparency slider's reach — leave it unset on the
   layers such a control should sweep along.

   ⇒ It also settles "draw both when not opaque", which looks tempting here and is
   not: the second copy would carry its own chunk's opacity too, so a transparent cap
   would composite over an opaque one at the same depth. Worse than either alone, and
   the same alpha-compounding argument as peeling.

   ⚠️ `side` is not synchronised onto the OIT variants, which for stock materials are
   cloned on first use — so making sidedness reactive requires a fresh material
   identity, exactly as re-classification already does.

### 10.4 Resolved

- **Inherit vs own vs shared outline** — settled: `outline` takes `'inherit'`, a
  polygon, or a `CutoutSource`, and `ChunkStack` carries the shared default and the
  envelope.
- **Component pattern** — settled: context + declarative children.
- **Basement as a slot** — superseded. It becomes the degenerate carrier (§10.1.7).

### 10.5 Interval walls (§10.2 step 2) — built

A filled interval used to draw its wall around the **whole chunk rim**, whether or
not the unit still existed there, and nothing at all where a unit ended inside the
chunk. Both are now the same question, asked once:

> an interval's wall is the boundary of the area that interval occupies.

The parts of that boundary lying on the outline are the user's crop; the rest is the
unit terminating.

⚠️ **The two were tagged (`CUT_CROP` / `CUT_TERMINATION`) and the tag has been
removed.** It existed to give a data edge its own appearance (§10.1.5), and that is
no longer wanted: a cut face is legible without help, and it is not meant to be
visible in the first place — under sealing there is no visible termination at all,
since a pinch-out face is at most `collapseThreshold` tall (measured; see below).
The tag survived only long enough to be folded into the `inferred` attribute, which
made a plain data edge look exactly like invented geometry while the diagnostics
reported nothing inferred. §10.6 now means invention and nothing else. Re-deriving
the tag is ~10 lines against the rim ring if it is ever wanted.

The rings are made of shared vertices, so a wall stays one strip with continuous
normals — which is also what lets the marking be one interpolated attribute rather
than two geometry groups drawn with two materials.

**Traced on the tessellation, not on the mask.** A wall's top and bottom edges are
the *same points* as the surfaces above and below it: the block is sealed by
construction rather than by two samplings agreeing. Tracing the coverage mask in
grid space instead would put the wall on a cell-quantised line while the surface
follows triangle edges, leaving a crack at every segment.

**An interval is not the intersection of two kept layers.** It exists where it has
thickness and where each of its bounding surfaces is present. A layer dropped for
being coincident with the one above it — the interval *above* it is empty — still
bounds a perfectly real volume below, so intersecting the layers' kept sets would
delete those volumes.

`buildEdgeOpposites` / `traceBoundaryRings` (`mesh-boundary.ts`) are plain index
topology and know nothing about surfaces; the half-edge pairing is built **once** per
tessellation, so each interval only reads two flags per edge instead of re-hashing.
Ring orientation is taken from the rim the chunk's walls have always used rather than
derived, since a sign error there silently inverts every wall normal.

**Cost — it does not compound.** Wall triangles follow the *perimeter* of a
termination, not its area. Measured on the demo field (`WellborePerChunk`,
`surfaceFrom: 16`), against the same build with rim-only walls:

| chunk | triangles before | after | of which wall |
| ----: | ---------------: | ----: | ------------: |
|     0 |           37,481 | 40,955 |         5,562 |
|     1 |           10,513 | 10,831 |         1,272 |
|     2 |            7,257 |  7,739 |           878 |

Chunk 1 drops 5,743 triangles to pinch-outs yet spends only 1,272 on walls. Walls are
11–14% of each chunk. On the generated scenarios the increment is smaller still (+90
triangles to wall every hole in `holes`).

⭐ Coverage-driven terminations are now the ordinary case: the outline is never cut
back to the data, so a wall standing at a survey edge is what a partly-mapped layer
looks like.

### 10.6 Marking the inference (§10.2 step 4) — built

Sealing invents geometry (§10.7), and a block that does not admit which part is
invented is exactly the plausible-looking picture this design keeps trying to
avoid. `ChunkInferenceStyle` marks it: `none`, `hatched` (the drafting convention),
`checker` and `zigzag`.

⭐ **Every style is a PATTERN, never a colour.** A recoloured region says that
*something* is different without saying what — and worse, it cannot be told apart
from a unit that simply has a different colour, which is the one reading that must
not be possible. An earlier version offered `matte` and `muted`, and both failed on
exactly that; they are gone.

⭐ **It is an OVERLAY, not a property of the unit's material.** A second mesh sharing
the same geometry, drawn with one chunk-wide material that darkens multiplicatively.
Three reasons, in order:

- it works over a **caller-supplied** `Material` — which the chunk cannot patch, may
  be textured, and is exactly the case `Chunk` is meant to support;
- the unit keeps its own colour and shading **by construction**, rather than by the
  chunk reconstructing a colour it can only guess at (the old cut material could not
  read a colour out of a `Material` at all, and fell back to the palette);
- it needs no cooperation from what it is drawn over.

The cost is one extra draw per mesh that has anything to mark — and only those
meshes carry the attribute, so the common case pays nothing.

**What drives it is one interpolated per-vertex attribute, `inferred`**, on the caps
and on the walls alike. One rule decides it:

> `inferred` marks geometry drawn **beyond a layer's effective extent**, however its
> height was arrived at.

There are two ways that happens, and `maxFill` is the line between them:

- **sealed** — the taper's own weight, 0 where the data stops and rising to 1 at the
  far side of the gap (`sealStackChannels`, sampled bilinearly by
  `sampleStackWeights`). ⭐ That weight doubles as a CONFIDENCE — every seal rule
  leans on the nearest real data, so all of them are least trustworthy furthest from
  it — which is why the marking FADES instead of switching on. The proportional rule
  reports it too even though it does not blend with it.
- **not sealed, and not dropped either** — with `coverageAbsence: false` the layer is
  drawn out there on the reference's nearest-valid hole fill, which is a flat
  extrapolation and every bit as invented (with less to say for itself: it has no
  shape derived from its neighbours and no gradient). Marked at 1, derived from the
  coverage mask. ⚠️ Only when a seal did NOT run — taking the larger of the two would
  flatten the taper's gradient to a hard 1 and destroy the fade.

⚠️⚠️ **"A seal did not run" is decided PER LAYER, and it has to be.** The seal skips
a layer with no neighbour above *and* none below — the end of a column, or a column
with a single surface — and hands back all-zero weights for it. Reading "weights were
given" as "this was sealed" then leaves that layer drawn on plain fill and *unmarked*,
which made `seal: true` mark strictly LESS than `seal: false`: the one case where
invention was certain was the one case that said nothing. The per-layer test is exact
rather than a heuristic, because a layer the seal did process carries a positive
weight at **every** unmapped node.

⭐ The same blind spot ran through the diagnostics: `SurfaceChunkLayerDiagnostics
.inferred` reported `1 − coverage` whenever *any* layer had been tapered, so a layer
the seal never reached still claimed its unmapped part was inferred. It is now keyed
on that layer's own tapered count.

With `coverageAbsence: true` and no seal there is nothing to mark: the geometry is
dropped rather than invented.

⚠️ **The one deliberate exception is fill within `maxFill`.** It counts as covered,
so it is not marked — which is the whole point of the threshold (§13.1): inside it we
interpolated across a gap we are surrounded by and stand behind the result; outside
it we extrapolated and say so. It is still reported separately as `filled`.

⚠️ **A cut termination is NOT marked.** An earlier version folded `CUT_TERMINATION`
(§10.5) in as well, on the argument that a data edge and an invention are both "not
geology". In practice that made a plain, honestly-cropped block read as invented
while `SurfaceChunkLayerDiagnostics.inferred` reported 0 — the picture and the
numbers disagreeing, which is precisely the failure this feature exists to prevent.
The tag is gone (§10.5).

⭐ **The attribute's PRESENCE is the signal.** It is only added when something is
actually marked, so the appearance layer can skip the overlay entirely rather than
draw an empty one — and a chunk with nothing invented is bit-for-bit as before.

⭐ **One mesh, one material, no groups.** The previous design split a wall's indices
into two geometry groups drawn with a material array. A per-vertex attribute does
the same job on one draw call, interpolates (which groups cannot), and removes the
R3F hazard that came with it: switching between an array and a single material on
one fiber removes the prop, and R3F then resets it to a fresh `Mesh`'s default white
`MeshBasicMaterial`.

**The pattern is anchored in WORLD space**, projected onto whichever plane the face
most nearly lies in. A wall is vertical, so an XZ projection alone would smear down
it; picking the plane per fragment means a cap and the wall below it carry the same
pattern at the same scale. (Wall UVs remain metric — §10.5 — but the marking no
longer uses them, and caps need their own grid UVs for `SurfaceMaterial`.)

⭐ **A cut face needs no appearance at all.** §10.1.5 asks for three, and the answer
turned out to be one. A pinch-out face cannot be seen: a triangle is dropped only
when its thickness is below the threshold at all three corners, so both ends of a
thickness-driven boundary edge have (almost) no thickness, and the wall there is at
most `collapseThreshold` tall. Truncation is a subset of the same test. So the only
*visible* termination is a data edge — and with sealing on there is no such face,
because the block is closed there instead. Left is the crop, which is the user's own
cut and needs no telling. ⚠️ This retired a measured result (a pinch-out face ≤ 0.5 m,
a data edge the full interval height) along with the tests for it; the measurement
stands, it just no longer decides anything.

⚠️ **Coverage edges are not refined — except for the seal.** `refineTerminations`
inserts candidates along each pair's *thickness* contour (§9.6), which does nothing
for a data edge; `refineCoverage` (default on) puts vertices on the edge of each
layer's own data, which is where a taper starts. Without it the gradient would begin
wherever the height refinement happened to leave a vertex — in a flat area, hundreds
of metres inside the data.

⭐ **A grid-driven material needs telling which artefact is authoritative.** For a
`Surface`, the GRID is: the mesh was built from it, so a nodata sample means there
is nothing there and `SurfaceMaterial` discards the fragment. For a chunk cap it is
the other way round — the heights have been resampled onto a common grid,
hole-filled, sealed, resolved and collapsed, so the MESH is authoritative and the
grid is only one of its inputs. Left alone, the discard cuts a hole clean through
the sealed block, in exactly the region the seal closed and the overlay marked.

`SurfaceMaterial.geometryFallback` (default **off**, so `Surface` is untouched)
switches the rule: no discard, and where the grid has no data the depth and the
normal come from the mesh's own vertex instead of from the elevation and normal
textures. Where the grid DOES have data nothing changes — full grid-resolution
shading is the whole reason those textures exist — and the two are mixed rather
than branched, so a triangle straddling the data edge does not flip.

It reads a per-vertex `nodata` attribute, written by `buildStackGeometries`
alongside `inferred`. ⚠️ **Inverted deliberately**: an attribute a geometry does not
carry reads as 0 in WebGL, so 0 has to mean "the grid is complete". A `covered`
attribute would have made every fully-mapped layer fall back everywhere.

⚠️ Still open: a genuinely third-party material has no way to opt into this — there
is no general protocol, only this flag on the one material that needed it. Worth
building when there is a second consumer, not before.

### 10.7 Sealing (§10.2 step 3) — built

A surface's grid stops where the survey stopped. Left alone, every interval bounded
by it disappears there while its mapped neighbours are still drawn, and the chunk
becomes a cap floating over a floor. Both alternatives to that are assertions, so
the question is only which assertion to make.

**Two ways to close it**, differing in what KIND of claim they make:

- **`proportional`** (default) keeps the surface at the RELATIVE depth it had where
  it was last mapped: the ratio `(A − B)/(A − C)` is carried into the gap from the
  nearest mapped node and the surface rebuilt from it, so it follows the *shape* of
  its neighbours and both units continue at scaled thickness. It says "this horizon
  is here somewhere". ⚠️ Being strictly between its neighbours, it cannot make the
  stack non-monotone.
- **`void`** splits the surface in two — one copy closing the interval above, one
  the interval below — and draws nothing between: a lens-shaped cavity, zero at the
  data edge and opening where knowledge runs out. It says "the units are not defined
  here", and is **self-documenting**: the hole in the block is the statement, so it
  needs no legend and cannot be mistaken for geology. The trade is that it removes
  material we know exists, since the neighbours bound it.

  ⭐ Implemented as two ordinary layers with an *unfilled interval* between them —
  §2.3's gap between zones — so caps, walls, the collapse and the wall tracing all
  work unchanged.

⚠️ An earlier `nearest` rule (collapse onto the closer neighbour) was **removed**:
its direction depended only on which neighbour happened to be nearer, so the same
gap bulged upward or cratered downward for no geological reason. It survives only
where a layer has ONE neighbour — the top or bottom of a stack — since there is then
no ratio to preserve.

**How far a taper reaches is derived, not configured.** Each one is drawn out over
the GAP it is closing, not over the distance it has to fall:

```
run  = reach                 (the region's own inward extent...)
w(d) = shape(d / run)        (...measured INSIDE the chunk's footprint)
```

⭐ **That the run is the gap is the whole point.** Making it proportional to
`travel` cancels the travel out of the mean gradient — every taper then descends
identically however far it has to go, so a thin unit and a thick one leave their
shared edge in parallel, which is not what either of them does. With a shared
reach the gradient is `travel / run`: two flanks closing the same gap **land
together at its far side and differ in steepness**, in proportion to how far each
has to move.

⚠️⚠️ **The reach must be measured over the nodes the chunk DRAWS.** The reference
grid is the grid-space bounding box of a rotated outline, and everything beyond a
survey edge is one region running out to that box, so measuring over the grid put
the run in the hands of corners nobody sees: resizing an outline silently changed
the shape of every seal inside it, and two holes in one layer got two different
curves. `rasterizeStackOutline` is the footprint raster (shared with `measureStackCoverage`)
and `StackSealOptions.inside` carries it. A region with no node inside falls
back to its own extent, having nothing visible to measure.

**The curve is fixed** — $w(t)=\sqrt{1-(1-t)^2}$, a quarter arc: vertical where
the data stops, horizontal where it lands. The seal opens at once at the edge of
knowledge, then flattens into the surface it closes against, which is what a gap
in knowledge looks like as opposed to a geological wedge.

⚠️ Where a horizon DIPS into its data edge, a vertical departure leaves a V-shaped
trough there: the surface descends with the data, then reverses. The taper blends
from the nearest-neighbour fill, which is flat, rather than from the horizon's own
trend.

**How far it TRAVELS is bounded by that same reach**, which is the other half of
the same idea:

```
travel = sign(room) * min(|room| - minThickness,  TAPER_MAX_SLOPE * reach)
```

Without it every gap falls the whole way to its neighbour however narrow it is, so
a 200 m ditch between surfaces 800 m apart dives the full 800 m and back — a
gradient of 8:1 that no horizon does. Wide gaps are unaffected, because there the
room runs out before the slope does, so the behaviour degrades continuously
instead of switching at a threshold.

⭐ **Reach, not area.** A long narrow ditch covers a lot of ground but is shallow
in reach, and it is exactly the case that must not be driven hard — which is why
the measure has to be shape-aware. The reach is already computed for the run, so
this costs nothing.

⚠️ `reach` and `chamferDistance` count in CELLS while the bound is a gradient, so
`StackSealOptions.cellSize` carries the reference grid's cell size. Without it the
travel is simply unbounded (which is what the unit tests of the run itself use).

⚠️ It interacts with `minThickness`: once the travel is capped the far unit keeps
more than the minimum by construction, so the two stop being independent. Capping
only ever moves a surface LESS, so it cannot open a hole — it leaves both
neighbouring units thicker.

**`minThickness` is the only setting** (metres, default 1): how much of each
neighbouring unit the taper has to leave standing. A unit is thinned, never closed
to nothing — otherwise the collapse drops it and re-opens the hole the seal just
closed. It is ABSOLUTE rather than a share of the room available, so it means the
same thing in a 20 m interval and an 800 m one, and it is applied identically at
both ends of a void. Where there is less room than that, nothing moves.

⚠️ Keep it above `collapseThreshold` (default 0.5 m), or the sliver it leaves is
dropped for having no thickness.

⚠️ Removed as options, deliberately: a taper CURVE (`linear`/`smooth`/`open`/`arc`)
and a `spread`/`slope`/`taperDistance` knob. Each was a way to compensate for the
run being measured over the wrong thing; none of them is a decision a caller has
information to make.

**Order matters.** Sealing runs on the reference grid *before* the monotone
resolve — two adjacent layers tapering toward each other can pass each other at
full weight, and the resolve is what puts that right, so sealing after it would
leave the crossing in.

⭐ **It runs on the COLUMN, not per chunk** (`getStackContext`). A horizon two
chunks share must have ONE height: sealed per chunk it took the neighbours of
whichever chunk was asking — the deepest layer of one chunk tapered against the
layer above it while another chunk tapered the same surface onto its own synthetic
floor — and the two then met each other's walls at different depths, leaving the
lower chunk's block open (§10.3.6). Sealing the column costs the case that first
moved it to the chunk: the column's deepest surface has no neighbour below even
where a chunk puts a floor under it, so it falls back to the one-neighbour rule.
That is the right trade — two chunks may hang DIFFERENT floors under one horizon,
so a chunk-private boundary must not set a shared surface's height.

⚠️ Consequences, both inherent rather than incidental:
- The reach is measured inside the **envelope**, not inside one chunk's footprint.
  A single height and a per-chunk taper shape cannot both hold.
- **`void` runs on the column too** (since the carrier gave the deepest surface a
  neighbour below). It turns one layer into TWO, which a `surface id -> index` map
  cannot express, so the context publishes an **expansion** — per column layer, the
  one or two indices it occupies in the expanded arrays — and every chunk picks its
  copies out of it. Two chunks sharing a horizon therefore open the SAME void, where
  before each split it against its own neighbours and its own footprint and the two
  met each other's walls somewhere else.
  ⭐ The split needs no fill state to do this, which is what let it move: `ceiling`
  already says which copy holds a volume (a ceiling never does), so the caller reads
  its own layer's fill for every other copy. `StackVoidResult.fill` and the `fills`
  argument are gone.
  ⚠️ A chunk does NOT expand a layer it has voided (§9.9.1): both intervals it
  bounds are open already, so splitting would make the same statement twice.
  ⚠️ Two index spaces now exist — COLUMN and EXPANDED — and they coincide until
  something splits, which is why both slips found here survived `proportional` and
  only showed up under `void`. `StackContext.index` and `.carrier` are COLUMN;
  `.reference.channels`, `.masks`, `.absent`, `.inferred` and `.ceiling` are
  EXPANDED; `.expansion` is the bridge.
  ⭐ **Which copies a chunk takes** (`chunkCopies`): the ceiling closes the interval
  ABOVE the surface and the floor the one below, so a chunk holding only the interval
  below takes the FLOOR alone — handed the ceiling it would draw the underside of a
  unit it does not contain, tapering up to a horizon nothing there draws. A chunk
  holding neither (a lone boundary) also takes the floor, which is the horizon proper.
  ⚠️ A ceiling, however, always travels WITH its floor, even when the chunk holds no
  interval below it: the collapse drops a ceiling by comparing it with its own floor
  copy, so without one it is never dropped and is drawn over the whole footprint,
  fighting the horizon its seam owner draws. The floor itself draws nothing unless the
  seam gives this chunk the horizon too, and an uncapped layer builds no geometry.
  ⚠️ **Reading the diagnostics under `void`:** a layer whose `triangles` equals its
  `droppedCollapsed` is NOT a defect — it is a layer the column split because it is
  unmapped SOMEWHERE IN THE ENVELOPE, seen from a chunk whose own footprint it covers
  entirely. The two copies are identical there, so the collapse drops one of them
  whole. `SurfaceChunkLayerDiagnostics.coverage` is measured over the CHUNK's outline
  and the split is decided over the COLUMN's, so the two can disagree without either
  being wrong. The cost is one redundant copy tessellated and discarded; pruning it
  per chunk is the kind of local copy decision that produced the double-draw above.
- Synthetic layers need no seal of their own: their masks are all ones, so they
  have no unmapped region. That is why nothing was lost by taking it off the chunk.
- ⚠️⚠️ **A sealed column does NOT give the chunk `preResolved`** — and not for the
  reason it looks like. The column's `absent` masks are perfectly valid; they are
  just decided per **grid node**, while a triangle is dropped only when all THREE of
  its own corners are marked. That difference is not cosmetic: an island of marked
  VERTICES can never remove anything, because no triangle has all three of its
  corners inside it, whereas an island of marked NODES spans cells and can enclose a
  whole triangle. A sealed stack leaves surfaces running a metre apart over wide
  bands, so those node islands are exactly what it produces — around twenty of them,
  1–79 nodes each, on the generated column — and each one punches a walled notch into
  the cap. Sealed stacks therefore keep the per-vertex resolve, which carries the
  truncation through the exact per-triangle thickness collapse instead.
  ⭐ The general rule: **a decision taken at grid nodes and a decision taken at shared
  vertices are not interchangeable.** The vertex form is self-limiting; the node form
  is not.
  `preResolved` still applies where nothing is sealed, including under `void` (which
  the column resolves in its expanded form). A chunk-private synthetic layer
  disqualifies it too, since the column never saw one.
- The seal settings join the column CACHE KEY, so toggling `seal` rebuilds it.

**What it overrides:** `coverageAbsence`, which would otherwise drop the wedge for
having no data. (It also used to override the coverage trim, which would have cut
the outline back to exactly the area the wedge covers — that trim is gone with
§10.1.8, so a chunk keeps the footprint the user asked for either way.)

**Measured** through the story (`SyntheticCoverage`, `holesStacked`) — the holed
surface with a mapped surface above and a floor below:

| | triangles | dropped |
| --- | ---: | ---: |
| proportional | 10,594 | none |
| void | 16,879 | 2,537 thin |

`proportional` drops nothing — both units continue across the gap. `void` costs the
extra layer and drops the void interval wherever the two copies coincide, which is
everywhere the surface has data.

⚠️ **Measure through the path production uses.** Two earlier comparisons in this
section were wrong because of this: one ran through a hand-built three-layer stack
that bypassed the shared column, and one ran through a scenario whose holed surface
was the column's last layer — in both, `proportional` silently fell back to the
one-neighbour rule and produced numbers identical to it.

⚠️ **A test scene can hide all of this.** The story's floor was originally an
`offset` layer, i.e. defined *relative to the surface above it* — so sealing that
surface dragged the floor with it and the block's base visibly rose. Nothing was
wrong with the seal; the third surface simply was not an independent neighbour. It
is now an absolute `depth`. Any scene used to judge sealing needs three genuinely
independent surfaces.

⚠️ **Sealing invents geometry**, and a sealed block that does not admit which part is
invented is exactly the plausible-looking picture this design keeps trying to avoid.
The inferred region is reported per layer (`SurfaceChunkLayerDiagnostics.inferred`)
**and drawn** as the inference it is — see §10.6, which carries the taper's own
weight through to the geometry so the marking fades with the confidence.

### 10.8 Inferred sealing (§10.2 step 7) — built

`ChunkLayer.cap` is **gone**. A chunk declares the horizon it shares with its
neighbour like any other layer, and `ChunkStack` works out which of them draws it.

**Two decisions were tangled in that one flag**, and separating them is most of
what this is: WHO DRAWS the shared horizon (geometry — drawing it twice puts two
independent tessellations in the same place) and WHAT IT LOOKS LIKE (appearance —
it is the base of one chunk and the top of the other, and those need not agree).
The flag answered the first and let the second ride along, which is the defect
§10.3.6 records. ⭐ They turn out to have the SAME answer, which is what §10.8.3
is about.

#### 10.8.1 Who draws it

⭐ **A horizon belongs to the chunk it is the TOP layer of.** A cap is the lid of
the block underneath it, so that block draws it — with its own material and
opacity. The alternative (widest draws it) was tried first and is what forced the
appearance to travel across the seam; see §10.8.3.

`resolveSeam` orders the claimants **lid owner first, then by area descending, then
by key**, and each one draws its footprint minus everything already taken.
`polygonRelation` (SDK: a segment-crossing test, then vertex containment) gives the
four cases:

- **contained** in something already drawn — nothing is left, so it draws none of
  the horizon. The ordinary case, and byte-for-byte what `cap: false` used to do by
  hand.
- **disjoint** — two chunks side by side. Both draw; there is nothing to share.
  ⭐ The manual flag could not express this at all.
- **overlap** — the part an earlier claimant draws is cut away.
- **contains** something already drawn — the same cut, except it falls wholly
  inside, so this cap keeps a **hole** for the owner's own cap to fill. ⭐ Only
  reachable because the lid owner can be the NARROWER chunk; under the old area
  order the earlier claimant was always the larger.

A horizon that is nobody's top layer has no lid owner, which leaves the area order:
the widest draws it and the others cut around it. Two identical outlines read as
containment, so ties stay deterministic and the answer is independent of mount
order.

⚠️ A shared horizon is claimed twice by construction, so the outline registry is
now `Map<surfaceId, entry[]>`. It used to hold ONE entry per surface, with the last
claimant silently overwriting the others; it could not have represented a seam.

#### 10.8.2 How a cut is made

The chunk's cap is clipped by inserting the owner's **densified rim** into its own
tessellation as constraint edges, then dropping the triangles the owner contains
(`StackTessellation.cuts` → `StackCollapseOptions.capExcluded`). Only the CAP goes:
the rim, the walls and the interval below are this chunk's either way. The cut ring
may cross this chunk's rim (a partial overlap) or fall wholly inside it (a hole);
the machinery is the same.

⭐ **The seam is watertight, not merely close.** Both chunks sample the same
reference channels, so bit-identical boundary vertices in XZ give bit-identical
heights. Which is why the rim has to be densified with the OWNER's `rimSpacing`
(carried in `SurfaceChunkSpec.cuts`): densification inserts points ALONG a segment,
each sampling the grid on its own, so the same polygon at two spacings describes
two different height profiles. ⚠️ It also means exactness needs a **shared column** —
without `ChunkStack.surfaces` the two chunks resample onto different reference
grids and the seam is only as good as any other inter-chunk boundary.

⚠️ **This required the crossing-rim fix from the rejected hoisting work** (§11.2),
which is now landed on its own: `nodeGridRings` splits every ring segment at its
crossings with another ring, computing each crossing once so both rings insert
identical coordinates and resolve to one vertex. Without it two crossing constraint
edges cannot both follow mesh edges, and `Delatin` silently dropped one of them.
`Delatin.constraintFailures` now counts what it could not enforce (⭐ it also stops
`_constrainEdgeBrute` locking an edge it never created, which claimed a boundary
that was not there — a latent bug in `main`, unreachable while only one outline was
constrained). Reported as `SurfaceChunkDiagnostics.constraintFailures`.

⭐ **This is not hoisting.** Only OUTLINES are shared between chunks, never vertex
sets, so every chunk still builds and paints on its own — the incremental-paint
objection that killed §11.2 does not apply. The cost is paid only where footprints
genuinely cross.

#### 10.8.3 What it looks like

Nothing is borrowed across a seam: every chunk draws the parts it owns with its
OWN material and opacity. That falls straight out of §10.8.1 — the lid owner is
both the chunk the horizon looks like and the chunk that draws it.

⭐ **This is why the ownership rule is worth the interior cut.** The first version
gave the horizon to the WIDEST chunk, so drawing and appearance disagreed about the
owner, and the appearance had to be published across the component boundary in a
registry of its own (`ChunkSeamAppearance`, held apart from the outlines because it
changes on every colour swap). That channel produced its own defect — what was
published was the DECLARED appearance, and a layer that names no opacity means "my
chunk's", so the *drawer's* fallback came back in and put a see-through lid on an
opaque block (§10.3.6, twice). Making drawing follow the lid owner made the whole
channel unnecessary; it is deleted.

It also makes the mixed case expressible, which the all-or-nothing channel could
not do: a translucent water tier keeps a translucent seabed of its own, while the
lid over the opaque detail block below it is opaque. `Spikes/Chunks/SeabedConnection`
is that scene.

⚠️ Two chunks that both hold a surface as their top layer are ordered by area, so
the wider one keeps any overlap. A horizon that is nobody's top layer falls back to
the area order and is drawn with the drawer's own appearance.

#### 10.8.4 Consequences and limits

- A chunk defers its build until every claimant of any of its surfaces has settled
  an outline — the same one-render wait `coverAbove` already used. A chunk mounted
  AFTER a sibling has built invalidates that sibling's decision and rebuilds it;
  static children all register in one commit, so this only bites dynamic ones.
- `coverAbove` now asks who *draws* the surface above rather than who claims it, and
  takes the widest drawing footprint. ⚠️ Several chunks can draw parts of it and only
  one polygon fits in the spec — but `topKept` measures ~0 on real data, so this is
  insurance, not a visible fix.
- Diagnostics: `SurfaceChunkLayerDiagnostics.capped` and `.droppedExcluded`. ⭐
  Inference makes "why is my surface missing" a non-local question; these are what
  answer it.
- ⚠⚠ **The two caps of one horizon now meet in plain view**, along the lid owner's
  rim, where before the wider chunk drew it as one mesh. They are watertight only
  as far as §10.8.2 holds — which is why sealing moved to the column (§10.7): a
  shared horizon now has ONE height, so the two chunks' caps and walls meet.
  ⚠️ Still open under `sealMode: 'void'`, which is split per chunk.
  **Closed** — the split runs on the column too (§10.7).
- Still open: **carriers** — built at column level, see §10.9.

### 10.9 The column carrier (§10.2 step 6) — built

A `ChunkStack` may declare one flat floor for the whole column:

```tsx
<ChunkStack outline={field} surfaces={column} carrier={{ below: 800 }}>
  ...
  <Chunk layers={[{ surface: basement, fill: '#4a4a4a' }, { carrier: true }]} />
</ChunkStack>
```

`{ depth }` places it absolutely; `{ below }` clears the column's deepest **mapped**
sample by a margin (hole fill is excluded, or a survey edge extrapolated downward
would drag the floor with it). It is complete over the whole grid and constant in
Y, which is what makes it a guarantee rather than another surface: whatever the
data does, the block has a floor.

#### 10.9.1 It is a terminator, not a unit

There is no interval *below* a carrier, so it has a cap and no `fill`, and it is
the only side of the block seen from underneath — which is why its cap defaults to
the fill of the unit ABOVE it, exactly as a void's ceiling does. Giving the layer a
`material` of its own overrides that, for a floor that should read as its own
thing.

⭐ It is emphatically **not** a layer with an infinite unit beneath it. A sentinel
thickness would flow into the duplicate fractions, the overlap statistics and the
collapse threshold and lie in all three; what it actually needs is authority, in
two places.

#### 10.9.2 Nothing pierces it

`clampStackToCarrier` raises every other channel to the plane, on the column's own
grid, after the seal and before the resolve.

⭐ Because the carrier is CONSTANT, that is an elementwise `max`, which is
order-preserving — so it cannot introduce a crossing and needs no cascade, even
though it reverses the stack's usual authority (the resolve clamps the DEEPER
surface down; here the deeper one is pulled up). This is the first place a deeper
boundary wins, and it is safe *only* because the carrier is flat and complete; it
does not reopen the per-surface erosional/onlap flag (§10.3.3).

It is re-imposed after the resolve as well, since a positive `minGap` would
otherwise push the floor below the very horizons it just truncated.

#### 10.9.3 What truncation leaves behind

Everything the clamp moves lands exactly ON the plane, so:

- the units *below* the carrier have no thickness and the ordinary collapse drops
  them — no new masks, no new marking;
- the horizons flattened onto it would be drawn coincident with the floor, so
  `StackCollapseOptions.carrier` drops **those** caps and never the carrier's. That
  is the same inversion the void ceiling needs, in the other direction: without it
  the deeper of the pair goes, which is a hole in the floor;
- ⭐ the unit *above* a truncated horizon **survives**. Its interval is bounded by
  heights rather than by masks, so it fills the space down to the carrier. A block
  cut off flat, not a block with the bottom missing.

Measured (`SeabedConnection`, `carrierMode: depth`, 2000 m, against a basement
surface spanning 1869–2200 m): `Basement Base` draws 58,179 triangles and drops
9,678 to the floor, while the carrier keeps all 67,857 — the two reconcile exactly.

#### 10.9.4 What it unblocks

- The column seal no longer falls back to its one-neighbour rule at the bottom: the
  deepest real surface now has a neighbour below it, so `proportional` keeps it in
  proportion instead of pinning it to the layer above (§10.7).
- ⚠️⚠️ **A floor declared on a CHUNK does not seal anything**, and this is the case
  to watch for: sealing runs on the column, so a chunk-private synthetic layer is
  invisible to it. A column whose deepest surface is its ONLY surface then has no
  neighbour in either direction and is not sealed at all — not a degraded taper, a
  no-op. `SyntheticCoverage` had exactly that shape (a `{ depth }` floor as a chunk
  layer) and its one-surface scenarios were silently drawn on hole fill; it now
  declares the floor as the stack's carrier. ⭐ If a block looks unsealed, check
  whether its floor is on the stack or on the chunk before looking anywhere else.
- `sealMode: 'void'` can move from the chunk to the column, which is what makes two
  chunks sharing a horizon split it the same way. **Done** — see §10.7.

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

⭐ **The column is built from the surfaces the chunks CLAIM, not from everything
`surfaces` lists.** `ChunkStack` already knows the claims (they are registered on
mount, before any outline resolves), so it publishes `surfaces` filtered to those —
`ChunkStackContextValue.column`. `surfaces` supplies membership and ORDER; the
filter decides what is paid for. A caller naturally hands over the whole column and
draws a slice of it, and loading, resampling and cascading ~25 surfaces nobody
draws is pure cost.

- ⚠️ Undrawn surfaces are also dropped as CEILINGS in the cascade, so a drawn layer
  is no longer pushed down by a surface nobody can see. That is a deliberate change
  of meaning, not just an optimisation: invisible data silently moving visible
  geometry is the kind of non-local surprise this design removes elsewhere.
- ⚠️ Claims arrive in an EFFECT, so the column is empty on the first render.
  `Chunk` waits until the column contains its own claims (`columnPending`) — one
  render, versus a whole build against a column missing its own layers. A chunk
  mounted after its siblings re-keys the column and rebuilds them, the same rule
  the seam registry has.
- ⚠️ `coverAbove` and the wellbore envelope deliberately still read the FULL
  `surfaces`: switching them would change the envelope's depth window and make
  `coverAbove` find a claimed surface above where it previously found none.

⚠️ **The cache is single-entry and keyed on the whole ordered list**, so any change
to the membership rebuilds all of it: a copy of every grid, a full resample, a full
resolve, a full refinement. Per-surface caching of the resampled CHANNELS is the
obvious next step, and the reason it is not trivial is that **the common grid is
derived from the membership** — `buildStackReference` picks the finest member's
grid, so adding a coarser surface leaves every channel valid while adding a finer
one invalidates all of them. It would need the grid identity keyed separately from
the layer set, plus a byte budget and eviction. Fetches themselves are already
cached per surface by the store's loader (repeats cost a memcpy, not a reparse).

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

**If that residual ever matters**, the obvious step is to hoist the tessellation
too: one triangulation with every chunk's outline as constraint edges, each chunk
taking the triangle subset inside its own outline (the same mechanism
`collapseStackTriangles` uses). That would make the guarantee exact across chunks.
Nothing built above needs to change for it; the tessellation simply moves up a
level.

⚠️ **This was built and rejected — see §11.2.** It is recorded here because the
reasoning above is sound and still tempting; what defeats it is not the geometry
but the rebuild latency.

### 11.1 What hoisting would cost — MEASURED 2026-08-11

An earlier note here put the cost at "~11× a single layer's vertex count". That
figure is **wrong**, and it was also the wrong comparison: it measured what one
chunk would carry, when the point of hoisting is that there is only ONE buffer for
the whole stack instead of one per chunk.

Measured with `tests/perf/stack-hoist-profile.test.ts` on a generated column
(§14.4) and on the demo field, 3 telescoping chunks (6 / 4.5 / 3 km squares)
against a 6 km envelope, `maxError` 5:

```
PROFILE_HOIST=1      npx vitest run tests/perf/stack-hoist-profile.test.ts
PROFILE_HOIST_REAL=1 npx vitest run tests/perf/stack-hoist-profile.test.ts
```

| column | layers | verts today | verts shared | factor | ms today | ms shared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generated, correlated | 5 | 2,607 | 4,649 | ×1.78 | 200 | 241 |
| generated, correlated | 17 | 2,627 | 6,781 | ×2.58 | 112 | 83 |
| generated, independent | 5 | 27,307 | 21,047 | ×0.77 | 482 | 284 |
| generated, independent | 17 | 26,905 | 20,720 | ×0.77 | 627 | 336 |
| **demo field** | **5** | 1,831 | 3,760 | **×2.05** | 44 | 51 |
| **demo field** | **9** | 4,962 | 12,707 | **×2.56** | 98 | 118 |
| **demo field** | **18** | 10,419 | 21,978 | **×2.11** | 175 | 188 |
| **demo field** | **27** | 13,349 | 22,760 | **×1.70** | 165 | 185 |

⇒ **Worst case measured anywhere is ×2.6 on vertices and +14% on time.** Not ×11.

⭐⭐ **The factor does not grow with column length** — on the demo field it peaks
around 9 layers and *falls* to ×1.70 at 27. The union of candidates cannot exceed
the reference grid's node count (here 118,336, of which the shared buffer reaches
19%), so hoisting is bounded by `maxNodes` rather than by how many surfaces the
column has. That is the structural reason it is safe, and it is what the "×11"
intuition missed.

⭐ **Time is almost unaffected**: +8% to +14% on real data at 18–27 layers, and
*faster* on the generated independent column, because today's design re-triangulates
the same domain once per chunk. The cost is vertex memory, and in absolute terms it
is small — ~9k extra vertices for a 27-layer column.

⚠️ The generated column brackets the answer rather than predicting it. Layers that
drape each other (correlated) refine onto the same nodes, so a chunk is cheap today
and pays ×1.8–2.6; layers with structure of their own are so expensive per chunk
that sharing wins outright (×0.77). Real surfaces sit between: individually smooth
(few candidates each) but largely disjoint, so the union of nine is ~2.5× any three
of them. The real run also confirms the caveat that motivated it — coverage and
thickness crossings, absent from the generated column, are substantial on real data
(10k and 26k candidates) — and the union still saturates.

⚠️ Remaining unknowns: only ONE envelope size and telescoping ratio was tried
(6 / 4.5 / 3 km). The harder chunks telescope, the better today's design looks. And
the true hoisted design puts every chunk's outline in as interior constraint edges,
which this approximates with a single envelope rim — that adds edges the
measurement does not carry.

⇒ **Recommendation: hoist.** ×2 vertex memory at ~10% tessellation cost buys exact
cross-chunk agreement, and it is what turns §10.1.9 (removing `cap`) from a
geometry problem into triangle assignment.

⚠️⚠️ **Superseded twice over — hoisting was built on this recommendation and then
rejected (§11.2), and `cap` was removed without it (§10.8). The measurement above
did not test the case that decided either.**

### 11.2 Hoisting — BUILT AND REJECTED (2026-08-11)

Built end to end (multi-outline `tessellateStack`, a `shared` option on
`buildSurfaceStack`, a `surfaceChunkStack` generator building every chunk in one
call, and a request registry on `ChunkStack` collecting the chunks' outlines), then
rejected and reverted. The work is kept as a patch at `private/stack-hoisting.patch`
(ignored, not in history).

**Why.** The shared tessellation is a function of *every* outline at once, so
nothing can be triangulated until every chunk has resolved its outline, and any
change to any outline invalidates all of it:

- No chunk paints until all of them are ready — the stack goes from chunks
  appearing progressively to one long stall.
- Changing a prop that moves an outline (the spike's `radius`) rebuilds the whole
  stack before *anything* updates. This is what made it untenable in use.

Against that it removes only the `2 × maxError` residual above, which has never
been observed as a visible artefact. No mitigation changes the trade: incremental
paint and one shared vertex set are mutually exclusive by construction. Building
each chunk standalone for first paint and swapping in hoisted geometry afterwards
would double the work for a visible pop.

⚠️ **Why §11.1 did not predict this.** It passed a **single square outline** to the
shared call and used a column with no synthetic relief, so it never exercised the
two properties that actually decide the cost: outlines that **overlap**, and
outlines that are **multi-component**. It also measured only triangulation, never
time-to-first-chunk — the thing that made hoisting unusable. If this is revisited,
measure first paint and per-chunk triangle counts on a real stack before writing
code.

⚠️ **The bug it exposed.** Chunk outlines overlap (telescoping tiers share their
XZ), so their rims **cross**. Two crossing constraint edges cannot both follow mesh
edges unless the crossing is itself a vertex, so `Delatin` could not enforce them:
it spent 91–465 ms *per edge* in `_constrainEdgeBrute` discovering it could not win
(O(edges) per flip, on a mesh 50× larger than any single chunk's), then locked an
edge it had never created — silently claiming a boundary that was not there. The
fix is to **node** the outlines first: split every rim segment at its crossings with
other rims, computing each crossing once so both rings insert bit-identical
coordinates and resolve to one vertex.

⇒ **That fix has since been landed on its own** (`nodeGridRings`, plus
`Delatin.constraintFailures` and the phantom-lock guard) because §10.8 needs exactly
the same thing to constrain a neighbour's rim into one chunk's mesh. The rest of the
patch stays rejected.

## 12. Build order

1. **Component skeleton** (settled): `ChunkStack` provider + `Chunk`, wrapping the
   existing SDK builder (still main-thread at first), with the three-layer
   separation in place. ⚠️ It first shipped with a `basement` slot and an
   `OceanChunk` sibling; both are gone (§2.1).
2. **Outline SDK helpers** (in flux): trajectory-vs-surface crossings → clustering →
   distance field → contour, with per-chunk options. **— done (2026-07-12):**
   `createSurfaceOutline` (surface rim) and the `createWellboreOutline` pipeline
   (`collectTrajectoryPoints` → `clusterPoints2D` → distance field →
   `marchingSquares`), wired through the `CutoutSource` on `ChunkStack`/`Chunk`.
3. **Worker generator** for chunk geometry (async). **— done**, and rebuilt on the
   shared tessellation (§9) in 2026-08-06.
4. **Vertical exaggeration** — a `scale={[1, k, 1]}` group on `ChunkStack`; safe
   because of §9.1, and needing no shader or material work. *Deferred.*
5. **Interactions**: focus-well (outline cut + peel), picking, annotations, buoyant
   children over a water layer.

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

### 13.1 Bounded fill (§10.1.1) — built

`buildStackReference` fills every invalid node from the nearest valid one via a
two-sweep chamfer transform, so **the distance to real data is already computed and
then discarded**. `maxFill` (metres, on `ChunkResolveOptions`) thresholds it:

- within `maxFill` metres of real data → filled, and the node counts as covered;
- beyond it → still filled, but left absent for the existing absence and trim
  machinery to deal with.

The *values* are filled either way. What the threshold bounds is the **mask**, i.e.
how far the fill is treated as knowledge — leaving a real cliff in the heights
would cost a dense cluster of slivers for geometry that is about to be dropped
anyway. `StackReference.masks` is therefore tri-state (`STACK_MASK_NONE` /
`_DATA` / `_FILLED`); every consumer that only asks "is this covered?" keeps
testing for truth, and the extra state costs no memory.

**It is an erosion radius, not a size test.** A hole of radius `r` disappears
exactly at `maxFill = r`, and below that it survives having lost a rim of
`maxFill`. Measured on the generated `holes` scenario (§14) — radii 100 / 500 /
1500 m, i.e. 0.03 / 0.8 / 7 km², in a 9 km square crop:

| `maxFill` | coverage | of which fill |
| --------: | -------: | ------------: |
|         0 |    0.894 |             0 |
|       100 |    0.911 |         0.017 |
|       300 |    0.937 |         0.044 |
|       500 |    0.958 |         0.064 |
|      1000 |    0.989 |         0.096 |
|      1600 |    1.000 |         0.106 |

That continuity is what makes one threshold usable across three orders of
magnitude: a 7 km² hole **cannot** be swallowed by a 300 m threshold, it can only
lose a 300 m rim. The same measurement on an extent rather than a hole (`inset`,
where the mapped polygon is smaller than the grid) runs 0.708 → 1.000 as `maxFill`
goes 0 → 2000 m, and on the `mismatch` pair the shorter surface goes 0.859 → 1.000
by 1500 m, which is the offset it was generated with.

⚠️ At the top of those ranges coverage reads 1.0 while a quarter of the chunk is
extrapolation (`inset` at 2000 m: 29% fill). Coverage alone would hide that, so
the share is reported per layer as `SurfaceChunkLayerDiagnostics.filled`.

**Default: 250 m** (`DEFAULT_CHUNK_MAX_FILL`). Volve's interior holes are 0.06–0.23
km² (radius 140–270 m) except for three at 2.8 / 10.4 / 44.8 km², so 250 m bridges
the everyday ones and leaves the large ones alone. It is one dataset: treat the value
as a starting point. `0` counts only real data.

⚠️ It applies even when `resolve` is omitted — the common grid is built either way,
and how far its fill is trusted is a property of that grid rather than of the
depth-order pass.

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

### 14.4 Columns, not just surfaces (Phase B) — built

`surface-field.ts` generates surfaces that are independent of one another, which is
enough for coverage but not for anything structural. `surface-column.ts` generates a
whole column the way one is deposited:

```
thickness(x, z) = drape + fill * max(0, dPrev − datum)
dNext           = dPrev − thickness
```

`drape` blankets the topography and carries the structure upward; `fill` levels it
toward `datum`. ⭐ Where the surface below is already shallower than the datum the
fill term is zero, so **the unit pinches out over a high** — a genuine zero-thickness
termination, which is what `collapseThreshold` and `refineTerminations` exist for and
what a single generated surface cannot produce. Stack several and the structure
flattens upward, as a real column does.

⭐ Everything is **analytic in `(x, z)`**: a unit's depth is a function of the
previous unit's depth at the same point, never of its grid. So each surface can be
rasterized onto its **own** grid — different `nx` / `xinc` / `rot` / origin — and the
surfaces still relate exactly. That is the §10.3.5 case, and a grid-chained generator
could not give it.

⭐⭐ Because the relationships are exact, a crossing or a mis-ordering seen
downstream is unambiguously a pipeline bug and never data noise. That is the main
reason to generate a column at all.

**Steps interrupt deposition**, oldest first:

- **erosion** — everything shallower than the unconformity is gone, and deposition
  resumes on it, which is what makes a section *angular*. How a removed horizon is
  RECORDED is the interesting part, and it is a real choice:
  - `mask` (**default**) — it has no data above the unconformity. This is what an
    interpreter delivers, and ⚠️ it is then indistinguishable from a survey edge —
    precisely the case §10.1.5 wants told apart, and precisely what a seal would
    taper back across, inventing rock that was removed 200 Ma ago.
  - `clip` — it is pushed onto the unconformity: zero thickness, still present,
    read downstream as a pinch-out.

  ⚠️ The default is chosen on the reasoning that honest test data should contain
  the hard case, **not** on domain review. `DEFAULT_EROSION_ENCODING` is one word.
- **fault** — ⭐ as GRID DATA holds one. A height field cannot carry a
  discontinuity, so whoever mapped the surfaces carried them *across* the plane and
  the throw arrives as a steep flexure `ramp` metres wide;
  `offset = throw · smoothstep((x−at)/ramp)`, dying out along strike over
  `halfLength`. **`ramp` is a property of the gridding, not of the geology**: narrow
  it and the surface approaches vertical, which is what stresses the tessellation.
  Juxtaposition survives — an old unit ends up beside a younger one — while the
  structural gap does not, because it is not in the data either. A fault applies to
  everything deposited so far; interleave several for a growth fault, and the `fill`
  term thickens each unit on the downthrown side by itself.

  ⚠️ Reverse and overturned geometry cannot be expressed at all — two depths at one
  position is not a height field. A limit of the representation, not of the
  generator (§10.3: detect and report, never smooth).

Units carry a `SedimentClass`. ⭐ The library still never assigns a colour: the
class → colour mapping lives in the story, because name → unit → colour is
company-specific.

⚠️ **Extent is an emission property.** A unit's `boundary`/`holes` say where someone
RECORDED it, and never change what was deposited — so a partly-mapped unit still
supports the ones above it. There is a test for exactly that.

**Variation.** `ColumnSpec.seed` shifts every relief in the column at once, so one
spec yields different realizations of the *same architecture* — same units, same
fault, same unconformity, different structure. (Re-rolling one relief's own seed
would only change that surface.) `ColumnSpec.erosionEncoding` sets the default for
erosion steps that do not name one.

⭐ The demo column is built from a `COLUMN` constants block in
`src/storybook/data/synthetic-surfaces.ts` — grid nodes, cell size, rotation, number
of units, depth range, structure amplitude, seed, erosion encoding, and where the
fault and the unconformity fall. Edit and reload. It is deliberately constants
rather than story controls: a column is DATA, and swapping it at runtime would mean
registering every variant in the store up front.

⚠️ Generation is eager, because the meta loader needs each surface's realized depth
range at store init, and costs about `nodes² × surfaces`: ~235 ms at 400 × 400 with
ten surfaces, ~135 ms at 300 × 300. It is paid once per page load by every story.

**The model, in cross-section:** [column-sketch.svg](column-sketch.svg) — drape,
fill and the pinch-out, a column flattening upward, the two erosion encodings, and
the fault both as geology (a dipping plane with heave, and the reverse case that
provably cannot be a height field) and as grid data (the flexure). Regenerate with
`node documents/column-sketch.cjs`.

Storybook: `Spikes/Chunks/SyntheticColumn`. The column enters the store as ordinary
`surface-meta` + `surface-values`, ids `synthetic:col:<key>:<index>`.

### 14.5 Consequence for the demo data — restoring the open dataset

`public/data` was replaced during development with a second field (`_johs`) because
the open Volve set could not show a deep, many-surface stack. Once synthetic
surfaces exist that is no longer necessary: the **original open dataset is
restored**, and any scenario it cannot show is generated instead. Demo data should
stay unmodified open data, so that what a reader sees is reproducible from the
published source.

⚠️ **It is not just a file swap.** The substitution grew hard dependencies that will
not survive it, because ids, names and the field origin all changed:

| dependency | where | what breaks |
| --- | --- | --- |
| `origin`, `utmZone`, `surfaceOptions`, wellbore ids | `src/storybook/story-args.json` (generated) | every chunk and surface story enumerates `surfaceOptions`; the ids no longer exist |
| name → age table, 32 entries | `src/storybook/data/strat-ages.ts` | `sortByStratAge` **excludes** surfaces it has no age for, so with Volve names it returns an empty stack and five stories render nothing |
| `'NORDLAND GP. Top'`, `'Basement Base'` | `SeabedConnection.spike.stories.tsx` | the two shared horizons are found by `_johs` NAME |
| `volve-polygon.json` | six stories | edited in place to fit `_johs`, despite the name |
| the dataset | `public/data/**` | 19 surfaces removed, 36 added, plus headers, logs and config |

**The ordering dependency is the only real design question.** The library contract
is that array order IS stratigraphic order and the *host* sorts (§9.3) — and the
stories are a host, so they need a name → age table for whichever field ships. Three
ways to satisfy it, in increasing order of how much they remove:

1. ship a Volve name → age table, the direct equivalent of what exists now;
2. sort by measured median depth inside the footprint (`stackDepthStats`), which on
   `_johs` agreed with the age order exactly — no table, but it infers the contract
   rather than being told it, and §10.1 is explicit that guessing an order is worse
   than dropping a surface;
3. ⭐ move the chunk spikes onto the **generated column** (§14.4), which is ordered
   correctly *by construction*, and leave the real-data stories to demonstrate a
   single surface and a wellbore. This deletes the strat-age dependency outright and
   is the case §14 was written for.

⚠️ Whichever is chosen, `sortByStratAge`'s current behaviour — silently excluding
un-aged surfaces — is what turns a dataset swap into an empty screen rather than an
error. It should say so loudly if it keeps that policy.
