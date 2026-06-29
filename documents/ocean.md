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

See the **Components / Misc / Ocean** stories for an interactive demo of every
variant plus the buoyancy boxes.
