# The zone stack

A **zone stack** draws a block of subsurface geology: a run of depth surfaces
clipped to a shared footprint, with the volume between them filled in, walls
around the sides, a floor underneath, water on top, and a knife through it if you
want to look inside.

This folder is the developer documentation for that component family — what the
pieces are, why they are shaped the way they are, and what happens between a
`<Zone layers={...} />` in JSX and triangles on the screen.

> `documents/zones.md` is a different document: it is the working design log for
> this feature, written as decisions were taken, and it contains superseded
> sections. Where the two disagree, this folder is the current one.

---

## The 60-second model

```tsx
<UtmArea origin={origin} utmZone={utmZone}>
  <ZoneStack boundary={fieldPolygon} surfaces={column} carrier={{ below: 800 }}>
    <Zone
      layers={[
        { surface: seabed, fill: '#c2b280' },  // sand down to the next horizon
        { surface: topReservoir, fill: true }, // "same colour as my own cap"
        { surface: baseReservoir },            // a bare horizon — no volume below
      ]}
    />
  </ZoneStack>
</UtmArea>
```

Five ideas carry the whole design:

1. **A zone is a run of HORIZONS, not a list of solids.** Each `ZoneLayer` is
   one surface. The volume *below* it exists only because you asked for it with
   `fill`. A group, a gap between groups and a bare sheet are then all the same
   concept with different flags — see [model.md](./model.md).
2. **The array order IS the stratigraphic order.** Nothing infers it. Sorting by
   `SurfaceMeta.min`/`.max` misorders a real column, and the depth-order resolve
   will dutifully make *any* order self-consistent, so a wrong order produces a
   plausible-looking lie. The build reports crossing counts so you can see it.
3. **One tessellation for the whole stack.** Every layer of a zone shares the
   same triangles in plan, differing only in height. That is what makes
   interpenetration impossible rather than merely unlikely — see
   [build-pipeline.md](./build-pipeline.md).
4. **Three reactive layers.** Boundary, geometry and appearance are kept strictly
   apart, so changing a colour or an opacity never rebuilds geometry — see
   [architecture.md](./architecture.md).
5. **The stack owns everything shared.** The column, its resolved depth order, the
   floor, the sea, the cut plane and who draws a horizon two zones share all live
   on `ZoneStack`, because a zone cannot see its siblings — see
   [coordination.md](./coordination.md).

---

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 1 | [model.md](./model.md) | What a layer, an interval, a column, a carrier and a fluid *are*. Read this first. |
| 2 | [architecture.md](./architecture.md) | Component tree, contexts, the three reactive layers, and what makes something rebuild. |
| 3 | [build-pipeline.md](./build-pipeline.md) | Spec → worker → grid → tessellation → geometry, stage by stage. |
| 4 | [coordination.md](./coordination.md) | How sibling zones agree: claims, boundaries, seams, gates, progress. |
| 5 | [boundaries.md](./boundaries.md) | Cut sources, wellbore-derived footprints, coverage and trimming. |
| 6 | [appearance.md](./appearance.md) | Materials, procedural detail, inference marking, ownership and disposal. |
| 7 | [cutting-and-water.md](./cutting-and-water.md) | Sections, fences, peeling, the sea, contacts, immersion fog. |
| 8 | [sampling-and-perf.md](./sampling-and-perf.md) | Placing objects on what was drawn; cost model, budgets, diagnostics, troubleshooting. |
| 9 | [streaming.md](./streaming.md) | Drawing a zone layer by layer while it builds: partial results, packets, buffer ownership. |

---

## Where the code lives

### Components — `src/components/Zones/`

| File | Role |
|------|------|
| `ZoneStack.tsx` | The provider. Owns the column, the sea, the carrier, the cut, the registries. |
| `Zone.tsx` | One block. Resolves a boundary, assembles a build spec, drives the generator. |
| `ZoneMeshes.tsx` | Presentational. Turns a built zone + layer declarations into meshes and materials. |
| `ZoneContext.ts` | `ZoneStackContextValue` — everything the stack publishes downward. |
| `zone-defs.ts` | The public type surface: `ZoneLayer`, `ZoneResolveOptions`, `ZoneSection`, `ZoneFence`, `ZoneStackWater`, generator keys, defaults. |
| `zone-spec.ts` | Pure main-thread spec builders (`buildSurfaceZoneSpec`, `stackColumnSpec`, `buildStackWaterSpec`, `buildWellboreOutlineSpec`). |
| `cutout.ts` | `CutoutSource` / `ZoneBoundary` and the per-zone override merge. |
| `resolveWellboreOutline.ts` | Calls the `wellboreOutline` generator and turns its rings into the footprint polygon. |
| `zone-boundary-registry.ts` | Pure claim/boundary bookkeeping (unit-tested). |
| `seams.ts` | `resolveSeam` — who draws a horizon two zones share. |
| `zone-material.ts` | `ZoneMaterial`, the Blinn-Phong shader material everything is drawn with. |
| `zone-detail.ts` | The zone names of the sdk's procedural detail presets (`sdk/materials/surface-detail.ts`). |
| `inference-material.ts` | Overlay marking invented geometry. |
| `zone-picking-material.ts` | The pick-pass twin of a cut material, so what is cut away is not picked. |
| `zone-contacts.ts`, `zone-depth-map.ts` | Fluid contacts as lines, and depth grids (a surface's, or the bed's channel) as textures. |
| `useZoneSection.ts`, `useZoneFenceFace.ts` | Cut-face geometry per interval. |
| `useStackFence.ts`, `useStackWater.ts` | Stack-level fence and sea (the bed tint's grid comes back with the sea's geometry). |
| `useImmersionFog.ts`, `StackImmersionFog.tsx` | Fog when the camera is inside the sea or the block: the stack's medium as the camera site's (`CameraSite.medium`, see [camera.md](../camera.md#where-the-camera-is)). |
| `surface-sampler.ts`, `LevelledBase.tsx` | Sampling what was drawn, and standing things on it. |
| `zone-resources.ts` | GPU/heap accounting and leak detection. |
| `ZoneSectionDebug.tsx` | Draws where the section plane is. |
| `*.spike.stories.tsx` | Storybook scenes — the working reference for every feature here. |

### Generators — `src/generators/`

| File | Role |
|------|------|
| `surface-zone-generator.ts` | `generateSurfaceZone` — the whole worker-side build. |
| `surface-stack-context.ts` | The shared-column cache (`getStackContext`), and what zones derive from a column (`getStackDerived`). |
| `stack-water-generator.ts` | `generateStackWater` — the sea's lid and body. |
| `stack-release-generator.ts` | `releaseStackResources` — drops the cached column. |
| `wellbore-outline-generator.ts` | `generateWellboreOutline` — trajectories → boundary rings for a wellbore cut source. |
| `generator-supersede.ts` | Latest-wins abort for superseded builds. |
| `workers/stack-worker-pool.ts` | Sub-worker pool for resample, refine, terminations, boundary rasterization, caps and tessellation tiles. |
| `workers/stack-refine.worker.ts` | The inlined, three.js-free worker body. |

### SDK — `src/sdk/geometries/`

| File | Role |
|------|------|
| `surface-stack.ts` | The stack maths: reference grid, tessellation, resolve, collapse, intervals. |
| `surface-stack-geometry.ts` | `buildSurfaceStack` (the entry point), `planSurfaceStack` (split at the tiles), layer geometries, walls. |
| `stack-tiles.ts` | One tile of a tiled tessellation (and its coarser levels), joining tiles, seam refinement. **three.js-free.** |
| `grid-inside.ts` | Point-in-polygon on grid rings, with a crossing index. **three.js-free.** |
| `grid-noding.ts` | `nodeGridRings` — splitting rings where they cross. **three.js-free.** |
| `surface-stack-resample.ts` | Resampling a grid onto the common grid. **three.js-free.** |
| `surface-stack-candidates.ts` | Refinement candidates + termination/coverage crossings. **three.js-free.** |
| `surface-seal.ts` | Closing the block where a surface is not mapped. |
| `surface-walls.ts`, `mesh-boundary.ts` | Interval walls and boundary tracing. |
| `surface-zone.ts`, `surface-zone-packing.ts` | Zone assembly, diagnostics, worker transfer. |
| `surface-section.ts` | Cutting a stack with a plane. |
| `polygon-cap.ts`, `chamfer.ts`, `tin-sampler.ts`, `levelled-base.ts`, `surface-drape.ts` | Supporting geometry and field utilities. |

---

## Vocabulary

These words are used precisely throughout. Getting them mixed up is the usual
source of confusion when reading the code.

| Term | Meaning |
|------|---------|
| **Horizon / layer** | One surface in a zone. A `ZoneLayer`. |
| **Interval / unit / volume** | The space between a horizon and the next one down. Drawn only if `fill` asks for it. |
| **Cap** | The drawn top face of a horizon. |
| **Wall** | The side face of an interval, traced around the area that interval actually occupies. |
| **Column** | The whole ordered surface list declared on `ZoneStack.surfaces`. Zones are slices of it. |
| **Envelope** | The footprint the column's common grid is built over. Must contain every zone's boundary. |
| **Reference grid** | The single resampled grid every layer of the column is expressed on. |
| **Channel** | One layer's heights over the reference grid, in scene Y. |
| **Mask** | One layer's coverage over the reference grid: none / data / bounded fill. |
| **Tessellation** | The shared triangulation in plan — coordinates + indices — used by every layer of a zone. |
| **Carrier** | The flat floor the whole column terminates against. |
| **Fluid** | A layer that is a *level*, not a horizon. Ordered, but never the authority. |
| **Seam** | A horizon claimed by more than one zone. |
| **Seal** | Geometry invented to close the block where a surface has no data. |
| **Peel** | Hiding a prefix of a zone's units. |
| **Section / fence** | A plane cut / a vertical cut swept along a wellbore path. |

## Conventions

- **Depth is positive-down**, in metres, measured from datum. Scene **Y is up**, so
  a horizon at `depth: 1200` sits at scene `y = -1200`. Surfaces coming from the
  store follow the same convention (`SurfaceMeta.min`/`.max` are depths).
- **Scene XZ** is the `UtmArea` frame. `Zone` and `ZoneStack` must be rendered
  inside a `UtmArea`; every surface's placement is resolved through
  `utmToArea(easting, northing, altitude)`.
- **Grid values** are stored normalised as `referenceDepth - depth` with `-1` as
  the nodata sentinel, `referenceDepth` being `SurfaceMeta.max`. Testing for
  `null`/`NaN` finds nothing.
- Semi-transparent stacks need a rendering pipeline whose base pass is an
  `OITRenderPass`. Fully opaque stacks need nothing special. See
  [../oit-guide.md](../oit-guide.md).
