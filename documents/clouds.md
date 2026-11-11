# Clouds and weather

3D clouds over a `Scenery`, and the weather that drives them and the sea's waves. Started
2026-11-04 as a spike: it works from sea level to space at one field, and is measured, but its
look is a first pass. The `<SceneryClouds>` deck is to be replaced by it; the band along the
horizon stays as a cheap option.

```tsx
import { Scenery, SceneryCloudVolume, SceneryOcean, Weather, weatherPresetOf } from '@equinor/videx-3d'

<Weather weather={weatherPresetOf('scattered')}>
  <Scenery>
    <SceneryOcean />
    <SceneryCloudVolume />
  </Scenery>
</Weather>
```

The story is `Spikes/Scenery/CloudVolume` (with an `Earth` variant from 20 000 km, global). Its
panel moves the camera to set altitudes up to 4000 km, to the whole Earth (`earth`: 4000 km up,
looking at its centre, the camera's up along the Earth's axis, so dragging spins the globe about
its poles), runs a timelapse of the sun, and a double-click on the ground or the sea flies
there: 300 m over the highest ground within a kilometre (the `World`'s relief, traced along the
view; the sea where there is none), looking into the middle of the cloud layer some 6 km on, or
level where the ground lifts the camera over it, its horizon level (`SceneryDebugPanel`'s
`fly`). The flight keeps the scene's anchor. Its weather controls:

- **`weatherMode`**: `local` or `global` (see "The weather").
- **Local:** a `preset` (a sky, `SKY_PRESETS`) fills in each level's cover, type, base and
  thickness and the wind, to change from there (`custom` once one is changed by hand); a level's
  cover or type changed sets its heights to the type's typical ones. The middle (latitude and
  longitude, unset for the anchor) and radius (km).
- **Global:** each level on or off, and the weather systems' seed.

`cloudTerrain` turns the ground's part off (see "Over the ground"), and `showEnvironment` shows
the environment's bake, as in StageDebug.

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
as reports give it) and the cloud, one of two kinds (decided 2026-11-07):

- **Local** (`local: WeatherLocal`): its cloud layers (`clouds`, `CloudLayer`: `type`, `cover`
  0 to 1, `base` and `top` in metres over the sea) about one place, and no cloud beyond. Its
  middle is `latitude` and `longitude` (WGS84 degrees), or where the `World`'s anchor lies as
  it is first drawn — kept there as the anchor moves; its `radius` (metres; default
  `WEATHER_LOCAL_RADIUS`, 100 km), the cover thinning out over its outer fifth. A level with no
  layer has no cloud.
- **Global** (no `local`): the weather systems over the whole Earth, the scene included
  (`systems: WeatherSystems`, its `seed`; see "The weather far off"). Its layers are not drawn:
  a global weather is not one grade of cloud. The clouds' `levels` turn each level on or off.

`weatherPreset(cover, type, wind)` makes a local one with one layer from a report's words:
`clear`, `few`, `scattered`, `broken` and `overcast` (METAR's oktas; `CLOUD_COVER_OKTAS`), at the
type's usual heights (`CLOUD_TYPE_HEIGHTS`: cumulus grow taller the more they cover, the decks a
little).

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
  for whichever of `windSpeed` and `windDirection` they leave out (`weatherOceanWind`,
  `useWeatherOceanWind`). The direction is the way the wind blows toward, in the default
  compass frame (`windToward`): world X/Z, and a `Scenery`'s wave plane, east and south. A
  value once applied stays on the material when the weather goes away, as a removed prop's
  does.
- **The clouds:** `<SceneryCloudVolume>` draws the weather as it is: a local one's layers (or
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

`SceneryCloudVolume` (`scenery-cloud-volume.ts`, `shaders/cloud-volume-*.glsl`) draws up to three
layers (`CLOUD_VOLUME_LAYERS`), one at each level (`cloudVolumeSlots`): a local weather's layers
(a level with none draws nothing); a global weather's far type at each level drawn (cumulus,
altostratus, cirrus) at no cover of its own, the weather systems laying its cloud.

**A local weather** (2026-11-07) is drawn about its middle (`uCloudLocal`: fixed on the Earth,
from its latitude and longitude on the globe's conformal sphere, `updateLocal`; or the anchor's,
captured as it is first drawn) within its radius: each view's runs through a layer are cut to
the cylinder of that radius about the line from the Earth's centre through the middle
(`cloudLocalSpan`), so what lies outside it is not marched at all, and the layers' cover thins
out over its outer fifth (`cloudWeather`, `CLOUD_LOCAL_EDGE`), a soft edge rather than a wall.
No cloud map is drawn (`dropMaps`); the scene's light and the sea's reflection take the layers.
**A global weather** reads the cloud map everywhere, the scene included; the scene's light takes
the map's cover over the scene, read back once a drawing (`readSceneCover`: one texel, without
waiting for it).

**The types' looks** are data, one row per type (`LOOKS` in `scenery-cloud-volume.ts`), handed
to the march per layer as uniforms (`uCloudLooks`, `uCloudShapes`, `uCloudForms`,
`uCloudStyles`, `uCloudRows`), so a type is a row, not code: the coverage's period (a cloud's
breadth is a quarter of it) and the shape volume's; extinction and the edge's softness; the
billows' and detail's reach and flattening; how far the level rises toward the tops (`heap`: 1
heaped, 0 a sheet); rows, along the wind (cumulus streets, in a fresh wind) or across it
(altocumulus billows), and their spacing; the profile up the layer (`profile`: how far up its
base the density grows, and from where its clouds give way to its top); how far a deck's
base rises where its pattern is weak (`undulation`: lighter and darker patches
underneath an overcast); wisps or the billows' undersides at the base; how far the
pattern is drawn out along the wind (cirrus 6 times); and the share of the thickness the light
crosses on its slant (`cloudVolumeLight`). A sheet keeps its cover as its billows and detail
resolve: its level lies as much further from the coverage's mean as their spread with the
coverage's is wider than the coverage's alone (a broken deck's spread pulled it toward half).

**The tops give way, they do not thin** (2026-11-07). Over the top of a layer (from
`profile[1]` up) the level the coverage must pass rises on to past the most it reaches there:
the coverage's highest, the billows', the detail's and the rows' reach, and the edge as wide as
it is at that level of detail. So each cloud's top rounds off at a height of its own, from its
pattern's strength, and nothing reaches the layer's top shell, near or far (`cloudDensity`:
`need.w`, `CLOUD_ROUNDED`). The density stays whole up to the top.
Thinned instead (the density fading over the top 10 % of a cumulus layer, 25–35 % of a deck),
every cloud reaching the top was cut flat into a see-through film over the layer: a view along
the tops looked through it to the clouds below, and as the steps through the film moved with
the camera, so did what showed through. An overcast deck from above was a flat white sheet; it
now has lumps of its own on top. The profile's mean (the slabs, the light under a deck,
`columnDepth`) stays as it was: the clouds give way over the top as much as they thinned.

**Thin layers** (`CLOUD_THIN`: the whole thickness optically thinner than 3 — altostratus,
cirrus, cirrostratus) take no samples toward the light (lit as if even up to their top) and
three steps a run; a run short against their billows (seen steeply) or whose pattern a footprint
takes as its mean (far off) is one sample at its middle, integrated as a slab at the profile's
mean. From high up the two upper layers would otherwise double the march's iterations.

**Types mixed within a level** (`mixTypes`, on by default; 2026-11-07). Each level's types lie
on a chain, heaped to sheet (`CLOUD_TYPE_CHAINS`): cumulus, stratocumulus, stratus;
altocumulus, altostratus; cirrus, cirrostratus. Nimbostratus is a chain of its own. A layer's
type is where it starts on its chain, and a column lies at a place along it:

- **Local**, by the layer's cover (`cloudTypeMix`, `TYPE_DRIFTS`): cumulus closing up
  spread out into stratocumulus (from cover 0.55, at most 0.8 of the patches overcast), a
  stratocumulus deck thinning breaks into heaps, stratus thinning breaks into lumps of
  stratocumulus, altocumulus closes into a sheet and altostratus breaks into puffs, cirrus
  thickens into a veil and cirrostratus frays into streaks. With no cover, its own type.
- **Global**, by the weather systems: a second, smaller map drawn alongside the cloud map
  (`CloudMap.types`, 512² a face, the same program with `CLOUD_MAP_TYPES`, its strips drawn
  after the cloud map's): each part of the weather at its type's place, weighed by the cover it
  lays. Low: the open cells and the trades' cumulus heaped, the closed cells stratocumulus, the
  systems' sheets stratocumulus, stratus where they run deep or the air is polar, heaped again
  in the convergence zone. Middle: the warm air riding up the fronts and the deep hearts
  altostratus, weaker lift altocumulus. High: the shield ahead of the fronts and the deep tops
  cirrostratus, the anvils and the jets' streaks cirrus (`cloudWeather`).

Between two types, a place's share of the second type is the share of the column's **patches**
that are that type (`cloudTypesAt`): a broad pattern (60 km tile, the coverage's noise read as
the coverage is, in two taps, the second finer, so its measured quantiles hold and a patch's rim
is ragged) is one type over the level the share asks, the other under it, mixed only across a
band of 0.8 of its standard deviation (`CLOUD_TYPE_EDGE`; at 0.3 the patches read as plates with
long, smooth rims). In the band both types' clouds are read (`cloudMixedAt`), each at its own
levels of detail, and their edges blended, not their shares, so one type's shapes grow into
the other's rather than two patterns showing through each other. Once the footprint takes the
patches in as their mean, the share itself.

Each type takes a **span of its layer** (`cloudTypeSpan`, `uCloudSpans`): its own type all of
it, a neighbour as thick as its kind lies at the layer's cover (`CLOUD_TYPE_HEIGHTS`), under
the layer's top (cumulus spreading out under their tops) or on its base (stratus), blended
across a patch's edge so a column's cloud deepens or thins. Filling the cumulus layer's whole
1.8 km, stratocumulus patches were a dark, thick overcast. Only in a local weather: in a global
one the weather systems' thickness says how deep their cloud is, and spanned there too, the
fronts' decks thinned to a veil seen from space. The patterns are read at the layer's own base,
so they do not shift with the span, and a slab's one sample is moved into a raised or lowered
span (its run's middle stood outside it, and far off whole regions of decks went missing).

Without `mixTypes` the march is compiled without the loop over two types (`CLOUD_MIX_TYPES`):
the loop costs some 15 % of the march even where it runs once. Changing it compiles the march
again.

**The decks' light.** Through a sheet the samples toward the light reach on to its top (up to
six clouds' sizes, `CLOUD_LIGHT_REACH`), so an overcast's base lies in its own shadow, lit by the
light scattered many times over through it and the sky's (see "The light"); the light reaching
it is dimmed by the layers over it.

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
into clouds (`CLOUD_STREETS`); in a local weather only, and only as far as the cumulus
themselves are resolved.

**What they are made of.** Two noise volumes, drawn on the GPU slice by slice once per renderer
(`scenery-cloud-noise.ts`, `cloud-noise-volume.glsl`, integer hashes so every GPU makes the
same): a 128³ shape volume (Perlin-Worley and Worley billows at three scales) read in 3D where a
point lies, so a cloud's sides and top are billows rather than the coverage's outline extruded;
and a 32³ detail volume that roughens their edges close up (wisps toward the base, billows
above). Each moves the coverage by its own standard deviations (measured, `CLOUD_BODY` and the
like in the march), so the cover stays the weather's.

**The same clouds at every distance** (2026-11-11). What a point holds and how it is lit are
functions of where it lies and of the footprint it is seen over — the pixel's cone where it lies,
its level of detail — and of nothing else of the view (`cloudDensity`, `cloudLight`): not the step
it is read for, its length or its slope, nor where the view's runs begin. The shape volume's lumps
are read where the footprint resolves features a quarter of its tile across (`uCloudDetail.y`),
their spread taken instead where it does not; the cover is read over the footprint, its mean from
the cover volume's (or the cover map's) mipmaps and its spread from a table measured on the volume
(see "Far off"). So the clouds change only as the footprint grows, and the march's steps change
what is drawn only by how finely they resolve it (see "The march"). Until 2026-11-11 each sample
was read over the stretch of the view it stood for and lit once at one point in it: what the
clouds looked like depended on how the steps fell, which moved with the camera.

**Fixed to the Earth.** The noise is read in a frame fixed to the Earth (from the globe's frame
and place), with where the camera lies in each pattern worked out on the CPU in 64-bit floats
(`uCloudOffsets`); the shader only adds a point's offset from the camera. So the clouds stay
put, and keep their detail, from sea level to 20 000 km, and through a `World`'s change of
anchor.

**Far off.** A footprint's share in cloud is the share of its columns whose cover passes what they
need: the cover's mean over the footprint against the need, over an edge as wide as the type's
softness and the spread the footprint averages away, through the normal distribution's CDF
(`cloudNormalCdf`: a normal blurred is a wider normal, so a footprint read whole holds what its
parts do on average). The spread comes from a table measured once from the cover volume
(`CloudCoverVolume.spread`, `uCloudCoverSpread`): for each level of its mipmaps, the mean over its
texels of the variance within each, read at the texels' middles (`COVER_SPREAD`), interpolated by
a read's level of detail and weighed as the reads' means are (`cloudSpreadOf`). Taken per read
instead, as the volume's squares less its means squared, it held the filter's own spread as well
— w(1 − w)(a − b)² between two texels a and b, none at a texel's middle, the most halfway — which
drew the volume's grid into every cloud's edge, and through the cover map baked from it on a grid
of its own (265 m against the volume's 266 m, turned) a moiré of stripes some kilometres apart:
an overcast lit through its rounded top was cross-hatched underneath, its far edges streaked, and
near cumulus came out fuzzier and larger than their cover (an edge of up to 0.09 of cover against
their own 0.009; 2026-11-11). Cloud the footprint resolves hides as its density; cloud and sky
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
  seconds). Each strip is followed by the same rows of the type map (`CloudMap.types`, half as
  many texels a side: some 25 % more GPU time a strip; 8 MB a drawing with its mips).
- **Where it holds:** a global weather's, everywhere, the scene included; a local weather draws
  none (until 2026-11-07 the scene's layers ruled within some 100 km and gave way to the map
  by 400 km, at a `strength`: a mix neither local nor global, which the two kinds replace).
- **Read at each step** at the level two texels to the footprint take in (a run's cover kept
  along the view would make the cover depend on the view); a run the map's level spanning it
  holds no cloud over, outside the scene's reach, is skipped whole. Smooth noise to roughen the
  map's edges below its texels was tried and dropped: its own tile showed as a grid from
  1000 km.
- **Data** would come in through the same map: a forecast's cloud fractions drawn into it
  instead of the generator, or its pressure centres into the wind. It moves with the clock (see
  "Motion").
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
- **In a local weather** the layers gain cover up the slopes the weather's wind blows up (0.3 of
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

**The march** (`cloudMarchRuns`; rebuilt 2026-11-11). In the clouds' own image (its share of the
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
  seemed to slide over the decks (2026-11-11).
- **What it holds:** the extinction the last steps found, halved each step since, so a step
  through cloud hides about `uCloudMarch.z` (an optical depth of 1 at 32 steps). A step that finds
  cloud and is longer than 1.5 of a step through what it found (`CLOUD_AGAIN`) is walked again
  from where it began, as short as that: where the view enters cloud is found to within a free
  path, and lit there.

Each step reads its level's extinction at its middle over the pixel's footprint (`cloudDensity`),
takes it as even along the step (exactly, `cloudAdd`), and lights it where its light comes from
on average, 1/τ − 1/(e^τ − 1) of the way in for its optical depth τ.

In a local weather clear air is passed over. Past a step finding no cloud, clear by four of the edge's deviations
however its lumps fell (`CLOUD_CLEAR`, `gClear`), the march looks into a stretch twice as long
ahead, and on as long as each is clear, up to its run's own layout (the quality's steps over the
run, growing geometrically from its near end); a stretch that may hold cloud is looked into again
at half its length, down to a step's. The look (`cloudMaybe`) is a bound: the cover's mean over
twice the stretch, past it by four of its deviations, the most the lumps add and three of the
edge's widths, against the least the cover needs in it (at its lowest, let down by the pixel's
footprint, and toward a local weather's edge raised as little as at the stretch's end or middle
furthest inside it). So how the stretches fall changes how much is walked, not what is found. A
global weather walks every step: its cover and heights come from the weather systems' map, whose
mipmaps hold means, so a stretch placed over all of it is no bound (a cloudier or deeper place
within it was passed over: 3.5 % of the pixels off from 20 km up, whole clouds missing), and
bounding it by the deepest and cloudiest the level can be skipped nothing. A bound would need the
map's greatest cover and depth over a stretch (a pyramid of maxima). Each step places its level
where it lies (`cloudSet`: the weather systems' map, the ground's broad rise); placed once a
kilometre and lent on, what was drawn depended on where the steps fell (3 % of the pixels).

The march it replaced laid each run out in steps from the camera, looked into each, split those
holding cloud into parts and the parts into short steps, each read over the stretch it stood for
and lit once at one point: the steps' length set how blurred the clouds were read and where they
were lit. As the camera moved the steps moved, and decks' bodies and edges shapeshifted; a step
reaching into a deck from the sunlit air in front of it was lit there, so far decks glared and
grew brighter with distance (see "Measured"). What had been added over it to hide its symptoms
went with it: a first pass finding each view's first cloud, views spread over a limb pixel's
height, runs taken whole far off, the cover read over the footprint on the layer, chunks bounded
by the rise, and three light models to choose from (`debug.light`, `limb`, `whole`, `onLayer`).

**What the march reads baked (2026-11-10).** Reads that change only with the clock are baked:

- **A local weather's cover** (`CloudCoverMap`, `scenery-cloud-cover-map.ts`, `CLOUD_COVER_MAP`):
  each level's mean cover over its disc, as its two reads of the 3D cover volume give it, baked
  into a layer of a 2D map (768², the cover's texel; half floats, with mipmaps), drawn anew by the
  march's own code whenever the clock moves (0.7 ms) and never for the camera. The march, its
  light and the shadows read it (`cloudCoverOf`) instead of the volume: 1.13–1.42 times as long
  without it (the march it replaced), the image the same to 0.003 a channel. Its spread about the
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
(`CloudVolumeRenderer.render`): at a pixel ratio of 2, `medium` marched each CSS pixel, 4 times
the work for little to see (1280 × 720 CSS at 2: 33.8 ms against 11.3).

**Temporal accumulation** (`temporal`, on by default; `cloud-volume-resolve.glsl`). Each frame
moves every ray by a sub-pixel jitter (Halton 2, 3, eight places) and each run's first step by
blue noise (`createBlueNoise`, 64², read by pixel, moved on by the golden ratio each frame); a
resolve blends a tenth of the frame into a history per camera, reprojected by the distance to
the clouds' front and clamped to the frame's 3 × 3 neighbours, so a moving view leaves no
trails. The history is read Catmull-Rom (five filtered taps): bilinear reads blurred it a
little each time the view or the clouds' drift moved it by part of a pixel, the more the longer
it is kept (some 13 % less detail on drifting clouds at rest). The depth is accumulated too, from where the camera is now and within the neighbours'
depths: the sub-pixel jitter moves a whole region's depth at once, which flickered against what
reaches into the clouds. Last frame's depth is interpolated between the four texels about where
the pixel's cloud lay, not taken from the nearest: from space a texel spans kilometres of a
slanting layer, more than lies between the clouds' tops and the land under them, and the
rounding sank stripes of cloud behind the land while the view turned. A pause, a resize or a
jump starts it over. Blue noise matters:
interleaved gradient noise left vertical streaks the accumulation never removed, white noise
blotches; blue noise leaves a fine, even grain that the image's scaling up hides.

- **Calm** (`CALM_SHARE`): once the view has stood still, what the march reads but the clock has
  changed less than 10⁻⁴ of itself (the sun on a real-time clock moves less, a slider more) and
  the clouds have changed less than 0.05 of a pixel where they are and moved less than half a
  pixel since the frame before, for 20 frames, each frame takes a quarter of its share, eased in
  over those: the grain left is a third (at 40 m, `medium`: 8.0 → 2.6 near the horizon, 5.6 →
  1.8 above, as the frames' standard deviation, × 10⁻³) for no detail lost. Any change of the
  view or the light starts it over, so a change settles as fast as before; never under a
  timelapse (the clock more than twice real time). A filter over the frame's own neighbours
  instead (3 × 3, or a plus) lost the detail: on a sparse march it spans 6 × 6 of the screen's
  pixels.
- **Far off, softer** (`BLUR_MOST`, `uCloudBlur`): a frame's ray is blended with its neighbours'
  by a Gaussian of where they crossed from the pixel's middle, of up to a pixel of the image
  (σ), from the nearest the clouds lie along the view (`paceOf`, at least 1 km) to eight times
  as far; nearer, the pixel's own ray alone. Far clouds are as small as the grain: the
  stippled band toward the horizon smooths out (grain 2.6 → 1.85 there, with calm), and the
  clouds above keep their shapes. From space only the limb is far enough to soften.

**Quality** (`quality`, `CLOUD_VOLUME_QUALITY`; default `'medium'`). Each level sets the share of
the screen's resolution in CSS pixels the clouds' image is drawn at, its steps and its samples
toward the light (`resolution` given overrides the quality's). The steps lay out a run of a dense
level (a thin one takes fewer, down to a quarter): the longest stretch the march looks ahead
over; 0.4 of them go up a level's depth (`LAYER_STEPS`), and a step through cloud hides an optical
depth of 32 over them (`STEP_DEPTH`; see "The march").

| | share | steps | light samples |
| --- | --- | --- | --- |
| `low` | 0.35 | 24 | 2 |
| `medium` | 0.5 | 32 | 2 |
| `high` | 0.75 | 48 | 3 |
| `ultra` | 1 | 64 | 4 |

- **Sparse:** one pixel of each 2 × 2 of the image is marched a frame, in turn (across the block
  first), into an image half as wide and high, each with the sub-pixel jitter of its own in
  turn; the resolve blends a fifth of it in where it is that pixel's, and keeps what the frames
  before left the other three, clamped to the march's neighbours about them. Where the view
  had not seen a pixel before (the edge of a turning view), the march's own, filtered, each of
  its texels read where its ray crossed (`uCloudSample`), not at its middle. A quarter
  of the rays: moving, the clouds are a little softer than marched in full, without blocks.
- **At rest** (`CloudVolumeRenderer.holdAtRest`): once a camera's view and every uniform the
  march reads but what the clock moves (the sun, the globe, the clouds' settings, their map and
  ground) have not changed for 48 frames, the march and the resolve stop and the image they
  settled into is drawn; any change marches again. The clouds then cost only their composite.
  With the clock running, they are marched again once any level's clouds may have moved or
  changed 0.3 of a pixel of the image (`paceOf`: its drift, change and rise over the
  nearest it lies along the view's corner rays, 50 m inside a layer), or 2 s on. At real time
  (iris Xe, medium): 0.5 marches a second from 200 km and from space, 8 at 40 m over the sea,
  24 from 3 km over the field, every frame inside a layer. Stopped, it marches on until 96
  frames have settled at that time (calm keeps more of each), then holds.
- **Off** (`enabled` false): nothing is marched, filmed or shadowed, nor are its ground and
  its map of the weather drawn; its programs stay compiled. On again, the map is drawn anew
  (a few strips a frame) once the weather has moved on from the one it had. Unmounted, it
  lets go of all of it.
- **Far off, the clusters:** past the level of the noise where the coverage's tile is its mean,
  half of its broad octave's reach is kept for two levels more (`CLOUD_BROAD_LODS`,
  `CLOUD_BROAD_FAR`): a smaller image reaches those levels nearer, and `'low'` had lost the
  clusters the clouds gather in 200 km off, a flat veil where `'high'` drew them; kept whole,
  they were round blobs from 1000 km up.

**Motion** (`time`, from the `Weather`'s clock; see "The weather"). Everything moves on the
CPU, by where the march reads its patterns: the march's own work is the same.

- **The wind at each level** (`cloudWindAt`, `CLOUD_WIND_ALOFT`; a layer's own `wind` first):
  the wind over the sea, 1.5, 2.2 and 3 times as strong at the low, middle and high levels and
  turned 15°, 30° and 40° with height, clockwise in the north (anticlockwise in the south),
  the Ekman spiral's turn toward the flow aloft. Each layer is drawn out along its own (cirrus
  along the wind at their height) and drifts with it: where the camera lies among its
  patterns moves back by its wind × time (`uCloudWinds`, `updateWinds`). The detail and the
  warp drift with the lowest layer drawn. No wind, no drift.
- **They form and fade** (`CloudLook.lifetime`: cumulus 20 min, altocumulus 40, stratocumulus
  and cirrus an hour, the sheets two): each pattern is read on through its noise along up, a
  quarter of its period (a cloud's breadth) a lifetime, so clouds grow out of clear air and
  thin away where they are rather than sliding past unchanged; the broad clusters four times
  slower, the detail in ten minutes. Heaped clouds' billows rise (`rise`: cumulus 0.6 m/s).
- **The temporal resolve follows them:** the history is read where the cloud lay a frame ago,
  less its level's drift since (`uCloudDrift`, by the height of its front: `uCloudLevels`), so
  drifting clouds leave no trails. A sparse march's unmarched pixels take some of the frame
  as the clouds change fast where they are on the screen (`SPARSE_FAST`); under a timelapse
  their drift counts too, as their cover changes in place as fast (the map's systems and its
  dissolve): held three frames in four, they stood out as dotted streaks. At real time the
  drift counted too took 30 % of the frame each march at rest, read at the half-size texels'
  middles while each ray had crossed elsewhere (the jitter and the pixel of its 2 × 2): the
  whole layer jumped by up to 0.4 of a pixel of the image some 8 times a second, as if the
  camera shook in the wind. Now 0.09 at most (40 m over the sea, `medium`): the held image
  catching up with the drift at each march, and the march's jitter.
- **Their shadows** are carried with the lowest level's drift since drawn, and drawn again
  once it has moved a tenth of their reach or the clouds have lived 2 % of their lifetime
  (`SHADOW_LIVED`: some 25 s of weather for cumulus). **The bakes** of the air and the sea's
  reflection are drawn again once the lowest clouds have drifted a quarter of a cloud or lived
  a quarter of their lifetime, no sooner than 3 s after the last (`updateFilm`).
- **The weather systems travel** (`weatherSystemCentresAt`, `weatherSystemDrift`): each with the
  flow that steers it, east at 12 m/s in the storm tracks and west at 5 in the trades, lows
  heading poleward at 2; each deepens and fills over its life (lows 3–6 days, tropical ones
  5–9, highs 5–10) and gives way to a new one elsewhere, so there are always 64. The same for
  the same seed and time, whichever came before. The map is drawn again for times ahead as the
  clock runs (`bakeMap`): at least half an hour apart (the systems travel some 20 km), further
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
them. Mixed cloud was once taken in chunks of the step's length, with all spread counted as mixed:
walked finer the clouds grew 2–7 % more opaque, far off 19 % less, and the same cloud thinned as
the camera drew away. The edge was once a logistic standing for the normal CDF; blurred it is no
longer one, and in the faint tail a stretch read whole came out 2 to 20 times what its parts held,
a glow about and between the clouds.

**The light** (`cloudLight`, `cloudLit`; 2026-11-11). Lit where each point lies: the sun's colour
and daylight for its elevation there (so the night side is dark and the terminator warm), the moon
by night, and the sky above and the sea below as ambient. The optical depth toward the light is
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
above. The octaves it replaced (after Wrenninge) fell off with depth as the light straight
through did and kept its forward lobe: with the old march's errors, far decks glared. The sky's
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
(`ScenerySkyOverlay`, through its registry; the renderer itself, restored on the rebuilt march
2026-11-10):

- **In the bakes:** before each bake of the air (the environment map and the light probe), the
  clouds are filmed as seen from where the air is filmed (100 m over the sea at the disc's
  centre): a cube map 128² a face, each face drawn once at half that, a still, and drawn over
  the sky in the bake (`CloudVolumeRenderer.film`). Each run through a level is taken whole
  (`filmWhole`, `CLOUD_FILM`, `cloudFilmRuns`): one stretch read over all of it (the cover's mean
  and spread along it, no lumps) and lit once at its middle, toward the light as the march
  lights. Blurred as the bakes and the sea read it, it needs no more: marched as the view is,
  its rays along the layers to the horizon took 3–4 ms a face, 3.8–6.7 ms the six; taken whole,
  0.6–1.1 ms (Iris Xe, 1280 × 720, 2026-11-10). The light probe's six faces are read back
  behind one fence (`readFloatTargetAsync`, `cubeFacesToSphericalHarmonics`): three's
  `LightProbeGenerator` asked for each face's readable format first, a synchronous round trip
  that stood the page 59 ms at each bake. Filmed again only once their version changes, the
  place moves or the sun has turned half a
  degree (`FILM_TURN`): the bakes film twice, the environment's and the probe's, and again at
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
  the sea). The film has its mipmaps, and the sea reads it as blurred as that
  (`skyOceanReflectedClouds`, from `ScenerySkyReflection`): over the field from near the sea,
  as filmed. Far from the field (100 to 400 km off), in a global weather, it reflects the cloud
  map's cover at the sea point instead (low, middle and high, as much as 0.9, 0.6 and 0.25 of
  the sky each), coloured as the film's clouds overhead are on average, with none a grey as
  bright as the sky. The bakes still light the sea with the field's light.
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
  (the terrain's, under the relief) across each layer in 2 samples (`SHADOW_SAMPLES`; 8 cost
  1.3–3.0 ms a drawing, 2 cost 0.3–1.0, alike enough for shadows), with the march's own
  coverage, weather and terrain (`cloud-volume-march.glsl` under `CLOUD_SHADOW`: one source,
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
  moved the time from one that changed what is drawn, whose time then moved with what it drew.
- A browser hook that wrapped `drawArrays` with a `getError` before and after each draw (from a
  debugging session, not the repository) took 88 % of the page's main thread; the bench warns when
  WebGL's methods are not the browser's own.

**The march rebuilt (2026-11-11)**, measured on the bench at 1280 × 720, `medium`, against the
same march with every step a tenth as long and no cap on its turns (`uCloudStepScale` 0.1):

- **Low stratus 20–300 km off:** no pixel over 0.02 (of 1) off. The march it replaced was 3.5/255
  brighter on average at 300 km, 48 % of the deck over 4/255.
- **Scattered cumulus** (over, level, below, down): 5–8 % of the clouds' pixels over 0.02 off,
  their mean under 2/255, at the crisp edges of tops 5–20 km off. Moved 20–40 m, the march's image
  changed some 10 % more than the finer march's (the rest parallax).
- **Orbiting a stratus deck at 140 km** (12 bearings): its mean brightness 0.63–0.71 (linear), none
  of it clipped. The march it replaced: 0.78–0.93, 13–84 % clipped white from 8 bearings.
- **Turns a pixel** (scattered, `count`): mean 38–51, p99 170–335.

Its timings are to be taken again: those of 2026-11-11 were taken with another window drawing on
the GPU. The timings below are of the march it replaced.

The march at 1280 × 720 CSS, `medium` (640 × 360), scattered cumulus, settled, its first pass
and baked maps in: local 10–14 ms from 3 km and inside the layer, 3.8 from 200 km, 2.7 from the
Earth view; global 6–12 near the field. In cloud, the lumps' two reads of the shape volume are
some 30 % of it, the light toward the sun 20–25 %, the short steps through cloud up to 40 % inside
a layer; a view with no cloud at all costs 1.85 ms.

**The step plan (2026-11-07).** Scattered cumulus in a local weather, `medium`, march alone
timed back to back (readPixels to sync, Iris Xe, 375 × 233 sparse); the timings here swung
20–40 % between rounds, so take them as rough. Looking down along a dolly from 5 km up: the old
steps (4 % growth at least, three times longer in clear air, the step back) 7–10 ms; the steps
the budget sets 11–13 ms. The samples toward the light are most of the march: none at all,
5.3 ms against 11. Skipping them where the view was already mostly hidden saved nothing (a
GPU's neighbouring pixels run in lockstep, so one that still needs them holds up the rest);
reusing the last step's light
neither.

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
- **Grain and shake** (2026-11-05, 40 m over the sea, `medium`, the image read back each
  frame): the whole image's move from frame to frame by the brightness' gradients
  (Lucas–Kanade over a band of the image), less its steady drift: 0.15 of a pixel of the image
  (RMS) with steps up to 0.42 before, 0.02–0.03 with steps up to 0.09 now; marched every frame
  with the clock stopped, 0.03. The resolve's Catmull-Rom reads and far softening cost nothing
  measurable (some 0.01 ms either way at 636 × 458).
- **The tops given way** (2026-11-07, `low`, 634 × 464, scattered cumulus from 2.9 km looking
  along the tops some 7 km ahead, the weather paused; the image read back after 160 frames at
  each pose): a quarter of a degree's tilt changed the lower part of the image by 0.0187
  (mean per channel) with the tops thinned, 0.0149 with them given way (0.0152 → 0.0133 in an
  earlier run; the same pose settled twice, 0.0023). Unchanged from 40 m under the cumulus
  (0.001 apart), from 200 km and from 4000 km (0.002, 0.001; mean brightness the same to
  0.0003). Broken stratocumulus as stable (0.0370 → 0.0368; toward the horizon 0.0313 →
  0.0288). An overcast stratus seen from above changes most: its flat white top (a tilt changed
  it by 0.0031) now has lumps (0.0071), and its far edge against the sky shows them as small
  notches. The march's time the same (2.86 → 2.89 ms, the three interleaved), as long as the
  rise is worked out only over the top: worked out everywhere, 3.13. Letting the steps grow
  through optically thin cloud too (not only clear air) made it worse (0.0133 → 0.0187): they
  stepped through the edges' thin parts.
- **A map of the columns' cloud, not built** (2026-11-07, `medium`, scattered cumulus): what a
  map of each column's lowest base and highest top about the camera (with their extremes over
  each mip's area) could save, counted per pixel in the march. Of its iterations (11.6 a pixel
  40 m over the sea looking up, 17.5 from 2.9 km along the tops, 18.4 from 3 km 30° down, 20.9
  inside the layer along it, 6.5 from 200 km, 5.6 from the Earth view), 48–76 % land in clear
  air, but only 21–53 % where the point's own column could hold no cloud at that height
  (`cloudAt` returns before the billows and the detail: off the layer, or under the level by
  more than their reach), and 17–35 % follow another such (7 % from the Earth view, mostly
  outside a map about the camera anyway): the only steps such a map lets the march stride
  past, and already its cheapest. Emulated as a map exact and free (steps growing ×2 up to 8×
  through such stretches, instead of ×1.5 up to 3× through clear air): 5.97 → 5.40 ms along
  the tops, 7.02 → 6.36 from 3 km, 6.20 → 6.05 inside the layer (interleaved). A real one
  reads a texture every iteration, is drawn again as the clouds drift and change, and, a bound
  over a texel's area, skips less: not worth its machinery.
- **Types mixed** (2026-11-07, `medium`, the march alone, back to back, `mixTypes` on and off
  interleaved; the GPU's clock drifted from run to run, so ratios): broken cumulus from 10 km
  +40 % (5.2 → 7.9 ms in one run), scattered cumulus from 2.9 km along the tops +45–50 %, from
  200 km +40–48 %. Of it, the loop over the types +2–9 % where it
  runs once; the patches' pattern (two taps) +2 % where only the weather systems mix far off, +20
  % where the scene's layer mixes everywhere about the scene; the rest is what is drawn: the
  decks the patches and the map now lay keep more of each ray in cloud than the cumulus look did.
  The band's width barely mattered (0.3 to 0.8 of a deviation, within the runs' spread); two
  copies of cloudAt instead of the loop (a branch for the second) cost more, +33–100 %, and the
  loop working out each type's slow part again for each sample toward the light +55 %. The
  Earth view's mean brightness 0.388 → 0.423 (the decks fill more of their column than heaped
  cloud at the same cover); a quarter of a degree's tilt changed the image as much (0.0156 and
  0.0155).
- **Local and global** (2026-11-07, `medium`, the march alone, local and global in turn, twice):
  from 400 km, local (`scattered`, 100 km) 2.65 ms against global 8.32: the views that miss
  its cylinder are not marched. From 3 km over the field local 8.21 against global 4.18, from
  what each draws there: the local sky's cumulus overhead, where the weather systems happened
  to leave the scene nearly clear (low cover read back over it: 0.008). A local weather draws
  no cloud map (some 70 MB and its strips spared).

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
   the map has deep convection); fog would be a row in the table. Mixed types cost: the patches'
   pattern in every column a layer mixes, and both types' clouds across a patch's edge (see
   "Measured").
3. **Clouds between the camera and the data**: the occlusion modes.
4. **Motion:** far off, the map's own wind does not move the cloud between two drawings: the
   systems' mean drift by latitude does, so a cyclone's spiral does not turn as it travels. The
   map is redrawn only every few hours of weather under a fast timelapse on a laptop. Some
   flicker is left while moving fast. At rest the held image stands still between marches and
   catches up with the drift at each (steps of at most 0.3 of a pixel, some 8 a second at 40 m):
   the composite could carry it by each level's drift between them.
5. **The band** driven by the weather, meeting the clouds' reach; then the deck removed and the
   volume folded into `<SceneryClouds>`.
6. **The noise:** the shape volume is RGBA, of which the march needs one value per type: one
   channel would read a quarter as much. The coverage's own 32³ cube (CPU) is read twice to
   keep its period from showing; one non-repeating source would read half as much.
7. **The light:** the scene's light is dimmed by the cloud over the scene (a local weather's
   layers, a global one's map read back there) even far from it (the shadows there are the
   right ones, so this shows only on
   what the shadows do not reach: the host's own objects, and past the shadows' square). A
   local weather's film, read by direction, puts its clouds in the sea's reflection even past
   its radius. The
   shadows are not on what the host draws (wellbores, a chunk's columns), nor on the stage's
   own seabed under the water. An object inside a layer that is
   not the relief's ground (a platform in stratus) takes the clouds' front depth, so cloud
   behind it is drawn over it where it stands in cloud.
8. **Streets in a global weather**: the map's wind could line its cumulus up in streets too; for
   now only in a local weather, in the weather's wind.
9. **The ground:** it does not deflect the map's wind, nor do the clouds' bases follow it finer
   than some 110 km (a cap cloud on a single peak, a fog filling a valley); the terrain is the
   relief's as loaded, the demo's coarse world layer where no finer one lies (some 20 km; the
   map about the camera reads the finest there is).
10. **A global weather's controls** without data: only its seed, and each level on or off.
    Proposed: a share of the Earth under cloud (the systems' lift threshold, so the map's mean
    cover follows it), how stormy (the lows' depth and number), and named climates as presets.
11. **The rebuilt march** (2026-11-11): near cumulus are crisper and smaller than before (the
    false spread had blurred them; a type's `softness` softens them on purpose); its time is to
    be measured again. A global weather walks every step (some 5 times the turns a skipping march
    took from 20 km up): a pyramid of the weather map's maxima would let it pass clear air again.
    From high up the light's crossings of the levels over each point lit (each placed by the
    weather systems' map) are some third of its time, which could be read once a step and lent
    to its points. The horizon aliases in the Earth story.
