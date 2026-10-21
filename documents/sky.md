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
civil twilight (−6°). At night the sky and the sea keep 7.5% of their light
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
invalid one (no real date, a latitude past ±90) falls back to the sky above.

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
  fainter ones. Each comes out as the sky darkens enough for it: the brightest a few
  degrees after sunset, magnitude 5 once the sun is 11.5° down.
- **Planets:** Mercury, Venus, Mars, Jupiter and Saturn, from JPL's Keplerian elements
  (valid 1800–2050, within a fraction of a degree), as bright as they are (Saturn's rings
  aside): Venus is out by sunset. They come and go with `stars`.

A star of magnitude m is drawn `0.08 · 10^(0.2 (5 − m))` bright — the square root of its
light, as the eye compresses it — and wider the brighter it is. The catalogue is looked
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

`clouds` (default off) adds a deck of still clouds, seen from below and lit by the sun,
or the moon at night:

```tsx
<Sky clouds={{ coverage: 0.5, altitude: 6000, scale: 4000, seed: 3 }} />
```

`coverage` is how much of the sky they cover, `scale` the size of the clouds and
`softness` the width of their edges; `seed` picks another pattern. They fade into the
haze toward the horizon, and out as the camera climbs to the deck.

Turning `clouds` on or off recompiles the sky. To switch them often, keep `clouds` set
and toggle `enabled` instead: they stay compiled in, so it is instant, and while hidden
they cost a single branch.

The sun shows through all but the thickest parts: a softened disc through thin cloud,
a glow around it and bright silver edges where cloud thins in front of it. The moon does
the same at night; the stars are hidden. The moon takes over as the sun's light ends
(−6°) and fades in as the scene's moonlight does, so the hand-over shows nothing.

⚠️ `altitude` is measured along `up` from the world origin, not from sea level. The
clouds are part of the background only: the water does not reflect them, and they do
not dim the scene's light.

## The air

`air` (default on) thins with height, so the sky changes as the camera climbs: the
zenith deepens toward a saturated blue (a grey sky stays grey) and the haze at the
horizon closes onto it. Seen from low down, the far sea fades into the horizon's
colour; from high up it stays clear much further out.

```tsx
<Sky air={{ scaleHeight: 8000, visibility: 60000 }} />
```

`scaleHeight` is the height over which the air thins by e (0 for no change with
height), and `visibility` the distance over which the air at sea level hazes the sea
by e (0 for no haze). Heights are measured from the sea's `level` (the void's lid
without a sea). `air: false` turns both off.

The bakes film near the level, so the scene's light does not change with the camera's
height. The sea's surface is hazed; the seabed seen through cut-away water is not.

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
at least every `capture.maxWait` (default 1000 ms).

`subsurface` is the light where the sky's own means nothing: below the seabed, and
wherever the sky is not drawn (`background: false`). By default it is a dark backdrop
with soft light panels above and below the horizon (see `SkySubsurface`). Pass an
equirectangular or cube texture to use a map of your own instead.

`background: false` hides the sky (and its stage) instantly: nothing is rebuilt or baked
again, and the scene stays lit, by the subsurface.

## The endless sea

`ocean` adds a sea: a wavy surface at `level` over a flat seabed `depth` below it, seen
from above, from inside the water and, below the seabed, as the void.

```tsx
<Sky ocean={{ level: 0, depth: 100, windSpeed: 10, waterOpacity: 0.8 }} />
```

The water takes the `<Ocean>` component's props under the same names (see
[Ocean](./ocean.md)), so one object can drive both; the sun and the reflected sky come
from the sky. `water: false` leaves the seabed dry; `seabed: false` leaves the void
below the water. `seabedOpacity` (default 1) lets the void, or the scene under a stage's
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
beyond `bounds`, so every view ray that can reach the scene crosses it.

```tsx
// the column's sea bed, clipped to its outline in the scene frame, built where the data is
const generate = useGenerator<SkySeabedResponse>(skySeabed)
const [seabed, setSeabed] = useState<SeabedMesh | null>(null)
useEffect(() => {
  generate?.(meta.id, outline.coordinates, [origin.x, origin.z], maxError).then(setSeabed)
}, [generate, meta, outline, origin, maxError])
const [cut, setCut] = useState<CutUniforms | null>(null)
// the column's own, once its build has finished: exact against its cut faces
const [built, setBuilt] = useState<SeabedMesh | null>(null)
const [stage, setStage] = useState<SkyBoxStageOccupantState>({
  seabed: false,
  seabedOpacity: 1,
  water: false,
})

<Sky ocean={{ level: 0, depth: 120 }}>
  <SkyBoxStage
    bounds={[minX, minZ, maxX, maxZ]}
    occupant={{ seabed: built ?? seabed ?? undefined, cut: cut ?? undefined, onStage: setStage }}
  />
</Sky>
<ChunkStack outline={outline} seabed={meta.id} water={water} drawWater={!stage.water} onCut={setCut} onSeabed={setBuilt} /* ... */>
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

`bounds` is the scene's rectangle in scene X/Z, and should hold the whole scene. An
`occupant` claims part of it — typically a field column. The sky's sea is global: its
`water`, `seabed` and their opacities hold over the occupant as everywhere else.

- `seabed` (a `SeabedMesh`) hands the occupant's seabed to the stage, which draws it as
  the sea's own: lit, coloured, under the water and at the sea's `seabedOpacity` exactly
  as the sea's seabed, and never cut by the cutaway. Its rim is the occupant's outline.
  The stage's seabed starts on that rim and eases to the sea's depth over
  `seabedFalloff` (default 3000), meeting it vertex for vertex. Without one — the
  occupant's top is not the sea bed, say — the stage's flat seabed lies under the
  occupant too.
  `createSeabedMesh` (sdk) makes one from a surface, clipped to the outline in the scene
  frame; the `skySeabed` generator (`generateSkySeabed`) runs it where the generators
  run, so the surface's grid never has to reach the main thread. The stage wraps its
  arrays without copying them: hand a new one rather than changing it. Its `normals`
  are optional; without them the stage computes its own, facing up.
  A `ChunkStack` hands out its own sea bed through `onSeabed` once its build has
  finished (`stackCapSeabed` turns a built cap into one): the very triangles its walls
  and section and fence faces were built against, so they meet with no seam. A
  re-tessellation agrees with them only within its `maxError` — hairline gaps along a
  cut — so hand the generated one while the column builds, and the column's own once
  it is there, as above.
- `cut` is the occupant's own cut, which the stage cuts the handed seabed with: a
  section `plane` and a `fence`, as the very uniform objects the occupant's materials
  read (`CutUniforms`), so it follows the cut every frame at no cost. A `ChunkStack`
  hands out its own through `onCut`; anything cut with the same shader pieces (a plane
  uniform, `shaderLib/fence-field.glsl`) can hand out its own. They must be in the scene
  frame. Leave it off while the occupant keeps that seabed whole (`keepCap`).
- `onStage({ seabed, seabedOpacity, water })` tells the occupant what the stage does for
  it, whenever that changes:
  - `seabed`: the stage draws its seabed — not before the sky has compiled, nor while
    the sky is hidden (`background: false`), nor while the sea has no seabed. Until then
    the occupant draws its own — a chunk layer's `drawCap` — so one of the two always
    draws it, give or take the frame a change takes to reach the occupant.
  - `seabedOpacity`: the opacity the stage draws it at. Below 1, the occupant must not
    cull what lies under it: hand it on as the layer's `capOpacity`.
  - `water`: the stage owns the water over the occupant, with the sea's `water` on or
    off. A `ChunkStack` then hides its own (`drawWater={false}`), which shows and hides
    it without a rebuild.

  All three reset (`false`, 1, `false`) once the stage is gone.

⚠️ The stage's seabed is flat apart from the occupant's. With a field column's top units
peeled away, the occupant hands no seabed, so the flat seabed covers the units left
under the outline unless the cutaway or `seabedOpacity` opens it.

⚠️ The handed seabed is the occupant's surface tessellated again, so along the outline
and along a cut it can stand up to about the occupant's `maxError` off the occupant's
own edges (measured on the demo field at `maxError` 5: 0.2 m median, 4.8 m worst).

The stage's transparent parts are ready for the `OITRenderPass`. ⚠️ It assumes the
default `up` (+Y), and renders nothing without a sky `ocean`.

## The void (`abyss`)

`abyss` puts an endless lid overhead below a `level` and a bottomless gradient below the
horizon, so a camera under the ground does not see the sky. It is part of the
background, so it never hides anything in the scene, including objects above the level.
The lid recedes into the horizon colour (`fadeDistance`) and has a noise relief
(`detail`, `detailScale`); the depths have faint distant rock (`depthDetail`) and a
`falloff`. A sea turns the void on below its seabed by itself.

## Cutaway

`cutaway` cuts the sea's water and seabed away in front of the view, so what lies under
them is seen clearly — an illustration's cutaway rather than a realistic one. It cuts
everything nearer than a line across the view where a row of the frame meets the
surface (the seabed, with the camera in the water or the sea dry); waves bend the line,
a rim marks it and a shadow falls just inside it. The scene itself — the occupant, the
data, an occupant's seabed — is never cut. With the camera in the water, the cut takes
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

The sky draws before everything else (`renderOrder` −1e9), and its sea surface as a
second fullscreen layer right after it. It works with R3F's own render and with a
`RenderingPipeline` of `OITRenderPass` + `OutputPass`.

⚠️ R3F applies the Canvas `gl` props again whenever the Canvas re-renders, undoing
anything set on the renderer since. Set tone mapping that should change at runtime on
the renderer from an effect, and use the Canvas `flat` prop rather than
`gl={{ toneMapping: NoToneMapping }}`; otherwise the next re-render resets it.

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

## Debugging

`<Sky debug={...}>` tints each part by what draws it (`tint`), hides layers (`hide`) and
shows the environment's bake for the zone in view (`environment`). `<SkyBoxStage
debug={...}>` hides stage layers, and draws its outline and wireframe over everything.
None of them rebuild or bake anything.

The Storybook stories `Spikes/Sky/StageDebug` (a synthetic seabed occupant, every
option and debug view) and `Spikes/Sky/Baseline` (a real field) exercise all of it.

## For maintainers

| File | Role |
|--|--|
| `Sky.tsx` | the component: props → material, the directional light, the bakes, the cutaway's per-frame placement |
| `sky-model.ts` | option types, defaults, and the pure rules (`skyZone`, `skyDaylight`, `skyMoonlight`, `skySunColor`, …) |
| `sky-material.ts` | `SkyMaterial`: the background's shader and the uniform objects everything else shares |
| `sky-baker.ts` | bakes the environment and light probe per zone (internal) |
| `sky-stage.ts`, `SkyBoxStage.tsx` | the stage's geometry and materials |
| `sky-defs.ts`, `generators/sky-seabed-generator.ts` | the `skySeabed` generator: an occupant's seabed, built where the data is |
| `sky-context.ts` | `useSky`, `useSkyOcean` |
| `shaders/sky.glsl` | the sky itself: gradient, sun, night, clouds, void, `skyRadiance` |
| `shaders/sky-gradient.glsl` | the gradient alone |
| `shaders/sky-stand-in-fragment.glsl` | the stand-in drawn while the sky compiles: the void's gradient |
| `shaders/sky-ocean.glsl` | the sea: surface, water, seabed, cutaway |
| `shaders/stage-fragment.glsl`, `sky-surface-fragment.glsl` | the stage's parts, and the sea surface layer |

- The stage's materials and the baker's share the background material's UNIFORM
  OBJECTS, so they follow every change to it. Defines are copied: the ones a stage needs
  are listed in `SKY_SHARED_DEFINES`; background-only switches (`SKY_CLOUDS`) are not,
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
  from the scene: ~1000 km triangles crack where the GPU clips them. Without an occupant
  the seabed lies on the same mesh; with one, on rings around the relief's rectangle
  (`skyStageNearBounds`, `createSkyStageRings`), which share their inner edge with it.
- ⭐ An occupant's seabed is the stage's `occupant-bed` part: the relief's shading
  (`STAGE_BED`, `STAGE_RELIEF`) plus `STAGE_OCCUPANT`, which holds it whole after the
  cutaway has cleared the water over it. The relief is built on its rim (`skyStageRim`),
  its boundary loops, so they share its vertices; the camera's ground (`oceanGround`) is
  read from it too. Without a relief, the flat near bed is holed along the same rim
  (`createSkyStageBed`).
- Below a `seabedOpacity` of 1 the seabed parts compile with `STAGE_SEE_THROUGH`:
  transparent, without depth writes, and with the seabed's opacity as their alpha rather
  than mixed toward the void behind them.
- The occupant's `cut` compiles in as `STAGE_SECTION` / `STAGE_FENCE`, bound with
  `applyFenceField` as every fence-cut material is. Its materials are made apart from the
  stage's others, and their uniforms INHERIT the sky's (`Object.create`) rather than copy
  them, so what the sky adds later still reaches them. The discard waits for the
  seabed's own, after its derivatives are taken.
- ⭐ On Direct3D (ANGLE), every call of a shader function compiles a copy of it. A heavy
  function (the waves, a noise) called from two places costs twice the compile time:
  compute it once and pass the result down (see `SkyOceanWave`, `depths` in
  `skyRadiance`).
- ⚠️ Derivatives (`fwidth`) taken after a branch some pixels of a quad have left are
  undefined: take them first, before any early return (see `skyOceanCutawayRimAt`).
