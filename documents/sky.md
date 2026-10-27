# Sky

The `<Sky>` component is a procedural sky: a background that shows where the horizon
and the sun are, and the light that comes from it — a directional sun light, an
environment map and a light probe, all from the same sky. On top of that it can draw
an endless sea with a seabed, a void below a level, clouds, a moon and stars, and a
cutaway through the water in front of the view.

Every part can be switched off, and nothing else in the library depends on the sky:
components that react to the sun read it with `useSky()` and fall back to their own
settings without one.

## Basic usage

```tsx
import { Sky } from '@equinor/videx-3d'

<Sky sun={{ azimuth: 200, elevation: 35 }} />
```

`azimuth` is a compass bearing in degrees (0 = north, 90 = east) and `elevation` the
degrees above the horizon. The compass is set by `up` (default `[0, 1, 0]`) and `north`
(default `[0, 0, -1]`, which is what `CRS.utmToWorld` gives).

To place the sun from a date, an hour and a place, use `solarPosition` from the SDK
(NOAA's approximation, within about half a degree):

```tsx
import { Sky, solarPosition } from '@equinor/videx-3d'

const sun = solarPosition(new Date('2024-09-10T12:00:00Z'), 58.44, 1.89)

<Sky sun={sun} />
```

The sky's colours (`colors`: zenith, horizon, ground, nadir) are display colours: the
sky reproduces them exactly without tone mapping. `intensity` scales the whole sky —
background, environment and light probe alike.

## Sun, moon and stars

The sun is a disc (`size`, an angular radius in degrees) with a broad halo (`glow`, full
down to about 3° below the horizon and gone with the twilight by 12°), a
bright glare hugging the disc (`glare`, default 0.5) and, optionally, rays around it
(`rays`, default 0). `shimmer: true` lets the rays brighten and fade slowly, each on
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
its light is red), clouds toward the sun go dark with bright linings, those away from it
catch the light, and a faint pink belt rises opposite; `twilight` scales it all (default
1, 0 for none). The sea reflects it, with a broad glitter path under the low sun
(`OceanMaterial.sunGlintSpread`), and the bakes see it.

`moon` (default on) is a full moon opposite the sun, so it is up at night. The sky has
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
  phase and the tilt of its lit side come out on their own, with faint earthshine on the
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
first time an observer is set: a `Sky` without one never loads it, and until it is in, the
procedural stars show.

The astronomy is in the SDK, free of three.js: `julianDay`, `localSiderealTime`,
`equatorialToHorizontal`, `precessFromJ2000`, `lunarPosition`, `planetPosition` and
`brightStars`. `scripts/generate-bright-stars.js` extracts the catalogue (from CDS, or a
local copy) into `src/sdk/utils/bright-stars-data.ts`, 6 bytes a star.

The catalogue: Hoffleit, D. & Warren, W. H. Jr. (1991), *The Bright Star Catalogue, 5th
Revised Ed.*, Astronomical Data Center, NSSDC/ADC; CDS catalogue V/50.

## Clouds

`clouds` (default on: a thin band along the horizon) adds still clouds, lit by the sun, or
the moon at night: a deck seen from below, and a band of distant ones along the horizon (see
below):

```tsx
<Sky clouds={{ layers: 'both', coverage: 0.5, altitude: 6000, scale: 4000, seed: 3 }} />
```

`coverage` is how much of the sky they cover (0 for none; below 0.2 they thin out fast),
`altitude` the height of their base, `scale` the size of the clouds and `softness` the
width of their edges; `seed` picks another pattern. `opacity` (default 1) is how much they
stand out from the sky behind them, for a softer look; the sun, moon and stars stay hidden
behind them as if opaque, and only from 0.5 down less so. They fade into the haze toward the
horizon. Close up the deck would show it is flat, so it fades out from about 0.7 of its
altitude from the camera, gone by 0.3. Its own pattern breaks up that distance, so wisps go
before cores and the fade has no clean edge: from sea level nothing fades, and climbing to
the deck clears it from overhead out toward the horizon.

A flat deck shows no parallax: climbing only zooms it, moving only slides it, so it reads
as a painted ceiling. Two cheap departures from the plane give it depth. The deck lies on
a sphere about the Earth's centre, the globe's radius plus `altitude` (`SKY_EARTH_RADIUS`
without a frame; with one, the Earth's there, as the globe has it), so it
bends down toward the horizon and is not squeezed into streaks there; it costs a square
root more than a plane. A tighter dome looks curved further up but puts the horizon a
finite distance away: clouds then slide over its rim as the camera moves instead of
shrinking into the horizon.
`thickness` (world units, default 1500; 0 for a sheet) makes it a slab: each cloud's
thicker parts are looked up further along the view ray, so they shift against its outline
as the view moves. The shading is the same either way. Marching the slab for real sides
was tried and dropped: a 2D pattern on a vertical wall streaks, and its silhouettes cut
hard.

### The band on the horizon

`layers` picks what is drawn: `'deck'`, the deck alone out to the horizon; `'band'` (the
default), only a band of distant clouds along the horizon; or `'both'`. Switching is instant.

The band is fixed to directions, as the stars are: its clouds are `bandDistance` off (default
75 km) and more, so the camera's moves barely shift them. That is what clouds near the horizon
do, and it is where a deck, flat or not, gives itself away: squeezed into streaks that slide as
the camera moves. Its nearest clouds have their base at `altitude` and their tops up to
`thickness` above it, seen side-on: 4.6° and 5.7° from sea level by default. Below that base,
ever further ones overlap densely down to the horizon; above it, their tops vary. They are as
wide as clouds of `scale` look at that distance and as tall as ones of `thickness`, so a higher
`altitude` raises the band and fills it with more of them rather than stretching them. They
take the same `coverage`, `softness`, `opacity`, `color` and `seed` as the deck's, and are lit
the same way (both share `skyCloudColor`). The band melts into the air's haze over its
distance, so it clears as the camera climbs and thickens toward the horizon. Climbing, it goes
down with the horizon as the Earth's curve lowers it (see The globe); on a flat sea
(`globe: false`) it stays on the horizon. With the curve it also squashes onto
the horizon as far as its tops would sink seen from the camera's height: as clouds
`bandDistance` off, and from over them as their layer's own horizon. By default its tops stand
5.7° over the horizon up to about 1 km, 3.5° at its base's height, 1.2° at 15 km and 0.4° at
100 km, its clouds flattened with it. Its clouds also flatten a little, quickly at first and
then hardly at all, and it stays in view above the deck. From 100 km up it fades out, gone by
250 km: from there it would rim the whole globe.

With both, the deck is drawn along each view ray turned down, by the hinge over the horizon and
not at all straight up, so that its own horizon sits at the band's base, where the deck is at
the band's distance: it never crosses the band. Where the view runs within about 9° of parallel
to it, it dissolves, wisps first, rather than being squeezed toward that line.

The numbers are fixed (`SKY_CLOUD_*` in `sky.glsl`). Tried and dropped along the way:

- narrowing the band's clouds as the camera climbs: a ring of directions can only gain
  clouds by sampling a new pattern, which churns;
- squashing the band onto the horizon at a rate set by hand as the camera climbs, and sinking
  it linearly: both read as the band moving with the camera (its squash now follows where its
  tops would show, and barely starts below a few kilometres);
- sinking it on a flat sea as the camera climbs, by up to 1.5° (removed 2026-10-26, with the
  globe of world.md step 2): the curve lowers the horizon itself;
- a soft warp of the deck down to the real horizon instead of the hinge;
- rings or rows of clouds between band and deck, at distances of their own, each shifting at
  its rate: cardboard cut-outs.

Turning `clouds` on or off recompiles the sky. To switch them often, keep `clouds` set
and toggle `enabled` instead: they stay compiled in, so it is instant, and while hidden
they cost a single branch.

The sun shows through all but the thickest parts: a softened disc through thin cloud,
a glow around it and bright silver edges where cloud thins in front of it. The moon does
the same at night; the stars are hidden. The moon takes over as the sun's light ends
(−6°) and fades in as the scene's moonlight does, so the hand-over shows nothing. When the
output is tone mapped, the sunlight on them is doubled (`SKY_CLOUD_HDR_SUNLIGHT`), as the
sun's disc is brightened: at noon their sunlit parts would otherwise be only 1.5 times the
sky's brightness, and tone mapping squeezes them into it. Their shaded sides and moonlight
are left as they are.

⚠️ `altitude` is measured along `up` from the world origin, not from sea level. The
clouds are part of the background only: the water does not reflect them, and they do
not dim the scene's light.

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
<Sky air={{ scaleHeight: 8000, visibility: 60000, haze: 0.75, hazeHeight: 1500 }} />
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
turns all of it off.

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
it as before. The sea reflects the sky as seen from the sea. From over the clouds' tops, the
band's clouds are lit from above: white, or warm at twilight, instead of their shaded
undersides.

On the globe, the sun sets later the higher up: from 20 km it is still up
4.5° below the level. So the sky's own light (its daylight, twilight and moonlight, the sun's
colour, when the stars come out) goes by the sun over the horizon where it is seen: the
camera's for the air above it, the sea's for the air low along the horizon, in between by
height for the clouds (`SkyMaterial.setAirLight`, from `Sky` each frame). From high up the air
around the camera stays lit after the sea's sunset, over a horizon already in twilight. The
sea, the scene's light and the bakes keep the sea's light.

The bakes film near the level, so the scene's light does not change with the camera's
height. The sea's surface is hazed; the seabed seen through cut-away water is not.

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

The deck of clouds is not drawn from above it and the band is gone above 250 km, so from
space there are none (3D clouds would change that). Below 100 km nothing changes. A
physical atmosphere (scattering tables) is left for the 3D clouds' work.

## The globe

`globe` (default on) lets the sea, the sky and the clouds follow the Earth's curve
(`SKY_EARTH_RADIUS`, or with a frame the Earth's radius there, 6385.6 km at Volve in the
map's units; the sky and its clouds take the globe's since 2026-10-26): as the camera
climbs, the horizon drops below the level by about
√(2h/R) — 0.2° at 40 m, 1° at 1 km, 4° at 15 km — and from high up it bows across the
view. The sea ends at it, its waves tipped with the curve so that the view grazes them there
and they reflect the horizon's colour. The sky's gradient, its twilight and the haze's colour
are measured from it, the sun, moon and stars set behind it rather than at the level, and the
clouds' band sits on it, squashed onto it from high up. The water reflects the sky as seen from
where it lies, with its own level horizon: far out, where the sea is tipped with the curve, a
wave's reflection is turned by that tilt onto the up the sky is seen by (`globeTurnFrom`):
turned into the field's frame instead, far round the Earth it fell below the camera's
horizon, and half the sea went dark at sunset. Off, every one of them is as on a flat sea:
right for one field seen from near it, but far from it the horizon never drops and the
relief and anchored content stay flat. It is kept for comparison and for a host that needs
a level horizon. Step 4 has the sky's look frame follow the camera instead
([world.md, step 4](./world.md#12-step-4-in-detail-the-sky-anywhere-on-the-globe)).

The waves are drawn in charts fixed on the Earth (`SkyMaterial.oceanCharts`, an sdk
`OceanCharts`): the field's wave plane out to 1000 km, past it 162 stereographic charts, so
far round the Earth they lie on the sea there instead of on the field's plane seen edge on,
keep the wind's compass bearing, and are as sharp as over the field. Where two charts meet
the waves calm over a strip 8 km wide. A point's waves depend on the point alone, not on
where the camera came from, for waves driven by data later
([world.md, 4d](./world.md#4d-the-waves-far-off-built-2026-10-27)).

The Earth is a fixed globe (`SkyMaterial.globe`, an sdk `Globe`; see
[world.md](./world.md#9-step-2-in-detail-the-sky-on-a-fixed-globe)): a sphere whose centre
lies fixed below the scene, its cap over a disc about the scene — the one holding a
`SkyBoxStage`'s `bounds` — cut flat, so what meets the water there meets it level. The plane
and the sphere meet on the disc's edge, at an angle of `r / R` (0.1° for a 16 km stage);
without a stage the disc is a point at the world origin. Every point of the sea has one
place whatever the camera does: nothing rises or sinks as it moves. Heights are over the
globe — far from the scene scene Y is not altitude: at Y = 40 m, 200 km off, the camera is
3 km over the sea — and so is up, which far off tilts from the scene's (1.8° at 200 km).
The camera's controls keep the scene's up, so there the horizon rolls a little, and round
the Earth it stands on end: `useLevelHorizon()` levels it, by the camera's up
([world.md, 4e](./world.md#4e-a-level-horizon-for-a-host-built-2026-10-26)). How low a
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
(`SkyMaterial`'s `claimStage`): off it, its sunk planes would miss some of what it
claims, and a point on the far side would project back inside it. The void and the subsurface, the views from in
the water and below the seabed, and the bakes stay flat: the bakes film a level horizon, as
a few degrees barely change the light, so climbing never bakes. Switching it only changes a
uniform; it costs about a square root per pixel.

What is drawn flat beyond the disc goes onto the globe with a `SkyAnchor` (about a point,
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
the sky's diffuse light from each.

The bakes are made once for each zone the camera can be in — the air over the sea, the
water in it and, below the seabed (or the abyss level), the `subsurface` — and swapped as
the camera crosses a level, so a moving camera never bakes. In the water the light dims
with depth. The subsurface is baked first: its program is small and compiles on its own,
so the scene is lit by it within moments, and a zone not yet baked borrows its maps until
its own are swapped in. It is baked again only when its own inputs change (its panels or
map, the frame, the environment's resolution), never with the sky.

The sky is baked again when it changes, once it has been still for `capture.interval`
(default 250 ms): a slider being dragged bakes nothing on the way, so the sky follows it at
once and only the light it casts waits. A sky that keeps changing (a timelapse) is baked
at least every `capture.maxWait` (default 1000 ms). The scene's light probe eases toward
each new bake of its zone over a fraction of a second, so the light does not step as the
sun moves; another zone's is swapped in at once. The environment map is swapped in.

`subsurface` is the light where the sky's own means nothing: below the seabed, and
wherever the sky is not drawn (`background: false`, or `'void'`). By default it is a dark backdrop
with soft light panels above and below the horizon (`panels`, see `SkySubsurface`); give
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
<Sky subsurface={{ light: { followSun: true, elevationRange: [25, 55], transition: 0.5 } }} />
```

`background: false` hides the sky (and its stage) instantly: nothing is rebuilt or baked
again, and the scene stays lit, by the subsurface.

`background: 'void'` draws the void's grey gradient in the sky's place, the very gradient
the stand-in shows while the sky compiles: the lid's colour overhead fading to the
horizon's, and the depths' below, measured from the horizon the Earth's curve lowers, so
from high up it meets the far ground's haze without a seam. There is no air, sun, moon,
stars or clouds (all compiled
out, `SKY_VOID`, so the background is cheaper too). The void itself, its walls, a stage
and a sea are drawn as ever; with neither water nor a seabed it is the void all round.
The scene is lit by the subsurface everywhere, as with `false`, so only its zone is baked.
Changing to or from it recompiles the sky.

```tsx
<Sky background="void" abyss={{ walls: true }} ocean={{ water: false, seabed: false }} />
```

## The endless sea

`ocean` adds a sea: a wavy surface at `level` over a flat seabed `depth` below it, seen
from above, from inside the water and, below the seabed, as the void.

```tsx
<Sky ocean={{ level: 0, depth: 100, windSpeed: 10, waterOpacity: 0.8 }} />
```

The water takes the `<Ocean>` component's props under the same names (see
[Ocean](./ocean.md)), so one object can drive both; the sun and the reflected sky come
from the sky. `water: false` leaves the seabed dry; `seabed: false` leaves the void
below the water, seen through it from above, while from the void its lid is still a roof,
as under a seabed. Far off, over the waves' `detailFadeDistance`, and everywhere once the
camera climbs from 2 to 5 km over the sea (`SKY_OCEAN_OPAQUE`), the water turns opaque
whatever its `waterOpacity`, so from high up the seabed no longer greys the sea; close to it
the water stays as see-through as set. `seabedOpacity` (default 1) lets the void, or the scene under a stage's
seabed, show through it. Each of these only changes uniforms, except that crossing a
`seabedOpacity` of 1 makes a stage's seabed materials again (see Performance). The
seabed's look (`SkySeabed`) is lit with the model and options of a
`ChunkMaterial`, so a chunk layer given the same colour and detail continues it without
a seam.

The sea never tints the data: a `Chunk`, `ChunkStack` or `Surface` is drawn as it is,
wherever it lies. A field column whose top is the sea bed hands that seabed to a stage
instead, which draws it as the sea's own (see below).

The sea is part of the background, so on its own it never hides anything in the scene.
To have the water in FRONT of the scene, add a stage.

Floating children work as inside an `<Ocean>`: while the sea has water, `<Sky>` provides
the wave sampler (`OceanSamplerContext`) and the contact-foam registry
(`OceanContactContext`) to its children, so a `<Tanker>` — or anything using
`useBuoyancy` and `useOceanContact` — rides the sky's waves and leaves a foam collar on
its surface. Heights are absolute, the sea level included. ⚠️ Assumes the default `up`
(+Y).

## SkyBoxStage

`<SkyBoxStage>` puts the sky's sea and seabed on real geometry between the scene and the
background, drawn with the sky's own shading so the two meet without a seam. Being
geometry, the water lies in front of what is under it, and the seabed hides what is
below it at the sea's `seabedOpacity` — unless the camera is below it too. It reaches the camera's far plane
beyond `bounds`, so every view ray that can reach the scene crosses it. With the sky's
`globe` it stays flat but shades the sea beyond the disc holding `bounds` on the
globe (see The globe).

```tsx
const relief = { frame: geoFrameFromCrs(crs), layers: [{ id: 'etopo-2022-nordic' }] }
const [cut, setCut] = useState<CutUniforms | null>(null)
const [ground, setGround] = useState<HeightFieldClip | null>(null)
const [sampler, setSampler] = useState<ReliefSampler | null>(null)
const [stage, setStage] = useState<SkyBoxStageOccupantState>({
  seabed: false,
  seabedOpacity: 1,
  water: false,
})

<Sky ocean={{ level: 0, depth: 120 }}>
  <SkyBoxStage
    bounds={[minX, minZ, maxX, maxZ]}
    occupants={[{ outline, cut: cut ?? undefined, onStage: setStage, onGround: setGround }]}
    relief={{ ...relief, onSampler: setSampler }}
  />
</Sky>
<ChunkStack
  outline={outline}
  seabed={meta.id}
  relief={reliefSource(relief, { level: 0 })}
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

`bounds` is the scene's rectangle in scene X/Z, and should hold the whole scene.
`occupants` claim parts of it — typically field columns. The sky's sea is global: its
`water`, `seabed` and their opacities hold over the occupants as everywhere else.

Without a `relief` the stage's seabed is flat, at the sea's depth, over everything: the
occupants draw their own seabeds, and the flat one lies under them too. With one, the
relief is the seabed everywhere, the occupants' ground included (see
[Relief](./relief.md)), and the bridge to a `ChunkStack` comes in three parts
([tiles.md](./tiles.md)): the stack builds its sea bed on the relief (`relief`, from
`reliefSource`, derived from the very props the stage is given), ends its faces where the
relief is drawn (`clip`, from the occupant's `onGround`), and answers what is placed on
its top from the relief (`reliefSampler`, from the relief's `onSampler`). Give the
sampler through `SurfaceSamplerContext` to what stands past the column, too.
`applyGlobe(material, globe)`, with the sky's globe (`useSkyOcean()?.material.globe`),
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
  for one occupant at most, and the sky draws the void's walls through the opening.
- `anchor` is the occupant's own group, drawn outside the `Sky`, which the stage places
  on the globe about the outline's middle (see `SkyAnchor`): over the disc, where an
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
default `up` (+Y), and renders nothing without a sky `ocean`.

## The void (`abyss`)

`abyss` puts an endless lid overhead below a `level` and a bottomless gradient below the
horizon, so a camera under the ground does not see the sky. It is part of the
background, so it never hides anything in the scene, including objects above the level.
The lid recedes into the horizon colour (`fadeDistance`; 0 for never) and has a noise relief
(`detail`, `detailScale`); the depths have faint distant rock (`depthDetail`) and a
`falloff`. A sea turns the void on below its seabed by itself, and with or without a
seabed its lid is a roof from below. With walls, the lid is in their haze instead
(`hazeDistance`), the depths are their haze, and the void's `horizon` colour is that
haze's: `fadeDistance`, `depthDetail` and, but for `background: 'void'` and the stand-in,
`depth` and `falloff` apply only without them, and `ceiling` only without their `sand`.

`walls` (off by default; a prototype) adds cliffs about the stage, from the lid down, so
moving in the void shows its scale. They follow the stage's rectangle (the one the flat
sea keeps level over) pushed out by `distance`, a rounded rectangle given by one signed
distance; their outline wanders in and out by `wander` in a few long waves, whole numbers
of them round it, drifting with depth, and leans out by `flare` per unit of depth, so the
hollow they leave widens.
Their rock stands in and out of that outline by up to `relief`, as a baked cliff texture
says (`bakeSkyCliffs`, a 1024² tile repeating both ways, with mip levels): bays and
headlands, tall ridged buttresses and gullies, and ledges with sheer faces under them that
come and go, features `rockSize` across. It is laid along the walls by the distance round
the outline, a whole number of tiles round so it has no seam, and down them by depth.
The walls' faces are a mesh (`SkyAbyssWallLayer`), not a search per pixel, and a light
one: a single fixed grid round the outline and down from the lid, a column every 4 texels
of the cliffs (128 to 1024 of them, about 400 for Volve) and 32 rows, closer together near
the lid, to `2.5 x lightDepth` deep; past that the walls are black. Every vertex holds its
column and row and is pushed out to the rock's face in the vertex shader, the cliffs read
as coarsely as its cells are wide, and faces as the mesh lies across its neighbours. It is
one draw of some 25k triangles, the same every frame wherever the camera is: no level of
detail, no culling, nothing to pop or crack. Its detail is the fragment shader's, from the
baked relief (see below). Its grid (`skyAbyssWallGrid`) is the sky material's, which the
background needs too. They are cut away up to a vertical plane facing the camera's heading
(as the cutaway's, so looking straight down the top of the screen decides which side is
kept): through the stage's centre, or `cutDistance` in front of the camera once that is further,
so from a distance the near half of the hollow is gone and nothing of it stands in front of
the scene. Like a section, it turns with the camera, sweeping the cut through the rock.
Looking up, the bottom of the screen decides instead, so the plane keeps its side as the
view tilts past 45° and straight up (laid level, the view and the screen's top or bottom
agree looking level). The cut takes away all that lies short of the plane, whichever side
of it the camera is on: a view from the side cut away starts at the plane, one from the
side kept ends there, and at the plane the two agree, so the plane can pass through the
camera without a jump. Below the lid the plane is pushed on past the stage's far corner
(easing in over `cutDistance` down from the lid), so the whole stage lies in what is cut away and
no cut face or rim ever stands behind it, whatever the view; the lid shows over the rock
taken away. Once the whole stage is in view through the hollow, nothing is cut: the plane
eases back through the camera and past the far rim, and then is gone, so from inside the
hollow, or from the dark below it looking up through its opening, the whole lit rim and
the lid over it show (`skyAbyssWallInView`: how far inside the hollow, at its narrowest,
the camera is, or below the walls' foot the sight lines to the stage's corners pass; the
hollow is convex at every depth, so its corners prove all of it). Below their foot the
camera never counts as inside their rock, which is black anyway. A view rising into that
rock from under the foot is black, and hides the walls' faces beyond it (from there, each
of their pixels checks that: at most three reads of the cliffs). A camera in their rock is
never in view of the stage, so it always has its cut (`skyAbyssWallClipPlane`,
tested in `tests/sky-abyss-walls.test.ts`).
Views start past the plane. Where it cuts their rock, a solid fill, drawn by the background
(the mesh leaves every pixel behind it), shows the rock's inside,
unlike the eroded outside of the walls: beds of varying tone (`cutColor`), warped so they
lean and pinch out, finer laminae in them, and joints straight down here and there, each
within its bed; lit flat and matte, darkening with depth and hazing as the walls do, with a
thin paler edge where it meets their face. Whether a view starts in the rock is decided by
the mesh itself: the triangle over the start's way round and depth, its three vertices
laid as the vertex shader lays them, so fill and faces meet without a gap. From above, the
lid cuts the rock the same way, so outside the hollow its top shows.
The rock, `color`, faces as its mesh does. Its finer relief, columns as tall cells of
varying width that end at their own heights, finer flutes on them and cracks down some of
their creases, is the baked tile's normal map and creases, laid three ways and blended by how each face turns: round the outline and
down where it faces into the hollow, out across it and down on a protrusion's sides, round
and out where it faces up or down (only the ways that show are read); laid one way only, it smears on the others. It is raked
by a light of its own, at the subsurface light's bearing and `lightElevation` (level by
default, which brings out the cliffs; below 0 from below), as strongly as `lightStrength`
(0 for none), and filled in by the subsurface's light map (its backdrop, and its panels
below bouncing up), its creases shadowed, and the light on it dims with depth to nearly
black by `lightDepth`, as does the sand's and the glow's.
The data keep the subsurface light. Walls and fill fade
over `hazeDistance` (0 for none) into a haze of their own, the void's horizon colour
darkening with depth to nearly black by `hazeDepth` (0 for never), apart from the light on
the rock: a deeper `lightDepth` lights the rock further down without lighting more haze,
and a deeper `hazeDepth` shows more haze. They stay solid: hazed into what lies behind, the
void's horizon would show through
them as the view tilts. With walls the depths below the horizon are that haze too: a view
that meets none of the mesh passes under its foot, and is drawn as a wall would be there,
at least a haze length on, so as dark as the walls' foot; they lose the gradient and its
faint strata (`depthDetail`). Their rock runs on down past the mesh's foot (the fill cuts
it there too), so from under the foot a view rising out of the hollow before it is up to
the foot has met that rock, and is as dark; one that rises into the hollow sees it, and
the lid over it. Mist clings to the walls in patches fixed in the world (`mist`), hanging
`mistReach` off the rock: a veil in front of it, thicker the more a view runs along it,
lit as the haze is. The open gap stays clear.
Their top is a layer of soft `sand` over the rock (default 1000 deep; 0 for none, all
rock), as the overburden over older rock under a real sea: in it the mesh follows the
rock's large shape alone, its cliffs read three mip levels coarser, so the sand drapes the
bays and headlands without their sharp relief, and is shaded dull and matte in
`sandColor`, faintly mottled, with no reads of the cliffs where it is all sand. Its
contact with the rock eases over a fifth of its depth either way and wanders a little
round the outline; where the walls are cut, the sand shows thin laminae instead of the
rock's beds. The lid seen from below is that sand's underside (`skyAbyssLid`, for the
background and a stage's seabed from below alike), rippled by the void's `detail`, the
ripples fading as the walls' haze thickens, in that haze. A dim light at the top of the
stage (`glow`, in `glowColor`) lights the lid and the sand over the stage, fading out over
about `distance` beyond it. Without sand the lid is the void's own colour (`ceiling`), in
the walls' haze as well.
Far from the hollow its light fades out (`rimFade`, default 20 km; 0 for none), so zoomed out
the lid, the sand and the cut darken toward black instead of fading into the haze's grey.
It is measured beyond the rim itself, the walls' middle at each depth, wandering and leaning
out as they do (`skyAbyssWallFar`), so the dark follows the hollow's own outline rather
than a rectangle or a circle, and eases down to a fifth of the light over `rimFade`, then the
rest to black over twice that again (`SKY_ABYSS_FADED_OUT`), the two easing into each
other. What is
seen is darkened by what is left where it is (the walls' faces stand on the rim and keep
all of it). Their haze thins out over the same `rimFade` beyond the rim (`skyAbyssWallFog`):
thick in the hollow, gone far from it, so from far out a view passes clear air until it
nears the hollow and the darkened lid shows rather than a grey haze. Its thickness along a
view is summed at the middles of six stretches of the part of the view over the rectangle
it can lie over (`skyAbyssWallClear`), each a box distance to the rim without its wander:
the haze is smooth. Inside the hollow it is as thick as without the fade, so little
changes there. A point inside the rim however far it wanders skips the way round:
the walls' faces, and anything in the hollow, pay one box distance for its light.
A view rising from under the foot counts as gone into the rock there once it passes within
about a pixel of it (`SKY_ABYSS_FOOT_OVERLAP`), so that rock overlaps the mesh's last edge
and no hairline of the lid shows between them.
The mesh is drawn from below the lid, before the background, and from above it only while
the void can show there: through a seabed that is off or see-through, a cutaway that takes
the seabed, or a stage's relief cut with an occupant (a `SkyBoxStage` tells the sky while
an occupant's `cut` opens its relief). From above, a view going down through the lid beyond the stage while the
background's seabed there is opaque, and a cutaway does not take it, leaves the mesh hidden
(`skyAbyssWallCovered`, which reads the sea's cutaway as the background does); over
the stage the stage's own seabed hides it by depth, but where it is cut. The fill and the
haze beyond show wherever
the void does: from inside it, and looking into it from above through a cutaway, a
see-through seabed or a section (but in the band under a cutaway's rim, which the stage
draws). A stage's seabed seen from below leaves the fill to the background where it hangs
in front, and from under the foot the rock below it, where a view went into that rock
first; the faces hide it by depth. Without walls the void costs nothing extra
(`SKY_ABYSS_WALLS`).

## Cutaway

`cutaway` cuts the sea's water and seabed away in front of the view, so what lies under
them is seen clearly — an illustration's cutaway rather than a realistic one. It cuts
everything nearer than a line across the view where a row of the frame meets the
surface (the seabed, with the camera in the water or the sea dry); waves bend the line,
a rim marks it and a shadow falls just inside it. The scene itself — the occupant, the
data, a relief over an occupant's outline — is never cut. With the camera in the water, the cut takes
the seabed in front of the view, and the water begins only at a wall standing on the
cut's edge: inside it the view is clear, and the sky shows through the surface over it.
A cutaway also keeps the scene lit as from above the water.

```tsx
<Sky ocean cutaway={{ reach: 0.5, rim: { width: 3 }, shadow: { opacity: 0.5 } }} />
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
- `handle: true` draws a grip on the rim in the middle of the view: dragging it sets the
  offset, under the pointer, and a double click or tap puts it back to 0. It reports
  through `onOffsetChange` once the drag ends (and on a reset), and the sky keeps the
  dragged offset until `offset` changes.
  The shader draws it with the rim, so it is drawn only where the rim is (on the surface
  seen from above); an invisible element over it takes the pointer, so camera controls
  never see the drag. It works while the edge slides out too.
- `zoomFollow` is how much of a zoom its size follows on screen: 1 keeps it fixed in
  the frame, 0 fixed in the world. It has its frame size with the camera `reference`
  high (default half the width of a stage's occupant).

## Rendering

The sky draws after the opaque scene (`renderOrder` 1e9), on the far plane with a depth
test, so it is shaded only where nothing nearer is drawn; its sea surface draws as a
second fullscreen layer right after it, and a stage's relief overview past its tiles after
both.
Transparent parts draw after all of them. It works with R3F's own render and with a
`RenderingPipeline` of `OITRenderPass` + `OutputPass`.

⚠️ An opaque object that writes no depth (`depthWrite: false` without `transparent`) is
drawn over by the sky: make it transparent. The far plane assumes a standard depth
buffer, not a reversed one. Each layer rebuilds its view ray from a point at NDC depth 0,
not on the far plane: with a far plane far enough from the near one (50 000 km over
0.1 m), the far plane's point rounds to infinity in 32-bit floats and the ray flips.

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
  each seabed part ~0.4 s. Clouds add ~0.4 s to the background.
- They compile in the background where the browser has `KHR_parallel_shader_compile`:
  until the sky, its stages and its bakes are ready, a stand-in (the void's grey
  gradient, without its detail) is drawn, a stage draws nothing and nothing is
  baked. A recompile (below) shows the stand-in again for as long as it takes. A
  `ChunkStack`'s meshes likewise stay hidden until theirs are ready.
- The bakes draw with the very programs the background and its surface layer do, so
  they cost no compile of their own — when both draw into a render target (a
  `RenderingPipeline`) and with the same lights (the sky's own directional light and
  probe).
- ⚠️ ANGLE on Direct3D compiles a program's pixel shader for one colour attachment,
  and again at its first draw into several. `OITRenderPass` draws into several with
  `mergeFront` or `tailSlices`, so the first frame that shows a stage's see-through
  parts still stalls (~1.6 s for its surface, measured cold). Without either, nothing
  stalls.
- Switching `ocean`, `abyss`, `clouds`, the seabed's `detail` or the sea's wave count
  recompiles, and so does a stage when `seabedOpacity` crosses 1 (its seabed turns
  see-through, `STAGE_SEE_THROUGH`); every other option only changes uniforms.
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
drew first and before the two layers above were skipped. The sky's draws are
fill-bound: they scale with the pixels drawn, about double at 1080p.

`Sky` Timelapse (R3F's own render, relief on); the surface layer adds 0.16–0.18 in every view:

| Camera | Frame | Background | Stage's sea | Stage's seabed | Relief |
|--|--|--|--|--|--|
| 40 m | 8.2 | 2.5 | 3.85 | 0.87 | 0.78 |
| 2 km | 7.6 | 2.4 | 2.9 | 0.82 | 1.28 |
| 100 km | 5.9 | 2.3 | 1.76 | 0.03 | 1.64 |
| −30 m, in the water | 7.0 | 3.54 | 1.56 | 0.89 | 0.73 |
| −500 m, below the seabed | 4.4 | 2.45 | 1.02 | 0.78 | 0.07 |

`FieldColumn` WithSky (Volve as the occupant, an `OITRenderPass` pipeline, no relief):

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

### The void and its walls

Under the lid the background shades no sky at all: the void covers all of it. From below,
a stage's flat seabed shades no sea floor (only seen from above), and where the walls' rock
is in front of the lid it discards before shading the lid. Same pixels (one channel of one
pixel off by 1/255, from rounding). GPU ms, StageDebug with walls, the sea and seabed on,
210 spheres, Iris Xe at 1.92 megapixels:

| Camera | Frame | Stage's seabed | Background | Walls |
|--|--|--|--|--|
| 94 km down, looking up | 13.5 → 9.4 | 7.3 → 3.8 | 3.4 → 2.8 | 2.1 |
| In the hollow, 4 km down | 7.8 → 7.0 | 4.1 → 3.3 | 0.4 | 2.0 |
| 150 km out, 33 km down | 8.0 → 6.0 | 3.7 → 2.8 | 3.4 → 2.6 | 0.5 |
| At the rim, 500 m down | 9.0 → 7.8 | 2.0 → 1.5 | 3.0 → 2.4 | 2.5 |

What is left: the walls' mesh writes its depth (log depth), so it gets no early depth test;
the lid's ripples cost about 1 ms, and the haze's sampling (`hazeDistance`, `rimFade`)
about 1.3 ms on the seabed.

## Debugging

`<Sky debug={...}>` tints each part by what draws it (`tint`), hides layers (`hide`) and
shows the environment's bake for the zone in view (`environment`). Its `walls` views draw
the void walls' mesh as lines (`wireframe`); flat, without the rock's relief, with the
faces of their cut drawn as geometry, so they hide what lies behind the rock (`flat`); and
the plane they are cut along as a grid (`cut`). `<SkyBoxStage debug={...}>` hides stage layers, and draws
its outline (with, under walls, a faint copy at their foot) and wireframe over everything.
None of them rebuild or bake anything.

The Storybook stories `Spikes/Sky/StageDebug` (a stage of any size, synthetic ground under
it, an optional occupant's outline and stand-in spheres, every option and debug view) and `Spikes/Sky/Baseline` (a real field) exercise all of it. Every
story drawing a `<Sky>` takes its controls from one module,
`src/storybook/components/sky-controls.ts`, so a control has the same name everywhere: the
basic ones show in every story, the advanced and debug ones only in `StageDebug`
(`skyArgTypes({ debug: true })`), keeping their defaults elsewhere.

## For maintainers

| File | Role |
|--|--|
| `Sky.tsx` | the component: props → material, the directional light, the bakes, the cutaway's per-frame placement |
| `sky-model.ts` | option types, defaults, and the pure rules (`skyZone`, `skyDaylight`, `skyMoonlight`, `skySunColor`, …) |
| `sky-material.ts` | `SkyMaterial`: the background's shader and the uniform objects everything else shares |
| `sky-baker.ts` | bakes the environment and light probe per zone (internal) |
| `sky-stage.ts`, `SkyBoxStage.tsx` | the stage's geometry and materials |
| `SkyBoxStageReliefTiles.tsx`, `sky-relief-tiles.ts`, `SkyBoxStageReliefOverview.tsx`, `sky-relief.ts` | the relief: its tiles, and its overview past the far plane (see [tiles.md](./tiles.md)) |
| `sky-defs.ts`, `generators/sky-relief-*.ts` | the `skyReliefTile` and `skyRelief` generators: the relief's tiles, and its overview's grid |
| `sky-context.ts` | `useSky`, `useSkyOcean` |
| `shaders/sky.glsl` | the sky itself: gradient, sun, night, clouds, void, `skyRadiance` |
| `shaders/sky-gradient.glsl` | the gradient alone |
| `shaders/sky-void.glsl` | the void's gradient alone: its colours, the depths' gradient, and the whole of it as the stand-in and `background: 'void'` draw it |
| `shaders/sky-stand-in-fragment.glsl` | the stand-in drawn while the sky compiles: the void's gradient |
| `shaders/sky-ocean.glsl` | the sea: surface, water, seabed, cutaway |
| `shaders/stage-fragment.glsl`, `sky-surface-fragment.glsl` | the stage's parts, and the sea surface layer |

- The stage's materials and the baker's share the background material's UNIFORM
  OBJECTS, so they follow every change to it. Defines are copied: the ones a stage needs
  are listed in `SKY_SHARED_DEFINES`; background-only switches (`SKY_CLOUDS`, `SKY_VOID`) are not,
  and the baker copies all of them, IN ORDER, in `sync()`.
- ⭐ A program is keyed on its defines' order, the `fog` flag and the number of lights
  as well as on the source: the baker's material copies the background's defines in
  their order, keeps `fog: true` (its scene has none) and keeps its light probe in the
  scene without coefficients, so both share one program. `linkOcean` runs in render, so
  the surface layer and a stage's materials are made with the waves' defines.
- Compiling ahead goes through `precompile` (`src/rendering/precompile.ts`, internal):
  it compiles as the scene draws, i.e. for the `RenderingPipeline`'s render target and
  through the `OITRenderPass`'s variants. The sky waits for its own meshes, the stages
  registered through `SkyOceanState.stage`, and the baker's scenes and PMREM prefilter.
- The water lies on one mesh (`createSkyStagePlane`): `bounds` as a 4 × 4 grid, then rings
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
  `skyRadiance`).
- ⚠️ Derivatives (`fwidth`) taken after a branch some pixels of a quad have left are
  undefined: take them first, before any early return (see `skyOceanCutawayRimAt`).
