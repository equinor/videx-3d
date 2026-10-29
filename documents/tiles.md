# Tiles: streamed relief, and the bridge between the relief and the chunk stack

> **Status (2026-10-26): built, steps 1–7; [world.md step 2](./world.md#9-step-2-in-detail-the-sky-on-a-fixed-globe)
> (the sky on a fixed globe), then [overlays](#8-overlays-shapes-on-the-relief-the-sea-and-the-seabed),
> are next.** What a user needs is in [relief.md](./relief.md), [data.md](./data.md),
> [scenery.md](./scenery.md) and the [chunk stack's documents](./chunk-stack/index.md); this stays
> the maintainers' design and its record. Early testing happens in the Storybook story
> `Spikes/Scenery/ReliefTiles` (see [Order of work](#10-order-of-work)).

- [Why](#why)
- [Decisions](#decisions)
- [1. The relief contract](#1-the-relief-contract)
- [2. Mappers](#2-mappers)
- [3. The tile core](#3-the-tile-core)
- [4. Relief tiles](#4-relief-tiles)
- [5. Drawing the relief](#5-drawing-the-relief)
- [6. The bridge: relief to chunk](#6-the-bridge-relief-to-chunk)
- [7. Sampling the relief](#7-sampling-the-relief)
- [8. Overlays: shapes on the relief, the sea and the seabed](#8-overlays-shapes-on-the-relief-the-sea-and-the-seabed)
- [9. What goes](#9-what-goes)
- [10. Order of work](#10-order-of-work)
- [11. Open questions](#11-open-questions)
- [12. Costs and risks](#12-costs-and-risks)

---

## Why

Today a `SceneryStage` relief is ONE data set, resampled whole into one texture of at most
2048² around the stage — about 2 km a texel over the 2000 km it must reach — and drawn
with CDLOD. The stage keeps a flat seabed over `bounds` and eases it into the seabed an
occupant hands it.

What is wanted:

- several data sets at once, each with its own detail and reach — global, regional, local
  — with the finest wherever it has data;
- detail where the camera is, and no more anywhere else;
- the ground drawn everywhere by one system, the field's column included, and the column
  built against that very ground;
- headroom for the data under the seabed: the relief's frame cost must not grow with the
  number of data sets, and should drop where the ground is plain.

One texture cannot hold 2000 km at 25 m (80,000² texels). A quadtree of tiles can: it
holds detail only where it is seen. Merging the data sets once per tile, in a worker,
means the shader reads ONE texture whatever their number. And a tile that knows its own
error can stay coarse where the ground is flat, as the chunks' tiles already do.

---

## Decisions

| | |
|--|--|
| Contract | ONE relief contract in videx-3d: `relief-meta` and `relief-values`, asked for by window of the data set's own grid. |
| Mappers | In the sdk, three.js-free: irapbin, the store's surfaces, synthetic relief, any regular grid. Downloading and parsing a particular online source is a script's job, not the library's. |
| Tile core | Generic, in the sdk, not tied to what a tile holds. The chunks' level-of-detail helpers move into it unchanged. |
| Relief | Covers everything while enabled, the column included. Flat at a depth you set wherever no data set has data. |
| Bridge | Relief → chunk, in two parts: a plain-data SOURCE the host derives from the relief's props and hands the chunk from the first render, which its worker builds the column's top from; and a generic `HeightFieldClip` the stage publishes once drawn, which the chunk's faces are clipped against. Chunk → relief: each occupant's outline and cut, which the relief cuts itself with inside that outline. |
| Occupants | A list: the clip holds one region per occupant, and the relief one scoped cut per occupant. |
| Exaggeration | The bridge needs the stack's vertical scale to be 1; otherwise the stack warns and builds on its own seabed. |
| Relief off | The chunk draws its own seabed; the stage draws its flat seabed. The occupant no longer hands a seabed to the stage. |
| Separation | The chunk stack knows the relief only through the bridge — a source its worker samples with `sampleReliefSource`, and a height field to clip against — and the relief never reads surfaces. A column surface reaches the relief only if the host bakes it into one (see [Bake helpers](#bake-helpers)). |
| Data | Generated on demand by scripts into `public/relief/`, which git ignores. Nothing is committed. |

---

## 1. The relief contract

Two data sets in the store (see [data.md](./data.md)):

```ts
/** `relief-meta`: one record per relief. */
export type ReliefMeta = {
  id: string;
  name: string;
  description?: string;
  /** the credit the source asks for; for documentation, not drawn */
  attribution?: string;
  /** the map the grid is laid out in: a proj4 definition, or a name proj4 knows (`EPSG:4326`) */
  crs: string;
  /** the grid, laid out as an irapbin header lays it out */
  grid: {
    /** map coordinates of the south-west node */
    origin: Vec2;
    /** map units between nodes along the grid's X and Y */
    cell: Vec2;
    /** nodes along X and Y */
    size: Vec2;
    /** degrees counter-clockwise about `origin`. Default 0 */
    rotation?: number;
  };
  /** the lowest and highest heights it holds, metres above mean sea level */
  min: number;
  max: number;
};

/** The argument of `relief-values`: a window of one level of the grid. */
export type ReliefWindow = {
  /** 0 is the grid itself; each level up averages 2 x 2 values of the one below */
  level: number;
  /** the first value: column from the west, row from the NORTH, in the level's own grid */
  first: Vec2;
  /** values along X and Y */
  count: Vec2;
};

// `relief-values`, for a window:
store.get<Float32Array>('relief-values', id, window);
```

**Values.** `count[0] × count[1]` of them, row-major from the northern row: metres above
mean sea level, positive up, `NaN` where there is none — the convention `relief-values`
has today. The vertical datum is the host's to settle: a source on another one (EMODnet's
lowest astronomical tide, say) is shifted by its mapper's `offset`.

**Levels.** Level `L` is the grid averaged over blocks of `2^L × 2^L` nodes, counted from
the north-west node: value `(i, j)` averages the nodes `[i·2^L, (i+1)·2^L) × [j·2^L,
(j+1)·2^L)` (rows from the north) that hold data, `NaN` if none does, and lies at their
centre. A block at the grid's east or south edge averages what is there. A window may run
past the grid: those values are `NaN`.

> A host may point-sample a level instead of averaging it — WCS and ERDDAP do when asked
> for a stride — taking the node nearest the block's centre. It aliases (a coarse level of
> rough ground shimmers as the camera moves), and that is all it costs.

**What the library asks for.** Blocks: `count` is `[128, 128]` and `first` a multiple of
128, at any level. A host can therefore cache by `(id, level, first)`, or keep the data
pre-cut into such blocks. A host that holds the whole grid in memory answers with
`reliefWindow` (see [Mappers](#2-mappers)) in one line.

**Where it lies in the scene.** As today: the stage's `frame` (a `GeoFrame`, by default the
`World`'s) says where the scene lies on a map; each relief is projected from its `crs` into
it with proj4. Scene X runs east, Z south, and heights are drawn from the sea's `level`.

Why a window and not a fixed tile pyramid (`level/x/y`): a window is what a WCS
`GetCoverage` (bbox, width, height), an ERDDAP request (`[start:stride:stop]`) and cutting
a grid held in memory each do directly, so no host has to build a pyramid to serve one
grid — while asking only for aligned blocks keeps it as cacheable as a pyramid.

---

## 2. Mappers

In the sdk, three.js-free, so a store can run them in a worker. They turn whatever a host
has into the contract: `ReliefData = { meta: ReliefMeta; values: Float32Array }`, or
straight into a window.

| Mapper | From | What it settles |
|--|--|--|
| `reliefWindow(data, window)` | a `ReliefData` held in memory | cuts a window; builds each level the first time it is asked for, and keeps it with the values (`WeakMap`) |
| `gridToRelief(grid, options)` | any regular grid: `values`, `size`, `origin`, `cell`, `rotation?`, `crs` | `rows: 'north' \| 'south'`, the no-data value (a number or a test), `scale` (−1 for depths) and `offset` (a datum shift) |
| `irapbinToRelief(buffer, { crs, depth })` | an IRAP binary grid | its Fortran records and rotation; the undefined value 9999900 and anything past ±1e30 to `NaN`; depths (`depth`, default true) to heights. Shares a synchronous record reader (`readIrapbin`) with `parseIrapbin`. |
| `surfaceToRelief(meta, values, { crs? })` | a `surface-meta` record and its `surface-values` | the store's encoding (`max − value`, −1 for none) to heights; `crs` defaults to `meta.projection`, which must then be a proj4 definition |
| `functionRelief(meta, height)` | a height function of map X/Y | synthetic relief, computed per window where a reader places each value (`reliefLevelToNode`): nothing is held. Returns `{ meta, window }`, what a store hands out for `relief-meta` and `relief-values`; `min`/`max` estimated on a 129² lattice unless given |

All built (2026-10-25), tested in `tests/relief-mappers.test.ts`.

### Bake helpers

For a field with no bathymetry of its own, the column's seabed can be made a relief data
set, and then listed as a relief layer like any other:

- `surfaceToRelief` for a surface, plus `clipReliefToOutline(data, outline)`, which sets
  everything outside an outline (in the relief's `crs`; a ring, or polygons with holes)
  to `NaN`, so the layer covers the column and the layers under it take over around it,
  eased by its `feather`;
- `stackLayerToRelief(layer, frame, { grid })` for a synthetic chunk layer with a `depth`
  (and a `relief`), through `functionRelief` and the same procedural fields the chunks
  use (`procedural-relief.ts`), evaluated in the layer's scene and placed on the map by
  `frame`. A layer given by `offset` is measured from the layer above it, which a relief
  does not have: it cannot be baked, and throws.

They make relief data, nothing more: the relief still never reads a surface, and the
chunk still never knows its seabed was baked. In the story, the demo store serves the
generated sea bed baked with `surfaceToRelief` as the relief
`surface:synthetic:cap-seabed`, a layer to tick on.

### Online sources

Downloading a source and reading its format is a script's job
(`scripts/generate-relief.js`, one fetcher per source), and every fetcher ends in
`gridToRelief`. The demo data sets are **generated on demand, not committed**:
`npm run generate-relief` writes them into `public/relief/` (which git ignores) as raw
float32 grids, with a `ReliefMeta` each in `public/relief/relief-meta.json`;
`npm run generate-relief -- <id>…` writes only those named, and a data set already there
is skipped unless `--force` is given. A story whose relief is missing says which command
makes it.

| Id | Source | Area | Grid | Size |
|--|--|--|--|--|
| `etopo-2022-world` | ETOPO 2022, 60″, every 5th value averaged 2 × 2 to 10′ | the world | 2160 × 1080 | 9.3 MB |
| `etopo-2022-nordic` | ETOPO 2022, 60″, averaged to 2′ | 12°W–32°E, 49–72°N | 1320 × 690 | 3.6 MB |
| `etopo-2022-15s-sw-norway` | ETOPO 2022, 15″ | 1.5–6.5°E, 58–59.5°N | 1200 × 360 | 1.7 MB |
| `emodnet-2020-sw-norway` | EMODnet DTM 2020, 1/16′ averaged 2 × 2 (sea only) | 1.5–6.5°E, 58–59.5°N | 2400 × 720 | 6.9 MB |
| `emodnet-2020-volve` | EMODnet DTM 2020, 1/16′ (sea only) | 1.38–2.38°E, 58.19–58.69°N | 960 × 480 | 1.8 MB |

- ETOPO 2022: NOAA NCEI, public domain, DOI 10.25921/fd45-gt74, from NOAA's OPeNDAP
  server (the 15″ data from tile `N60E000`). The world's is read at a stride
  (`[j0:5:j1]`, the relief's `stride`): whole, the 60″ grid is 233 M values; every 5th,
  averaged 2 × 2, 9 M, a few minutes' download.
- EMODnet Digital Bathymetry (DTM 2020): EMODnet Bathymetry Consortium, free to use and
  redistribute with credit, DOI 10.12770/bb6a87dd-e579-4036-abe1-e649cea9881a, from
  ERDDAP (`dtm_2020_v2_e0bf_e7e4_5b8f`). Heights are above lowest astronomical tide, about
  a metre off mean sea level here; not corrected. No land: `NaN` there.
  - ⚠️ Its axes skip a cell here and there (ERDDAP says `evenlySpaced=false`): an index
    is NOT `(lat − first) × 960`, by 16 rows and 12 columns around here, which put the
    first version of the data 1–2 km off. The script reads each axis and takes the cell
    nearest each value of the regular grid it makes.
  - ⚠️ Its fill value is 0, which its `.asc` writes as it is (its CSV writes `NaN`):
    read as a height, the land under it is flat at 0 m.

`etopo-2022-nordic`, committed until now, leaves git: the script makes it as it makes the
others.

The demo store loads each file the first time it is asked for, and answers windows with
`reliefWindow`. The contract maps one to one onto a live WCS or ERDDAP request, so a host
can stream straight from such a server; the demo does not, so Storybook needs no CORS.

---

## 3. The tile core

In the sdk (`src/sdk/tiles/`), not tied to what a tile holds. Relief is its first user;
anything keyed by the same quadtree (a raster draped on the relief, say) can be the next.

### Addressing

A quadtree in scene X/Z (scene units, assumed metres, as the relief's are). Tile `(d, i,
j)` is `S / 2^d` wide, with `S` = 2^21 (about 2100 km) for the roots, and its min corner at
`(i, j) · S / 2^d`. Every tile is `T` cells across (default 32, see
[Open questions](#11-open-questions)), so at depth 11 a cell is 32 m and at depth 13, 8 m.
Keys pack into one number for maps and sets.

**The relief's tiles are geographic since 2026-10-26** (world.md
[step 6](./world.md#11-step-6-in-detail-tiles-on-the-globe)): keyed by latitude and
longitude (`sdk/tiles/geo-tile-keys.ts`), two roots of 180° x 180°, a tile at depth `d`
`180 / 2^d` degrees each way, packed as above. The X/Z quadtree stays for anything laid in
the scene's plane; the selection takes either (a `layout`, below).

### Choosing what to draw: `selectQuadtreeTiles`

Each frame, from the roots within reach:

- a tile whose prism — its square over its lowest and highest height — lies wholly outside
  the view is left out (the test `tilesInView` does for the chunks' tiles);
- a tile is split while its height error, times the pixels a unit spans at its nearest
  point (`pixelsPerUnit`), is over `pixelError`; it merges back only once under it by
  `LOD_COARSEN_MARGIN`, so a tile on the edge does not flip every frame (as
  `selectLodLevel`);
- a tile marked `leaf` — no data finer than it under it, by the data in its layers'
  windows, not only what its nodes took — is never split;
- **a split tile is drawn until all four children are in**, and those not in are wanted.
  Ground is never missing, and never drawn twice;
- a region may cap the error (the bridge does, see
  [Seams](#seams)): a tile over it is split while its error is over the cap, whatever its
  size on screen;
- **a tile is also split while its cells span more than `cellPixels` on screen**
  (built 2026-10-25), with the same margin to merge back. The error measures the shape
  only, and from high up even a mountain range's error is a pixel; but the relief is
  shaded from its tiles' cells — the normals, the coast, the colour by height — so with
  the error alone Norway seen from 1000 km was drawn from the 8 roots, 65 km a cell,
  blurred over 65 pixels. Only below the leaves (no finer data) does it stop. Default 8
  pixels:

  | Camera | `cellPixels` off (64) | 16 | 8 (default) | 4 |
  |--|--|--|--|--|
  | 1000 km, straight down on Norway | 11 tiles, 0.03 M triangles | 38, 0.09 M | 71, 0.16 M | 178, 0.41 M |
  | 300 km, 45° over the coast | 14, 0.03 M | 58, 0.13 M | 160, 0.37 M | 412, 0.95 M |
  | 100 km, straight down on the coast | 68, 0.16 M | 85, 0.20 M | 133, 0.31 M | 309, 0.71 M |
  | 2.5 km, the coast's horizon | 124, 0.29 M | | | 151, 0.35 M |

  8 costs at most what the coast close up already did; 4 is sharper still, at up to
  0.95 M triangles. Sharper for fewer triangles would be shading from a finer grid than
  the patch's (a tile's normals and heights at 4 x its cells), at 16 x the merge work
  per tile and its memory: kept for later.
- **only where the ground is rough: `minSlope`** (built 2026-10-25). The cells matter
  only where the shading varies across them. Split for its cells, Volve's flat seabed
  drew 216–236 tiles where 56–66 do now (relief 3.2 and 7.4 ms against 1.7 and 2.6). So
  the rule applies only to a tile whose error is over `minSlope` × half a cell, a slope
  that strays from the tile's by more than `minSlope`. The renderer uses 0.01. The error
  is measured against the pyramid's averages, so from far off even mountains show small
  slopes: 0.02 left Norway at depth 3 from 1000 km, blurred; 0.005 split the seabed
  again. With 0.01, Norway from 1000 km is 69 tiles of 4 km cells, and 300 km at 45° is
  138 tiles (the table above is without it);
- **but across a coast always** (built 2026-10-26): a tile that reaches both above and
  below the sea is `rough` (`QuadtreeTileInfo.rough`), split for its cells whatever its
  error: land and sea are shaded apart however flat it is. Without it, from 18 000 km the
  Earth stayed on its two roots, 627 km cells (their error, a few kilometres of averaged
  mountains, under `minSlope` × half a cell); with it, 24 tiles of 78 km cells. Over the
  coast from 300 km it draws 137 tiles where 122 did; Volve's seabed, Norway from 1000 km
  and the coast's horizon draw the same;
- **and where a finer layer ends** (built 2026-10-26): a tile is `edge`
  (`ReliefTile.edge`) where a layer finer than its cells has data in its footprint but
  does not cover all of its nodes, and the renderer takes it as `rough`. A layer smaller
  than a cell can give no node at all, so whether there is finer data under a tile is told
  by the data in the layer's window, not by what the nodes took: before, such a tile
  stayed a `leaf` at the base, and with only ETOPO 15″ over south-west Norway (300 km)
  the Earth stayed on its two roots from any height, the layer drawn only by the overview
  past the far plane — a disc of bare base around the camera hid it. Its error counts the
  layer's data lying between its nodes too (the window's range, widened by the layer's
  detail). Now the layer draws from every height: 8 tiles to depth 5 from 2840 km, 120 to
  depth 10 from 20 km;
- **and not under the ground:** with the camera below the ground under it, the tiles'
  tops face away, so their shading cannot be seen, and the renderer leaves `cellPixels`
  out. Below Volve's seabed that is 21 tiles instead of 45;
- out: the tiles to draw, and the tiles wanted, each with how many pixels its error (or
  its cells) is over the limit, for the streamer's order (as `orderTileChanges` orders
  the chunks').

**A layout (built 2026-10-26):** `layout` (`QuadtreeLayout`) lays the tiles out
otherwise: its roots, each tile's square in its own coordinates (for finer regions and
pins), how far a tile is, whether it shows, and how wide it is along the ground (for
`cellPixels`). The relief's geographic tiles pass one; without one, the tiles are squares
in X/Z as above. `selectPinnedTiles` takes the same.

The chunks' helpers `tilesInView`, `selectTileLevels` and `orderTileChanges` moved from
`components/Chunks/chunk-lod.ts` to `sdk/tiles/tile-lod.ts` (built 2026-10-25), exported
from the sdk; `chunk-lod.ts` re-exports them, so its callers and its tests are as they
were. Nothing about the chunks changed. What stays with the chunks: the
`TilePool` (one index buffer drawn at a level per tile) — their tiles are a fixed grid
with every level built up front, the relief's a quadtree loaded as it is seen. The same
rules choose both.

### Loading: `TileStreamer`

```ts
type TileSource<T> = {
  load(key: number): Promise<T | null>;
  /** what a resident tile holds, for the budget */
  bytes(tile: T): number;
};
```

- Wanted tiles load in order of their excess, at most `concurrency` at a time (default 4).
  A queued tile no longer wanted is dropped: the queue is replaced every frame.
- Resident tiles are kept least recently drawn first out, under a `budget` in bytes. A
  tile drawn this frame, or the parent of one, is never evicted.
- **Measured, and left out (2026-10-25):** aborting a tile in flight, and a budget of
  uploads per frame. At most 4 tiles are in flight, and a tile builds in 2–7 ms in the
  worker (100 ms for a layer's first, which reads its edge distance); an abort would
  save a few milliseconds of worker time. A tile uploads two texture layers (35² 32-bit
  heights and 16-bit normals, 10 KB together; `addLayerUpdate` sends only those), and at
  most `concurrency` arrive in a frame: nothing a budget would smooth.
- **A worker of its own (built 2026-10-25),** with no change to the library: the stage
  asks `useGenerator`, which the nearest `GeneratorsProvider` answers, so a host nests a
  second provider around the `Scenery`, with a registry on a worker of its own holding the
  sky's generators (`sceneryReliefTile`). Each provider connects to
  the store by a port of its own. The stories do it with `SceneryGenerators`
  (`storybook/decorators/scenery-generators.tsx`); FieldColumn's column builds, with their
  serial phases of one to two seconds, then never hold up a tile.

---

## 4. Relief tiles

### Building one

A generator, `sceneryReliefTile` — run where the generators run at first, and on a worker of
its own from step 3 (see [Costs and risks](#12-costs-and-risks)); its work is
three.js-free in the sdk (`buildReliefTile`):

1. **Footprint:** the tile's `(T + 1)²` nodes and a border of one, in scene X/Z.
2. **Per layer:** project the footprint into the layer's `crs` (proj4 on a lattice every
   8 nodes, interpolated between, as `resampleRelief` does); pick the coarsest level no
   coarser than the tile's cell; fetch the blocks under it (kept in the worker, least
   recently used first out, under a budget); resample bilinearly, counting only values
   that are not `NaN`, into a height and a coverage.
3. **Feather:** each layer's coverage fades in over its `feather` (scene units) from where
   its data ends — its outline and its holes, a coast without land data included. That
   distance is a property of the layer, not of a tile: it is computed once per layer, on a
   coarse level of it, and read per tile.
4. **Merge:** from the base — the flat seabed at the relief's `depth` — each layer in turn,
   finest last: `h = mix(h, layer, weight)`. A coverage of 1 hides everything under it.
5. **Out:** heights (32-bit; drawn as 16-bit floats about the tile's lowest height),
   normals (2 × 16-bit, from the bordered grid), the lowest and highest height, the error
   (the largest gap between the tile's surface and the merged data at its half-cell
   points), `leaf`, and which layer gave each node (8-bit, for the debug view).

Neighbours at the same depth share their edge nodes exactly: the same positions, the
same merge. Neighbours at different depths are closed by skirts (see
[Drawing](#5-drawing-the-relief)).

**Geographic tiles (built 2026-10-26):** the relief draws `buildGeoReliefTile`'s, the
same steps over a tile's longitudes and latitudes rather than scene X/Z, with no frame:
normals east and south where each node lies, errors, cells and feathers in metres
(world.md [6b](./world.md#6b-geographic-tiles-built-2026-10-26)). `buildReliefTile`
builds a tile in a frame as before.

**Round the Earth.** A layer in longitude and latitude, not turned, 360° across — or 360° and
its first column repeated — holds every longitude (`reliefWrapColumns`). The reader takes its
columns round rather than clamping them: a window across the antimeridian reads the last
columns and the first side by side (at a coarse level whose columns do not add up to whole
ones, the nearest), its edge distance meets east and west, and a feather never fades it
there. Without it a tile ending at 180° had no data in its last column or its border, and the
minimap and the overview drew a line along the antimeridian.

**The detail under a tile (built 2026-10-25).** The error at the half-cell points is
measured against the level under the tile's: averages. A layer much smaller than a
tile's cells, over a flat base or smooth data, averages away there, so the tile reported
no error and was never split (StageDebug's 16 km ground stayed on the 65 km roots until
the camera was within 1.2 km). So each layer also bounds its detail once, when the reader
prepares it, from the coarse level its edge distance is read from (at most 512 values a
side): each level above it averaged from the one under it, and per value the most the
values under it lie off its surface, read bilinearly as a tile reads it, plus their own.
A plane lies on every level's surface and has none; a hill narrower than a level's values
is all detail there. A tile's error is the larger of its measured gap and the most detail
of the level under its own, over its footprint, of any layer under it. Finer than that
level, the tile reads the data itself.

- **Seen in StageDebug:** its ground shows from 30 km (128 m cells at a hill), where it
  needed 1.2 km.
- **The demo reliefs are unchanged:** with the bound on and off, at eight poses from
  40 m over Volve to Norway from 1000 km straight down, the same tiles are drawn (Volve
  40 m 56 tiles, 2 km 66, 100 km 109, 600 m under the seabed 17; Norway from 1000 km 59;
  the coast from 300 km 142, at 2.5 km 143; Lysefjord 36). Their own data is rough where
  it matters, so their tiles split anyway; the frame costs what it did. (Bounded from a
  level twice as fine, at most 3 tiles differed, for 100–165 ms per layer.)
- **Once per layer:** about 30 ms more for a layer as large as the bound is read at
  (512² values), in the worker, before its first tile.
- **Not occluded:** a layer's detail counts wherever it lies under the tile, even where
  a later layer covers it. That only splits a tile where a coarse layer is rough under a
  smooth finer one.
- **Skirts** drop by the tile's error, so they now close the cracks a coarse tile leaves
  against finer neighbours where its layers hold detail.

### Sampling the same ground elsewhere

`sampleReliefSource(reader, source, grid)` runs steps 2–4 onto any regular grid in the
scene: the same layers, merged the same way. The chunk's worker builds the column's top
boundary with it (see [the bridge](#6-the-bridge-relief-to-chunk)); a tile is just one
call of it.

Built (2026-10-25): the grid is `ReliefSampleGrid`, an origin and the steps along its
columns and rows, so a column's rotated grid fits as it is; one node wide too, a single
point or a route as a row. The tiles share its reading
and merging (`readReliefLayers`, `mergeReliefLayer`); only their half-cell points, for
the error, are their own. Tile output is unchanged bit for bit, and a tile's nodes
sampled as a grid are its heights exactly (tested).

### The overview

Built (2026-10-25) as the single-texture relief's own machinery, reused rather than a new
generator: when the camera's far plane falls short of the farthest horizon, the stage
draws the relief's FIRST, coarsest layer on a fullscreen far layer
(`SceneryStageReliefOverview`): land flat on the curved sea, at the far plane, past where
the tiles end. The first layer stands for the merge out there: past a few hundred
kilometres the finer layers are regional and lie nearer. The `ShortFarPlane` story (a
200 km far plane) shows it.

**Geographic since 2026-10-26** (world.md
[6d](./world.md#6d-the-whole-globe-built-2026-10-26)): the `sceneryRelief` generator resamples
the first layer onto longitude and latitude over all of it (`resampleReliefGeographic`,
at most 4096 texels a side, all the way round for a world relief), and the far layer reads
it where each view meets the globe's sea (`globeGeographic`): from anywhere, the far side
of the Earth included, with any far plane. It was resampled in the map around the scene
over 2000 km, so it ended there. It is made the first time the ground in view reaches past
the far plane (a far plane that always reaches it costs nothing; the world's at 10′ is
about 12 MB on the GPU), and compiled in the background before it shows. With a world
layer first, the overview is the world's 10′ (18 km), coarser near the field than the
Nordic layer's 2′ was.

**Every layer since 2026-10-27, merged and looked as the tiles.** The first layer alone
stood for the merge on the assumption that past a few hundred kilometres the finer layers
lie nearer. A short far plane seen from high up breaks it: from 472 km over the North Sea
with a 500 km far plane, the ground just past the far plane lies right below, under the
Nordic layer, and the tiles' disc (165 km about the nadir, at the Nordic 2′ and finer)
stood in a sea of the world's 10′. So each layer was baked on its own onto longitude and
latitude (the `sceneryRelief` generator), and the far layer merged them per pixel as the
tiles do, at most six (a texture unit each): the demo's five were about 31 MB on the GPU.
Checked at the pose above, the disc was gone, and the coasts and contour lines ran on
across where the tiles end.

**From the tiles since 2026-10-29.** Baking a layer whole does not scale: the generator
read level 0 of the entire grid (`count: meta.grid.size`) before downsampling it — for a
terabyte layer, all of it — and the shader's cost and the texture units grew with the
number of layers. Now the overview draws the relief's own tiles, as the `Minimap` does
([minimap.md](./minimap.md)):

- **Chosen in the tiles' frame loop** (`SceneryStageReliefTiles`), by a second
  `selectQuadtreeTiles` over the same geographic layout and the same rules (error,
  `minSlope`, coasts), but out to the horizon (`seen`) with the camera's frustum less its far
  plane, no deeper than `OVERVIEW_MAX_DEPTH` (14: 38 m cells), and leaving out tiles wholly
  within the tiles' reach (their nearest point and twice their width). Its cells may span at
  most `OVERVIEW_CELL_PIXELS` (2) on screen, not the tiles' `cellPixels` (8): it colours,
  lights and draws its coast per pixel from the tiles' heights, where the tiles are geometry
  lit from filtered normals — at 8 the coast far off stepped in blocks of cells. For the same
  reason every tile reaching above the sea — and with the water off, every tile — is split by
  its cells' size however flat (`rough`): `minSlope` kept plains, lakes and the seabed at
  20 km cells from 3500 km up. Under the water only a slope's shading would show, and the
  water hides it.
- **One choice per pose.** Should it want more than `OVERVIEW_SLOT_SHARE` (half) of the
  slots, or tiles deeper than its index holds over the region they cover (below), it is
  chosen again in the same frame — coarser on screen by half, or no deeper — at most
  `OVERVIEW_BUDGET_ATTEMPTS` (3) times, always from the finest. It first adapted across
  frames (a quarter coarser while over its share, finer once under half of it), which left
  it as coarse as the way to a pose had made it: 4.9 px cells over Europe from 3500 km where
  2 were asked for, and a zoom that stepped finer, coarser and finer again. Now a slow zoom
  out from there trades depth 6 for 5 steadily (156 → 136 tiles at 6 over a fifth more
  height), and the same pose settles on the same tiles (450) each time.
- **Shares the tiles' streamer.** Without `fill`: a tile is drawn until its four children
  are in. Its kept and wanted tiles go into the same `TileStreamer.update` as the tiles', so
  it shares their streamer, their slots and their textures: no maps of its own on the GPU,
  and the coarse tiles it wants are mostly the ancestors the tiles keep anyway.
- **Read per pixel through an index** (`SceneryReliefAtlas`, `relief-atlas.glsl`): the
  tiles drawn, by `buildHeightFieldIndex` over the region they cover in `geoTileSquare`'s
  coordinates (longitude east, latitude south), built again only when they change. The
  index's entries are as wide as its narrowest tile, at most `OVERVIEW_MAX_ENTRIES` (512)
  along a side — 4 MB — so over a region too wide for its finest tiles it is chosen no
  deeper than the region allows (above). Seen
  from 100 km over the coast with the 200 km far plane, the region is about 24° across and
  the overview reaches depth 11 (306 m cells, about a pixel there).
- **The index's entries lie on the tiles' grid** wherever the coordinates are taken about:
  `buildHeightFieldIndex` aligns them to its narrowest tile, as it always said, not to the
  coordinates' origin. Before, a tile given about a point off the grid (the minimap's, about
  its view's middle) left the entries whose middle fell just outside it empty: half the
  minimap stood blank. The ground handed out over a region (about its middle) was off the
  same way, its gaps filled from `fill`.
- **Merged and looked as the tiles**, since it is their data: the height bilinear between
  a tile's nodes, the look of the layer that gave the nearest node, and how much of it a
  layer gave (0 over the base, where the background's own sea and seabed show, as before).
  The normal's four samples are a footprint apart, no finer than the tile's cell there.
  Where no tile is in yet, it is not drawn.
- **No layer cap, and nothing read but what is seen.** `SCENERY_RELIEF_FAR_MAX_LAYERS`,
  `createSceneryReliefTexture`, `relief.glsl` and the `sceneryRelief` generator are gone;
  `resampleReliefGeographic` stays in the sdk.
Not done: drawing the overview under the tiles while their roots load (a moment at
start-up only).

---

## 5. Drawing the relief

```tsx
<SceneryStage
  bounds={bounds}
  relief={{
    frame,                                     // where the scene lies on the map
    layers: [                                  // later layers win where they have data
      { id: 'etopo-2022-nordic' },
      { id: 'etopo-2022-15s-sw-norway', feather: 2000 },
      { id: 'emodnet-2020-sw-norway', feather: 1000 },
      { id: 'emodnet-2020-volve', feather: 500 },
    ],
    depth: 120,                                // where no layer has data; default the sea's depth
    color: 'ramp',
    pixelError: 2,
  }}
  occupants={[{ outline, cut, onStage, onGround }]}
/>
```

- **One draw:** a `T × T` patch with a skirt round it, instanced once per tile drawn. Per
  tile: its edges on the globe (its west and east longitude, its north, middle and south
  latitude, as offsets on the conformal sphere from the disc's centre), its depth, slot
  and skirt's drop. Heights and normals sit in two
  `DataArrayTexture`s (16-bit floats), one slot per resident tile; the layer ids in a third
  only while the debug view asks for them. The vertex shader reads its node with
  `texelFetch`, and a skirt vertex drops by the tile's error.
- **Soft swaps (built 2026-10-28; until then no morph, a tile changing depth popped by up
  to `pixelError` pixels and its shading jumped):** `relief.transition` (default 300 ms).
  Each tile drawn blends from the tile it replaces (`TileTransitions`, `sdk/tiles`), both
  in the texture arrays: per instance a `reliefTileFrom` (where it lies in that tile,
  `tileOffsetIn`, and that tile's slot) and a `reliefTileBlend`.
  - The vertex shader mixes its node's height with the source's at the same place, on the
    source's triangles (`reliefTileTriangleHeight`, the GLSL twin of `heightFieldPatchAt`),
    so a split starts exactly on what the parent drew: a geomorph.
  - The fragment shader mixes the per-pixel height (colour, coast) and the normal the same
    way.
  - On a merge the children stay drawn, blending back toward the parent, and are replaced
    by it when they look the same — when they cover it all; else at once.
  - A blending tile's skirt drops as deep as its source's error.
  - **Never a hole**: a tile drawn stays drawn (a stand-in) until the tiles chosen in its
    place are in and cover all of it that is in view; those in already wait for the rest,
    so nothing is drawn twice. The relief's choice already draws a parent until its four
    children are in, so this matters most for the overlay (layers.md), which chooses tiles
    not in yet.
  - The relief appears at once where nothing was drawn (an opaque fade would need
    dithering).
  - **Fixed (2026-10-28), what was seen then:** while the view shifted quickly or zoomed
    out, the relief at times showed a hole (the sea's blue) for a moment, and fell back to
    its coarsest tiles for about 80 ms after a large zoom-out before finer ones loaded.
    - **The hole:** a merge under way (its finer tiles held, blending back toward it) taken
      over by a coarser merge, or none, as a fast zoom-out goes on; its held tiles were let
      go at once, with nothing yet drawn over their area. `TileTransitions` now hands them
      back as ordinary drawn tiles, which the new choice keeps as stand-ins or holds for its
      own merge (`tests/tile-transitions.test.ts`, which fails without it).
    - **The coarse fallback: fills.** A split tile some of whose children in view are in no
      longer draws whole: its children in are drawn, each as chosen, and the squares of
      those not in are *filled* from it (`selectQuadtreeTiles`'s `fill`; `fills`). A fill
      is an instance in the child's square that samples the parent's data all the way
      (`reliefTileFrom` at blend 0: heights, normal, the layer look), so the children and
      the fills cover the parent exactly; `TileTransitions` takes them as in (`proxy`), and
      once the child's own tile is in it blends from the parent as a split does. The
      grounds handed out index a fill's source after the tiles drawn.
    - **Prefetch:** the siblings of each drawn tile's parent are wanted last
      (`prefetch`, `PREFETCH_TILE_PRIORITY`), and kept in once loaded, so a zoom-out finds
      the next level in.
    - **The frustum** is built from the camera's matrices of this frame
      (`camera.updateMatrixWorld()` first): controls move the camera before the frame loop
      but leave its matrices to the render. Measured, it changed nothing in the story; kept,
      as `useChunkLod` does it too.
    - Measured on Minimap/Subsurface (the relief alone drawn, the sea dry, so any gap is a
      pixel left at the clear colour): a zoom-out from 2 to 200 km in 40 frames had 7 frames
      with gaps (0.31 % of the view at worst), now none. During a zoom-out from 1.5 to 90 km
      the deepest tile drawn stays the finest (12) throughout, up to 29 of the instances
      fills, none once loaded. What is left: under 0.3 % of pixels, at the screen's edge,
      for a frame, when panning at 5 km a frame.
  - **Not over the ground handed out** (`grounds`, a column's `HeightFieldClip`): those tiles
    swap at once (`fixed`), so what meets the relief there meets what is drawn exactly.
  - Settled tiles take the old path (one branch per tile); the bookkeeping cost 0.2 ms a
    frame in `FieldColumn` while the camera moved.
- **The choice's cost (2026-10-28):** with the camera held still it ran in full every frame,
  some 7–9 ms of main thread over Volve (10k globe calls a frame: each tile's box rebuilt
  from up to 98 points, its corners and the eye placed on the sphere again for every
  tile, its distance found twice). Now:
  - **Nothing changed, nothing done:** the choice, the instances and the grounds handed out
    stand while the camera's matrices, the viewport, the tiles in, the pins, the grounds
    asked for and the props that feed the choice hold, and no swap is blending, as
    `GeoPolygons` already did.
  - **Kept per globe** (`geo-tile-globe.ts`, by `Globe.version`, at most 16k tiles): each
    tile's corners on the sphere and its box between two heights; the eye's place once per
    frame; each tile's distance once a frame (`geoTileLayout`).
  - Measured (Minimap/Subsurface, dev build): held still at 3 km, 300 km up or grazing, 0
    globe calls a frame (was 10k–25k); main thread 1.4 ms a frame in all (was 7.4). Moving
    at 3 km, about 1000 a frame (`tests/geo-tile-cache.test.ts` checks the kept answers
    against a fresh globe's).
- **The rest is today's relief:** the coast per pixel from the height map, the colour ramp,
  the land fading through the air, the drop with the Earth's curve, the cutaway, and the
  layer past the far plane (from the overview).
- **The stage:** with a relief, the stage draws no seabed of its own — the relief is the
  seabed, flat at `depth` where no layer has data. Without one, its flat seabed covers
  everything, as today without an occupant's seabed.
- **See-through (built 2026-10-25):** below the sea's `seabedOpacity` of 1, the tiles
  over `bounds` are drawn a second time (`createSceneryReliefTileSubset`: the same patch,
  instances of its own) with a see-through variant
  (`createSceneryReliefTileSeeThroughMaterial`, OIT-wired as the stage's see-through seabed),
  which keeps only what lies inside `bounds`, at the seabed's opacity; the opaque draw
  leaves it out (`RELIEF_STAGE_AROUND`). The see-through draw has no skirts: two
  see-through skirts over each other would show as a line. That leaves a crack only while
  a finer tile next to a coarser one is loading.
- **The occupants' cuts:** the relief cuts itself with each occupant's `cut` (its section
  plane and fence, bound with `applyFenceField` as every fence-cut material is), but only
  inside that occupant's `outline`: a signed distance field of the outline (sdk
  `polygonDistanceField`, read with `sampleFieldMap`, as a fence's is) says where. Each
  occupant with a cut compiles in one more, up to a small fixed number (4). Inside an
  outline the cutaway takes the water but not the seabed, as it does for an occupant's
  seabed today.

  Built (2026-10-25), with these changes:
  - **The relief stays whole by default.** An occupant's `keepBed` (default true with
    tiles) keeps the relief over it as its floor, whatever its cut takes of the occupant,
    as a sea kept whole keeps its bed. Off, the relief is cut with the occupant inside its
    outline. Whether the relief should be cut at all is open, so cutting it is opt-in.
  - **One occupant cuts it, not 4.** `shaderLib/fence-field.glsl` declares one fence's
    uniforms, so a shader holds one fence. Several would mean passing its textures
    around, in a shader the chunks, the ocean and the stage share. Only one occupant may
    turn `keepBed` off; past one, the stage warns and the first cuts it.
  - **Up to 4 outlines, in one texture.** Each occupant's `polygonDistanceField` (256
    texels a side, exact within 4 of the boundary, so a straight edge is found exactly) is
    a square of one float texture (`SceneryReliefOccupantFields`). The shader reads it with
    `texelFetch`, each read clamped to its own square, through one sampler and a
    uniform array of frames. Every outline keeps the cutaway off the ground over it; the
    cutting occupant's says where its cut applies.
  - **The cut is tested where the ground lies flat** (`vReliefFlat`: the height without the
    curve's drop), the frame the occupant's cut and the column are in. While it opens, the
    sky draws the void's walls, as for the occupant's seabed (`abyssOpenings`).
  - **Seen in `FieldColumn`** (`reliefCut`): a section opens the relief inside the outline
    on its side only, down to the column's cut face, whose top meets the relief's cut edge
    on one line at 700 m. With `keepBed` on, the relief stays whole over the same cut. With
    the cutaway on, it bites the sea and the relief around the field, and the relief over
    the outline stands, the column's walls meeting it.
- **The ground under the camera (built 2026-10-25):** read on the CPU each frame from the
  finest tile in under the camera (`geoReliefTileHeightAt`, the tile found with
  `geoTileKeyAt` at the camera's latitude and longitude), drawn or not. Below the sea it
  is the sky's `oceanGround` wherever no
  occupant's seabed is under the camera, at whatever depth (since 2026-10-28; it was held
  no deeper than the sea's own seabed, which put a camera in a trench in the void); so the
  sky knows the camera is under the ground anywhere the relief has data, and the
  lighting, the water and the void follow. Over the ground in a trench, below the sea's
  own seabed, the camera is in the water (`SceneryMaterial.oceanTrench`): the background's
  layers see as from just above that seabed, as they see from just below it in rock
  (`oceanBuried`).
- **The relief from below (built 2026-10-28; it replaced the skirts' test below):** under
  the ground the relief is the void's lid. The same tiles are drawn with a second
  material instead (`createSceneryReliefTileFromBelowMaterial`, `RELIEF_FROM_BELOW`): their
  back faces alone, shaded as the lid the background draws — with walls the sand's
  underside in their haze (`skyAbyssLidFacing`), without the void's own lid
  (`skyAbyssCeiling`), both raked by the walls' light by the way they face
  (`skyAbyssLidRake`), so the ground's shape shows, and level, the two lids meet in one
  colour. With walls, a pixel the walls' rock stands in front of is left to the background,
  as the stage's flat lid leaves it. Nothing above the lid is drawn from there — not the
  water, the land, nor a trench's floor deeper than the camera — and a skirt is shaded as
  the lid it hangs from, so the cracks show none. Both materials are compiled with the
  stage; the frame shows one pair of meshes or the other (opaque and see-through).
  - **It ends at the horizon:** inside the globe's sphere, ground higher than the camera
    is met below its level only where the sphere curves it away, a band past the flat
    lid's end. It is left to the void's depths, as the background's lid leaves it, so the
    lid ends at the horizon as the flat one does; what lies deeper than the camera (a
    trench's walls across the void) is still drawn there, fading with distance into the
    depths the background draws below the horizon, not into the lid's horizon colour
    (without walls; with them it fades to black far from the hollow, as they do): a deep
    basin's floor tens of kilometres off is gone, not pale streaks cut at its tiles'
    edges. The debug tint (amber relief,
    red background) shows the line, and `debug.relief` its tiles from below too. Leaving
    out of the choice tiles wholly below the camera's level changed no count (the few at
    the horizon are the ones overhead), so the choice is as above the ground.
  - ⚠️ Until 2026-10-28 the tops were drawn from below too, every pixel above the camera
    dropped (`reliefTileHiddenFromBelow`), and what lay deeper (a trench seen from the
    void) shaded as seen from above through the water: blue streaks along the horizon in
    the void, and with walls inside the hollow. The lid itself was the background's,
    flat at the sea's depth.
  - `vReliefSkirt` is `flat`, from each triangle's last vertex (the provoking vertex in
    WebGL 2), which the patch's index order makes a skirt's lower edge on a skirt and a
    grid node on the grid (`tests/scenery-relief-tile-patch.test.ts`); the see-through
    draw's leaving out of skirts (`reliefTileLeftToOther`) relies on it. Interpolated, a
    skirt seen edge-on far off, a sliver under a pixel, is sampled past its edge.
- **From in the water (2026-10-28):** land seen from in the water is seen through it, as
  the seabed is: fogged over the stretch of the view under the sea surface, without the
  graticule (the sea's surface draws it). Before, only ground below the sea took the water,
  and land on the horizon showed through it. Below the horizon, where the stage's seabed
  is opaque and nothing opens it, the background's water layer draws the water's own view
  under the stage too, so the pixel or so a relief deeper or shallower than the sea's
  depth leaves short of the horizon shows water, not the void (a black hairline).
- **Debug (built 2026-10-25):** `debug.relief`: `'tiles'` tints each tile by its depth
  and outlines it, `'layers'` colours each node by the layer that gave it (grey for the
  base; the tiles' layer ids are uploaded as a third texture, 1 byte a node). An
  `'error'` view is left out: the error is a tile's, which `'tiles'` already shows by
  depth.

### The Earth's curve, and what lies on it (built 2026-10-25; a fixed globe since 2026-10-26)

The sky draws the Earth as a fixed globe (world.md
[step 2](./world.md#9-step-2-in-detail-the-sky-on-a-fixed-globe)): a sphere fixed below
the scene, its cap over the stage's disc cut flat. The relief's vertices are placed on it
by their latitudes and longitudes (`globeGeodetic` in `relief-tiles-vertex.glsl`, since
2026-10-26; before, `globePlace` at their map X/Z), their height and skirt along up there.
Nothing is measured from the camera but the horizon, so the relief
and the sea hold still against each other as the camera moves or turns.

- **What is drawn flat goes onto the globe, rigidly.** `SceneryAnchor` (inside the `Scenery`) and
  `SceneryStageOccupant.anchor` (a group outside it, such as the field's `UtmArea`) place
  it where the globe has its point, turned to the up there (`placeOnGlobe`). Over the disc
  that moves nothing, so a field never moves; across what is placed the plane and the
  globe part by `d² / 2R`, about 5 m at 8 km from its point. `UtmPosition` and
  `Wgs84Position` place flat ([world.md, For a host](./world.md#for-a-host)).
- **Land past the horizon stays behind.** Where the triangles miss the curved sea, the
  relief brings land in front of the sea it should clear. Where the tile holds the point the
  view meets the sea, its ground there decides: land, or open water with the land past the
  horizon, reached only under the sea where the coarse tiles' chords sag. Where it does
  not, land met within two of its cells of the sea stands for that point; farther, the sea
  is met over open water well in front. Land past the horizon is discarded rather than left
  for the stage's sea to hide by depth: the stage leaves a few pixels at the horizon to the
  background, and claims nothing far off or from space, so tiles behind the Earth's bulge
  showed there as dark dashes (2026-10-27). (Judged by the fragment's own height alone, the
  UK's coast showed as bright streaks below the horizon from 300 km off.)

Before the globe (2026-10-25) the sky lowered its sea beyond a flat disc, measured along
each view's level line from where the view left the disc. Seen from far off to one side
that drop depended on the view's direction — a point's drop changed by up to 4.5 km as the
camera turned at 40 km near Stavanger — so the relief rose and sank as the camera orbited.
The curve then followed the camera far off (`followAway`, `followFlatSea`, the disc moved
under the camera from 5 to 40 km past its edge), and the anchors were lowered and tilted
each frame (`placeOnSkyCurve`). The globe made both unnecessary.

### What it publishes: a `HeightFieldClip`

The relief as drawn, for anything that must meet it exactly, through `onGround`. It is a
generic sdk type, not a relief one, so what consumes it (the chunk) knows nothing of the
relief, and anything else that draws ground could hand one out:

- `heightFieldClipAt(xz)` in GLSL (`shaderLib/height-field-clip.glsl`), over a list of
  regions, one per occupant: an indirection texture over each region, one entry per finest
  tile, gives the slot and depth of the tile drawn there; the height is then the drawn
  triangle's, read with three `texelFetch`es and the patch's own diagonal. It is exact to
  what is drawn, whatever the depth.
- `heightAt(x, z)` on the CPU, from the same tiles.
- `margin`: the most the ground as drawn strays from its data over the regions.

Built (2026-10-25), one region per occupant, each handed out through the occupant's own
`onGround` (so the GLSL reads one region, not a list):

- **The type** is `HeightFieldClip` in `sdk/materials/height-field-clip.ts`: its
  `uniforms` (the tiles' heights array, the index, the region and `x` live, `y` the level
  heights are measured from, `z` the lowest ground, `w` cells per tile), `heightAt` and
  `margin`. The index is built by `buildHeightFieldIndex` (`sdk/geometries`, free of
  three.js). Its entries are as wide as the narrowest tile drawn over the region and
  aligned to it: 2 x 2 entries of 32 km over the field seen from 13 km, 9 x 8 of 2 km
  close up. It is built again only when the tiles drawn there, or those in, change.
- **Tiles out of view count too.** Only tiles in view are drawn, but a face in view may
  stand over ground that is not; an entry no drawn tile covers takes the finest tile in
  at its middle.
- **GLSL:** `heightFieldGroundAt(p, out ground)` and `heightFieldClipped(p)`. Below the
  lowest ground in the region nothing is read: one compare for most of a column.
- **For consumers built before there is a clip:** `createHeightFieldClipBinding()` gives
  uniforms that read whichever clip is `set`, or clip nothing. The materials are compiled
  once and follow the clip as it comes, goes and changes, with no copies and no lag.
- **Live only while the ground is drawn** (the stage draws the occupant's seabed, and the
  relief is shown). Otherwise the column draws its own top, which the clip would remove.
- **A warp (built 2026-10-26):** the relief's tiles are squares in degrees, not in X/Z,
  so the clip takes X/Z into their coordinates first: `heightClipWarp`, a quadratic
  about the region's middle (`heightFieldWarp`; `HEIGHT_FIELD_NO_WARP` for tiles in X/Z),
  fitted by the relief whenever the region or the globe changes. It is off by millimetres
  on the ground at a field's edge (world.md
  [6c](./world.md#6c-the-relief-drawn-from-geographic-tiles-built-2026-10-26)).

---

## 6. The bridge: relief to chunk

The two components stay apart and the host connects them, as today. The bridge comes in
two parts, because the chunk needs them at different times:

- the **source** at BUILD time: plain data the host derives from the very props it gives
  the stage (`reliefSource`), so the column is built on the relief from the first render
  and never once without it first;
- the **clip** at DRAW time: the `HeightFieldClip` the stage publishes through the
  occupant's `onGround` once the relief is drawn.

```tsx
const relief = { frame, layers };
const source = useMemo(() => reliefSource(relief, ocean), [relief, ocean]);
const [ground, setGround] = useState<HeightFieldClip | null>(null);
const [cut, setCut] = useState<CutUniforms | null>(null);
const [stage, setStage] = useState<SceneryStageOccupantState>(OFF_STAGE);

<Scenery>
  <SceneryOcean {...ocean} />
  <SceneryStage
    bounds={bounds}
    relief={relief}
    occupants={[
      { outline, cut: cut ?? undefined, onStage: setStage, onGround: setGround },
    ]}
  />
</Scenery>
<ChunkStack
  outline={outline}
  seabed={seabedId}
  relief={source}
  clip={ground ?? undefined}
  onCut={setCut}
  drawWater={!stage.water}
>
  <Chunk layers={...} />
</ChunkStack>
```

```ts
/** Plain data: what a worker needs to sample the relief as the stage merges it. */
type ReliefSource = ReliefTileSource & {
  /** scene Y of mean sea level: the sea's `level` */
  level: number;
  /** how far above the relief the column's top is built (see Seams) */
  margin?: number;
  /** a content key: the column is rebuilt when it changes */
  key: string;
};
```

Built (2026-10-25): `ReliefSource` in the sdk (`geometries/relief-tiles.ts`), the tiles'
source (`frame`, `layers`, and `base`, the flat seabed's height where no layer has data)
plus the sea's level, the margin and the key. `reliefSource(relief, ocean, margin?)` in
`components/Scenery` derives it from the stage's `relief` and the `<SceneryOcean>`'s props with the
sky's own defaults, keyed by its content, so it may be built inline. It is `undefined`
for a relief drawn from one texture. `margin` defaults, in `ChunkStack`, to its
`maxError` (5 m by default; see Seams).

### The relief is the column's top

While `ChunkStack` has a `relief`:

- the layer it declares as its `seabed` is replaced, in the spec, by a layer backed by the
  relief: `{ relief: source }`, a third kind beside a surface and a synthetic layer. The
  column's key gains the source's, so the shared column cache keeps them apart;
- the column's worker builds that layer's channel with `sampleReliefSource` on the
  column's own grid, in scene Y (`level + height + margin`), covered everywhere;
- everything after that is the column as it is today: the depth order cuts away whatever
  units lie above the relief, the top unit reaches up to it, and the walls, sections,
  fences and water body are built against it as against any surface;
- that layer's cap is drawn only while the stage does not draw the ground over the column
  (`onStage.seabed`, as today): until the relief is compiled and in, the chunk's own top
  stands in for it;
- placing things on what is drawn (`surface-sampler`, `LevelledBase`) reads the top from
  the clip's `heightAt` while there is one.

Built (2026-10-25), with these differences from the above:

- **No third kind of layer.** `relief` already names a synthetic layer's procedural
  relief, so the sea bed keeps its own layer spec (its id, and its header, which still
  plans the common grid) and gains `reliefSource`. `stackColumnSpec` sets it on the
  column's sea bed while the stack has a `relief` and the column holds its sea bed, and
  adds the source's key to the column's. Every chunk and the sea are built from that one
  column, so they all get it.
- **The shared column only.** In the worker, a layer with a `reliefSource` is merged
  onto the common grid (`sampleReliefSource`) instead of fetched and resampled, with its
  mask all data. A chunk built on its own (no `outline` or `cutSource`) keeps the
  surface, and the stack warns.
- **Exaggeration found from the stack's frame.** The stack's own group is an identity, so
  its world matrix shows a scale on any group above it; checked each frame.
- **`onStage.seabed` is the relief's now (built ahead of step 4c):** with tiles the stage
  reports it whenever the relief draws, and no longer draws an occupant's seabed mesh,
  which would lie on the relief's own ground. So the column hides its sea bed's cap, as
  it did for the mesh. The occupant's cut does not cut the relief yet (step 4c).
- **Measured** in `FieldColumn` (`reliefTiles`): along the outline the top wall's upper
  edge lies on the relief as drawn, median 0.00 m, within −2.6 to +1.1 m. The spread is
  the drawn tiles' (64–128 m cells over Volve's flat seabed) against the column's finer
  grid; the clip is what closes it (Seams).
- **The bed tint (built, 2026-10-26).** A stack drawing its own water tints its bed from
  the column's bed CHANNEL, which the `stackWater` generator now hands back with the sea
  (`StackWaterResponse.bed`, packed by `buildChannelDepthMap`): on a relief column that
  is the relief plus the margin, the bed the sea and the chunks are built on.
  `useStackBathymetry`, which read the raw bed surface, is gone. Measured in `FieldColumn`
  (sky on, `drawSky` off): the cap's vertices land on texel centres (10 325 of 10 586),
  their heights within ±5 m of the map (the cap's `maxError`), mean −0.08 m; switching
  the relief on lifts the whole map by the 5 m margin, a new texture replacing the old.

⚠️ **Vertical exaggeration.** A stack may carry one (`scale={[1, k, 1]}`); the relief
does not. With `k ≠ 1` the column's top would not reach the ground, and no clip can mend
that, so the stack warns and builds on its own seabed, as without a relief. Exaggerating
the relief and the sea's seabed with it is left for later, if it is wanted.

### Seams

The column's top is built `margin` ABOVE the relief, and every wall, section and fence
face compiles `CHUNK_HEIGHT_CLIP`: a pixel above `heightFieldClipAt` is discarded. A face
therefore ends exactly where the ground is drawn, at any depth of its tiles. For that the
faces must reach the drawn ground, so over each occupant's region the relief caps its
error at `margin`, whatever its size on screen. A cap that comes within `margin` of the
relief (the build reports which) clips too; the others lie well under it and are spared
the lookup. The clip goes everywhere the face's material goes: its picking twin, so what
is clipped away is not picked, and its OIT variants.

The relief's own cut is per pixel, and so is the faces' clip, so the relief's cut edge and
the top of a section face are the same line.

Built (2026-10-25), with two changes:

- **Half a pixel over the region, not an error cap at `margin`.** A face stands off the
  ground only where the ground is drawn above the column's top, and then by no more than
  the tile's error. So over the occupant's region a tile's error may show no more than
  half a pixel (`QuadtreeSelectOptions.finer`): a gap is never seen, and from afar the
  region asks for no finer tiles than it needs. `margin` covers the column's own
  tessellation, and defaults to `maxError`. The stage and the stack share no number.
- **Every chunk material compiles the clip** while the column is on a relief: walls,
  caps, section and fence faces, the peel patches, the inference overlay, their picking
  twins and OIT variants. No build reports which caps come near the relief: below the
  lowest ground the shader reads nothing.

Measured in `FieldColumn` (Iris Xe):

- **Every wall top stands above the ground as drawn:** along the outline, at 288 points,
  2.5 to 6.1 m above it (median 5.0, the margin), seen from 13 km and from 300 m. None is
  below it, so no face stops short of the ground.
- **What is above it is gone:** from the water just outside the outline, a strip across
  the outline renders the same as with the column hidden (0 of 154,000 pixels differ).
  Without the clip, 22,060 pixels differ: the walls' top 5 m standing out of the seabed.
- **No cost:** the chunks' draws, clip on, off and on again: 0.51 / 0.51 / 0.50 ms from
  the default view; 0.81 / 0.87 / 0.95 ms inside the column under the seabed.

### `onStage`

What the stage tells each occupant keeps its shape: `seabed` is now "the relief draws the
ground over you" (a relief is set, loaded and compiled, and the sea has a seabed), and
`seabedOpacity` and `water` mean what they mean today. A chunk layer still uses it for
`drawCap` and `capOpacity`.

Built (2026-10-25): `SceneryStage.occupants`, each with an `outline` (scene X/Z),
`cut`, `keepBed`, `onStage`, `onGround` and `anchor`. Every occupant is told `onStage`.
Each gets its own ground (`onGround`) over its outline's bounds, which is also where the
relief's error shows half a pixel at most. Each anchor is placed about the middle of its
outline. `occupant` stays as one occupant. Its seabed mesh, the old way, is the first
occupant's only, until step 5 removes it.

### Relief off

No bridge: the column builds on its declared seabed and the chunk draws that cap; the
stage draws its flat seabed; each occupant hands it nothing but its outline and cut.

---

## 7. Sampling the relief

> Design (2026-10-25); built with the bridge (step 4), see below.

Anything put on the ground — a pipeline, a facility, a marker under the pointer — asks
the ground's height. Inside a column that is the chunk stack's `SurfaceSampler`
(`useSurfacePlacement`, `sampleSurfaceFootprint`, `Pipeline`, `SeabedFacility` read it);
outside, nothing answers yet. With the bridge the relief is the column's top, so one
sampler of the relief answers everywhere and agrees with the stack's inside the field.

```ts
// The same shape as `SurfaceSampler`, so its consumers work unchanged.
type ReliefSampler = SurfaceSampler & {
  /** the cell of the tile that answered, metres: how fine the answer is */
  cellAt(x: number, z: number): number | null;
  /** keep the finest tiles under these squares in, whatever the view; returns a release */
  pin(squares: [minX: number, minZ: number, maxX: number, maxZ: number][]): () => void;
};
```

- **Provided by the stage** (`ReliefSamplerContext`, `useReliefSampler`), from the tiles
  in (`tileKeyAt` and `reliefTileHeightAt`, as the ground under the camera reads them;
  since 2026-10-26 the geographic tile at the point's latitude and longitude):
  synchronous, a few lookups per query. `surfaces` is `['relief']`; `solidAt` is below
  the relief. Its identity changes when a finer tile under a pinned square comes in,
  which is the signal to settle again, as a chunk's rebuild is today.
- **Not what is drawn, but the finest there is.** The stack's sampler reads the drawn
  triangles, rightly: a chunk's mesh is fixed once built. The relief's drawn surface
  changes with the camera by up to `pixelError` pixels; an object settled on it would
  bob as the view moves. So an object PINS the finest tiles (leaves) under its footprint
  — the streamer loads them whatever the view, as it loads the roots — and settles once
  they are in. Close up the drawn tile is that leaf, so it meets the ground exactly; far
  off it misses by less than `pixelError` pixels, by construction.
- **Long routes** — a pipeline to shore crosses hundreds of leaves — ask the worker
  instead: `sampleReliefSource(store, source, points)` (see [Sampling the same ground
  elsewhere](#sampling-the-same-ground-elsewhere)), the same merge at full detail, one
  call for the whole route, nothing pinned.
- **The curve.** `SceneryAnchor` places field-sized content rigidly. Something long, outside
  the field, must be placed on the globe per vertex as the relief is, or it floats off it
  from afar: the sdk's `globe.glsl` for any material to include, with `Globe` its CPU
  twin.

Built (2026-10-25), with these changes:

- **Handed out, not provided.** The stage tells `relief.onSampler` its `ReliefSampler`
  (null once gone), a new one whenever a tile under a pin comes in. No context of its own:
  the host hands it on through `SurfaceSamplerContext`, which `useSurfacePlacement`,
  `LevelledBase` and `Pipeline` already read, and to a `ChunkStack` on the relief
  (`reliefSampler`). The stack's own context then answers its sea bed from the relief
  wherever the column holds it (`createReliefTopSampler`): the column's cap lies hidden
  `margin` above the ground, and what stood on it would float. Without the relief's
  sampler the cap answers, less the margin. The stack's immersion fog reads the same.
- **As the triangles draw it.** Heights come from `heightFieldPatchAt`, as the clip's do,
  over the finest tile in at the point (`streamer.get`, from the deepest down): the CPU
  copy of the heights, whatever the GPU holds. Normals are the triangle's
  (`heightFieldPatchSlope`).
- **Pins.** `pin` is on `SurfaceSampler` itself, optional, so a placement pins whatever
  sampler it is given: `useSurfacePlacement` its footprint, `LevelledBase` its bounds,
  `Pipeline` a square at every `spacing`. `selectPinnedTiles` walks all the squares
  together, each tile once with the squares over it, keeping what is in and wanting the
  first missing tile on each path at `PINNED_TILE_PRIORITY`, ahead of the view.
- **The globe's chunk** is the sdk's `materials/shaderLib/globe.glsl` (`globePlace`; the
  geographic tiles' `globeGeodetic` since 2026-10-26),
  which both relief vertex shaders include (until 2026-10-26 the sky's own
  `sky-curve.glsl`, `skyCurveDrop`). `applyGlobe(material, globe)` puts it into any stock
  material: each vertex is placed after three's `project_vertex`, so log depth, the view
  position lit materials read, and OIT's all see the globe. It is for content outside any
  anchor; under one it would be placed twice. GPU picking still picks the flat position.

Measured in `FieldColumn` (`reliefMarkers`): four facilities placed from UTM, two on the
column's top and two past the outline, one of each on a levelled base. Each lands within
3 mm of the ground the tiles draw under it, 0 to 2.7 mm off, the slope-placed ones fitting
a plane over their footprint. From 14 km away, with the camera never near, all four settle
on the same heights within 4 s, and stay put while the camera moves. (The first walk
shared one visited set across squares, so only the first pin went below a shared root;
the others got their leaves only when the view asked for them.) Two 4 km boxes on the sea
150 km out, seen from 2 km up: the one with `applySkyCurve` (now `applyGlobe`) sits on the
horizon, the plain one 1.5 km above it.

---

## 8. Overlays: shapes on the relief, the sea and the seabed

> Design (2026-10-25), not built as written. **Superseded (2026-10-28) by
> [layers.md](./layers.md)**: the overlay (`GeoPolygons`) draws geographic tiles of its own
> rather than the relief's again, so it needs no relief, and is split by its own detail —
> over flat seabed the relief's tiles stop too coarse for a distance field of small shapes.
> The distance field per tile, its id channel, the shared keys and the see-through,
> OIT-ready draw are as below; on the relief's ground is a later step there. Kept for the
> reasoning. **Built (2026-10-29):** any tiled layer lies on the relief's ground with
> `drape` — drawn per relief tile under each of its tiles, reading the relief's heights as
> the stage draws them — and is seen through the sea as the seabed with `water` `'fog'`
> (layers.md, "The core: `GeoTileLayer`").

Polygons — discoveries, fields, licences, safety zones — drawn on the ground or on the
sea, with effects of their own (glow, hatching, outlines, pulses, a fade with the water's
depth), without growing the relief's own shader, which is already its cost.

| Way | For | Against |
|--|--|--|
| In the relief's shader (a mask) | cheapest; exactly on the ground | every effect weighs on the heaviest shader; opaque only |
| A mesh draped by sampling | a material of its own, picking, transparency | must meet a surface that changes with the view and the curve: it fights or floats; a logarithmic depth makes depth offsets unreliable; a 50 km polygon needs fine triangles only near the camera |
| **The relief's tiles drawn again, under the shapes** | all of the above, exactly on the ground | one more draw, of the tiles under shapes only |

The third:

- **The same vertex shader** (`relief-tiles-vertex.glsl`): the same heights, the same
  level of detail, the same curve, so it meets the relief exactly at every view, with
  `depthFunc` `LessEqual` and no skirts. No geometry of its own; only tiles that touch a
  shape are drawn, and none while the camera is below every shape.
- **A fragment shader of its own,** reading a per-tile distance field of the shapes:
  edges sharp at any zoom and outlines of a constant width in pixels (`fwidth`), fills,
  the inference overlay's patterns (`hatched`, `checker`, `zigzag`), glow and pulses, a
  fade with the water over it. Transparent and OIT-ready like any overlay material.
- **The same draw as the see-through one** (see [Drawing the relief](#5-drawing-the-relief)):
  the tiles over an area drawn a second time with another material. Built once, for both.
- **On the sea,** the stage's surface material reads the same tiles of distance; blended
  before the water's fog a shape lies on the seabed, after it on the water.
- **Overlay tiles** are a second kind of tile in the same core (`TileStreamer<T>`, the
  relief's keys): per tile, each shape clipped to it, rasterised as a signed distance
  (R8, 64², with an id channel for picking) in the worker. Streamed only where shapes are.
- **Picking:** the GPU pick gives the point; the tile's id channel, or a point-in-polygon
  test on the CPU, gives the shape.

A contract of its own, as the relief has:

```ts
type OverlayMeta = { id: string; name: string; crs: string; attribution?: string };
type OverlayFeature = {
  id: string;
  /** polygons, each its outer ring and its holes, in `crs` */
  rings: Vec2[][][];
  properties?: Record<string, unknown>;
};
```

A mapper projects the rings into the relief's frame (a `GeoFrame`; today the scene's, the
`World`'s) and densifies long edges first (a straight edge in longitude and latitude is
curved in UTM). In the relief's frame, not a field's, the overlays' tiles share the
relief's keys wherever the relief goes (world.md step 6).
Sodir's FactMaps publish fields and discoveries openly: a demo set fetched by a script, as
the reliefs are.

Meshes still have their place for what does not lie on the ground: a discovery shown as
a curtain down to its reservoir, an anchor for a label.

---

## 9. What goes

None of this has been released. Gone (2026-10-25), with step 5:

- `SceneryStageOccupant.seabed`, `SceneryStageProps.seabedFalloff`, the single `occupant`
  (now `occupants`), the stage's `falloff`, `occupant-bed` and flat-bed-around-an-outline
  parts and the helpers that build them (`skyStageRim`, `skyStageNearBounds`,
  `createSkyStageRings`, `createSkyStageFalloff`, `createSkyStageBed`,
  `createSkyStageSeabed`);
- the `skySeabed` generator and its defs, `createSeabedMesh` and `SeabedMesh`;
- `ChunkStack.onSeabed` and `stackCapSeabed`;
- the relief's single texture and its level of detail: `resampleRelief`'s place in the
  stage, `selectTerrainNodes` and `terrain-lod.ts`, `relief.id` and `relief.falloff`.

What is left of them, and what changed with them:

- **The overview stays.** `resampleRelief` and the `sceneryRelief` generator then fed only the
  overview past a short far plane (`SceneryStageReliefOverview`, `createSceneryReliefFarMaterial`);
  since 2026-10-29 the overview reads the tiles themselves and that generator is gone too (see
  [The overview](#the-overview)). The near mesh, its vertex shader (`relief-vertex.glsl`) and
  its morph table are gone, and
  `relief-fragment.glsl` draws either the tiles (`RELIEF_TILES`) or the overview
  (`RELIEF_FAR`). The overview no longer eases into the stage's area: nothing of it is
  drawn near the scene.
- **`relief.layers` is required.** `relief` always means tiles; `reliefSource` is
  undefined only for an empty list.
- **The stage** draws its surface and, without a relief, one flat seabed on the same
  plane; its materials are `'surface'` and `'bed'`, and its shaders lost `STAGE_SHAPED`,
  `STAGE_OCCUPANT`, `STAGE_SECTION` and `STAGE_FENCE`. Its debug outline draws every
  occupant's outline (at the sea's seabed and surface), and its layers are `surface`,
  `bed` and `relief`.
- **`oceanBuried`** stays: the camera under the relief's ground, above the sea's seabed,
  is in the rock, as it was inside an occupant's seabed.
- **Stories.** FieldColumn's `relief` now means tiles (`reliefTiles` and `seabedFalloff`
  are gone); the sky's flat seabed takes its depth from the column's top along its outline,
  sampled from the stack (it was the `skySeabed` generator's rim). StageDebug's occupant is
  its lobed outline alone. Baseline lost its "any surface as the seabed" path, which comes
  back as a baked layer (step 6). ReliefTiles lost its `single` relief.

---

## 10. Order of work

A thin slice first, to see the tiles and what they cost before building the rest on them.
New code is drawn in its own story, `Spikes/Scenery/ReliefTiles`; the old relief keeps
working beside it until step 4. Stories that break on the way may be switched off, and
are back by step 6.

| # | Step | Ends with |
|--|--|--|
| 1 | This document | ✅ reviewed |
| 2 | **The thin slice:** the contract with `reliefWindow` and `gridToRelief`; `generate-relief` on demand, every source; the demo store serving windows; `buildReliefTile` and its generator; `selectQuadtreeTiles` and a plain streamer; the tiles drawn opaque by `relief.layers`; the story | built (2026-10-25); **a stop:** a look, and timings per zone against the old relief |
| 3 | **The rest of the relief:** ✅ the other mappers and the bake helpers; ✅ the streamer (aborts and upload budgets measured and left out) and a worker of its own; ✅ tiles split by their cells' size on screen; ✅ see-through over `bounds`; ✅ the overview and the layer past the far plane; ✅ the ground under the camera (and the skirts from below); ✅ the debug views; ✅ the chunk helpers moved to `sdk/tiles` | built (2026-10-25); timed again, [below](#timed-again-the-rest-of-the-relief-2026-10-25) |
| 4 | **The bridge:** ✅ (a) `reliefSource`, `sampleReliefSource` and the relief-backed layer, `onStage.seabed` from the relief; ✅ (b) `HeightFieldClip`, `CHUNK_HEIGHT_CLIP`; ✅ (c) `occupants`, the scoped cuts (opt-in, `keepBed`); ✅ (d) the [relief sampler](#7-sampling-the-relief) and the curve's GLSL chunk | built (2026-10-25), seen and measured in `FieldColumn` |
| 5 | ✅ [What goes](#9-what-goes) | built (2026-10-25); every story still compiles and draws |
| 6 | ✅ Stories: layer toggles; FieldColumn and StageDebug through the bridge, baking the column's seabed by default | built (2026-10-25), [below](#the-stories-2026-10-25); with it, [the detail under a tile](#4-relief-tiles) and `sampleReliefSource` on one-node-wide grids (a route) fixed |
| 7 | ✅ Documents, checks, timings; the bed tint from the column's channel | built (2026-10-26), [timed below](#timed-the-column-with-the-relief-and-without-2026-10-26) |
| 8 | [Overlays](#8-overlays-shapes-on-the-relief-the-sea-and-the-seabed): the contract and its mapper, overlay tiles, the second draw's overlay material, on the sea, picking; a demo set of discoveries | ✅ built otherwise (2026-10-28): see [layers.md](./layers.md) — overlay tiles of their own, on the sea or at any height; on the relief's ground, on the sea's surface and picking not yet |

Measured as the sky's [frame cost by zone](./scenery.md#frame-cost-by-zone) is, before and
after. The bar: inside the column and below the seabed, no cost beyond the noise.

### The thin slice, measured (2026-10-25)

`Spikes/Scenery/ReliefTiles`, all four layers, `pixelError` 2, Iris Xe at 1.92 megapixels,
GPU ms (median of 120). "Relief" is the relief's own draw, timed apart; the frame moves
with the GPU's clock and with what the stage draws instead (with tiles it draws no flat
seabed of its own), so judge by it.

| Camera | Tiles drawn | Relief: tiles | Relief: one texture | Frame: tiles / one texture / none |
|--|--|--|--|--|
| 40 m, Volve | 27 (70k triangles) | 1.56 | 1.32 | 11.5 / 13.4 / 12.1 |
| 2 km, Volve | 21 | 1.44 | 1.72 | 8.2 / 9.7 / 8.9 |
| 100 km | 27 | 2.66 | 2.76 | 7.9 / 8.7 / 8.4 |
| −30 m, in the water | 29 | 1.60 | 1.35 | 8.4 / 10.3 / 9.1 |
| −500 m, below the seabed | 21 | 0.41 | 0.06 | 7.3 / 8.0 / 7.7 |
| 2.5 km, off the coast | 198 (0.51 M) | 6.64 | 2.21 | 12.8 / 8.5 / 8.7 |

- Over the sea the tiles cost what the one texture did, at up to 30 times its detail:
  Volve's flat seabed is drawn with 21–29 tiles.
- ⚠️ **Over land the cost follows the triangles:** 0.51 M → 6.6 ms, 0.29 M → 4.8 ms
  (`pixelError` 4), 0.10 M → 2.9 ms (8), about 8 ms per million against the chunks' 0.6.
  The vertex work is a `texelFetch`; it is the relief's fragment shader (the air's haze
  per pixel above all) shading 2 x 2 quads of triangles a few pixels across. To take up
  in step 3: haze per vertex where it varies slowly, and larger triangles far off. The
  skirts now face out only; timed again below.
- ⚠️ **Below the seabed** the tiles cost 0.4 ms where the one texture, kept off the
  stage's area, cost nothing: seen from below, only the skirts (then drawn both ways
  round) draw. Timed again below.

### Timed again: the curve under the camera, skirts facing out (2026-10-25)

Same story, data and GPU. Each camera is a fixed pose, looking east at the horizon
(`pitch` = −dip) unless noted, so these can be run again: over Volve (0, 0) at 40 m, at
2 km looking 30° down, at 100 km; at Volve at −30 m and −500 m, level; at 2.5 km over the
coast (215, −40 km); at 300 m in Lysefjord (256, −62 km). Tiles A/B/A as a clock check
(the frame agreed to 0.2 ms, but at 100 km, −30 m and −500 m by 0.6–3 ms, while the
draws timed apart agreed to 0.25 ms). "Sky's draws" is the relief, the stage and the
background together, timed apart: steadier than the frame, and what the sky costs.

| Camera | Tiles (triangles) | Relief: tiles / one texture | Sky's draws: tiles / one texture / none |
|--|--|--|--|
| 40 m, Volve | 27 (0.06 M) | 1.46 / 1.31 | 10.8 / 12.7 / 11.4 |
| 2 km, Volve, 30° down | 21 (0.05 M) | 2.14 / 2.86 | 10.0 / 13.6 / 11.7 |
| 100 km | 26 (0.06 M) | 2.8 / 2.84 | 8.5 / 8.1 / 8.4 |
| −30 m, in the water | 29 (0.07 M) | 2.1 / 1.40 | 7.4 / 7.6 / 8.0 |
| −500 m, below the seabed | 21 (0.05 M) | 0.27 / 0.10 | 1.9 / 3.1 / 4.6 |
| 2.5 km, the coast | 124 (0.29 M) | 6.09 / 2.66 | 11.8 / 8.3 / 7.8 |
| the same, `air` off | 124 (0.29 M) | 3.50 / 2.02 | 9.0 / 8.1 / — |
| 300 m, Lysefjord | 34 (0.08 M) | 1.48 / 2.52 | 9.7 / 8.3 / 8.0 |

- ✅ **In the water and below the seabed the sky costs less with tiles than with either
  alternative** (7.4 ms against 7.6 and 8.0; 1.9 against 3.1 and 4.6): the stage draws no
  flat seabed of its own. The relief's own draw below the seabed is down to 0.27 ms from
  0.41 with the skirts facing out; it is one draw of skirts and culled triangles.
- ⚠️ **Over land the relief still follows its triangles.** At the coast, `pixelError` 2,
  4 and 8 draw 0.29, 0.25 and 0.12 M triangles for 6.1, 5.5 and 4.0 ms with the haze, and
  3.5, 3.2 and 2.4 ms without: about 12 ms per million plus 2.5 with it, 6.6 plus 1.6
  without. The haze is 2.6 of the 6.1 ms, and most of it grows with the triangles: it is
  paid per 2 x 2 quad that a small triangle partly covers.
- **No early depth test.** With a logarithmic depth buffer (Storybook's default) every
  three.js material writes `gl_FragDepth`, so every hidden fragment is shaded in full:
  the stage's sea cost 4.88 ms in Lysefjord with the tiles drawn in front of it or not.
  Only the background, which writes no depth, gains from what covers it (4.0 → 3.2 ms).
  So drawing near tiles first would not help; fewer and cheaper fragments would.
- **Lysefjord's frame is the sea, not the relief** (relief 1.48 against 2.52 ms): with
  the curve measured from under the camera, the stage shades the sea that the lopsided
  curve measured from Volve dropped out of view (its sea 4.88 ms with `followAway`, 3.15
  without). The one-texture relief keeps the old curve, so it gets the cheaper, wrong sea.
- To take up: see [Later](#later-performance) under Open questions.

### Timed again: the rest of the relief (2026-10-25)

The same poses, data and GPU, now with the cell rule (`cellPixels` 8, `minSlope` 0.01),
the ground under the camera, and the sky's own worker.

| Camera | Tiles (triangles) | Relief: tiles | Sky's draws: tiles / one texture / none |
|--|--|--|--|
| 40 m, Volve | 56–60 (0.13 M) | 1.73–1.86 | 11.1 / 12.7 / 11.4 |
| 2 km, Volve, 30° down | 66 (0.15 M) | 2.63 | 10.5 / —¹ / 11.6 |
| 100 km | 135 (0.31 M) | 6.37 | frame² 11.7 / 8.0 / 7.7 |
| −30 m, in the water | 53–58 | 1.65 | 8.7 / 10.4 / 9.3 |
| −500 m, below the seabed | 21 (0.05 M) | 0.36–0.39 | 2.8–3.0 / 3.6 / 3.9 |
| 2.5 km, the coast | 143 (0.33 M) | 6.39 | 12.1 / 8.5 / 8.4 |
| 300 m, Lysefjord | 39 | 1.53 | 9.9 / 8.2 / 7.5 |

¹ The one texture's draws timed apart were an outlier; its frame was 13.9 ms against
10.8 with tiles. ² Its draws timed apart were not taken; the frame is shown instead.

- ✅ **The bar holds: in the water and below the seabed the sky costs less with tiles**
  than with either alternative (8.7 against 10.4 and 9.3; 2.8–3.0 against 3.6 and 3.9).
  Below the seabed, the cell rule had raised the relief's draw to 0.69–0.99 ms over 45
  tiles. Left out under the ground, it is 21 tiles for 0.36–0.39 ms.
- ⚠️ **Sharpness from high up has a price.** At 100 km the relief went from 2.8 to 6.4 ms
  (26 to 135 tiles), at the coast from 6.1 to 6.4 (124 to 143). In return Norway from
  1000 km is drawn from 4 km cells instead of 65 km. Over land the relief costs 3–4 ms
  more than the one texture did. The items under [Later](#later-performance) are where
  that comes back: the haze per vertex, a floor on a cell's size on screen, and shading
  finer than the patch.
- Volve at 40 m and 2 km draws 56–66 tiles where the thin slice drew 21–27, for
  0.3–0.5 ms more: the rough seabed's tiles near the camera now split for their cells.

---

### The stories (2026-10-25)

- **One control for the demo reliefs**, `reliefLayers` (`sceneryReliefArgTypes`), in every
  story taking the shared `relief` toggle; `sceneryReliefFromArgs(args, frame, local)` adds a
  story's own layers over them, finest last, and draws them even with the demo reliefs
  off.
- **The demo store makes reliefs**: any store surface baked on demand under
  `surface:<id>` (`bakedReliefId`, `surfaceToRelief` in the field's map), the generated
  ones included, and StageDebug's synthetic ground (`synthetic:stage-ground:…`, a
  `functionRelief` in the stage's own map). `relief-meta` is answered per key, not
  preloaded.
- **FieldColumn** bakes its sea bed into the relief by default (`bakeSeabed`): Volve maps
  none, so it is the generated one, with its made-up coast and island. At the facilities
  the ground then lies 1.6–7.8 m from EMODnet's, and within 0.16 m of the generated
  surface sampled directly.
- **StageDebug** draws its synthetic ground (`ground`, on by default) under the
  occupant's outline: alone, as before, or over the demo reliefs.
- **Baseline** has its seabed surface back (`seabedSurface`), baked at its real depth.

### Timed: the column with the relief and without (2026-10-26)

`FieldColumn` under the sky (`wellbores` off, `reliefMarkers` on), relief on, off and on
again. The four-phase tour (300 frames a phase, the camera driven each frame) about the
column's centre and, for the tilt, the deepest point of a Volve well; the display's
interval moved from 18 to 16.7 ms between the first and the last run, so compare within
a run. Then `profile` at fixed poses for the GPU and main-thread time per frame.

| Phase | relief on: mean / p95 / max ms (upload KB/frame) | off | on again |
|--|--|--|--|
| zoom above | 20.5 / 36.3 / 37.5 (4.7) | 20.9 / 36.1 / 270 (0) | 22.7 / 33.4 / 50.2 (7.5) |
| tilt through level | 18.0 / 18.5 / 19.1 (0.3) | 18.0 / 18.6 / 19.0 (0) | 16.7 / 16.8 / 33.4 (4.2) |
| orbit below | 18.8 / 18.6 / 267 (0.8) | 17.9 / 18.5 / 19.1 (0) | 16.7 / 16.9 / 18.3 (0.8) |
| zoom below | 18.0 / 18.5 / 35.9 (0.1) | 19.1 / 18.7 / 243 (0) | 16.7 / 16.8 / 33.3 (0.1) |

| Pose (median ms) | GPU: on / off / on | main thread: on / off / on |
|--|--|--|
| inside the column, level, 2.5 km from a well's foot | 7.51 / 8.40 / 7.73 | 3.3 / 1.4 / 2.7 |
| below, 12 km at 130° | 7.51 / 8.09 / 7.85 | 4.0 / 2.0 / 4.6 |
| above, 20 km at 50° | 17.07 / 15.26 / 17.41 | 5.2 / 2.6 / 3.9 |
| inside, `reliefMarkers` off | 7.60 / 8.26 / 7.34 | 3.0 / 2.8 / 2.1 |
| below, `reliefMarkers` off | 7.78 / 8.35 / 6.92 | 2.2 / 2.8 / 2.9 |

- ✅ **The bar holds: inside the column and below the seabed the relief costs nothing
  beyond noise**, GPU or main thread. Its tiles are one instanced draw, and their
  selection each frame (`selectQuadtreeTiles`) about 0.2 ms of the tiles' 0.45 ms
  `useFrame`. The main thread's 1.5–2.5 ms more with the relief on was the story's
  facilities (`reliefMarkers`, 78 meshes: 111 against 33), placed only with the relief;
  without them the three runs agree.
- **Above the surface the relief costs about 2 ms of GPU** (17.1–17.4 against 15.3 at
  20 km), and the zoom from above is no slower with it than without: both run at a
  p95 of 33–36 ms at its far end.
- The single 240–270 ms frames come with the relief off as well as on.
- Streaming is small: 4.7–7.5 KB a frame zooming out above, under 1 KB below; nothing
  with the relief off.

## 11. Open questions

- **Tile size `T`:** 32 cells (2048 triangles a tile, as today's CDLOD patch) or 64 (8192,
  a quarter of the tiles and loads). Start at 32 and measure.
- **Defaults:** `pixelError` 2 (the chunks'), a budget of 48 MB of resident tiles, 4 loads
  at a time, and a block cache of 128 MB in the worker.
- **`depth` or `base`:** the flat seabed where no layer has data is named `depth` here,
  positive down, as the sea's is.
- **Land inside `bounds`** is see-through with the seabed: the opacity applies to all the
  ground over the scene.
- **The finer tiles over the occupants** (half a pixel of error, see Seams) cost more
  tiles near the camera where the seabed is rough. If that costs too much, a larger
  `margin` lets the region take the stage's own `pixelError` where the ground lies below
  the column's top anyway.

### Later: performance

Noted from the timings above (2026-10-25), and left for now: the relief performs well
enough, and the plan comes first.

- **The haze per vertex.** Over land it is 2.6 of the 6.1 ms at the coast, and paid per
  2 x 2 quad a small triangle partly covers. Per vertex where it varies slowly (most of
  the view); a risk of banding on large far triangles near the horizon. About −2 ms there.
- **A floor on a cell's size on screen.** Stop splitting a tile once its cells would be a
  few pixels (4–6) across, whatever its error: far tiles then stop drawing triangles of
  a pixel or two. `pixelError` 8 drew 0.12 M triangles for 4.0 ms against 0.29 M for 6.1;
  watch that mountains keep their outline on the horizon. The cap's counterpart,
  `cellPixels`, now splits tiles whose cells are too LARGE (see
  [Choosing what to draw](#choosing-what-to-draw-selectquadtreetiles)); the floor would
  bound it from the other side.
- **Shading finer than the patch:** normals and heights at 4 x a tile's cells, so the
  shading stays sharp from high up with a sixteenth of the tiles `cellPixels` now asks
  for; 16 x the merge work and memory per tile.
- **No relief draw when nothing of it can show:** with the camera below all the ground it
  would draw and no cutaway open, the tiles cost 0.3–0.4 ms for nothing (the tops face
  away, and the skirts are dropped per pixel).
- **Not near tiles first.** With a logarithmic depth buffer (Storybook's default) every
  three.js material writes its depth, so there is no early depth test, and hidden
  fragments cost in full: ordering the draws would not help; fewer and cheaper fragments
  would.

---

## 12. Costs and risks

- **See-through under the seabed:** below `seabedOpacity` 1 the ground over `bounds` is
  thousands of see-through triangles, drawn in every OIT sub-pass — where the headroom
  matters most. If it costs too much, the see-through draw takes coarser tiles.
- **One worker:** the generators share one worker, and a column build has serial phases
  of one to two seconds, which would stall the tiles. Hence a worker of its own: a host
  nests a `GeneratorsProvider` for the sky (see [Loading](#loading-tilestreamer)); one
  that does not still works, its tiles waiting on its columns.
- **Rebuilds:** changing the relief's layers or `depth` rebuilds the column (about 10 s on
  a 34-surface field). Its tiles changing depth never does.
- **The clip:** each pixel of a wall or cut face reads the indirection and three heights.
- **Triangles:** data-aware tiles should draw fewer than today over sea, more over land;
  measured at step 2.
- **Streaming:** a quick fly-in shows coarser tiles for a moment.
- **Data that disagree:** where the bathymetry lies deeper than the column's horizons,
  units are cut away — the relief is the top. Baking the column's seabed avoids it, so
  the stories bake it by default, and hosts with a seabed of their own should too.
- **Coasts:** EMODnet has no land; at the coast the land fades in from ETOPO 15″ over the
  feather, which can move the coastline by a cell or so.
- **The void's walls** (a prototype) stand at the flat seabed's level; ground deeper than
  the sea's `depth` inside `bounds` will meet them. To be looked at in StageDebug. From
  below, the relief's lid meets their top where it lies at the sea's depth; where it lies
  above it, the background's flat lid shows in the strip between, in the same colour.
- **A local layer's detail from afar** is bounded down to the level a layer's edge is
  read at (512 values a side); finer than that, a tile sees it one level ahead, as
  before (see [The detail under a tile](#4-relief-tiles)). A layer larger than 512 values
  a side with sharp features much smaller than its 512th may still show them only close
  up.
- **FieldColumn's `seaLevel`** moves the sea and the relief but not the column: they part
  when it is not 0. A quirk of the story, noted, not fixed.
- **Anchored content and world-space cuts:** an anchor moves the field's geometry, but a
  section plane or fence given in world space stays: far off they part by the drop at the
  field, about 125 m once the camera is 40 km past the stage's edge. To look at with the
  bridge (step 4), where the cuts are scoped to the occupants anyway.
- **Data on demand:** a fresh clone has no relief until `npm run generate-relief` has run,
  which needs NOAA's and EMODnet's servers.
