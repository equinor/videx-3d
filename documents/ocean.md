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

## Water over a chunk stack

A subsurface block can carry its own sea instead of an `<Ocean>` of its own:
declare `water` on the `ChunkStack`.

```tsx
<ChunkStack outline={field} surfaces={column} water={{ depth: 0, windSpeed: 10 }}>
  <Chunk layers={[{ surface: seabed, material: '#c2b280' }, /* ... */]} />
  <Tanker position={[x, 0, z]} heading={heading} />
</ChunkStack>
```

⭐ It belongs to the STACK, not to a layer of a chunk. The sea is a property of
the column — every chunk cut from it stands under the same water — and a lid
covers its whole footprint by design, so two chunks each drawing part of it would
leave two coplanar lids wherever their footprints overlap. The stack draws it
once, as a two-boundary stack of its own: the level, and the column's shallowest
surface as its bed.

The sea state props are the same ones the component takes (`OceanWaterProps` /
`OceanBodyProps`), and the stack supplies both materials: the animated surface for
the lid and the water body for the volume down to the bed.

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
