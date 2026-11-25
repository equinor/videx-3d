# Subsurface data and models on the Earth (draft plan)

> **Status (2026-11-03): draft, nothing of it built.** Saved to be picked up on demand, a part at
> a time; each part gets its own review before it is built. Settled with the user on
> 2026-11-03 (the answers are recorded under [Decided](#decided-draft)). Built with it: only
> `GeoTracks` anywhere on the globe ([layers.md, Tracks](./layers.md#tracks-geotracks)),
> whose `globeUprightMatrix` the models below would share.
>
> **Revised 2026-11-19:** a level of detail told by the `World` to any content (LOD clients,
> with events), not only `PixelLod`'s switch; and `GeoHorizon` on the relief's tile core,
> moved out of the stage's relief first.

- [Why](#why)
- [What there is](#what-there-is)
- [Decided (draft)](#decided-draft)
- [Wells: `GeoWells`](#wells-geowells)
- [Surfaces](#surfaces)
- [Models and LOD: `GeoModel`, LOD clients, `PixelLod`, glTF](#models-and-lod-geomodel-lod-clients-pixellod-gltf)
- [Under the seabed](#under-the-seabed)
- [Open questions](#open-questions)
- [Order of work](#order-of-work)

---

## Why

A field's data — its wells and surfaces — is drawn in its `UtmArea`, a group placed rigidly on
the `World`'s globe ([world.md, Fields as groups](./world.md#fields-as-groups)): exact within
the field, wherever it is. Wanted beyond that:

- **Wells of a region or of the globe as one layer** — exploration wells, typically: several
  thousand — with their related data (casings, completion, formations, …) close up.
  Production, operated and historical wells stay in their fields' groups.
- **Surfaces in their own CRS, outside a field's group:** field-scale grids, and regional
  horizons hundreds of kilometres across.
- **Models** — glTF, any three.js mesh — at a latitude and longitude, standing on the relief,
  with detail by their size on screen.

What is not wanted for now: 3D Tiles (OGC; streamed meshes in Earth-centred coordinates on the
ellipsoid). Weighed on 2026-11-03: a wrapper of `3d-tiles-renderer` fits for local tilesets
(1.5–3 weeks), less so for regional ones over the relief and the sea (heights on the
ellipsoid, 40–50 m from mean sea level on the shelf; a ground and a sea of their own).

## What there is

| Piece | Gives | Lacks for this |
|--|--|--|
| `UtmArea` per field, placed by the `World` | wells (`Wells`, `UtmPosition` from each header's easting and northing) and `Surface`, with every related component, exact within the field | a field's frame only; a neighbour stands off the curve by `d² / 2R` toward its edges (5–30 m, judged acceptable, [7g](./world.md#7g-judged-2026-11-02)) |
| `WellboreHeader` | `easting`, `northing`, a position log of deltas east and north, TVD MSL | no CRS, no latitude and longitude |
| `SurfaceMeta` | the grid (`header`: origin, increments, rotation), a `projection` string | its origin is the grid's corner (`surface-generator.ts`) |
| `Wgs84Position`, `UtmPosition` (with a `projection`) in a `World` | any content upright at a point on the globe (`EarthPlacement`, `placeGeoPoint`, `placeMapPoint`) | standing on the relief, a heading, visibility by height, detail by size |
| `GeoTubes`, `Trajectory` | the tube pieces they share (`createTubeSegmentGeometry`, `tube-segment.glsl`, `tube-rim.glsl`), a radius never under `minPixels` | — |
| The relief's contract and tiles (`relief-meta`, `relief-values`, `buildReliefTile`, `TileStreamer`, the geographic tile keys) | any grid in any CRS, merged per tile on a worker, drawn on the globe per vertex; `surfaceToRelief` from a store's surface | a look of its own (a colour ramp by depth, contours) |
| `GeoSymbols` | the relief's ground at a point (`SceneryReliefDrawn.heightAt`), settled again as finer tiles come in | — |

## Decided (draft)

| | |
|--|--|
| Wells | **Both:** an Earth-level layer (`GeoWells`) for the wells of a region or the globe, and fields' groups for a field's own. **One well, one source:** the layer leaves out what a field draws (`exclude`); over a field's disc the two would part by 3–11 cm and flicker ([world.md](./world.md#wellbores-as-an-earth-level-layer-a-step-of-its-own)). |
| A well's coordinates | **An optional `crs` on `WellboreHeader`:** the map its `easting` and `northing`, and its position log's deltas east and north, are in (a proj4 definition, or a name proj4 knows). A wellhead's latitude and longitude alone would not do: the deltas are along the map's grid, which is off true north by its convergence (2° turns a 5 km reach 175 m). |
| A well's placement | **Rigid per well, at its wellhead in its own CRS** (`placeMapPoint`, as `UtmPosition` with a `projection` places): the overview and the detailed well then lie exactly on each other when one replaces the other. A reach of 10 km parts from the curve by 8 m at most, and only the overview is seen from where that could show. (world.md's first sketch placed each node by latitude, longitude and TVD.) |
| Surfaces | **Both scales, each in its own CRS:** field-scale grids rigid about the grid's centre (`GeoSurface`); regional horizons tiled and curved through the relief's contract and tiles (`GeoHorizon`). |
| Models | Standing on the relief (settling as finer tiles come in), a heading from true north and an API by latitude and longitude, visibility by the camera's height (`layerShownAt`), detail by size on screen, and a glTF helper. Instancing many copies: not asked for. |
| LOD (2026-11-19) | **A registry per `World`, its clients anywhere** (in a `GeoModel`, a `UtmArea`, any group): distance, pixels on screen, in view, shown, level and near — live each frame, and as events or a hook's state when they change; `PixelLod` the declarative layer on it. |
| Scale | Several thousand wells in the overview (the demo field has 943; the shelf, several thousand). |

## Wells: `GeoWells`

```tsx
<World frame={frame} boundary={boundary}>
  <GeoWells
    headers={explorationWells} // WellboreHeader[], each with its `crs`
    exclude={h => loadedFields.has(h.properties?.fieldId)}
    style={h => ({ color: statusColor(h.status) })}
    minPixels={2}
    detailPixels={300}
    maxDetailed={12}
    renderWellbore={h => (
      <Wellbore id={h.id}>
        <Trajectory />
        <Casings />
        <FormationMarkers />
      </Wellbore>
    )}
    reveal={{ minHeight: 20000 }}
  />
</World>
```

- **Data:** the headers, all at once (light: thousands of records); the position logs from the
  store by id, only for wells near enough to be seen as more than a dot.
- **Placement:** per well, `placeMapPoint(crs, easting, northing, world.frame)` and
  `geoFrameMatrix` — the matrices in a data texture, written again when the globe changes
  (`globe.version`, a switch of the anchor). Paths in each well's own metres: east, −TVD, south.
- **Drawn:** one instanced draw of tube segments for every well (the pieces `GeoTubes` and
  `Trajectory` share), never thinner than `minPixels`; a well whose path is not in yet is a dot
  at its wellhead. Per-well colour from `style`.
- **Loaded by size on screen** within a byte budget (`TileStreamer`, keyed by well), from the
  nearest; paths simplified per level of detail on a worker (a `geoWellPaths` generator); an
  index of the wellheads (`rbush`) for what is near.
- **Detail close up:** the wells over `detailPixels`, at most `maxDetailed` of them, nearest
  first, are drawn by `renderWellbore(header)` inside a `UtmPosition` in their `crs` — the same
  placement, so nothing moves at the swap — and left out of the instanced draw. Everything a
  field's well shows is there: casings, completion, perforations, formations, labels.
- **Seen** by `layerShownAt` (lying at its depth), through the sea as the seabed is (`water`
  `'fog'`), and as a map from above (`reveal`: each well's track in plan, on the sea). See
  [Under the seabed](#under-the-seabed).
- **Picked** by instance: the well's id in the listener's `ref`.

## Surfaces

### Field-scale: `GeoSurface`

`Surface` placed on the `World` by its own `SurfaceMeta.projection`, outside any `UtmArea`:
rigid about the grid's centre — `placeMapPoint` there, `Surface` moved back by the centre's
offset from its corner, its `rot` kept. About its corner instead, a 30 km grid's far corner
would stand 140 m off the curve; about its centre, 35 m (as a field of Troll's size, 29 m).
Every `Surface` prop passes through; `LayerVisibility`, tested by `layerShownAt` at its depth.

### Regional: `GeoHorizon`

Hundreds of kilometres: tiled and curved on the globe, as the relief is — not one mesh — and
loaded on its own, apart from the relief, only where it can be seen.

- **Data through the relief's contract:** a `relief-meta` in the horizon's CRS and
  `relief-values` by window, or `surfaceToRelief` from a store's surface. Its tiles built on
  the worker by `buildReliefTile`, heights negative below the sea.
- **The relief's tile machinery, shared:** the choice (`selectQuadtreeTiles` over
  `geoTileLayout`), the streamer, the soft swaps (`TileTransitions`), the instances and the
  edges blended toward a coarser neighbour (`tileCoarserEdges`) are written into
  `SceneryStageReliefTiles`' frame today. Moved out first, into a core both draw with; the
  relief keeps what is its own (the overview, the hollow, the ground handed to a column, pinned
  tiles, see-through). That a second user works, the `GeoMap` shows: it draws the relief's
  tiles apart from the stage, with a loader, a `TileStreamer` and an atlas of its own.
- **Its own layers, budget and worker:** a `relief-meta` per horizon, a byte budget of its
  own, and a `GeneratorsProvider` of its own around it, so its tiles do not queue behind the
  relief's.
- **Seen, and loaded, only where it can be:** under an opaque seabed it is hidden. It shows
  from below (the void), through the cutaway, as a map from above (`reveal`), or where the
  relief is see-through ([Under the seabed](#under-the-seabed)). Where none of these holds,
  none of its tiles is chosen or loaded.
- **Drawn** as geographic tile patches, each node placed by `globeGeodetic` at its height,
  split by their error in pixels, swapped softly; with the `Surface` look: a colour ramp by
  depth, contours and their labels (shared with the relief, `ContourLabels`), OIT.
- **Not** the relief's own drawing: no see-through, occupants, clip or overview. To be designed
  in full when picked up; the largest part of this plan.

## Models and LOD: `GeoModel`, LOD clients, `PixelLod`, glTF

Revised 2026-11-19. `PixelLod` alone switched its own children by their size on screen. Wanted
instead: a level of detail any content can follow — a model swapped by its size on screen, its
data loaded as it comes near, a well's casings and completion shown close up — told by the
`World` rather than worked out by each.

```tsx
<World frame={frame}>
  <GeoModel longitude={2.27} latitude={61.21} heading={42} on="ground" footprint={{ radius: 60 }}>
    <LodClient
      levels={[40, 250]} // pixels across: level 0 under 40, 1 up to 250, 2 over
      near={0.5} // near at half the next level's pixels: time to load it
      onChange={({ level, visible, near }) => setDetail({ level, visible, near })}
    >
      <Rig />
    </LodClient>
  </GeoModel>
</World>
```

- **One registry per `World`:** its clients evaluated in one frame callback, and only when the
  camera, the viewport or a client moved — not a `useFrame` each. A few operations a client: a
  thousand cost microseconds.
- **A client** (`<LodClient>`, or `useLod(ref, options)` on a group of your own), wherever it
  is placed: in a `GeoModel`, a `UtmArea`, any group. Its bounds: a sphere from its contents'
  bounding box (taken once, and again on request) or a `radius` given, moved by its world
  matrix.
- **What it is told**, each time it is evaluated:
  - `distance` from the camera, and `pixels`: the sphere's size on screen (`pixelsPerUnit`);
    on request the box's rectangle on screen, for long things (a well);
  - `inView`: in the frustum, and not past the globe's horizon (the test the geographic tiles
    make);
  - `shown`: within its band of heights, and not under the void's lid (`layerShownAt`);
  - `level`, by its `levels` (thresholds in pixels), with hysteresis (`selectLodLevel`,
    `LOD_COARSEN_MARGIN`);
  - `near`: within a fraction of the next level's threshold, or within a distance — time to
    load what that level needs.
- **Delivered two ways:** the live values in a state object read in `useFrame` (no React render
  a frame), and the discrete changes — `level`, visible or hidden, near or not — as events
  (`onChange`, `onVisible`, `onNear`) or as the hook's state, which renders only when they
  change. Near is let go only after a delay, so moving to and fro does not load the same thing
  again and again.
- **`PixelLod`:** the declarative layer on a client: one of its `levels`' children by `level`,
  the next one's model fetched ahead (`useGLTF.preload`) when near.
- **Examples:** rigs and land bases (a `GeoModel` with a client: a symbol far off, a model close
  up); a field's wells, a client per well bounded by its trajectory, with casings, completion
  and formations by level, their data fetched from the store when near.
- **Not in it:** hidden behind terrain (an occlusion query or a depth read per client: too dear
  for many). Under an opaque seabed could be a rule of `shown`
  ([Under the seabed](#under-the-seabed)).
- **`GeoModel`:** `longitude`, `latitude`, `heading` (degrees from true north), `height`,
  `on: 'sea' | 'ground'`, `footprint` (`radius`, `samples`, `align`: level, or laid on the
  fitted slope), `LayerVisibility`. Placed as `Wgs84Position` places (`EarthPlacement`, made a
  hook both share), or by `globeUprightMatrix` where no map reaches. On the ground: the relief's
  `heightAt` over the footprint, settled again when finer tiles come in (`resident`, at most
  every half second), as `GeoSymbols` does. Hidden by `layerShownAt`.
- **`useGltfModel(url, { draco, meshopt })` and `<GltfModel url />`:** on drei's `useGLTF` (a
  peer dependency already): a clone per use, transparent materials made OIT-compatible
  (`makeOitCompatible`), and the model's radius for the footprint and `PixelLod`. glTF is Y up
  and in metres, as the scene; its −Z is north under `GeoModel`.

## Under the seabed

A geographic layer does not show through an opaque seabed: data below it stays hidden
wherever the seabed is drawn, with the sea on or off. A loaded field's `boundary` makes the
relief see-through over it; `GeoWells`, `GeoSurface` and `GeoHorizon` would have none. They are
seen from above as a map (`reveal`), from the void below the seabed, through the cutaway, or
where the scene has no relief or sea.

## Open questions

- **See-through over their own outline:** should `GeoWells`, `GeoSurface` and `GeoHorizon` be
  able to make the relief see-through over their outline (a region of their own, as a loaded
  field's), or keep to `reveal`, the void and the cutaway?
- **`fieldId` on `WellboreHeader`,** or `exclude` alone: is a well's field known to the store?
- **The demo's exploration wells:** Sodir's exploration wellbores (NLOD 2.0) — position, total
  depth, water depth, no position logs — as vertical wells, fetched by the overlays script.
- **A glTF for the demo:** one of the user's, or a small CC0 model (licence checked).
- **Instanced models** (many copies of one, a wind farm's turbines): not asked for now.
- **LOD outside a `World`:** the registry needs the globe only for the horizon test; a provider
  of its own for scenes without one?
- **A client's size on screen by default:** the sphere (cheapest), or the box's rectangle,
  which fits long things (a well seen end on)?
- **Thousands of clients** (every well of a region): a plain loop, or an index (`rbush`, as
  `GeoWells` plans) so only those near the view are evaluated?
- **The horizon's budget against the relief's:** a share of one, or apart?

## Order of work

| # | Part | Ends with |
|--|--|--|
| 1 | `GeoTracks` anywhere on the globe | ✅ built (2026-11-03): placed to a millimetre on the curved sea 150 km to 2 900 km off and on the far side of the Earth (`track-placement.test.ts`); the `Ships` story's `far` adds ships there |
| 2 | Models and LOD: the LOD registry and clients, `GeoModel`, `PixelLod`, the glTF helper | — |
| 3 | Wells: `WellboreHeader.crs`, `GeoWells`, the demo's exploration wells | — |
| 4 | `GeoSurface` | — |
| 5 | `GeoHorizon`: the relief's tile core moved out of the stage, then designed in full and built | — |
