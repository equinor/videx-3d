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

## 9. Open decisions

1. **Outline strategies** — expect several (polygon, wellbore distance-field, convex
   / concave hull, corridor buffer). Pluggable interface, not a fixed algorithm.
2. **Inherit vs own vs shared outline** — API for per-chunk telescoping vs a coherent
   shared footprint.
3. **Component pattern** — context + declarative children (preferred) vs render-prop
   (Wells precedent); possibly both.
4. **SurfaceRegistry** — whether a surface built once can be reused as the base of one
   chunk and the top of the next (dedupe + guaranteed seams).

## 10. Build order

1. **Component skeleton** (settled): `ChunkStack` provider + `Chunk` /
   `OceanChunk` / `BasementChunk` wrapping the existing SDK builder (still main-thread
   at first), with the three-layer separation in place.
2. **Outline SDK helpers** (in flux): trajectory-vs-surface crossings → clustering →
   distance field → contour, with per-chunk options. **— done (2026-07-12):**
   `createSurfaceOutline` (surface rim) and the `createWellboreOutline` pipeline
   (`collectTrajectoryPoints` → `clusterPoints2D` → distance field →
   `marchingSquares`), wired through the `CutoutSource` on `ChunkStack`/`Chunk`.
3. **Worker generator** for chunk geometry (async).
4. **Interactions**: focus-well (outline cut + peel), picking, annotations, buoyancy
   children on `OceanChunk`.
