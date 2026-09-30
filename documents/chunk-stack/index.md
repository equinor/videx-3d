# The chunk stack

A **chunk stack** draws a block of subsurface geology: a run of depth surfaces
clipped to a shared footprint, with the volume between them filled in, walls
around the sides, a floor underneath, water on top, and a knife through it if you
want to look inside.

This folder is the developer documentation for that component family — what the
pieces are, why they are shaped the way they are, and what happens between a
`<Chunk layers={...} />` in JSX and triangles on the screen.

> `documents/chunks.md` is a different document: it is the working design log for
> this feature, written as decisions were taken, and it contains superseded
> sections. Where the two disagree, this folder is the current one.

---

## The 60-second model

```tsx
<UtmArea origin={origin} utmZone={utmZone}>
  <ChunkStack outline={fieldPolygon} surfaces={column} carrier={{ below: 800 }}>
    <Chunk
      layers={[
        { surface: seabed, fill: '#c2b280' },  // sand down to the next boundary
        { surface: topReservoir, fill: true }, // "same colour as my own cap"
        { surface: baseReservoir },            // a bare boundary — no volume below
      ]}
    />
  </ChunkStack>
</UtmArea>
```

Five ideas carry the whole design:

1. **A chunk is a run of BOUNDARIES, not a list of solids.** Each `ChunkLayer` is
   one surface. The volume *below* it exists only because you asked for it with
   `fill`. A zone, a gap between zones and a bare sheet are then all the same
   concept with different flags — see [model.md](./model.md).
2. **The array order IS the stratigraphic order.** Nothing infers it. Sorting by
   `SurfaceMeta.min`/`.max` misorders a real column, and the depth-order resolve
   will dutifully make *any* order self-consistent, so a wrong order produces a
   plausible-looking lie. The build reports crossing counts so you can see it.
3. **One tessellation for the whole stack.** Every layer of a chunk shares the
   same triangles in plan, differing only in height. That is what makes
   interpenetration impossible rather than merely unlikely — see
   [build-pipeline.md](./build-pipeline.md).
4. **Three reactive layers.** Outline, geometry and appearance are kept strictly
   apart, so changing a colour or an opacity never rebuilds geometry — see
   [architecture.md](./architecture.md).
5. **The stack owns everything shared.** The column, its resolved depth order, the
   floor, the sea, the cut plane and who draws a horizon two chunks share all live
   on `ChunkStack`, because a chunk cannot see its siblings — see
   [coordination.md](./coordination.md).

---

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 1 | [model.md](./model.md) | What a layer, an interval, a column, a carrier and a fluid *are*. Read this first. |
| 2 | [architecture.md](./architecture.md) | Component tree, contexts, the three reactive layers, and what makes something rebuild. |
| 3 | [build-pipeline.md](./build-pipeline.md) | Spec → worker → grid → tessellation → geometry, stage by stage. |
| 4 | [coordination.md](./coordination.md) | How sibling chunks agree: claims, outlines, seams, gates, progress. |
| 5 | [outlines.md](./outlines.md) | Cut sources, wellbore-derived footprints, coverage and trimming. |
| 6 | [appearance.md](./appearance.md) | Materials, procedural detail, inference marking, ownership and disposal. |
| 7 | [cutting-and-water.md](./cutting-and-water.md) | Sections, fences, peeling, the sea, contacts, immersion fog. |
| 8 | [sampling-and-perf.md](./sampling-and-perf.md) | Placing objects on what was drawn; cost model, budgets, diagnostics, troubleshooting. |

---

## Where the code lives

### Components — `src/components/Chunks/`

| File | Role |
|------|------|
| `ChunkStack.tsx` | The provider. Owns the column, the sea, the carrier, the cut, the registries. |
| `Chunk.tsx` | One block. Resolves an outline, assembles a build spec, drives the generator. |
| `ChunkMeshes.tsx` | Presentational. Turns a built chunk + layer declarations into meshes and materials. |
| `ChunkContext.ts` | `ChunkStackContextValue` — everything the stack publishes downward. |
| `chunk-defs.ts` | The public type surface: `ChunkLayer`, `ChunkResolveOptions`, `ChunkSection`, `ChunkFence`, `StackWater`, generator keys, defaults. |
| `chunk-spec.ts` | Pure main-thread spec builders (`buildSurfaceChunkSpec`, `stackColumnSpec`, `buildStackWaterSpec`). |
| `cutout.ts` | `CutoutSource` / `ChunkOutline` and the per-chunk override merge. |
| `resolveWellboreOutline.ts` | Trajectories → footprint polygon. |
| `chunk-outline-registry.ts` | Pure claim/outline bookkeeping (unit-tested). |
| `seams.ts` | `resolveSeam` — who draws a horizon two chunks share. |
| `chunk-material.ts` | `ChunkMaterial`, the Blinn-Phong shader material everything is drawn with. |
| `chunk-detail.ts` | Procedural detail presets (`sand`, `shale`, …). |
| `inference-material.ts` | Overlay marking invented geometry. |
| `chunk-contacts.ts`, `chunk-depth-map.ts` | Fluid contacts as lines, and depth grids as textures. |
| `useChunkSection.ts`, `useChunkFenceFace.ts` | Cut-face geometry per interval. |
| `useStackFence.ts`, `useStackWater.ts`, `useStackBathymetry.ts` | Stack-level fence, sea and bathymetry. |
| `useImmersionFog.ts`, `StackImmersionFog.tsx` | Fog when the camera is inside the sea or the block. |
| `surface-sampler.ts`, `LevelledBase.tsx` | Sampling what was drawn, and standing things on it. |
| `chunk-resources.ts` | GPU/heap accounting and leak detection. |
| `ChunkSectionDebug.tsx` | Draws where the section plane is. |
| `*.spike.stories.tsx` | Storybook scenes — the working reference for every feature here. |

### Generators — `src/generators/`

| File | Role |
|------|------|
| `surface-chunk-generator.ts` | `generateSurfaceChunk` — the whole worker-side build. |
| `surface-stack-context.ts` | The shared-column cache (`getStackContext`). |
| `stack-water-generator.ts` | `generateStackWater` — the sea's lid and body. |
| `stack-release-generator.ts` | `releaseStackResources` — drops the cached column. |
| `generator-supersede.ts` | Latest-wins abort for superseded builds. |
| `workers/stack-worker-pool.ts` | Sub-worker pool for resample + refine. |
| `workers/stack-refine.worker.ts` | The inlined, three.js-free worker body. |

### SDK — `src/sdk/geometries/`

| File | Role |
|------|------|
| `surface-stack.ts` | The stack maths: reference grid, tessellation, resolve, collapse, intervals. |
| `surface-stack-geometry.ts` | `buildSurfaceStack` (the entry point), layer geometries, walls. |
| `surface-stack-resample.ts` | Resampling a grid onto the common grid. **three.js-free.** |
| `surface-stack-candidates.ts` | Refinement candidates + termination/coverage crossings. **three.js-free.** |
| `surface-seal.ts` | Closing the block where a surface is not mapped. |
| `surface-walls.ts`, `mesh-boundary.ts` | Interval walls and boundary tracing. |
| `surface-chunk.ts`, `surface-chunk-packing.ts` | Chunk assembly, diagnostics, worker transfer. |
| `surface-section.ts` | Cutting a stack with a plane. |
| `polygon-cap.ts`, `chamfer.ts`, `tin-sampler.ts`, `levelled-base.ts`, `surface-drape.ts` | Supporting geometry and field utilities. |

---

## Vocabulary

These words are used precisely throughout. Getting them mixed up is the usual
source of confusion when reading the code.

| Term | Meaning |
|------|---------|
| **Boundary / layer** | One surface in a chunk. A `ChunkLayer`. |
| **Interval / unit / volume** | The space between a boundary and the next one down. Drawn only if `fill` asks for it. |
| **Cap** | The drawn top face of a boundary. |
| **Wall** | The side face of an interval, traced around the area that interval actually occupies. |
| **Column** | The whole ordered surface list declared on `ChunkStack.surfaces`. Chunks are slices of it. |
| **Envelope** | The footprint the column's common grid is built over. Must contain every chunk's outline. |
| **Reference grid** | The single resampled grid every layer of the column is expressed on. |
| **Channel** | One layer's heights over the reference grid, in scene Y. |
| **Mask** | One layer's coverage over the reference grid: none / data / bounded fill. |
| **Tessellation** | The shared triangulation in plan — coordinates + indices — used by every layer of a chunk. |
| **Carrier** | The flat floor the whole column terminates against. |
| **Fluid** | A boundary that is a *level*, not a horizon. Ordered, but never the authority. |
| **Seam** | A horizon claimed by more than one chunk. |
| **Seal** | Geometry invented to close the block where a surface has no data. |
| **Peel** | Hiding a prefix of a chunk's units. |
| **Section / fence** | A plane cut / a vertical cut swept along a wellbore path. |

## Conventions

- **Depth is positive-down**, in metres, measured from datum. Scene **Y is up**, so
  a boundary at `depth: 1200` sits at scene `y = -1200`. Surfaces coming from the
  store follow the same convention (`SurfaceMeta.min`/`.max` are depths).
- **Scene XZ** is the `UtmArea` frame. `Chunk` and `ChunkStack` must be rendered
  inside a `UtmArea`; every surface's placement is resolved through
  `utmToArea(easting, northing, altitude)`.
- **Grid values** are stored normalised as `referenceDepth - depth` with `-1` as
  the nodata sentinel, `referenceDepth` being `SurfaceMeta.max`. Testing for
  `null`/`NaN` finds nothing.
- Semi-transparent stacks need a rendering pipeline whose base pass is an
  `OITRenderPass`. Fully opaque stacks need nothing special. See
  [../oit-guide.md](../oit-guide.md).
