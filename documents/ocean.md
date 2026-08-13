# Ocean

The `<Ocean>` component renders a stylized, animated water surface tuned for
oil-field scale (tens of km). Waves are sampled from a North-Sea JONSWAP
spectrum driven by a single physical input — wind speed (m/s) — and
reconstructed per-pixel, so the surface stays detailed when zoomed in and
artifact-free when zoomed out. It composites correctly with subsurface geometry
through the `OITRenderPass`.

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
`Tanker` component for a full example). Both are no-ops outside an `<Ocean>`.

## Water inside a chunk

A subsurface block can carry its own water instead of an `<Ocean>` of its own:
declare `water` on the layer that is sea level.

```tsx
<Chunk layers={[
  { depth: 0, opacity: 0.6, water: { windSpeed: 10, foamAmount: 0.5 } },
  { surface: seabed, material: '#c2b280' },
  // ...
]} />
```

The sea state props are the same ones the component takes (`OceanWaterProps` /
`OceanBodyProps`), and the layer gets both materials: the animated surface for
its cap and the water body for the volume below it, which is why `water` also
implies a fill.

`seaBedWaterTint` is the one thing that does NOT carry over: it belongs to the
bed material the component draws, and a chunk's sea bed is ordinary geology. The
equivalent is `bedTint`, set on the water layer and applied to the cap directly
below it. It is depth-dependent rather than flat, because that bed can rise
through the water — see `documents/chunks.md` §6.3.1.

Declaring it makes the layer a **fluid**, which is what stops the sea truncating
the ground beneath it: a sea bed above the plane comes through it rather than
being flattened onto it, and the water body ends at the shoreline. See
`documents/chunks.md` §6.

⚠️ `displacement` needs a surface fine enough to displace. The lid is
triangulated from the chunk's outline, so give it a target edge length —
`water: { displacement: true, resolution: 100 }` — and remember it applies over
the whole footprint. Without displacement the waves are shaded per pixel and the
lid can stay at its minimum.

⚠️ Buoyancy is not available on this path yet: `useBuoyancy` reads a sampler
provided by `<Ocean>`, and a water layer has no such provider.

See the **Components / Misc / Ocean** stories for an interactive demo of every
variant plus the buoyancy boxes, and **Spikes / Chunks / SyntheticColumn** for
water on a chunk.
