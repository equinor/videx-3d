# Relief: land and seabed from your own elevation data

A `GeoRelief` puts land and seabed from your own elevation data on the Earth: merged from
several data sets at once — global, regional, local — and drawn from tiles, as fine as the
data where the camera is and no finer anywhere else. It is Earth data, as the geographic
layers are: placed by latitude and longitude on the `World`'s globe, anywhere inside the
`World`, beside the `Scenery` or in it. It is the `Scenery`'s seabed: with no data, or none
of its layers covering a place, the seabed lies flat at its `depth` (by default the sea's),
and a `<GeoRelief />` with no layers is that flat seabed alone; without a `GeoRelief` the
sea has no seabed, and the void lies below the water. With a `Scenery` and its sea, below
sea level it is the seabed, seen through the water as the stage's own seabed is; above sea
level it is land, lit by the sky's sun and fading into the air as the far sea does. It
covers everything out to the sea's horizon, the stage's own area and its occupants
included, and on a curved globe falls away with the Earth's curve, so coasts and mountains
stand on the horizon where they should. Without a `Scenery` it is drawn plainly, lit by the
scene's lights, at an `opacity` of its own (and a `fieldOpacity` over the fields: the
`World`'s `boundary` and each field loaded in it; see
[Without a Scenery](#without-a-scenery)), and its tiles stay in as a `Scenery` comes and goes.

```tsx
<World frame={geoFrameFromCrs(crs)} boundary={[minX, minZ, maxX, maxZ]}>
  <Scenery>
    <ScenerySea level={0} depth={120} />
    <SceneryStage occupants={[{ outline, onStage, onGround }]} />
  </Scenery>
  <GeoRelief
    // laid out on the World's globe, by latitude and longitude
    // coarse to fine: later layers win where they have data
    layers={[
      { id: 'etopo-2022-nordic' },
      { id: 'emodnet-2020-sw-norway', feather: 1500 },
      { id: 'my-survey', feather: 500 },
    ]}
    depth={100} // the flat seabed where no layer has data; default the sea's depth
    color={{ ramp: 'terrain', seabed: { ramp: 'bathymetry' } }}
    seabed={{ color: '#8c8573' }} // the seabed's own look, where the colour gives it no ramp
    fieldOpacity={0.6} // see-through over the fields: the data under the seabed shows
    contours={{ interval: 100, major: 5 }}
    layerLooks={{ 'my-survey': { color: { ramp: 'rainbow', min: -130, max: -60 } } }}
    onProgress={reportReliefProgress} // its tiles loading, for a progress display
  />
</World>
```

With no layers, the stage draws the flat seabed at the sea's depth itself, and its occupants
draw their own. With layers, the relief is the ground over the occupants too: a `ZoneStack`
builds its column's top on it, ends its faces where it is drawn and places what stands on it
by its sampler. See [tiles.md](./tiles.md) for the design and the bridge to the zones. One
`GeoRelief` to a `World`.

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
scene and merges them, so the relief needs a `GeneratorsProvider`. Nest a second provider
around the `GeoRelief` (and the `Scenery`), on a worker of its own, and the tiles stream while
a column builds on the other.

What samples the same ground elsewhere takes the relief's tiles from the `World`
(`useWorldRelief().loader`, a `ReliefTileLoader`; `useReliefTileLoader` makes one for any
layers): geographic tiles of any depth and cells, or with `heightsOnly` their heights alone,
without the normals and the error that take most of a tile's work. `geoReliefTileGrid`
stitches tiles of one depth into a grid of longitude and latitude. Asked for a grid of tiles
(`loadGrid`, a `GeoReliefGridRequest` in place of a tile's key), the same generator builds
their heights and stitches them where it runs (`buildGeoReliefTileGrid`) and hands the grid
back whole, so a host registering the generator needs nothing more. The `Scenery`'s ground
map takes its grids so: stitched on the main thread they took 28–113 ms each, every second or
two while the camera moved fast (2026-11-19). The 3D clouds take their terrain from that map
([clouds.md](./clouds.md), "Over the ground"); a `GeoMap` loads its own tiles one by one.

Where the scene lies on the map is the enclosing `World`'s `frame`, a `GeoFrame`: the
projection it is drawn in and the map coordinates of its origin, as a `UtmArea` places a
scene (scene X east, scene Z south). It also gives the sky's `observer` its place and places
each field, so the fields, the relief and the sun agree from one value
([world.md](./world.md#10-step-3-in-detail-fields-placed-on-the-earth)).
`geoFrameFromCrs(crs)` gives the frame of a scene a `UtmArea` places with `crs`;
`geoFrameAt(longitude, latitude)` gives a transverse Mercator map about a point, for a
scene placed by its longitude and latitude only. The relief is laid out in that frame, the
chosen field's, where it meets the field's column exactly; a field placed in another frame
meets it to its placement's precision (about 10 cm 5 km around, 120 km off). Without a
`World` no relief is drawn.

### The demo reliefs

The stories' store holds five, coarse to fine: ETOPO 2022 over the whole world at 10 arc-minutes
(`etopo-2022-world`), ETOPO 2022 from 12°W to 32°E and 49°N to
72°N at 2 arc-minutes (`etopo-2022-nordic`), ETOPO 2022 at 15″ and EMODnet at 1/8′ from
Volve east to the coast (EMODnet has no land), and EMODnet at 1/16′ around Volve. They
are not in git: `npm run generate-relief` fetches them into `public/relief/` (which git
ignores), and `npm run build-static` runs it first, so the deployed Storybook has them.
The demo store also bakes any of its surfaces into a relief on demand
(`surface:<id>`, with `surfaceToRelief`), and makes StageDebug's synthetic ground; the
stories add them over the demo reliefs as their own finest layers (`reliefLayers`,
`sceneryReliefFromArgs`).

## How it fits the stage

- With a `SceneryStage`, the relief is its seabed, everywhere. Over the stage's `boundary`, and
  over every field loaded in the `World` (each `UtmArea` with a `boundary`, in its own frame,
  each of its own shape; `useWorldFields`), it is see-through at its `fieldOpacity`, so a neighbour's wells
  under its seabed show too; around them, always opaque. Up to eight such regions
  (`SCENERY_RELIEF_MAX_REGIONS`), the eight nearest the camera when there are more, each tested
  in its own field's frame, turned as it is (`reliefTileInRegion`). The stage hands the
  `World` what only it has — its area, its occupants' outlines and cut, their ground — and the
  relief takes them from there.
- Over each occupant's `outline` the cutaway takes the water but not the ground. The
  relief stays whole under an occupant's `cut` unless its `keepBed` is off; then it is cut
  with the occupant inside the outline (one occupant at most).
- Each occupant's `onGround` hands out the ground as drawn over its outline's bounds (a
  `HeightFieldClip`), and there the tiles' error shows no more than half a pixel. The
  relief's `onSampler` hands out its sampler (`ReliefSampler`), which answers from the
  finest tiles in, as their triangles draw them; what is placed with it pins the finest
  tiles under it, whatever the view.
- Each time it chooses, it tells the tiles it draws to its `World`
  (`WorldReliefState.tiles`, `useWorldRelief`; a `Scenery` in the `World` hands on the same as
  `ScenerySeaState.reliefTiles`): a `SceneryReliefHub` — the heights' texture array, per
  tile drawn its slot, the tile it blends from and how far, and the ground's range over any
  geographic tile — so a tiled layer in the `World` lies on it exactly (`drape`, see
  [layers.md](./layers.md#on-the-relief-drape)).
  One relief at a time. Its `keysVersion` changes only when the set of tiles drawn
  does (its `index` and `ancestors` are kept meanwhile), so what was found over them is
  looked for again only then (`GeoTubes`' nodes).
- `color` and `contours`: see [Colour and contours](#colour-and-contours).
- The tiles miss the curved sea by up to tens of metres where they are coarse, so the
  ground's height decides which shows: seabed stays behind the sea over it, and where the
  view would meet the sea over land the land comes in front.
- Land, and a dry seabed, fade through the air as the sea does, channel by channel and
  blue a little fastest, so distant land turns blue before it fades into the horizon,
  but keeps its own colour in most views. The colours it fades into are read from the air's
  lookup, drawn once for the camera's place (scenery.md, "The air"). From space the sky's own dry seabed past the
  tiles is lit and hazed as their ground is, so the two meet without a seam at their reach.
- Over a dry sea the sky's own seabed lies as deep as the ground where the view meets it (the
  `Scenery`'s ground map, once it is in; the sea's `depth` until then), its edge eased over its
  last two pixels: a view that passes over deeper ground meets none of it. Flat, the sea's
  `depth` down, it had shown over deep basins as a strip under the horizon, its own horizon
  higher than the tiles' (0.5°, some 10 pixels, from 13 km up over 4 km of water; 2026-11-19).
  Left out wherever the tiles reach instead, it no longer covered the Earth while its tiles
  loaded, and from space the sky's glow at the Earth's edge showed across the whole of it.
- Under a relief the sky's own seabed shows only where no tile is drawn yet, or past their
  edge, and it is drawn last, behind them by depth, so it costs nothing where they are. It is
  drawn plain: in the relief's own look (`SceneryMaterial.seaReliefLooks`) by the ground
  map's height, from the air and from space alike (`scenerySeabedAlbedo`), without contours or
  the seabed's sand detail. While the tiles load, the Earth
  is then a coarse version of itself rather than the seabed's flat colour.
- The sea stays flat over the disc holding the `boundary` and lies on the sky's globe beyond it;
  the relief is placed on the same globe, and the stage's sea surface writes the depth of
  the sea on it, so land beyond the scene meets it there. Nothing in either depends on the
  camera, so the ground holds still against the sea from anywhere. What is drawn flat
  beyond the disc stands off it unless placed on the globe (`SceneryAnchor`, `applyGlobe`; see
  [scenery.md](./scenery.md#the-globe)).
- The ground under the camera is the sky's (`seaGround`, which the `Scenery` takes from the
  camera site each frame: the relief's probe, `CameraSite.ground`, see
  [camera.md](./camera.md#where-the-camera-is)), sampled on the triangles drawn:
  under the relief the camera is in the ground, for the lighting and the void — below the
  sea, and in land above it too — and over it in the water, however deep (a trench below
  the sea's `depth`: `SceneryMaterial.seaTrench`). Under it the relief is the void's lid:
  its undersides are drawn, shaded as the void's lid, and nothing above them is. In it
  above the sea's own seabed (`SceneryMaterial.seaBuried`) none of the sea or the
  overview is drawn: the sky shows the void as from just below the sea's seabed and the
  scene is lit as the subsurface, so from inside a hill the data is seen in rock rather
  than the sea through it. The void is the same under any field: its gradient and its lid
  are laid out by the camera's own up (the look frame), the lid as deep over the camera as
  it is under the seabed on the globe. The lid leaves pixels to the background
  (toward the horizon), so what lies above it is hidden by not being
  drawn, not by depth: the sea surface hides itself, and the geographic layers do the same
  (`sceneryLidOverCamera`, `layerShownAt`; see
  [layers.md](./layers.md#when-a-layer-is-drawn)).
- From in the water, land is seen through the water as the seabed is.
- `visible={false}` hides it, its tiles kept in; `debug` shows its tiles by depth
  (`'tiles'`) or which layer gave each node (`'layers'`).
- Its tiles loading reports through its own `onProgress` (`ProgressStore.source`), not the
  `Scenery`'s; under a `Scenery`, so does its overview's compile past the tiles' reach,
  started as soon as the background is drawn, so the far ground is ready when first in view.

## Without a Scenery

The relief is Earth data, and a host may show it with the scenery off: bathymetry and
topography under its data, nothing of the sky in the way (world.md, step 7d-2).

```tsx
<World frame={frame} boundary={boundary}>
  <ambientLight intensity={0.5} />
  <directionalLight position={[-1, 2, -3]} />
  <GeoRelief layers={layers} color="ramp" fieldOpacity={0.3} />
  {data}
</World>
```

- **Drawn plainly** (`relief-plain-fragment.glsl`): its looks as with a sky (the same table,
  `relief-look.glsl`), lit by the scene's lights — the host's: without any it is black. Where
  the look gives the seabed no ramp it is the relief's `seabed` (`ReliefSeabed`; defaults
  `sceneryDefaults.relief.seabed`: its colour, shine and ambient), darkening from the
  relief's `depth` down. No water over the seabed, no air, no night side: nothing of the sky.
  Lines on it are a layer's (`GeoGraticule`, draped), with a sky or without. With no layers
  it is a flat seabed at its `depth`, out to the far plane (its tiles flat, nothing read from
  the store, never split).
- **To the far plane only:** no overview past it (that is the sky's; see
  [The far plane](#the-far-plane)).
- **Nothing from under the ground:** with the camera below the relief nothing of it is
  drawn, so what lies under the seabed is seen unhindered. With a `Scenery` it is the void's
  lid there, as before.
- **Its opacity** (default 1 each):
  - `opacity`: everywhere. Below 1 every tile is drawn see-through, in one draw instead of
    the opaque one (`RELIEF_SEE_THROUGH_ALL`).
  - `fieldOpacity`: over the fields — the anchored stage's area (the `World`'s `boundary`) and
    each field loaded in the `World` (a `UtmArea` with a `boundary`), in its own frame — so the
    data under the seabed there shows through it; the lower of the two there. At `opacity` 1
    the tiles around are drawn opaque and those over the fields again, see-through, as with
    a sky.
  - Without a `boundary` or a field loaded, `fieldOpacity` has nowhere to apply. Its skirts are
    left out of a see-through draw (two over each other would show as a line), so a crack
    between tiles of different detail may show as a hairline.
  - With a `Scenery`, `fieldOpacity` holds over the same fields, and the sky's seabed takes it
    too; `opacity` is the sky's to decide.
- **Hidden** (`visible={false}`; with a `Scenery`, also while the sky is not drawn, its
  `background` off), nothing of it is drawn and it chooses and loads no tiles: it costs next
  to nothing. Its tiles stay in, so it shows again at once, and what lies on it keeps the
  ground it last drew. With a `Scenery` the sea then has no seabed, as without a relief.
- **Its tiles stay in** as a `Scenery` comes and goes, and through a `Suspense` (an HDR
  environment loading, say), which tears down layout effects while what suspended loads —
  the `World`'s knowing it is there among them: it stays mounted whenever it draws tiles in a
  `World`, drawn once the `World` knows. Only its materials are made again (compiled once each
  way), its tiles, its sampler, its ground handed out and what lies on it (`drape`) carry on.
  Its `depth` defaults to the sea's, as a `Scenery` last gave it (`sceneryDefaults.sea.depth`
  until one does): a `Scenery` with another depth coming in loads the tiles again, so give
  `depth` to keep them.
- What a `SceneryStage` takes from it — its occupants' ground, their outlines and cut — needs
  the stage, so a `Scenery`.

## Colour and contours

How the relief looks is data, not shader code: changing any of it uploads a small table
(`SceneryReliefLooks`) and compiles nothing.

- **`color`**, one of:
  - a colour: the land flat, the seabed in its own colour (`seabed.color`). Default `#34433b`.
  - `{ ramp, min?, max?, reverse?, seabed? }`: the ground by height, in metres from the
    sea's level, through a colour ramp from the shared ramps (below), by name, row or a
    `ColorRamp` of your own. `min` and `max` set the heights at its ends: by default a
    terrain ramp's own range, else 0 to 2000 m (−3000 to 2000 m with the seabed on it). A
    value ramp with no range of its own (`rainbow`, `jet`, …) runs as it does on a
    `Surface`, which takes depths: from its start at the top, so a ground looks the same
    either way. `seabed` is `'plain'` (default: the seabed's own colour, `seabed.color`,
    darker with depth, to half 600 m below the stage's seabed), `'ramp'` (the same ramp
    across land and seabed alike) or a ramp of its own (`{ ramp: 'bathymetry' }`).
  - `'ramp'`: short for `{ ramp: 'terrain' }`.
- **`seabed`**: the seabed's look (`ReliefSeabed`), as a `ZoneMaterial` lights it, so a zone
  layer given the same values continues it without a seam: `color` (default `#8c8573`),
  `specular`, `shininess`, `ambient`, and `detail`, a procedural relief over the flat seabed
  where no layer has data, as a `Scenery` draws it (default `'seabed'`; `false` for none).
- **`contours`**: `true`, or `{ interval?, major?, thickness?, colorMode?, factor?, color?, seabed?, labels? }`.
  Lines every `interval` metres from the sea's level (default 100), a major one twice as
  wide every `major`-th (default 5; 0 for none), shading the ground as a `Surface`'s do
  (`ContourColorMode`, default darken by 0.5). On the seabed too unless `seabed: false`.
  Each is a solid line `thickness` pixels each side (default 0.8) with a pixel's soft
  edge, as wide on steep ground and at grazing angles as on flat ground: its distance
  from the line is measured in pixels by the height's slope on screen. Lines fade out
  between 8 and 3 pixels apart, minor ones first, so a distant view is no smear or moiré.
  Ground lying exactly at a line's level (gridded data's flats often do: EMODnet east of
  Volve has runs of −100.00 m) counts as on one side of it, as marching squares counts it,
  so such a flat is outlined rather than filled with the line's colour.
  `Surface` contours are drawn the same way (`contours.glsl`), from the same `contours`
  (see [On a `Surface`](#on-a-surface)). The tiles and the overview
  past them draw the same lines, so they run on across where one hands over to the other.
- **`layerLooks`**: a look of its own for a layer, by its id, `{ color?, contours? }`,
  each falling back to the relief's. A local survey can be a rainbow over its depths with
  5 m contours while the regional data stays a terrain ramp. Each tile node keeps the
  layer that gave most of it (as `debug.relief: 'layers'` shows), so the look changes
  where one layer's data takes over from another's, node by node: a hard edge, at the
  tile's resolution. The overview past the tiles takes them the same way, pixel by pixel.
  Up to 31 layers have looks of their own; past that a layer takes the relief's.

### Contour labels

`contours: { labels: true }` (or an options object, `ReliefContourLabels`) writes each line's
height along it on the ground. They are meant to be barely there, part of the lines:

- **Look**: 16 px bold monospace numbers (`size`, `fontFamily`, `fontWeight`) in the lines' own
  colour and strength; bold, as the monospace fonts have no face between regular and bold,
  and regular reads too thin, more so on a high-DPI screen. Darkening lines give black at
  `factor`, mixed ones their `color` at `factor`; both blend over the ground as the lines
  do, so the text is the line's colour on any ground. Lightening lines give white at a
  quarter of `factor`, as close as see-through white gets to a multiply. A hair of a halo,
  0.035 em, light grey at 13 % of the text's opacity under dark text (dark grey at 30 %
  under light), keeps the digits apart from the line they sit on, where a minus sign would
  otherwise merge into it; a halo in the text's own tone merges the digits instead.
  `color`, `opacity`, `haloColor` and `haloWidth` override these.
- **Which way it reads**: turned to read left to right on screen wherever the camera is
  (`flip`, default true), turned in its own place so it keeps its side of the line. A paper
  map writes contour heights with their top uphill instead, so the label shows which way
  the ground rises; in a 3D view the shaded relief shows that already, and the camera
  turning would leave half the labels upside down (an upside-down 600 reads as 009).
  `flip: false` keeps the map's way.
- **Which lines**: the major ones (`lines: 'major'`, default) or `'all'`. None on the
  coastline (0 m). Under the sea's level only with seabed lines (`contours.seabed`), and
  never while a `Scenery`'s sea has water over them. A layer's look (`layerLooks`) labels
  its own lines, node by node as it colours them.
- **Where**: found on each relief tile drawn, from its own heights (`marchingSquares`, then
  `reliefContourLabelPoints`). The relief shades its lines where the height, bilinear
  between each cell's four nodes, crosses their level; inside a cell that is a curve where
  marching squares' chords run straight, a third of a cell off at most, which close in is
  tens of pixels. So each label's point is moved onto that curve (a few Newton steps down
  the bilinear height's gradient), then laid on the triangle it lies on as the tile is
  drawn and lifted toward the camera by 5 m plus 2 % of its distance, so the ground round
  it doesn't cut through it. The text lies across its line (`baseline: 'middle'`, default),
  hangs from it on the downhill side (`'top'`), or stands on it on the uphill side
  (`'bottom'`). A place where the line turns too much to read along, or too near the
  tile's edge, is passed over.
- **How many**: `spacing` (default 320) is the distance between a line's labels along it on
  screen, in CSS pixels; they stay between that and twice it at any distance. A tile's
  rank-0 labels are `2 · spacing / cellPixels` rows apart, `spacing` on screen when its
  cells are half `cellPixels` across. Nearer, where cells grow without the tile splitting
  (the finest data, or flat ground), finer ranks halve the gaps; the labels already there
  keep their places. Each rank fades in as its spacing on screen grows from 60 % of
  `spacing` to all of it (`RELIEF_CONTOUR_LABEL_FADE`). A line too short for a rank, such
  as a ring round a summit, gets its first label at the first rank it is long enough for.
  Finer ranks look less far along the line for its turns, so short, curvy lines high up
  are labelled once near enough for a label to fit along them. Lengths are measured on the
  ground, where a geographic cell is `cos(latitude)` as wide as it is tall.
- **Where lines crowd, none**: a label is also whole only where the next line labelled is
  at least 48 px off on screen (`RELIEF_CONTOUR_LABEL_LINE_PIXELS`), worked out from the
  ground's slope under it, and fades out below 60 % of that. Steep ground seen from afar,
  where the lines bunch up (and soon fade out themselves), is left unlabelled. Gentle
  ground keeps its labels from high up.
- **No fixed distance**: these two rules are all that limit how far off a label shows, so
  they hold for any data. 300 m Norwegian tiles get labels within a few kilometres;
  Greenland, with only ETOPO's 10′ (about 20 km cells), gets them on the ice sheet from
  hundreds of kilometres. Each label's reach, the nearer of the two, rounded down to a
  power of two (`reliefContourLabelClass`), picks its `LabelLayer`, and that layer's
  `maxDistance` is the reach at the camera's focal length.
- **When**: `maxDistance` (none by default; fading over its last quarter) and `maxHeight`
  cap them if given. Whole only where 6 px or more as seen and facing the camera at least
  0.3 (cosine), so not toward the horizon. Never grown at a slant.
- **Among other labels**: `priority` −0.5 (`RELIEF_CONTOUR_LABEL_PRIORITY`), below data
  labels and above the graticule's names. One `LabelGroup` keeps them all apart.
- **Cost**: a tile's ranks are found once, when the camera first comes near enough for
  them, at most 3 ms a frame. They are let go a rank late as it moves away. What is drawn
  is handed on at most every 0.2 s.

All of this but the tiles, where a label lies on them and which levels are left out is one
component, `ContourLabels` (`src/components/Labels/ContourLabels.tsx`): the relief's
(`GeoReliefContourLabels`) and a `Surface`'s give it their tiles each frame.

#### On a `Surface`

A `Surface` takes the same `contours` (`SurfaceContours`: all of `ReliefContours` but
`seabed`), by depth: lines every `interval` metres of depth from 0, a major one every
`major`-th, and with `labels` each line's depth written along it, looking, spaced and
reaching as a relief's do. Its labels are found on tiles of its grid: 32 cells across,
every `2^level`-th node, from one tile over the whole grid split in four near the camera
until a cell spans no more than 8 pixels — a relief's tile size and `cellPixels`, so they
are as far apart (`surfaceLabelTiles`, `surfaceLabelTileGround`). None lies within a node
of the grid's edge or of a node without data, where the lines run along the drop. They lie
in the surface's own frame, so they follow its position; a label's `maxHeight` is the
camera's height over the surface's shallowest point. The props before `contours`
(`showContours`, `contoursInterval`, `contoursColorMode`, `contoursColorModeFactor`,
`contoursThickness`, `contoursColor`) are deprecated, read only without `contours`, and
draw no major lines, as they did not.

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
its four children are in, so ground is never missing. No tile is drawn more than a level
coarser than one touching it (edges and corners), and toward an edge or corner a coarser
tile touches, a tile's surface eases into its parent's over 4 cells, which meets that tile
exactly: contour lines and shading run on across the seams (see
[tiles.md, Seams between depths](./tiles.md#5-drawing-the-relief)). Skirts close what
cracks are left. Tiles load a few at a time, the most wanted first, and the
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
deepest ground in view (`uReliefLowest`: of the tiles drawn and the overview's own) past the
reach, a little short of where it meets the sea; where the tiles still draw they lie nearer,
and win by depth. Not the deepest ground of every tile in: a coarse one holds an ocean's
deepest, and with the dry floor below the overview started as near as it may wherever the
sea was dry, 135 more tiles held at 2 km over the North Sea for nothing seen (2026-11-19).
Started where the view
met the sea's level, it left the background's own flat seabed showing in a ring between the
two, widest over deep water seen at a slant, with the water off (2026-10-30). It starts no
nearer than a share of the reach along the sea (`OVERVIEW_HANDOVER_MIN`, its shader's
`uReliefHandoverMin`): from low over deep water the deepest ground's point comes near the
camera, and the overview would choose every tile out to it at its own detail. 0.8 under
water, which hides what lies between; over a dry sea 0.25, as views that pass over ground
deeper than the share allows meet it past the tiles' reach, and a gap showed between the
two (0.70 wanted from 13 km over 5.8 km of water, 2026-11-19). Toward their
reach the tiles take the overview's detail (its 2 pixel cells, and every tile split by
them where it is coloured by height), eased in from half the reach, and where a pixel is
finer than a cell the overview takes the tiles' contours and normals, so the two meet
without a step. Left: flat on the sea, the overview's ground stands short of the tiles' by
its depth over the slant (about 1.3 km, 2–3 pixels, from 380 km up over the Norwegian Sea).
The overview is the sky's: without a `Scenery` the relief ends at the far plane.

For mountains on the horizon, set the far plane past it from the highest the camera goes:
about 360 km from 10 km up, 760 km from 45 km and 1130 km from 100 km (the sky stories
use 3000 km, so the overview is drawn only from far out in space; it is compiled all the same,
after the sky's own programs). With a logarithmic depth buffer that costs almost
nothing (about 1 m of depth resolution at 1000 km); with a standard one, a far plane that
far from a near plane of centimetres has no resolution left, so use a logarithmic depth
buffer, or a reversed one drawn into a float depth texture (a reversed fixed-point one, as
the canvas's own, gains nothing: [architecture.md, Depth buffers](./architecture.md#depth-buffers)).
Either way the GPU clips by the ordinary clip depth, which that far
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
- **Ground below sea level is sea.** With a `Scenery`, everything under 0 m is drawn under
  the sea's water, at the sea's level: dry depressions are flooded (the Qattara Depression,
  Death Valley, the Dead Sea's shores, Turpan, Danakil), their rims a coastline that moves with
  the tiles' detail. Planned (2026-11-05): mark the exceptions, the dry depressions, as places
  where ground below 0 m stays land, rather than deciding it from the relief (a flood fill
  from the ocean dried the Caspian and the deep lake beds too).
- **Lakes** are not water: the relief holds their beds (ETOPO), not their surfaces. A lake
  above sea level is a dry basin; the parts of a deep one below 0 m (Superior, Baikal) fill to
  the sea's level, hundreds of metres under its real surface. Real lakes need data with their
  surface heights (lake polygons) and water drawn at their own level: a feature of their own,
  later.