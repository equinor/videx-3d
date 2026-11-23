# Ocean

The `<Ocean>` component renders a stylized, animated water surface tuned for
oil-field scale (tens of km). Its waves are a sea state's
([ocean-waves.md](./ocean-waves.md)): the spectrum a wind (m/s) and swells ask for, drawn as a
few hundred waves on each of a few layers, baked each frame into tiling textures read
hex-tiled (so they never repeat) and filtered to the pixel, so the surface stays detailed
when zoomed in and artifact-free when zoomed out. A new wind eases the sea toward its spectrum
rather than rewriting it, and floating objects ride the same waves as are drawn. It composites
correctly with subsurface geometry through the `OITRenderPass`.

For an endless sea that is part of the sky — with a seabed, seen from above, in and
below the water — see `<SceneryOcean>` in [Scenery](./scenery.md).

## Basic usage

The simplest ocean is a flat plane at sea level:

```tsx
import { Ocean, createOceanPlane } from '@equinor/videx-3d'

const surface = createOceanPlane({ size: 100000 })

<Ocean geometry={surface} windDirection={[1, 0.3]} windSpeed={10} />
```

`windSpeed` (U10) is the primary knob — wave height, wavelength and foam all
follow from it (≈ 10 m/s ⇒ ~2 m significant wave height). `swells` add waves from weather far
away (height, period, direction), running on in a calm. Colours, foam, reflection and opacity
are all tunable via props.

`quality` (`'low' | 'medium' | 'high' | 'ultra'`, default `'medium'`, `SEA_QUALITY`) is how
much of the sea state is drawn: `medium`, sized for a mid-range laptop's integrated GPU, four
layers (tiles of 2011, 307, 47 and 7.3 m, waves down to 0.23 m); `high` adds the finest
layer's texture read again 6.4× smaller below that, for close up; `low` three coarse layers
and no ripples; `ultra` `high` with three times the waves a layer, each band drawn fuller
(768; see [ocean-waves.md](./ocean-waves.md)). `high` and `ultra` also read the layers
anisotropically (`SeaQualitySpec.anisotropy`, `SEA_ANISO`: at most 4 and 8 taps along a
pixel's footprint), so the waves stay sharp toward grazing instead of blurring into a mirror;
the layers hold their slopes' second moments, so what the filter loses still comes back as
roughness. At 4× it costs `high`'s stage surface about 9 % from 30 m up, 5 % at 2 m
(2026-11-18, A1000). `low` also leaves out of the shading, compiled out
(`OCEAN_QUALITY_DEFINES`): the weather's gusts and slicks (the mean's roughness everywhere),
the light through the crests and, in a `<Scenery>`'s sea, the sky's twilight and the sun's
halo in the reflection (its gradient alone, in the daylight where the camera is). Measured on
the `Scenery`'s stage surface (2026-11-18, A1000), those three take it to 0.74 of `medium`'s
(the gusts 0.85, the sky 0.96, the crests 0.98–0.99). The `<Scenery>`'s sea (`SceneryOcean`)
takes the same `quality`. The short waves, from about a metre down, grow with the wind (Elfouhaily et al.
1997): a light air leaves them faint, a gale sharp. `steepness` (default 1) scales the slopes
for show; 1 is as the spectrum gives them. Whitecaps (`foamAmount`, default 0.5) cover the
share of the sea measured at sea for the wind (about 1 % at 10 m/s, 10 % at 20 m/s) on the
wind sea's highest crests: narrowed toward the crest lines into streaks, a soft grained rim,
lit by the sky toward the wave's normal and the sun (albedo 0.8). Each pixel draws the share of
it that crests over the threshold cover, those it shows and those too small for it alike: crisp
patches up close, a mottled brightening further off (a whitecap is a ragged patch a few metres
across, `OCEAN_FOAM_PATCH`, larger as the wind rises), an even tint toward the horizon, as much
foam at every distance, with no hand-over to tune. Its shaping is still open
to tuning (`foamTuning`, ⚠️ to be settled and removed; defaults dialled in on the sea bench
2026-11-13, at 0–3 % of the `Scenery`'s sea on the A1000 over the flat foam before).
`waveCount`, `directionalSpread`, `detailStrength` and the `tonal*`
props are deprecated and ignored.

**Foam with a life** (`foamLife`, default on at `high` and `ultra`; built 2026-11-16). A breaking
crest leaves its foam behind it: a square of the sea ahead of the camera (`SeaFoamLife`, 512²
texels, six times the camera's height across, 512 m to 2 km, gone from 1 km up) is run a step
each frame on the sea's clock. Fresh foam (2 s) trails the crests that broke and leaves a thin
old foam, lasting longer as the wind rises (8–40 s), drifting downwind at 3 % of the wind and
gathered into streaks across it from about Beaufort 4. Where it holds, 47 % of the whitecaps'
cover breaks afresh (`SEA_FOAM_ACTIVE`), so as much foam shows in all as without it (measured:
2.6 % of the pixels against 3.0 % at 15 m/s). The square is snapped to its texels; it grows
at once as the camera climbs but shrinks only well below the next size down; and sea it moves
onto eases into its life over 5 s, so neither its edge nor bare sea shows as the camera turns.

Inside a `<Weather>` (see [clouds.md](./clouds.md#the-weather)), `windSpeed`, `windDirection`,
`gusts` and `swells` left out are the weather's: its wind's speed, the way it blows toward and
its gusts, and its swells (`WeatherState.swell`). The `<Scenery>`'s endless sea and a
`ZoneStack`'s water take them the same way. Given, the sea's own win.

**One sea under a weather** (built 2026-11-15). A sea that leaves its waves to the weather — no
`windSpeed`, `windDirection`, `swells` or `amplitude` of its own, nor wave tuning that changes
the sea state (`spreadFloor`, `tail`) — draws the weather's sea (`WeatherSea`,
`useWeatherSea`; `OceanMaterial.sea`, set by `useWeatherOceanSea`): one `SeaState` a quality,
on the weather's clock, its layers baked once a frame however many seas draw it (a second sea
bakes only the layers the first left out as too fine to show from where it looked). So an
`Ocean`, a `ZoneStack`'s water and the `<Scenery>`'s sea under one weather are one sea, the same
waves at the same place and time, and their floating objects ride the same waves. Its phases
follow the clock's time: a jump (`time` set) moves the waves to it at once, and the weather's
wind changing eases them toward it, as a wind of a sea's own does. Given a wind or swells of
its own, a sea keeps a sea state of its own, which runs at the clock's pace from when it was
drawn (`useWeatherStep`, as many seconds a frame as the clock ran: a timelapse races it, a
paused weather holds it still, a jump does not move it). Without a wind in the weather, every
sea keeps its own.

`gusts` (`WeatherGusts`, default as the wind gives them) is how the wind varies over the sea:
gusts from cat's paws of some tens of metres to gust fronts of kilometres run downwind with it,
roughening the short waves and calming them in the lulls; slicks, calm streaks along the wind,
lie in light air and are gone by about 10 m/s. Seen as darker, rougher patches against a sea
mirroring the horizon, and in the glint. `{ strength: 0, slicks: 0 }` turns them off. How it
is drawn: [ocean-waves.md](./ocean-waves.md#gusts-and-slicks).

Far from the camera the detail fades out: between the two distances of
`detailFadeDistance` (default `[15000, 60000]` m) the waves and foam give way to a flat mirror
of the sky, and past it no layer is read. The sun's glint widens by every slope a pixel
cannot show rather than shrinking to a point: the waves too small for its footprint (what the
layers' mips filter out) or faded out with distance, and the small ones no layer draws, as
much as the wind gives (Cox and Munk's mean square slope, `0.003 + 0.00512 × windSpeed`). So
far off, and from high up, it spreads into a broad soft patch, as seen from aircraft. The
`<Scenery>`'s endless sea takes the same prop. `OceanMaterial.sunGlintSpread` (default the
scene's sky's, else 0) widens the glint further at the same peak, so its path broadens and
brightens; the `<Scenery>` raises it about sunrise and sunset for a broad glitter path.

**Glitter** (built 2026-11-15; `sparkle`, `OCEAN_SPARKLE`). The glint is what many small glints
a pixel cannot show send of the sun on average; where few of them fall in a pixel they are
bright points instead, coming and going as the ripples move. A cell of the sea fixed in the
world shows a Poisson count of them about their mean (as Deliot and Belcour 2023 draw glints),
as that count over the mean of the glint: many to a pixel it is the smooth glint, the same mean
at every distance. How many glints a square metre holds is the specular points' density
(Longuet-Higgins 1960): the slope pdf at the half vector times the curvature of the waves too
short to draw (their slope variance times a 6 cm ripple's wavenumber squared). So a rough sea,
crowded with ripples, has so many that a few metres off they are a sheen; a calmer one fewer.
Cells are a pixel's footprint wide, read at the two powers of two either side and blended, so
nothing pops; each draw fades into the next (eight turns a second, each cell at its own
phase), no draw outshines the mean more than 4 times, and there is none where a ripple spans
more than a pixel, where the waves drawn carry the glint. `sparkle` (0 none, compiled out; 1 as
modelled; more for more of it) defaults by `quality`: none on low and medium, 1 on high and
ultra. On the A1000 at 1280 × 720 it costs the `<Scenery>`'s sea 1–3 % from 300 m and 4–8 % from
30 m.

**Light through the crests** (2026-11-15; `crestLight`, default 1). With the sun behind the
waves, its light crosses their thin crests and leaves toward the eye: the water's own light
looking toward the light from in it (`waterGlow` straight up, 9 times its colour), tinted by
the short path through a crest (half the significant height, 0.3–3 m: red goes first, so it
glows turquoise, brighter in clearer water), on a narrow lobe about the sun's direction pushed
by the normal (Barré-Brisebois and Bouchard 2011), high on the waves only, fading with their
detail, as much as leaves the water (1 − Fresnel), in the sun's colour there (the `<Scenery>`'s
with its clouds' shadow). Subtle by design: measured with the sun 12° up (orange) at 12 m/s
from 15 m, 1 changes 0.3 % of the sea's pixels by more than 2/255, 3 a quarter of them by up
to 13/255. 0 none, more for more; a few operations, no measurable cost (`oceanCrestLight` in
`ocean-surface.glsl`, both seas).

**Fresnel** (2026-11-15). The share reflected is water's: Fresnel's equations for an
unpolarised ray into water of IOR 1.333 (2.04 % straight on), from above and, by reciprocity,
from below through Snell's window, and in the `<Scenery>`'s estimate of what the surface hides.
`fresnelPower` given draws the old look instead (`OCEAN_FRESNEL_POWER`): Schlick's curve from
2 % with that exponent; its old default, 4, reflected about half as much again as water at
middle angles (0.26 against 0.17 at 72°), a paler sea. Measured, the same cost either way.

**One sky** (built 2026-11-15). An `Ocean`'s and a `ZoneStack`'s sea reflect the sky of their
scene (`sceneSky`, `SceneSky` in `sdk/materials/scene-sky.ts`; `OceanMaterial.updateSky`, run
by both before each frame), in the reflection, through Snell's window from below and in the
foam's light:

- **Under a `<Scenery>`**, the sky it publishes: the environment it bakes of the air over the
  sea (the sky's own surface over a flat sea; whichever zone the camera is in: under water the
  surface still reflects the air), its
  `environment.intensity`, the bake of its 3D clouds over that (sharper than the air's bake holds
  them, as its own sea reads it), and its sun or moon as its own sea's glint has it. The
  `<Scenery>`'s sea keeps its own sky, drawn per pixel.
- **Otherwise**, the scene's: `scene.environment` (and `environmentIntensity`,
  `environmentRotation`), prefiltered once per texture as three prefilters it for its own
  materials (`prefilteredEnvironment`), and its brightest visible `DirectionalLight` (searched
  for again every half second, its direction and colour read each frame).
- **Without either**, the gradient of `skyColor` and `horizonColor` with a sun's glow in it,
  and its own default sun.

The environment is read as blurred as the slopes no pixel shows roughen the surface (their
variance as GGX's alpha squared); a reflection turned below the horizon by a steep wave is
mirrored back up, as the `<Scenery>`'s sea does. `sunDirection` and `sunColor` (colour ×
intensity) given are the sea's own sun whatever the scene's; left out (or set to null on the
material), the scene's. An environment appearing, going or changing size compiles the
surface again (defines for three's `cube_uv_reflection_fragment`); a new one of the same size
does not. Measured on the A1000 at 1920 × 1080 (SeaBench stand-alone, studio HDR against the
gradient): the surface's draw 1.19 → 1.27 ms from 300 m, 1.48 → 1.62 ms from 2 km.

## Geometry builders

The component only renders geometry; build it with one of the SDK helpers:

| Builder | Result |
|--|--|
| `createOceanPlane` | flat surface plane |
| `createOceanBox` | surface + procedural sea bed + water-body walls |
| `createOceanEllipseBox` | round/oval box (no hard corners) |
| `createOceanBoxFromPolygon` | box following a field-outline polygon (with holes) |
| `createOceanBoxFromSurface` | box whose sea bed is a real bathymetry surface |

A box returns three separate geometries; pass them as separate props so each
routes through OIT independently:

```tsx
const { surface, body, bed } = createOceanBox({ size: 100000, waterDepth: 150 })

<Ocean geometry={surface} bodyGeometry={body} bedGeometry={bed} />
```

A solid sea bed (`seaBedOpacity={1}`) occludes the subsurface; lower values let
it show through. `waterOpacity` controls how clear the water reads looking down.

## Floating objects (buoyancy)

Children of `<Ocean>` can follow the live wave field. Pass a few body-frame
sample points (e.g. the corners of a hull) to `useBuoyancy`; it heaves, pitches
and rolls the object to match the surface:

```tsx
import { Ocean, useBuoyancy } from '@equinor/videx-3d'

function Buoy() {
  const ref = useRef<Group>(null)
  useBuoyancy(ref, { points: [[5, 5], [5, -5], [-5, 5], [-5, -5]] })
  return <group ref={ref}><mesh>{/* ... */}</mesh></group>
}

<Ocean geometry={surface}><Buoy /></Ocean>
```

Use `useOceanContact` to spread foam where an object meets the water (see the
`Tanker` component for a full example). Both are no-ops outside an `<Ocean>`. With more
footprints than the material draws (`contactCount`, 8), those nearest the camera are drawn.

Under a `Scenery`, anywhere on its globe (built 2026-11-16): its sea far from the field is
drawn in charts fixed on the Earth (`OceanCharts`, see
[world.md, 4d](./world.md#4d-the-waves-far-off-built-2026-10-27)), and its sampler reads them
there (`OceanSampler.heightAtWorld`, `stillSeaAt`; `chartedSeaHeights`): a point is taken along
up onto the still sea, into the chart it lies in, its waves kept by how far it lies from where
two charts meet, as the drawn ones are. `useBuoyancy` then samples in the world and poses the
object in its parent's frame, whose +Y it takes for up there (a `Wgs84Position`, a
`GeoTracks`'s group). Past the stage's disc the plane's own heights (`getHeightAt`) part from
the drawn waves' by metres (the chart is stereographic, the plane the map's: 11 m 108 km out),
so a `Scenery`'s floating objects read the world's everywhere. A contact footprint given in a
frame of its own (`OceanContact.frame`) is taken through the world into the plane the sea draws
its foam in.

## Water over a zone stack

A subsurface block can carry its own sea instead of an `<Ocean>` of its own:
declare `water` on the `ZoneStack`.

```tsx
<ZoneStack boundary={field} surfaces={column} seabed={seabedId} water={{ depth: 0, windSpeed: 10 }}>
  <Zone layers={[{ surface: seabed, material: '#c2b280' }, /* ... */]} />
  <Tanker position={[x, 0, z]} heading={heading} />
</ZoneStack>
```

⭐ It belongs to the STACK, not to a layer of a zone. The sea is a property of
the column — every zone cut from it stands under the same water — and a lid
covers its whole footprint by design, so two zones each drawing part of it would
leave two coplanar lids wherever their footprints overlap. The stack draws it
once, as a two-boundary stack of its own: the level, and the column's sea bed as
its bed — the surface `seabed` names, which the stack never guesses: without it, or
with a column that does not hold it, there is no sea.

The sea state props are the same ones the component takes (`OceanWaterProps` /
`OceanBodyProps`), and the stack supplies both materials: the animated surface for
the lid and the water body for the volume down to the bed.

⚠️ `bodyShimmer` is drawn on the OUTWARD side of the body's walls only. Caustics
are light landing on a surface, and the inner face of a wall is not one — it
stands in for the water itself, so light play painted on it reads as a texture on
a pane of glass. Shimmer seen from INSIDE the water would have to be volumetric,
i.e. marched through the body, which is a long way past what a wall material is;
deliberately not attempted.

The walls are one double-sided draw (`OceanVolumeMaterial`), a stack's too, both
faces tinted as fog of the camera's distance to them: `bodyFogDensity` per metre
(default 0.004), up to `bodyMaxOpacity` (else `waterOpacity`, else 0.9). Their
colour is the water's own (its `optics`), lit at the wall's depth, so they match
the surface. Not a path through the water: no outline logic, so they hold for any
shape. From in the water they show the water from the camera to them by its
`optics` instead, as what lies in the water fades: the line to the wall the camera
sees runs all in the water, so that is exact for any outline (⚠️ but for a wall seen
past a notch of a concave outline, which counts the notch's air too). (Walls that show the water along the sight line, by the `optics`, were tried
in 2026-11 and dropped: without the outline's edges in the shader, the line's part
in the water is taken over the outline's box, which shades a polygon's walls by
the angle and counts a concave outline's water twice.)

Seen from the air, the water in front of what lies in it is drawn by what the
sight line enters it by: the surface (the water down to the seabed under it) or a
wall. What lies in the water (the bed, a stack's top cap) is only dimmed by the
daylight its depth leaves it; from in the water, faded by its own path.

The water lies where the surface geometry lies, in plan (`geometryFootprint`): beside
it — in a notch or a hole of a polygon's outline, not just beyond its box — the camera
is in air, tested exactly each frame. What lies in the water is told by its box: beside
the water but in its box, a material given its fog (`applyWaterFog`) fades as if in
it. See [camera.md](./camera.md#over-the-water-exactly).

The sea takes no part in the depth order, which is what stops it truncating the
ground beneath it: a sea bed above the plane comes THROUGH it rather than being
flattened onto it, and the water body ends at the shoreline. See
`documents/zones.md` §6. The bed's cap meets the flat lid where the bed's grid puts
the shore, because its coastline is built into the cap (§6.3.1).

`seaBedWaterTint` is the one thing that does NOT carry over: it belongs to the bed
material the component draws, and a zone's sea bed is ordinary geology. The
shallowest cap is dimmed instead by the daylight its depth leaves it (the stack's
own water, `water-body.glsl`'s `waterBodyDim`), as the component's bed is; the lid
and the walls carry the water in front of it. (`bedTint` and `bedTintDepth` are
deprecated; see `documents/zones.md` §6.4.1 for what they did.)

⭐ **The waves answer the depth: they shoal and die out toward a shore, and break
in surf there** (`documents/ocean-waves.md`, Shallow water), by one rule in every
sea: the `Ocean`, a `ZoneStack`'s, and the `Scenery`'s. The depth is the
bathymetry grid where there is one, else the scene's ground under an endless sea,
else the water's own floor, which a flat sea has nowhere near the waves. The surf
(`shoreFoam`, `shoreBreakDepth`, `surfScale`, `swash`, `shoreNoise`,
`shoreNoiseScale`, `shoreFoamStrength`, `shoreFoamFade`) is the same code on all of
them. Floating objects ride the waves as cut. See `documents/zones.md` §6.6.

**Floating objects work here.** The stack provides the same wave sampler and
contact-foam registry an `<Ocean>` does, so a vessel heaves and spreads foam with
nothing extra wired. ⭐ The sampler is bound to the sea's LEVEL, so heights come
back absolute in the stack's frame: place the object at the water plane rather
than inside a group at sea level.

⚠️ The sea needs a `boundary` on the stack — a `cutSource` alone gives nothing to
draw it over.

⚠️ `displacement` needs a surface fine enough to displace. The lid is
triangulated from the stack's boundary, so give it a target edge length —
`water: { displacement: true, resolution: 100 }` — and remember it applies over
the whole footprint. Without displacement the waves are shaded per pixel and the
lid can stay at its minimum. Displaced, the waves die out toward the shore by the
bed's depth, so the waterline stays near the coast the bed's cap is built along.

See the **Components / Misc / Ocean** stories for an interactive demo of every
variant plus the buoyancy boxes, and **Spikes / Zones / SyntheticColumn** for
water over a zone stack.

## Measuring

Time the sea on **debug / Ocean / Sea Bench**
(`src/components/Ocean/debug/SeaBench.stories.tsx`): the stand-alone `Ocean` (a 50 km plane,
story `StandAloneOcean`) or a `Scenery`'s endless sea with a stage over the field as in its
Timelapse (`Default`), with the same sun (10:00 on the scenery stories' date and place), wind
and poses, in a canvas of a fixed size at a fixed pixel ratio (1920 × 1080 at 1 by default).
`clouds` adds a sky preset's clouds (`SceneryClouds`, medium). `pipeline: 'oit'` draws the
frame through an `OITRenderPass` (SMAA, then `OutputPass`), as a host with see-through data
would; the sea is see-through, so it is drawn in that pass's passes, and the bench sums each
draw's.

The poses (`SEA_POSES`) look south about the origin from 2 m, 30 m, 300 m, 2 km, 20 km, 100 km
and 1000 km up, and straight down from 2 km. The stand-alone plane's edge shows from 20 km, so
it is toured only up to there.

Its panel and `window.videx3d.seaBench` (`src/storybook/debug/sea-bench.ts`) time each draw of
the sea apart in the frame as it runs (`SEA_GROUPS`, by timer query): the `Ocean`'s surface,
body and bed; the stage's surface and seabed; the background's surface, seabed (`bgSea`) and
in-water layers; their sum is `sea`. The background's sky is timed too, to tell the GPU's clock
by.

- `frames()`: the frame and each draw, from the pose as it is.
- `tour({ rounds })`: every pose in turn, the rounds interleaved; each pose's `spread` is its
  highest round over its lowest.
- `ab({ name: { arg: value } }, { pose, rounds })`: story args against the current ones, in
  interleaved rounds, with the median of each round's own ratio; the args are put back after.
- `hold(seconds)`: the render loop stopped, so the GPU cools.

Every result carries its conditions (canvas, pixel ratio, drawing buffer, pose, args, GPU).
Compare only results whose conditions match.

- ⭐ **Trust `ab`'s ratios, and absolute times only with a `spread` under about 1.05.** A
  laptop's GPU changes its clock with the load. On the Iris Xe the same draw read 7–14 ms from
  one run to the next. On the NVIDIA A1000 at 60 fps, the light stand-alone sea dropped between
  two clock states (2.9 and 4.6 ms), while the Scenery held within 3 %. Without the frame cap
  (`--disable-gpu-vsync --disable-frame-rate-limit`) it was the other way round: the stand-alone
  sea held, and the Scenery hit the power limit and varied up to 2×. The ratios read the same
  both ways (tonal patches off 0.81, detail octaves 4→1 0.47–0.49).
- **Steadier timings on a laptop with two GPUs:** drive a Chrome set to "High performance" in
  Windows' graphics settings from a script (`--remote-debugging-port`, then Playwright's
  `connectOverCDP`), with `--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding` and `--disable-background-timer-throttling`, so it keeps
  drawing behind the editor. Check `conditions().gpu` before trusting it.
- The `medium` quality is sized for a mid-range laptop's integrated GPU (the Iris Xe class),
  some 6–7× slower than the A1000 at the sea: judge changes on the steadier GPU, the budget on
  the slower one.

**Baseline** (HEAD `058d8fea`, 2026-11-12, 1920 × 1080 at 1, wind 10 m/s, no clouds). GPU ms,
NVIDIA RTX A1000 (ANGLE D3D11):

| pose | Scenery: sea | stage surface | stage seabed | background | stand-alone `Ocean`* |
|--|--|--|--|--|--|
| 2 m | 4.35 | 2.75 | 0.69 | 0.91 | 2.93 |
| 30 m | 4.49 | 2.95 | 0.78 | 0.76 | 3.14 |
| 300 m | 4.76 | 3.38 | 0.94 | 0.44 | 3.41 |
| 2 km | 5.08 | 3.83 | 1.22 | 0.03 | 3.03 |
| 20 km | 4.96 | 3.46 | 1.43 | 0.07 | 1.56 |
| 100 km | 4.84 | 2.97 | 1.85 | 0.02 | – |
| 1000 km | 4.92 | 2.92 | 1.82 | 0.18 | – |
| down, 2 km | 5.01 | 3.80 | 1.21 | 0 | 3.77 |

\* Without the frame cap, `spread` ≤ 1.11; the Scenery's at 60 fps, `spread` ≤ 1.03.

- The seabed was drawn under the surface at every height, 1.2–1.9 ms from 2 km up, where the
  water over it is opaque. Since skipped where the surface hides it whole: 0.6–0.8 ms from
  20 km up (see scenery.md, "Performance").
- On the Iris Xe (a 300 m pose of the Scenery's Timelapse, 1920 × 1080): stage surface 24.9 ms,
  stage seabed 7.4 ms, frame 27.8 ms; the stand-alone sea 12–16 ms across the screen.
- Under clouds (`Components/Misc/Clouds`, medium) the stage's surface costs up to about 25 %
  more low down (overcast stratocumulus at 30 m and 300 m).
- What its draw spends, stand-alone at 300 m (`ab`): detail noise 4 → 1 octaves 0.47–0.49 of it;
  tonal patches off 0.81 (0.78–0.83 in the Scenery's stage); waves 16 → 8 or 32 within ±15 %.
- The foam, in the Scenery's stage surface (2026-11-20, medium, wind 10 m/s, the waves paused;
  each variant switched in the same page, the order alternated): all of it 2–4 % of the draw at
  30 m and 300 m, perhaps 10 % from 2 km (as noisy), where it is an even tint over every pixel.
  So an early-out has little to skip where the foam is drawn whole and nothing where it is a
  tint; and its sky light taken from the air's lookup where it is below a pixel (scenery.md,
  "The air") saved 2 % at most. Neither was built.
- ⚠️ Time code variants in one page, with a temporary uniform switched between `frames()`
  calls in alternating order. Loaded page by page, the same variant landed in GPU clock states
  20 % apart (A1000), which read as savings that were not there.
- ⚠️ The poses hold the camera still, and `paused` the waves: right for a variant's ratio and
  an image diff, not for what a frame costs in use, where the sea and the clouds reuse less.
  For that, drive the camera along the same frame-indexed path for each variant, the clock
  running.
- **Through OIT** (2026-11-20, A1000, the camera orbiting, the clock running): a see-through
  sea is drawn in the min-depth and tail passes, and with a separate front pass in that one
  too, each shading it whole. The Timelapse's stage surface at 300 m: 2.20 ms drawn plainly,
  4.12 ms through OIT with a separate front pass, 2.02 ms with `mergeFront` (the default); at
  2 km 2.43 / 5.69 / 2.42 ms. The stand-alone `Ocean` near: its surface 0.95 / 1.72 / 1.04 ms,
  its bed 0.45 / 0.94 / 0.59 ms (oit-guide.md, "What a transparent frame costs").

**The sea state's waves** ([ocean-waves.md](./ocean-waves.md), 2026-11-12): the baseline's
build (its static Storybook) and the new in two tabs of one Chrome on the A1000, 1920 × 1080 at
1, rounds interleaved; the new frame over the baseline's, the frame holding the wave bake:

| pose | Scenery | stand-alone `Ocean` |
|--|--|--|
| 2 m | 0.62 | 0.32 |
| 30 m | 0.51 | 0.33 |
| 300 m | 0.62–0.66 | 0.31–0.34 |
| 2 km | 0.65–0.69 | 0.43 |
| 20 km | 0.76 | 0.57 |
| 100 km | 0.90 | – |
| 1000 km | 0.82 | – |
| down, 2 km | 0.62 | 0.39 |

- The stage's surface draw is 0.9–1.9 ms (was 2.3–3.8), the stand-alone sea's 0.5–0.8 ms (was
  3.0–3.6). The tonal patches and the ripple and foam noise are gone; the waves are three
  layers' textures and the ripples one more read.
- From high up the bake would be most of the sea's cost: layers no pixel resolves from the
  camera's height are not baked (`renderWaves`' camera), and past the detail fade no layer is
  read. Without either, 1000 km read 1.13 and 100 km 1.0.
- A `Scenery` bakes its sea's waves only while something that reads them can show: the sea's
  surface from the air, or the view in the water. Below the seabed, and over a dry sea (its
  water off: the seabed alone, no surface drawn), the bake waits while the sea's clock runs
  on. Over a dry sea from 1.8 Mm up it had cost 1.4 ms of main thread a frame.
