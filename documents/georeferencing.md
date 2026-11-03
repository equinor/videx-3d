# Georeferencing: placing the scene on the Earth

How videx-3d knows where your data lies on the Earth, which components and helpers deal with
it, and how they fit together: the field you work in, the sky and the sea around it, the land
and seabed beyond, layers from GIS data, and a minimap. It ends with a
[step-by-step example](#step-by-step-a-field-on-the-earth).

- [The core idea](#the-core-idea)
- [The pieces](#the-pieces)
- [How they fit together](#how-they-fit-together)
- [Step by step: a field on the Earth](#step-by-step-a-field-on-the-earth)
- [Pitfalls](#pitfalls)
- [Further reading](#further-reading)

---

## The core idea

### Three kinds of coordinates

| | What | Units | Where you meet it |
|--|--|--|--|
| **Map coordinates** | a projected map: UTM, or any projection proj4 knows | metres, easting and northing | your field data: wellbores, surfaces, seismic, facilities |
| **Longitude and latitude** | WGS84 | degrees | GIS data (GeoJSON), elevation models, tracking feeds |
| **Scene coordinates** | three.js world space | metres: **X east, Y up, Z south** | what is drawn, the camera, the controls |

Scene coordinates are the map's, moved so that a chosen point of the map, the **origin**, sits
at scene `(0, 0, 0)`. Keeping the numbers small near the origin keeps 32-bit GPU floats precise.
Z runs south because northing grows north and three.js looks down −Z.

### One frame says where the scene lies

A **`GeoFrame`** is the single link between the three. It is plain data:

```ts
type GeoFrame = {
  projection: string; // proj4 definition (or a name proj4 knows), in metres
  origin: [number, number]; // the map coordinates at the scene's origin
  offset?: [number, number]; // scene X/Z of that origin, default [0, 0]
};
```

You give it once, to a `World`, and everything georeferenced inside reads it from there: the
sky (where the sun is), the relief (where its elevation data lies), the GIS layers and the
minimap.

### Flat, or on a globe

A `World` lies on a **globe**, with or without a `Scenery`: over a flat disc around the field
(the one holding the `World`'s `boundary`, or a `SceneryStage`'s) the globe *is* the field's plane, so field data
never moves; beyond it the Earth falls away. The `Scenery` only draws on it — the sea, the
sky, the relief — so coasts and mountains sit on the horizon where they belong, and turning it
on or off moves nothing. The GIS layers lie on the same globe. Your field data stays flat in
its own frame either way; the globe only changes how the far surroundings are placed.

With the `World`'s `globe` off, nothing curves: the scene is the map, flat, which is exactly
right for a field and a few tens of kilometres around it.

---

## The pieces

Components come from `@equinor/videx-3d`, helpers and types from `@equinor/videx-3d/sdk`, and
generator functions from `@equinor/videx-3d/generators`.

### Frames and conversions (sdk)

| Helper | Use |
|--|--|
| `GeoFrame` | where the scene lies on the Earth (above) |
| `geoFrameFromCrs(crs, offset?)` | the frame of a scene placed with a `CRS` (as a `UtmArea` places it) |
| `geoFrameAt(longitude, latitude)` | a transverse Mercator frame about a point, for a scene placed by longitude and latitude alone |
| `geoFrameLonLat(frame)` / `geoFrameXZ(frame)` | converters: scene X/Z ↔ longitude and latitude. Make one and call it per point |
| `geoFrameLocation(frame)` | the origin's longitude and latitude |
| `geoFrameUtmZone(frame)` / `utmZoneBounds(zone, south)` | the UTM zone a frame is drawn in (null for any other map), and the band of longitude and latitude it covers; the minimap outlines it |
| `placeGeoFrame(frame, scene)` | where another frame's origin lies in the scene, and how its grid is turned and scaled there |
| `placeGeoPoint(longitude, latitude, scene)` | the same for a point of the Earth, turned for true north there; `geoFrameMatrix(placement, globe, target)` stands what is drawn about the origin on the globe there (as a `Wgs84Position` in the `World` does) |
| `placeMapPoint(projection, easting, northing, scene)` | the same for a point of a map, turned to that map's grid there |
| `TargetAnchorPicker` | where to anchor a `World` as the camera's target goes about the Earth (`useTargetAnchor`) |
| `CRS` | a UTM (or other) map about an origin: `utmToWorld`, `worldToUtm`, `wgs84ToWorld`, `worldToWgs84` |
| `getProjectionDefFromUtmZone('31N', datum?)` | the proj4 definition of a UTM zone, in a datum: `'ED50'` (the default), `'WGS84'`, `'ETRS89'` or a shift of your own (see [The datum](#the-datum)) |
| `solarPosition(date, latitude, longitude)` | the sun's azimuth and elevation |

### The scene and your field data

| Component | Use |
|--|--|
| `World` | says once, with a `frame`, where the scene lies on the Earth. Renders nothing |
| `UtmArea` | a container for field data in a map: its children are drawn in its map's metres about its origin. A `UtmArea` in **another** frame than the `World`'s (another UTM zone, a field 300 km away) places itself where the world's map has it, turned and scaled, and on the globe when there is one |
| `UtmPosition` / `Wgs84Position` | place children at an easting/northing or a longitude/latitude inside a `UtmArea`, flat in its map. In the `World` itself, with no `UtmArea` around them, they place them on the Earth instead: on the globe at the point, upright, at any distance; a `Wgs84Position` facing true north (`placeGeoPoint`), a `UtmPosition` given its `projection` along that map's grid (`placeMapPoint`). Without one a `UtmPosition` needs a `UtmArea` |
| `useTargetAnchor({ fields, initial })` | anchors the `World` where the camera looks: to the field its target is over, or to a point about it over none; judged at rest, switched without anything moving on screen |
| `UtmAreaContext` | the area's conversions: `utmToArea`, `wgs84ToArea`, `areaToUtm`, `areaToWgs84`, `worldToArea`, `worldToUtm`, `worldToWgs84`; and its `id`, the host's name for the field |

### The surroundings: sky, sea, land and seabed

| Component / helper | Use |
|--|--|
| `Scenery` | the sky and the light, with the globe. `observer={{ date }}` inside a `World` puts the sun, moon and stars where they are at that moment over the frame's origin |
| `SceneryOcean` | the endless sea (`level`) and seabed (`depth`) |
| `SceneryStage` | the sea and seabed on real geometry around the field (its `boundary`), and with `relief` the land and seabed beyond, from your elevation data, read in the `World`'s frame |
| `SceneryAnchor` | places rigid content far from the field on the globe (a facility 100 km out) |
| `applyGlobe(material, globe)` | puts long content (a pipeline) on the globe per vertex |
| `useLevelHorizon()` | keeps the horizon level when the camera is far from the field: once the camera is at rest, rolling its view level (the default), or all the while (`mode: 'continuous'`) |
| `globe.place(x, z, height, target)`, `globe.altitude(p)`, `globe.foot(p, target)` | a point a given height over the sea at map X/Z, and the other way round. Far from the field, scene Y is not the altitude |

The globe is the `Scenery`'s; read it with `useWorld().globe` (or `useScenery`).

### GIS data and the minimap

| Component | Use |
|--|--|
| `GeoPolygons`, `GeoLabels` | GeoJSON polygons and their names, by longitude and latitude, on the globe (or flat without one) |
| `TrackLayer` | moving things from a tracking feed |
| `Minimap` | a 2D map of the same relief, following the camera. Draws in the scene's map, or in Web Mercator, Equal Earth or Lambert conformal conic (`projection`), switching for wide views with `'auto'` |
| `MinimapCameraMarker`, `MinimapTargetMarker`, `MinimapPoints`, `MinimapPolyline` | overlays at scene X/Z |
| `MinimapGeoLayer` | GeoJSON on the minimap |

### Elevation data (the store)

The relief and the minimap read elevation grids from your data store as two data sets:
`relief-meta` (a `ReliefMeta`: the grid and its `crs`, any proj4 projection, `EPSG:4326` for
longitude/latitude grids) and `relief-values` (blocks of the grid at a level). The sdk turns
what you have into that (`gridToRelief`, `irapbinToRelief`, `surfaceToRelief`) and cuts the
blocks (`reliefWindow`). See [relief.md](./relief.md#data).

---

## How they fit together

```
<Canvas>                                 three.js / R3F
  <DataProvider store>                   your data: wells, relief-meta, relief-values …
    <GeneratorsProvider registry>        incl. the sceneryReliefTile generator
      <World frame bounds>               ← where the scene lies on the Earth, once; owns the globe
        <Scenery observer={{ date }}>    ← sun from the frame's origin + date; draws on the globe
          <SceneryOcean />
          <SceneryStage />               ← its bounds the World's
        </Scenery>
        <GeoRelief layers />             ← land and seabed, by longitude/latitude, on the globe
        <UtmArea crsInstance bounds>     ← your field, in its map's metres
          <Wellbores … />
        </UtmArea>
        <Wgs84Position long lat>         ← a facility by longitude/latitude, outside the field: on the globe
          <MyPlatform />
        </Wgs84Position>
        <GeoPolygons data />             ← GIS, by longitude/latitude, on the globe
        <Minimap layers>                 ← the same relief, in 2D, in the World's frame
          <MinimapCameraMarker />
        </Minimap>
      </World>
```

- **Everything reads the `World`.** The `Scenery` takes its place for the sky, the relief its
  frame, the GIS layers and the minimap their conversions. One value, so they always agree.
- **The `World` owns the globe,** with or without a `Scenery`: the sky draws on it, and
  `UtmArea`, `SceneryAnchor`, the layers, `useLevelHorizon` and the minimap's altitudes use it,
  so turning the scenery on or off moves nothing.
- **More than one field:** each in its own `UtmArea` (its `boundary`, its stage, so it is
  placed best about its middle). Anchoring another is giving the `World` its `frame` and
  `boundary`;
  `onFrameChange` says how to carry the camera, `onFrameSettled` when to uncover the switch
  ([world.md, step 7](./world.md#switching-the-anchor-a-controlled-switch)). A field not
  anchored lies flat on the globe's tangent at its middle, so toward its edges it stands off
  the curved sea and relief (about 10 m at a 16 km field's corner, 29 m at a 27 km one's):
  unseen from afar, a few pixels close up. Anchor the field the camera is over, and give
  fields whose data meet across a border one stage between them
  ([world.md, 7g](./world.md#7g-judged-2026-11-02)). Which field a
  pick hit: name each area (`id`) and register its listeners with its area as their `ref`
  (`useContext(UtmAreaContext)` inside it), or make each field's handler inside it; the
  area's `worldToArea` and `worldToUtm` read the pick's `position` in that field
  ([world.md, 7f](./world.md#7f-built-2026-11-02)).
- **Or no field chosen at all:** `useTargetAnchor` anchors the `World` where the camera's
  target is: to the field it is over (its frame and boundary, so that field meets the sea and
  its stage is the anchored one), or to a point about it over none, with no stage area of its
  own. It judges only once the camera is at rest and never takes the controls from you; a
  switch changes nothing on screen (the camera is carried), and goes to or from a field only
  when the sea over its disc would move by less than a pixel
  ([world.md, the target anchor](./world.md#the-target-anchor-and-the-datum-built-2026-11-03)).
- **The relief is shared.** The `GeoRelief`, its far overview and the minimap draw the same
  tiles from the same `relief-meta` / `relief-values`, built by the `sceneryReliefTile`
  generator. Layers in the `World` lie on what the relief draws (`drape`).
- **Field data stays flat** in its `UtmArea`. Nothing about the sky or the globe changes it.

---

## Step by step: a field on the Earth

A small field on the Norwegian shelf, with sky, sea, land and seabed around it, licence polygons
from GeoJSON and a minimap. Each step adds one idea; the full example is at the end.

### 1. Providers and data

The relief is read through the data store and built into tiles by a generator, so the scene sits
inside a `DataProvider` and a `GeneratorsProvider` whose registry holds the
`sceneryReliefTile` generator (on a worker of its own if you like; see
[generators.md](./generators.md)).

```ts
import { sceneryReliefTile } from '@equinor/videx-3d'
import { generateSceneryReliefTile } from '@equinor/videx-3d/generators'
import { GeneratorRegistry } from '@equinor/videx-3d/sdk'

export const registry = new GeneratorRegistry()
registry.add(sceneryReliefTile, generateSceneryReliefTile)
```

Your store answers `relief-meta` and `relief-values` for each elevation grid. Held in memory,
that is a few lines:

```ts
import { gridToRelief, reliefWindow, type ReliefData } from '@equinor/videx-3d/sdk'

// e.g. a global grid in longitude/latitude, metres above sea level
const etopo: ReliefData = gridToRelief(
  { values, size: [nx, ny], origin: [-180, -90], cell: [1 / 60, 1 / 60], crs: 'EPSG:4326', rows: 'south' },
  { id: 'etopo', name: 'ETOPO 2022', noData: -99999 },
)
const reliefs = new Map([[etopo.meta.id, etopo]])

const store = {
  async get(dataType, key, args) {
    const relief = reliefs.get(String(key))
    if (dataType === 'relief-meta') return relief?.meta ?? null
    if (dataType === 'relief-values') return relief ? reliefWindow(relief, args) : null
    // … your other data sets (wellbores, …)
    return null
  },
  async all() { return null },
  async query() { return [] },
}
```

A store backed by a server asks it for the same windows instead, so terabytes of elevation data
need never be loaded whole: only the blocks in view are fetched (see [tiles.md](./tiles.md)).

### 2. Choose the frame and add a `World`

The field's map is UTM zone 31N, and its origin a point in the middle of it. `geoFrameFromCrs`
makes the frame from the same `CRS` the field is placed with, so the two cannot disagree.

```tsx
import { World } from '@equinor/videx-3d'
import { CRS, geoFrameFromCrs, getProjectionDefFromUtmZone } from '@equinor/videx-3d/sdk'

const crs = new CRS(getProjectionDefFromUtmZone('31N'), [435050, 6478550], 'utm')
const frame = geoFrameFromCrs(crs)

<World frame={frame}>{/* … */}</World>
```

No UTM field, just a place? `geoFrameAt(longitude, latitude)` gives a frame about it.

#### The datum

`getProjectionDefFromUtmZone('31N')` assumes **ED50**, as much of the North Sea's older data is
in it; say which datum your coordinates are in when they are not, as the same easting and
northing lie some 200 m apart between ED50 and WGS84 (234 m at Volve):

```ts
getProjectionDefFromUtmZone('31N', 'WGS84')   // GPS, most web maps
getProjectionDefFromUtmZone('31N', 'ETRS89')  // Europe's, within a metre of WGS84
getProjectionDefFromUtmZone('31N', { ellps: 'intl', towgs84: [-90.365, -101.13, -123.384, 0.333, 0.077, 0.894, 1.994] })
```

A `UtmArea` takes the same as `datum` with `utmZone`, or a whole proj4 definition as
`utmProjectionDef`. ED50's default shift is the 3-parameter one, 2–3 m from the 7-parameter
shifts published for the North Sea; give yours where that matters. ⚠️ proj4 reads a
7-parameter `towgs84` in the *position vector* convention: parameters published in the
*coordinate frame* convention (EPSG method 9607) need their three rotations negated. Heights
are not changed by any of this: an `altitude` is metres over the sea, as your data has it.

### 3. Put the field in a `UtmArea`

Field data goes inside a `UtmArea` with the same `CRS`: its children work in the map's metres,
the area moves them to the scene's origin.

```tsx
<UtmArea crsInstance={crs}>
  <Wellbores /* … */ />
  <UtmPosition easting={435200} northing={6478900}>
    <MyPlatform />
  </UtmPosition>
</UtmArea>
```

A second field in another zone gets a `UtmArea` of its own (with its own `CRS` or `frame`);
inside the `World` it places itself where it belongs.

**Recommended:** keep the `UtmArea` inside the `World` (step 2), even with a single field, and
place what you have in longitude and latitude and is not the field's data — a facility, a
marker — with a `Wgs84Position` outside the `UtmArea`, in the `World`. There it stands on the
Earth at the point: on the globe, upright and facing true north, at any distance, and placed
again when another field is anchored. Inside a `UtmArea` a `Wgs84Position` is field data,
flat in the field's map, and far from the field stands off the curved sea. What you have in
easting and northing goes the same way in a `UtmPosition` given its `projection`
(`getProjectionDefFromUtmZone('32N', 'WGS84')`, say), its children along that map's grid;
without one a `UtmPosition` needs a `UtmArea`, and its easting and northing are in the area's
map.

```tsx
<World frame={frame} boundary={[-8000, -8000, 8000, 8000]}>
  <UtmArea crsInstance={crs}>
    <Wellbores /* … */ />
  </UtmArea>
  <Wgs84Position long={2.53} lat={58.62}>
    <MyPlatform />
  </Wgs84Position>
</World>
```

### 4. Sky and sea

```tsx
<Scenery observer={{ date: new Date('2024-09-10T12:00:00Z') }}>
  <SceneryOcean level={0} depth={100} />
</Scenery>
```

The date alone is enough: the place comes from the `World`'s frame, so the sun stands where it
stood over the field at that moment, and compass north is true north there.

### 5. Land and seabed: a stage and a relief

The stage is the area of the field (scene X/Z, in metres; the `World`'s `boundary`): there the
sea and seabed are real geometry and the globe is flat. A `boundary` is a box
(`[minX, minZ, maxX, maxZ]`), a turned box (`{ box, rotation }`), a circle
(`{ centre, radius }`) or a polygon (a `PlanarPolygonGeometry`, or a ring of `[x, z]` points),
so a field turned against its grid needs no larger stage than itself; see
[scenery.md](./scenery.md#boundaries). A `GeoRelief` adds the land and seabed
from your grids, coarse to fine, each finer one winning where it has data.

```tsx
<World frame={frame} boundary={[-8000, -8000, 8000, 8000]}>
  <Scenery observer={{ date }}>
    <SceneryOcean level={0} depth={100} />
    <SceneryStage />
  </Scenery>
  <GeoRelief
    layers={[{ id: 'etopo' }, { id: 'my-survey', feather: 500 }]}
    color={{ ramp: 'terrain', seabed: { ramp: 'bathymetry' } }}
  />
</World>
```

The stage goes inside the `Scenery`; the relief anywhere in the `World`, which it is laid out
in, so the survey meets the field exactly.

### 6. GIS layers

GeoJSON in longitude and latitude, drawn on the globe. Pass the same collection object until the
data changes.

```tsx
<GeoPolygons data={licences} style={{ fill: '#2fbf4a' }} maxHeight={1500000} />
<GeoLabels data={licences} text={f => f.properties.name} maxHeight={250000} />
```

### 7. A minimap

The minimap draws the same relief from above, follows the camera and carries overlays at scene
X/Z. By default (`projection="auto"`) it draws in the scene's map close in and switches to Web
Mercator for wide views; give `zooms` reaching past 2000 km for it to switch. In the scene's map
a dashed outline marks the frame's UTM zone (`zoneBounds` to give another, `false` for none).

```tsx
<Minimap
  layers={[{ id: 'etopo' }, { id: 'my-survey', feather: 500 }]}
  zooms={[1000, 5000, 25000, 100000, 1000000, 5000000]}
>
  <MinimapCameraMarker />
  <MinimapPoints points={[{ at: [0, 0], label: 'Field' }]} />
  <MinimapGeoLayer data={licences} frame={frame} />
</Minimap>
```

It needs the same generator as the relief, and sits inside the `Canvas` (it follows the camera).

### 8. Going far: camera, horizon and depth

- **Far plane and depth.** To see the coast 200 km away the camera's far plane must reach it;
  use a logarithmic depth buffer so precision holds over that range:
  `<Canvas gl={{ logarithmicDepthBuffer: true }} camera={{ near: 0.1, far: 3_000_000 }}>`.
  With a shorter far plane the stage draws an overview of the relief past it.
- **Placing the camera far away.** Over the globe, scene Y is not altitude (the sea is 3 km below
  Y = 0 at 200 km). Use the globe: `globe.place(x, z, 2000, target)` is the point 2 km over the
  sea at map X/Z.
- **Level horizon.** `useLevelHorizon()` (inside the `World` or the `Scenery`) keeps the
  horizon level far from the field. By default it waits until the camera is at rest and rolls the
  view level over a moment, stopping the instant you take the controls again: while you move,
  the camera is exactly as you drive it. `mode: 'continuous'` keeps it level all the while
  instead, a few thousandths of a degree a frame.
- **Following the camera.** `useTargetAnchor` keeps the scene anchored where the camera looks,
  so no field has to be chosen and the origin stays near what is seen.

### The whole thing

```tsx
import { Canvas } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import {
  DataProvider, GeneratorsProvider, GeoLabels, GeoPolygons, GeoRelief, Minimap,
  MinimapCameraMarker, MinimapGeoLayer, Scenery, SceneryOcean, SceneryStage, UtmArea,
  Wgs84Position, World,
} from '@equinor/videx-3d'
import { CRS, geoFrameFromCrs, getProjectionDefFromUtmZone } from '@equinor/videx-3d/sdk'

const crs = new CRS(getProjectionDefFromUtmZone('31N'), [435050, 6478550], 'utm')
const frame = geoFrameFromCrs(crs)
const relief = [{ id: 'etopo' }, { id: 'my-survey', feather: 500 }]

export const FieldView = ({ store, registry, licences }) => (
  <Canvas gl={{ logarithmicDepthBuffer: true }} camera={{ position: [9000, 2500, 9000], far: 3_000_000 }}>
    <CameraControls makeDefault />
    <DataProvider store={store}>
      <GeneratorsProvider registry={registry}>
        <World frame={frame} boundary={[-8000, -8000, 8000, 8000]}>
          <Scenery observer={{ date: new Date('2024-09-10T12:00:00Z') }}>
            <SceneryOcean level={0} depth={100} />
            <SceneryStage />
          </Scenery>
          <GeoRelief
            layers={relief}
            color={{ ramp: 'terrain', seabed: { ramp: 'bathymetry' } }}
          />

          <UtmArea crsInstance={crs}>
            {/* your field: wellbores, surfaces, … */}
          </UtmArea>

          {/* a facility given by longitude and latitude, outside the field: on the globe */}
          <Wgs84Position long={2.53} lat={58.62}>
            <MyPlatform />
          </Wgs84Position>

          <GeoPolygons data={licences} maxHeight={1500000} />
          <GeoLabels data={licences} text={f => f.properties.name} maxHeight={250000} />

          <Minimap layers={relief} zooms={[1000, 5000, 25000, 100000, 1000000, 5000000]}>
            <MinimapCameraMarker />
            <MinimapGeoLayer data={licences} frame={frame} />
          </Minimap>
        </World>
      </GeneratorsProvider>
    </DataProvider>
  </Canvas>
)
```

The Storybook stories `Components/Misc/Scenery`, `Components/Html/Minimap` and
`Components/Layers/GeoLayers` are fuller versions of the same.

---

## Pitfalls

- **One frame.** Make the `World`'s frame from the same `CRS` the field is placed with
  (`geoFrameFromCrs(crs)`). Two slightly different origins put the relief and the field metres
  apart.
- **Metres everywhere.** Scene units are metres, and so are the frame's projection and a
  `CRS`'s. A projection in feet or degrees does not work as a frame (a grid in degrees is fine
  as relief data: give it `EPSG:4326`).
- **Scene Y is not altitude far from the field.** Under a `Scenery` the sea curves away beyond
  the stage. Place and read heights there with `globe.place` / `globe.altitude`, not Y.
- **`UtmPosition` and `Wgs84Position` inside a `UtmArea` are flat.** Right over the field; far
  out, content they place floats over the curved sea (about 3 km at 200 km). Put them in the
  `World` instead, outside the `UtmArea` (a `UtmPosition` with its `projection`), where they
  stand on the globe.
- **The datum.** `getProjectionDefFromUtmZone` assumes ED50; WGS84 coordinates read as ED50
  land some 200 m off. See [The datum](#the-datum).
- **A field in another UTM zone** goes in its own `UtmArea` inside the `World`, not converted
  point by point into the main zone.
- **No relief?** The stage and the minimap need the `sceneryReliefTile` generator in the
  nearest `GeneratorsProvider`, and the store must answer `relief-meta` and `relief-values`.
- **The far plane** must reach what you want to see, or the overview takes over past it; use a
  logarithmic depth buffer with a far plane of hundreds of kilometres.

## Further reading

- [world.md](./world.md): the design of frames, the `World` and the globe.
- [relief.md](./relief.md): the relief, its data and its looks; [tiles.md](./tiles.md): how it
  streams.
- [scenery.md](./scenery.md): the sky, the sea, the stage and the globe in detail.
- [layers.md](./layers.md): GIS polygons, labels and tracks.
- [minimap.md](./minimap.md): the minimap, its projections and overlays.
- [data.md](./data.md) and [generators.md](./generators.md): the store and the generators.
