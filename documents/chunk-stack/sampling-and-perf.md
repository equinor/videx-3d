# Sampling, performance and diagnostics

Standing things on what was drawn, what the build costs, and how to find out why
a block looks wrong.

- [Sampling what was drawn](#sampling-what-was-drawn)
- [Placing objects](#placing-objects)
- [Levelled bases and draped routes](#levelled-bases-and-draped-routes)
- [The cost model](#the-cost-model)
- [Budgets and dials](#budgets-and-dials)
- [Resources and leaks](#resources-and-leaks)
- [Diagnostics](#diagnostics)
- [Troubleshooting](#troubleshooting)

---

## Sampling what was drawn

> ⭐⭐ **The chunk's TIN is already on the main thread** — it is what is being
> rendered. Sampling is therefore **synchronous and exact**: no worker round-trip,
> no packing field, and no `maxError` discrepancy between the sampled height and the
> visible surface. The only asynchrony left is that the answer is `null` until the
> chunk has built.

An earlier design assumed heights lived only in the worker and specified an async,
batched sampler. That solved a problem that does not exist.

### The two contexts

| Context | Direction | Who |
|---------|-----------|-----|
| `SurfaceSamplerRegistryContext` | publish | each `Chunk`, in an effect keyed on `[chunk]` |
| `SurfaceSamplerContext` | consume | `useSurfaceSampler()` |

Both are deliberately **separate** from `ChunkStackContext` — that value is what
every chunk's build spec derives from, and a sibling finishing its geometry must not
disturb it. The stack holds a ref map plus a version counter and re-memoises the
sampler on each change; the **new identity is the signal to re-sample**.

### The API

```ts
type SurfaceSampler = {
  sampleAt(x, z, surface?, out?): TinSample | null;
  getHeightAt(x, z, surface?): number | null;
  solidAt(x, y, z, floor?): number | null;
  readonly surfaces: string[];
};
```

- Omit `surface` and the **highest drawn** surface answers, which is the ground as
  seen from above. Give an id to sample that horizon alone.
- Under the hood, `createTinSampler(positions, indices, { cellSize, maxCells })`
  buckets triangles into a uniform XZ grid (CSR, two typed-array passes,
  cell = √(area / triangles)) and answers with a barycentric test in XZ plus the
  plane normal forced into +Y. It is built **on first use** and cached per geometry
  in a `WeakMap`, so a stack nobody samples pays nothing.
- `solidAt` asks **per chunk**. "Below the highest surface and above the base" is
  only the same question while the stack is one solid extrusion; give two chunks
  different footprints and there is open air between them wherever the narrower one
  is absent, which that test would read as rock.

### What is *not* sampleable

- **Void ceilings.** One faces up but is the *underside* of the unit above, so
  something placed on it would sit inside the block. `Chunk` filters them out when
  registering.
- **The carrier**, which is tagged `ceiling` too (it reuses that flag for its
  material). Deliberate: the column's floor is not a surface to stand on. The
  immersion fog derives the block's base arithmetically for this reason.
- Anywhere nothing is drawn: outside the outline, inside a hole, where a unit has
  pinched out, or where the section has cut the ground away.

> ⚠️ A marker that **follows the pointer** should not use a height sampler at all.
> Use the `EventEmitter` GPU picking, which reads what is actually *rendered*
> (`event.position` is the world hit position). Two mechanisms, each answering what
> the other cannot: picking says **where**, a footprint fit says **how it sits**.

> ⚠️⚠️ **Frames.** `event.position` is **world**; chunk geometry is in the
> `UtmArea` group's frame. Call `worldToLocal` before sampling and `localToWorld`
> before handing a point to the camera. It works by accident while the offset is 0.

---

## Placing objects

`sampleSurfaceFootprint(sampler, options)` samples a ring of points around an
object's footprint and fits a **least-squares plane** through the hits (the same
fit `useBuoyancy` uses):

```ts
type SurfaceFootprint = {
  y: number;         // height at the centre
  normal: Vec3;      // unit normal of the fitted plane
  coverage: number;  // share of samples that hit, 0..1
  min: number;
  max: number;
};
```

> ⭐ `coverage` is the *"does it fit here?"* signal a single centre sample cannot
> give — anything below 1 means part of the footprint overhangs.

`useSurfacePlacement(ref, options)` drives an object from that fit:
`offset` (lift, metres), `align` (`false`/`0` upright … `true`/`1` flat on the
ground, or anything in between), `enabled`, `onPlaced`.

There is no `continuous` mode, on purpose: a surface only moves when its chunk
rebuilds, which changes the sampler identity — so a `useFrame` subscription would
be pure cost. `sampleSurfaceFootprint` reuses module scratch arrays for its one
per-frame-capable path.

> ⚠️⚠️ **Converting a context-consuming component into a hook moves it above the
> provider.** A hook called in the story body is *outside* `<ChunkStack>`, so
> `useSurfaceSampler()` returns `null` — registration succeeds, handlers fire, and
> there is **no error**. Every signal points at the picking, which is innocent. Put
> the call site in a child component.

---

## Levelled bases and draped routes

Two SDK builders sit on the sampler; both are shipped as components.

### `<LevelledBase>`

A flat platform for a structure that needs a known base — a subsea template, a
manifold. It samples the surfaces the stack drew, derives a level, cuts a skirt
into the ground and drapes the underside.

Props: `footprint` (a `PlanarPolygonGeometry`), `level`
(`number | 'max' | 'mean' | 'min'`, default `'max'` = pure fill), `standoff`,
`embedment`, `minThickness`, `spacing`, `resolution`, `closed`, `material`,
`surface`, `onBuild`.

`createLevelledBase` returns `{ top, skirt, bottom, level, metrics }` with
`metrics.{min, max, mean, coverage, fill, cut, volume}`. It reuses
`createPolygonCap` for the caps and `buildIntervalWalls` for the skirt, and the
**underside doubles as the sampling grid**, so a rise in the *middle* counts, not
just at the rim.

> ⚠️ `minThickness` stops a forced level below ground from **inverting** the skirt —
> the same failure class as the shoreline wall.

Renders nothing until `useSurfaceSampler()` returns non-null.

### `drapePolyline`

For a pipeline or a cable:

```ts
drapePolyline(route, heightAt, { spacing = 25, clearance, span, smoothing })
  → { points: Vec3[], length, gaps, lifted }
```

Densify → sample → **interpolate** across unknown nodes (a line with a hole in it
is worse than one carried across) → shape → `y = max(shaped, ground) + clearance`.

> ⭐ `span` is a **rolling maximum** over a window — *"the line rests on the highs
> and bridges the hollows"*. A max can only ever **lift**, so it can never push the
> pipe into the sea bed. `smoothing` (a moving average) is clamped back to the
> ground for the same reason, and is explicitly **not** span mechanics.
>
> The invariant worth testing is exactly that: *never lowers the line, whatever the
> span or smoothing*.

A self-check that the drape is physically consistent: `climb` (3D length minus map
length) should match `L·g²/2` for the slopes involved, and adding `span` should make
`climb` **fall** — a spanned line is straighter than a draped one.

> ⚠️ `createTubeGeometry` needs `computeNormals: true` explicitly, or the tube has
> no normal attribute and renders unlit.

---

## The cost model

> ⭐⭐ **Every phase scales with one of two things.**

| Group | Scales with | Phases | Paid |
|-------|-------------|--------|------|
| **A** | reference grid **nodes × layers** | fetch, resample, seal, grid resolve, refine | once per column |
| **B** | shared tessellation **vertices × layers** | sample, vertex resolve, collapse, geometry, walls | per chunk |

At a full field column, group B is the larger part of the wall clock.
**The vertex count is the lever.**

> ⭐ **It is SIZE, not layer count.** A generated 11-layer column at 36 k triangles
> against a real 34-layer field at 1.08 M is a 75× difference — 3.1× the layers and
> **29.8× the tessellation**, and that second factor is mostly *area* (49 km² versus
> 1050 km² at the same 25 m cell). A stack whose envelope is a whole survey
> rectangle rather than a field-sized crop pays for the difference everywhere.

Optimisations already in place, worth not undoing:

1. **`tessellateStack` filters the candidate union to the chunk footprint**, dilated
   by one cell. Exact, because the rim is a constraint edge and flips never cross
   one — but un-dilated it drops nodes lying exactly on the rim and moves triangle
   counts.
2. **Fetch and resample are pipelined** (`planStackReference` reads headers only,
   so a layer is resampled the moment its own grid lands).
   ⚠️ `fetchMs` and `referenceMs` therefore **overlap** — they do not sum.
3. **Resample runs on the worker pool**, with samples transferred **in** and never
   returned (nothing downstream reads `layer.values`).
4. **`rasterizeStackOutline` is bbox-restricted.**

---

## Budgets and dials

| Dial | Default | What it trades |
|------|---------|----------------|
| `resolve.maxNodes` | 4,000,000 | ⭐ the **quality/speed dial**. Halving it quarters group A |
| `maxError` | 5 | interior simplification — directly sets the vertex count, i.e. group B |
| `rimSpacing` | — | rim density; also the seam's sampling points |
| `resolve.constrainCoverage` | off | exactness at a data edge, at vertices along every partly-mapped boundary |
| `resolve.refineTerminations` | on | pinch-outs follow the contour instead of the nearest edges |
| `water.resolution` | unset | ⚠️ quadratic in field size — only set it with displacement on |
| `outline` cell size (wellbore) | 100 | the outline raster; `O(area / cellSize²)` |

`maxNodes` deserves the detail:

> Every layer is resampled onto one grid derived from the finest layer's, cropped to
> the outline; when that window exceeds the budget it is decimated by an integer
> step. What it costs is **resolution, and unevenly**. Heights barely suffer (the TIN
> is error-bounded by `maxError` either way, and a horizon is smooth at field
> scale), but the coverage **masks** coarsen with it — so data edges, interior holes
> and pinch-out contours are resolved to the coarser cell.
>
> `referenceStep > 1` in the diagnostics means the trade is active.
>
> ⚠️ It is part of the shared column's cache key, so changing it rebuilds every
> chunk of the stack.

---

## Resources and leaks

The cached column is the largest allocation the library makes and is keyed to the
*column*, not to a component, so **nothing collects it** until
`releaseStackResources` runs (`ChunkStack` does that on unmount, through a ref so a
callback identity change cannot throw it away mid-session).

`chunkResourceStats()` reports what the built chunks hold:

| Field | Meaning |
|-------|---------|
| `chunks` | live built chunks |
| `bytes` | geometry + indices + section buffers, each shared buffer counted once |
| `peakBytes` | high-water mark |
| `vertices`, `triangles` | summed over caps and walls |
| `sectionBytes` | the cut-face preallocated buffers (they grow as a plane sweeps) |
| `builds` | total built since load |
| `stranded` | ⭐ chunks neither in use nor collected — the **leak detector**, via `FinalizationRegistry` |

`generatorStats()` reports the worker side: `columnKey`, `columnBytes`,
`candidateBytes`, `columnsBuilt`, `columnsInFlight`, `poolSize`, and the V8 heap in
Chrome.

Two retention traps already fixed, worth not reintroducing:

- **React's fiber `alternate`** retains the previous render's hook state — an entire
  replaced chunk. `Chunk` forces one extra render after a build lands so the
  alternate holds the *current* one.
- **Closure scope.** V8 gives a function scope one `Context` holding every variable
  captured by any closure inside it, so a closure memoised on *appearance* and
  defined in the component body pins that render's whole `chunk`. Pass the inputs as
  arguments (`buildInferenceOverlays` is module-scope for exactly this).

---

## Diagnostics

`Chunk.onBuild(metrics)` gives `SurfaceChunkMetrics`, whose `diagnostics` is where
the answers are. It is deliberately rich, because most failures here are *silent*
— the pipeline makes any input self-consistent.

### Was the input ordered correctly?

| Field | Read it as |
|-------|-----------|
| `crossings` | vertices found out of order **before** the resolve |
| `crossingsCovered` | the same, only where **both** layers have data of their own |
| `maxOverlap` | deepest interpenetration, world units |
| `maxDuplicate` | largest share of a layer coincident with the one above (~1 = a duplicated horizon) |

> ⚠️ On a shared column these are counted on the **column's grid over the whole
> envelope**, once, before any chunk exists — so they read the same for every chunk.
> They still answer *"was the input in stratigraphic order?"*, which is what they
> are for.
>
> ⭐ `crossingsCovered` is the honest number. Restricting to jointly-covered
> vertices once took a real column from 64,360 apparent crossings to 18,946 — the
> rest were nearest-fill poking above the layer above *outside* the surface's own
> extent, not geology.

### Is the geometry sound?

| Field | Should be | If not |
|-------|-----------|--------|
| `constraintFailures` | 0 | a rim or a cut does not follow mesh edges — a boundary drawn from it is a claim the mesh does not support |
| `rimDropped` | 0 | the wall and the surface disagree about where the chunk ends |
| `wallRingsDropped` | 0 | a piece of an interval is unwalled |
| `wallRingsOpen` | 0 | a walk was sealed with an edge that does not exist — a phantom face |

### Per layer — usually the only question worth asking

`diagnostics.layers[]` (`SurfaceChunkLayerDiagnostics`):

`index`, `id`, `coverage`, `filled`, `inferred`, `voided`, `triangles`,
`droppedAbsent`, `droppedCollapsed`, `droppedExcluded`, `capped`, `duplicate`.

> ⭐ The chunk-level totals are **sums**, which hide *which* layer lost its
> geometry. Reasoning from aggregates produced two wrong diagnoses in a row on this
> codebase before the per-layer breakdown existed.

> ⚠️ `coverage` is measured over the **requested** footprint, before any trim.
> Measuring it after would report 1 for every layer of every chunk, by construction
> — which it once did, and looked like a clean bill of health while being no
> measurement at all.

### Cost

`vertices`, `sharedTriangles`, `referenceNodes`, `referenceStep`, `stackLayers`,
`sharedStack`, `columnBytes`, and the timings: `fetchMs`, `referenceMs`, `sealMs`,
`stackResolveMs`, `refineMs` / `refinePool`, `prepMs`, `tessellateMs`, `sampleMs`,
`vertexResolveMs`, `collapseMs`, `geometryMs`, `wallMs`.

> ⚠️ `fetchMs` and `referenceMs` **overlap**. `refinePool: 0` means the serial
> fallback, so `refineMs` is CPU time rather than wall clock.

> ⭐ Identical shared-phase timings across every chunk of a stack are the **proof**
> that the column really is shared.

### Measuring in Storybook

Every chunk story logs a machine-readable `CHUNKREPORT` line from `onBuild`, plus a
per-layer `console.table`. Sweep controls without reloading:

```js
__STORYBOOK_ADDONS_CHANNEL__.emit('updateStoryArgs', { storyId, updatedArgs });
```

> ⭐ A page reload rebuilds everything and proves nothing. The args channel is how
> you test *"does X rebuild?"*.
>
> ⚠️ Collect `pageerror` while measuring and **discard any run that logged one** —
> Vite HMR can throw a phantom `ReferenceError` from a partially updated module.
>
> ⚠️ **Triangle count is a good proxy for COST and a bad one for SHAPE.** Three
> visibly different seal profiles once produced exactly 24,305 triangles each.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Progress freezes, no error, no worker running | a chunk's outline was published and then cleared by a re-registration — see [coordination.md](./coordination.md#the-registries) |
| A chunk never appears and never errors | its outline resolved to nothing (`'empty'`), or an early return in the outline effect failed to settle. Wire `onBuildStateChange` |
| `[Chunk] gave up waiting on the ChunkStack…` | a sibling gate is deadlocked; the log names which one |
| `[Chunk] layers name N surface(s) the ChunkStack's own surfaces does not contain` | exactly that — add them to the column or drop the layers |
| **The block looks unsealed / open at the bottom** | ⭐ check whether the floor is on the **stack** (`carrier`) or on the **chunk** (a synthetic layer). A chunk-private floor is not part of the column, so the column's seal never sees it |
| Two chunks disagree about a shared horizon's height | something is being decided per chunk that must be decided per column. Sealing and the depth resolve both live on the column for this reason |
| A horizon is missing entirely | a neighbour won the seam. `layers[i].capped === false` says so |
| A see-through hole in a solid block | coverage absence with `seal: false` — every layer dropped in the same place |
| Serrated / bitten edges at a data edge | the per-corner coverage rule; turn on `constrainCoverage` |
| Walled notches in a cap after enabling sealing | a grid-node decision being applied at shared vertices — `preResolved` must be dropped when sealing |
| A wall reaching to infinity | a layer with no data anywhere kept the `STACK_NO_DATA` sentinel. `layEmptyStackLayers` guards it; if you see it, that guard was bypassed |
| Flat white walls after toggling a material | two attachment mechanisms on one element — see [appearance.md](./appearance.md#ownership-rules) |
| Bright specks along the top of every band, in section | the cut face is on the wrong side of its own test. `DEFAULT_SECTION_OFFSET` must stay **negative** |
| Detail "swims" as the camera moves | screen-space gradient bump; use the analytic-gradient path |
| A control does nothing until a reload | the field is missing from `appearanceKey` (or `layersKey`) in `Chunk.tsx` |
| A field added to a type silently vanishes | grep for `surface-chunk-packing.ts` — the packer must spread, not restate |
| Water looks too transparent at `opacity: 1` | `waterOpacity`'s own default of 0.7 |
| `Computed min/max have NaN values` | a channel was filled with `undefined`. Cheapest signal that geometry is silently corrupt |
| Everything is slow and `referenceStep` is 1 with a huge `referenceNodes` | the envelope is a whole survey rectangle. Crop it, or lower `maxNodes` |
