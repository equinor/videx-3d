# Relief: land and seabed around the stage

A `SkyBoxStage` can put land and seabed from your own elevation data around the scene: a
`relief`, merged from several data sets at once — global, regional, local — and drawn from
tiles, as fine as the data where the camera is and no finer anywhere else. Below sea level
it is the seabed, seen through the water as the stage's own seabed is; above sea level it
is land, lit by the sky's sun and fading into the air as the far sea does. It covers
everything out to the sea's horizon, the stage's own area and its occupants included, and
with the sky's `curvedHorizon` falls away with the Earth's curve, so coasts and mountains
stand on the horizon where they should. It is off by default.

```tsx
<Sky ocean={{ level: 0, depth: 120 }}>
  <SkyBoxStage
    bounds={[minX, minZ, maxX, maxZ]}
    occupants={[{ outline, onStage, onGround }]}
    relief={{
      // the UtmArea's map; reliefFrameAt(longitude, latitude) for a scene placed by a point
      frame: reliefFrameFromCrs(crs),
      // coarse to fine: later layers win where they have data
      layers: [
        { id: 'etopo-2022-nordic' },
        { id: 'emodnet-2020-sw-norway', feather: 1500 },
        { id: 'my-survey', feather: 500 },
      ],
      depth: 100, // the flat seabed where no layer has data; default the sea's depth
      color: 'ramp',
    }}
  />
</Sky>
```

Without a relief the stage draws a flat seabed at the sea's depth, and its occupants draw
their own. With one, the relief is the ground over the occupants too: a `ChunkStack`
builds its column's top on it, ends its faces where it is drawn and places what stands on
it by its sampler. See [tiles.md](./tiles.md) for the design and the bridge to the chunks.

## Data

Each layer is a relief in the store, as two data sets (see [Data](./data.md)):

- `relief-meta`: a `ReliefMeta` record — the grid (its south-west node's map coordinates,
  its cell, its size and rotation, as an irapbin header lays it out) and the map it is
  laid out in (`crs`: a proj4 definition, or a name proj4 knows, such as `EPSG:4326` for
  longitude/latitude).
- `relief-values`: a `Float32Array` of metres above mean sea level, positive up, `NaN`
  where there is none, row-major from the northern row, for a window of the grid
  (`ReliefWindow`): a level of it (each level averages 2 x 2 of the one below) and a block
  of that level. The tiles ask for blocks of 128 x 128 at any level, so a store can cache
  by level and block. A store holding a relief whole answers with `reliefWindow`;
  `gridToRelief`, `irapbinToRelief`, `surfaceToRelief` and `functionRelief` (sdk) make
  one from what a host has.

One grid may hold both land and seabed: ETOPO 2022 (NOAA, public domain) and GEBCO run
from the deepest seabed to the mountain tops. A layer fades in over its `feather` (scene
units) from where its data ends, its holes and a coast without land data included, so a
finer survey merges into the one under it without a step.

The `skyReliefTile` generator (`generateSkyReliefTile`) builds each tile where the
generators run: it reads the blocks it needs from every layer, projects them into the
scene and merges them, so the stage needs a `GeneratorsProvider`. Nest a second provider
around the `Sky`, on a worker of its own, and the tiles stream while a column builds on
the other.

`frame` says where the scene lies on the map: the projection it is drawn in and the map
coordinates of its origin, as a `UtmArea` places a scene (scene X east, scene Z south).
`reliefFrameFromCrs(crs)` gives the frame of a scene a `UtmArea` places with `crs`; with
the same CRS, `crsOriginLocation(crs)` gives the sky's `observer` its place
(`{ date, ...crsOriginLocation(crs) }`), so the field, the relief and the sun agree.
`reliefFrameAt(longitude, latitude)` gives a transverse Mercator map about a point, for a
scene placed by its longitude and latitude only.

### The demo reliefs

The stories' store holds four, coarse to fine: ETOPO 2022 from 12°W to 32°E and 49°N to
72°N at 2 arc-minutes (`etopo-2022-nordic`), ETOPO 2022 at 15″ and EMODnet at 1/8′ from
Volve east to the coast (EMODnet has no land), and EMODnet at 1/16′ around Volve. They
are not in git: `npm run generate-relief` fetches them into `public/relief/` (which git
ignores), and `npm run build-static` runs it first, so the deployed Storybook has them.
The demo store also bakes any of its surfaces into a relief on demand
(`surface:<id>`, with `surfaceToRelief`), and makes StageDebug's synthetic ground; the
stories add them over the demo reliefs as their own finest layers (`reliefLayers`,
`skyReliefFromArgs`).

## How it fits the stage

- The relief is the stage's seabed, everywhere. Over `bounds` it is see-through at the
  sea's `seabedOpacity`; around it, always opaque.
- Over each occupant's `outline` the cutaway takes the water but not the ground. The
  relief stays whole under an occupant's `cut` unless its `keepBed` is off; then it is cut
  with the occupant inside the outline (one occupant at most).
- Each occupant's `onGround` hands out the ground as drawn over its outline's bounds (a
  `HeightFieldClip`), and there the tiles' error shows no more than half a pixel. The
  relief's `onSampler` hands out its sampler (`ReliefSampler`), which answers from the
  finest tiles in, as their triangles draw them; what is placed with it pins the finest
  tiles under it, whatever the view.
- `color`: a colour is the land's, the seabed taking the sea's; `'ramp'` colours the land
  by height — green lowland, umber at 600 m, grey high ground at 1500 m, eased between —
  and darkens the sea's seabed colour with depth, to half 600 m below the sea's seabed.
- The tiles miss the curved sea by up to tens of metres where they are coarse, so the
  ground's height decides which shows: seabed stays behind the sea over it, and where the
  view would meet the sea over land the land comes in front.
- Land, and a dry seabed, fade through the air as the sea does, channel by channel and
  blue a little fastest, so distant land turns blue before it fades into the horizon,
  but keeps its own colour in most views.
- The sea stays flat over the disc holding `bounds`, and the stage's sea surface writes
  the depth of the curved sea beyond it, so land beyond the scene meets it there. Once the
  camera is 5 to 40 km past the scene, the curve is measured from under the camera, and
  the stage places each occupant's `anchor` (and a `SkyAnchor` its children) on it.
- The ground under the camera is the sky's (`oceanGround`): under the relief the camera is
  in the ground, for the lighting and the void.
- `debug.hide: ['relief']` hides it, like the stage's other layers; `debug.relief`
  shows its tiles by depth (`'tiles'`) or which layer gave each node (`'layers'`).

## Level of detail

The tiles are a quadtree over the scene, 32 x 32 cells each, drawn in one instanced draw.
Each frame a tile is split while its error — the largest gap between its surface and the
merged data — spans more than `pixelError` pixels (default 2), or while its cells span
more than `cellPixels` (default 8) where the ground is rough, as the relief is shaded from
its cells. A tile with no finer data under it is never split. A split tile is drawn until
its four children are in, so ground is never missing; skirts close the cracks between
tiles of different depths. Tiles load a few at a time, the most wanted first, and the
least recently drawn go first under a budget. `onStats` reports what is drawn and held.

## The far plane

The tiles, and the stage's sea and seabed, reach the camera's far plane, measured along
the curved sea; past that the sky's own sea takes over. Any shorter, and the scene between
would show through the sky's sea, which is drawn on the far plane. Where the far plane
falls short of the sea's horizon, an overview draws the relief's FIRST layer on past the
tiles, on a fullscreen layer at the far plane (the `skyRelief` generator resamples it):
what it holds above the sea, shaded and faded through the air, but flat on the curved sea.

For mountains on the horizon, set the far plane past it from the highest the camera goes:
about 360 km from 10 km up, 760 km from 45 km and 1130 km from 100 km (the sky stories
use 3000 km, so no overview is made). With a logarithmic depth buffer that costs almost
nothing (about 1 m of depth resolution at 1000 km); with a standard one, a far plane that
far from a near plane of centimetres has no resolution left, so use a logarithmic or
reversed depth buffer. Either way the GPU clips by the ordinary clip depth, which that far
from a near plane of centimetres rounds past the far plane and drops vertices at random:
the tiles, and the stage's sea and seabed, keep their vertices just inside it.

## Limits

- Changing the layers or `depth` rebuilds a column built on the relief.
- A quick fly-in shows coarser tiles for a moment while the finer ones load.
- Where a layer's data ends with no layer under it, the ground falls to the flat seabed at
  `depth`.
- The environment bakes do not include it.
- ⚠️ It assumes the default `up` (+Y), as the stage does.