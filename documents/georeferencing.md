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

Without a `Scenery` nothing curves: the scene is the map, flat, which is exactly right for a
field and a few tens of kilometres around it.

With a `Scenery`, the sea, the sky, the relief and the GIS layers lie on a **globe**. Over a flat
disc around the field (a `SceneryStage`'s `bounds`) the globe *is* the field's plane, so field
data never moves. Beyond it the Earth falls away, so coasts and mountains sit on the horizon
where they belong. Your field data stays flat in its own frame either way; the globe only
changes how the far surroundings are drawn.

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
| `CRS` | a UTM (or other) map about an origin: `utmToWorld`, `worldToUtm`, `wgs84ToWorld`, `worldToWgs84` |
| `getProjectionDefFromUtmZone('31N')` | the proj4 definition of a UTM zone |
| `solarPosition(date, latitude, longitude)` | the sun's azimuth and elevation |

### The scene and your field data

| Component | Use |
|--|--|
| `World` | says once, with a `frame`, where the scene lies on the Earth. Renders nothing |
| `UtmArea` | a container for field data in a map: its children are drawn in its map's metres about its origin. A `UtmArea` in **another** frame than the `World`'s (another UTM zone, a field 300 km away) places itself where the world's map has it, turned and scaled, and on the globe when there is one |
| `UtmPosition` / `Wgs84Position` | place children at an easting/northing or a longitude/latitude inside a `UtmArea` |
| `UtmAreaContext` | the area's conversions: `utmToArea`, `wgs84ToArea`, `areaToUtm`, `areaToWgs84`, `worldToUtm`, `worldToWgs84` |

### The surroundings: sky, sea, land and seabed

| Component / helper | Use |
|--|--|
| `Scenery` | the sky and the light, with the globe. `observer={{ date }}` inside a `World` puts the sun, moon and stars where they are at that moment over the frame's origin |
| `SceneryOcean` | the endless sea (`level`) and seabed (`depth`) |
| `SceneryStage` | the sea and seabed on real geometry around the field (`bounds`), and with `relief` the land and seabed beyond, from your elevation data, read in the `World`'s frame |
| `SceneryAnchor` | places rigid content far from the field on the globe (a facility 100 km out) |
| `applyGlobe(material, globe)` | puts long content (a pipeline) on the globe per vertex |
| `useLevelHorizon()` | keeps the horizon level when the camera is far from the field |
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
      <World frame>                      ← where the scene lies on the Earth, once
        <Scenery observer={{ date }}>    ← sun from the frame's origin + date; owns the globe
          <SceneryOcean />
          <SceneryStage bounds relief /> ← relief read in the World's frame
        </Scenery>
        <UtmArea crsInstance>            ← your field, in its map's metres
          <Wellbores … />
        </UtmArea>
        <GeoPolygons data />             ← GIS, by longitude/latitude, on the globe
        <Minimap layers>                 ← the same relief, in 2D, in the World's frame
          <MinimapCameraMarker />
        </Minimap>
      </World>
```

- **Everything reads the `World`.** The `Scenery` takes its place for the sky, the stage's relief
  its frame, the GIS layers and the minimap their conversions. One value, so they always agree.
- **The `Scenery` owns the globe** and hands it to the `World`; `SceneryAnchor`, the layers,
  `useLevelHorizon` and the minimap's altitudes use it.
- **The relief is shared.** The stage, its far overview and the minimap draw the same tiles from
  the same `relief-meta` / `relief-values`, built by the `sceneryReliefTile` generator.
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

### 4. Sky and sea

```tsx
<Scenery observer={{ date: new Date('2024-09-10T12:00:00Z') }}>
  <SceneryOcean level={0} depth={100} />
</Scenery>
```

The date alone is enough: the place comes from the `World`'s frame, so the sun stands where it
stood over the field at that moment, and compass north is true north there.

### 5. Land and seabed: a stage with relief

The stage is the area of the field (scene X/Z, in metres): there the sea and seabed are real
geometry and the globe is flat. `relief` adds the land and seabed from your grids, coarse to
fine, each finer one winning where it has data.

```tsx
<SceneryStage
  bounds={[-8000, -8000, 8000, 8000]}
  relief={{
    layers: [{ id: 'etopo' }, { id: 'my-survey', feather: 500 }],
    color: { ramp: 'terrain', seabed: { ramp: 'bathymetry' } },
  }}
/>
```

It goes inside the `Scenery`. Its relief is read in the `World`'s frame, so the survey meets the
field exactly.

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

It needs the same generator as the stage, and sits inside the `Canvas` (it follows the camera).

### 8. Going far: camera, horizon and depth

- **Far plane and depth.** To see the coast 200 km away the camera's far plane must reach it;
  use a logarithmic depth buffer so precision holds over that range:
  `<Canvas gl={{ logarithmicDepthBuffer: true }} camera={{ near: 0.1, far: 3_000_000 }}>`.
  With a shorter far plane the stage draws an overview of the relief past it.
- **Placing the camera far away.** Over the globe, scene Y is not altitude (the sea is 3 km below
  Y = 0 at 200 km). Use the globe: `globe.place(x, z, 2000, target)` is the point 2 km over the
  sea at map X/Z.
- **Level horizon.** `useLevelHorizon()` (inside the `Scenery`) keeps the horizon level far from
  the field.

### The whole thing

```tsx
import { Canvas } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import {
  DataProvider, GeneratorsProvider, GeoLabels, GeoPolygons, Minimap, MinimapCameraMarker,
  MinimapGeoLayer, Scenery, SceneryOcean, SceneryStage, UtmArea, World,
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
        <World frame={frame}>
          <Scenery observer={{ date: new Date('2024-09-10T12:00:00Z') }}>
            <SceneryOcean level={0} depth={100} />
            <SceneryStage
              bounds={[-8000, -8000, 8000, 8000]}
              relief={{ layers: relief, color: { ramp: 'terrain', seabed: { ramp: 'bathymetry' } } }}
            />
          </Scenery>

          <UtmArea crsInstance={crs}>
            {/* your field: wellbores, surfaces, … */}
          </UtmArea>

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
- **`UtmPosition` and `Wgs84Position` are flat.** Right over the field; far out, content they
  place floats over the curved sea (about 3 km at 200 km). Wrap it in a `SceneryAnchor` at its
  point, or give it a `UtmArea` of its own.
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
