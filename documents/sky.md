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

The sun is a disc (`size`, an angular radius in degrees) with a broad halo (`glow`), a
bright glare hugging the disc (`glare`, default 0.5) and, optionally, rays around it
(`rays`, default 0). `shimmer: true` lets the rays brighten and fade slowly, each on
its own cycle. Its colour and the daylight follow the elevation: warm near the horizon,
and the daylight gone below civil twilight (−6°).

`moon` (default on) is a full moon opposite the sun, so it is up at night. The sky has
ONE directional light: the sun's while it is up, the moon's once the sun is well down
(it fades in between −6° and −12°). `stars` (default on) come out once it is dark.

Disc, glare, rays, moon and stars are left out of the environment and light-probe bakes
— the directional light already carries that light — so they never light the scene twice.

⚠️ Without tone mapping the disc is display white. With it (the renderer's
`toneMapping`, or `hdr: true` when a pipeline pass tone maps instead), the disc goes 16×
past white, as a bright sun should.

## Clouds

`clouds` (default off) adds a deck of still clouds, seen from below and lit by the sun,
or the moon at night:

```tsx
<Sky clouds={{ coverage: 0.5, altitude: 6000, scale: 4000, seed: 3 }} />
```

`coverage` is how much of the sky they cover, `scale` the size of the clouds and
`softness` the width of their edges; `seed` picks another pattern. They fade into the
haze toward the horizon, and out as the camera climbs to the deck.

The sun shows through all but the thickest parts: a softened disc through thin cloud,
a glow around it and bright silver edges where cloud thins in front of it. The moon does
the same at night; the stars are hidden.

⚠️ `altitude` is measured along `up` from the world origin, not from sea level. The
clouds are part of the background only: the water does not reflect them, and they do
not dim the scene's light.

## Lighting the scene

`environment` bakes the sky into `scene.environment` (lights MeshStandard and
MeshPhysical materials) and `lightProbe` into a `LightProbe` (lights every
`lights: true` material). Both default on. ⚠️ With both, MeshStandard materials receive
the sky's diffuse light from each.

The bakes are made once for each zone the camera can be in — the air over the sea, the
water in it and, below the seabed (or the abyss level), the `subsurface` — and swapped as
the camera crosses a level, so a moving camera never bakes. In the water the light dims
with depth. The sky is baked again when it changes; while it keeps changing (a slider
being dragged) at most once per `capture.interval` (default 250 ms).

`subsurface` is the light where the sky's own means nothing: below the seabed, and
wherever the sky is not drawn (`background: false`). By default it is a studio — a dark
backdrop with soft light panels above and below the horizon (see `SkyStudio`). Pass an
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
below the water. The seabed's look (`SkySeabed`) is lit with the model and options of a
`ChunkMaterial`, so a chunk layer given the same colour and detail continues it without
a seam.

To fog a `ChunkStack` as the sea fogs its own seabed, hand it the sea's water:

```tsx
const waterFog = useSkyWaterFog() // inside the <Sky>

<ChunkStack waterFog={waterFog} /* ... */ />
```

⚠️ `useSkyWaterFog` reads the enclosing sky, so call it in a child of `<Sky>`, and lift
the value out with state if the stack lives elsewhere. Leave it off an occupant that
drains its water.

The sea is part of the background, so on its own it never hides anything in the scene.
To have the water in FRONT of the scene, add a stage.

## SkyBoxStage

`<SkyBoxStage>` puts the sky's sea and seabed on real geometry between the scene and the
background, drawn with the sky's own shading so the two meet without a seam. Being
geometry, the water lies in front of what is under it, and the opaque seabed hides what
is below it — unless the camera is below it too. It reaches the camera's far plane
beyond `bounds`, so every view ray that can reach the scene crosses it.

```tsx
<Sky ocean={{ level: 0, depth: 120 }}>
  <SkyBoxStage
    bounds={[minX, minZ, maxX, maxZ]}
    occupant={{ outline, seabed: false, elevations, elevationAt }}
  />
</Sky>
```

`bounds` is the scene's rectangle in scene X/Z, and should hold the whole scene. An
`occupant` claims part of it — typically a field column:

- `water: false` drains the water over the outline, walled in by the sea around it.
- `seabed: false` when the occupant draws its own seabed. Given its heights along the
  outline (`elevations`), the stage's seabed starts there and eases to the sea's depth
  over `seabedFalloff` (default 3000); given `elevationAt`, it also cross-fades into the
  occupant's seabed over `seabedBlend` (default 500) inside the outline.
- `tolerance` holds that cross-fade in front of a seabed the occupant draws from its own
  tessellation rather than from `elevationAt`.

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
surface (the seabed, with the camera in the water); waves bend the line, a rim marks it
and a shadow falls just inside it. The scene itself — the occupant, the data — is never
cut.

```tsx
<Sky ocean cutaway={{ reach: 0.5, rim: { width: 3 }, shadow: { opacity: 0.5 } }} />
```

- `reach` is the frame row the edge sits on when looking level; tilting down raises it,
  and from `exitTilt` (default 45°) it slides out of the top of the view.
- `zoomFollow` is how much of a zoom its size follows on screen: 1 keeps it fixed in
  the frame, 0 fixed in the world. It has its frame size with the camera `reference`
  high (default half the width of a stage's occupant).
- `waterOpacity` / `seabedOpacity` keep some of the water or seabed in the cut.

## Rendering

The sky draws before everything else (`renderOrder` −1e9), and its sea surface as a
second fullscreen layer right after it. It works with R3F's own render and with a
`RenderingPipeline` of `OITRenderPass` + `OutputPass`.

⚠️ R3F applies the Canvas `gl` props again whenever the Canvas re-renders, undoing
anything set on the renderer since. Set tone mapping that should change at runtime on
the renderer from an effect, and use the Canvas `flat` prop rather than
`gl={{ toneMapping: NoToneMapping }}`; otherwise the next re-render resets it.

## Performance

- The shaders are large, and the first frame stalls while they compile. Measured cold
  on an Intel Iris Xe laptop (ANGLE / Direct3D 11): the background ~2.5 s, the sea
  surface layer ~1.7 s, a stage's surface ~1.6 s, each seabed part ~0.4 s. Clouds add
  ~0.4 s to the background.
- Switching `ocean`, `abyss`, `clouds`, the seabed's `detail` or the sea's wave count
  recompiles; every other option only changes uniforms.
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
| `sky-context.ts` | `useSky`, `useSkyOcean`, `useSkyWaterFog` |
| `shaders/sky.glsl` | the sky itself: gradient, sun, night, clouds, void, `skyRadiance` |
| `shaders/sky-ocean.glsl` | the sea: surface, water, seabed, cutaway |
| `shaders/stage-fragment.glsl`, `sky-surface-fragment.glsl` | the stage's parts, and the sea surface layer |

- The stage's materials and the baker's share the background material's UNIFORM
  OBJECTS, so they follow every change to it. Defines are copied: the ones a stage needs
  are listed in `SKY_SHARED_DEFINES`; background-only switches (`SKY_CLOUDS`) are not,
  and the baker copies its switches in `sync()`.
- The water fog (`sdk/materials/shaderLib/water-fog.glsl`, `WaterFogUniforms`) and the
  cutaway's edge are shared with `ChunkMaterial`, so a chunk is fogged and cut exactly
  as the sea around it is.
- ⭐ On Direct3D (ANGLE), every call of a shader function compiles a copy of it. A heavy
  function (the waves, a noise) called from two places costs twice the compile time:
  compute it once and pass the result down (see `SkyOceanWave`, `depths` in
  `skyRadiance`).
- ⚠️ Derivatives (`fwidth`) taken after a branch some pixels of a quad have left are
  undefined: take them first, before any early return (see `skyOceanCutawayRimAt`).
