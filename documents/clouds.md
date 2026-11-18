# Clouds and weather

3D clouds over a `Scenery` (`<SceneryClouds>`), and the weather that drives them and the sea's
waves. They work from sea level to space, about one field or over the whole Earth, and are
measured; their look is a first pass.

```tsx
import { Scenery, SceneryClouds, SceneryOcean, Weather, weatherPresetOf } from '@equinor/videx-3d'

<Weather weather={weatherPresetOf('scattered')}>
  <Scenery>
    <SceneryOcean />
    <SceneryClouds />
  </Scenery>
</Weather>
```

The story is `Components/Misc/Clouds` (with an `Earth` variant from 20 000 km, global). Its
panel moves the camera to set altitudes up to 4000 km, to the whole Earth (`earth`: 4000 km up,
looking at its centre, the camera's up along the Earth's axis, so dragging spins the globe about
its poles), runs a timelapse of the sun, and a double-click on the ground or the sea flies
there: 300 m over the highest ground within a kilometre (the `World`'s relief, traced along the
view; the sea where there is none), looking into the middle of the cloud layer some 6 km on, or
level where the ground lifts the camera over it, its horizon level (`SceneryDebugPanel`'s
`fly`). The flight keeps the scene's anchor. Its weather controls:

- **`weatherMode`**: `local` or `global` (see "The weather"); the panel's weather row adds `off`
  (`cloudsEnabled`): the clouds hidden, still compiled (`enabled`), so the frame shows what the
  rest of the scenery costs, and they come back at once.
- **Local:** a `preset` (a sky, `SKY_PRESETS`) fills in each level's cover, type, base and
  thickness and the wind, to change from there (`custom` once one is changed by hand); a level's
  cover or type changed sets its heights to the type's typical ones. The middle (latitude and
  longitude, unset for the anchor) and radius (km).
- **Global:** each level on or off, the weather systems' seed, and how much weather they lay
  (`systemsPreset`, or a cover and decks of their own, `systemsOwn`); the panel's `systems` row
  switches the preset.

`showEnvironment` shows the environment's bake, as in StageDebug.

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
- **Budget:** at most 2 ms of GPU on an Intel Iris Xe laptop at 1 megapixel (2026-11-04).
  Revised 2026-11-16: `medium` is to keep to some 5–6 ms a frame on a laptop's RTX A1000 at
  1920 × 1080 as the camera moves (see "Quality"; met about the clouds, not yet far off); the
  Iris Xe is no longer the reference, its clock too unsteady to tune by.

## The weather

`WeatherState` (`sdk/weather/weather.ts`) is the wind (`speed` in m/s, `from` a compass bearing,
as reports give it), the swell (`swell`, `WeatherSwell`: each its significant `height` in
metres, peak `period` in seconds, the bearing it comes `from`, and its `spread`), the air
(`air`, `WeatherAir`: `visibility` in metres, `haze` 0 to 1 and `hazeHeight` in metres, as a
`Scenery`'s `air` has them) and the cloud, one of two kinds (decided 2026-11-07):

- **Local** (`local: WeatherLocal`): its cloud layers (`clouds`, `CloudLayer`: `type`, `cover`
  0 to 1, `base` and `top` in metres over the sea) about one place, and no cloud beyond. Its
  middle is `latitude` and `longitude` (WGS84 degrees), or where the `World`'s anchor lies as
  it is first drawn — kept there as the anchor moves; its `radius` (metres; default
  `WEATHER_LOCAL_RADIUS`, 100 km), the cover thinning out over its outer fifth. A level with no
  layer has no cloud.
- **Global** (no `local`): the weather systems over the whole Earth, the scene included
  (`systems: WeatherSystems`: its `seed`, and how much weather it lays, `preset`, `cover` and
  `decks`; see "The weather far off", "How much weather"). Its layers are not drawn: a global
  weather is not one grade of cloud. The clouds' `levels` turn each level on or off.

`weatherPreset(cover, type, wind)` makes a local one with one layer from a report's words:
`clear`, `few`, `scattered`, `broken` and `overcast` (METAR's oktas; `CLOUD_COVER_OKTAS`), at the
type's usual heights (`CLOUD_TYPE_HEIGHTS`: cumulus grow taller the more they cover, the decks a
little).

**The types**, by the cloud atlas's genera, each at its level (`CloudLevel`, `cloudLevelOf`,
`CLOUD_TYPE_LEVELS`):

| Level | Type | What it is | Heights (base, tops) |
| --- | --- | --- | --- |
| low | `cumulus` | heaped, separate clouds with flat bases | 1200, 2000–3400 m |
| low | `stratocumulus` | a lumpy deck of cells and rolls, broken by gaps | 1200, 1600–2000 m |
| low | `stratus` | an even sheet, its base undulating | 600, 1100 m |
| low | `nimbostratus` | deep, dark, a ragged base | 600, 2600–3400 m |
| mid | `altocumulus` | small puffs in rows across the wind | 3800, 4200–4600 m |
| mid | `altostratus` | a thin grey sheet | 4000, 4800–5500 m |
| high | `cirrus` | streaks of ice along the wind | 8000, 8800–9500 m |
| high | `cirrostratus` | a milky veil | 8500, 9000–9300 m |

No two levels' heights overlap. The decks' were raised on 2026-11-18 (stratocumulus from 900,
1300–1700 m; stratus from 400, 900 m): a global weather's deep sheets lay their base about 600 m
over the sea, low for the way they looked. The clouds draw one layer at each level (`cloudLayersByLevel`):
of two at a level, the one covering more, with a warning in development.

**Skies by name** (`SkyPreset`, `SKY_PRESETS`): weather as it comes, each its layers at the
heights they lie at in it and its wind; `weatherPresetOf(name, local)` makes the local weather.

| Sky | Layers | Wind |
| --- | --- | --- |
| `clear` | none: a high | 4 m/s |
| `fair` | few cumulus, 1000–1600 m, flat under the high's inversion | 5 m/s |
| `few-high` | altocumulus 0.1 at 3800–4200 m, cirrus 0.2 at 8500–9300 m, nothing low: the clouds' default without a `Weather`, hiding little of the scene | 6 m/s |
| `scattered` | scattered cumulus 1200–2400 m, few cirrus 8500–9300 m | 6 m/s |
| `streets` | scattered cumulus 900–1800 m in a fresh, cold wind (streets) | 13 m/s |
| `marine-sc` | broken stratocumulus 500–900 m, nothing above its inversion | 7 m/s |
| `low-stratus` | overcast stratus 250–600 m: drizzle | 6 m/s |
| `warm-front-approach` | broken altostratus 4200–5400 m under overcast cirrostratus 8200–9000 m | 9 m/s |
| `warm-front-rain` | overcast nimbostratus 600–3400 m | 12 m/s |
| `showers` | broken towering cumulus 800–3400 m, scattered cirrus 8000–8900 m (behind a cold front) | 14 m/s |
| `mackerel` | broken altocumulus 3800–4400 m, few cirrus | 8 m/s |
| `high-overcast` | overcast cirrostratus 8500–9300 m alone | 8 m/s |
| `unsettled` | scattered cumulus, broken altocumulus, scattered cirrus | 9 m/s |

`cloudLayersOf` takes a sky's name or a report's (`'broken'`, cumulus; `'overcast stratus'`):
where they share a name the sky's wins, so `'scattered'` is the afternoon's cumulus and cirrus
and `'scattered cumulus'` the cumulus alone.

`<Weather weather={…}>` hands it down; `useWeather()` reads it (`null` without one).

- **The waves:** `<Ocean>`, `<SceneryOcean>` and a `ChunkStack`'s water take the weather's wind
  and swells for whichever of `windSpeed`, `windDirection`, `gusts` and `swells` they leave out
  (`weatherOceanWind`, `useWeatherOceanWind`; `weatherSeaSwells`). The direction is the way the
  wind blows toward, and a swell runs, in the default compass frame (`windToward`): world X/Z,
  and a `Scenery`'s wave plane, east and south. A value once applied stays on the material
  when the weather goes away, as a removed prop's does. Those that leave their waves to the
  weather altogether draw one sea, the weather's (`WeatherSea`; see
  [ocean.md](./ocean.md)).
- **The air:** a `<Scenery>` takes the weather's `visibility`, `haze` and `hazeHeight` for
  whichever its `air` leaves out (`air={false}` still has none).
- **The wind near the surface:** `WeatherWind.gusts` (`WeatherGusts`) is the weather's gust and
  slick field, one field for whatever reads it: `weatherWindAt` (`sdk/weather/wind-field.ts`)
  on the CPU and its twin `weather-wind.glsl` give the local wind over the mean and where a
  slick lies, at a point of the plane, as the wind has run (`speed × time`). The sea roughens
  with it ([ocean-waves.md](./ocean-waves.md#gusts-and-slicks)). The clouds do not read it
  yet: they drift with the wind aloft.
- **The clouds:** `<SceneryClouds>` draws the weather as it is: a local one's layers (or
  `layers` of its own, by name too, `CloudLayersPreset`: given, the weather is local about the
  weather's `local` or its defaults), a global one's systems (their `seed`, else the clouds'),
  and lines its cumulus up into streets in the weather's wind (`cloudStreetsOf`: from 7 m/s,
  fully by 15). Without a `Weather`, scattered cumulus, local. `levels` leaves a level out
  altogether, a quality control as much as a look: each costs its share of the march.
- **The clock:** `<Weather>` holds a `WeatherClock` (`sdk/weather/weather-clock.ts`;
  `useWeatherClock()`): the weather's time in seconds, running from the wall's at `timeScale`
  (3600: an hour a second), held while `paused`, and set by the host with `time` (a new value
  is a jump to it, the clock running on from there). The clouds read it each frame (without a
  `Weather`, a clock of their own at 1); the waves run at its pace (`useWeatherStep`,
  `WeatherClockSteps`: the seconds it ran since the last frame, not its jumps, so a wave's own
  time stays small for the shaders' single precision). A stall counts as at most 0.1 s of the
  wall's, so a timelapse does not leap hours when a hidden tab comes back. See "Motion".

Later the same state can come from data: a forecast's cloud fractions per height band and its
wind, and a wave forecast's height, period and direction for the spectrum.

## The model

`SceneryClouds` (`scenery-clouds.ts`, `shaders/cloud-*.glsl`) draws up to three levels
(`CLOUDS_LEVELS`: low, middle and high), each between two spheres about the Earth's centre: a
local weather's layers, one a level (of two at a level, the one covering more; `dominance` cuts
the others' cover in proportion), or a global weather's chain of types at each level drawn
(`CLOUDS_CHAINS`; its shell from the chain's lowest base to its highest top, `cloudsChainLayer`),
the weather systems laying its cloud.

**A local weather** (2026-11-07) is drawn about its middle (fixed on the Earth, from its
latitude and longitude on the globe's conformal sphere, `updateFrame`; or the anchor's,
captured as it is first drawn) within its radius: each view's runs through a level are cut to
the cylinder of that radius about the line from the Earth's centre through the middle
(`cloudLocalSpan`), so what lies outside it is not marched at all. Over the outer half of the
radius its clouds give way, fewer and smaller (the cover they need raised; faded instead, they
turned see-through, a haze from far off), and a broad noise pushes that edge in and out by a
fifth of the radius, so from high up it is no disc (`cloudLocalEdge`, `LOCAL_FADE`,
`LOCAL_WOBBLE`). No cloud map is drawn; the scene's light and the sea's reflection take the
layers. **A global weather** reads the cloud map everywhere, the scene included; the scene's
light takes the map's cover over the scene, read back once a drawing (`readSceneCover`: one
texel, without waiting for it).

**The types' looks** are data, one row per type (`CLOUDS_LOOKS`, a `SceneryCloudLook` each;
`looks` overrides them), handed to the march as uniforms, so a type is a row, not code: its
clouds' size (`scale`), how far its pattern is drawn out along the wind (`stretch`: cirrus 6
times), how soft their edges are (`softness`), how far lumps move their surface close up
(`lumps`), how many of its columns tower up the level (`towering`), how much rounded masses
weigh against broad patches in its pattern (`masses`), its `extinction`, and how long its clouds
last and how fast their lumps rise (`lifetime`, `rise`; see "Motion"). Per type
(`uCloudTypeLooks`, `uCloudTypeHeights`, `uCloudTypeMore`, `uCloudCoverTable`) and per level
drawn (`uCloudShells`, `uCloudNeeds`, `uCloudLooks`). A level's `cover` is the share of the
ground under cloud at its base: the cover its columns must pass there is read from the cover's
measured quantiles for its look's weight of masses (`softCoverLevel`, `updateLevels`), so it
holds whatever the noise's distribution; at its top, that of cover × (0.02 + 0.3 × `towering`),
its tallest columns.

**Domed, and the tops give way, they do not thin** (2026-11-07). Up a level the cover a column
must pass rises from its base's to its top's as the square of the way up (`CLOUD_DOME`), so the
clouds are domed over flat bases, which fade in over the bottom 5 % of the level
(`CLOUD_BASE_FADE`). Over its upper half (`CLOUD_ROUNDED`) the need climbs on, by the top past
the most any column reaches by three of the lumps' and the edge's widths (`need.w`,
`CLOUD_ROUND_REACH`): each cloud's top rounds off at a height of its own cover's, and none
reaches the level's top, near or far (`cloudDensity`). The density stays whole up to the top.
Thinned instead (the density fading over the top 10 % of a cumulus layer, 25–35 % of a deck),
every cloud reaching the top was cut flat into a see-through film over the layer: a view along
the tops looked through it to the clouds below, and as the steps through the film moved with
the camera, so did what showed through.

**Thin levels** take fewer steps: a level optically thinner straight through than 8 (`DEEP`)
takes as many fewer of the quality's steps along a run, down to a quarter (`uCloudShells`' w).

**Types along a chain** (a global weather). Each level's types lie on a chain, heaped to sheet
(`CLOUDS_CHAINS`): cumulus, stratocumulus, stratus; altocumulus, altostratus; cirrus,
cirrostratus. Where a level's cloud lies along its chain is the weather systems': a second,
smaller map drawn alongside the cloud map (`CloudMap.types`, 512² a face, the same program with
`CLOUD_MAP_TYPES`, its strips drawn after the cloud map's): each part of the weather at its
type's place, weighed by the cover it lays. Low: the open cells and the trades' cumulus heaped,
the closed cells stratocumulus, the systems' sheets stratocumulus, stratus where they run deep
or the air is polar, heaped again in the convergence zone. Middle: the warm air riding up the
fronts and the deep hearts altostratus, weaker lift altocumulus. High: the shield ahead of the
fronts and the deep tops cirrostratus, the anvils and the jets' streaks cirrus. A place between
two types is drawn as both: their looks, heights, extinction and the cover their columns need
mixed by where it lies between them (`cloudPlace`), so one type's clouds grow into the next's.
With the global weather's `types` off, each level is its chain's first type. A local weather's
layer is its own type all through; nimbostratus lies on no chain.

**The decks' light.** Through a sheet the samples toward the light reach on to its top (up to
six clouds' sizes, `CLOUD_LIGHT_REACH`), so an overcast's base lies in its own shadow, lit by the
light scattered many times over through it and the sky's (see "The light"); the light reaching
it is dimmed by the layers over it.

**Over the ground** the low layer rises with the broad height (`CLOUD_TERRAIN_RISE`), the middle
one half as much, the high one not at all (`cloudRiseOf`: ice near the tropopause).

**Where the clouds are.** A level lies between two spheres about the Earth's centre, `base`
and `top` over the sea's sphere. Its cover is read where each point's column stands on the sea's
sphere (`cloudFootOf`), so it is a pattern on the globe, the same all up the column: the cover
volume (`CloudCoverVolume`, `scenery-cloud-cover.ts`, `cloud-cover-volume.glsl`: 128³ of broad
patches and rounded masses apart, half floats with mipmaps, drawn on the GPU a few slices a frame
for each seed), a tile repeating every way, its lattice turned on the Earth so no place has a
tile's axis for its up. Each level reads it at its own scale (some 34 km a tile at scale 1),
turned to its wind and stretched along it (`uCloudTurns`, `uCloudPlaces`): the masses at its
look's weight and the fine patches, and the patches again six times broader, turned, the broad
read's octaves running on into the fine one's (`cloudCoverAt`, `CLOUD_COVER_PATCHES`).

**The lumps.** A shape volume, drawn on the GPU slice by slice once per renderer
(`scenery-cloud-noise.ts`, `cloud-noise-volume.glsl`, integer hashes so every GPU makes the
same): 128³ of Perlin-Worley noise in one channel (R8: RGBA8 fetched four times what the march
used), read from the nearest of its mipmaps (blending two cost 6 % of the march, and moving about
nothing popped), the cover's tile over some 17 of its tiles (`VOLUME_LUMP_TILES`), read twice
where a point lies at `high` and `ultra` (the second tiling 1.618 times broader, turned:
`CLOUD_LUMP_BROADER`) and once at `low` and `medium` (`CLOUD_SHAPE_READS`: plainer, as stable),
so a cloud's sides and top are lumps rather than the cover's outline extruded. They move the
cover by their own standard deviations (measured: `CLOUD_PERLIN_WORLEY`) times the look's
`lumps`, either way, so the cover stays the weather's.

**The same clouds at every distance** (2026-11-11). What a point holds and how it is lit are
functions of where it lies and of the footprint it is seen over — the pixel's cone where it lies,
its level of detail — and of nothing else of the view (`cloudDensity`, `cloudLight`): not the step
it is read for, its length or its slope, nor where the view's runs begin. The shape volume's lumps
are read where the footprint resolves features a quarter of its tile across (`uCloudDetail.y`),
their spread taken instead where it does not; the cover is read over the footprint, its mean from
the cover volume's (or the cover map's) mipmaps and its spread from a table measured on the volume
(see "Far off"). So the clouds change only as the footprint grows, and the march's steps change
what is drawn only by how finely they resolve it (see "The march").

**Fixed to the Earth.** The noise is read in a frame fixed to the Earth (from the globe's frame
and place), with where the camera lies in each pattern worked out on the CPU in 64-bit floats
(`uCloudPlaces`, `updateCamera`); the shader only adds a point's offset from the camera. So the clouds stay
put, and keep their detail, from sea level to 20 000 km, and through a `World`'s change of
anchor.

**Far off.** A footprint's share in cloud is the share of its columns whose cover passes what they
need: the cover's mean over the footprint against the need, over an edge as wide as the type's
softness and the spread the footprint averages away, through the normal distribution's CDF
(`cloudNormalCdf`: a normal blurred is a wider normal, so a footprint read whole holds what its
parts do on average). The spread comes from a table measured once from the cover volume
(`CloudCoverVolume.spread`, `uCloudCoverSpread`): for each level of its mipmaps, the mean over its
texels of the variance within each, read at the texels' middles (`COVER_SPREAD`), interpolated by
a read's level of detail and weighed as the reads' means are (`cloudSpreadOf`). Cloud the footprint resolves hides as its density; cloud and sky
mixed across it (the spread across the view, against the edge's own width) hide in chunks of a
cloud's size (`look.z`), as rays pass through clouds or between them: a broken field seen from
afar lets through what lies between its clouds, not a haze of their mean. The footprint spans its
width up and down too, up to the level's depth: what the need climbs over that widens the edge,
so a view grazing a level's top far off, or the limb from orbit, takes the share its pixel holds
there rather than all or none.

**The weather far off.** Some hundreds of kilometres from the scene the cover is the weather
systems': a map over the whole Earth (`scenery-cloud-map.ts`), a cube map 1024² a face (some
10 km to a texel; RGBA8, 34 MB with its mips) of the share of the ground under low cloud (R) and
how thick it is (G), and under cloud at the middle level (B) and the high (A), fixed to the
Earth; each level reads its own channel (`cloudPlace`). The middle and high levels are as
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
   Over the ground (see "Over the ground") it is steered: slower over land, and turned along the
   ridges it would blow up.
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
high up, so the range stops at 2^−1.5.

- **Made once per weather** (`WeatherSystems.seed`, else the clouds' `seed`; its cover and
  decks) and terrain on the GPU:
  the wind's six faces whole, then the cloud a strip of 32 rows of a face at a time (some 1–2 ms
  of GPU each): 16 strips a frame for the first map, which the clouds wait for (some half a
  second, after the terrain's Earth when there is a relief), and one a frame for another seed's,
  cover's or decks', or a new drawing of the terrain's, drawn while the clouds still show the old
  (some three seconds); one being drawn of a weather switched away from before it was drawn is
  let go. Each strip is followed by the same rows of the type map (`CloudMap.types`, half as
  many texels a side: some 25 % more GPU time a strip; 8 MB a drawing with its mips).
- **Where it holds:** a global weather's, everywhere, the scene included; a local weather draws
  none.
- **Read at each step** at the level two texels to the footprint take in (a run's cover kept
  along the view would make the cover depend on the view); about the camera from a map baked of
  it (`CloudPlaceMap`, see "The march"). Smooth noise to roughen the
  map's edges below its texels was tried and dropped: its own tile showed as a grid from
  1000 km.
- **Data** would come in through the same map: a forecast's cloud fractions drawn into it
  instead of the generator, or its pressure centres into the wind. It moves with the clock (see
  "Motion").

**How much weather** (`WeatherSystems.preset`, `cover`, `decks`; 2026-11-17): a lighter sky than
all the systems lay, drawn into the same map (`uMapLift`, `uMapDecks`), so the march reads it as
it reads any other and costs nothing more a frame.

- **`cover`** (0 to 1): the share of the full weather's cloud at each level. Each level's lift
  is lowered (its edge further in: the systems smaller, the gaps between them wider) and the
  cells' and the trades' weight cut by as much. How far is a table (`COVER_LIFT`,
  `cloudMapLiftOf`), measured so each level's mean cover over the Earth is that share of the
  full weather's (seed 0: 23 % low, 12 % middle, 13 % high); another seed at another time keeps
  within some 0.03 of it from 0.25 up.
- **`decks`** (0 to 1): how much of the cloud lies in decks and sheets. Each level's place along
  its chain of types is drawn toward its heaped end (stratus toward cumulus, altostratus toward
  altocumulus, a cirrostratus veil toward cirrus), and the low cloud thinned, to 0.4 of its
  thickness at 0.
- **Presets** (`WEATHER_SYSTEMS_PRESETS`): `high` all of it (cover 1, decks 1: the map as it
  was), `medium` cover 0.6, decks 0.35, `low` cover 0.35, decks 0. A cover or decks left out is
  the preset's; a component's own preset before the weather's own cover or decks
  (`weatherSystemsOf`).
- **What it costs** (the march alone at the clouds' `medium`, against `high`, with the first
  presets' values, cover 0.75 and decks 0.5 at `medium`, 0.5 and 0.2 at `low`; RTX A1000): less
  where the view looks down or across over the clouds (`low` 0.2 of it at 1.6 km in the low
  level, 0.7 from 6 and 200 km up), more from under them and level in a layer (1.2–1.4): broken
  cloud lets the view on to more of it. From 12 km looking up 20°, twice as much (10 to 20 ms),
  thin cirrus no longer hiding the levels under it. The dearest of the six views tried came to
  some 53 ms at `low` against 60 at `high`; the lowered presets were not measured again.

**Over the ground** (always, where there is one: no option since 2026-11-17). The ground is the `Scenery`'s
(`SceneryGround`, `scenery-ground.ts`, `shaders/ground-terrain.glsl`), shared with the sea, which
reads how deep it is from it (`GroundMap`, `sceneGroundMap`): the clouds read its maps
(`CloudGround`). With a `GeoRelief` in the `World`, it takes the ground from its tiles (the
relief's loader, `WorldReliefState.loader`, heights only, `buildGeoReliefTile`'s `heightsOnly`),
drawn on the GPU into the frame fixed on the Earth they are read in. That frame's latitudes are the globe's conformal sphere's, some 0.2° off the
ground's at mid-latitudes, so each texel's latitude goes through a table of the sphere's
(`geodeticLatitude`) and its longitude through the sphere's scale (`sphereLongitude`).
What the clouds read is never under the sea's level; the seabed's height, for the sea, has a
channel of its own.

- **Three maps:** over the whole Earth a cube map 512² a face (some 20 km to a texel; RGBA half
  floats, the height and its slope east and north, and the seabed's height in alpha, with mips)
  from the quadtree's 8 tiles of 90°, 512 cells each, loaded once; about the camera a square
  200 km across, 512² (some 400 m to a texel), from tiles of 1.4° with 256 cells each, loaded
  again once the camera's foot is 30 km from its middle, below 300 km up, and drawn into the one
  not in use; and for the sea's shallows, close to the camera, a square 30 km across (some 60 m
  to a texel) from tiles of 0.18°, below 30 km up. The clouds read the first two.
- **The low level rises** with the ground's broad height (0.8 of it, over some 220 km), so a layer
  meant 1000 m up does not lie on a plateau (Greenland's ice); the middle and high levels keep
  their heights, and mountains rise through them. The same rise about the scene and in the far
  weather, so the two agree. A view's runs through the low level are as tall as the rise along
  that view (read at five places along each), not the highest ground's anywhere: stepping through
  the rise over Everest drew the clouds over the sea as a thin veil from space. Along a view the
  rise is read every 20 km, or every tenth of the distance where that is farther, in a straight
  line between (`CLOUD_TERRAIN_REREAD`).
- **A view does not end where it meets the ground** (2026-11-17): mountains rise through the
  clouds, and the scene's own depth hides what lies behind the relief. Until then it did, the
  ground read at every turn below the highest ground, so a thin veil of cloud in front of steep
  ground stayed drawn (marched through, the ice sheet's edge over Greenland had shown as a dark
  line across the cloud from 1.3 km). The shadows still start their rays at the ground.
- **What it costs** (2026-11-17, the march alone at `medium` in a global weather): every level
  rising over the ground read at every turn, the view ending where it met the ground, took 9–23 %
  of the march by the view (taken out entirely). As it is now the march is 10–24 % faster than
  then (−4.6 to −9.5 ms of 50–66 ms, seven poses from 300 m to 200 km up), its look the same but
  where mountains stand in the clouds.
- A local weather's levels no longer gain cover up the slopes its wind blows up (removed
  2026-11-17: a local weather's alone, for a read of the slopes every step).
- **The cloud map waits** for the Earth's map, so it is not drawn twice; a new drawing of it (the
  `World`'s frame changed) draws the cloud map again.

**The march** (`cloudMarchRuns`). In the clouds' own image (its share of the
screen's resolution in CSS pixels, whatever the pixel ratio), along each pixel's ray over each
level's runs between its shells, up to the ground, front to back, in one loop whose turns are
alike (at most `uCloudMarchMost`), so the density's and the light's reads are compiled into it
once. A turn either looks into a stretch ahead or walks a step. A step is as long as resolves what
it reads, and no longer:

- **The pattern:** two of the pixel's footprints (`uCloudDetail.x`), but no shorter than eight
  texels of the shape volume in clear air (`CLOUD_STEP_TEXELS`: the least its lumps change over)
  or two in cloud.
- **The level's depth, as placed at the last step:** `uCloudMarch.y` steps up it (0.4 of the
  quality's steps) along the view's slope through it, so a deck's top and the light falling off
  into it are resolved however grazing the view. Relaxed to the pixel's footprint where that was
  wider, a deck 300 km off had 16 % of its pixels over 0.02 off, cumulus 200 km off 29 %. Sized by
  the deepest the level can be rather than as placed, a global weather's thin decks (as little as
  a third of their type's depth) had their tops found up to a step late, by where the steps fell:
  from 20 km up 36 % of the clouds' pixels were over 0.02 off, and as the camera moved a film
  seemed to slide over the decks (2026-11-11). Away from the deck as placed, in the clear air of
  the level's shell over or under it, the steps are sized by the shell's whole depth; a step that
  crosses the deck as placed at its middle is walked again from where it began, sized by the deck
  (`deckAgain`). Walked in the deck's steps all through the shell, a global weather's march far
  off took a sixth more turns, and from 20 km up the skip left 15 % of the clouds' pixels over
  0.02 off against 4.9 %. A local weather's deck is its shell, so there it changes nothing.
- **What it holds:** the extinction the last steps found, halved each step since, so a step
  through cloud hides about `uCloudMarch.z` (an optical depth of 1 at 32 steps). A step that finds
  cloud and is longer than 1.5 of a step through what it found (`CLOUD_AGAIN`) is walked again
  from where it began, as short as that: where the view enters cloud is found to within a free
  path, and lit there.

Each step reads its level's extinction at its middle over the pixel's footprint (`cloudDensity`),
takes it as even along the step (exactly, `cloudAdd`), and lights it where its light comes from
on average, 1/τ − 1/(e^τ − 1) of the way in for its optical depth τ.

Clear air is passed over. Past a step finding no cloud, clear by four of the edge's deviations
however its lumps fell (`CLOUD_CLEAR`, `gClear`), the march looks into a stretch twice as long
ahead, and on as long as each is clear, up to its run's own layout (the quality's steps over the
run, growing geometrically from its near end); a stretch that may hold cloud is looked into again
at half its length, down to a step's. The look (`cloudMaybe`) bounds what a stretch may hold: the
cover's mean over twice the stretch, past it by four of its deviations, the most the lumps add and
three of the edge's widths, against the least the cover needs in it (at its lowest, let down by
the pixel's footprint, and toward a local weather's edge raised as little as at the stretch's end
or middle furthest inside it). In a local weather it holds whatever the stretch, so how the
stretches fall changes how much is walked, not what is found. In a global weather it does not
quite: the level is placed at the stretch's middle from the weather systems' map, whose mipmaps
hold means, so a cloudier or deeper place within a long stretch can be passed over (known issue
10).

Walking all of a global weather's clear air instead (2026-11-11, `ed412e43`) cost too much for
what it found. Against a march with steps four times finer, from 2,885 km up the march took 89
turns a pixel and 71 ms with every step walked, 35 turns and 49 ms skipping, with 0.47 % and 0.78
% of the clouds' pixels over 0.02 off; from 3.75 km up, 178 turns and 57 ms against 51 and 35 ms,
3.0 % and 3.2 % (850 × 381, the march alone, interleaved). From 20 km up, looking over the
horizon, 15–17 % of the clouds' pixels were over 0.02 off skipping (4.9 % since the steps away
from the deck are the shell's, above), against 0.2–0.7 % walking every step: by 0.02 of opacity on
average, over the far band, and 0.04–0.13 % over 0.3. A bound by the weather map's greatest
values within 8 of its texels (two passes of a max filter over the map about the camera, the
types along each level's chain at their lowest base, highest top and least need) skipped nothing:
84–97 % of the stretches may have held cloud by it, and the turns the looks took on top made the
march 3.3 times slower than walking every step. Each step places its level
where it lies (`cloudSet`: the weather systems' map, the ground's broad rise); placed once a
kilometre and lent on, what was drawn depended on where the steps fell (3 % of the pixels).

**Seen from afar** (tried 2026-11-11). From high up a pixel's footprint is wider than the stretch
of a deck its view crosses (some 9 km from 2,885 km up), so a run could be walked with its level
placed and its cover read once, at its middle: the density, and the light through its own level,
from that one read, and the light across the levels over it read once a run. Tried as a variant
where a run's span, and the light's through its deck, were within half a footprint: from 2,885 km
up the march took 15.5 turns a pixel against 35 and a third less time (56 ms against 85), with
4.2 % of the clouds' pixels over 0.02 off; within a quarter of a footprint, 1.1 % and 8 % less
time; from 400 km down no run qualified (a run spans its level's whole shell, some 3 km up,
several footprints across). The points lit did not drop (7.8 a pixel): the time is the density's
and the light's arithmetic at each lit step through a deck, some 13 to a crossing
(`uCloudMarch.y`), not their reads. Not kept. Far off the light is half the march (unlit, 40 →
20 ms from 2,885 km up, 59 → 29 ms from 400 km), its crossings of the levels over each point a
third of it from 400 km up (59 → 38 ms). While the camera moves, `temporal: 'moving'` (a quarter
of the pixels marched a frame) took the clouds' share of the frame from 2,885 km up from some
44 ms to 16 (frames of 74 and 46 ms, 30 without clouds; 1701 × 763 CSS pixels at a pixel ratio of
1.5).

The light by part (2026-11-11, the march alone, 850 × 381, each part taken out in turn): from
2,885 km, 400 km and 3.75 km up it was 9.7, 25.5 and 4.5 ms of 32, 53 and 12; its crossings of the
levels over each point lit 8.4, 19.5 and none, its own level's samples 4.1, 16.7 and none (each
alone; together more than both, which a copy of the level kept by the light's loop did not explain:
written in place, the same time to 0.1 ms), the lighting itself under 1 ms. A map of the levels'
shadows about the camera, read for those crossings, would not save it for nothing: covering what
the view reaches (as the weather systems' map about the camera does), its texels were 1.5, 2.9 and
5.4 times as wide as the footprint the crossings are read over, and no more than 0.2 % of the
crossings as wide as a texel. It would blur the high clouds' shadows on the low ones as much, or
take finer maps in cascades about the camera, drawn anew as the clock runs. Not built.

**Lighter far off, the same clouds** (2026-11-16; RTX A1000, 1920 × 1080, a global weather at
`medium` from 200 km up, the march alone, interleaved against it, and against a march with every
step a quarter as long and four times the turns, which today's was within 1.7 % of the clouds'
pixels over 0.02 off). Kept:

- **A crossing read again is taken as read** (`gCrossSecond`, `gCrossThird`): the light's
  crossing of a level over a point lit is read over a quarter of the crossing at least, so the
  points lit close together along a view cross the same cloud; within half that footprint of the
  last crossing read, its optical depth is taken again. A global weather's march 6–15 % less
  (from 200 km up and below the clouds), a local one's the same, the image the same. Kept in arrays
  indexed by level, Direct3D left them in indexable registers and a local weather's march took
  10–25 % longer: a slot each for the second and third levels drawn.

Tried, not kept:

- **One sample toward the light through its own level where the footprint spans its reach:**
  14–24 % slower everywhere (its branch cost more than it saved), and 10 % of the pixels over
  0.02 off from 200 km up.
- **The light of the last point lit taken again within half a footprint:** 18–25 % less far off,
  but the light changes faster up a deck than across it: 36–76 % of the clouds' pixels over 0.02
  off.
- **A deck's steps no shorter than a share of the pixel's footprint** (a quarter, a half): 4–5
  times faster from 200 km up and 8–10 times for the whole Earth, but 70–85 % of the clouds'
  pixels over 0.02 off (by 0.03–0.09 on average from 200 km up): the decks' tops and their light
  falling off into them are no longer resolved. Near the clouds it changed nothing, and ran 13–24
  % slower. A choice for a quality, if a coarser look far off is wanted.

Far off the march is left to its quality (see "Quality") and to how it reuses frames: `'still'`
marches a quarter of the pixels a frame once the camera holds still, `'moving'` (`low`'s and
`medium`'s) also as it moves.

**What the march reads baked (2026-11-10).** Reads that change only with the clock are baked:

- **A local weather's cover** (`CloudCoverMap`, `scenery-cloud-cover-map.ts`, `CLOUD_COVER_MAP`):
  each level's mean cover over its disc, as its two reads of the 3D cover volume give it, baked
  into a layer of a 2D map (768², the cover's texel; half floats, with mipmaps), drawn anew by the
  march's own code whenever the clock moves (0.7 ms) and never for the camera. The march, its
  light and the shadows read it (`cloudCoverOf`) instead of the volume: 1.13–1.42 times as long
  without it, the image the same to 0.003 a channel. Its spread about the
  mean is the volume's, by the footprint alone (`cloudSpreadOf`; see "Far off").
- **A global weather's placing** (`CloudPlaceMap`, `scenery-cloud-place-map.ts`,
  `CLOUD_PLACE_MAP`): the cloud map and its types as `cloudPlace` reads them (both drawings,
  drifted, the newer dissolved in), baked on a gnomonic map about the camera's foot, as far as
  clouds 15 km up show over its horizon, at half the cloud map's texel (192²–1024²): drawn anew
  as the clock moves (0.12 ms), the drawings change or the camera's foot moves a tenth of its
  reach. One read of it where the drawings take four cube reads, a value noise and the drift's
  turns.
- **Stopped at 5 %** (`uCloudDetail.z`): a view stops once 5 % of what lies behind it comes
  through, not 1 %, and is drawn as opaque as that from there on, so nothing shows through where
  it stopped. Its deepest cloud's light is left out, unseen: 0.77–0.89 of the time through an
  overcast.

**The image's size** follows the CSS pixels, whatever the screen's pixel ratio
(`CloudsRenderer.render`): at a pixel ratio of 2, `medium` marched each CSS pixel, 4 times
the work for little to see (1280 × 720 CSS at 2: 33.8 ms against 11.3).

**Reusing frames** (`temporal`: the quality's by default, `'off'`, `'still'` or `'moving'`;
`renderParts`, `cloud-rebuild.glsl`). With `temporal` on, the march draws one pixel of each 2 × 2 block a
frame (a part, each in turn, the diagonals first), each part into an image of its own, its rays
through exactly the full image's pixels it stands for, with their footprint, so a part holds what
the full march would there; the full image is rebuilt from the four. `'still'` does so while the
camera holds still (the clock running), and marches nothing once all four are drawn from what the
march is drawn from now; as the camera moves it marches every pixel, and splits that image into
the parts as it stops. `'moving'` does so however the camera moves. A pixel is taken from its own
part: this frame's as it is; an older one's (at most three frames old) as it was where that part's
camera is this frame's, else from where its cloud lies in this view (moved by the distance to the
clouds' front about it in this frame's part), and where that falls outside the part's view, from
this frame's part between its nearest texels. Each pixel is read once from a march, never from an
image built before: a history blended from jittered frames carries its errors on frame after
frame, and the clouds morph as the camera moves.

An older part's pixel is held within this frame's part about it (between their least and most)
as far as the view has moved it since it was marched: not under a quarter of a pixel of the full
image, fully from one (`CLOUD_PART_HELD`). Held however little it moved, a camera easing to a stop
(its controls' damping) flickered for seconds: this frame's part, two pixels apart, does not bound
the clouds' detail between its pixels, and every older pixel changed each frame as the part
marched last went round. From 1,856 km up, turning 0.01° a frame, 3 % of the clouds' pixels were
over 0.05 off the full march and 5 % changed from frame to frame (the full march: 0.02 %); held as
far as moved, 0.4 % and 0.5 %, and none once it slowed. Turning faster it cannot be both sharp and
steady: a pixel is marched once in four frames and rebuilt from the others in between, and the
clouds hold detail a pixel across. At 0.04° a frame 5.5 % of the clouds' pixels changed from frame
to frame against the full march's 1.9 % (9 % held however little they moved). Rebuilt alike while
the camera moved, this frame's pixels too, from all four parts' nearest samples by a Gaussian of
0.6 of a pixel, 3.8 %, but the clouds were softer while it moved, and trailed; picking each pixel's
nearest sample of any part instead, 8.8 %. Neither kept (2026-11-11).

**Where each pixel came from** (`debug.view` `'temporal'`, the Clouds story's `sources` button by
`temporal`; 2026-11-17): each rebuilt pixel tinted by its source — this frame's part as it is, an
older part's taken where it was green, moved to where its cloud lies now blue, turning red the
more this frame's part held it (a quarter of the colour changed, all red), and this frame's part
between its texels, where the older part's camera did not see, yellow. To find where `'moving'`'s
trails come from (below).

**Quality** (`quality`, `CLOUDS_QUALITY`; default `'medium'`). Each level sets the share of
the screen's resolution in CSS pixels the clouds' image is drawn at, its steps, its samples
toward the light, its reads of the shape volume and how it reuses frames (`resolution` and
`temporal` given override the quality's). The steps lay out a run of a dense level (a thin one
takes fewer, down to a quarter): the longest stretch the march looks ahead over; 0.4 of them go
up a level's depth (`LAYER_STEPS`), and a step through cloud hides an optical depth of 32 over
them (`STEP_DEPTH`; see "The march"). The reads of the shape are a march program each
(`CLOUD_SHAPE_READS`): what a quality leaves out is code taken out, not a uniform's branch past
it, as the code a march holds costs it however rarely it runs (see "Measured"). Counts of loops
stay uniforms (Direct3D unrolls a loop of a constant count).

| | share | steps | light samples | shape reads | `temporal` |
| --- | --- | --- | --- | --- | --- |
| `low` | 0.25 | 16 | 1 | 1 | `'moving'` |
| `medium` | 0.5 | 32 | 2 | 1 | `'moving'` |
| `high` | 0.75 | 48 | 3 | 2 | `'still'` |
| `ultra` | 1 | 64 | 4 | 2 | `'still'` |

`'moving'` for `low` and `medium` (a quarter of the pixels a frame as the camera moves) left
trails behind the clouds as it moved, and was dropped (2026-11-16) — then brought back
(2026-11-17) once the trails were found and stopped: they came as the camera moved along the
view (a zoom), where only the depth moves a pixel. A clear pixel at a cloud's edge was moved by
the depth of the cloud beside it (the nearest of this frame's texels about it) onto where the
cloud lay in the older part's frame, and the clamp to this frame's part let it through, its
texels holding both cloud and sky there. An older part's pixel is now taken only where its own
cloud, carried into this frame's view by its own depth, lands within a pixel of where it is
taken (`CLOUD_PART_LANDS`, 0.75–1.5 pixels of the full image), else this frame's part between
its texels (yellow in `debug.view` `'temporal'`). Orbiting showed little before or since: about a
target well off, the view turns more than it moves, and a turn moves pixels by their direction
alone.

Measured 2026-11-16 on an RTX A1000 (Chrome, ANGLE D3D11) at 1920 × 1080 and a pixel ratio of 1,
the bench's `frames` turning the camera 0.05° a frame, GPU ms a frame: scattered cumulus (local)
and a global weather, over, along and under them; in brackets, a global weather from 200 km up.
`low` 2.7–3.7 (5.1) and `medium` 5.3–6.5 (11.5) with `'moving'`, `high` 19–30 (104), `ultra`
48–55 (271: the full march). Until
then every level marched every pixel every frame (`low` was 0.35/24/2): `medium` took 15.8–17.3
ms a frame about cumulus (A1000, the same frames) and 39 ms from 200 km up; with `'moving'`,
the same look as it holds still, 5.3–6.5 and 11.5. `medium`'s budget there is 5–6 ms as the
camera moves: met with `'moving'` about the clouds, not far off (with `'still'` for every quality
from 2026-11-16 to 11-17, not as the camera moved). Its share of the resolution is what shows most: 0.4 of it
(3.8–5.2 ms, 6.7 from 200 km up) was visibly softer, and not kept.

Since (2026-11-17): the shape read once at `low` and `medium`, the shape volume read from its
nearest mipmap, and the cover volume the march reads two channels (RG16F) rather than four. The
march, timed on its own at `medium` with every pixel marched (1280 × 653): a global weather seen
along its low clouds from 1.7 km up, 56.5 ms against 65.3 (−13.5 %); a local `fair` sky seen from
under it, 16.4 against 19.5 (−16 %).

⚠️ With a quarter of the pixels a frame, the A1000 runs too few at once to be busy: below
`medium`, a frame costs about as long as its slowest rays, not its pixels (`low` at a quarter of
`medium`'s pixels and half its steps took 45–75 % of its time). A smaller GPU, running fewer
pixels at once, gains more from fewer.

- **Unchanged:** nothing is marched while nothing it is marched from has changed since
  (`marchUnchanged`: the camera, its sub-pixel jitter aside, the image's size, the clock, what
  is drawn into its maps and the values of the uniforms its program reads): its image is laid
  over the scene again as it is, and a still view with the clock held costs the composite
  alone. With `temporal` on, a quarter of it a frame (see "Reusing frames").
- **Off** (`enabled` false): nothing is marched, baked or shadowed, nor are its ground and
  its map of the weather drawn; its programs stay compiled. On again, the map is drawn anew
  (a few strips a frame) once the weather has moved on from the one it had. Unmounted, it
  lets go of all of it.
- **Local to global and back** (`programsOf`): each mode has programs of its own for the march,
  its bake and its shadows (`CLOUD_GLOBAL`), made as first needed and kept. A switch waits for
  the other mode's, and for a global weather's map generators, to compile off the main thread
  (`precompile`), the clouds drawn as they were meanwhile; switched once the first time, either
  way is at once. Going local lets go of the weather systems' maps (some 70 MB) but keeps what
  draws them (`CloudWeather.clear`), so they are drawn again without compiling. With the define
  flipped on one set of programs instead, the first frame after the switch compiled the other
  mode's, and three let go of those it left: each switch stood the page for 9–13 s on Iris Xe,
  the longest frame 6–8 s (2026-11-11, every compile uncached). Now the first switch to global
  waits some 19 s uncached (1.8 s with the browser's program cache warm), its frames at most
  0.14 s (0.36 s warm); each switch after it takes 0.15–0.4 s, none of its frames over 0.08 s.
  The march has a program for each count of the shape's reads as well (`CLOUD_SHAPE_READS`; its
  bake and shadows read none, so are the mode's alone): a quality switching between them waits
  for its march the same way (`SceneryClouds`'s drawn mode is the weather's and the reads'),
  22.5 s uncached on the A1000 with the clouds drawn at the quality they had meanwhile, its
  longest frame 0.32 s; back again, 65 ms.
- **Compiled for the scene they are drawn in** (`OWN_SCENE` in `SceneryClouds.tsx`): its own
  passes draw in scenes of their own without lights, and three keys every program on the lights
  of the scene it is compiled for. Compiled for the host's scene (its sun and light probe), each
  of them was compiled twice, the second time on the main thread as it was first drawn: the
  page stood for seconds as the clouds first showed, whatever had been compiled before.

**Motion** (`time`, from the `Weather`'s clock; see "The weather"). Everything moves on the
CPU, by where the march reads its patterns: the march's own work is the same.

- **The wind at each level** (`cloudWindAt`, `CLOUD_WIND_ALOFT`; a layer's own `wind` first):
  the wind over the sea, 1.5, 2.2 and 3 times as strong at the low, middle and high levels and
  turned 15°, 30° and 40° with height, clockwise in the north (anticlockwise in the south),
  the Ekman spiral's turn toward the flow aloft. Each layer is drawn out along its own (cirrus
  along the wind at their height) and drifts with it: where the camera lies among its
  patterns moves back by its wind × time, turned about the Earth's centre so it drifts along the
  surface (`uCloudWinds`, `uCloudTurns`, `updateCamera`); the lumps drift with it. No wind, no
  drift.
- **They form and fade** (`lifetime`: cumulus 20 min, altocumulus 40, stratocumulus and cirrus
  an hour, nimbostratus an hour and a half, the sheets two): the cover is read on through its
  noise along up, a cloud's size (1.5 km, `LIFE_SIZE`) a lifetime, so clouds grow out of clear
  air and thin away where they are rather than sliding past unchanged; a broader one lasts as
  much longer, the broad patches longest. The lumps rise through them (`rise`: cumulus 0.6 m/s).
- **Their shadows** are carried with the lowest level's drift since drawn, and drawn again
  once it has moved a tenth of their reach or the clouds have lived 2 % of their lifetime
  (`SHADOW_LIVED`: some 25 s of weather for cumulus). **The bakes** of the air and the sea's
  reflection are drawn again once the lowest clouds have drifted a quarter of a cloud or lived
  a quarter of their lifetime, no sooner than 3 s after the last (`updateBakes`).
- **The weather systems travel** (`weatherSystemCentresAt`, `weatherSystemDrift`): each with the
  flow that steers it, east at 12 m/s in the storm tracks and west at 5 in the trades, lows
  heading poleward at 2; each deepens and fills over its life (lows 3–6 days, tropical ones
  5–9, highs 5–10) and gives way to a new one elsewhere, so there are always 64. The same for
  the same seed and time, whichever came before. The map is drawn again for times ahead as the
  clock runs (`CloudWeather.update`): at least half an hour apart (the systems travel some 20 km), further
  under a timelapse so each is drawn in the background (1–4 strips a frame) in half the time
  between; on Iris Xe at an hour a second some 13 hours apart. The march reads the older and the
  newer each where its cloud has drifted to since it was drawn (`cloudMapBack`, the same drift
  as the systems'), and the older gives way to the newer place by place, each over 30 % of the
  time between them at a time of its own (`CLOUD_MAP_DISSOLVE`): blended everywhere at once,
  two drawings hours apart halved each other's cloud into a grey veil. A jump of the clock of
  more than 12 h, another seed or other ground draws one anew. Up to three maps at once (some
  100 MB); the blend costs +0.3–0.9 ms of the march (medium).

**As opaque however finely walked** (2026-11-10). A step's optical depth is its extinction (a
point's, `cloudDensity`) times its length, so the clouds are as opaque however the march walks
them, and the same cloud as opaque near and far.

**The light** (`cloudLight`, `cloudLit`; 2026-11-11). Lit where each point lies: the sun's colour
and daylight for its elevation there (so the night side is dark and the terminator warm), the moon
by night (at its phase's light, a Lambert sphere's, and dimmed by the air toward it as the scene's
moonlight is, `skyMoonDimmed`, since 2026-11-18; before, by its share lit and undimmed to the
horizon), and the sky above and the sea below as ambient. The optical depth toward the light is
read through the point's own level in `uCloudLightSamples` stretches (a uniform, so Direct3D keeps
the loop a loop): the first a cloud's skin (200 m, `CLOUD_LIGHT_SKIN`), the rest growing
geometrically up to the level's top or six clouds' sizes (`CLOUD_LIGHT_REACH`), each read at its
middle over a footprint of half its length, or the pixel's where wider; then across each level
over it, where the light crosses its middle, over a quarter of the crossing. Like the view's own
reads they depend on the point alone: read over the view's step, the light changed as the steps
did. The sun's light is shared (`uCloudScatter`, `SCATTER`): 0.4 of it scattered once, by a
two-lobed phase toward the view (`uCloudPhase`: silver linings), falling off as e^(−τ) with the
optical depth toward the light; 0.6 scattered many times over, leaving a cloud much as it came
whichever way it is seen from, falling off 0.3 as fast. That carries the sun deep into a cloud,
so a deck seen far off at a low angle, through its sunlit top, is no brighter than seen from
above. The sky's
light is mostly the zenith's blue, reaches the underside too (off the clouds and the air around),
less at a cloud's base under the cloud over it (`CLOUD_SKY_BASE`), and outweighs the sun's in the
shade (`CLOUD_SKY`): by day a cloud's shadows are blue-grey, as in a photograph. With the sun low
the sky lights them less (`CLOUD_SKY_LOW`), so sunset's colours carry. Calibrated under
`toneMapping: 'none'`. Then the air's haze over the distance their light comes from on average,
as the relief is hazed, and from space the air over them.

**Light maps (an option: `lightMap`, off by default; `scenery-cloud-light.ts`, 2026-11-10).** A
local weather's clouds can be lit from maps instead of marching toward the light from every point
lit. For each level, a layer of a 2D array target covers the weather's disc on the field, as far
again as a ray toward a low light runs out under the deepest level's base (`LIGHT_MARGIN`, at
most 25 km). Each texel is one ray toward the light, from where it leaves the level's base,
taken through the shell in 16 stretches (`CLOUD_LIGHT_STEPS`) by the march's own program
(`CLOUD_LIGHT_MAP`), so it holds the cloud the march draws. Each texel stores the optical depth
from the base, and from a quarter, half and three quarters of the way up, to the top. A point is
lit from the texel its ray leaves the base at, between the heights it lies at and the march's
reach toward the light (`cloudLightFromMap`). The maps are fixed to the Earth, never to the
camera, with mipmaps, so a far point reads them as coarsely as it reads the cover. Texel: the
finest level's cover texel, at most 1024 a side.

A map is drawn anew when the settings, the light's way (to 0.06°) or the ground change, or when
the clock has run on by a twentieth of the shortest lifetime. It is drawn 64k texels a frame
(1.1 ms on an Iris Xe), and its rows drawn over several frames all show the drawing's time: each
is drawn where the wind has carried those clouds since. Done, it fades in over the one before
in half a second, and each map is read where the wind has carried its clouds since its time, so
wind drift never redraws. Measured with scattered cumulus and cirrus (march alone, alternated):
12–15 % less than marched, for some 25 MB (two drawings, two levels). The shading in the clouds
is finer than marched: 16 stretches at the cover's texel against a skin and one long stretch.
Under a fast clock (a timelapse) the maps are drawn on and on and the light lags behind the
clouds, so it stays an option. A global weather is lit as marched. The program is compiled only
once the option is on.

**Drawn over the scene.** The march writes premultiplied colour and, as depth, log2 of the
distance to the clouds' front, where they hide a tenth of what lies behind (`CLOUD_FRONT`; the
mean distance their light comes from where they never do). Not the mean: it lies inside whatever
reaches into the layer, so mountains under cloud flickered through it from space. The composite
draws them nearer by as much as the four texels it reads spread in depth, up to 2 % of the
distance (`DEPTH_MARGIN`): a texel's depth is its middle's, not the pixel's, which over a
slanting layer seen from space is kilometres off. The relief, for its part, wins its tie with
the sea by 1e-5 of the distance (`RELIEF_DEPTH_TIE`): with 1e-4, land was drawn 2 km nearer from
20 000 km and cut through the clouds. One colour attachment, so ANGLE compiles the pixel shader once
(scenery.md, Performance). A fullscreen mesh drawn last (`LAYERS.OVERLAY` in an
`OITRenderPass`, a transparent mesh after the sea's surface in R3F's own render) filters the
image up (four bilinear taps) and writes that depth, so what lies in front of the clouds hides
them at the screen's own resolution. The march runs from that mesh's `onBeforeRender`, with the
camera drawing it. It shows where the `Scenery` would show its own clouds (`SceneryView.clouds`:
the zone, `background`, `debug.hide`).

**The scene's light.** The clouds hand their `Scenery` what it needs to be lit under them
(`ScenerySkyOverlay`, through its registry, from the renderer itself):

- **In the bakes:** before each bake of the air (the environment map and the light probe), the
  clouds are baked as seen from where the air is baked (100 m over the sea at the disc's
  centre): a cube map 128² a face, drawn straight into each face and over the sky in the bake
  (`CloudsRenderer.bake`, `CLOUD_BAKE`, `cloudBakeRuns`). Each run through a level is read once
  over all of it (their own cover's mean and spread along it, no lumps) and lit at its middle
  through a cloud's skin toward the light (`CLOUD_LIGHT_SKIN`) as dense as that read says, not
  marched toward the light nor across the levels over it. Blurred as the bakes and the sea read
  it, it needs no more. Until 2026-11-16 the clouds were filmed: each face marched at half the
  side (64²) by the march's own program with its light (`cloudLight`, one sample toward the
  light), then laid into the face by a composite of its own. The film took 3.4 ms the six faces
  (CPU and GPU, RTX A1000) and its program 2.5–3 s to compile uncached; the bake 1.4 ms and
  2.0 s, and the film's composite is gone. Lit the same way, a scattered sky and its cirrus look
  as they did; an overcast seen from under it is greyer, without the sun's glow through it that
  the film's light gave. The light probe's six faces are read back
  behind one fence (`readFloatTargetAsync`, `cubeFacesToSphericalHarmonics`): three's
  `LightProbeGenerator` asked for each face's readable format first, a synchronous round trip
  that stood the page 59 ms at each bake. Baked again only once their version changes, the
  place moves or the sun has turned half a
  degree (`BAKE_TURN`): the scenery bakes twice, the environment and the probe, and again at
  each step of a sun on the weather's clock. Under
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
  the sea). The bake has its mipmaps, and the sea reads it as blurred as that
  (`skyOceanReflectedClouds`, from `ScenerySkyReflection`): over the field from near the sea,
  as baked. Far from the field (100 to 400 km off), in a global weather, it reflects the cloud
  map's cover at the sea point instead (low, middle and high, as much as 0.9, 0.6 and 0.25 of
  the sky each), coloured as the baked clouds overhead are on average, with none a grey as
  bright as the sky. The bakes still light the sea with the field's light.
- **The sun's light:** the scene's directional light, and the sea's glint with it, are scaled
  by the share of the light the layers let through about the scene (`cloudsLight`):
  e^(−optical depth) along the light's slant through each layer, weighed by its cover squared.
  Not the mean over the ground, which is the cover itself: the one light stands for the sunlit
  ground as much as the shaded wherever the shadows (below) are not drawn, and dimmed by the
  mean a scattered sky read as dull (0.56 of the sun for scattered cumulus at 35°; 0.81
  squared). Overcast takes all of it, and the scene is lit by the grey bakes alone. Eased over
  some 0.4 s; the moon's by night.
- **Shadows** on the sea and the relief: a map of the share of the light that reaches the
  ground (512², 8 bits) over a square about the camera's foot, from 20 km to 200 km from its
  middle to its sides (8 times the camera's height), marched toward the light from the ground
  (the terrain's, under the relief) across each layer in 2 samples (`SHADOW_SAMPLES`; 8 cost
  1.3–3.0 ms a drawing, 2 cost 0.3–1.0, alike enough for shadows), with the march's own
  coverage, weather and terrain (`cloud-march.glsl` under `CLOUD_SHADOW`: one source,
  so the shadows are the clouds'). Drawn again only once the camera's foot is a tenth of the
  reach from its middle, the light has turned 1°, or the clouds, the terrain or the globe
  changed, or the clouds have drifted a tenth of it or lived a fiftieth of their lifetime; none
  at rest. Between, the map is
  carried with the lowest level's wind. The sea
  and the relief scale the dimmed light (`cloud-shadow.glsl`) by the map's share over the share
  it was dimmed to, so a sunlit patch is lit by the whole sun and a shaded one by what gets
  through; toward the square's sides, and past it, the dimmed light stands. In shadow the
  sea's glint goes and its water darkens by half its own colour's share of the sun
  (`SKY_OCEAN_SUN_SHARE`); the relief's direct light (`sceneBlinnPhongShaded`), land only (the
  seabed is lit through the water). None from over 400 km up, nor below the seabed (the
  subsurface's light); not on what the host draws (it takes the dimmed light).

## Measured

**Measuring (the bench, 2026-11-10).** Time the clouds on `debug/Scenery/Cloud Bench`
(`src/components/Scenery/debug/CloudBench.stories.tsx`): the clouds alone (the sky's own layers
hidden; the sea, the stage, the hollow, the bakes and the relief off unless asked for), in a
canvas of a fixed size at a fixed pixel ratio (1280 × 720 at 1 by default), from named poses. Its
panel and `window.videx3d.cloudBench` (`src/storybook/debug/cloud-bench.ts`) time each pass alone
(`pass`), frames as they run with each step of the clouds' frame apart (`frames`), the march's
loop per pixel (`count`), and variants of the march's program or uniforms against it (`ab`).
Every result carries the conditions it was taken under; compare only those that match.

- ⚠️ On the Iris Xe the GPU's clock jumps between plateaus: the same march took 11.3 to 52 ms
  from one round to the next. Medians of runs taken apart said what they liked (a variant read
  2.5 times slower, then 0.8). `ab` times the march and a variant seconds apart, in rounds, and
  takes the median of each round's own ratio; run a control (a define that changes nothing) with
  every set: it reads 1.00 ± 0.1.
- ⚠️ A program just compiled runs about twice as slow for some seconds (the same new variant read
  1.20 timed at once, 0.64 after 3 s drawn untimed). `ab` draws each variant 3 s first
  (`settle`). Earlier findings here that a change "saved nothing" or cost more may have been
  either of these.
- `ab`'s `diff` (the mean difference of a variant's image, per channel) tells a change that only
  moved the time from one that changed what is drawn, whose time then moved with what it drew;
  its `off`, the share of the clouds' pixels over 0.02 off in any channel. Given a `reference`
  (a march edited to be finer, untimed), it says how far the march and each variant are from it
  (`reference`, `vsReference`): a variant as far from it as the march is changed nothing that
  matters.
- A browser hook that wrapped `drawArrays` with a `getError` before and after each draw (from a
  debugging session, not the repository) took 88 % of the page's main thread; the bench warns when
  WebGL's methods are not the browser's own.
- **On the RTX A1000 (2026-11-16).** Measured in a Chrome of its own (`--remote-debugging-port`,
  driven by Playwright over CDP), which draws on the discrete GPU; repeated runs agreed to 1–5 %
  while it was cool. After an hour of runs it dropped to its P5 state (some 1,400 MHz against
  2,100, power and thermal limits set: `nvidia-smi`), and every time read 1.5–2.5 times longer:
  compare only runs taken together, and `ab`'s ratios across them.
- ⚠️ A GPU timer spans the GPU's idle time between draws too: what draws several passes from the
  CPU (the bake's six faces) read 7–11 ms on `pass` and took 1.4 ms, CPU and GPU together, timed
  around it with a `finish`. Time those so.
- `pass` and `ab` give up with an error, rather than wait for ever, on timings that do not come
  back or a page that draws no frames (hidden, or its window covered).
- **Live and labelled (2026-11-17).** A variant judged on the story itself, in its own Chrome on
  the discrete GPU, at a view saved with its args: A and B swapped in the running page in
  interleaved rounds, each labelled in the window as it is drawn, timed only once the clouds are
  drawn and ready (shown, their maps drawn, their program linked) and the GPU's time has held
  steady; the march timed by its own GPU timer inside the frame's, a frame counted only once all
  of its timers are back (they come back frames late: counted as they came, a frame missing some
  read cheaper than it was). Variants that change what is drawn are switched by hand, moving the
  view, before any are kept.
- ⚠️ With vsync off (`--disable-gpu-vsync`, `--disable-frame-rate-limit`), frames queue without
  end and the GPU's timers never come back. With it on, frame intervals round to its steps (17,
  33, 50 ms): compare GPU times, not intervals.
- ⚠️ A program the D3D compiler cannot finish brings Chrome's GPU process down
  (`STATUS_ACCESS_VIOLATION`; three of those and Chrome stops using the GPU until restarted):
  compile a doubtful variant first in a Chrome of its own, over GLSL taken from the page.

**Where the march's time goes** (2026-11-17, `medium`, every pixel marched, 1280 × 653; the
march alone, 61–63 ms, from 1.7 km up along a global weather's low clouds; each part taken out,
which saves that, or done twice, which costs about one more of it):

| part | | the march |
| --- | --- | --- |
| the light (`cloudLight`), all of it | taken out | −22.4 ms |
| its samples through its own level and across the levels over it, together | taken out | −19.7 ms |
| its samples through its own level | taken out | −8.4 ms |
| its crossings of the levels over it | taken out | −6.3 ms |
| `cloudLit` (direct · e^−τ and the sky over it instead) | simplified | −1.0 ms |
| a step's density (`cloudDensity`) | twice | +13.2 ms |
| the cover volume's reads | twice | +12.3 ms |
| the shape volume's reads | twice | +11.7 ms |
| the look ahead through clear air (`cloudSet`, `cloudMaybe`) | twice | +6.9 ms |
| a step's placing by the weather systems' maps (`cloudSet`) | twice | +6.5 ms |
| the maps' two drawings read once (as one blended a frame would) | simplified | −0.5 ms |

A pixel there turns the loop 62 times, takes 28.5 steps and lights 17 points. Under a local
`fair` sky (18.9 ms; 16 turns, 5.4 steps and 0.08 points lit a pixel) the light's samples taken
out still saved 4.7 ms: the code a march holds costs it whether it runs or not (its registers,
how many pixels run at once). So: the light's sample loop is a third of the march, its
reads of the volumes more than its arithmetic, and what a quality does without is to be compiled
out.

Taken again live (2026-11-17), against earlier verdicts:

- The light's crossings of the levels over a point taken as read where the last crossing lies
  close (`CLOUD_CROSS_REUSE`): the frame 3 % shorter at a global view, kept.
- Lighting every other step, the one between from its neighbours: 3 % longer, not kept.
- One light sample where a pixel spans half the light's reach: no change at a global view (it
  is taken there, but little); not kept.
- A prepass at a quarter of the size, the march starting where it found the first step: its
  program never finished compiling (over 180 s, where the march's takes 65 s cold); the look
  ahead it would spare is 3 of 19 ms under a `fair` sky. Not built.
- Candidates for lower qualities, to be judged moving the view first: the light's crossings
  of the levels over it taken out, a lighter density for the light's samples.

**The march** (2026-11-11), measured on the bench at 1280 × 720, `medium`, against the
same march with every step a tenth as long and no cap on its turns (`uCloudStepScale` 0.1):

- **Low stratus 20–300 km off:** no pixel over 0.02 (of 1) off.
- **Scattered cumulus** (over, level, below, down): 5–8 % of the clouds' pixels over 0.02 off,
  their mean under 2/255, at the crisp edges of tops 5–20 km off. Moved 20–40 m, the march's image
  changed some 10 % more than the finer march's (the rest parallax).
- **Orbiting a stratus deck at 140 km** (12 bearings): its mean brightness 0.63–0.71 (linear), none
  of it clipped.
- **Turns a pixel** (scattered, `count`): mean 38–51, p99 170–335.

Its timings are to be taken again: those of 2026-11-11 were taken with another window drawing on
the GPU.

**Kept from the earlier marches** (their timings went with them):

- The march is limited by its code's size as much as its work: removing any one part outside its
  loop saved more than its share. Give loops Direct3D would unroll a uniform count, and call a
  heavy function from one place in the loop.
- Skipping the samples toward the light where the view was already mostly hidden saved nothing: a
  GPU's neighbouring pixels run in lockstep, so one that still needs them holds up the rest.
- The worst view is along the top of a layer to the horizon, where every step is in or near cloud.
- A map of each column's lowest base and highest top about the camera, emulated as exact and
  free, saved 2–10 %: a real one reads a texture every turn, is drawn again as the clouds drift,
  and, a bound over a texel's area, skips less. Not built.
- A local weather draws no cloud map (some 70 MB and its strips spared), and from far off marches
  only the views that meet its cylinder.

## Known issues and next steps

1. **The look**: some grain left in shaded parts at rest; crater-like rings on the tops seen
   from above, the creases between the billows' Worley cells (a smooth minimum over the cells
   rounds them, but needs the volumes' statistics measured again); a grey fog inside a cloud;
   faint horizontal lines left at the far edge from 200 km, and a crinkled texture there;
   the shading could take more light samples and a
   powder term. The map's cover is about a third of the real Earth's. The open cells from space read as scribbles rather
   than cells; thin streaks' edges still show faint stairs from some 1000 km, and a faint short
   line is left here and there where the flow
   tears the air apart. Whole cloud from above, far off, is flat and pale. An overcast's
   lumps on top (its clouds giving way over the top 35 % of a stratus layer) notch its far
   edge against the sky; a narrower band for the decks would keep their tops flatter.
2. **The levels:** broken cumulus seen from under it reads as a flat grey ceiling, and the decks
   from above are pale; the types' looks, their chains' cover rules and the type map's weights
   are first tunings. Cirrus everywhere is drawn out along the scene's wind (the map's wind is
   not handed to the march). Cumulonimbus would span the levels (a deep layer of its own, where
   the map has deep convection); fog would be a row in the table. A place between two types
   reads both.
3. **Clouds between the camera and the data**: the occlusion modes.
4. **Motion:** far off, the map's own wind does not move the cloud between two drawings: the
   systems' mean drift by latitude does, so a cyclone's spiral does not turn as it travels. The
   map is redrawn only every few hours of weather under a fast timelapse on a laptop. Some
   flicker is left while moving fast.
5. **The noise:** done (2026-11-16, 11-17). The shape volume is one channel (R8), read from its
   nearest mipmap, and once a step at `low` and `medium`; the cover volume the march reads is
   two (RG16F), its squares kept only until the spread is measured.
6. **The light:** the scene's light is dimmed by the cloud over the scene (a local weather's
   layers, a global one's map read back there) even far from it (the shadows there are the
   right ones, so this shows only on
   what the shadows do not reach: the host's own objects, and past the shadows' square). A
   local weather's bake, read by direction, puts its clouds in the sea's reflection even past
   its radius. The
   shadows are not on what the host draws (wellbores, a chunk's columns), nor on the stage's
   own seabed under the water. An object inside a layer that is
   not the relief's ground (a platform in stratus) takes the clouds' front depth, so cloud
   behind it is drawn over it where it stands in cloud.
7. **Streets:** cumulus do not line up in streets along a fresh wind.
8. **The ground:** it does not deflect the map's wind, nor does the low level's base follow it
   finer than some 220 km (a cap cloud on a single peak, a fog filling a valley; the middle and
   high levels do not follow it at all); the terrain is the
   relief's as loaded, the demo's coarse world layer where no finer one lies (some 20 km; the
   map about the camera reads the finest there is).
9. **A global weather's controls** without data: its seed, how much weather (a preset of its
    cover and decks, above "How much weather"), and each level on or off. Proposed: how stormy
    (the lows' depth and number), and named climates as presets.
10. **The march:** near cumulus are crisp (a type's `softness`
    softens them). A global weather's skip of clear air places the level at a stretch's middle,
    which is no bound there: it misses little at 2,885 km and 3.75 km, and from 20 km up leaves the far band a little
    off (above, "The march"). Far off the time is the steps through each deck, some 13 to a
    crossing, each lit, the light running the density through its level and across those over it
    (above, "Seen from afar"): from 200 km up, a global weather's `medium` takes some 33 steps a
    pixel and lights 18 of them, against 2 and none about the clouds. Steps no shorter than the
    footprint would cut it four to ten times far off, at a coarser look (above, "Lighter far
    off"). In a local weather the march is 8–9 % of the clouds' pixels over
    0.02 off one with steps four times finer from 3 and 20 km up, skipping or not: how it
    converges there is to be looked at. From high up the light's crossings of the levels over each
    point lit (each placed by the weather systems' map) are a third of the march (above, "Seen from
    afar"; a crossing read again is now taken as read). Toward the horizon cloud edges step in the Earth story: the clouds change that
    much from one of the image's rows to the next (2 × 2 CSS pixels at `medium`), filtered or not
    (from 1,856 km up, 36 % of the top fifth's neighbouring rows over 0.2 of opacity apart, 34 %
    with four rows marched for each and averaged, the same opacity on average): the image's grid
    scaled up, not the march. The far band, a layer seen grazing far off, flickers and steps as
    the view moves, with `temporal` or without. Tried (2026-11-17, 11-18) and not kept, each judged
    live: the cover read over the pixel's footprint stretched along the view (by 1 / sin of the
    view's slope to the layer: steady far off, but near clouds washed out; for the view's reads
    alone, near ones kept, hardly steadier; over the square root of it, no steadier); the cover
    volume filtered anisotropically along the view (`textureGrad`, 16×: flickered, the shading
    lost); a softer composite over the band (a vertical tent where the depth changes fast between
    rows: no gain); and the band accumulated over frames, its rays shifted within their pixels
    each frame and blended into a history moved to where its cloud lies (no visible gain).
    Not tried: more steps for runs that graze a layer, a full-resolution march of the band.
