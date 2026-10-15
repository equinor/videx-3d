# Streaming a chunk

How a chunk can be drawn layer by layer while it is still being built, instead of
all at once when the build returns.

> **Status (2026-10-12):** Parts 1–5 are built: partial results for any generator
> (see [generators.md](../generators.md#partial-results)), the chunk generator's
> packets, `Chunk` drawing them as they arrive with build progress, the caps
> built in parallel on the stack worker pool, and a coarse preview that the real
> chunk replaces layer by layer.

- [Why](#why)
- [Part 1 — partial results](#part-1--partial-results)
- [Part 2 — what the chunk generator sends](#part-2--what-the-chunk-generator-sends)
- [Part 3 — the main thread](#part-3--the-main-thread)
- [Build progress](#build-progress)
- [Part 4 — building the layers in parallel](#part-4--building-the-layers-in-parallel)
- [Part 5 — the preview](#part-5--the-preview)

---

## Why

Everything up to the vertex resolve is SHARED by the layers of a stack — the
tessellation is one TIN for all of them (see
[build-pipeline.md](./build-pipeline.md#stage-4--buildsurfacestack)) — so no layer
can be drawn before it. Everything after it is PER LAYER: the collapse of a layer
needs only its neighbours' resolved heights, a cap is built per layer and a wall
per interval. Those are 40–50% of a rebuild's own time on a 34-surface field.

Measured there, a rebuild shows its first cap after ~11–13 s today; streaming the
per-layer part would bring that to ~6.5 s (first load: ~19 s → ~14 s, the shared
column still comes first). The whole chunk finishes no sooner until Part 4.

⭐ Streaming also spreads the GPU upload: each layer is uploaded as it lands, and
`useStaggeredReveal` holds the rest of a burst to a byte budget per frame (see
[Part 3](#part-3--the-main-thread)).

---

## Part 1 — partial results

Built, and not chunk-specific. A generator takes an optional `PartialSink`
callback argument and calls it through `emitPartial(sink, packet, transferables)`;
`GeneratorsProvider` proxies function arguments with comlink when the registry is
remote (`wireGeneratorArgs`), so the generator does not know which it has. The
generator releases the sink in a `finally` (`releasePartialSink`) — a proxied
callback holds a `MessagePort` open until then.

Code: `src/sdk/data/partial-results.ts`. Tests: `tests/partial-results.test.ts`.

---

## Part 2 — what the chunk generator sends

Opt-in: only when the caller passes a sink. `Chunk` always will; anything else
calling `surfaceChunk` keeps the single packed result.

| Packet | When | Carries |
|--------|------|---------|
| `progress` | during the build, before any geometry | the step and its count (see [Build progress](#build-progress)) |
| `preview` | once, right after the column (column path only) | a whole coarse chunk, packed (see [Part 5](#part-5--the-preview)) |
| `base` | after the collapse and the walls | shared `xz` and index, EVERY layer's heights (`y`), the walls, the boundaries, the section source with its index, and how many caps follow AT MOST |
| `cap` × N | one per layer, as each is built — in ANY order on the pool (Part 4) | the layer's normals, kept index, `above`/`below`/`units`, patch index, `inferred` |
| return value | at the end | metrics and diagnostics, and `streamed: { caps }` — the caps actually sent |

⚠️ A cap that collapses away entirely sends no packet, so the count in `base` is
only an upper bound and the receiver completes on the one in the return value.

⚠️⚠️ **Buffer ownership is the risk.** A cap's `y` attribute IS the section
source's height array (see [build-pipeline.md](./build-pipeline.md#caps-the-split-vertex-layout)),
and a transferred buffer is detached on the sending side. Transferring it with a
cap would hollow out the section. So the heights travel ONCE, in `base`, and a
cap packet carries only what is its own; the main thread assembles each cap from
`base` plus its packet.

`buildSurfaceStack` stays synchronous and takes `SurfaceStackOptions.stream`:
`shared` once, then `cap` per layer. A message posted from inside a synchronous
loop leaves at once, so the main thread receives caps while the worker keeps
building. Without the hooks it behaves exactly as before.

⚠️ To have the walls and the section ready BEFORE the caps, they are now built
first. Both read the shared index, which used to be turned upward by the first
cap built from it (`computeUpwardNormals` reverses it in place); it is now turned
upward explicitly before the walls (`orientUpward`), so neither depends on build
order.

Code: `streamPackets` in `surface-chunk-generator.ts` builds each mesh exactly as
`assembleChunk` does (`chunkSurfaceMesh`, `chunkWallMeshes`, `chunkBoundaries`);
`surface-chunk-streaming.ts` packs them and has `createSurfaceChunkReceiver`,
which rebuilds the chunk on the main thread. `tests/surface-chunk-streaming.test.ts`
checks the streamed chunk equals the packed one, attribute by attribute.

⭐ The receiver gives every cap the SAME `xz` and shared-index attribute objects.
`unpackSurfaceChunk` now does the same: it used to wrap the one shared buffer in
a new attribute per cap, and three uploads per attribute OBJECT, so every cap
re-uploaded both (34 copies of `xz` in a transparent field column).

---

## Part 3 — the main thread

`Chunk` always passes a sink. What it does with the packets:

- `base` and each `cap` go through `createSurfaceChunkReceiver`, which keeps the
  caps in layer order whatever order they arrive in. Packets of a superseded
  build are dropped.
- ⭐ What is DRAWN goes a LAYER at a time: a layer's caps, the wall below it and
  its cut face appear together, as soon as its cap has arrived — in arrival order,
  no other. The walls come in `base` but wait for their caps. A layer with no cap
  of its own (a neighbour draws it, or it collapsed away) appears when the chunk
  is complete. `useStaggeredReveal` caps each frame's upload at
  `CHUNK_REVEAL_BYTES_PER_FRAME` (16 MB), at least one layer per frame, so a
  chunk that arrives packed is spread too.
- ⚠️ The return value and the last caps travel on different ports, so either can
  arrive first. The chunk lands when BOTH are in (`receiver.complete` after
  `finish`): `trackChunk`, `onBuild(metrics)`, the `'ready'` state, and the
  surface samplers. Only then, since a sampler wants every cap.
- ⭐ Each packet makes a new chunk OBJECT over the same geometries, so geometry
  ownership follows the BUILD (`ShownChunk.build.latest`), never the object:
  disposing per object would have released the caps still on screen.
- `ChunkMeshes` copes with a chunk that only grows: ceiling and patch materials
  are made on first use (rebuilding the materials per packet relinked shader
  programs) and patch geometries are kept per cap.
- Cap culling runs during the stream. The camera-interval probe treats a missing
  cap as unbounded, which can only widen what it reports, so a partial chunk is
  culled conservatively. Holding the culling back until the end drew every cap
  whole (~10 M triangles, twice with picking) and ended in a 2.6 s GPU stall.

Measured on the 34-surface field, first load: first cap on screen at ~19.8 s
(the shared column and the tessellation come first), all caps by ~23.4 s, landed
at ~24.7 s, no long tasks and 60 fps throughout.

---

## Build progress

The same sink carries `progress` packets: `done` of `total` units of a step, in
the units it actually counts. `ChunkStackProgress.current` holds the latest one
from a chunk still building; the chunk count is unchanged.

| Step | Counts | Reported by |
|------|--------|-------------|
| `fetch` | surfaces fetched and resampled | the column build (`buildStackContext`) |
| `resolve` | — (`0` of `1`) | the seal and the depth-order resolve |
| `refine` | layers refined | `refineStackChannels` |
| `terminations` | adjacent pairs scanned | `scanStackTerminations` (column path only) |
| `plan` | — | `planSurfaceStack`: the lines, the noding and the tiles |
| `tessellate` | tiles triangulated | `tessellateStackTiles` (one tile when untiled) |
| `assemble` | — | stitch, own-surface sampling, resolve, collapse and walls, up to the `base` packet |
| `caps` | caps received of those announced | `Chunk`, from the receiver |

⭐ The column and its refinement are SHARED work, awaited by every chunk of the
column. Their progress is broadcast to every chunk waiting on them, and a chunk
that joins late starts from the last report (`watch` in
`surface-stack-context.ts`).

⚠️ `assemble` is the longest silent step left (~5 s on the 33-layer field: vertex
resolve, collapse, walls). Sub-steps would come from inside `beginOnTessellation`.

### The estimate

`ChunkBuildProgress.estimate` turns the steps into one number, 0 to 1, with
`createSurfaceChunkProgress` (SDK): each step weighs a fixed share, rough seconds
from a cold 33-layer build with 64-cell tiles (fetch 3, resolve 1.2, refine 2.2,
terminations 1.1, plan 2, tessellate 0.6, assemble 5, caps 3.6), and moves
linearly with its own count. `ChunkStackProgress.estimate` is the mean over the
chunks (1 once a chunk is done, 0 before its first step).

- It starts at 0 from the FIRST step heard, so a rebuild on a cached column (which
  starts at `refine` or later) still runs from 0. A step skipped later counts as
  done, and the number never goes back.
- ⚠️ It is an ESTIMATE: a warm fetch is ~20 ms, an untiled tessellation ~3× the
  pooled one, so the bar speeds up and slows down. `fraction` and `current` stay
  the exact counts.

---

## Part 4 — building the layers in parallel

Each cap's normals, index fix-up, patch and bounds are independent of every other
cap's, so they run on the stack worker pool (`'cap'` tasks):

- `buildStackCapArrays` (`stack-cap-arrays.ts`) is the cap build WITHOUT three.js —
  plain arrays in and out, bit-for-bit what `computeUpwardNormals`, the patch
  split and three's bounding volumes give (`tests/stack-cap-arrays.test.ts`). The
  synchronous `createStackGeometryBuilder` uses it too, so there is one definition.
- `beginSurfaceStack` runs `buildSurfaceStack` up to its caps and hands back a job
  per layer plus `finishCap` / `finish`. `buildSurfaceStack` is that, with the jobs
  run in order on the current thread — unchanged for every other caller.
- The chunk generator sends the jobs to the pool (`buildStackCaps`, copies in,
  arrays back) and finishes each cap as it returns, which streams it.
- ⚠️ A cap re-winds its own index in place when it faces down. On the pool that
  happens to a COPY, so the re-wound array comes back and is the one used; the
  shared index is turned upward before any cap (`orientUpward`) and never comes
  back re-wound.

Measured on that field: `geometryMs` 4,110 → 561 ms, and the 34 caps arrive within
~0.6 s of each other instead of over ~3.6 s.

⚠️ The collapse (~1.4 s) is per layer too, but runs before the walls, which need
all of it; it stays on the generator worker.

---

## Part 5 — the preview

The real build of a field-scale chunk takes seconds even with the column cached.
A PREVIEW is the same build at coarse sampling, sent as soon as the column and the
chunk's layers are known — before the refine — and drawn until the real chunk
replaces it.

**In the worker** (`sendPreview` in `surface-chunk-generator.ts`): only on the
column path, only when streaming, and only with `SurfaceChunkSpec.preview` (set
from `Chunk.preview` / `ChunkStack.preview`, default on).

- `previewStackCandidates` picks every s-th grid node, the stride chosen so about
  8k fall inside the outline. They stand in for the refined candidates.
- Then `buildSurfaceStack` with the chunk's own options — rim, cuts, resolve,
  collapse, section, peel — minus everything expensive: no termination or coverage
  refinement or constraints, no cap neighbours, no diagnostics, no stream. The rim
  is the real one, so the preview's walls stand exactly where the real ones will.
- Assembled and packed like a normal chunk and sent as one `preview` packet; none
  of it is shared with the real build, so all of it moves.

**On the main thread** the preview gets its own `ChunkMeshes` instance and its own
build object, so it is disposed on its own. The real chunk has another instance:
handing one instance the other's chunk made React DEV describe the changed props,
which for a new `section` walks its typed arrays (measured 1.2 s).

⭐ **Handover per layer.** The preview draws every layer the real chunk does not
(`ChunkMeshes.layersHidden` is the real chunk's `layersShown`), so the frame that
first draws — and uploads — a real layer is the frame the preview stops drawing
it. The preview is dropped once the real chunk is complete and all of it is
shown. A preview layer the real chunk never draws goes then too.

The preview is drawn at `previewSaturation` (default 0.5) so it reads as
provisional. It is ONE `chunkSaturation` uniform that `ChunkMeshes` shares with
every material it makes: a uniform, not a define, so the preview shares every
shader program with the real chunk, and changing it rebuilds no material.

Measured on the 34-surface field, on a rebuild with the column cached:

| | |
|---|---|
| preview built in the worker | 565 ms (stride 7, ~19k nodes, 0.64 M triangles) |
| preview on screen | 0.83 s after the rebuild started (the real chunk: ~10 s) |
| its first frame | 133 ms |
| handover | 0.7 s, layer by layer as the caps arrived |
| frames with a layer missing / drawn twice | 0 / 0 |
