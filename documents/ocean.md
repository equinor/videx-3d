# Ocean

The `<Ocean>` component renders a stylized, animated water surface tuned for
oil-field scale (tens of km). Waves are sampled from a North-Sea JONSWAP
spectrum driven by a single physical input — wind speed (m/s) — and
reconstructed per-pixel, so the surface stays detailed when zoomed in and
artifact-free when zoomed out. It composites correctly with subsurface geometry
through the `OITRenderPass`.

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
follow from it (≈ 10 m/s ⇒ ~2 m significant wave height). Colours, foam,
reflection and opacity are all tunable via props.

Inside a `<Weather>` (see [clouds.md](./clouds.md#the-weather)), `windSpeed` and
`windDirection` left out are the weather's wind: its speed, and the way it blows toward. The
`<Scenery>`'s endless sea and a `ChunkStack`'s water take it the same way. Given, the sea's own
win. The waves also run at the weather's clock's pace (`timeScale`, `paused`), as many seconds a
frame as it ran (`useWeatherStep`): a timelapse races them, a paused weather holds them still.
Its jumps (a `time` set) do not move them.

Far from the camera the detail fades out: between the two distances of
`detailFadeDistance` (default `[15000, 60000]` m) the waves, foam and tonal
patches give way to a flat mirror of the sky. The sun's glint widens by every slope a pixel
cannot show rather than shrinking to a point: the waves too small for its footprint or faded
out with distance, and the small ones no wave stands for once the fine ripples fade, as much
as the wind gives (Cox and Munk's mean square slope, `0.003 + 0.00512 × windSpeed`). So far
off, and from high up, it spreads into a broad soft patch, as seen from aircraft. The `<Scenery>`'s endless
sea takes the same prop. `OceanMaterial.sunGlintSpread` (default 0) widens the
glint further at the same peak, so its path broadens and brightens; the `<Scenery>`
raises it about sunrise and sunset for a broad glitter path.

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

⚠️ The `OceanSampler` reads the waves in the Ocean's own plane. A `Scenery`'s sea far from
the field draws them in charts fixed on the Earth instead (`OceanCharts`, see
[world.md, 4d](./world.md#4d-the-waves-far-off-built-2026-10-27)); a sampler for it is
still to come.

## Water over a chunk stack

A subsurface block can carry its own sea instead of an `<Ocean>` of its own:
declare `water` on the `ChunkStack`.

```tsx
<ChunkStack outline={field} surfaces={column} seabed={seabedId} water={{ depth: 0, windSpeed: 10 }}>
  <Chunk layers={[{ surface: seabed, material: '#c2b280' }, /* ... */]} />
  <Tanker position={[x, 0, z]} heading={heading} />
</ChunkStack>
```

⭐ It belongs to the STACK, not to a layer of a chunk. The sea is a property of
the column — every chunk cut from it stands under the same water — and a lid
covers its whole footprint by design, so two chunks each drawing part of it would
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

The sea takes no part in the depth order, which is what stops it truncating the
ground beneath it: a sea bed above the plane comes THROUGH it rather than being
flattened onto it, and the water body ends at the shoreline. See
`documents/chunks.md` §6.

`seaBedWaterTint` is the one thing that does NOT carry over: it belongs to the bed
material the component draws, and a chunk's sea bed is ordinary geology. The
equivalent is `bedTint`, set on the stack's water and applied to the shallowest
cap. It is depth-dependent rather than flat, because that bed can rise through the
water, and the depth comes from the BED's own grid as a texture — see
`documents/chunks.md` §6.4.1.

⭐ **Depth-driven appearance needs that grid, and a `ChunkStack` is the only thing
that supplies one today.** `shoalDepth`, `shoalOpacity`, `shoreFoam`,
`shoreFoamDepth` and `swash` are ordinary `OceanWaterProps`, so a standalone
`<Ocean>` accepts them — but with no bathymetry the shader has no depth input and
they do nothing. ⚠️ Without it the water body's colour is mixed by the VIEW ANGLE
as a stand-in for depth, which cannot tell a metre of water over a bank from the
open sea. See `documents/chunks.md` §6.6.

**Floating objects work here.** The stack provides the same wave sampler and
contact-foam registry an `<Ocean>` does, so a vessel heaves and spreads foam with
nothing extra wired. ⭐ The sampler is bound to the sea's LEVEL, so heights come
back absolute in the stack's frame: place the object at the water plane rather
than inside a group at sea level.

⚠️ The sea needs an `outline` on the stack — a `cutSource` alone gives nothing to
draw it over.

⚠️ `displacement` needs a surface fine enough to displace. The lid is
triangulated from the stack's outline, so give it a target edge length —
`water: { displacement: true, resolution: 100 }` — and remember it applies over
the whole footprint. Without displacement the waves are shaded per pixel and the
lid can stay at its minimum.

See the **Components / Misc / Ocean** stories for an interactive demo of every
variant plus the buoyancy boxes, and **Spikes / Chunks / SyntheticColumn** for
water over a chunk stack.

## Measuring

Time the sea on **debug / Ocean / Sea Bench**
(`src/components/Ocean/debug/SeaBench.stories.tsx`): the stand-alone `Ocean` (a 50 km plane,
story `StandAloneOcean`) or a `Scenery`'s endless sea with a stage over the field as in its
Timelapse (`Default`), with the same sun (10:00 on the scenery stories' date and place), wind
and poses, in a canvas of a fixed size at a fixed pixel ratio (1920 × 1080 at 1 by default).
`clouds` adds a sky preset's clouds (`SceneryClouds`, medium).

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
