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

⚠️ Water is the exception, and it is a separate flag rather than a property of
being synthetic: a FLUID layer (§6) is a level, not a horizon, so it is exempt
from the resolve and the collapse and its lid is tessellated on its own.

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

### 3.1 The chunk material (built 2026-08-12)

Caps and walls are drawn with `ChunkMaterial` — a library `ShaderMaterial` (Blinn-Phong
+ `attachOitVariants`), replacing the stock `MeshStandardMaterial` that `ChunkMeshes`
used to patch through `makeOitCompatible`. Three reasons it is worth owning:

- **Procedural detail.** `ChunkLayer.detail` selects a `ChunkDetailPreset` (`sand`,
  `silt`, `shale`, `carbonate`, `salt`, `coal`, `basement`, `seabed`) which adds
  texture-free relief from `shaderLib/procedural-normal.glsl`, applied to the layer's cap
  AND the wall of the interval below it. OFF by default; the only caller dial is one
  overall `strength`. ⭐ The library ships the presets but never assigns one — which unit
  is sand is host knowledge, exactly like colour (§ "colour is config"). The names match
  `SedimentClass` so a generated column maps straight through.
- **World anchoring instead of a UV.** The pattern coordinate is the WORLD position
  projected onto the plane the face most nearly lies in. A cap carries a per-layer grid
  uv and a wall a metric one, so there is no shared UV space; and a texture would need a
  repeat/scale picked per surface, which is the problem this removes. A cap and the wall
  below it therefore meet with the pattern continuous, and a vertical exaggeration does
  not stretch it. On a wall the grain's vertical axis can follow `wallV` (0 at the
  interval's base, 1 at its top — a new attribute from `buildRingWalls`, also what the
  ocean volume shader needs) so bedding belongs to the UNIT rather than to a depth.
- **⭐ It can opt out of the OIT passes that do not shade.** A fragment shader runs in
  FOUR OIT passes and `oitProcess` is called at the END of main, so the min-depth and
  occlusion passes would otherwise shade a fragment and throw the colour away.
  `chunk-frag.glsl` returns straight after `diffuseColor` under `OIT_DEPTH_PASS` /
  `OIT_OCCLUSION_PASS`, so the detail is paid for twice rather than four times.

`detail` and `wall` are read at CONSTRUCTION (they set shader defines), which is
consistent with layer 3 as it already works: `ChunkMeshes` rebuilds its materials on any
appearance change, and a fresh identity is what makes the OIT pass re-classify. ⚠️ A
caller-supplied `Material` is used as given, so detail (like the inference marking) does
not apply to it.

## 4. Outline system (in flux — pluggable strategies)

An outline is a first-class, derived object. A chunk consumes an outline; it does not
own the raw cut inputs.

### 4.1 CutoutSource

```
CutoutSource =
  | { kind: 'polygon'; polygon: PlanarPolygonGeometry }
  | { kind: 'wellbores'; wellbores: string[]; options: WellboreCutoutOptions }
```

`WellboreCutoutOptions` (per chunk, shallow-merged over the stack's): `mode`
(§4.2.1), `radius` / `minRadius` / `maxRadius`, `cellSize`, `simplify`, `feather`
(soft edge width), `shapeFn` (angular radius modifier for organic edges),
`smoothing`, `minRingArea`, plus the orchestration knobs `sampleSpacing` and
`tolerance`. We expect **more than one generation strategy** and treat this as a
pluggable interface rather than a fixed algorithm.

### 4.2 Wellbore-derived outline pipeline

1. **Sample** — place each wellbore's position log into the scene frame and
   densify it to `sampleSpacing`.
2. **Cut to the depth window** — `collectTrajectoryRuns` keeps the parts of the
   polyline inside the window `mode` asks for, tested at each sample's own XZ
   against the real (non-flat) surfaces. Output is a set of **ordered runs**: a
   well that leaves and re-enters yields several, and the window crossings are
   **interpolated**, so a run's ends do not move with `sampleSpacing`.
3. **Field + threshold** — `createWellboreOutline` buffers the runs: a signed
   distance field `distanceToNearestSegment − radius`, with the radius clamped to
   `min/max` and optionally modulated by `shapeFn`, then `feather`.
4. **Contour** — marching squares → smoothed rings → outer/hole components
   (`ringsToPolygonCoordinates`), which `PlanarPolygonGeometry` supports.

⭐ **Component count is emergent.** Marching squares emits one ring per connected
component of the buffered set, so wells yield separate outlines exactly while
their buffers stay apart and merge into one as they grow into each other. There is
no clustering threshold deciding this. `clusterPoints2D` still exists as a generic
SDK helper, and `createWellboreOutline` uses the same machinery internally — but
only to **partition the raster**, not the shape (see §4.2.2).

#### 4.2.1 Depth-window modes

`mode` decides which part of a well counts towards a chunk's outline:

| mode | window | result |
|---|---|---|
| `'window'` (default) | between the chunk's top and base | per-chunk footprints, unrelated to each other |
| `'above'` | wellhead → the chunk's base | the point set grows with depth ⇒ outlines nest ⇒ the stack **telescopes out** |
| `'below'` | the chunk's top → TD | the mirror image: widest at the top, narrowing with depth |

`'above'` and `'below'` are evaluated **continuously in depth** against the chunk's
own bounding surface, not against the chunk list, so a chunk is never limited by
what its neighbour happens to cover.

The stack ENVELOPE needs no special casing: resolving it against the column's
shallowest and deepest surfaces is exactly the widest window any chunk can ask for,
since a chunk's bounds are always a sub-range of the column's.

#### 4.2.2 Resolution follows the radius

The contour is a threshold of a field sampled at raster nodes, so a buffer thinner
than a cell breaks into blobs or vanishes — the historical "it fails at a small
radius" failure. Two rules remove it:

- the effective cell is clamped to `minRadius / OUTLINE_CELLS_PER_RADIUS` (3), and
- paths are rasterized **per spatially separated group**, each over its own
  bounding box, so the node count follows the corridors rather than the extent of
  the field. Groups are separated by more than any buffer can reach, so the result
  is identical to one big raster. Two platforms 20 km apart at `radius: 20` cost
  ~720k nodes instead of ~9M.

`maxCells` is a per-group backstop; when it forces a coarser cell than the radius
wanted, `WellboreOutlineMetrics.coarsened` says so via the `onMetrics` callback
rather than the outline silently degrading.

Within a group, segments are bucketed into a **uniform CSR grid** (cell
`2 × pruneMargin`), so a raster node tests only the handful of segments near it
instead of every segment in the group — a bounding-box prune is nearly useless for
a long diagonal well. Measured on 50 curved wells of 3 km each (min of 6, warm):

| radius | cell | nodes | no index | with index |
|---|---|---|---|---|
| 800 | 200 | 1.6k | 5 ms | 7 ms |
| 200 | 66.7 | 9.6k | 40 ms | 12 ms |
| 100 | 33.3 | 35k | 225 ms | 25 ms |
| 40 | 13.3 | 210k | 1973 ms | 142 ms |

⚠️ Past ~35k nodes the cost moves to `marchingSquares` and ring smoothing (31.5k
ring points at `radius: 40`), not the field. `indexCells` / `indexEntries` on the
metrics show bucket occupancy if the grid ever needs retuning.

`smoothing` and `feather` need no radius scaling of their own: both are expressed
in cells, and the cell now follows the radius.

⚠️ `shapeFn` measures its angle about the **group centroid**, which moves as groups
merge. It is the odd one out in this design and is expected to be replaced by an
additive, position-based perturbation (which commutes with the field's `min` and so
survives accumulation).

> **Status:** SDK helpers are pure and tested (`createSurfaceDepthSampler`,
> `collectTrajectoryRuns`, `createWellboreOutline`, plus the reusable
> `marchingSquares` / `ringsToPolygonCoordinates` / `simplifyPolyline`). The
> `CutoutSource` (§4.1) is wired into `ChunkStack`/`Chunk`. Full pipeline still
> main-thread (no worker yet).

#### 4.2.3 Per-interval margins (the ramp)

A margin is authored **per chunk**, but a chunk in `'above'`/`'below'` mode
accumulates trajectory from outside its own window — so it needs its neighbours'
margins too. `ChunkStack` collects every chunk's depth window and margin and
publishes them ordered by the **column** (`ChunkStackContextValue.margins`); a
chunk takes the prefix or suffix it accumulates and buffers each interval with the
margin of the chunk that owns it.

⭐ The model is a prefix-min of SIGNED fields, `min_k (d_k − r_k)` — but that
collapses to something far simpler:

$$\min_{k \le i}\ \min_{p \in k}(\mathrm{dist}_p - r_k) \;=\; \min_{p\ \in\ 0..i}\bigl(\mathrm{dist}_p - r_{\text{interval}(p)}\bigr)$$

so it is just **one field where each path carries its own margin**. No shared
raster, no cross-chunk field composition. `createWellboreOutline` therefore takes
`WellborePath[]` (`{ points, radius }`), and the margin is subtracted per SEGMENT
rather than once per call.

Two properties fall out:

- **Nesting is structural.** A deeper chunk's path set contains the shallower
  one's with the *same* per-path margins, so its field is pointwise smaller and
  its outline contains it — whether or not the margin grows with depth. A
  non-monotone ramp can no longer tear the stack apart.
- **A narrow neck stays narrow.** Buffering the whole accumulated set with the
  deep chunk's radius would bloat the shallow top-hole to the deep block's width.

⚠️ Nesting is exact in the FIELD but approximate in the CONTOUR: each chunk still
rasterizes on its own per-group grid with its own origin, so two nested outlines
can disagree by about a cell along the boundary. Same class of residual already
accepted between chunks (`2 × maxError`).

⚠️ A chunk in an accumulating mode must wait for its OWN entry to appear in the
ramp before resolving — the entries register in an effect, so the ramp is empty on
the first render. Same rule as `column` (§11).

⚠️ Cost: a chunk loads the bounding surface of every interval it accumulates, so
the stack does O(N²) `surface-values` requests. They are all cache hits after the
first (a `slice(0)` memcpy — see §14.5.1), but a stack-level resolution that
computed every chunk's outline in one pass would make it O(N) and is the obvious
next step if it ever shows.

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
- **Picking (built 2026-08-13)** — `Chunk` takes the standard `PointerEvents`
  props (`onPointerClick/Enter/Leave/Move`) and registers its own meshes with the
  GPU-picking `EventEmitter`, the same way `Surface` does. Two conventions worth
  knowing:
  - ⭐ Each mesh carries `userData = { layer, kind }`, so a handler reads
    `event.source.userData.layer` to learn WHICH unit was hit and `kind` to tell a
    cap from a wall. Without it a hit says only "this chunk", which is rarely the
    question.
  - Only the chunk's OWN meshes are registered — `children` stay outside the
    group, so anything placed inside a chunk keeps its own hit behaviour (or none).
  - `event.position` is the world position of the hit, read back from the pick
    buffer; see §5.3.4 for what to do with it.
- **Annotations** — chunk surfaces can carry labels via the annotation system.

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

### 5.3 Sampling what is drawn (built 2026-08-13)

Putting something ON a surface — a template, a pipeline, a marker — needs the
height of that surface at a given X/Z. A `ChunkStack` publishes a
`SurfaceSampler` through `SurfaceSamplerContext` for exactly that, the way it
already publishes the wave field through `OceanSamplerContext`. Both are `null`
when there is nothing to sample, so a consumer keeps its static pose rather than
jumping to the origin.

⭐ **It samples the TRIANGLES, not the grid.** The two are not the same surface:
the shared tessellation is simplified to within `maxError`, which at field scale is
metres. Heights taken from the source grid put an object visibly off the sea bed it
is supposed to be resting on, and no amount of care elsewhere fixes that — the
discrepancy is the tessellation's, by design. Sampling the drawn mesh is exact by
construction.

⭐ It also needs no round-trip. The chunk's geometry is already on the main thread
(that is what is being rendered), so `createTinSampler` buckets its triangles into
a uniform XZ grid — CSR, typed arrays, built on FIRST USE and cached against the
geometry — and a query touches only the handful of triangles over the point. That
is cheap enough to sample a whole footprint per pointer move, which is what the
third use case needs; the earlier plan for an async, batched sampler was solving a
problem that turned out not to exist.

How it is wired:

- `Chunk` registers the caps it drew (`SurfaceSamplerRegistryContext`), tagged with
  their surface ids. ⚠️ Its registry is SEPARATE from `ChunkStackContext`, whose
  identity is what every chunk's build spec derives from — a sibling finishing its
  geometry must not disturb that.
- The sampler's identity changes whenever a chunk's geometry does, which is the
  signal to sample again.
- `getHeightAt(x, z)` answers with the HIGHEST surface over the point — the ground
  as it is seen from above. Naming a surface id samples that horizon alone, which
  is what to do when a specific unit is the target rather than the top of the
  block.
- ⚠️ VOID CEILINGS AND THE FLOOR ARE NOT SAMPLEABLE. A void's upper copy faces up
  but is the underside of the unit above (§10.7), and something placed on it would
  sit inside the block; the column's carrier is tagged the same way (§10.9) and is
  excluded with it.

#### 5.3.1 One point is not a placement

`sampleSurfaceFootprint` samples a ring across the object's own extent and fits a
plane to it. ⭐ A single sample gives a height and nothing else, so a wide object on
sloping ground floats at one corner and digs in at the other; and a triangle's own
normal is the facet's, not the ground's, so it jitters as the object moves. The
same reasoning makes a ship follow the swell rather than one wave — and the fit is
the same least-squares plane `useBuoyancy` uses.

It reports `coverage`, the share of sample points that found a surface. ⭐ That is
the honest answer to "does this fit here": below 1 the object overhangs the edge of
what is drawn, which a centre sample cannot tell you.

`useSurfacePlacement` is the hook form — the static counterpart of `useBuoyancy`.
It settles once per change rather than every frame, because a horizon only moves
when its chunk is rebuilt, and that gives the sampler a new identity.

#### 5.3.2 Constructing on the sampled surface

`createLevelledBase` is the first thing built on top of the sampler, and the
example worth following: a structure that cannot stand on a slope is given a base
built FROM the ground under its footprint — a flat top at a level chosen from what
the terrain does there (`'max'` = pure fill, nothing excavated), a skirt cut into
the ground, and a draped underside. It reuses `createPolygonCap` for the caps and
`buildIntervalWalls` for the skirt, so the base is sealed for the same reason a
chunk is.

- The underside doubles as the sampling grid, so the level accounts for a rise in
  the MIDDLE of the footprint and not just around its rim.
- `embedment` sinks the skirt's foot into the ground. Two separate tessellations
  agree only to within their own errors, so without it a hairline of daylight can
  show under the base.
- ⚠️ `minThickness` stops a forced `level` below the ground from INVERTING the
  skirt — its bottom edge crossing its top, which turns the wall inside out rather
  than simply hiding it. The same failure as the shoreline wall in §6.2.
- `metrics` reports fill, cut, volume and coverage. A site is chosen from a map;
  how much of a berm it needs, and whether it even lies on mapped ground, is the
  answer.

Demonstrated in `Spikes/Chunks/SyntheticColumn` (`facilities`), where four sites
given as UTM easting/northing are put down on the generated sea bed. `facilityBase`
off drops the same structures straight onto the slope instead, which is the
comparison: they lean.

#### 5.3.3 Along a route, not at a point

`drapePolyline` is the line form: densify a route in scene XZ, sample every node,
and return the centreline — a pipeline, a cable, a survey line. `clearance` is the
caller's own radius, so the object RESTS on the ground rather than being centred
in it.

⭐ **`span` is the one modelling decision worth arguing about.** A stiff line rests
on the high points and bridges the hollows between them, so draping it over every
dip exactly is the shape it definitely does NOT take. `span` (metres) takes a
rolling MAXIMUM over that window, which is that behaviour and nothing more — no
mechanics are claimed. Being a maximum it can only ever move the line UP, so unlike
any smoothing filter it cannot push it into the ground; `smoothing` then rounds the
corners it leaves and is clamped back to the ground for the same reason.

⚠️ Real span analysis is a mechanics problem (stiffness, weight, current, allowable
stress) and this is not it. The option exists so the shape is honest at a glance;
anything load-bearing belongs in the host.

Nodes that find no surface are interpolated from the neighbours that did — a line
with a hole in it is worse than a line carried across one — and `gaps` reports how
many, so the guess is visible. The reported 3D `length` against the route's own map
length is the extra distance the ground costs.

⚠️ The mesh follows a SPLINE through the sampled nodes, so between them it can
deviate from the sampled drape; `clearance` absorbs that, which is another reason
to pass the object's radius rather than 0.

Demonstrated by the same story's `pipelines`: three flowlines and an export line,
whose end nodes are the site coordinates themselves so a tie-in cannot drift from
the structure it ties into. ⚠️ Diameters are the real thing (12¾", 16", 30") and are
therefore invisible at 7 km across — `pipeExaggeration` is there to look at them,
for the same reason the procedural detail presets are exaggerated (§3.1).

#### 5.3.4 Following the pointer

The dynamic case, and the one that needs BOTH mechanisms:

- **GPU picking says WHERE.** `EventEmitterCallbackEvent.position` carries the
  world position of the hit, read back from the pick buffer (the pick shader
  writes `vWorldPosition` alongside the emitter id). A height sampler cannot
  answer this — it has no idea where the ray went.
- **The footprint fit says HOW IT SITS.** A pick is one point, and one point
  cannot orient an object metres across. `sampleSurfaceFootprint` around the hit
  gives the height, the plane, and `coverage` — so a placeholder that would
  overhang the drawn surface can say so instead of hovering.

Cheap enough to run per pointer move: the sampler's index is already built, so a
ring of samples is a handful of bucket lookups. Drive the object imperatively from
the handler — a pointer move should cost no React render.

⚠️ **Four traps, all of which produce something that looks almost right:**

1. The hit is in WORLD space; chunk geometry is in the `UtmArea` group's frame.
   Run it through `worldToLocal` before sampling, and back through `localToWorld`
   before handing a point to the camera. Skipping this works only while the
   group's offset happens to be zero.
2. A cursor rendered INSIDE the picked group becomes an emitter and the pointer
   picks the cursor instead of the ground. Keep it outside (or tag it
   `LAYERS.NOT_EMITTER`).
3. ⭐ A marker drawn in the normal passes is painted over by the transparent
   layers — the sea, or the block itself. That is what `LAYERS.OVERLAY` is for:
   `OITRenderPass` draws that set LAST, after the transparent layers, leaving
   depth testing to the material. So a marker standing clear of the ground can
   keep depth testing (hidden behind land, seen through water, which writes no
   depth), while a gizmo lying ON the surface disables it to avoid z-fighting.
4. ⚠⚠ Anything reading the sampler must live BELOW the `ChunkStack` that provides
   it. A hook called in the component that RENDERS the stack sits above its own
   provider and gets `null` — with no error, and with the pointer handlers still
   firing perfectly, which sends you looking at the picking instead of at the
   tree. Put the stack's contents in their own component.

`Spikes/Chunks/SyntheticColumn` (`cursor`) shows it: the placeholder follows the
pointer and tilts to the local slope, left click leaves a marker, right click
clears them, and **ctrl+click flies the camera to the point**, the gesture the
wellbore examples already use.

⚠️ Telling the buttons apart needs `EventEmitterCallbackEvent.button`, which is
set on `click` only. Before it existed a right-click fired `click` exactly like a
left one and no consumer could tell.

## 6. Water specifics

Water is a **level**, not a horizon — a real case in the model rather than a
colour choice. Two of them, in fact, and they are worth keeping apart:

- a **fluid**: a contact INSIDE a unit — an oil/water contact, a gas cap, a water
  table. An ordinary boundary of the chunk that declares it (`ChunkLayer.fluid`).
- the **sea**: open water over the whole column, declared once on the
  `ChunkStack` (`ChunkStackProps.water`) and drawn by the stack itself.

⭐ The sea is not a chunk layer, for two reasons. It is a property of the COLUMN,
exactly like the carrier (§10.9) — every chunk cut from that column stands under
the same water. And a lid covers its whole footprint by design, so two chunks each
drawing part of the sea would leave two coplanar lids wherever their footprints
overlap.

### 6.1 A fluid is never the AUTHORITY

`StackResolveOptions.fluid` marks a boundary that is clamped by what lies above it
like any other, but never becomes the authority for what lies below: the cascade
looks THROUGH it to the nearest solid layer.

⭐ **The asymmetry is the whole point.** Shallow-wins truncation (§9.5) says the
younger surface cut the older one away — true of an unconformity, false of a
level. An ordinary contact sitting deeper than the base of the unit it divides
would drag that base down with it: an oil column with no water leg, real geology
deformed to make room for a fluid. Where a fluid has no room, its interval simply
pinches out as any unit's does.

`StackCollapseOptions.unbounded` is the stronger claim, and the SEA is the only
thing that makes it: its lid is drawn over the whole footprint whatever stands in
the way, it is never absent, and the layer below is not measured against it.
Without that, a sea bed standing above the plane is clamped down onto it and then
dropped as a duplicate — the land erased and the water covering everything.

⭐ With the exemption the shoreline does come free, but from the INTERVAL, not
from the resolve: the water body exists where it has thickness, so it ends where
the ground comes through, and the wall traced around it is zero-height along that
contour. (An earlier claim that the shoreline "falls out free" from the resolve
was measured and found to be exactly backwards.)

⚠️ The lid is drawn over land, hidden per pixel by whatever is in front of it — so
it is visible through transparent geology and from below. Deliberate: cutting the
lid would mean resolving it against the ground, and the cut would not match once
the surface is displaced.

⚠️⚠️ **A wall spanning a fluid may not INVERT.** The interval keeps a triangle
that has thickness at any one corner, so a rim quad can straddle the contour where
the two cross: its top edge flat on the plane, its bottom edge crossing over it.
Left alone that half-quad does not vanish, it turns inside out — painting the
volume UP the flank with its normal flipped, in exactly the band where the unit
rising through the plane draws its own wall, which is what the two z-fight over.
`buildStackWalls` therefore clamps the bottom edge to the top for any pair
involving a fluid. ⭐ For a CONTACT as much as for the sea: a fluid is no longer
the authority, so the resolve does not order that pair either, and the pinch-out
against the base of its own unit is the same geometry as a shoreline. Clamped only
there — everywhere else the resolve guarantees the order, and clamping silently
would hide a crossing instead of reporting it.

#### 6.1.1 Contacts are LINES, not legs (rewritten 2026-08-14)

An earlier version of this section described contacts as `fluid` LAYERS spliced
into a unit, carving it into gas, oil and water legs. ⚠️ **That model is removed**,
along with `ChunkLayer.fluid`. It was wrong in a way worth recording, because the
failure was invisible from every angle available at the time.

⭐⭐ **An interval whose FLOOR is a fluid has no solid bound.** A fluid is clamped
by the solid above it and, correctly, never becomes the authority for what lies
below — but nothing clamped it UP to the base of its own unit. So where the
reservoir base was shallower than the OWC, the oil leg (bounded below by that
contact) continued straight through the base into the units underneath; and the
water leg below it, having negative thickness, was not pinched out but drawn
INVERTED, because the per-triangle rule keeps a triangle with thickness at any one
corner. Three volumes over the same rock.

⚠️ Why it survived a day of being looked at — the transferable part:

- the spill is entirely INSIDE an opaque sealed block, and peeling exposes a unit
  from ABOVE, so the one surface that would show it is the one peeling cannot;
- `SurfaceChunkDiagnostics.crossings` is summed from the COLUMN's pairs, and a
  chunk-private layer is not one of them — the counter built to catch exactly this
  is structurally blind to it;
- the per-layer table read healthy: `droppedCollapsed` on the OWC row is the water
  leg pinching out, which is documented, expected behaviour;
- ⚠️ `buildStackWalls` already patched the symptom locally (clamping a wall's
  bottom edge to its top for any pair involving a fluid), which fixed the one place
  it was visible and left the heights — and so the caps, the volumes and the
  section cut face — untouched.

**What replaced it.** A contact is an ordinary depth surface grid — mostly flat,
same conventions as a horizon — declared on `ChunkStackProps.contacts` and drawn as
a LINE by `ChunkMaterial`, per fragment, where the geometry's own height crosses
the contact's. It is emphatically NOT a stack layer:

- it takes no part in the depth order, so it can neither truncate a horizon nor be
  truncated by one, and the spill above is unrepresentable;
- it never enters `ChunkStack.surfaces`, so it never reaches `resolveStackGrid`
  (which has no fluid concept at all), the column seal, or the column cache key;
- ⭐ it is pure APPEARANCE — swapping a realisation is a texture upload, not a
  geometry rebuild, which is what makes sweeping many realisations affordable.

⭐⭐ **One per-fragment test covers every view.** Shading where
`objectY ≈ contact(x, z)` puts the line on whatever face is exposed: the
accumulation outline on a reservoir cap (the closed contour where a flat contact
meets a domed top), the horizontal line on a section cut face, and the same line on
the block's outer walls. Cut faces are drawn with the same `ChunkMaterial`
instances (§15.9.3), so they are covered with no extra work.

**Encoding.** One `RG` float texture per contact: R the contact's scene Y, G its
validity. ⭐ Shared with the bed tint as `buildSurfaceDepthMap` / `ChunkDepthMap`
(§6.4.1) — the two want the same thing, a depth grid sampled from object XZ.
⚠️ Two channels because the grid's nodata sentinel is a legal float that would
otherwise draw a contact at an absurd depth. ⚠️ NEAREST filtering with the
bilinear done in the shader, because linear filtering of a 32-bit float texture
needs an extension and half float cannot hold a few thousand metres to better than
a couple of metres — doing it in the shader also lets an unmapped neighbour REJECT
the sample rather than bleed into it. The object-XZ → uv affine is recovered by
evaluating `surfaceWorldToGrid` at three points, so it cannot drift from the
placement the geometry is built with.

⚠️ **Scope belongs to the host.** A contact draws on every layer unless
`ChunkLayer.contacts` says otherwise, so an unrestricted one will cross units that
hold no fluid. Deliberate: this visualises interpreted data as given, and masking a
contact to a unit is interpretation to be added, never inferred.

⚠️ Limits: no line across a GAP between layers (nothing there to shade) and none on
a caller-supplied `Material` — the same limitation `detail`, the inference marking
and the section cut all carry. Dashes run along the line in SCREEN space, derived
from the gradient direction, since an implicit contour has no arc-length
parameterisation; they degrade where the line turns within a pixel.

⚠️⚠️ The SDK's `fluid` machinery stays exactly as it is: the SEA depends on it
(`stack-water-generator` passes `fluid: [true, false]`), and the sea never had this
bug because its floor is the sea bed — a solid. Only the component-level layer flag
is gone.

### 6.2 The lid is tessellated on its own terms

An unbounded layer's cap does **not** come from the shared tessellation. A flat
lid in a shared TIN is wrong in both directions at once: it carries every vertex
the surfaces below it needed, and still has none of its own where they needed none
— which is exactly where a water surface is most likely to be displaced. Refining
the shared TIN for it is not an option either, since every other layer pays.

Nothing is compared against it per vertex, so its lid is free to be built
separately: `createPolygonCap` triangulates the outline (ear clipping, so any
topology of components and holes comes out exactly) and refines only the
INTERIOR. The boundary is therefore the shared rim, vertex for vertex, at any
density — which is what keeps it sealed to the wall of the volume below.

`StackUnbounded.resolution` is a target triangle edge in metres: omit it for the
fewest triangles that fill the outline (all a per-pixel water surface needs), set
it when `displacement` is on. ⚠️ It applies over the whole footprint, so the cost
grows with the square of the field size, and the RIM stays at `rimSpacing` — the
lid's middle subdivides, its edge does not.

### 6.3 How the sea is built

The `stackWater` generator builds it as a stack in its own right, of exactly two
boundaries: **the level and the bed**. That is what makes it both cheap and
correct — the level is a fluid, so it is never the authority for what lies under
it, and being the FIRST layer there is then nothing left in the stack to order at
all. The bed keeps its own shape; an island rises through the plane; the body runs
out of thickness where it does.

⭐⭐ The bed is **the column's shallowest surface**, taken from the very channels
every chunk is built on (`getStackContext`, a cache hit) — sealed and ordered
exactly as they draw it. A second opinion about where the sea bed is would show up
as a gap along the whole shoreline. It is not capped here: that horizon is drawn
by whichever chunk it is the lid of (§10.8.1).

⚠️ The two still meet on DIFFERENT tessellations — this one refined for the water,
the chunk's for its own stack — so they agree only within `maxError`, the same
residual already accepted where two chunks meet.

⚠️ The sea needs an `outline` on the stack. A `cutSource` alone gives nothing to
draw it over.

### 6.4 The shaders

`StackWater` carries the sea state (`OceanWaterProps` / `OceanBodyProps`, shared
with the `Ocean` component through `ocean-material-sync.ts`) and `useStackWater`
supplies both materials: an `OceanMaterial` for the lid and an
`OceanVolumeMaterial` for the body. They are created once and then have their
uniforms updated, unlike the rest of a chunk's appearance, which is rebuilt on
change: a sea state is swept continuously and rebuilding a `ShaderMaterial`
recompiles its program.

⚠️ The water body reads its unit-relative height from the `wallV` attribute
(`OceanVolumeMaterial({ wallAttribute: true })`), because a chunk's interval wall
measures `uv` in metres — arc length and world height — which is what anchors
patterns in world space and must not be renormalised. With that in place the body
knobs carry over unchanged: `bodyFogDensity`, `bodyMaxOpacity` and `bodyShimmer`
mean the same here as on the component, the caustic light play included — it is
keyed to the top of the wall, which for a chunk is the shoreline-clipped rim of
the water rather than the side of a box.

#### 6.4.1 The bed tint

The `Ocean` component tints the top of its own sea bed toward the water colour
(`seaBedWaterTint`), because the surface's alpha stands for REFLECTION, not for
absorption through the water column — looking straight down, the Fresnel term
makes the surface nearly clear and an untinted bed reads as if it were dry.

A chunk's sea bed is ordinary geology drawn with `ChunkMaterial`, so it needs its
own version, and a flat one would be wrong: this bed can rise THROUGH the water.
`ChunkWaterTint.bedTint` is therefore depth-dependent,
`1 - exp(-depth / bedTintDepth)`, which is zero at the waterline and saturates
below it — so a coast or an island stays dry-looking without anything having to
know where the shoreline runs, and it stays right as the level is swept.

- It is compiled in per material (`CHUNK_WATER_TINT`), like `detail`, and applies
  to the cap of the SHALLOWEST layer of a chunk — not to the whole column, which a
  translucent stack would otherwise turn blue all the way down.
- The depth comes from the OBJECT position, not the world one: the stack can
  carry a vertical exaggeration, which would rescale a world-space depth away
  from metres.
- Strength follows `waterOpacity` when unset, the same coupling the component
  uses, so a denser sea gives a denser bed for free.
- ⚠️ Beer-Lambert saturates: at the default `bedTintDepth` of 80 m anything below
  ~250 m is already past 95 %, so on a bed that deep the whole cap reads uniform
  and the gradient is spent entirely around a coast or an island. To see depth
  across the WHOLE bed, `bedTintDepth` has to be a sizeable fraction of the bed's
  own range. Not a defect — but it is what "the tint ignores depth" looks like.
- ⚠️ Only the cap. The rim WALL of the sea-bed unit is not tinted: the water body
  exists only over the footprint, and the rim stands at that boundary, so there is
  no water between the eye and the flank. The same goes for a section cut face,
  which is drawn with the interval's own fill material. ⚠️⚠️ Tinting the wall WAS
  tried (2026-08-14) on the argument that the `Ocean` component has "the same gap",
  and reverted: the gap is not one, and §6.4.1 said so as a defect for a while.

##### The depth comes from the BED's grid, not from the vertex (2026-08-14)

The tint takes `level − bed(x, z)` from the bed's own grid, uploaded as a texture
and sampled per fragment from object XZ — exactly the encoding the fluid contacts
use (§6.1.1), and now shared with them as `buildSurfaceDepthMap` / `ChunkDepthMap`:
R the scene Y, G the validity, NEAREST with the bilinear done in the shader, and
the object-XZ → uv affine recovered by evaluating `surfaceWorldToGrid` at three
points.

⚠️ **Be honest about what this buys.** On the cap the fragment's own height IS the
bed, so the two agree by construction; all it removes is the TIN's interpolation of
that depth, which at field scale spans triangles hundreds of metres wide and shows
as faceting only where the tint is still on the steep part of its curve. It does
NOT license tinting anything below the bed (above).

⭐ Its real purpose is as an INPUT nothing else could supply: §6.6's shoreline foam,
and depth-driven water transparency, both need `level − bed(worldXZ)` per pixel and
the water shaders have no depth input of any kind.

- ⭐ **Where the grid is unmapped, the fragment's own depth is used again.** The
  coverage channel blends the two, so no bathymetry is exactly the old behaviour
  rather than a hole — and `CHUNK_BATHYMETRY` compiles the branch out entirely
  when no sea is declared.
- ⚠️⚠️ **The WATER surface does not blend the same way, and used to** (fixed
  2026-08-16). Its shoaling term fell back to the view-angle stand-in wherever the
  bed was unmapped, which is fine for a scene with no bed at all but makes a
  PARTLY mapped bed disagree with itself across its own survey edge: inside, the
  water is fully body-coloured (`shoal` saturates within a few hundred metres);
  outside, the colour follows the camera. On Volve that printed `Utsira Fm. Top`'s
  grid rectangle onto the sea as a crisp, view-dependent imprint. An unmapped bed
  now reads as DEEP water (`shoal = mix(1.0, …, bathy)`), and the stand-in is used
  only in the variant compiled without a map at all — which is what it was for.
- ⚠️ The surface is the COLUMN's shallowest (`column[0]`), the same one the sea's
  own geometry ends against — a second opinion about where the bed is would show
  along the whole shoreline. It is loaded in the appearance layer
  (`useStackBathymetry`) and published on `ChunkStackContextValue.bathymetry`, so
  it costs one texture upload and never a geometry rebuild.
- ⚠️ It is the RAW grid, not the sealed and resolved channel the geometry is built
  from, so the two differ by whatever the seal invented (§10.7). Acceptable for a
  tint; it would not be for anything that has to meet the mesh.
- ⚠️ A chunk whose layer 0 is NOT the sea bed — a deep tier in a stack — is still
  tinted, and now by the water over it rather than by its own depth, so it goes
  from saturated to faint. Less wrong, but the scope is still "layer 0 of every
  chunk" and that remains the caller's to arrange.
- ⚠️ The grid is uploaded at full resolution (a field grid is ~1001×1681 RG float),
  which a tint does not need. Decimating it is an obvious saving and is not done.

### 6.5 Floating objects

The stack provides the same two contexts an `<Ocean>` does, so a floating child
needs nothing else:

- `OceanSamplerContext` — the wave field. ⭐ `createOceanSampler` takes the sea's
  LEVEL, so heights come back absolute in the stack's frame and a floater needs no
  sea-level parent group of its own; it is simply placed at the water plane.
- `OceanContactContext` — where floating children register contact-foam
  footprints. Collected in the same `useFrame` that advances the wave clock, and
  skipped entirely when nothing is registered.

Both are `null` when no sea is declared, which is the documented fallback: the
object keeps its static pose.

The same shape, for surfaces rather than water, is §5.3 — with the difference that
a surface sampler reads GEOMETRY where this one is analytic, because a horizon is a
function of data and a sea is a function of time.

⚠️ A contact footprint carries the object's FORWARD DIRECTION in world XZ, not the
sine and cosine of a heading. A rotation about +Y takes the body's +X to
`(cos, -sin)` in XZ, and the pair notation named no convention that either end
could check — which is precisely how the footprint spent its life mirrored about
the forward axis without anyone noticing (every caller passed heading 0).

### 6.6 The shore (2026-08-14)

The bathymetry map (§6.4.1) gave the water shaders their first depth input, and
three effects fall out of that one quantity, `waterDepth = level − bed(x, z)`.
They are listed in the order they matter, and the ⚠️ that opens this section
governs all of them.

⚠️⚠️ Everything here keys on water DEPTH, never on the water body's wall boundary.
Most of that boundary is the outline CROP, not a shore, and surf along an
arbitrary crop edge is the same kind of confident lie as a wall at a data edge
(§10.1.5). A depth test cannot make that mistake, which is why it is the only
input any of this reads.

#### 6.6.1 Shoaling — the view angle was standing in for depth

⭐⭐ The find worth recording: `fragment.glsl` already mixed
`uShallowColor → uDeepColor` by **`ndvAA`, the view angle**, and set
`alpha = mix(uOpacity, 1.0, fresnel)`. The angle was a PROXY for depth, adopted
because there was no depth input — so open sea and a metre of water over a
sandbank were identical from the same viewpoint, and no amount of colour tuning
could separate them.

`shoalDepth` replaces the proxy: `shoal = 1 − exp(−waterDepth / shoalDepth)`
drives both the body colour and the body's share of the alpha, with
`shoalOpacity` saying what is left of that opacity where the bed reaches the
surface (default 0 — clear, leaving only the reflection).

- ⚠️ **The Fresnel term is deliberately untouched.** A reflection at a grazing
  angle does not care how deep the water is, so shallow water still goes bright
  and mirror-like edge-on. That is correct, not a leak.
- ⭐ Everything blends by the map's COVERAGE channel, so an unmapped area is
  bit-for-bit the original angle-driven look rather than a hole — and
  `OCEAN_BATHYMETRY` compiles the whole branch out when no bed is supplied.

#### 6.6.2 Shore foam, and where the swash comes from

`shoreFoam` is `1 − smoothstep(0, shoreFoamDepth, waterDepth)`, folded into the
shader's EXISTING `foamCoverage` with a `max`.

⭐ Reusing that variable rather than compositing a second band is the whole trick:
the noise texture, the froth modulation, the pixel-footprint anti-aliasing and the
distance fade are all built around it, so shore foam inherits them and cannot read
as a different kind of foam from the whitecaps beside it.

⭐⭐ **The swash needs no clock.** Offsetting the LEVEL by the fragment's own wave
height — `waterDepth = (level + height × swash) − bed` — makes the waterline
advance and retreat with the real swell, varied along the coast, phase-locked to
the surface it belongs to. A separately animated threshold would have to be tuned
against the sea state to avoid drifting out of step with it; this cannot.

⭐⭐ **The band peaks at the BREAK LINE, not at the water's edge**, and getting
this wrong is what made the first version read as a keyline drawn round the land.
Foam is generated where the waves break and then washes shoreward while decaying,
so the bright line stands OFFSHORE and the water's edge is the dim end — a profile
that maxes at depth 0 traces the coastline exactly, which is precisely what an
outline is. The shape is a peak at the break, an exponential decay inshore to
`OCEAN_SURF_RESIDUAL`, and a Gaussian cutoff seaward.

⭐⭐ **The surf zone moves with the sea state.** Waves break where the depth falls
to about 1.3× their own height, so `breakDepth = shoreBreakDepth × Hs` — a thin
line in a calm, a wide belt in a storm. A FIXED band in metres was the single most
unphysical thing here: the whole sea offshore responded to the wind and the shore
did not, which is visible without being nameable. ⚠️ `Hs` is floored at
`OCEAN_SWELL_FLOOR` to stand in for background swell, or the shore would go glassy
at wind 0 — this model has no swell separate from the local wind.

⭐ **Exposure is free.** `|dot(windDir, ∇bed)|` is already computed for the swash,
and a windward coast breaks while a lee shore mostly does not — so the same term
modulates how much surf a stretch of coast gets at all, floored at
`OCEAN_LEE_EXPOSURE` for the energy that refracts round a headland.

⚠️ Slow low-frequency sets pulse the band, because surf arrives in groups. Along
the coast as well as in time, so a straight shore does not flash uniformly.

⚠⚠ **A realistic surf zone is a handful of pixels at field scale**, which is the
same problem `pipeExaggeration` has (§5.3.3) — and the earlier version had it
WITHOUT admitting it, which is worse than either extreme. `surfScale` is the
escape hatch and defaults to **1, as measured**: a correctly-sized shore is one of
the cues that tells a viewer how far away they are, and exaggerating it takes that
away. The exaggeration is available, opt-in, and named for what it is.

⚠️ Independent of the wind's FOAM amount, unlike whitecaps — it carries its own
`shoreFoam` rather than riding `foamAmount`, since a shore breaks under a swell
that raises no whitecaps offshore.

⚠️⚠️ **There is no refraction, and its absence is visible.** Real waves turn to
face the shore as they shoal, so run-up on a beach is near-uniform along it. This
shader carries the deep-water direction right up to the sand, so a wind running
PARALLEL to the coast made the waterline scallop into stripes sliding along it.
The swash is therefore weighted by `|dot(windDir, ∇bed)|` — waves running along a
coast stop moving its waterline. ⚠️ That suppresses the artefact rather than
modelling its cause; under real refraction the weight would be ~1 everywhere. The
honest version re-evaluates the wave field on a shore-projected coordinate, which
is a second 16-component sum per fragment — measure before paying for it. The
gradient costs two extra samples of the map, using the grid's own cell size
(`ChunkDepthMap.cellSize`).

⚠️⚠️ **A WORLD-space band needs analytic anti-aliasing, not a fade.** The band is
some metres of DEPTH wide, so on a STEEP shore it eventually becomes narrower than
a pixel and would be drawn as a hard aliased line. Dropping its amplitude by
however much it is over-wide preserves the integral, so it goes soft and dim rather
than thin and hard.

⚠️⚠️ **It is not what softens the band at distance, though — measure before
assuming it is.** The band's width ON SCREEN is the break depth over the bed's
gradient, and a
few metres of depth on a gentle shelf is hundreds of metres across, so it stays
resolvable at any sane zoom and the compensation never engages. What softens it is
a colour blend (below). The AA earns its keep only on a steep coast.

⭐⭐ **A faded colour and an unfaded alpha is the failure, and the symptom points
at the wrong one.** Foam ended with `alpha = max(alpha, foam)` — "foam reads as
opaque" — taken from the raw coverage, so foam faded all the way out still forced
the water to full opacity. What then showed was the water's colour AT OPACITY 1,
where the real pixel over a shoal is mostly sea bed seen through clear water: a
saturated teal band exactly where the foam had been asked to disappear. Turning
`shoreFoamStrength` down made it *worse*, which is what sent two rounds of fixes
at the colour.

⭐ The cure is to notice there is only ONE quantity. Fading a colour toward the
water is identical to reducing coverage,

$$\mathrm{mix}(c,\ \mathrm{mix}(f, c, k),\ b) \;=\; \mathrm{mix}(c,\ f,\ b(1-k))$$

so the shader computes `foamOpacity = foamBlend × (1 − fade)` once and uses it for
the colour **and** the alpha. In that form the two cannot drift apart, and
"strength 0" means no foam in every channel.

⚠️ Before that it was also faded toward `waterColor` — the body term alone, with no
reflection, specular or tonal variation — which is not what the water looks like:
darker than the lit sea, and over a shoal the SHALLOW colour. The opacity form
removes the question entirely, since there is no longer a colour to fade toward.

⚠️ The shore band keeps its own factor (`shoreFoamStrength` / `shoreFoamFade`)
rather than riding the whitecaps' `foamFar`. ⭐ The general lesson: **when a
feature is folded into existing machinery, its level-of-detail behaviour does not
come along for free.** A whitecap is sub-pixel at distance; a shore band's width on
screen is `shoreFoamDepth / |∇bed|`, hundreds of metres on a gentle shelf, so it
never is.

⚠️ `fwidth` straddles two surfaces at a silhouette and comes back far too large,
the same trap the contact lines hit (§6.1.1). Here it can only make the band
DIMMER, so it degrades safely and needs no cap. It is taken from the unperturbed
depth: the AA width should follow the field, not the raggedness applied to it.

⚠️ `shoreNoise` makes the landward edge ragged instead of following the
bathymetry contour exactly, which reads as unnaturally crisp. It perturbs the FOAM
band only — perturbing `waterDepth` itself would make the transparency and colour
ripple with it — and it drifts slowly on its own rather than with the wind that
carries the whitecap noise, because a coastline's raggedness belongs to the shore
and must not stream downwind. Footprint-faded, so it flattens rather than
speckling.

⚠️ The band is in metres of DEPTH, not of distance. Right for a beach (a flat
gradient genuinely surfs further up) but it becomes very wide on a flat shelf.
Dividing by the bathymetry's gradient would fix that and costs a second sample;
not done, because it should be driven by seeing the problem.

#### 6.6.3 The wet band, on the land side

`wetBand` darkens the bed just below the waterline, because wet ground is darker.
Small, and it does the most for the shore of the three: without it the coast is a
hard colour boundary between dry ground and tinted bed.

⚠️ It fades out a little ABOVE the waterline as well — the splash zone — rather
than ending on a step there. A hard edge exactly at depth 0 aliases along the
whole coast, which is the one line the eye is already following.

⭐ **It does NOT swash, and should not.** The wet band is the swash ZONE — a time
average, which is why sand stays dark between waves — while the foam is the
instantaneous edge moving inside it. The two are meant to disagree; syncing them
would be modelling one thing as the other.

⚠️ On the bed's CAP only, the same scope as the tint and for the same reason
(§6.4.1).

#### 6.6.4 Underwater: the sea is surfaces, not a medium (2026-08-14)

⭐⭐ **From inside the water body nothing attenuates anything.** The sea is a lid
and a set of walls. From OUTSIDE, every sightline into the water crosses one of
them and picks up its alpha or its `bodyFogDensity`, which is why looking in
through the surface or through a wall both read correctly. From INSIDE there is no
surface in the path at all, so the bed is drawn at full clarity however far away it
is — impossibly clear water.

⚠️ `bedTint` cannot stand in for it, and the reason is the same one §6.4.1 records:
it is a function of the bed's own depth BELOW SEA LEVEL, which is the right
quantity for looking down through the water column and the wrong one for looking
sideways through 300 m of it. Tuning it to look right from inside makes it wrong
from outside.

⭐ **Scene fog is the cheap answer**, because it attenuates by DISTANCE FROM THE
CAMERA — the quantity that matters underwater and the one nothing else here
measures. `useUnderwaterFog` installs a `FogExp2` while the camera is inside the
water, at the water body's own `bodyFogDensity` so the two agree by construction.

⚠️⚠️ **"Below sea level" is NOT the test, and using it is a show-stopper.** Water
occupies the volume between the surface and the bed, over the footprint the bed is
mapped on — so a camera under the bed is inside ROCK, and one outside the footprint
is nowhere near the field. The first version fogged both: looking at formations
from kilometres away, everything blue.

⭐ The stack's own `SurfaceSampler` (§5.3) answers all three conditions at once. It
returns the height of the highest drawn surface, which is the bed, and `null` where
nothing is drawn — so `null` means both "outside the footprint" and "no water
here", and the test is one sample per frame against an index that already exists.

- ⭐ The whole test runs in the stack's OBJECT frame: the camera is brought in
  through the root group's inverse matrix, so a vertical exaggeration cannot put
  the water plane and the camera in different spaces.
- ⚠️ The fog ramps over `transition` metres below the surface AND above the bed, so
  both boundaries fade. The FOOTPRINT edge has no distance to ramp over, so the
  amount is additionally damped over ~0.25 s — otherwise crossing it pops.

⭐⭐ It also **reaches host geometry**. A vessel, a facility, a pipeline or a
wellbore is fogged for free, because stock three materials support fog — which is
what no material of ours could ever do, and it retires most of the rendering pass
this section used to call for.

- ⚠️ **A `ShaderMaterial`'s `fog` defaults to false.** Every library shader has
  carried `<fog_pars_fragment>` and `<fog_fragment>` all along, but three only
  defines `USE_FOG` when the material asks for it, so all of it compiled to
  nothing. `ChunkMaterial` and `OceanMaterial` now set `fog = true`; the other
  library materials still do not, and turning them on is one line each.
- ⭐ **The lid is fogged too**, since looking up from inside the water there is
  water in the way. ⚠️ The water BODY is deliberately NOT: its walls already fog
  themselves by view distance (`bodyFogDensity`), and scene fog on top would count
  the same water twice.
- ⭐ **The fog is installed once and its DENSITY ramped to zero out of water**,
  rather than being attached and detached. Adding or removing `scene.fog` changes
  every material's program cache key, so toggling would recompile the scene's
  shaders each time the camera left the water.
- ⚠️ `scene.fog` and `scene.background` are HOST state. Both are saved and handed
  back on unmount.
- ⚠⚠ **There is no free "disabled" state, which is why `immersion` is absent by
  default.** Installing `scene.fog` at all changes every material's program cache
  key, so a hook that stayed mounted and returned early would still cost a
  different shader. The medium test therefore lives in a CHILD COMPONENT
  (`StackImmersionFog`) that is only rendered when the prop is declared: nothing
  subscribes to the frame loop, nothing is installed, and every program compiles
  exactly as it did before. ⚠️ The one thing that cannot be gated: if a HOST sets
  `scene.fog` for its own reasons, chunks and surfaces are now fogged where before
  they silently were not.
- ⭐ **The background is INTERPOLATED, not swapped**, from the host's own colour (or
  the renderer's clear colour when it had none) toward the medium's. An earlier
  version stepped it once the density crossed zero, which read as the background
  holding blue and then snapping to black a second later. ⚠️ A texture or cube map
  cannot be interpolated, so that case is still a swap.
- ⚠⚠ **The fog colour and the background have to agree**, and `background: false`
  breaks that unless the host sets its own. It is worse on a BRIGHT background than
  a dark one: fog toward deep blue against a white sky reads as a haze hanging in a
  room rather than as a medium.
- ⚠️ Three's `FogExp2` is `exp(−(density·d)²)` while the water body is
  `1 − exp(−d·k)`, so the same density does not give the same curve on both sides
  of a wall. They agree in magnitude, not in shape.

#### 6.6.5 Sediment is the same mechanism

⭐ Once the medium test exists, a chunk is another volume: below the drawn ground
and above the block's base is INSIDE THE ROCK, and fogging it toward a dark colour
is the volumetric feel that a shell of surfaces otherwise cannot give.

⭐⭐ **It is a positional CUE, not occlusion, and that decides the tuning.**
Navigating a 3D scene is confusing for people who do not do it often, and the
value here is telling someone who has flown the camera into the ground that they
have. Physical realism says you should see nothing inside rock — but a blackout
adds to the disorientation rather than resolving it, and it hides the wellbores
that are the reason to be down there. Dimming is the useful reading.

⚠️ Which is why the knob is `visibility` IN METRES rather than a density. Three's
`FogExp2` is `exp(−(d / visibility)²)` — it saturates QUADRATICALLY, ~63% at that
distance and ~98% at twice it — and there is no way to bound fog short of patching
the fog chunk in every shader. So the amount you can see is chosen entirely by this
one number, and a useful density at field scale is something like 0.0025, which
nobody can reason about. ⚠️ The sea keeps `bodyFogDensity`, because that one also
feeds the water body's wall shader and the two must agree.

⭐ **Wellbores need nothing.** `tube-material` and the trajectory and ribbon
materials have carried `fog: true` all along, so they are fogged automatically and
their legibility follows the same knob.

- ⚠️ **One colour for the whole block, not per unit.** The fills live in the
  appearance layer (`ChunkLayer.fill`), and the stack does not know them — per-unit
  colour would mean every chunk publishing its palette upward through a registry.
  Deferred deliberately; the caller supplies one colour instead.
- ⚠️ **The base is derived, not sampled.** A carrier floor is deliberately not
  sampleable (§5.3), so the block's bottom comes from the column's depth range and
  the carrier's own declaration. Approximate wherever that base is not flat.
- ⚠️ **The section suppresses it.** A camera standing where the plane took the
  block away is in open air whatever the heights say, so the medium test rejects
  the discarded half-space first.
- ⚠⚠ **PEELING does not, and cannot here:** peel is a per-chunk property and the
  stack does not see it, so peeling a unit away leaves the camera "inside" it. The
  workaround is the feature's own switch — a host that peels should drop
  `immersion` while it does. Acceptable because this is an opt-in visual effect,
  not a correctness feature.
- ⚠️ The medium is chosen by one `getHeightAt` per frame, which is a CSR bucket
  lookup — but it is per frame, and only paid when the feature is on.

⭐ **`waterOpacity` is the other half of this.** Depth-driven transparency decoupled
two things that used to share one knob: it used to trade "deep water reads as water"
against "you can still see the shore", so it had to be a compromise. With the shoal
term keeping the shallows clear, the deep end is free to be as opaque as it should
be — which incidentally sinks seabed objects into the water simply by putting a more
opaque lid in front of them.

- Per-vertex anything on the lid remains a dead end: with displacement off the lid
  is the fewest triangles that fill the outline, so a depth attribute would
  interpolate linearly over kilometres, and making it usable forces a fine lid over
  the whole footprint — the quadratic cost §6.2 exists to avoid. All of the above
  is per fragment for that reason.
- Refraction (§6.6.2), which the swash weighting only papers over.
- Refraction of the SURFACE itself, and foam that persists as a receding sheet
  rather than following the instantaneous surface.
- The bathymetry is uploaded at full grid resolution; a foam band would be happy
  with far less (§6.4.1).

#### 6.6.5 ⚠️ A bilinear artefact the shore made visible

The hand-rolled bilinear in `depth-map.glsl` is C0 but not C1 — its gradient jumps
at every texel boundary — and the shoal's steep response curve turned those jumps
into a visible cross-hatch lattice aligned with the (rotated) grid, right in the
shallow band. Hermite-smoothing the fractional weights (`f = f²(3 − 2f)`) makes
the interpolant C1 and removes it for two instructions.

⭐ Worth generalising: **a smooth response over a bilinear field shows the field's
seams.** Anything that takes a derivative of one, or applies a steep curve to it,
wants the smoothed weights — which includes the contact lines (§6.1.1), whose
`fwidth` reads the same field directly.


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

⭐ None of this applies across a FLUID boundary (§6): the sea did not erode the
sea bed. A fluid is outside the cascade entirely, which is what lets ground stand
above it — and it is affordable there precisely because the case §9.5 warns about
does not arise: the lid needs no hole cutting, since it is transparent and its
volume simply ends at the shoreline.

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

⚠️ **The accurate statement is "which is DRAWN over at least the same region"**,
and that turns out to have three exceptions rather than one. The chunk above is
the first (below); PEELING and SECTIONING are the other two, since both shrink the
region the covering layer occupies — see §15.12, which restores the fragments for
exactly the same reason this section keeps them.

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
4. **The water shader** — **BUILT, see §6.** The sea is declared on the
   `ChunkStack` (`water`), which supplies both ocean materials and draws it as a
   two-boundary stack of its own; the prop→uniform sync is shared with `Ocean`
   rather than copied. Both snags recorded here were real and are closed: the wall
   reads a normalised `wallV` attribute under a define instead of the metric
   `uv.y`, and the lid is built on its own triangulation of the outline rather
   than inheriting the sea bed's TIN. ⭐ Floating objects are closed too — the
   stack provides the wave sampler AND the contact-foam registry, so a vessel
   floats and foams with nothing extra wired (§6.5). ⚠️ `Ocean` did NOT decompose:
   it still owns its own meshes, so the standalone component stays.
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
     **— built (§15.11)** as `ChunkProps.peel`, a count of UNITS. ⚠️ It drops each
     unit's cap AND its volume but keeps the cap of the first survivor, or the
     block comes apart; `side` is still not built.
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

   ⇒ **Sectioning (§15) changes the premise of the first bullet.** `DoubleSide` is
   what currently keeps a clipped block from reading as a transparent shell; once a
   cut face is drawn there is nothing to see through, so "opaque and sealed ⇒ front
   faces only" stops costing anything and becomes worth doing.

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

⭐ **A horizon belongs to the chunk it is the LID of.** A cap is the lid of the
block underneath it, so that block draws it — with its own material and opacity.
The alternative (widest draws it) was tried first and is what forced the appearance
to travel across the seam; see §10.8.3.

⚠️ **Lid** means the chunk's first layer AND one that holds a volume. Both halves
matter: a chunk whose first layer is a bare sheet has no block for that cap to be
the lid of, and letting it claim the horizon anyway hands a translucent sheet the
cap of the solid block below — the exact failure this rule exists to prevent. (Seen
for real: a water tier reduced to a bare sea-bed sheet took the lid away from the
opaque detail block under it, and the block's inner walls showed through.)

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

A horizon that is nobody's lid has no owner, which leaves the area order:
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
  {/* the fill on the LAST layer is what asks for the floor */}
  <Chunk layers={[{ surface: basement, fill: '#4a4a4a' }]} />
</ChunkStack>
```

`{ depth }` places it absolutely; `{ below }` clears the column's deepest **mapped**
sample by a margin (hole fill is excluded, or a survey edge extrapolated downward
would drag the floor with it). It is complete over the whole grid and constant in
Y, which is what makes it a guarantee rather than another surface: whatever the
data does, the block has a floor.

#### 10.9.0 Which chunk draws it is INFERRED

A `fill` on a chunk's **last** layer says the block is open at the bottom — there
is no next boundary in that chunk for the volume to end on — and the only thing
that can close it is the column's floor. So the carrier layer is appended by
`buildSurfaceChunkSpec` rather than declared; there is no `{ carrier: true }`.

⭐ Nothing was taken away by this: a fill on the last layer used to be silently
ignored, so the flag had no meaning to steal, and with no carrier on the stack it
is ignored still.

⭐⭐ Several chunks may close their blocks, and the floor is ONE plane, so it
claims the seam registry under a synthetic id (`CARRIER_SEAM_ID`) exactly as a
shared horizon does (§10.8.1). No new rule was needed: a floor is nobody's TOP
layer, so the lid-owner tier does not apply and the ranking falls through to AREA
order — the widest draws it, the others are contained or cut around it. Which is
the right answer for a floor, and not by luck: a cap belongs to the block under
it, and a floor has none.

#### 10.9.1 It is a terminator, not a unit

There is no interval *below* a carrier, so it has a cap and no `fill`, and it is
the only side of the block seen from underneath — which is why its cap defaults to
the fill of the unit ABOVE it, exactly as a void's ceiling does. `carrier.material`
overrides that, for a floor that should read as its own thing.

⚠️ The material lives on the STACK's carrier because the layer is inferred and has
nowhere else to carry one. It is published to `ChunkMeshes` separately from the
carrier itself: the carrier's identity is keyed on WHERE the plane is, so that
recolouring the floor cannot rebuild geometry, which also makes that copy
deliberately stale for appearance. It is stripped before the spec crosses into the
worker — a `Material` cannot be structured-cloned, and appearance in a build spec
is what makes recolouring expensive in the first place.

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
2. **Outline SDK helpers** (in flux): trajectory → depth-window runs → segment
   distance field → contour, with per-chunk options. **— done:**
   `createSurfaceOutline` (surface rim) and the `createWellboreOutline` pipeline
   (`collectTrajectoryRuns` → per-group segment distance field →
   `marchingSquares`), wired through the `CutoutSource` on `ChunkStack`/`Chunk`.
   Depth-window `mode` (§4.2.1) added 2026-08-13.
3. **Worker generator** for chunk geometry (async). **— done**, and rebuilt on the
   shared tessellation (§9) in 2026-08-06.
4. **Vertical exaggeration** — a `scale={[1, k, 1]}` group on `ChunkStack`; safe
   because of §9.1, and needing no shader or material work. *Deferred.*
5. **Interactions**: focus-well (outline cut + peel), picking, annotations, buoyant
   children over a water layer.
6. **Sectioning** (§15): a clip plane in any orientation, with the cut face filled
   per interval. Independent of 4 and 5, and cheap because of §9.1 — but it reads
   the tessellation and the channels, so it comes after the geometry layer is
   settled. **— done (§15.9)**, for one plane. ⚠️ It cuts the CHUNKS only: the sea,
   and everything standing on the block, keep drawing whole.

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

⭐ One store also means a story can WRITE to it, which is how story-specific data is
meant to arrive — see §14.6.

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
registering every variant in the store up front — the constraint §14.6 lifts.

⚠️ Generation is eager, because the meta loader needs each surface's realized depth
range at store init, and costs about `nodes² × surfaces`: ~235 ms at 400 × 400 with
ten surfaces, ~135 ms at 300 × 300. It is paid once per page load by every story.
§14.6 is how that cost goes away.

**The model, in cross-section:** [column-sketch.svg](column-sketch.svg) — drape,
fill and the pinch-out, a column flattening upward, the two erosion encodings, and
the fault both as geology (a dipping plane with heave, and the reverse case that
provably cannot be a height field) and as grid data (the flexure). Regenerate with
`node documents/column-sketch.cjs`.

Storybook: `Spikes/Chunks/SyntheticColumn`. The column enters the store as ordinary
`surface-meta` + `surface-values`, ids `synthetic:col:<key>:<index>`.

#### 14.4.1 Landforms, not noise

`ReliefSpec` is a union of SHAPES, not just noise fields, and the components
compose in one array:

- `dunes` / `ridges` — the noise fields, unchanged;
- **`ramp`** — an eased rise along an azimuth: flat, slope, flat. ⭐ The easing is
  what makes it a landform rather than a tilt; a bare gradient is what `dip`
  already gives, and what it draws is a basin, a continental slope and a shelf;
- **`dome`** — a radial high with a rim of `falloff` measured inward from
  `radius`, so a narrow rim is a flat-topped island and `falloff = radius` a
  smooth hill.

⭐ `mode` decides what the base MEANS: `'center'` (default) puts it at the mean,
which is right for noise and wrong for a landform — it would dig a moat round the
island. `'above'` makes the base the low point, so the field is zero everywhere
outside the shape.

⚠️ Relief is added to **depth** by the surface generators and to **scene Y** by
the chunk stack. `reliefDepth` is the depth-space form, and the single place that
sign is stated; before it there were three inline copies, all of the `'center'`
formula, and a relief peak in a column was silently a low.

The demo column's sea bed is built from these: a basin, a coast rising out of it,
an island standing off it and a hill on the island, with a little dune texture
over the top. ⚠️ For a stated height to mean anything, the unit carrying it must
land exactly on its datum (`drape: 0, fill: 1`) — otherwise the drape and the
surface below put it wherever they like, and every figure is quietly out by that
much. It measured 43 m out before that was fixed.

### 14.5 Consequence for the demo data — nothing may be pinned to one field

**DONE.** `public/data` is the open Volve dataset, and any scenario it cannot show
is generated instead (§14.4). Demo data stays unmodified open data, so what a
reader sees is reproducible from the published source.

Getting there was not a file swap. Working against a second, deeper field had grown
four dependencies on *that* field's ids, names and origin, and every one of them
would have failed silently rather than loudly. All four are now derived instead of
written down:

| was | is |
| --- | --- |
| a 32-entry surface name → age table, hand-extracted | `STRAT_AGES` is generated into `story-args.json` by matching each surface name against the `top`/`base` horizons of the dataset's own strat column |
| the sea bed and the basement found by NAME in `SeabedConnection.spike` | both come from the dataset config by id; a field that maps no sea bed gets a **generated** one (`SYNTHETIC_SEABED_ID`), and "basement" falls back to the deepest surface in the stack |
| a checked-in field-outline polygon in WGS84 | `useFieldOutline` buffers the wellbore trajectories with `createWellboreOutline` (§11) — concave, multi-component, and correct for whichever field is loaded |
| a checked-in multi-component demo polygon in WGS84 | `demo-polygons.ts`, authored in metres about the field origin |

⭐ **The pattern is the point.** A coordinate written into the repository only means
anything against one CRS, and a name written into the repository only means anything
against one field's nomenclature. Both put the story in the wrong place — or empty —
the moment the dataset changes, and neither says so. Anything a story needs about
*this* field is either derived from the data at runtime or generated into
`story-args.json` at build time.

**The ordering dependency was the real design question.** The library contract is
that array order IS stratigraphic order and the *host* sorts (§9.3) — the stories
are a host, so they need ages for whichever field ships. Deriving them from the
strat column keeps the contract intact: the stories are still *told* the order,
they are just told it by the data rather than by a constant. The alternative of
sorting by measured median depth (`stackDepthStats`) was rejected on §10.1's
grounds — it infers the contract rather than being told it, and guessing an order is
worse than dropping a surface.

⚠️ `sortByStratAge` still **excludes** un-aged surfaces, which is what turns a
dataset change into an empty screen rather than a wrong one. It now reports that as
an error naming the surfaces, so the empty screen explains itself.

#### 14.5.2 ⭐ Colour comes from the strat column too (2026-08-16)

`Spikes/Chunks/FieldColumn` is the generated column's counterpart on REAL data: the
whole dataset's surfaces in one chunk, and the same generation step that derives the
ages now also emits `stratUnits` (horizon → the unit it is the top/base of, with
that unit's own colour) and `stratUnitColors`. Both are baked into `story-args.json`
at build time, so neither the strat column nor any colour becomes a runtime data
dependency — the library still never assigns a colour (§9.3).

⭐ **A colour belongs to the INTERVAL, not to the horizon.** What you see looking at
a layer is the top of the unit BELOW it, and that unit also fills the wall below —
which is why one colour serves as both `material` and `fill`. So the lookup is: the
unit this surface is the TOP of → failing that, the unit the NEXT surface down is
the BASE of (the same interval, named from its other end) → failing that, the PARENT
of the unit this surface is the base of, since the rock under a formation's base
still belongs to its group until the next formation starts → then a neutral grey.

⚠️ The column carries `unitType` and `level` but **no lithology**, so the procedural
`detail` presets cannot be derived from it. That mapping would be the host's too.

#### 14.5.1 ⭐ Binary `surface-values`

**IMPLEMENTED.** `surface-values` used to ship as JSON `number[]` and were parsed
lazily, one grid per surface, **serially in the single data worker** — ~260 ms per
field-scale grid, plus a transient parsed array at 8 bytes per sample before it was
converted to `Float32Array`. It is linear in the number of surfaces a scene claims,
so a many-surface stack paid it in full on a cold load (measured at ~12 s on a
36-surface field, against **18 ms warm**, where the loader cache turns a repeat
request into a `slice(0)` memcpy).

`scripts/transformations/transformSurfaceFiles.js` now emits `<surfaceId>.bin` —
raw little-endian float32, row-major, `-1` for nodata — and `surfaceValuesLoader`
fetches it with `getBinary` and caches the `ArrayBuffer` as-is. The parse is gone
entirely (`fetch` → `arrayBuffer()` → done), the transient array with it, and the
payload shrinks (Volve: 34 MB → 25 MB across 19 grids).

⚠️ A binary payload has no self-describing shape, so the grid dimensions come from
`surface-meta` (`SurfaceMeta.header`) and are never inferred from the buffer length.
The loader **checks** the two agree and fails loudly if they do not: a truncated or
stale file would otherwise render as plausible-looking garbage.

⭐ Position logs were considered and left as JSON: the whole set is 140 KB, fetched
once at store init, and parses in 3.4 ms. Their loader now caches an `ArrayBuffer`
rather than the parsed `number[]`, which is the same win at a thousandth of the
scale — half the memory, and a repeat `get` is a memcpy instead of a rebuild.

### 14.6 Story-scoped data — the story writes to the store

**PROPOSED, not implemented.** This is the preferred way for a story to obtain data
nobody else needs; it supersedes the per-story store considered alongside it.

Two limitations above are the same limitation: generation is eager because
`surfaceMetaLoader` enumerates the synthetic ids at store init, and the demo column
is constants rather than controls because a variant would have to be registered up
front. Both dissolve if a story can put data into the store as it mounts.

`Store` already has `set`, and `MockStore` implements it — `ReadonlyStore`, which is
what generators receive, deliberately does not. `DataLoader.set` writes into the same
`cached` map that `all`/`query` read, so an injected record is indistinguishable from
a preloaded one. Nothing new is needed to READ it.

#### Why not a store per story

The alternative was for each story to supply its own lightweight `Store`. It fails on
decorator order: the array is `[Canvas3d, GeneratorsProvider, DepthSelector,
DataProvider]` and the **last entry is outermost**, so `GeneratorsProvider` sits
INSIDE `DataProvider`. A story wrapping its own `<DataProvider>` around its content
is inside the generators provider, and the generators go on reading the decorator's
`MockStore`. The store would have to be supplied at or above the decorator — through
story `parameters` — meaning decorator plumbing, a `DataProvider` swap and a re-point
of the generator registry. Writing into the store that is already there needs none of
it, and keeps §14.2 true: one store, one memoization, one transfer path.

Keep it in reserve for a story needing genuine ISOLATION — a second realization under
a colliding id, or a store that must not see the real data.

#### ⭐ Ids must be content-addressed

The load-bearing part. Removing a record on unmount does **not** evict what was
derived from it: the `GeneratorRegistry` cache, the generator worker's own caches
(`getStackContext`, `refinedByKey`), or the module-level memo in
`synthetic-surfaces.ts`. If one id ever means two realizations, stale geometry is
served silently — the failure §10 is written to avoid, arriving through the fixture
instead.

Hash the spec into the id. A changed arg is then a NEW id, every cache misses
correctly, cross-story collision cannot happen, and removal on unmount drops from a
correctness requirement to memory hygiene. ⚠️ `Store` has no `delete`: a
storybook-only `MockStore.delete` is fine, widening the public interface for a
fixture is not.

#### ⭐ Inject the spec, not the values

Generation belongs in the store worker, where it already is. A story that generates
on the main thread and `set`s the result pays the full `nodes² × surfaces` block
(~235 ms) *and* a structured clone into the worker. Injecting a small spec record and
letting the loader generate from it on demand keeps both properties — lazy, and off
the main thread — for one data type and one loader.

#### ⚠️ Two things that will bite

- **The tree fetches before the data lands.** Effects run children-first, so
  everything under the story mounts and requests its data before the story's own
  populate effect resolves — and the null gets cached. The story must gate its
  children on the write having completed. This is the one thing a pre-populated
  per-story store got for free.
- **`MockStore.set` drops writes that race the preload.** `get`/`all`/`query` each
  `await this._initialized`; `set` does not — and `DataLoader.init` assigns
  `this.cached = new Map(result)`, REPLACING the map. A set landing before the
  preloads settle is discarded without a word. Add the `await` first.

Also: `MockStore.set` throws for a data type with no registered loader, so a new
synthetic data type is still one line in the `MockStore` constructor.

#### What it unblocks

`surfaceMetaLoader` stops enumerating synthetic ids, so no story pays for generated
data it does not use; the `COLUMN` constants can become story controls; and the chunk
spikes can move onto the generated column (§14.5, option 3) without the real dataset
having to carry them.

## 15. Sectioning — the cut face through a clipped stack

> **Status: BUILT** (2026-08-13), as one plane, any orientation, animatable, with a
> flip. The design below held up — §15.2's per-cell assembly and §15.3's "section the
> channels" are what shipped — so it is left as written, with what changed marked in
> place. §15.9 records the parts that are new. Fence sections, slabs and boxes
> (§15.8) are not built.

A clip plane through a stack should not reveal a hollow shell. The cut should read
as a **geological section**: each interval filled across the cut with the material
it is drawn with everywhere else. The plane must be usable at **any orientation**,
including animated.

### 15.1 The clip already works; the cut FACE is the whole problem

`ChunkMaterial` sets `clipping = true` and both chunk shaders include the clipping
chunks, so a plane cuts a stack today. Because chunk materials are `DoubleSide`
(§10.3.6), what is revealed is the inside of the walls and caps — a shell, which is
an honest picture of the geometry and a useless one of the geology.

⚠️ Superseded in practice: the built cut does NOT go through three's clipping
planes at all, for the reason §15.6 gives — they do not survive the OIT variants.
The stock `clipping = true` and the `clipping_planes_*` includes remain, unused by
this feature.

So the feature is not the clip. It is generating, per frame, the surface that
closes each interval where the plane passes through it.

### 15.2 ⭐ The cut face is assembled per PRISM CELL, not per ring

The obvious approach — cut each layer's mesh into polylines, chain them into rings,
triangulate the rings — is the one to avoid. Chaining is where this kind of code
fails: it needs a closed manifold, and §15.4 lists four reasons a chunk's drawn
meshes are not one.

Instead, take the unit of work to be a **cell**: the solid of one filled interval
over ONE triangle of the shared tessellation — exactly what `stackIntervalTriangles`
already enumerates.

⭐ **A cell is convex.** Its top and bottom are planar triangles (each layer is
linear over the triangle), and each of its three sides is planar too — over an XZ
edge both bounding heights are linear in the edge parameter, so the side lies in the
vertical plane through that edge. The cell is therefore the intersection of five
half-spaces. A plane cuts a convex solid in a convex polygon, here of at most five
vertices, obtained by intersecting the plane with the cell's nine edges and fanning
the result.

What that buys, in order:

- **Any orientation, same code.** The vertical-plane case — where every layer crosses
  the same XZ edges at the same points, so all layers share one parametrisation and
  the fill degenerates into a triangle strip — is a *simplification*, not a
  requirement. Nothing above assumes the plane is vertical.
- **No ring chaining, no polygon boolean, no CSG**, and so no robustness cliff. An
  interval that is open contributes the cells it has and nothing more.
- ⭐ **Watertight by construction.** Two adjacent cells share a face, and their cut
  polygons take that face's crossing from the same pair of vertex heights, so they
  meet on an identical edge. The same holds *between* intervals: the cut faces of
  interval `i` and `i+1` meet exactly along the section of the layer between them.
  There is no tolerance to tune.
- **It is small.** Only cells the plane passes through do any work — order the square
  root of the triangle count — each producing at most three triangles. ⚠️ Unmeasured;
  measure crossed-cell count on a real stack before committing to per-frame rebuild.

⚠️ **Two things the design did not say, and both are load-bearing.** See §15.9.1:
watertightness needs a CANONICAL edge orientation, and a cell the plane merely
GRAZES must be skipped rather than closed.

### 15.3 ⭐ Section the CHANNELS, not the drawn meshes

An interval's bounding heights exist for every layer over the whole footprint
regardless of **who draws the cap**. Reading the tessellation and the channels rather
than the emitted geometry therefore makes three hard-won complications irrelevant to
sectioning at a stroke: seam ownership (§10.8) decides who draws a horizon, not who
knows it; a void splits a layer into a ceiling and a floor (§10.7) that bound the
same cells; and a cap dropped by the collapse still bounds the volume below it.

What must still apply is the per-triangle drop rules — `makeAbsentTriangleTest`,
coverage, collapse, carrier — because a cell that is not drawn has no volume to show.
Applying them per cell is what makes the section agree with the block *by
construction*, terminations and sealed wedges included.

⭐ `inferred` (§10.6) interpolates onto the cut face for free, being a per-vertex
attribute on the same vertices. That matters more here than anywhere: a section is
the most convincing picture this library draws, and a cut through an invented wedge
must not read as data.

### 15.4 ⚠️ Why not stencil capping — and when it would win

Correcting the record: **stencil is available**. Three.js supports it; this pipeline
simply does not allocate it — `OITRenderPass` and `RenderingPipeline` build their
targets with `depthBuffer` only. Adding a stencil attachment is a legitimate opt-in
for the OIT pipeline.

It still loses for chunks, for reasons that are about the model rather than the
buffer:

1. **OIT is opt-in**, so sectioning must work under a plain `RenderPass` too. That is
   the stencil path built twice — and in the OIT case, inside all four passes.
2. Roughly three extra draws per interval per frame, before OIT multiplies them.
3. ⚠️ It needs a **closed manifold per volume**, and the drawn meshes are not one: a
   lid may belong to a sibling chunk (§10.8), a cap may be dropped by the collapse, a
   void deliberately leaves an interval open (§10.7), and an unfilled interval is an
   open gap by design (§2.3). Stencil parity fails exactly at those four places —
   silently, as a flood fill.

Rendering each interval's *bounds* instead of its drawn meshes fixes 3, but that is
extra geometry — which is what §15.2 already produces, more cheaply and exactly.

⇒ Keep stencil in mind for **geometry the library does not own** (host meshes,
third-party layers), where there is nothing to section from. It is not the chunk
answer.

The third option, a **layer-cake shader on a plane quad** (per fragment, binary-search
the resolved channels for the interval containing `y`), is rejected for four reasons:
it samples the grid rather than the TIN, so it disagrees with the block by up to
`maxError` at the silhouette; it would have to re-implement per-vertex and
per-triangle drop rules as per-node ones, which §10.7 records as *not
interchangeable*; one quad carrying many layers' opacities sorts wrongly under OIT;
and it cannot represent a fluid at all.

### 15.5 ⚠️ A fluid is not a prism cell (§6)

A water body breaks the one assumption §15.2 rests on. Its lid does not come from the
shared tessellation — `createPolygonCap` triangulates the outline on its own terms
(§6.2) — so the cells of the water interval are bounded above and below by **two
different triangulations**, and they are not prisms.

Two ways out, neither expensive: overlay the two triangulations along the plane, or —
since the lid is a height field over the same outline — sample the lid at the sea
bed's crossing points and keep the sea bed's cells. The second is exact to within the
lid's own linear interpolation and needs no new machinery.

⚠️⚠️ **The bigger problem is displacement.** The sea surface is displaced in the
VERTEX shader (§6.3), so a CPU section cuts the *still* lid and the drawn water
surface will not meet it. Three responses, in increasing cost: fill the water body to
the still-water level and accept that a section does not show the waves (which is
what a section conventionally draws anyway, and the recommended default); displace
the cut face's top edge in its own vertex shader with the same wave function; or
evaluate the field on the CPU — ⚠️ note the chunk path has no sampler, which is the
open item at the end of §6.

### 15.6 The clip is a UNIFORM, not `material.clippingPlanes`

⚠️ **Three.js clipping planes do not survive the OIT variants.** `buildVariant` does
`v.copy(base)`, and `Material.copy` **deep-clones** every `Plane` — so the four
per-pass variants snapshot the plane at build time. A rotating plane would animate
under a plain `RenderPass` and **freeze** under `OITRenderPass`: a path disagreement
that only shows when the plane moves.

A plane carried as a **uniform** has none of that. `ShaderMaterial` variants share the
base `uniforms` object by reference — the same mechanism that already keeps opacity
live — so the value propagates to every pass for free. It also feeds the section
builder from the same source, and it generalises to a slab, a box or several planes
without inheriting `clipIntersection`'s all-or-nothing semantics.

Three.js clipping keeps one advantage worth using alongside it: `renderer
.clippingPlanes` is applied globally by the renderer, so wellbores, annotations
anchors and host meshes are clipped without touching their shaders. The likely answer
is **both** — global renderer clipping for the scene, a uniform on chunk materials for
what must stay live and drive the section.

⚠️ The cut face lies *in* the plane, so it clips itself. Exclude it from the clip, or
offset it along the normal by an epsilon — at field scale, and with the log depth
buffer, an epsilon that survives depth precision is still well under a metre.

⚠️ GPU picking has its own shader (`pick_vertex.glsl` includes the clipping chunks)
and needs the same plane, or the pointer hits geometry that is not drawn. Global
renderer clipping covers this; a uniform does not.

### 15.7 Where it sits

**Sectioning is layer 3** (§3), and this is the load-bearing constraint: moving the
plane must never reach the worker. It reads the tessellation and channels the build
already produced, and rebuilds only its own small geometry.

⚠️ At 60 fps that geometry is rebuilt every frame, so preallocate the buffers and move
`drawRange` rather than allocating a `BufferGeometry` per frame — otherwise a rotating
plane is a GC generator.

Other consequences:

- Cut faces are ordinary meshes drawn with the same `ChunkMaterial` instances, so they
  work identically **with and without OIT** — which stencil would not.
- Per-layer `opacity` (§10.3.6) carries onto the cut face unchanged.
- **Vertical exaggeration** (§12.4): define the plane in the stack's local space and
  transform it by `matrixWorld`, or the cut drifts as `k` changes.
- A section is the natural anchor for unit **labels** — the annotation system already
  does the positioning.

### 15.8 Open

1. **Fence sections.** The same cells cut by a *swept* surface rather than a plane
   gives a section along a polyline — or along a wellbore path, which is the more
   valuable subsurface product. A cell is convex; a swept quad is not a half-space, so
   this needs per-segment planes rather than one.
2. **Clip volumes.** Several planes, a slab, a box; and whether the cut faces of
   different planes need to meet each other (they do at a box corner).
3. ~~**Component shape.**~~ **Settled:** the plane is declared on the
   `ChunkStack` and each chunk builds its own cut faces — the plane is one
   decision, the geometry is per chunk.
4. **Which side is kept** — built (`plane.negate()`). Whether the discarded side
   should remain **pickable** is still open, and today it does: see §15.9.4.
5. Whether a fluid should be sectioned at all (§15.5).

### 15.9 What was built (2026-08-13)

`ChunkStackProps.section` takes a `ChunkSection`: a `Plane`, `enabled`, and an
`offset`. Everything else follows from two decisions.

**⭐ The plane is a UNIFORM and the cut face is CPU geometry, driven from the same
object.** `ChunkMaterial` gains a `CHUNK_SECTION` define and one `vec4` uniform;
`chunk-frag.glsl` discards at the very TOP of `main`, before the OIT passes take
their early exits, so a cut fragment is gone in the min-depth and occlusion passes
too — otherwise the block would go on occluding through a cut it is not drawn in.

**⭐ Object space, not world** (§15.7's warning, answered the other way round): the
shader tests the raw `position` attribute rather than the world position, so the
CPU — which builds the face from the same vertex data — and the GPU cannot disagree
under a vertical exaggeration. No `matrixWorld` is involved anywhere.

#### 15.9.1 Two things §15.2 did not say

Both are the difference between "watertight by construction" as a claim and as a
fact:

- ⭐⭐ **The crossing on an edge must be computed in a CANONICAL direction.** Two
  triangles sharing an XZ edge list its endpoints in opposite corner order, and
  `p0 + s·(p1 − p0)` is not the same float read the other way round — so the two
  cells' faces part by an ulp along every shared edge. Edges are therefore ordered
  by `(layer, vertex index)`, which both cells agree on. The same ordering is what
  makes interval *i*'s base and interval *i+1*'s top land on identical points,
  since that boundary is one layer's heights read twice.
- ⚠️ **A cell the plane merely GRAZES must be skipped.** Treating `d == 0` as "cut
  away" (which is what removes the doubled vertex when a plane passes exactly
  through a corner) also means a plane *touching* a cell classifies corners as
  removed while removing no volume. Closing that emits a zero-area polygon whose
  vertices are all coincident. A cell is cut only when some corner is *strictly*
  removed.

#### 15.9.2 The channels have to be asked for

§15.3 is right that the section must read the channels — and the channels do not
leave the worker. `SurfaceStackOptions.section` makes the build emit a
`StackSectionSource` (shared XZ, the shared index, per-layer heights, per-interval
triangle masks, the `inferred` weights), which `packSurfaceChunk` transfers.

- **Opt-in**, requested by the PRESENCE of a section on the stack rather than by
  `enabled`: it is part of the build, so following the toggle would rebuild the
  geometry every time the section was switched on or off. Nobody who is not
  sectioning pays anything.
- ⭐ Most of it is **already being transferred**. The shared triangle index is the
  same `ArrayBuffer` the layer geometries use, and so is each layer's `inferred`
  attribute — the transfer list is deduped either way (a repeated buffer is a
  `DataCloneError`), so the real addition is the heights and the masks.
- ⚠️ The intervals are numbered in **BUILD** indices and everything the caller
  declared is numbered in **theirs** — a void split makes two layers of one, and the
  carrier is appended past the caller's last. `StackSectionSource.layers` carries
  the mapping, filled in by `assembleChunk`, which is where the two index spaces
  meet. Without it a cut face silently takes the wrong unit's colour.

#### 15.9.3 Nothing here may re-render

`useChunkSection` preallocates one `BufferGeometry` per filled interval and rebuilds
into it from a `useFrame`, moving `drawRange` and growing by doubling only when a
cell count demands it. `sectionStackInterval` returns what it NEEDS rather than
throwing away work: over capacity it writes nothing, reports the requirement, and
the caller grows and re-runs.

⭐ The plane travels as a **shared uniform object**, one per stack, handed to every
material the stack draws with — the chunks', the inference overlay's and the sea's.
A `ShaderMaterial`'s OIT variants share their `uniforms` by reference, so moving the
plane is a single write per frame that reaches every material in all four passes —
no React render, no material rebuild. `Material.copy` deep-clones a `Plane`, which
is exactly why `material.clippingPlanes` could not do this (§15.6).

⚠️⚠️ **Every mesh the stack draws needs telling separately**, and forgetting one is
not subtle. The inference overlay (§10.6) is a SECOND mesh over the same geometry,
drawn with its own material — so before it was given the uniform, the hatching went
on drawing in the half that had been cut away, hanging in the air where the block
used to be. It is a `MeshBasicMaterial` rather than a `ShaderMaterial`, so its
variants are CLONED; the uniform is therefore bound inside `onBeforeCompile` (which
`makeOitCompatible` re-links onto each clone) rather than on the material, and
`customProgramCacheKey` has to say whether the branch is compiled in or two overlays
would silently share one program.

⚠️ **What the stack publishes is not the prop.** `section={{ plane, enabled }}` is a
new object every render, and `ChunkStackContext`'s identity is what every chunk's
build spec derives from — so publishing it directly would rebuild every chunk on any
parent render. The stack publishes a **stable** `ChunkSectionState` it refreshes from
the props once per frame; nothing in it is read during React rendering. The one
exception is `carrier`, which decides how a material is BUILT and so has to be
visible to React — it is published as a primitive, which cannot churn an identity.

⚠️ The `offset` moves the face toward the **kept** side (`−normal`), not along the
normal. The face lies exactly in the plane, so along the normal it moves into the
half-space that is discarded.

#### 15.9.4 What it cuts, and what it does not

**What the STACK draws** — the chunks, and the sea unless told otherwise. Both are
opt-out:

- `ChunkSection.water` (default on) puts the same shared uniform into
  `OceanMaterial` and `OceanVolumeMaterial`. ⚠️ The water gets no cut FACE — it
  simply ends at the plane, so you look into an open water body. Off is what to use
  when the cut is only meant to expose the geology. Sectioning the water body
  properly is still §15.5, and still out of scope.
- `ChunkSection.carrier` (default on) cuts the column's floor with the rest. Off
  leaves the block standing on an intact base plate.

⚠️ Both are DEFINES, so toggling either rebuilds the materials concerned. That is
the right trade: a plane MOVES continuously and must never rebuild anything, but
whether the sea is cut at all is a discrete choice.

⚠️⚠️ **Nothing else is cut**, and that is the deliberate scope (2026-08-13):
wellbores, vessels, facilities, pipelines, annotations and host meshes all keep
drawing whole, because the cut is a branch in the stack's own shaders rather than
`renderer.clippingPlanes`. So an object resting on the sea bed stays put while the
ground under it is cut away.

Two gaps remain, recorded rather than worked around:

- **GPU picking is not cut.** The pick material is a separate shader, so the pointer
  still hits chunk geometry that has been clipped away. One uniform away from being
  fixed, and the reason to hold off is that "should the discarded side stay
  pickable?" is a real question (§15.8.4), not an oversight.
- **A caller-supplied `Material` is not cut**, since the chunk cannot patch one.
  The same class of limitation as procedural detail and the inference marking.

#### 15.9.5 The camera as the handle

`ChunkSection.cameraDistance` locks the plane that many metres in front of the
camera, facing it, so everything nearer is cut away. `ChunkSection.lockToTarget`
locks it to the camera TARGET instead (below).

⭐ **This replaced a drag gizmo, and is better than one.** Orbiting chooses the
angle and dollying drives the cut through the block, so there is no widget to hit,
no pointer handling to reconcile with the GPU picking, and no third interaction
model to learn. It also cannot get lost off-screen, which a plane handle in a 7 km
scene readily does.

⭐ **`vertical` defaults to ON**, so the plane takes the camera's heading and
position but never its dip. A section is conventionally drawn on a vertical plane,
and a cut that tilts with the camera makes the block appear to SHEAR as you orbit —
which is precisely when the geology stops being readable, so the literal
view-aligned cut is an effect rather than a tool. ⚠️ With it on, `cameraDistance` is
a HORIZONTAL distance, measured in plan. ⚠️ Looking straight down leaves no heading
in the view direction; what is "up" on screen is horizontal there, and taking the
bearing from it is what stops the plane snapping as the view passes through
vertical.

The plane is built in WORLD space (from the camera) and transformed into the stack's
frame with the inverse of a root `<group>`'s `matrixWorld` — which is why the stack
now renders one. That group is the answer to §15.7's vertical-exaggeration warning:
the two frames are identical until a stack is scaled, and then they are not.

⭐ **`lockToTarget` anchors the same plane on the camera TARGET** instead of a
distance in front of the eye. The orientation still comes from the camera, so
orbiting swings the cut exactly as before, but dollying no longer moves it — which
is what `cameraDistance` cannot do: there, coming in for a close look at the cut
face pushes the cut ahead of you and through the block. It also makes a fly-to land
the cut ON the point flown to, since that point is what the controls are targeting.
`vertical` behaves identically — the heading is flattened before it is dotted with
the anchor, so the plane stands vertically on the pivot — and `cameraDistance` is
ignored, the pivot being the position. ⚠️ The target is read from the default camera
controls (`state.controls`, via `getTarget` or `target`), so it needs controls with
`makeDefault`; without a readable target it falls back to `cameraDistance` in front
of the eye, silently, because a section that vanishes is a worse answer than one
that behaves like the mode next door.

⚠️ `plane` is ignored while this is set, but the resulting plane is still published
on `ChunkSectionState`, so the cut face, the shader and the debug view all read the
same one.

#### 15.9.6 Seeing where the plane is

`ChunkSection.debug` draws the plane's outline through the stack's bounds plus a
cross at its centre, on `LAYERS.OVERLAY` (so it survives a translucent stack) and
`LAYERS.NOT_EMITTER` (so a debug aid can never take a pointer hit off the geology).

⭐ The outline is traced against the BOX rather than drawn as an arbitrary quad, so
it shows exactly where the cut meets the block — which is the question being asked.
`sectionPlaneOutline` is the same convex-polygon-from-edges trick as the cut face,
against twelve edges instead of nine, and it is at most a hexagon. ⚠️ Only for a
CUBIC box: a 200×100×400 box cut on its body diagonal gives a quad, which is correct
and caught a wrong test expectation.

#### 15.9.7 Not yet measured

⚠️ §15.2's cost argument ("order the square root of the triangle count") is still
reasoned rather than measured, and §11.1 is the standing reminder of what that is
worth. The crossed-cell count and the per-frame cost on a real stack should be
measured through `Spikes/Chunks/SyntheticColumn` (the `Section` control group, with
`sectionAnimate` driving a continuously tumbling plane — the worst case, since
nothing can be cached between frames).

### 15.10 Keeping a unit whole (2026-08-14)

`ChunkLayer.section: false` exempts one unit from the cut, so it stands proud of
the section as a slab — how you single out a reservoir, a seal or the sea bed. The
mechanism was already there: `ChunkSection.carrier` is the same thing with a
hard-coded scope, and a material simply built without the shared uniform is not cut.

⭐⭐ **The flag is per UNIT, and it has to be.** A unit is bounded by TWO caps, so
exempting one *surface* leaves a lid over open space where its base was cut away —
the hollow shell §15.1 says the whole feature exists to avoid. The floor is
therefore **inferred**:

> a cap is left uncut when the unit ABOVE it or the unit BELOW it is kept.

One rule, and everything falls out of it: keeping two adjacent units keeps the cap
between them exactly once; keeping the deepest unit keeps the column's floor with
it (OR'd with the explicit `ChunkSection.carrier` rather than overriding it, so the
two cannot fight); and a void's ceiling, which is the base of the interval above,
follows that unit rather than its own layer index.

⚠️ **No cut face is built for a kept unit** (`useChunkSection` skips it). There is
nothing to close, and a face there would sit *inside* solid material.

⚠️ **The inference overlay is keyed on cut-ness too.** It is a second mesh with its
own material, so a kept unit whose marking was still cut would lose its hatching at
the plane while the rock stayed — the same class of bug as §15.9.3, in a new place.
Its cache is now keyed on `(opacity, cut)`.

### 15.11 Peeling (§10.3.6) — built

`ChunkProps.peel` hides the first *N* units. It is the same structural fact as
§15.10 read in the other direction: a unit's cap and its volume go together, and
the cap of the first SURVIVOR stays, because that cap is its own top rather than
the peeled unit's base. So the block cannot be opened by peeling — the floor was
never yours to drop.

⭐ **Exact and free, which transparency is not.** Alpha compounds: a 20-layer stack
at 0.5 is effectively opaque, so an opacity slider cannot answer "what is
underneath". The layer array IS the depth order (§9.3), so not drawing a PREFIX of
it is exact. That is also why it is a COUNT and not a per-layer visibility flag —
an arbitrary set can open the block, a prefix cannot.

Pure appearance: no spec change, no rebuild, so it is free to sweep or animate.

⚠️ **One case does open the block, and it is not local.** A horizon shared with a
sibling chunk is drawn by only one of them (§10.8), so peeling down to a cap this
chunk does not draw exposes a top that is simply not there. It presents as a
rendering artefact rather than as a consequence of the peel, so `Chunk` warns
instead of leaving it to be discovered.

⭐ It composes with §15.10 and with the section: peel to a unit, keep it whole, and
cut everything else — which is the "one unit in context" view, without a single
opacity anywhere.

### 15.12 Restoring what the collapse dropped (2026-08-14)

⚠️⚠️ **Both §15.10 and §15.11 punch holes in the exposed cap**, and §9.8 says why
one step removed:

> Dropping a zero-thickness fragment is safe *within* a chunk: layer *i* is only
> dropped where it is coincident with layer *i−1*, **which the same chunk draws**,
> so something is always there to see.

Peeling deletes that layer. Sectioning deletes half of it. Either way the cover the
drop was justified by is gone, and the fragment becomes a hole — along a
termination line, so it reads as a clean band and looks like a bug rather than like
a consequence.

⭐ **The rule generalises exactly.** Of the four reasons a cap triangle is dropped,
two name a layer ABOVE and two do not:

| drop | names a layer above? | survives the cover being removed? |
| --- | --- | --- |
| welded onto the layer above | yes | ❌ |
| truncated (clamped onto a shallower layer) | yes | ❌ |
| coverage — no data | no | ✅ |
| seam exclusion, void ceiling, carrier floor | no | ✅ |

So `StackCollapseOptions.peelable` emits a second index set per layer with the
first two tests skipped — the cap *as it would be if nothing above it were drawn*.
`null` where that is the same set, which is most layers; measured on the generated
column only two carry one (Draupne, 1555 triangles, and the unconformity's 23).

It travels as `SurfaceChunkMesh.peelIndex` — **an index and nothing more**, since
the patch shares the cap's positions, uv, normals and `inferred`.

⭐ The restored fragments are already in the right place: a truncated layer's
heights were clamped ONTO the layer above, and a welded one is coincident with it,
so the patch fills the hole at exactly the right elevation. What it draws is the
unit's subcrop, which is what a peeled-back view should show.

#### 15.12.1 ⭐⭐ The section case needs the INVERSE plane

Peeling removes the cover everywhere, so the patch is simply drawn with no plane.
A section removes it only on one side — the cap may be kept whole (§15.10) while
the layer above it is cut — so the patch must appear *exactly* where that layer
vacated and nowhere else.

That is the **negated plane**, and it is exact rather than approximate: the patch
and the covering layer test the same value with opposite signs, so they are
mutually exclusive by construction with no tolerance to tune. `ChunkStack`
publishes it as a second shared uniform alongside the first.

⭐ Negating the DISABLED value falls out correctly too: `(0,0,0,-1)` removes
nothing, and its negation `(0,0,0,1)` draws nothing — which is exactly right when
nothing has been cut away.

⚠️ Both are drawn at exactly `d == 0`, so there is a one-fragment seam where they
meet. Invisible in practice; recorded rather than papered over.

⚠️⚠️ **The patch shaded BLACK on the first attempt**, and the cause is worth
knowing because the symptom points nowhere near it: `computeVertexNormals` only
touches vertices its INDEX references, so a vertex used only by triangles the
collapse dropped keeps a zero normal — which Blinn-Phong renders black. Normals are
therefore accumulated over the WIDEST index (`peelIndex ?? own`) and the cap's own
index swapped in afterwards. ⚠️ And because `computeUpwardNormals` reverses the
winding IN PLACE when the normals face down, and only holds one of the two arrays,
the cap's index is flipped to match when that happens.

⚠️ The patch is not counted in `triangles` / `droppedCollapsed`. Those describe the
normal set and are left meaning what they say.

⚠️ A caller-supplied `Material` gets no patch, since the chunk cannot build a
variant of it — the same limitation as the cut itself.

### 15.13 Making a moving section affordable (2026-08-16)

The cut is rebuilt every frame from the live plane, and the first version walked
**every triangle of the shared tessellation, for every filled interval**. On the
demo field's full column that is 33 × 1,078,569 ≈ **35.6 M prism expansions per
frame**, on the main thread.

⚠️⚠️ Worth stating plainly, because the symptom invites the wrong diagnosis: this
is **not** a GPU cost. The 30 M-triangle block genuinely is heavy to raster, but
the section stall is a JavaScript loop, and no graphics card touches it.

Two fixes, both output-preserving:

**1. Do nothing when nothing moved.** `useChunkSection` caches the last
normal/constant/`enabled`/`offset` and skips the rebuild. A fixed plane, or a
camera-locked one with the camera at rest, then costs nothing at all.
⚠️ The cache also compares the FACES' identity — without that a chunk that
rebuilds keeps the stale entry and never draws its new face.

**2. `buildStackSectionIndex` — skip what the plane cannot reach.** A uniform XZ
grid over the shared triangles (CSR buckets, ~64 triangles per cell) plus, per
interval, each cell's prism Y range. A cell is rejected with the standard box/plane
test, `|n·c + k| ≤ |n_x|e_x + |n_y|e_y + |n_z|e_z`.

- ⭐ That test is **orientation-independent**, so a tilted cut prunes as well as an
  upright one. No second structure is needed for oblique planes.
- ⭐ The per-cell **Y range** is what makes a near-HORIZONTAL cut cheap. An XZ grid
  alone prunes nothing for one, since a horizontal plane covers everything in plan;
  with the Y range only the cells whose interval spans the cut depth survive. Where
  a flat-lying unit really does straddle the cut everywhere the whole layer is
  visited — but then the face IS the whole layer, so the cost equals the output,
  which is the best any structure can manage.
- ⭐ **ONE index serves every interval.** They share the tessellation's topology and
  XZ positions and differ only in height, so the heavy triangle buckets are built
  once and each interval adds two floats per cell. Per-interval triangle lists would
  cost tens of megabytes on a field-sized stack.
- ⚠️ A triangle is bucketed by its **centroid**, into exactly one cell, and the
  cell's box is grown to contain it. Bucketing by overlap would emit a triangle once
  per cell it touches.
- ⚠️ The face comes out in a different ORDER (cell by cell rather than by index).
  That is irrelevant to a triangle soup, and watertightness is unaffected: it comes
  from evaluating each edge in a canonical direction *within* a cell (§15.2), which
  is a property of the triangle, not of the visit order.

MEASURED (`FieldColumn`, 7 km crop, all 34 layers, animated plane): **250.3 ms** per
frame without the index → **31.1 ms** with it (~8×); a still section **16.7 ms**,
which is exactly what the same block costs with the section switched off.

⚠️ A test plane must be kept OFF the vertex lattice. A plane landing exactly on a
column of grid vertices only GRAZES, which the cut deliberately reports as no face
(§15.2) — an equivalence test written on a round coordinate compares two empty
faces and proves nothing.

## 16. Build cost: what scales with what (measured 2026-08-15/16)

### 16.1 The phases, and the two things they scale with

Every phase is now timed and reported on `SurfaceChunkDiagnostics` (`fetchMs`,
`referenceMs`, `sealMs`, `stackResolveMs`, `refineMs`, `prepMs`, `tessellateMs`,
`sampleMs`, `vertexResolveMs`, `collapseMs`, `geometryMs`, `wallMs`), which is what
makes the following legible at all. Most of them were already computed and thrown
away.

They divide cleanly in two:

| scales with | phases |
|---|---|
| the reference grid's NODES × layers | fetch, resample, seal, grid resolve, refinement |
| the shared tessellation's VERTICES × layers | sample, vertex resolve, collapse, geometry, walls |

MEASURED on the demo field's full column (34 layers, survey-rectangle outline,
1,682,681 nodes, 112.5 s): ~22 s in the first group, ~78 s in the second, 13 s
tessellating and 19 s packing and committing. ⇒ **the vertex count is the lever**,
and `vertices` / `sharedTriangles` are reported for exactly that reason.

### 16.2 Size, not layer count

Compared like for like against the generated column (§14.4):

| | generated | demo field, full |
|---|---|---|
| layers | 11 | 34 |
| triangles per layer | 36,184 | 1,078,569 |
| total | 399,766 | 30,058,596 |
| build | 5.5 s | 112.5 s |

75× = 3.1 (layers) × 29.8 (tessellation). ⭐ **The tessellation dominates by an
order of magnitude**, and most of that is plain AREA — 49 km² against ~1050 km² at
the same 25 m cell, i.e. 21× the nodes. The remaining ~1.4× is detail density: real
relief, data edges, and 33 INDEPENDENT surveys whose refinement sets do not overlap
the way generated surfaces do (those are exact functions of one another, so they
want the same vertices).

⇒ A field-scale footprint (20-80 km²) is nowhere near this. The number to watch is
`referenceNodes`, not the surface count.

### 16.3 `maxNodes` is the quality/speed dial

`ChunkResolveOptions.maxNodes` (default 4,000,000) caps the common grid; beyond it
the grid is decimated by an integer step. Since essentially everything is linear in
the node count, halving the budget quarters the work.

⚠️ What it costs is resolution of the **coverage masks** — data edges, interior
holes, pinch-out contours — rather than of the heights, which stay bounded by
`maxError` either way. `referenceStep` above 1 says the trade is active.

⚠️ It is part of the shared column's cache key, so changing it rebuilds every chunk.

### 16.4 What was optimised (2026-08-15/16)

1. **The candidate union is filtered to the chunk's own footprint** before
   insertion. Candidates are collected over the whole COLUMN, so a chunk with a
   small outline was being handed the entire field's detail. ⭐ Sound because the
   rim is a CONSTRAINT edge and a flip never crosses one: a point outside it takes
   part in no triangle that survives `removeExteriorTriangles`.
   ⚠️ The test is **dilated by one cell**. Un-dilated it drops nodes lying exactly
   ON the rim — which are vertices of kept triangles, and which the even-odd test is
   free to call outside — and the triangle count moves (241,088 → 240,936).
   MEASURED: per-chunk tessellation −30 to −63 % on wellbore-cut chunks, and it
   removed an inversion where a 31 k-triangle chunk cost more than a 241 k one.
2. **`rasterizeStackOutline` only tests the polygon's own grid window.** It was
   running point-in-polygon over all 1.68 M nodes for a chunk occupying a corner.
3. **Fetch and resample are pipelined.** ⭐ The common grid is derivable from the
   layers' HEADERS alone (`planStackReference`), which the spec already carries — so
   each layer is resampled the moment its own grid lands instead of after the
   slowest one. ⚠️ `fetchMs` and `referenceMs` are therefore OVERLAPPING windows and
   do not sum.
4. **The resample runs on the worker pool** (`resampleStackLayer`, a new `resample`
   task beside `refine`). Samples are transferred IN and never come back — nothing
   downstream asks a layer for its grid, only for its placement.
   ⚠️ This forced the pure grid maths out of `surface-clip.ts` (which imports three)
   into `surface-grid.ts`, and the resample into `surface-stack-resample.ts`. **Both
   must stay three-free**: the pool worker ships base64-inlined in the library
   bundle, so a three import there would embed a second copy of it.
   MEASURED: `referenceMs` 1107 → **94 ms** on a 9-layer column.

Together, 1-4 took a representative three-chunk scene from 11.6 s to 9.1 s wall,
with byte-identical triangle counts and `constraintFailures` 0.

### 16.5 Still open

- `vertexResolveMs` is the single biggest phase on a sealed column (28 s of 112 s),
  and it runs ONLY because sealing disqualifies the column's grid-level
  `preResolved` masks. That disqualification is correct (§10.7: a decision taken at
  grid NODES and one taken at shared VERTICES are not interchangeable), but the work
  is duplicated in spirit and a cheaper reconciliation may exist.
- A layer is sampled, resolved and collapsed at the FULL shared size and only then
  dropped, so a unit keeping 13 % of its triangles cost the same as one keeping all
  of them. The per-layer `kept` share is reported so the waste is visible.
- 30 M triangles is ~580 MB of vertex data across 34 geometries. Even with an
  instant build, that scene is past interactive; some form of LOD (§7) is the
  answer, not more micro-optimisation.

