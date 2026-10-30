# Relief: land and seabed around the stage

A `SceneryStage` can put land and seabed from your own elevation data around the scene: a
`relief`, merged from several data sets at once — global, regional, local — and drawn from
tiles, as fine as the data where the camera is and no finer anywhere else. Below sea level
it is the seabed, seen through the water as the stage's own seabed is; above sea level it
is land, lit by the sky's sun and fading into the air as the far sea does. It covers
everything out to the sea's horizon, the stage's own area and its occupants included, and
with the sky's `globe` falls away with the Earth's curve, so coasts and mountains
stand on the horizon where they should. It is off by default.

```tsx
<World frame={geoFrameFromCrs(crs)}>
  <Scenery>
    <SceneryOcean level={0} depth={120} />
    <SceneryStage
      bounds={[minX, minZ, maxX, maxZ]}
      occupants={[{ outline, onStage, onGround }]}
      relief={{
        // read in the World's frame; or a `frame` of its own (`geoFrameAt` about a point)
        // coarse to fine: later layers win where they have data
        layers: [
          { id: 'etopo-2022-nordic' },
          { id: 'emodnet-2020-sw-norway', feather: 1500 },
          { id: 'my-survey', feather: 500 },
        ],
        depth: 100, // the flat seabed where no layer has data; default the sea's depth
        color: { ramp: 'terrain', seabed: { ramp: 'bathymetry' } },
        contours: { interval: 100, major: 5 },
        layerLooks: { 'my-survey': { color: { ramp: 'rainbow', min: -130, max: -60 } } },
      }}
    />
  </Scenery>
</World>
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

The `sceneryReliefTile` generator (`generateSceneryReliefTile`) builds each tile where the
generators run: it reads the blocks it needs from every layer, projects them into the
scene and merges them, so the stage needs a `GeneratorsProvider`. Nest a second provider
around the `Scenery`, on a worker of its own, and the tiles stream while a column builds on
the other.

`frame` says where the scene lies on the map, a `GeoFrame`: the projection it is drawn in
and the map coordinates of its origin, as a `UtmArea` places a scene (scene X east, scene Z
south). By default it is the enclosing `World`'s, which also gives the sky's `observer` its
place and places each field, so the fields, the relief and the sun agree from one value
([world.md](./world.md#10-step-3-in-detail-fields-placed-on-the-earth)).
`geoFrameFromCrs(crs)` gives the frame of a scene a `UtmArea` places with `crs`;
`geoFrameAt(longitude, latitude)` gives a transverse Mercator map about a point, for a
scene placed by its longitude and latitude only. The relief is laid out in that frame, the
chosen field's, where it meets the field's column exactly; a field placed in another frame
meets it to its placement's precision (about 10 cm 5 km around, 120 km off).

### The demo reliefs

The stories' store holds four, coarse to fine: ETOPO 2022 from 12°W to 32°E and 49°N to
72°N at 2 arc-minutes (`etopo-2022-nordic`), ETOPO 2022 at 15″ and EMODnet at 1/8′ from
Volve east to the coast (EMODnet has no land), and EMODnet at 1/16′ around Volve. They
are not in git: `npm run generate-relief` fetches them into `public/relief/` (which git
ignores), and `npm run build-static` runs it first, so the deployed Storybook has them.
The demo store also bakes any of its surfaces into a relief on demand
(`surface:<id>`, with `surfaceToRelief`), and makes StageDebug's synthetic ground; the
stories add them over the demo reliefs as their own finest layers (`reliefLayers`,
`sceneryReliefFromArgs`).

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
- Each time it chooses, it tells the tiles it draws to its `Scenery`'s
  `SceneryOceanState.reliefTiles` (a `SceneryReliefHub`: the heights' texture array, per
  tile drawn its slot, the tile it blends from and how far, and the ground's range over any
  geographic tile), so a tiled layer inside
  the `Scenery` lies on it exactly (`drape`, see [layers.md](./layers.md#on-the-relief-drape)).
  One stage's relief at a time. Its `keysVersion` changes only when the set of tiles drawn
  does (its `index` and `ancestors` are kept meanwhile), so what was found over them is
  looked for again only then (`GeoTubes`' nodes).
- `color` and `contours`: see [Colour and contours](#colour-and-contours).
- The tiles miss the curved sea by up to tens of metres where they are coarse, so the
  ground's height decides which shows: seabed stays behind the sea over it, and where the
  view would meet the sea over land the land comes in front.
- Land, and a dry seabed, fade through the air as the sea does, channel by channel and
  blue a little fastest, so distant land turns blue before it fades into the horizon,
  but keeps its own colour in most views. From space the sky's own dry seabed past the
  tiles is lit and hazed as their ground is, so the two meet without a seam at their reach.
- The sea stays flat over the disc holding `bounds` and lies on the sky's globe beyond it;
  the relief is placed on the same globe, and the stage's sea surface writes the depth of
  the sea on it, so land beyond the scene meets it there. Nothing in either depends on the
  camera, so the ground holds still against the sea from anywhere. What is drawn flat
  beyond the disc stands off it unless placed on the globe (`SceneryAnchor`, `applyGlobe`; see
  [scenery.md](./scenery.md#the-globe)).
- The ground under the camera is the sky's (`oceanGround`), sampled on the triangles drawn:
  under the relief the camera is in the ground, for the lighting and the void — below the
  sea, and in land above it too — and over it in the water, however deep (a trench below
  the sea's `depth`: `SceneryMaterial.oceanTrench`). Under it the relief is the void's lid:
  its undersides are drawn, shaded as the void's lid, and nothing above them is. In it
  above the sea's own seabed (`SceneryMaterial.oceanBuried`) none of the sea or the
  overview is drawn: the sky shows the void as from just below the sea's seabed and the
  scene is lit as the subsurface, so from inside a hill the data is seen in rock rather
  than the sea through it. ⚠️ The void is laid out in the field's frame: far from the
  field (any hill on land, from Volve) it is black. The lid leaves pixels to the background
  (toward the horizon, and to the walls), so what lies above it is hidden by not being
  drawn, not by depth: the sea surface hides itself, and the geographic layers do the same
  (`sceneryLidOverCamera`, `layerShownAt`; see
  [layers.md](./layers.md#when-a-layer-is-drawn)).
- From in the water, land is seen through the water as the seabed is.
- `debug.hide: ['relief']` hides it, like the stage's other layers; `debug.relief`
  shows its tiles by depth (`'tiles'`) or which layer gave each node (`'layers'`).

## Colour and contours

How the relief looks is data, not shader code: changing any of it uploads a small table
(`SceneryReliefLooks`) and compiles nothing.

- **`color`**, one of:
  - a colour: the land flat, the seabed the sea's seabed colour. Default `#34433b`.
  - `{ ramp, min?, max?, reverse?, seabed? }`: the ground by height, in metres from the
    sea's level, through a colour ramp from the shared ramps (below), by name, row or a
    `ColorRamp` of your own. `min` and `max` set the heights at its ends: by default a
    terrain ramp's own range, else 0 to 2000 m (−3000 to 2000 m with the seabed on it). A
    value ramp with no range of its own (`rainbow`, `jet`, …) runs as it does on a
    `Surface`, which takes depths: from its start at the top, so a ground looks the same
    either way. `seabed` is `'sea'` (default: the sea's seabed colour, darker with depth,
    to half 600 m below the stage's seabed), `'ramp'` (the same ramp across land and
    seabed alike) or a ramp of its own (`{ ramp: 'bathymetry' }`).
  - `'ramp'`: short for `{ ramp: 'terrain' }`.
- **`contours`**: `true`, or `{ interval?, major?, thickness?, colorMode?, factor?, color?, seabed? }`.
  Lines every `interval` metres from the sea's level (default 100), a major one twice as
  wide every `major`-th (default 5; 0 for none), shading the ground as a `Surface`'s do
  (`ContourColorMode`, default darken by 0.5). On the seabed too unless `seabed: false`.
  Each is a solid line `thickness` pixels each side (default 0.8) with a pixel's soft
  edge, as wide on steep ground and at grazing angles as on flat ground: its distance
  from the line is measured in pixels by the height's slope on screen. Lines fade out
  between 8 and 3 pixels apart, minor ones first, so a distant view is no smear or moiré.
  `Surface` contours are drawn the same way (`contours.glsl`). The tiles and the overview
  past them draw the same lines, so they run on across where one hands over to the other.
- **`layerLooks`**: a look of its own for a layer, by its id, `{ color?, contours? }`,
  each falling back to the relief's. A local survey can be a rainbow over its depths with
  5 m contours while the regional data stays a terrain ramp. Each tile node keeps the
  layer that gave most of it (as `debug.relief: 'layers'` shows), so the look changes
  where one layer's data takes over from another's, node by node: a hard edge, at the
  tile's resolution. The overview past the tiles takes them the same way, pixel by pixel.
  Up to 31 layers have looks of their own; past that a layer takes the relief's.

The colour ramps are shared with `Surface` and the seismic views
([color-ramps.ts](../src/common/color-ramps.ts)): a texture of up to 64 rows. Rows 0–9
are the value ramps as they always were (`rainbow`, `jet`, `portland`, `earth`, `plasma`,
`salinity`, `seismic`, `seismic2`, `spectrum`, `gray`); then ramps by height in metres:
`terrain` (green lowland, olive and ochre upland, brown mountains, grey rock and snow, to
6000 m), `atlas` (an atlas's tints, to 5000 m), `terrain-nordic` (the old relief ramp, to
1500 m) and `bathymetry` (−6000 to 0 m). `registerColorRamp` adds your own:

```ts
registerColorRamp({
  name: 'my-ramp',
  domain: [-200, 0], // stops in metres; without one, 0 to 1
  interpolation: 'rgb', // default 'hcl'
  stops: [
    { at: -200, color: '#102040' },
    { at: -100, color: '#2f6ea8' },
    { at: 0, color: '#d0e8f0' },
  ],
});
```

A `ColorRamp` object can also be passed directly where a ramp is taken; it is registered
the first time. `Surface.colorRamp` takes a name or a `ColorRamp` too.

## Level of detail

The tiles are a quadtree over the scene, 32 x 32 cells each, drawn in one instanced draw.
Each frame a tile is split while its error — the largest gap between its surface and the
merged data — spans more than `pixelError` pixels (default 2), or while its cells span
more than `cellPixels` (default 8) where the ground is rough, across a coast, or where a
finer layer ends, as the relief is shaded from its cells. A tile with no finer data under
it is never split; a layer smaller than a tile's cells still splits it, so a small local
layer draws at its own detail from every height. A split tile is drawn until
its four children are in, so ground is never missing; skirts close the cracks between
tiles of different depths. Tiles load a few at a time, the most wanted first, and the
least recently drawn go first under a budget. `onStats` reports what is drawn and held.

## The far plane

The tiles, and the stage's sea and seabed, reach the camera's far plane, measured along
the curved sea; past that the sky's own sea takes over. Any shorter, and the scene between
would show through the sky's sea, which is drawn on the far plane. Where the far plane
falls short of the sea's horizon, an overview draws the relief on past the tiles, on a
fullscreen layer at the far plane, from the same tiles, chosen for it as fine as the pixels
there (see [tiles.md](./tiles.md#the-overview)): what it holds above the sea, shaded and
faded through the air, but flat on the curved sea.

The two hand over where the tiles' ground passes their reach. The overview lies on the sea's
level, the ground below it by its depth, so the overview starts where the view meets the
deepest ground in (`uReliefLowest`) past the reach, a little short of where it meets the
sea; where the tiles still draw they lie nearer, and win by depth. Started where the view
met the sea's level, it left the background's own flat seabed showing in a ring between the
two, widest over deep water seen at a slant, with the water off (2026-10-30). Toward their
reach the tiles take the overview's detail (its 2 pixel cells, and every tile split by
them where it is coloured by height), eased in from half the reach, and where a pixel is
finer than a cell the overview takes the tiles' contours and normals, so the two meet
without a step. Left: flat on the sea, the overview's ground stands short of the tiles' by
its depth over the slant (about 1.3 km, 2–3 pixels, from 380 km up over the Norwegian Sea).

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
- The same layers can be drawn as a minimap that follows the camera: see [minimap.md](./minimap.md).
- ⚠️ It assumes the default `up` (+Y), as the stage does.