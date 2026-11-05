# Clouds and weather

3D clouds over a `Scenery`, and the weather that drives them and the sea's waves. Started
2026-11-04 as a spike: it works from sea level to space at one field, and is measured, but its
look is a first pass. The `<SceneryClouds>` deck is to be replaced by it; the band along the
horizon stays as a cheap option.

```tsx
import { Scenery, SceneryCloudVolume, SceneryOcean, Weather, weatherPreset } from '@equinor/videx-3d'

<Weather weather={weatherPreset('scattered', 'cumulus', { speed: 10, from: 240 })}>
  <Scenery>
    <SceneryOcean />
    <SceneryCloudVolume />
  </Scenery>
</Weather>
```

The story is `Spikes/Scenery/CloudVolume` (with an `Earth` variant from 20 000 km). Its panel
moves the camera to set altitudes up to 4000 km, to the whole Earth (`earth`: 4000 km up,
looking at its centre, the camera's up along the Earth's axis, so dragging spins the globe about
its poles), runs a timelapse of the sun, and a double-click on the ground or the sea flies
there: 300 m over the highest ground within a kilometre (the `World`'s relief, traced along the
view; the sea where there is none), looking into the middle of the cloud layer some 6 km on, or
level where the ground lifts the camera over it, its horizon level (`SceneryDebugPanel`'s
`fly`). The flight keeps the scene's anchor: far from it, what shows is the weather systems'
cloud, not the story's layers, which hold within some 100 km of it. A `layersPreset` control
sets the clouds' own `layers` by name, whatever the weather's; `cloudTerrain` turns the ground's
part off (see "Over the ground"), and `showEnvironment` shows the environment's bake, as in
StageDebug.

## Decided (2026-11-04)

- **One field on the globe, one pass, at every distance.** The draped look from space is the
  far end of the same march, not a second layer crossfaded with it: what the clouds average to
  is what is draped. No charts, no seams.
- **A low-resolution march drawn over the scene with a depth test** (approach A), not meshes of
  puffs, not bounding meshes per cloud.
- **The weather is a provider of its own**, `<Weather>`, with plain data in the SDK
  (`WeatherState`); anything that reads it takes its own props first and the weather only for
  what they leave out.
- **Clouds between the camera and the data** will be an option of several modes (as real
  clouds, cleared toward a focus point, thinned as the camera climbs over them); its default is
  to be picked once they can be seen side by side. Not built yet.
- **Budget:** at most 2 ms of GPU on an Intel Iris Xe laptop at 1 megapixel.

## The weather

`WeatherState` (`sdk/weather/weather.ts`) is the wind (`speed` in m/s, `from` a compass bearing,
as reports give it), the cloud layers (`CloudLayer`: `type`, `cover` 0 to 1, `base` and `top`
in metres over the sea), and the weather systems away from the scene (`WeatherSystems`:
`strength` 0 to 1, default 1, and a `seed`; see "The weather far off").
`weatherPreset(cover, type, wind)` makes one from a report's words: `clear`, `few`,
`scattered`, `broken` and `overcast` (METAR's oktas; `CLOUD_COVER_OKTAS`), at the type's usual
heights (`CLOUD_TYPE_HEIGHTS`: cumulus grow taller the more they cover, the decks a little).

**The types**, by the cloud atlas's genera, each at its level (`CloudLevel`, `cloudLevelOf`,
`CLOUD_TYPE_LEVELS`):

| Level | Type | What it is | Heights (base, tops) |
| --- | --- | --- | --- |
| low | `cumulus` | heaped, separate clouds with flat bases | 1200, 2000–3400 m |
| low | `stratocumulus` | a lumpy deck of cells and rolls, broken by gaps | 900, 1300–1700 m |
| low | `stratus` | an even sheet, its base undulating | 400, 900 m |
| low | `nimbostratus` | deep, dark, a ragged base | 600, 2600–3400 m |
| mid | `altocumulus` | small puffs in rows across the wind | 3800, 4200–4600 m |
| mid | `altostratus` | a thin grey sheet | 4000, 4800–5500 m |
| high | `cirrus` | streaks of ice along the wind | 8000, 8800–9500 m |
| high | `cirrostratus` | a milky veil | 8500, 9000–9300 m |

No two levels' heights overlap. The clouds draw one layer at each level (`cloudLayersByLevel`):
of two at a level, the one covering more, with a warning in development.

**Skies by name** (`SkyPreset`, `SKY_PRESETS`): `clear`; `fair` (few cumulus, few cirrus);
`scattered` (cumulus); `mackerel` (broken altocumulus); `cirrus` (scattered); `stratocumulus`
(broken); `warm-front` (broken altostratus under an overcast cirrostratus veil); `showers`
(broken cumulus under scattered cirrus); `overcast` (a deck of stratocumulus); `overcast-rain`
(nimbostratus). `cloudLayersOf` takes a sky's name or a report's (`'broken'`, cumulus; `'overcast
stratus'`): where they share a name the sky's wins, so `'overcast'` is the stratocumulus deck and
`'overcast cumulus'` the cumulus.

`<Weather weather={…}>` hands it down; `useWeather()` reads it (`null` without one).

- **The waves:** `<Ocean>`, `<SceneryOcean>` and a `ChunkStack`'s water take the weather's wind
  for whichever of `windSpeed` and `windDirection` they leave out (`weatherOceanWind`,
  `useWeatherOceanWind`). The direction is the way the wind blows toward, in the default
  compass frame (`windToward`): world X/Z, and a `Scenery`'s wave plane, east and south. A
  value once applied stays on the material when the weather goes away, as a removed prop's
  does.
- **The clouds:** `<SceneryCloudVolume>` draws the weather's layers unless given `layers` (its
  own, or by name, `CloudLayersPreset`: a sky, or a report's cover and type; `cloudLayersOf`),
  the weather's systems unless given `systems` (their strength; `weatherSystemsOf`), and lines
  its cumulus up into streets in the weather's wind (`cloudStreetsOf`: from 7 m/s, fully by 15).

Later the same state can come from data: a forecast's cloud fractions per height band and its
wind, and a wave forecast's height, period and direction for the spectrum.

## The model

`SceneryCloudVolume` (`scenery-cloud-volume.ts`, `shaders/cloud-volume-*.glsl`) draws three
layers (`CLOUD_VOLUME_LAYERS`), one at each level: the scene's layer there, or where it has none
the level's far type (cumulus, altostratus, cirrus) at no cover of its own, which shows only
far off where the weather systems lay cloud at its level (`cloudVolumeSlots`).

**The types' looks** are data, one row per type (`LOOKS` in `scenery-cloud-volume.ts`), handed
to the march per layer as uniforms (`uCloudLooks`, `uCloudShapes`, `uCloudForms`,
`uCloudStyles`, `uCloudRows`), so a type is a row, not code: the coverage's period (a cloud's
breadth is a quarter of it) and the shape volume's; extinction and the edge's softness; the
billows' and detail's reach and flattening; how far the level rises toward the tops (`heap`: 1
heaped, 0 a sheet); rows, along the wind (cumulus streets, in a fresh wind) or across it
(altocumulus billows), and their spacing; the density's profile up the layer; how far a deck's
base rises and its top falls where its pattern is weak (`undulation`: lighter and darker patches
underneath an overcast, lumps on top); wisps or the billows' undersides at the base; how far the
pattern is drawn out along the wind (cirrus 6 times); and the share of the thickness the light
crosses on its slant (`cloudVolumeLight`). A sheet keeps its cover as its billows and detail
resolve: its level lies as much further from the coverage's mean as their spread with the
coverage's is wider than the coverage's alone (a broken deck's spread pulled it toward half).

**Thin layers** (`CLOUD_THIN`: the whole thickness optically thinner than 3 — altostratus,
cirrus, cirrostratus) take no samples toward the light (lit as if even up to their top) and
three steps a run; a run short against their billows (seen steeply) or whose pattern a footprint
takes as its mean (far off) is one sample at its middle, integrated as a slab at the profile's
mean. From high up the two upper layers would otherwise double the march's iterations.

**The decks' light.** Through a sheet (`heap` under 1) the samples toward the light reach on to
its top, so an overcast's base lies in its own shadow. Under a deck — its own layer up to its top
and the layers over it (the optical depth straight up through them, `uCloudStyles.z`) — the
sky's blue gives way to the grey light the deck lets through, many times scattered, dimmer the
deeper it is (`CLOUD_DECK`), and the light reaching it is dimmed by the layers over it.

**Over the ground** the low layer rises with the broad height (`CLOUD_TERRAIN_RISE`), the middle
one half as much, the high one not at all (`cloudRiseOf`: ice near the tropopause).

**Where the clouds are.** A layer lies between two spheres about the Earth's centre, `base`
and `top` over the sea's sphere. Its coverage is read at the foot of each point's column on its
base, so it is a pattern on the globe: a small tileable noise cube (`createCloudNoise`, 32³,
made once on the CPU, some 50 ms) read twice, the second tap turned and 1.618 times broader at
equal weight (one tap's period showed in rows from high up; at 0.4 the first still did), mixed
with a broader procedural value noise (`cloudValueNoise`, hashed modulo 289, so it repeats only
every 289 cells). A layer's `cover` is
turned into the level the coverage must pass by the coverage's measured distribution
(`CloudNoise.coverage.quantiles`), so `cover` is the share of the ground under cloud. Cumulus
heap up where the pattern is strongest: the level rises with height, so they have flat bases
and rounded tops; stratus are an even slab. Close up, a detail noise moves the edge either way
(the puffs), keeping the cover. In a fresh wind cumulus line up into streets along it: rows
across the wind some 3 km apart, in patches, wandering with the coverage, which breaks them
into clouds (`CLOUD_STREETS`); about the scene only, and only as far as the cumulus themselves
are resolved.

**What they are made of.** Two noise volumes, drawn on the GPU slice by slice once per renderer
(`scenery-cloud-noise.ts`, `cloud-noise-volume.glsl`, integer hashes so every GPU makes the
same): a 128³ shape volume (Perlin-Worley and Worley billows at three scales) read in 3D where a
point lies, so a cloud's sides and top are billows rather than the coverage's outline extruded;
and a 32³ detail volume that roughens their edges close up (wisps toward the base, billows
above). Each moves the coverage by its own standard deviations (measured, `CLOUD_BODY` and the
like in the march), so the cover stays the weather's.

**The same clouds at every distance.** Nothing in a cloud's shape may depend on where the camera
is but the level of detail, or the clouds morph as the view moves, most of all at a low angle
over a layer. Each noise is read at the level two of its texels to a footprint take in: a
footprint of the clouds' own image, so a frame holds only what one frame resolves (finer
creases, resolved only by the frames' accumulation, came and went as the view moved and came to
rest). Their averaging calms them as a footprint grows (`CLOUD_SHAPE_KEPT` and
`CLOUD_DETAIL_KEPT`, measured on their mips), and the edge widens by the spread lost, so a
footprint's share in cloud stays what it was; there is no fade of their own, which turned
billowed clouds into smooth blobs some kilometres off. The coverage, a pattern on the layer,
takes the footprint as stretched over it (by the geometric mean of its sides, at most four
times); the billows and the detail, in 3D, the ray's own. What varies slowly in the coverage
(the warp) is read at each step: kept along the view, it moved with the camera.

**Fixed to the Earth.** The noise is read in a frame fixed to the Earth (from the globe's frame
and place), with where the camera lies in each pattern worked out on the CPU in 64-bit floats
(`uCloudOffsets`); the shader only adds a point's offset from the camera. So the clouds stay
put, and keep their detail, from sea level to 20 000 km, and through a `World`'s change of
anchor.

**Far off.** A pixel's footprint picks the noise's level. Its edge widens by the spread the
coarser levels averaged away (each part's lost variance added, `CLOUD_SPREAD_WIDTH`), and once a
footprint takes in most of a tile the pattern fades into its mean, as the coarser levels would
otherwise repeat the tile in a grid. There the share of a footprint in cloud is the share of the
coverage's distribution over the level (`cloudAbove`, the quantiles read backwards): the cover
itself, at every distance, whatever the edge's width. A widened edge about the mean gave too
little cloud where the cover was high and too much where it was low, a grey veil over clear
sky. What a step hides is worked out per chord of a cloud along the view (`cloudExtinction`):
resolved clouds are their own density, and a mean of cloud and sky hides what the clouds would
side by side, not a haze of their density. From space a layer's run is three steps of that
mean: the clouds draped over the Earth, with no switch on the way down.

**The weather far off.** Some hundreds of kilometres from the scene the cover is the weather
systems': a map over the whole Earth (`scenery-cloud-map.ts`), a cube map 1024² a face (some
10 km to a texel; RGBA8, 34 MB with its mips) of the share of the ground under low cloud (R) and
how thick it is (G), and under cloud at the middle level (B) and the high (A), fixed to the
Earth; each layer reads its level's channel (`cloudMapAt`). The middle and high levels are as
thick as the system under them is deep (G): a thin veil over most of their cover, dense only in
the systems' hearts (`CLOUD_MAP_UPPER`). At one middle thickness everywhere they laid flat white
sheets over the low level's shading, and the Earth from space was evenly white (its mean
brightness at the Earth view 0.458; veiled, 0.403). Nothing in it is drawn as a shape:
an earlier attempt that drew
cyclones, commas, fronts and cells as shapes about the nearest of a set of centres looked made,
with straight seams where the nearest centre changed and no blending between them. It is drawn
in two passes, from the air's motion:

1. **The wind** (`shaders/cloud-map-flow.glsl`, a 128² cube map, half floats): the pressure of
   the weather systems (`createWeatherSystemCentres`, `sdk/weather/weather-systems.ts`: 64 lows
   and highs where the climate has them, lows in the storm tracks some 50° out and a few small
   deep ones in the tropics, highs over the subtropics and the poles; plain data, so an
   analysis's pressure centres could take their place), each a Gaussian summed over all of them,
   so it is smooth everywhere, over the climate's pressure by latitude. The wind blows along the
   isobars, anticlockwise about the lows in the north, fading toward the equator where the trade
   winds blow from the east; about a low's centre it turns no faster than a solid body would
   (`FLOW_TURN`), or the small tropical lows wound their moisture into rings like a target's.
2. **The cloud** (`shaders/cloud-map.glsl`): each texel's air traced back along the wind some
   2000 km (36 midpoint steps), reading where it came from. Its moisture there, drawn out into
   filaments along the way; its warmth, whose level where polar air meets warm is a front, which
   the flow winds into each cyclone's comma and draws out between the systems; the pressure it
   passed through, high pressure having dried it. Most of what the systems look like from space
   is the fronts, the moisture only modulating them. Where cold air flows out toward the equator
   behind the lows, open cells (some 90 km); round the subtropical highs' eastern flanks, decks
   of closed cells (some 55 km); the trades' fair-weather cumulus, the convergence zone's
   thunderstorms and the polar cloud by latitude. Every part is weighed in smoothly; the edges,
   drawn out sharper than a texel by the flow, are widened by how fast they change across one
   (`fwidth`), or the map's bilinear texels showed as stairs. Outward only, and the fronts not
   dimmed as they widen: widened both ways, the edge pulled a full deck just under full cover
   wherever a front's edge crossed it, and the march opened long lines of holes there, stepped
   like tile bounds by `fwidth`'s 2 × 2 texel blocks (seen from 7 km over the Arctic). Over the
   ground (see "Over the ground"), the wind blowing up its slopes (over some 50 km) lifts the
   air and down them lets it sink, the air dries where it crossed ridges higher than here in the
   last some 400 km (the lee's gaps, a föhn), and the cells keep to the sea: they are marine
   weather. Land is ground over 20–250 m, read over some 55 km: a sharp threshold on the
   terrain's 20 km texels drew the coasts' stairs into the cells' edges. Higher up: altostratus
   (B) along the fronts, in a band on their cold side where the warm air rides up over the cold,
   and in the systems' deep hearts; ice (A) in the cirrus shield further ahead of the fronts,
   over the deep systems' tops, the convergence zone's anvils, and faint streaks along the storm
   tracks' jets. The cells and the trades' cumulus are low cloud alone.

Some 22 % of the Earth is under cloud as drawn (measured over the map; the real Earth's two
thirds include thin cloud the map leaves out). The thickness (G) sets how dense the map's cloud
is against the layer's (2^−1.5 to 2^0.5, `CLOUD_MAP_DENSITY`), over a floor of weight so it fades
to thin at the edges rather than jumping between the parts' thicknesses, which stepped the
edges. A see-through veil showed the layer's own coverage tile through it as a crosshatch from
high up, so the range stops at 2^−1.5. Toward the light the samples leave most of that thinning
out (`CLOUD_MAP_LIGHT`): thinned as much, a thin veil was lit through and outshone the deep cloud
about it, bright rims round every system.

- **Made once per seed** (`WeatherSystems.seed`, else the clouds' `seed`) and terrain on the GPU:
  the wind's six faces whole, then the cloud a strip of 32 rows of a face at a time (some 1–2 ms
  of GPU each): 16 strips a frame for the first map, which the clouds wait for (some half a
  second, after the terrain's Earth when there is a relief), and one a frame for another seed's
  or a new drawing of the terrain's, drawn while the clouds still show the old (some three
  seconds).
- **Where it takes over:** the scene's layers rule within 100 km of the middle of the scene (the
  globe's disc), the map from 400 km, the border moved by up to 120 km by a value noise 150 km
  across, so it follows no circle. `strength` mixes the layers' cover back in everywhere (0 for
  the layers' cover everywhere; the `systems` prop overrides the weather's). With no layer at a
  level (a clear sky at the scene), the far weather still lies at that level's far type's
  heights, with no cover of its own about the scene.
- **Read at each step** at the level two texels to the footprint take in (a run's cover kept
  along the view would make the cover depend on the view); a run the map's level spanning it
  holds no cloud over, outside the scene's reach, is skipped whole. Smooth noise to roughen the
  map's edges below its texels was tried and dropped: its own tile showed as a grid from
  1000 km.
- **Static for now:** no motion, no data. Data would come in through the same map: a forecast's
  cloud fractions drawn into it instead of the generator, or its pressure centres into the wind.
- **Whole cover eased in:** where the map's cover is whole (255) and where it is a texel short
  of it (bilinear between 254 and 255), the level the coverage must pass jumped by a whole unit
  (`cloudThreshold`), and what a step hides jumped from what the least gap lets through to
  whole cloud's (`cloudExtinction`). Whole regions drew flat and pale from 1000 km, with the
  map's texels' stairs round them. Both are now eased in over the last 3 % of the cover
  (`CLOUD_WHOLE`), and over the first 3 % for none; a layer's own `cover` of 1 is whole as ever.

**Over the ground** (`terrain`, on by default; `scenery-cloud-terrain.ts`,
`shaders/cloud-terrain.glsl`). With a `GeoRelief` in the `World`, the clouds take its ground from
its tiles (the relief's loader, `WorldReliefState.loader`, heights only,
`buildGeoReliefTile`'s `heightsOnly`), drawn on the GPU into the frame fixed on the Earth they
are read in. That frame's latitudes are the globe's conformal sphere's, some 0.2° off the
ground's at mid-latitudes, so each texel's latitude goes through a table of the sphere's
(`geodeticLatitude`) and its longitude through the sphere's scale (`sphereLongitude`).
Under the sea, the sea's level.

- **Two maps:** over the whole Earth a cube map 512² a face (some 20 km to a texel; RGBA half
  floats, the height and its slope east and north, with mips) from the quadtree's 8 tiles of
  90°, 512 cells each, loaded once; and about the camera a square 200 km across, 512² (some
  400 m to a texel), from tiles of 1.4° with 256 cells each, loaded again once the camera's foot
  is 30 km from its middle, below 300 km up, and drawn into the one not in use.
- **The layers rise** with the ground's broad height (0.8 of it, over some 110 km): the same
  rise about the scene and in the far weather, so the two agree. A view's runs through a layer
  are as tall as the rise along that view (read at five places along each), not the highest
  ground's anywhere: stepping through the rise over Everest drew the clouds over the sea as a
  thin veil from space.
- **About the scene** the layers gain cover up the slopes the weather's wind blows up (0.3 of
  cover at 0.4 m/s of lift and more) and lose it down them; a layer with no cover gains none.
- **The view ends where it meets the ground** (the map about the camera's, eased into the
  Earth's toward its sides; read only below the highest ground), so what stands in a layer is
  veiled by the cloud in front of it and hides the cloud behind. Marched through to the sea, as
  before, the ground drawn in front of the clouds' depth showed through them: over Greenland
  from 1.3 km, the ice sheet's edge as a dark line across the cloud. In a valley narrower than
  the map's 400 m the camera may lie under its smoothed ground: the ground is let down to the
  camera near by, fading by 5 km.
- **What it costs:** a cube map read a step (the rise and slopes), and below the highest ground
  one or two more (the ground); within the noise of the frame's time on the Iris Xe (±0.5 ms).
- **The cloud map waits** for the Earth's map, so it is not drawn twice; a new drawing of it (the
  `World`'s frame changed) draws the cloud map again.

**The march.** In the clouds' own image (its share of the screen's resolution and its steps
from `quality`, below) along each pixel's ray, over each layer's
runs between its shells, up to the Earth. Steps grow with distance, at least fast enough for
the runs to fit the quality's steps but by no more than 6 % of the distance
(`CLOUD_GROWTH_MOST`), and longer through clear air; at least three to a run. Grown to fit a
view along a layer from inside it (30–150 km of it), the steps were a kilometre long a few
kilometres off, a cumulus's breadth: which clouds they landed in changed as the camera moved,
and patches came and went as it tilted. What the steps do not reach the last of them take, one
for each run left (the tail): the rest of the run at once, a slab at the pattern's mean, its
sample toward the light at the mean too, so the far field fades to the layer's look rather
than ending (lit as a thin layer is, as if even up to its top, a cumulus layer's far edge went
dark).
Between two samples the share in cloud is integrated (the edge value linear between them,
`cloudShareAlong`), so the steps do not slice the clouds into shells; only each run's first
step has a length of its own per pixel. In cloud a step spans at most an optical depth of 2,
and a step that lands in cloud from clear air any longer steps back and goes in again with
those: so a cloud's front is not wherever a step happened to land, a per-pixel noise the frames
would have to average away. The samples toward the light take in at least 0.3 of the span each
stands for, so they cross the billows rather than flicker with each one's crevices.

**Temporal accumulation** (`temporal`, on by default; `cloud-volume-resolve.glsl`). Each frame
moves every ray by a sub-pixel jitter (Halton 2, 3, eight places) and each run's first step by
blue noise (`createBlueNoise`, 64², read by pixel, moved on by the golden ratio each frame); a
resolve blends a tenth of the frame into a history per camera, reprojected by the distance to
the clouds' front and clamped to the frame's 3 × 3 neighbours, so a moving view leaves no
trails. The depth is accumulated too, from where the camera is now and within the neighbours'
depths: the sub-pixel jitter moves a whole region's depth at once, which flickered against what
reaches into the clouds. Last frame's depth is interpolated between the four texels about where
the pixel's cloud lay, not taken from the nearest: from space a texel spans kilometres of a
slanting layer, more than lies between the clouds' tops and the land under them, and the
rounding sank stripes of cloud behind the land while the view turned. A pause, a resize or a
jump starts it over. Blue noise matters:
interleaved gradient noise left vertical streaks the accumulation never removed, white noise
blotches; blue noise leaves a fine, even grain that the image's scaling up hides.

**Quality** (`quality`, `CLOUD_VOLUME_QUALITY`; default `'medium'`). Each level sets the share of
the screen's resolution the clouds' image is drawn at, more from high up where a layer is a
few steps, the most rays marched a frame (past it the image is drawn smaller, so a screen with
a pixel ratio of 3 costs no more than one of 1), whether the march is sparse, its steps and its
samples toward the light. `resolution` and `steps` given override the quality's (the budget of
rays then off).

| | share (from 150 km, 500 km) | rays | sparse | steps | light samples |
| --- | --- | --- | --- | --- | --- |
| `low` | 0.35 | 60 000 | yes | 28 | 1 |
| `medium` | 0.5 (0.75) | 150 000 | yes | 40 | 2 |
| `high` | 0.5 (0.75, 1) | 1 000 000 | no | 40 | 2 |
| `ultra` | 0.75 (1) | — | no | 64 | 2 |

- **Sparse:** one pixel of each 2 × 2 of the image is marched a frame, in turn (across the block
  first), into an image half as wide and high, each with the sub-pixel jitter of its own in
  turn; the resolve blends a fifth of it in where it is that pixel's, and keeps what the frames
  before left the other three, clamped to the march's neighbours about them. Where the view
  had not seen a pixel before (the edge of a turning view), the march's own, filtered. A quarter
  of the rays: moving, the clouds are a little softer than marched in full, without blocks.
- **At rest** (`CloudVolumeRenderer.holdAtRest`): once a camera's view and every uniform the
  march reads (the sun, the globe, the clouds' settings, their map and ground) have not changed
  for 48 frames, the march and the resolve stop and the image they settled into is drawn; any
  change marches again. The clouds then cost only their composite.
- **Far off, the clusters:** past the level of the noise where the coverage's tile is its mean,
  half of its broad octave's reach is kept for two levels more (`CLOUD_BROAD_LODS`,
  `CLOUD_BROAD_FAR`): a smaller image reaches those levels nearer, and `'low'` had lost the
  clusters the clouds gather in 200 km off, a flat veil where `'high'` drew them; kept whole,
  they were round blobs from 1000 km up.

**The light.** Lit where each point lies: the sun's colour and daylight for its elevation there
(so the night side is dark and the terminator warm), the moon by night, one or two samples
toward the light (`uCloudLightSamples`, a uniform so Direct3D keeps the loop a loop), a
two-lobed phase (silver linings), and the sky above and the sea below as ambient. The sun's
light straight through falls off as e^(−depth) toward it; what is scattered many times over
inside falls off far slower (`CLOUD_MULTIPLE`, 1 / (1 + 0.3 depth)) and evenly all round, so a
cloud's shaded side is lit through it. The sky's light is mostly the zenith's blue, reaches the
underside too (off the clouds and the air around), and outweighs the sun's in the shade
(`CLOUD_SKY`): by day a cloud's shadows are blue-grey, as in a photograph, not the ash grey a
mean of the sky's colours with the ground's gave. With the sun low the sky lights them less
(`CLOUD_SKY_LOW`), so sunset's colours carry. Then the air's haze over the distance their light
comes from on average, as the relief is hazed, and from space the air over them.

**Drawn over the scene.** The march writes premultiplied colour and, as depth, log2 of the
distance to the clouds' front, where they hide a tenth of what lies behind (`CLOUD_FRONT`; the
mean distance their light comes from where they never do). Not the mean: it lies inside whatever
reaches into the layer, so mountains under cloud flickered through it from space. The composite
draws them nearer by as much as the four texels it reads spread in depth, up to 2 % of the
distance (`DEPTH_MARGIN`): a texel's depth is its middle's, not the pixel's, which over a
slanting layer seen from space is kilometres off. The relief, for its part, wins its tie with
the sea by 1e-5 of the distance (`RELIEF_DEPTH_TIE`): with 1e-4, land was drawn 2 km nearer from
20 000 km and cut through the clouds. Far off, where a pixel spans a quarter of a layer's
thickness and more, the depth is where the view enters the layer from outside it instead
(`CLOUD_ENTRY_DEPTH`): their front moves about with the noise, the jitter and the motion, and
an ice sheet or a mountain range reaching into the layer flickered through it in dark patches
and lines. Measured over Greenland from 1660 km, the largest drop of a still frame's pixel below
its usual went from 51 to 14 (of 255), and while orbiting, pixels dipping darker than the frames
either side by over 20 fell tenfold (3.2 a frame to 0.3). One colour
attachment, so ANGLE compiles the pixel shader once
(scenery.md, Performance). A fullscreen mesh drawn last (`LAYERS.OVERLAY` in an
`OITRenderPass`, a transparent mesh after the sea's surface in R3F's own render) filters the
image up (four bilinear taps) and writes that depth, so what lies in front of the clouds hides
them at the screen's own resolution. The march runs from that mesh's `onBeforeRender`, with the
camera drawing it. It shows where the `Scenery` would show its own clouds (`SceneryView.clouds`:
the zone, `background`, `debug.hide`).

**The scene's light.** The clouds hand their `Scenery` what it needs to be lit under them
(`ScenerySkyOverlay`, through its registry):

- **In the bakes:** before each bake of the air (the environment map and the light probe), the
  clouds are filmed as seen from where the air is filmed (100 m over the sea at the disc's
  centre): a cube map 128² a face, each face marched once at half that, without the frames'
  accumulation (`CloudVolumeRenderer.film`), and drawn over the sky in the bake. Under
  overcast the environment and the probe turn grey, and what reflects them dims. A change to
  the clouds (their settings, the map drawn, their showing at all, the light's share moving)
  makes the bakes due again; a bake still waits `capture.interval`. ⚠️ A CubeCamera draws
  each face with a field of view of −90°: the pixel's angle the march's levels of detail come
  from takes its focal length's magnitude, or each texel was marched as kilometres wide and
  the clouds came out as a faint, even veil.
- **In the sea's reflection:** the same cube map, over the sky the sea reflects
  (`SceneryMaterial.oceanClouds`), read by the reflection's direction alone: it shows the
  clouds as from the scene, so from high over a sea point it blew them up by the camera's
  height over the point against their base (some 200 times from 400 km: one cloud across half
  the sea). The film has its mipmaps, and the sea reads it as blurred as that
  (`skyOceanReflectedClouds`, from `ScenerySkyReflection`): over the field from near the sea,
  as filmed. Far from the field (100 to 400 km off, as the march's weather), where the
  weather is another's, it reflects the cloud map's cover at the sea point instead (low,
  middle and high, as much as 0.9, 0.6 and 0.25 of the sky each), at the weather systems'
  strength, coloured as the film's clouds overhead are on average, with none a grey as bright
  as the sky. The bakes still light the sea with the field's light.
- **The sun's light:** the scene's directional light, and the sea's glint with it, are scaled
  by the share of the light the layers let through about the scene (`cloudVolumeLight`):
  e^(−optical depth) along the light's slant through each layer, weighed by its cover squared.
  Not the mean over the ground, which is the cover itself: the one light stands for the sunlit
  ground as much as the shaded wherever the shadows (below) are not drawn, and dimmed by the
  mean a scattered sky read as dull (0.56 of the sun for scattered cumulus at 35°; 0.81
  squared). Overcast takes all of it, and the scene is lit by the grey bakes alone. Eased over
  some 0.4 s; the moon's by night.
- **Shadows** on the sea and the relief: a map of the share of the light that reaches the
  ground (512², 8 bits) over a square about the camera's foot, from 20 km to 200 km from its
  middle to its sides (8 times the camera's height), marched toward the light from the ground
  (the terrain's, under the relief) across each layer in 8 samples, with the march's own
  coverage, weather and terrain (`cloud-volume-march.glsl` under `CLOUD_SHADOW`: one source,
  so the shadows are the clouds'). Drawn again only once the camera's foot is a tenth of the
  reach from its middle, the light has turned 1°, or the clouds, the terrain or the globe
  changed: some 2 ms of GPU each time (Iris Xe, drawn every frame against at rest), none at
  rest. The sea
  and the relief scale the dimmed light (`cloud-shadow.glsl`) by the map's share over the share
  it was dimmed to, so a sunlit patch is lit by the whole sun and a shaded one by what gets
  through; toward the square's sides, and past it, the dimmed light stands. In shadow the
  sea's glint goes and its water darkens by half its own colour's share of the sun
  (`SKY_OCEAN_SUN_SHARE`); the relief's direct light (`sceneBlinnPhongShaded`), land only (the
  seabed is lit through the water). None from over 400 km up, nor below the seabed (the
  subsurface's light); not on what the host draws (it takes the dimmed light).

## Measured

GPU ms per frame, march + composite, Intel Iris Xe (ANGLE, Direct3D 11) at 1280 × 800,
scattered cumulus, sun 35°, in the story, 2026-11-04. The march's time is taken around the
composite's `onBeforeRender`, the composite's around its own draw.

| Pose | 0.5, 48 steps | 0.35, 40 steps |
| --- | --- | --- |
| 40 m over the sea, looking up | 2.68 | 1.49 |
| 3 km over the field, over the clouds' tops to the horizon | 4.49 | 1.92 |
| 20 km | 2.38 | — |
| 165 km | 2.27 | 1.12 |
| 950 km | 2.45 | — |
| 20 000 km | 1.09 | — |

Overcast stratus at 0.5: 3.15 from sea level, 2.05 from 3 km, 2.63 from 165 km.

With the noise volumes, the step bound and temporal accumulation (march + resolve, 0.5,
40 steps, same machine, 2026-11-04): 5.25 at 40 m over the sea, 7.7 inside a cloud, 6.9 over the
field. Of the field's 6.9, reading the shape volume takes 2.9, the detail volume 1.4, stepping
back into clouds 1.4. Over the 3–4 ms aimed at: the optimization comes once the look is settled.

With the levels of detail settled (the same clouds at every distance) and the warp read at each
step, at 749 × 431 (the story's page then, a quarter more pixels than 640 × 400): 3.6 at 40 m
over the sea, 4.9 inside a cloud, 4.8 over the field, 4.0 at a low angle over the tops (15 km
off), 4.5 from 200 km. Coarser levels read faster than the per-step warp costs.

- The march is limited by its code's size as much as its work: removing any one part outside
  its loop (the haze) saved more than its share. Keep loops whose count Direct3D would unroll
  on a uniform.
- At half resolution the look is better; `quality` (or `resolution` and `steps`) trades it for
  time.
- Worst: looking along the top of a layer to the horizon, where every step is in or near cloud.
- **Three levels** (2026-11-05): the per-layer looks (uniforms, one struct read a step) cost
  nothing measurable against the two type switches they replaced, and draw scattered cumulus
  pixel for pixel as before; the march's translated code grew 6 % (125 KB, some 4 s to link on
  Iris Xe). The far mid and high layers cost +0.4 ms at the Earth view, +6.6 ms from 200 km and
  +0.3 ms from 3 km (march + resolve, back to back): the slabs above took 200 km from +22 ms.
  Their fixed cost per iteration of the march's loop — position, the ground, the map — is what
  counts, not their light: a run kept but found empty cost as much as one in cloud.
- **The steps' growth capped** (6 %, with the tail; 2026-11-05): +4.5 ms looking along a
  cumulus layer from inside it (21.3 → 25.8, march + resolve, back to back), +1.7 inside a
  cloud, nothing measurable at 40 m, 3 km, 200 km or the Earth view. The steps that land in
  cloud close by take their samples toward the light. Where the patches came and went (the
  lower third of the screen, looking down through the layer), a quarter of a degree's tilt
  changed the image by 0.011 (mean per channel), now by 0.007, as much as a 400-step march's
  own (0.0065: parallax and grain); against that march, 0.035 before, 0.010 now. 5 % and 4 %
  came closer still for +0.9 and +1.3 ms more. Holding back only the clear air's longer steps
  did worse: at 40 steps it spends them close by.
- **The qualities** (2026-11-05; march + resolve back to back, 1464 × 909 at a pixel ratio of 2,
  scattered cumulus with the weather systems, the march always drawn; at rest none of it):

  | Pose | `low` | `medium` | `high` | `ultra` |
  | --- | --- | --- | --- | --- |
  | 40 m over the sea | 3.3 | 4.5 | 12.5 | 29.7 |
  | 3 km over the field | 3.4 | 6.1 | 18.6 | 45.0 |
  | 2.2 km, in the layer, along it | 3.9 | 8.1 | 26.6 | 60.1 |
  | 200 km | 3.0 | 6.0 | 23.1 | 40.6 |
  | the Earth view (4000 km) | 2.5 | 4.9 | 17.6 | 23.3 |

  Against `high`, mean difference per channel at rest: `medium` 0.001–0.006, `ultra`
  0.002–0.012, `low` 0.009–0.031 (the most at 40 m, its sky softer, and from 200 km). The
  resolve at the image's full size is a share of the sparse march's time that does not shrink
  with it: `medium` costs a third of `high`, not a quarter.
- ⚠️ Measuring: on this laptop the stats' GPU time drifts by a third over minutes with the
  clock. Compare by timing the march alone, back to back (`render` a dozen times, synced by a
  `readPixels`), the variant and the base alternating, a variant a `ShaderMaterial` on the
  march's own uniforms.

## Known issues and next steps

1. **The look**: some grain left in shaded parts at rest; crater-like rings on the tops seen
   from above, the creases between the billows' Worley cells (a smooth minimum over the cells
   rounds them, but needs the volumes' statistics measured again); a grey fog inside a cloud;
   faint horizontal lines left at the far edge from 200 km, and a crinkled texture there;
   the shading could take more light samples and a
   powder term. The map's cover is about a third of the real Earth's. The open cells from space read as scribbles rather
   than cells; thin streaks' edges still show faint stairs from some 1000 km (whole regions'
   no longer: `CLOUD_WHOLE`), and a faint short line is left here and there where the flow
   tears the air apart. Whole cloud from above, far off, is flat and pale.
2. **The levels:** broken cumulus seen from under it reads as a flat grey ceiling, and the decks
   from above are pale; the types' looks are first tunings. Cirrus everywhere is drawn out along
   the scene's wind (the map's wind is not handed to the march), and far off a level's look is its
   far type's whatever the map's weather (a convergence zone's anvils are cirrus streaks). More
   types (cumulonimbus, fog) would be rows in the table, and the levels could take more than one
   type each by blending two rows by the map.
3. **Clouds between the camera and the data**: the occlusion modes.
4. **Motion:** drift and slow change with the wind at their altitude, on the waves' clock; the
   weather systems moving, which means drawing the map again (or a part of it) as they do. The
   map's wind is there to drive it. Some flicker is left while moving fast.
5. **The band** driven by the weather, meeting the clouds' reach; then the deck removed and the
   volume folded into `<SceneryClouds>`.
6. **The noise:** the shape volume is RGBA, of which the march needs one value per type: one
   channel would read a quarter as much. The coverage's own 32³ cube (CPU) is read twice to
   keep its period from showing; one non-repeating source would read half as much.
7. **The light:** the scene's light is dimmed by the scene's own layers even far from it, where
   the weather systems' cloud lies (the shadows there are the right ones, so this shows only on
   what the shadows do not reach: the host's own objects, and past the shadows' square). The
   shadows are not on what the host draws (wellbores, a chunk's columns), nor on the stage's
   own seabed under the water. An object inside a layer that is
   not the relief's ground (a platform in stratus) takes the clouds' front depth, so cloud
   behind it is drawn over it where it stands in cloud.
8. **Streets far off**: the map's wind could line its cumulus up in streets too; for now only
   about the scene, in the weather's wind.
9. **The ground:** it does not deflect the map's wind, nor do the clouds' bases follow it finer
   than some 110 km (a cap cloud on a single peak, a fog filling a valley); the terrain is the
   relief's as loaded, the demo's coarse world layer where no finer one lies (some 20 km; the
   map about the camera reads the finest there is).
