# Scenery

The `<Scenery>` component is the world around the data. On its own it is a procedural
sky: a background that shows where the horizon and the sun are, and the light that comes
from it — a directional sun light, an environment map and a light probe, all from the
same sky, with a moon and stars. Its features are components of their own, placed
anywhere under it:

| Component | Adds |
|--|--|
| `<SceneryClouds>` | 3D clouds, from sea level to space, from a `Weather` (see [clouds.md](./clouds.md)) |
| `<SceneryOcean>` | an endless sea with a seabed, and the void below it |
| `<SceneryAbyss>` | the void's look below a level (with a sea, its seabed) |
| `<SceneryCutaway>` | a cut through the sea's water and seabed in front of the view |
| `<SceneryStage>` | the sea, the seabed and the relief on real geometry about the field |

Each draws a layer of its own and compiles on its own (see [Rendering](#rendering)), so a
scenery without a sea compiles none of the sea's code, and adding or removing a feature
recompiles only its own layer. Nothing else in the library depends on the scenery:
components that react to the sun read it with `useScenery()` and fall back to their own
settings without one.

## Basic usage

```tsx
import { Scenery } from '@equinor/videx-3d'

<Scenery sun={{ azimuth: 200, elevation: 35 }} />
```

With clouds and a sea:

```tsx
import { Scenery, SceneryClouds, SceneryOcean } from '@equinor/videx-3d'

<Scenery sun={{ azimuth: 200, elevation: 35 }}>
  <SceneryClouds />
  <SceneryOcean level={0} depth={120} />
  {/* the scene */}
</Scenery>
```

`azimuth` is a compass bearing in degrees (0 = north, 90 = east) and `elevation` the
degrees above the horizon. The compass is set by `up` (default `[0, 1, 0]`) and `north`
(default `[0, 0, -1]`, which is what `CRS.utmToWorld` gives).

To place the sun from a date, an hour and a place, use `solarPosition` from the SDK
(NOAA's approximation, within about half a degree):

```tsx
import { Scenery, solarPosition } from '@equinor/videx-3d'

const sun = solarPosition(new Date('2024-09-10T12:00:00Z'), 58.44, 1.89)

<Scenery sun={sun} />
```

The sky's colours (`colors`: zenith, horizon, ground, nadir) are display colours: the
sky reproduces them exactly without tone mapping. `intensity` scales the whole scenery —
background, environment and light probe alike.

## Sun, moon and stars

The sun is a disc (`size`, an angular radius in degrees; default 0.267, the real sun's) with
a broad halo (`glow`, full
down to about 3° below the horizon and gone with the twilight by 12°), a
bright glare hugging the disc (`glare`, default 0.5: its strength at the disc's edge,
falling as the inverse square of the angle, `skyGlare`) and, optionally, rays around it
(`rays`, default 0), both measured in the disc's radius. `shimmer: true` lets the rays brighten and fade slowly, each on
its own cycle. Its colour and the daylight follow the elevation: red-orange on the
horizon, orange a few degrees up and near white from 25°, and the daylight gone below
civil twilight (−6°). At night the sky and the sea keep 4.5% of their light
(`SKY_NIGHT_LEVEL` in `sky-gradient.glsl`), dark enough for the stars to stand out; the
bakes see it, so it is also the scene's light at night besides the moon's. About sunrise
and sunset (`skyTwilight`: from about 12° down to
−12°, most with the sun near the horizon) the sun's side of the sky turns gold about it
and orange around, replacing the blue rather than tinting it (red over blue reads pink).
It closes about the sun while it is up, spreads widest about sunset and sinks onto the
horizon as the sun goes down. The disc stays near white-gold (it is overexposed even when
its light is red), and a faint pink belt rises opposite; `twilight` scales it all (default
1, 0 for none). The sea reflects it, with a broad glitter path under the low sun
(`OceanMaterial.sunGlintSpread`), and the bakes see it.

The sun and the moon are their real size by default, both about half a degree across, as
they are from the Earth (in an eclipse the moon just covers the sun). In the default 60°
camera that is small: a screen at a normal distance fills only some 20–27° of the eye's
view, so everything in a 60° view, the moon too, shows a little over twice smaller than it
would there; a 25–35° camera shows things about as big as the eye would. `discScale` on the
`Scenery` (default 1) draws both discs, glare and rays with them, that many times bigger, as
games do. Until 2026-11-18 their sizes were 0.75° and 0.6° by default, picked by eye, about
2.5 times the real ones.

`moon` (default on) is a full moon opposite the sun, so it is up at night. Its face is the
real one, from an albedo map of the whole moon (see below), its north toward its axis on the
star sphere: within 1.5° of the ecliptic's pole (`SKY_MOON_AXIS`), so it tilts as the stars
turn. Its disc is the real moon's size (`size`, an angular radius in degrees): 0.259 by
default, its mean, and with an observer as far as it then is (`skyMoonSize`, 0.245 to
0.279). It is seen through the air: the air's own light in front of it, and its light as
the air leaves it (`skyThroughAir`: the air mass the view crosses, by real air's optical
depth, Rayleigh, a moderately hazy sea air and ozone, about 0.3 magnitudes per air mass).
That yellows and reddens it, cream at 10°, orange at 3°, red on the horizon, and dims it,
to a quarter at 10°, 2% at 3° and a twenty-thousandth on the horizon. A screen shows the
night's range from the moon to the sky, some 13 magnitudes, in about 40:1, so the dimming is
shown as its cube root (`SKY_MOON_CONTRAST`; about as the eye judges brightness): 0.64 at
10°, 0.27 at 3°, 0.08 at 1°, 0.03 on the horizon (`skyMoonThroughAir`). A low moon is a
dull orange, and a setting one fades into the haze, the sooner the brighter the sky (in
twilight before it reaches the horizon). Its glare is the sun's (`skyGlare`), `glow`
(default 0.3) at the disc's edge, by its light at its phase (a Lambert sphere's, as
`skyMoonShine` gives the moonlight) and dimmed with it, once it is dark (with the brighter
stars, sun below −7° to −9°): in twilight it is lost in the sky. A reflected light glares
as an emitted one does: a full moon at night glares about as far out as the sun by day, as
its light over the sky behind it is about as much (some 25 times, by Stiles and Holladay's
glare; the sun's some 17), and a crescent far less. The moonlight on the scene is seen by
night eyes, without colour: dimmed as the disc is, in the moon's own colour
(`skyMoonColor`), and so are the 3D clouds by it (`skyMoonDimmed`). By day the disc is grey, its colour's luminance, so the blue it shows is
the sky's in front of it, and its dark side does not show. Until 2026-11-18 the disc kept
its own blue-white at any height and was drawn over the sky by night, by day added over
the sky's blue; its glow was a flat halo some 12° across, from civil twilight. The sky has
ONE directional light: the sun's while it is up, the moon's once the sun is well down
(it fades in between −6° and −12°). `stars` (default on) come out once it is dark. They
are no real star map, but they turn as the real ones do: about the celestial pole, which
stands `stars.latitude` degrees (default 60) over north, with the sun's hour angle, so they
wheel through the night in a timelapse.

Disc, glare, rays, moon and stars are left out of the environment and light-probe bakes
— the directional light already carries that light — so they never light the scene twice.

⚠️ Without tone mapping the disc is display white. With it (the renderer's
`toneMapping`, or `hdr: true` when a pipeline pass tone maps instead), the disc goes 16×
past white, as a bright sun should. Without tone mapping the glare also keeps its full
strength only while its light is warm (up to about 15°); once the light is white it drops
to a quarter, as over the bright halo it would clip to a white blob twice the disc's size.

### The real sky: `observer`

`observer: { date, latitude, longitude }` (a moment, degrees north and east) makes it the
sky over that place at that moment; `sun.azimuth` and `elevation` are then ignored. An
invalid one (no real date, a latitude past ±90) falls back to the sky above. Inside a
`World`, `{ date }` will do: the place is the world's origin's (`geoFrameLocation`).

- **Sun:** `solarPosition`.
- **Moon:** where it really is (the Astronomical Almanac's low-precision series, within
  a few tenths of a degree, with parallax), drawn as a sphere lit from the sun, so the
  phase and the tilt of its lit side come out on their own, its face tilted as the real
  one is (libration left out), with faint earthshine on the
  dark side, which shows the air in front of it a shade darker than the sky around it
  once the stars are out (in twilight it is lost in the sky).
  It is up by day too, as a pale disc. Its light scales with the phase and
  is gone while it is below the horizon, so a night with a new moon is dark.
- **Stars:** the 1630 stars to magnitude 5 of the Yale Bright Star Catalogue, in place,
  each in its colour (from its B-V), over the procedural stars as a faint filler for the
  fainter ones: a third as bright as on their own, none brighter than magnitude 6.5, half
  the light of the faintest real one, so the real stars, the planets, the sun and the moon
  stand out (`SKY_STAR_FILLER`; `stars.density: 0` leaves them out). Each comes out as the
  sky darkens enough for it: the brightest a few degrees after sunset, magnitude 5 once
  the sun is 11.5° down.
- **Planets:** Mercury, Venus, Mars, Jupiter and Saturn, from JPL's Keplerian elements
  (valid 1800–2050, within a fraction of a degree), as bright as they are (Saturn's rings
  aside): Venus is out by sunset. They come and go with `stars`.

A star of magnitude m is drawn `0.08 · 10^(0.2 (5 − m))` bright — the square root of its
light, as the eye compresses it — and wider the brighter it is, its light pulled into a
crisp centre (`SKY_STAR_CORE`), as the procedural stars are. The sky is dithered, so its
dark night gradient does not band. The catalogue is looked
up per pixel from a cube-face grid over the sky (`sky-star-catalogue.ts`), each star listed
in every cell within half a degree of it, so a pixel reads one cell. The catalogue (13 KB,
10 KB gzipped) is a chunk of its own (`codeSplitting` in `vite.config.ts`), loaded the
first time an observer is set: a `Scenery` without one never loads it, and until it is in, the
procedural stars show.

The moon's face is an albedo map of its whole globe, longitude by latitude, 256×128 grey
(`textures/moon.jpg`, 6 KB): NASA's Scientific Visualization Studio CGI Moon Kit
(<https://svs.gsfc.nasa.gov/4720>, `lroc_color_poles_2k`, from the Lunar Reconnaissance
Orbiter Camera's mosaic; public domain), its luminance averaged in linear light. Imported
with `?inline`, it is a data URL in a chunk of its own (`sky-moon.ts`), loaded the first
time the moon is shown; until it is in, the disc is plain. The shader reads it only on the
disc, over its mean as seen from the Earth (`SKY_MOON_MEAN`), so the moon is as bright on the
whole as the plain disc; the brightest highlands clip to white without tone mapping, as a
full moon does to the eye. It darkens the lit side, the earthshine and the moon by day; its
glow and the air in front of its dark side are left as they were.

The astronomy is in the SDK, free of three.js: `julianDay`, `localSiderealTime`,
`equatorialToHorizontal`, `precessFromJ2000`, `lunarPosition`, `planetPosition` and
`brightStars`. `scripts/generate-bright-stars.js` extracts the catalogue (from CDS, or a
local copy) into `src/sdk/utils/bright-stars-data.ts`, 6 bytes a star.

The catalogue: Hoffleit, D. & Warren, W. H. Jr. (1991), *The Bright Star Catalogue, 5th
Revised Ed.*, Astronomical Data Center, NSSDC/ADC; CDS catalogue V/50.

## Clouds

`<SceneryClouds>` adds 3D clouds: a `Weather`'s layers of cumulus, stratus and the rest about the
field, or its weather systems over the whole Earth, marched on the globe from sea level to space
and drawn over the scene. The sea reflects them, the bakes take them, and their shadows lie on
the sea and the relief. Without a `Weather` it draws a few high clouds; without it there are
none. See [clouds.md](./clouds.md).

```tsx
<Weather weather={weatherPresetOf('scattered')}>
  <Scenery>
    <SceneryClouds />
  </Scenery>
</Weather>
```

They draw themselves, after the background's layers (see [Rendering](#rendering)), where the
sky shows; `debug.hide` with `'clouds'` hides them. `enabled` false hides them, still
compiled, so showing them again is instant.

## Graticule

Lines on the Earth — latitude and longitude, the UTM zones, the nautical time zones — are a
layer of their own since 2026-11-03, `<GeoGraticule>`, with or without a `Scenery`: see
[layers.md, Graticule](./layers.md#graticule-geograticule). Placed inside the `Scenery` (or
anywhere in its `World`), it lies on its sea's surface over the sea and is hidden from in the
water.

## The air

`air` (default on) thins with height, so the sky changes as the camera climbs: the
zenith deepens toward a saturated blue (a grey sky stays grey) and the haze at the
horizon closes onto it. Seen from low down, the far sea fades into the horizon's
colour; from high up it stays clear much further out. Looking down, the haze takes the
colour of the sky overhead instead, so from high up the sea seen through all the air below
turns a deeper blue. At twilight the horizon's glow keeps to the far sea, and the air
below takes the dusk overhead sooner, so the sea under a high camera stays dark blue
rather than the colour of the sunset.

```tsx
<Scenery air={{ scaleHeight: 8000, visibility: 60000, haze: 0.75, hazeHeight: 1500 }} />
```

`scaleHeight` is the height over which the clear air thins by e (0 for no change with
height), and `visibility` the distance over which the air at sea level hazes the sea
by e (0 for no haze). Most of that haze lies low, in a layer thinning by e every
`hazeHeight` (default 1.5 km), `haze` its share of it at sea level (default 0.75); the rest
is the clear air. Along the sea at sea level the two together haze as one, but from above
the layer a view down crosses it only at its end, so the sea below is clearer and bluer,
while a view toward the horizon runs a long way through it: the layer shows edge-on as a
bright band along the horizon, and the clear sky above it closes onto the horizon as the
camera rises out of it. The far clouds, seen through little of it, stay crisp. Real haze
grows over the day, as the sun mixes the air, and is thicker in summer: neither changes by
itself here, but a host can drive `haze` and `hazeHeight` with the time or the season.
Heights are measured from the sea's `level` (the void's lid without a sea). `air: false`
turns all of it off. Inside a `<Weather>`, `visibility`, `haze` and `hazeHeight` left out are
the weather's (`WeatherState.air`), so a weather can bring its own air; given, the Scenery's
win.

Above the tropopause the sky darkens toward space, black from the top of the stratosphere
(`SKY_SPACE_START` 12 km, `SKY_SPACE` 50 km), by how little air each view passes: the lowest
height it reaches and, from high up, higher the more steeply it looks up, as a view straight
up leaves the air some 35 times sooner than one along the level (`SKY_AIR_LEVEL_MASS`, of
which `SKY_AIR_PATH` counts). The air thins by e every `scaleHeight`, so the sky grows
see-through long before it is gone. It keeps its gradient at every height, pale toward the
horizon and dark overhead, and runs on smoothly across the level; below about 5 km nothing
changes. From 10 km it is a deep blue overhead; on the globe, from high up, a
thin glowing rim of air stays over the horizon under a black sky, its twilight colours with
it. On the way to black it deepens to the blue overhead, and through the ozone layer
(densest at 25 km, 15–35 km; `SKY_OZONE_LAYER`) it turns bluer still, as ozone takes out
orange and red (`SKY_OZONE`). So from high up the rim is pale, or warm at twilight, at its
bottom, a saturated blue above and black at its top. From 20 km up, fully by 80 km
(`SKY_RIM_SHOWN`), a glow lies over the Earth's edge on top of it: pale just over the edge,
deep blue higher, fading by e every 60 km the view passes over the ground (`SKY_RIM_HEIGHT`)
and brighter toward the sun, so from far off the Earth keeps a soft halo. Where the sky is all but black (under a
twentieth of its light) the stars, the planets and the moon show as at night, by day too: none
from 20 km at noon, the full field from about 40 km. The sun's disc and glare are drawn over
it as before. The sea reflects the sky as seen from the sea.

On the globe, the sun sets later the higher up: from 20 km it is still up
4.5° below the level. So the sky's own light (its daylight, twilight and moonlight, the sun's
colour, when the stars come out) goes by the sun over the horizon where it is seen: the
camera's for the air above it, the sea's for the air low along the horizon, in between by
the lowest height the view reaches (`SceneryMaterial.setAirLight`, from `Scenery` each frame). From high up the air
around the camera stays lit after the sea's sunset, over a horizon already in twilight. The
sea, the scene's light and the bakes keep the sea's light.

The bakes film near the level, so the scene's light does not change with the camera's
height. The sea's surface is hazed; the seabed seen through cut-away water is not.

The haze fades what it covers into three colours that change with the bearing alone: the
horizon's along it and the sky's some 25° up it, and looking down, the sky overhead. They are
drawn into a small lookup, 512 bearings by those three, once for each place a camera draws
from (`SkyAirColors`, `sky-air-colors.glsl`), and the relief's, the sea's and the clouds' haze
read them there rather than each working out the sky three times for every pixel. They match
it within 0.25 % (see [Performance](#performance)).

### From space (built 2026-10-26)

The sky's gradient, its light and the sea's shading take their elevations from the scene's
up, the field's, and the sky's own light from the sun over the camera's horizon: right in
the air, meaningless from space, where the view takes in the night side as well as the day
and, round the Earth from the field, the field's up is not up. So between 100 and 1000 km
over the air's ground (`SKY_FROM_SPACE`, `skyFromSpace`) what lies below is shaded by where
it lies instead (`skyFromSpaceOver`):

- **the sea:** deep blue as the sun lights it there, the blue overhead deepened once more
  (`skyDeepZenith`'s step again), reflecting more of the sky the more it is seen edge on
  (Fresnel's, from `SKY_SPACE_SEA_REFLECT` straight down), with the sun's glint off its
  waves: broad and soft, stronger toward grazing, in the sun's colour there, warm near the
  terminator and white by day (`skySpaceSea`, `skySunColorAt`, the GLSL twin of
  `skySunColor`; `SKY_SPACE_SEA`, `SKY_SPACE_GLINT`). A tight, strong glint read as a
  white blob;
- **the relief:** lit by the sun where it lies, in its colour there, and an even ambient
  (`skySpaceGround`; `SKY_SPACE_GROUND_SUN`, `SKY_SPACE_GROUND_AMBIENT`), not by the
  scene's light, which is the field's: from space at the field's sunset the far side's
  day was lit red. The sky's own dry seabed is lit the same way;
- **over both, the air** the view crosses there (`skySpaceHaze`): by its mass, as the
  Chapman function gives it for a round Earth — 1 / cos of the view's angle from up, at
  most `SKY_AIR_LEVEL_MASS` along the level — over the column of the clear air and the
  haze layer, `SKY_SPACE_HAZE` times what the visibility says (the visibility is the low
  air's). So the haze is thin looking straight down and thickens toward the Earth's edge;
  measured along the view instead (`skyAirHaze`), it was about the same everywhere and the
  sea had no gradient. Its light (`skySpaceAir`) is the blue overhead, paling toward the
  horizon's colour the more air is crossed (`SKY_SPACE_AIR_PALE`), a little warmer where
  the sun is low, and lit by the sun there: dark where the sun is down, down to the
  night's level;
- **the rim** over the Earth's edge: lit where the view passes closest to it
  (`skyDayAt`), so it is dark over the night side. From space it is all that is left of
  the sky's own gradient, whose pale horizon read as a line a pixel or two thin, aliased,
  and lit by the field's light. Its core takes the air's light at the edge, so the two
  sides of the edge meet in one colour, and it never thins below a few pixels: its heights
  are at least 3 (and 1.5) times the metres a pixel spans at the edge;
- **the stars and the sea's layer** test the horizon about the camera's own up and its own
  horizon (`skyOverSeaHorizon`), so they stay right from the far side of the Earth;
- **the sun and the moon:** the sun's disc and glare are reddened only by the air the view
  toward it crosses (`skySpace` along it), so from space it is white and through the air
  over the Earth's edge still red; the moon's glow, the air's, goes as the air does.

Below 1000 km the near shading still shows in part, and it is the scene's, lit by the
field's sun. So far round the Earth it takes the day where it lies (2026-10-27): the
relief's ground and the seabed are dimmed by the day there as a share of the day over the
field (`skyDayFrom`, never brighter), the sea's surface by the day there against the day
the camera sees the sky by, and the sea's glint, near (`oceanShade`'s, through
`skyOceanSurfaceOf`) and from space (`skySpaceSea`), shows only while the sun stands over
the horizon there (`skyLightFrom`, `skySunDiscUp`). Over the field nothing changes. From
530 km the sea 15° past the terminator had kept a bright glint streak, and the land on
the night side was lit as by day.

The clouds from space are `SceneryClouds`' ([clouds.md](./clouds.md)). Below 100 km nothing
changes. A physical atmosphere (scattering tables) is not done.

## The globe

`globe` (default on) lets the sea, the sky and the clouds follow the Earth's curve
(`SCENERY_EARTH_RADIUS`, or with a frame the Earth's radius there, 6385.6 km at Volve in the
map's units; the sky and the clouds take the globe's): as the camera
climbs, the horizon drops below the level by about
√(2h/R) — 0.2° at 40 m, 1° at 1 km, 4° at 15 km — and from high up it bows across the
view. The sea ends at it, its waves tipped with the curve so that the view grazes them there
and they reflect the horizon's colour. The sky's gradient, its twilight and the haze's colour
are measured from it, and the sun, moon and stars set behind it rather than at the level. The
water reflects the sky as seen from
where it lies, with its own level horizon: far out, where the sea is tipped with the curve, a
wave's reflection is turned by that tilt onto the up the sky is seen by (`globeTurnFrom`):
turned into the field's frame instead, far round the Earth it fell below the camera's
horizon, and half the sea went dark at sunset. Off, every one of them is as on a flat sea:
right for one field seen from near it, but far from it the horizon never drops and the
relief and anchored content stay flat. It is kept for comparison and for a host that needs
a level horizon. Step 4 has the sky's look frame follow the camera instead
([world.md, step 4](./world.md#12-step-4-in-detail-the-sky-anywhere-on-the-globe)).

The waves are drawn in charts fixed on the Earth (`SceneryMaterial.oceanCharts`, an sdk
`OceanCharts`): the field's wave plane out to 1000 km, past it 162 stereographic charts, so
far round the Earth they lie on the sea there instead of on the field's plane seen edge on,
keep the wind's compass bearing, and are as sharp as over the field. Where two charts meet
the waves calm over a strip 8 km wide. A point's waves depend on the point alone, not on
where the camera came from, for waves driven by data later
([world.md, 4d](./world.md#4d-the-waves-far-off-built-2026-10-27)).

The Earth is a fixed globe (`SceneryMaterial.globe`, an sdk `Globe`; see
[world.md](./world.md#9-step-2-in-detail-the-sky-on-a-fixed-globe)): a sphere whose centre
lies fixed below the scene, its cap over a disc about the scene — the smallest one holding a
`SceneryStage`'s `boundary`, or a `World`'s (`boundaryDisc`) — cut flat, so what meets the water there meets it level. The plane
and the sphere meet on the disc's edge, at an angle of `r / R` (0.1° for a 16 km stage);
without a stage the disc is a point at the world origin. Inside a `World` the globe is the
World's, and so is whether it curves (its `globe`): the sky draws on it, and whatever the
World places lies on it with or without a `Scenery`, so drawing the scenery or not moves
nothing ([world.md, step 7](./world.md#the-anchor-the-worlds-frame)). Every point of the sea has one
place whatever the camera does: nothing rises or sinks as it moves. Heights are over the
globe — far from the scene scene Y is not altitude: at Y = 40 m, 200 km off, the camera is
3 km over the sea — and so is up, which far off tilts from the scene's (1.8° at 200 km).
The camera's controls keep the scene's up, so there the horizon rolls a little, and round
the Earth it stands on end: `useLevelHorizon()` levels it, by the camera's up
([world.md, 4e](./world.md#4e-a-level-horizon-for-a-host-built-2026-10-26)): by default once
the camera is at rest, rolling the view level over a moment and never while the user drives
it; or all the while, a little each frame (`mode: 'continuous'`). How low a
view passes through the air, which darkens the sky toward space, is measured on the same
globe, so the rim of air sits on the sea's edge.

A stage reaches the camera's far plane, but no farther than 3000 km (`STAGE_REACH`), so it
draws most of the sea in view: its geometry
stays flat, a carrier for pixels each shaded where the view meets the globe, and beyond
the disc it leaves the sky above the curved horizon to the background, which then draws
the very same sea. With the camera beyond the disc its planes sink under it, so they lie
below it however far the globe falls away. Past its reach the background draws the sea;
from space, all of it (flat planes cannot stand for the globe there). It claims the sea
only while the camera is over its rectangle on the field's half of the Earth
(`SceneryMaterial`'s `claimStage`): off it, its sunk planes would miss some of what it
claims, and a point on the far side would project back inside it. The void and the subsurface, the views from in
the water and below the seabed, and the bakes stay flat: the bakes film a level horizon, as
a few degrees barely change the light, so climbing never bakes. The view from in the water
is level under the camera's own up (`globeCameraUp`), the scene's over the disc: by the
field's, 500 km off its surface and seabed tilted 4.5°, the window to the sky skewed and a
black line crossed the view (2026-10-27). The stage's planes, sunk under a camera far off,
take only the rays that rise to them from below, and the view in the water leaves the
stage no ray that only grazes the seabed's curve. Switching it only changes a
uniform; it costs about a square root per pixel.

What is drawn flat beyond the disc goes onto the globe with a `SceneryAnchor` (about a point,
as the globe places the ground there) or `applyGlobe(material, globe)` (per vertex, for
what is long); a field with a map of its own, another UTM zone, by its `UtmArea` in a
`World` ([world.md](./world.md#10-step-3-in-detail-fields-placed-on-the-earth)).
`UtmPosition` and `Wgs84Position` place flat, at the area's Y: over the disc that is
exact, but 200 km out what they place stands 3 km over the sea
([world.md, For a host](./world.md#for-a-host)).

## Lighting the scene

`environment` bakes the sky into `scene.environment` (lights MeshStandard and
MeshPhysical materials) and `lightProbe` into a `LightProbe` (lights every
`lights: true` material). Both default on. ⚠️ With both, MeshStandard materials receive
the sky's diffuse light from each. An `Ocean` or a `ChunkStack`'s sea in the scene reflects
the air's bake, the 3D clouds' bake and the scene light's sun or moon, which the scenery
publishes for them each frame (`sceneSky`; [ocean.md, One sky](./ocean.md#basic-usage)).

The bakes are made once for each zone the camera can be in — the air over the sea, the
water in it and, below the seabed (or the abyss level), the `subsurface` — and swapped as
the camera crosses a level, so a moving camera never bakes. In the water the light dims
with depth. Every zone is filmed with one small program of its own
(`scenery-bake-fragment.glsl`, built 2026-11-18): the light is smooth, so none of the
background is drawn into it. The air is the sky's own surface (`skySurface`: its gradient,
daylight, twilight and the sun's halo; the disc, the moon and the stars are the scene's
lights') over a flat sea: the sky mirrored by Fresnel toward the horizon, the water and its
seabed toward the nadir, and the whitecaps' mean cover. The water is its own light at the
bake's depth, the seabed below fogged by it, and over it Snell's window onto the sky. The
subsurface is a dark backdrop with light panels (below). It compiles in moments, whatever
the background still compiles, so the scene is lit early; a zone not yet baked borrows the
subsurface's maps until its own are swapped in. The subsurface is baked again only when its
own inputs change (its panels or map, the frame, the environment's resolution), never with
the sky.

Until 2026-11-18 the air and the water filmed the background itself (sky, void, seabed,
water and sea surface), with copies of its programs where three keyed them apart (without a
`RenderingPipeline`, or other lights): five more programs of some 135k characters each,
compiled cold after the sky's (the Sea Bench's air and water bakes came at ~50 s instead of
~11 s), 4.6 ms of CPU
a bake against 0.6 now (RTX A1000), and a frozen snapshot of the waves under the bake's
point in every mirror-like object. The sea in a bake is read by no sea (an `Ocean`'s and a
`ChunkStack`'s reflections are turned above the horizon): it lights what lies in the scene
from below.

The sky is baked again when it changes, once it has been still for `capture.interval`
(default 250 ms): a slider being dragged bakes nothing on the way, so the sky follows it at
once and only the light it casts waits. A sky that keeps changing (a timelapse) is baked
at least every `capture.maxWait` (default 1000 ms), the camera's zone alone: the others wait
for the sky to be still, and a zone the camera enters is baked at once (until 2026-11-18 every
zone each time, the water's prefiltered too while the camera was in the air). A bake goes a
stage a frame: the zone's film (with the clouds' cube), its prefilter, its probe; together in
one frame, on top of a full one, they stood the view still 80–150 ms at a time as the GPU
caught up (RTX A1000). The probe is projected to spherical harmonics on the GPU and only its
coefficients read back (`SphericalHarmonicsProjector`: 0.8 ms, against 1.1 ms, up to 3.7, for
its six faces read back whole), and while the sky keeps changing every other round. The
environment is filmed and prefiltered 64² a face by default (`environment.resolution`): its
prefilter 2.0 ms a bake against 3.6 at 128 (RTX A1000, 2026-11-18). Only smooth, glossy
materials lit by it show the difference, in sharper reflections at 128 or more; the matte ones
read its blurred levels, the same at either. A change recompiles every material it lights (its
size is compiled into them). The
scene's light probe eases toward
each new bake of its zone over a fraction of a second, so the light does not step as the
sun moves; another zone's is swapped in at once. The environment map is swapped in, whole,
by its prefilter.

With clouds (`SceneryClouds`), the air's bakes take them too, baked from where the
air is baked and drawn over the sky; the sea reflects them (blurred from high up, and far off
the weather's own cover); the directional light and the
sea's glint are dimmed by the share of the light they let through, so overcast takes the sun
and lights the scene with grey bakes alone; and their shadows lie on the sea and the relief
about the camera ([clouds.md](./clouds.md), "The scene's light"). They hand that over through
the scenery's registry (`ScenerySkyOverlay`); a change to them makes the bakes due again. Until 2026-11-05 the baker's overrides that turn the globe off for the
bakes (`uGlobe`, `uOceanCharts`) were `new Vector4()`, whose w of 1 is the globe's switch: the
bakes drew the globe on with no radius, and half their sea lay in night.

`subsurface` is the light where the sky's own means nothing: below the seabed, and
wherever the sky is not drawn (`background: false`, or `'void'`). By default it is a dark backdrop
with soft light panels above and below the horizon (`panels`, see `ScenerySubsurface`); give
`map` (an equirectangular or cube texture) to use one of your own instead. The directional
light changes too: below the seabed it is the subsurface's `light`, steady whatever the time
of day, rather than the sun's or the moon's. By default it is fixed (azimuth 200°,
elevation 45°, white, the sun's `intensity`); with `followSun` it turns
with the sun's compass bearing, its elevation held within `elevationRange` (default 30° to
60°), so it never lights from below at night. It switches with the environment as the camera
crosses the seabed, or eases over `transition` seconds. Above the water everything keeps the
real sun, the sea's glint and the bakes included; data seen from there through a cutaway is
lit as the scene is.

```tsx
<Scenery subsurface={{ light: { followSun: true, elevationRange: [25, 55], transition: 0.5 } }} />
```

`background: false` hides the sky (and its stage) instantly: nothing is rebuilt or baked
again, and the scene stays lit, by the subsurface.

`background: 'void'` draws the void's grey gradient in the sky's place, the very gradient
the stand-in shows while the sky compiles: the lid's colour overhead fading to the
horizon's, and the depths' below, measured from the horizon the Earth's curve lowers, so
from high up it meets the far ground's haze without a seam. There is no air, sun, moon,
stars (all compiled
out of the sky's layer, `SKY_VOID`), and no clouds. The void itself,
a stage and a sea are drawn as ever; with neither water nor a seabed it is the
void all round. The scene is lit by the subsurface everywhere, as with `false`, so only its
zone is baked. Changing to or from it recompiles the sky's own layer.

```tsx
<Scenery background="void">
  <SceneryAbyss />
  <SceneryOcean water={false} seabed={false} />
</Scenery>
```

## The endless sea

`<SceneryOcean>` adds a sea: a wavy surface at `level` over a flat seabed `depth` below it,
seen from above, from inside the water and, below the seabed, as the void. With a sea the
void below its seabed is always there; `<SceneryAbyss>` sets its look.

```tsx
<Scenery>
  <SceneryOcean level={0} depth={100} windSpeed={10} waterOpacity={0.8} />
</Scenery>
```

The water takes the `<Ocean>` component's props under the same names (see
[Ocean](./ocean.md)), so one object can drive both; the sun and the reflected sky come
from the sky. `water: false` leaves the seabed dry; `seabed: false` leaves the void
below the water, seen through it from above, while from the void its lid is still a roof,
as under a seabed. Far off, over the waves' `detailFadeDistance`, the water turns opaque
whatever its `waterOpacity`; nearer it is as see-through as its depth and optics make it,
from any height alike. (It used to turn opaque from 2 to 5 km up, `SKY_OCEAN_OPAQUE`, which
hid the seabed showing wrong through shallow water; removed 2026-11-15 once that was fixed.)
Seen from the air, the seabed under the background's sea lies as deep as the scene's ground
map has it, on the line of sight (not bent at the surface, so it meets the stage's seabed and
the relief, which lie where they are), and is lit as that deep (`skySeaLayer`):
the water in front of it reads the same depth, so through the shallows it shows bright,
and through deep water not at all. On the sea's fixed `depth` it was lit 100 m deep under
water a metre deep: a dark rim along every coast with realistic optics, and with clear ones
a bright bed through fjords hundreds of metres deep. `seabedOpacity` (default 1) lets the void, or the scene under a stage's
seabed, show through it. Each of these only changes uniforms, except that crossing a
`seabedOpacity` of 1 makes a stage's seabed materials again (see Performance). The
seabed's look (`ScenerySeabed`) is lit with the model and options of a
`ChunkMaterial`, so a chunk layer given the same colour and detail continues it without
a seam.

The waves shoal and die out toward a coast by the depth of the scene's ground under the
sea (its ground map, 60 m cells near the field and coarser out), and break in surf there
(`shoreFoam` and the rest of the `<Ocean>`'s surf settings, default off): the same rule and
code as the `<Ocean>`'s (see [the waves](./ocean-waves.md), Shallow water). The bed's slope
for the surf comes from the depth's screen derivatives. The surf is placed to the map's
accuracy against the coast the relief draws: on a gentle shelf the belt is hundreds of
metres wide, on a steep coast under a pixel, where it dims. Floating children ride waves cut
by the relief's ground under them. The sea has no displacement.

The sea never tints the data: a `Chunk`, `ChunkStack` or `Surface` is drawn as it is,
wherever it lies. A field column whose top is the sea bed hands that seabed to a stage
instead, which draws it as the sea's own (see below).

The sea is part of the background, so on its own it never hides anything in the scene.
To have the water in FRONT of the scene, add a stage.

Floating children work as inside an `<Ocean>`: while the sea has water, `<Scenery>` provides
the wave sampler (`OceanSamplerContext`) and the contact-foam registry
(`OceanContactContext`) to its children, so a `<Tanker>` — or anything using
`useBuoyancy` and `useOceanContact` — rides the sky's waves and leaves a foam collar on
its surface. Heights are absolute, the sea level included. ⚠️ Assumes the default `up`
(+Y).

Both are in the sea's wave plane (`skyOceanPlane`: true east and south at the field),
which a projected grid turns from the scene's X and Z by its convergence (about 1° at
Volve): `<Scenery>` takes each sample point and each footprint into it (`OceanPlane`),
so a vessel kilometres from the origin rides the waves drawn under it and its foam hugs
its hull. ⚠️ Until 2026-10-28 they were taken in the scene's X and Z: the foam lay off to
one side, tens of metres a few kilometres out. With more footprints than the sea draws
(`OceanMaterial.contactCount`, 8), those nearest the camera are drawn.

## SceneryStage

`<SceneryStage>` puts the sky's sea and seabed on real geometry between the scene and the
background, drawn with the sky's own shading so the two meet without a seam. Being
geometry, the water lies in front of what is under it, and the seabed hides what is
below it at the sea's `seabedOpacity` — unless the camera is below it too. It reaches the camera's far plane
beyond its `boundary`, so every view ray that can reach the scene crosses it. With the sky's
`globe` it stays flat but shades the sea beyond the disc holding its `boundary` on the
globe (see The globe).

```tsx
const layers = [{ id: 'etopo-2022-nordic' }]
const [cut, setCut] = useState<CutUniforms | null>(null)
const [ground, setGround] = useState<HeightFieldClip | null>(null)
const [sampler, setSampler] = useState<ReliefSampler | null>(null)
const [stage, setStage] = useState<SceneryStageOccupantState>({
  seabed: false,
  seabedOpacity: 1,
  water: false,
})

<World frame={geoFrameFromCrs(crs)} boundary={[minX, minZ, maxX, maxZ]}>
  <Scenery>
    <SceneryOcean level={0} depth={120} />
    <SceneryStage
      occupants={[{ outline, cut: cut ?? undefined, onStage: setStage, onGround: setGround }]}
    />
  </Scenery>
  <GeoRelief layers={layers} onSampler={setSampler} />
  <ChunkStack
    outline={outline}
    seabed={meta.id}
    relief={reliefSource({ frame: geoFrameFromCrs(crs), layers }, { level: 0 })}
    clip={ground}
    reliefSampler={sampler}
    water={water}
    drawWater={!stage.water}
    onCut={setCut}
    /* ... */
  >
  <Chunk
    layers={[
      {
        surface: meta,
        drawCap: !stage.seabed,
        capOpacity: stage.seabed && stage.seabedOpacity < 1 ? stage.seabedOpacity : undefined,
        /* ... */
      },
      ...below,
    ]}
  />
</ChunkStack>
```

`boundary` is the scene's area in scene X/Z, and should hold the whole scene: by default
the `World`'s (see [Boundaries](#boundaries)). Without either — a `World` anchored to a point,
as `useTargetAnchor` anchors it away from the fields — the stage has no area of its own: it
draws the sea about the scene's origin, curved from there (no flat disc), the relief is
see-through only over the fields loaded in the `World`, and an occupant without an `outline`
is handed no ground. `occupants` claim parts of it — typically field
columns. The sky's sea is
global: its `water`, `seabed` and their opacities hold over the occupants as everywhere else.

Without a `GeoRelief` in the `World` the stage's seabed is flat, at the sea's depth, over
everything: the occupants draw their own seabeds, and the flat one lies under them too. With
one, the relief is the seabed everywhere, the occupants' ground included (see
[Relief](./relief.md)), and the bridge to a `ChunkStack` comes in three parts
([tiles.md](./tiles.md)): the stack builds its sea bed on the relief (`relief`, from
`reliefSource`, derived from the very props the relief is given), ends its faces where the
relief is drawn (`clip`, from the occupant's `onGround`), and answers what is placed on
its top from the relief (`reliefSampler`, from the relief's `onSampler`). Give the
sampler through `SurfaceSamplerContext` to what stands past the column, too.
`applyGlobe(material, globe)`, with the World's globe (`useWorld()?.globe`),
places a material's vertices on the globe as the relief's are, for what is long and
outside any anchor.

Each occupant:

- `outline` (scene X/Z) is its footprint: the cutaway takes its size from it, and its
  `anchor` is placed on the globe about its middle. With a relief, over it the
  cutaway takes the water but not the ground, and over its bounds `onGround` hands out
  the ground as drawn (a `HeightFieldClip`), with the tiles' error held to half a pixel.
  The relief knows the outlines of 4 occupants at most.
- `cut` is the occupant's own cut: a section `plane` and a `fence`, as the very uniform
  objects the occupant's materials read (`CutUniforms`), so it follows the cut every
  frame at no cost. A `ChunkStack` hands out its own through `onCut`. They must be in the
  scene frame. The relief over the occupant stays whole by default (`keepBed`), as the
  occupant's floor; with `keepBed: false` it is cut with the occupant inside the outline,
  for one occupant at most, and the void shows through the opening.
- `anchor` is the occupant's own group, drawn outside the `Scenery`, which the stage places
  on the globe about the outline's middle (see `SceneryAnchor`): over the disc, where an
  occupant lies, that moves nothing. How the scene places itself on the Earth, a `World`
  and fields in other frames are in [world.md](./world.md).
- `onStage({ seabed, seabedOpacity, water })` tells the occupant what the stage does for
  it, whenever that changes:
  - `seabed`: the stage draws its seabed — with a relief, once the sky has compiled,
    while the sky is drawn (`background`), and while the sea has a seabed. Until then
    the occupant draws its own — a chunk layer's `drawCap` — so one of the two always
    draws it, give or take the frame a change takes to reach the occupant.
  - `seabedOpacity`: the opacity the stage draws it at. Below 1, the occupant must not
    cull what lies under it: hand it on as the layer's `capOpacity`.
  - `water`: the stage owns the water over the occupant, with the sea's `water` on or
    off. A `ChunkStack` then hides its own (`drawWater={false}`), which shows and hides
    it without a rebuild.

  All three reset (`false`, 1, `false`) once the stage is gone.

⚠️ Without a relief the stage's flat seabed lies at one depth under the occupants: where
an occupant's own top lies deeper, the flat seabed hides it unless the cutaway or
`seabedOpacity` opens it.

The stage's transparent parts are ready for the `OITRenderPass`. ⚠️ It assumes the
default `up` (+Y), and renders nothing without a `<SceneryOcean>`.

### Boundaries

A stage's area — a `World`'s, a `SceneryStage`'s, a field's (a `UtmArea`'s, in its own X/Z) —
is a `Boundary` (sdk, `geometries/boundary.ts`), in X/Z, in one of four forms:

| form | what |
| --- | --- |
| `[minX, minZ, maxX, maxZ]` | an axis-aligned box |
| `{ box, rotation }` | a box turned about its middle: `rotation` in radians, counter-clockwise seen from above (+X toward −Z), as three.js turns about +Y; `box` its extent before it is turned. A field turned against its grid needs no larger stage than itself |
| `{ centre, radius }` | a circle |
| a `PlanarPolygonGeometry`, or a ring of `[x, z]` points | a polygon, as a chunk stack's outline: holes too, inside by the even-odd rule |

```tsx
<World frame={volve.frame} boundary={{ centre: [0, 0], radius: 9000 }}>
  <UtmArea frame={troll.frame} boundary={{ box: [-13500, -6500, 13500, 6500], rotation: Math.PI / 6 }}>
    {trollData}
  </UtmArea>
  <UtmArea frame={other.frame} boundary={other.outline}>{otherData}</UtmArea>
</World>
```

What each part makes of it:

- **The globe** is cut flat over the smallest disc that holds it (`boundaryDisc`: a box's
  about its middle, half its diagonal across; a polygon's through two or three of its
  points), and a field not anchored is placed about that disc's middle.
- **The relief** is see-through over the shape itself (the sea's `seabedOpacity`, or a
  `GeoRelief`'s `fieldOpacity`): each region is tested in its own frame in the shader — a box
  with its turn undone in its matrix, a circle, or a polygon by its outline's distance field
  (`polygonDistanceField`, 256², one layer each of an array texture made when the regions
  change, not each frame). A polygon's edge is as fine as a texel of its field, 1/246 of its
  span (65 m for a 16 km field); its corners are rounded within one.
- **What is laid out on the grid** — the stage's plane, the sea's claim, the ground handed
  out to an occupant without an outline — takes the axis-aligned box that holds it
  (`boundaryBox`).

Helpers, from the sdk: `boundaryShape` (the one form of three the others work on: a box,
turned or not; a circle; or a polygon's rings, its offset applied), `boundaryDisc`,
`boundaryBox`, `boundaryContains`, `boundaryOutline` (closed rings, to draw it),
`boundaryKey`, `enclosingCircle`, and `orientedBounds(points)`: the smallest turned box that
holds a field's outline or its data's footprint, for a stage as tight as a polygon at the
cost of a box.

## The void (`SceneryAbyss`)

`<SceneryAbyss>` puts an endless lid overhead below a `level` and a bottomless gradient below the
horizon, so a camera under the ground does not see the sky. It is part of the
background, so it never hides anything in the scene, including objects above the level.
The lid recedes into the horizon colour (`fadeDistance`; 0 for never) and has a noise relief
(`detail`, `detailScale`); the depths have faint distant rock (`depthDetail`) and a
`falloff`. A `<SceneryOcean>` turns the void on below its seabed by itself (then the
void's `level` is the seabed's, and `<SceneryAbyss>` only sets its look), and with
or without a seabed its lid is a roof from below. Its gradient, its rock and its lid are laid
out by the camera's own up (the look frame), so the void is the same under any field.

Under the `World`'s relief the void starts under the relief, at whatever depth: over
it, down a trench below the sea's `depth`, the camera is still in the water. From the void
the relief itself is the lid — its underside, shaded as the flat lid is, raked by a level
light at the subsurface light's bearing (`SceneryMaterial.setAbyssLight`) so its shape
shows — and nothing above it is drawn: not the water,
the land, nor a trench's floor deeper than the camera. Past the relief's reach the flat lid
carries on, the two in one colour where the relief lies level (see
[tiles.md](./tiles.md)).

The void had walls, cliffs about the anchored stage to show scale, until 2026-11-03: they
belonged to one field, fitted badly with several, cost 0.5–2.5 ms a frame and tied the stage to
an axis-aligned rectangle. Removed, and parked on the branch `parked/abyss-walls`.

### The hollow

By default the void is a hollow in the crust about the field (`SceneryAbyss`'s `hollow`): a
crater 500 km across the rim, its walls of rock down to a floor 35 km under the seabed, the
seabed its lid. Peeling the seabed (`<SceneryOcean seabed={false} />`) opens it: the relief
and the seabed are cut away inside its rim and kept whole around it, and the data under the
field is seen against the crater. Past its walls and under its floor the void is black, with
the lid overhead. It is real geometry with baked textures, drawn with the background, and
peeling, moving or flying into it re-bakes and recompiles nothing. `hollow={false}` keeps the
plain void above, the bottomless gradient. Its design, look, light and cost:
[void.md](./void.md).

## Cutaway

`<SceneryCutaway>` cuts the sea's water and seabed away in front of the view, so what lies under
them is seen clearly — an illustration's cutaway rather than a realistic one. It cuts
everything nearer than a line across the view where a row of the frame meets the
surface (the seabed, with the camera in the water or the sea dry); waves bend the line,
a rim marks it and a shadow falls just inside it. The scene itself — the occupant, the
data, a relief over an occupant's outline — is never cut. With the camera in the water, the cut takes
the seabed in front of the view, and the water begins only at a wall standing on the
cut's edge: inside it the view is clear, and the sky shows through the surface over it.
A cutaway also keeps the scene lit as from above the water.

```tsx
<Scenery>
  <SceneryOcean />
  <SceneryCutaway reach={0.5} rim={{ width: 3 }} shadow={{ opacity: 0.5 }} />
</Scenery>
```

- `water` (default 1) is how much of the water it cuts: 0 leaves it whole, 0.5 half of it.
  `seabed: false` leaves the seabed whole, seen through the cut; for a see-through seabed,
  lower the sea's `seabedOpacity` instead. The rim and the shadow mark the edge either way;
  only cutting some of the water lights the scene as from above it.
- `reach` is the frame row the edge sits on when looking level; tilting down raises it,
  and from `exitTilt` (default 45°) it slides out of the top of the view.
- `offset` moves the edge ahead (+) or back (−) of where `reach` puts it, in the frame's
  half-width at the edge, so it keeps its proportions through a zoom or a tilt. Keep
  `reach` where the cut reads well (0.5) and move the edge with `offset`: near the horizon
  a row's sight line runs far for a small step, an offset never does.
- The edge never lies farther than a ceiling (2026-11-19): where a row 95 % up the frame meets
  the cut's plane (`CUTAWAY_TOP_ROW`), a sight line at least 1° below level, and with the globe
  no farther than 80 % of the way to the horizon (`CUTAWAY_HORIZON_SHARE`: the cut's plane is
  flat, while the sea falls away, 1.4° below level from 2 km up and 3.2° from 10 km). An offset,
  dragged or given, beyond it is held there while the view needs it and comes back as the view
  allows; dragging stops there. Before, a far edge could lie past the frame's top or the
  horizon, where no rim is drawn, and its grip was lost.
- With the globe, the cut lies on its flat disc about the field (`Globe.discRadius`), where
  the sea is the cut's plane; past it the sea falls away (7 km below the plane 300 km off) and
  the scene's up is no longer the sea's. So it gives way to a distant view (2026-11-19): as the
  camera's distance from the disc's middle (to the side or upward) goes from 4 to 8 of its
  radii (at least 10 km), its edge slides back under the camera, its grip hidden, and past it
  there is no cut (`CUTAWAY_AWAY`). Without the globe the sea is the plane everywhere, and it
  never gives way.
- `handle: true` draws a grip on the rim in the middle of the view: dragging it sets the
  offset, under the pointer, and a double click or tap puts it back to 0. It reports
  through `onOffsetChange` once the drag ends (and on a reset), and the sky keeps the
  dragged offset until `offset` changes.
  The shader draws it with the rim, so it is drawn only where the rim is (on the surface
  seen from above); an invisible element over it takes the pointer, so camera controls
  never see the drag. It works while the edge slides out too. Should it still go out of
  view over the sea (a tilt carrying a near edge below the frame), not held and not sliding
  out, the offset goes back to 0, reported as a double click's is.
- `zoomFollow` is how much of a zoom its size follows on screen: 1 keeps it fixed in
  the frame, 0 fixed in the world. It has its frame size with the camera `reference`
  high (default half the width of a stage's occupant).

## Rendering

The background is drawn in layers, each a fullscreen triangle on the far plane with a depth
test, so it is shaded only where nothing nearer is drawn, and each blended with its alpha
over the ones before it. In order (`SCENERY_LAYER_ORDER`, after `renderOrder`, 1e9 by
default):

| Layer | Drawn from | What |
|--|--|--|
| `sky` | `<Scenery>` | the air, sun, moon and stars, or the void's gradient (`background: 'void'`) |
| `abyss` | `<SceneryAbyss>`, or a sea | below its level, the lid and the depths over everything; above it, the depths only where the sea's layers leave them showing (no seabed, a see-through one, the cutaway, a stage's opening) |
| `sea` | `<SceneryOcean>` | the seabed seen through the water from the air |
| `water` | `<SceneryOcean>` | the view from in the water |
| `surface` | `<SceneryOcean>` | the sea's surface, at the next `renderOrder` |

The relief's overview draws after them, and the clouds (`<SceneryClouds>`) after the sea's
surface layer, drawing themselves. Transparent parts draw after everything. It works with R3F's own render and with a
`RenderingPipeline` of `OITRenderPass` + `OutputPass`.

- Each layer is a program of its own, compiled with only the switches it needs
  (`sceneryLayerDefines`): adding a void compiles its layer and nothing else; the seabed's detail only the sea's, the water's and the
  stages'. The sky's own (`SceneryMaterial`) recompiles only for `background: 'void'`.
- Each frame a layer that can show nothing from where the camera is is not drawn at all
  (`sceneryLayersShown`): in the water the sky only through a cutaway's cut;
  below the seabed only the void; from the air the void only while something opens the
  seabed onto it. Each shader still finds where it draws itself, so near a level both
  sides are drawn and nothing is missed.
- The air's colours (`SkyAirColors`) are drawn before what reads them, at most once a render
  for each place a camera draws from: `SceneryMaterial.prepareDraw`, from every layer's
  `onBeforeDraw`, a stage's view and the clouds' march and bake. A second view, or a bake from
  its own point, gets its own. Its pass compiles first (`PRECOMPILE_PRIORITY.first`), and the
  sky waits for it as for its layers.
- The compositing is exact in linear light: in a `RenderingPipeline` the
  layers give what one program would (measured: identical to the last two decimals of a
  block mean in every pose). Without one, R3F draws to the canvas and three tone maps and
  encodes each layer before it is blended, so where a layer is partly see-through it
  differs a little: the edge of a see-through seabed shows slightly dimmer, and so do the cutaway's cut seen from in the water and the void
  fading in without a sea. The sea's surface layer has always been drawn that way.

⚠️ An opaque object that writes no depth (`depthWrite: false` without `transparent`) is
drawn over by the background: make it transparent. The far plane assumes a standard depth
buffer, not a reversed one. Each layer rebuilds its view ray from a point at NDC depth 0,
not on the far plane: with a far plane far enough from the near one (50 000 km over
0.1 m), the far plane's point rounds to infinity in 32-bit floats and the ray flips.

⚠️ Drawn on the far plane, the background hides nothing by depth: what lies under its sea
or its seabed — past a stage's reach (the far plane, at most 3000 km), off its area, or past
the far plane — shows through it unless it hides itself. A stage's own surface is drawn over
what lies under it, and its seabed and a relief's tiles hide what lies below by depth; past
them a shader takes `skyOceanCover(world, height)` (sky-ocean.glsl): how much of the
background's surface and seabed lies between the camera and the point, by its height, or
past the Earth's curve, with no depth needed. The geographic layers take it with `water`
`'fog'` (see [layers.md](./layers.md#through-the-sea-water)).

⚠️ R3F applies the Canvas `gl` props again whenever the Canvas re-renders, undoing
anything set on the renderer since. Set tone mapping that should change at runtime on
the renderer from an effect, and use the Canvas `flat` prop rather than
`gl={{ toneMapping: NoToneMapping }}`; otherwise the next re-render resets it.

⚠️ With a logarithmic depth buffer and MSAA, data under the sea can show through its
surface and seabed along its edges, most of all from far up, where a sphere or a
wellbore is only a few pixels wide and nearly all edge. three.js writes a log depth from
a value it interpolates at the pixel's centre, and at an edge that centre can lie off
the triangle: the value is extrapolated, by kilometres along a steep side, and comes out
in front of the water. It is the data's own materials, not the sky's, so the sky cannot
mend it. A host can have three interpolate it inside the triangle instead, before any
material compiles (measured: 16–18 such pixels at 40–600 km, none after):

```ts
import { ShaderChunk } from 'three';

ShaderChunk.logdepthbuf_pars_vertex = ShaderChunk.logdepthbuf_pars_vertex.replace(
  'varying float vFragDepth;',
  'centroid varying float vFragDepth;',
);
ShaderChunk.logdepthbuf_pars_fragment = ShaderChunk.logdepthbuf_pars_fragment.replace(
  'varying float vFragDepth;',
  'centroid varying float vFragDepth;',
);
```

## Performance

- The shaders are large. Measured cold on an Intel Iris Xe laptop (ANGLE / Direct3D
  11): the background ~2.5 s, the sea surface layer ~1.7 s, a stage's surface ~1.6 s,
  each seabed part ~0.4 s. Fully cold (Chrome's and
  the driver's caches bypassed, every program at once, 2026-10-27, RTX A1000 laptop):
  ~39 s of Direct3D compiling in all, a stage's surface 10.9 s and the sea surface layer
  ~8.5 s, twice (drawn to the screen and into the bakes, without a `RenderingPipeline`;
  the bakes have had a small program of their own since 2026-11-18).
- They compile in the background where the browser has `KHR_parallel_shader_compile`:
  until the sky, its stages and its bakes are ready, a stand-in (the void's grey
  gradient, without its detail) is drawn, a stage draws nothing and nothing is
  baked. A recompile (below) shows the stand-in again for as long as it takes. A
  `ChunkStack`'s meshes likewise stay hidden until theirs are ready. The stand-in and the
  void's cliffs (`bakeSkyCliffs`) are compiled the same way, the stand-in first.
- `onProgress` tells a host how far it has come: its shaders compiled of those it waits
  for, and its relief tiles loaded of those wanted, for a progress display (see
  [progress.md](./progress.md)).
- ⚠️ Never draw with a program before it is ready. Chrome's GPU process then waits for it
  on its main thread, which draws every tab and the browser itself, so the whole browser
  freezes; and the wait is behind every compile queued before it. Measured: 3.4 s for the
  cliffs' small bake drawn at once, and still ~1 s for a host's `MeshBasicMaterial` drawn
  while the sky's compiles fill all 19 of Chrome's compile threads.
- So `precompile` keeps only a few programs compiling at once (`PRECOMPILE_SLOTS`, 4 on
  a 20-thread laptop), the rest queued: the stand-in first, the scene's own content next,
  the sky's own programs and stages after, and what only bakes last
  (`PRECOMPILE_PRIORITY`). Measured fully cold: a host's material drawn while the sky
  compiles waits ~0.25 s instead of ~1 s, the Direct3D compiling takes 22 s instead of
  39 s in all (less contention), and the sky shows at 64–67 s instead of 84 s. ⚠️ That is
  still late: the background takes ~23 s alone in Direct3D's compiler, fully cold.
- Why it was slow: the background was one program for every zone and feature, and
  Direct3D's compile time grows about as a program's size to the power 2.5. Measured on
  its HLSL with `D3DCompile` itself (2026-10-27): the abyss and its walls (since removed), the sea from the
  air, the still clouds (since removed) and the view in the water were each a third to two
  thirds of it. First,
  with no change to what is drawn: loops whose count Direct3D would copy out per iteration
  take it from a uniform (`uOceanDetailOctaves`, `uSkyPlanetCount`), the seabed is shaded once for the views from the air and in the water
  (`skyOceanBedReach`), and the walls' two rock tests shared one copy of their shape:
  ~30% faster (320 → 244 KB of bytecode), a stage's surface
  ~35% and the sea surface layer ~42%.
- Then the background was split into its layers (see [Rendering](#rendering)), each
  compiled on its own and in parallel. Timed one at a time with `D3DCompile` (RTX A1000
  laptop, 2026-10-27): the one program took 19.5 s; its layers take the sky 0.8 s, the
  still clouds 1.2 s (since removed), the sea from the air 1.2 s, the void 2.3 s and the view in the water 2.3 s,
  7.8 s in all. The longest compiles are now a stage's surface (3.4 s) and the sea surface
  layer (2.3 s). Fully cold, every program at once, ReliefTiles shows its scenery at
  16 s instead of 68 s (84 s before either step). The layers the camera's zone draws
  compile first (`PRECOMPILE_PRIORITY.background`), the others after them (`later`).
- Drawn as layers the background costs what it did as one program: the same work, split,
  and what a zone cannot show not drawn at all. Measured A/B/A/B on StageDebug (RTX A1000
  laptop, GPU ms, the background's draws, two runs each): 40 m 2.0–2.35 → 2.1, 2 km 0.5 →
  0.5, 100 km 0.3–0.4 → 0.4; in the water (2.3–3.1 → 2.0–2.9) and below the seabed
  (2.2–6.6 → 4.4–6.5) the runs differ more than the two do. The frame likewise, 6–12 ms
  either way.
- The first frame that draws the background or a relief still stalls ~0.15–2 s
  (measured, fully cold): the driver's own compile, after Direct3D's, which nothing in
  WebGL can do ahead.
- The bakes draw with one small program of their own (`scenery-bake-fragment.glsl`, 37k
  characters with the sky's gradient it includes), compiled first: none of the background's
  programs, and no copies of them. Until 2026-11-18 they filmed the background's layers,
  sharing their programs only within a `RenderingPipeline` and with the same lights, and
  otherwise compiling copies after what was drawn.
- The textures and volumes drawn once on the GPU (the hollow's rock and cliffs, the clouds'
  cover volume) call their heavy function from one loop (the five taps of a gradient, the
  masses' warp) and take their loop counts times a uniform `uLoops` / `uCoverLoops` of 1
  (`bakeTexture` sets `uLoops`), so Direct3D keeps them as loops. Same arithmetic, so the
  same result to 7e-5 or better. Measured 2026-11-19 (RTX A1000; the Timelapse's own
  programs, each alone and fully cold: Direct3D's compile and the driver's, Chrome's GPU
  process held to the performance cores), compile → and GPU per draw: rock 5.9 → 1.4 s
  (16.9 → 11.7 ms, once), cliffs 2.4 → 0.6 s (17.5 → 7.1 ms, once), a cover slice 1.6 →
  0.7 s (0.45 → 0.46 ms); the scenery's 36 programs 47 → 40 s in all.
- ⚠️ The uniform loop count is a Direct3D workaround: elsewhere it only turns the loop into a
  run-time loop, which can draw slower, and a material that leaves the uniform unset (0)
  runs none of its turns. Kept to what is drawn once, and only for a clear gain. Declined:
  the cover's scales and cells as loops (a slice 0.45 → 0.61 ms, 32 a frame for 8 frames),
  the cover's sampler (1.9 → 1.6 s for 0.3 ms more), the weather's wind (0.7 → 0.6 s for
  17% more of its drawing) and the cloud maps' passes (no gain).
- The haze's colours come from a lookup drawn per camera place (`SkyAirColors`, see
  [The air](#the-air)) instead of the sky worked out three times a pixel in every program
  that hazes. Measured 2026-11-20 (RTX A1000, the Timelapse's programs each alone and cold,
  the GPU process held to the performance cores): the clouds' march 5.9 → 4.7 s, their bake
  2.0 → 1.2 s, the relief 2.1 → 1.3 s (seen from below 1.2 → 0.9 s), the surface layer 4.6 →
  3.9 s, the sea layer 2.9 → 2.5 s, a stage's surface 6.6 → 6.3 s. Its own pass compiles in
  0.13 s and draws in 0.007 ms, with 0.06–0.12 ms of CPU a frame for its checks and the
  redraw. Its colours match the sky's within 0.23 % (mean 0.05 %), sun hours 6–20.5, from
  the sea to 2000 km up. Of the draws that read it, a stage's surface took 13 % less and the
  sea layer 5 % less (40 m over the sea at 17:30, two rounds each); the frame as a whole
  differed by less than its run-to-run noise (±1 ms).
- ⚠️ ANGLE on Direct3D compiles a program's pixel shader for one colour attachment,
  and again at its first draw into several. `OITRenderPass` draws into several with
  `mergeFront` or `tailSlices`, so the first frame that shows a stage's see-through
  parts still stalls (~1.6 s for its surface, measured cold). Without either, nothing
  stalls.
- Adding or removing a feature compiles or drops only its own layer (see
  [Rendering](#rendering)); the seabed's `detail` and the sea's wave count recompile the
  sea's layers and its stages; `background: 'void'` the sky's own; and a stage recompiles
  when `seabedOpacity` crosses 1 (its seabed turns see-through, `STAGE_SEE_THROUGH`).
  Every other option only changes uniforms. While a layer compiles the stand-in is drawn
  in place of the whole background, for that layer's compile alone.
- The bakes run only when the sky changes, never as the camera moves, and swap
  per zone at a level crossing.
- Shimmering rays, the waves and the cutaway are uniforms updated per frame.
- Below the sea surface the surface layer is not drawn, and below the seabed (with one)
  neither is a stage's surface: each would discard every pixel there. Under an
  `OITRenderPass` that saves more than the draw: with nothing else see-through in view the
  pass skips its transparent passes too (FieldColumn: 8.3 → 5.5 ms inside the column,
  9.8 → 6.2 ms below it).

### Frame cost by zone

GPU ms per frame (median of 120), measured with `videx3d.profile()` in Storybook on an
Intel Iris Xe laptop at 1.04 megapixels, sun at 11:00, clock paused, while the sky still
drew first, before the two layers above were skipped, and while the background was one
program (its layers since: see [Rendering](#rendering)). The sky's draws are
fill-bound: they scale with the pixels drawn, about double at 1080p.

`Scenery` Timelapse (R3F's own render, relief on); the surface layer adds 0.16–0.18 in every view:

| Camera | Frame | Background | Stage's sea | Stage's seabed | Relief |
|--|--|--|--|--|--|
| 40 m | 8.2 | 2.5 | 3.85 | 0.87 | 0.78 |
| 2 km | 7.6 | 2.4 | 2.9 | 0.82 | 1.28 |
| 100 km | 5.9 | 2.3 | 1.76 | 0.03 | 1.64 |
| −30 m, in the water | 7.0 | 3.54 | 1.56 | 0.89 | 0.73 |
| −500 m, below the seabed | 4.4 | 2.45 | 1.02 | 0.78 | 0.07 |

`FieldColumn` WithScenery (Volve as the occupant, an `OITRenderPass` pipeline, no relief):

| Camera | Frame | Sky off | Background | Stage's sea | Stage's seabed |
|--|--|--|--|--|--|
| 2 km | 9.2 | 5.3 | 1.43 | 2.84 | 0.81 |
| 40 m | 8.4 | 5.05 | 1.39 | 2.62 | 0.39 |
| −40 m, in the water | 8.4 | 5.5 | 2.34 | 1.39 | 0.40 |
| −1.5 km, inside the column | 7.4 | 5.4 | 1.87 | 0.83 | 0.59 |
| −6 km, below it | 8.45 | 5.6 | 1.33 | 1.55 | 1.05 |

- A Timelapse frame takes 1–1.3 ms on the main thread, everything included. A frame
  that bakes (1 in 8 with the clock running) costs about 3.6 ms more GPU and 4.4 ms more CPU.
- The relief costs 0.3–0.7 ms net (the stage's seabed draws where it does not). The far
  plane does not change it: the relief reaches at least 2000 km either way.
- What a zone draws for nothing, from hiding each draw and comparing the frame: below the
  seabed the stage's sea and the surface layer change no pixel (now skipped), and without
  an occupant neither do the stage's seabed and the relief; in the water the background
  changes under 1% (the stage's sea seen from below and its seabed cover it); inside the
  column no sky draw changes a pixel. The background then drew first, so it was shaded
  under everything that covers it, in every zone.
- Drawn after the scene instead, the same pixels, the background costs (FieldColumn,
  ms) 1.47 → 0.51 from 2 km, 1.44 → 0.85 from 40 m, 2.33 → 1.73 in the water (the
  stage's sea seen from below writes no depth, so the background is still shaded behind
  it) and 1.6 → 0.1 below the seabed; the frame 0.5–1.2 ms less.
- Under a surface that hides it whole (`skyOceanSurfaceHides`: from 5 km up, or past the
  detail fade, with the water on and no cutaway) the stage's seabed skips its shading and
  only writes its depth, so what lies under it stays hidden as before. The pixels are the
  same within 1/255; on the sea bench (2026-11-12, NVIDIA A1000, 1920 × 1080) the seabed draw
  went 1.55 → 0.66 ms at 20 km, 2.09 → 0.79 at 100 km and 1.95 → 0.61 at 1000 km, and was
  unchanged at 300 m and 2 km. What is left is its reach and the stage's tests. A stage whose
  surface is hidden (`debug.hide`) compiles its seabed without the skip.

### The void

Under the lid the background shades no sky at all: the void covers all of it. From below,
a stage's flat seabed shades no sea floor (only seen from above). Measured with the void's
walls, since removed (2026-11-03), on StageDebug, the sea and seabed on, 210 spheres, Iris Xe
at 1.92 megapixels, they cost 0.5–2.5 ms a frame below the lid: their mesh, which wrote its
depth and so had no early depth test, and their haze's sampling on the seabed (about 1.3 ms).

## Debugging

`<Scenery debug={...}>` tints each part by what draws it (`tint`), hides layers (`hide`: each
of the background's by name, and all of them as `background`) and shows the environment's
bake for the zone in view (`environment`). `<SceneryStage debug={...}>` hides stage layers,
and draws its outline and wireframe over everything.
None of them rebuild or bake anything.

The Storybook stories `Spikes/Scenery/StageDebug` (a stage of any size, synthetic ground under
it, an optional occupant's outline and stand-in spheres, every option and debug view) and `Spikes/Scenery/Baseline` (a real field) exercise all of it. Every
story drawing a `<Scenery>` takes its controls from one module,
`src/storybook/components/scenery-controls.ts`, so a control has the same name everywhere: the
basic ones show in every story, the advanced and debug ones only in `StageDebug`
(`sceneryArgTypes({ debug: true })`), keeping their defaults elsewhere. Their features come
from one component too (`SceneryArgsFeatures`): the sea, the void, the graticule, the cutaway
and the clouds, a sky preset (`clouds`, `clear` by default but in the Timelapse, `fair`) at a
quality (`cloudsQuality`), in every story; the Clouds story builds its own weather and leaves
the shared preset out.

## For maintainers

| File | Role |
|--|--|
| `Scenery.tsx` | the component: props and its features' → material, the layers and which are drawn each frame, the directional light, the bakes |
| `SceneryOcean.tsx`, `SceneryAbyss.tsx` | the features: each hands its props to the `Scenery` (`scenery-registry.ts`) |
| `SceneryClouds.tsx`, `scenery-clouds.ts`, `shaders/cloud-*.glsl` | the 3D clouds, which draw themselves and read the scenery's material and `SceneryView` from its registry ([clouds.md](./clouds.md)) |
| `SceneryCutaway.tsx` | the cutaway: its props, its grip, and its per-frame placement, which the `Scenery` runs |
| `scenery-layers.ts` | the background's layers: their order, defines, materials, and where each can show (`sceneryLayersShown`) |
| `scenery-model.ts` | option types, defaults, and the pure rules (`sceneryZone`, `skyDaylight`, `skyMoonlight`, `skySunColor`, …) |
| `scenery-material.ts` | `SceneryMaterial`: the sky's own layer, the uniform objects every layer shares, and the switches they compile with |
| `sky-star-catalogue.ts`, `sky-moon.ts`, `textures/moon.jpg` | the observer's stars as the shader's textures, and the moon's albedo map (each loaded in its own chunk) |
| `scenery-baker.ts` | bakes the environment and light probe per zone (internal) |
| `shaders/scenery-bake-fragment.glsl` | what the bakes film in each zone: the air, the water, the subsurface |
| `scenery-stage.ts`, `SceneryStage.tsx` | the stage's geometry and materials |
| `SceneryStageReliefTiles.tsx`, `scenery-relief-tiles.ts`, `SceneryStageReliefOverview.tsx`, `scenery-relief.ts`, `scenery-relief-atlas.ts` | the relief: its tiles, and its overview past the far plane, read from the same tiles through an index (see [tiles.md](./tiles.md)) |
| `scenery-defs.ts`, `generators/scenery-relief-tile-generator.ts` | the `sceneryReliefTile` generator: the relief's tiles, for the stage, its overview and the `Minimap` |
| `scenery-context.ts` | `useScenery`, `useSceneryOcean` |
| `shaders/sky.glsl` | the background's layers: `skyAir`, `skyAbyssLayer`, `skySeaLayer`, `skyWaterLayer`, and the sky and void they draw |
| `shaders/sky-fragment.glsl`, `sky-layer-fragment.glsl` | the sky's layer, and the others over it (one by its `SKY_LAYER_*` define) |
| `shaders/sky-gradient.glsl` | the gradient alone |
| `scenery-air-colors.ts`, `shaders/sky-air-colors.glsl`, `sky-air-colors-fragment.glsl` | `SkyAirColors`: the colours the haze fades into, drawn per camera place into a lookup, and its readers |
| `shaders/sky-void.glsl` | the void's gradient alone: its colours, the depths' gradient, and the whole of it as the stand-in and `background: 'void'` draw it |
| `shaders/sky-stand-in-fragment.glsl` | the stand-in drawn while the sky compiles: the void's gradient |
| `shaders/sky-ocean.glsl` | the sea: surface, water, seabed, cutaway |
| `shaders/stage-fragment.glsl`, `sky-surface-fragment.glsl` | the stage's parts, and the sea surface layer |

- The layers', the stage's and the baker's materials share the `SceneryMaterial`'s UNIFORM
  OBJECTS, so they follow every change to it (the baker's but for its own and the field's
  light, `SceneryBaker`'s overrides). Its features are `switches`, not its own defines: each
  layer takes those it needs (`sceneryLayerDefines`), a stage those listed in
  `SCENERY_SHARED_DEFINES`.
- ⭐ A program is keyed on its defines' order, the `fog` flag and the number of lights
  as well as on the source. `linkOcean` and the feature switches are set in render, so the
  layers and a stage's materials are made with them.
- The layers' shaders return their colour premultiplied (its alpha how much of the layers
  before it it hides), and `sky-layer-fragment.glsl` draws it unpremultiplied, so three's
  tone mapping, colour space and fog apply as to any colour. Where the sea's floor shows the
  void, the void's layer and the sea's take the same tests (`skyOceanShowsVoid`,
  `skyOceanFromAirReach`), so the void is drawn under exactly the sea that lets it show.
- Compiling ahead goes through `precompile` (`src/rendering/precompile.ts`, internal):
  it compiles as the scene draws, i.e. for the `RenderingPipeline`'s render target and
  through the `OITRenderPass`'s variants, each object when its turn in the renderer's
  queue comes (see Performance). The sky waits for its own meshes, the stages
  registered through `SceneryOceanState.stage`; the bakes for their own program and the PMREM
  prefilter.
  The 1 × 1 target it binds for `'offscreen'` is kept on the renderer itself: kept in a
  `WeakMap` keyed by the renderer, its framebuffer led back to the renderer (its context, its
  canvas, three's context-lost listener) and no unmounted `Canvas`'s renderer was let go.
- Letting go goes through `releaseMaterial` (same file, internal) wherever a material is
  replaced or unmounted while the scene draws — the sky, its layers and stand-in, the
  baker's own, a stage's, the relief's, a chunk's and a stack's sea. A material disposed
  while its program still links (`KHR_parallel_shader_compile`) makes Chrome warn
  "glGetProgramiv: Program object expected" once per program as the link finishes, from
  its own GPU process, so no JS hook sees the call (12 of 12 disposed mid-link warned, 0 of
  12 disposed once linked, 2026-11-02). It waits for the link, and for every compile queued
  before it to start, so a replacement queued in the same render takes the program over
  instead of compiling it again (three gives a source that went and came back a new id). Its
  `linger` keeps it longer for a replacement made later: a chunk's, whose rebuild lets the
  old one go first (`CHUNK_MATERIAL_LINGER`).
- The water lies on one mesh (`createSceneryStagePlane`): the box holding the `boundary`
  (`boundaryBox`) as a 4 × 4 grid, then rings
  each about twice as wide as the one inside, out to the far plane. The flat parts are
  shaded at the ray's exact hit, so their triangles only need to grow with their distance
  from the scene: ~1000 km triangles crack where the GPU clips them. Without a relief the
  flat seabed lies on the same mesh; with one, the relief's tiles are the seabed.
- Below a `seabedOpacity` of 1 the seabed parts compile with `STAGE_SEE_THROUGH`:
  transparent, without depth writes, and with the seabed's opacity as their alpha rather
  than mixed toward the void behind them.
- The cutting occupant's `cut` compiles into the relief's material as
  `RELIEF_CUT_OCCUPANT` with `RELIEF_OCCUPANT_SECTION` / `RELIEF_OCCUPANT_FENCE`, bound
  with `applyFenceField` as every fence-cut material is, and applied inside its outline
  only. The relief's uniforms INHERIT the sky's (`Object.create`) rather than copy them,
  so what the sky adds later still reaches them. The discard waits until the
  derivatives are taken.
- ⭐ On Direct3D (ANGLE), every call of a shader function compiles a copy of it. A heavy
  function (the waves, a noise) called from two places costs twice the compile time:
  compute it once and pass the result down (see `SkyOceanWave`, `depths` in
  `skyAbyssLayer`).
- ⚠️ Derivatives (`fwidth`) taken after a branch some pixels of a quad have left are
  undefined: take them first, before any early return (see `skyOceanCutawayRimAt`).
