# Trajectory

The `<Trajectory>` component renders a wellbore path as a single instanced tube. It is
the recommended way to draw a trajectory and supersedes the older `BasicTrajectory` +
`TubeTrajectory` composition (see the
[migration guide](./trajectory-migration.md)).

Its defining trait is a **screen-space minimum radius**: the tube reads as a crisp
~1 px line when zoomed out to field scale, and gains real thickness continuously as the
camera approaches — with no LOD popping on the radius itself. Radius is a shader
uniform, so changing thickness never rebuilds geometry, and a single generator produces
a single geometry per wellbore.

It is a good citizen in a host R3F app: OIT-compatible, works with the `Highlighter` and
the `EventEmitter` picking system, and honours the standard `CommonComponentProps` /
`CustomMaterialProps`.

## Basic usage

`Trajectory` must be a child of `Wellbore`. Wrap it in a `WellboreBounds` so the
distance-driven level-of-detail works (see [LOD](#level-of-detail-lod)):

```tsx
import { Wellbore, WellboreBounds, Trajectory } from '@equinor/videx-3d'

<Wellbore id={wellboreId}>
  <WellboreBounds id={wellboreId}>
    <Trajectory color="red" radius={1} />
  </WellboreBounds>
</Wellbore>
```

It depends on the `trajectory` generator — register it (or the default
`generateTrajectory`) in your `GeneratorRegistry`. See the
[generators docs](./generators.md).

## Radius and the screen-space floor

| Prop | Meaning |
|--|--|
| `radius` | Real-world tube radius in metres (a shader uniform — changing it never rebuilds geometry). |
| `minPixelRadius` | Screen-space floor: the tube never renders thinner than this many pixels, so it stays a visible ~1 px line at field scale. Set to `0` to disable. |

Because the floor is applied in the shader, a whole field of wells stays readable when
zoomed out while each well thickens smoothly as you fly in.

## Level of detail (LOD)

The tube uses a coarse **radial-segment** LOD (it does not change the radius). The high
LOD is used within `lodDistance` of the camera, the low LOD beyond it, and the end caps
are dropped on the low LOD:

| Prop | Default | Meaning |
|--|--|--|
| `radialSegments` | `12` | Radial resolution up close. |
| `lowRadialSegments` | `4` | Radial resolution at field scale. |
| `lodDistance` | `2000` | Camera distance (metres) below which the high LOD is used. |

The distance comes from the `DistanceContext` published by `WellboreBounds`. **Without a
`WellboreBounds` ancestor the distance is treated as infinite, so the low LOD is always
used** — always wrap `Trajectory` in a `WellboreBounds`.

## Opacity and transparency

Opaque by default. Set `opacity` below `1` for a semi-transparent tube. The material is
OIT-compatible, so under an `OITRenderPass` the transparency resolves
order-independently; with the default R3F render loop it uses standard alpha blending.

```tsx
<Trajectory color="red" radius={1} opacity={0.5} />
```

## Rim shading

A subtle silhouette darkening gives the tube 3D form while keeping the centre exactly
the assigned `color` (important when the colour encodes data):

| Prop | Default | Meaning |
|--|--|--|
| `shadingColor` | `#000000` | Colour the silhouette darkens toward. |
| `shadingStrength` | `0.6` | Darkening amount at the silhouette (`0` = flat). |
| `shadingFalloff` | `2` | Rim exponent: higher hugs the silhouette (broad exact-colour front), lower spreads inward. |

## Texture map

An optional albedo texture is combined with `color` (the tube centre reads as
`color × texel`); the trajectory is unlit, so only a colour map is meaningful.

```tsx
<Trajectory color="white" radius={2} map={texture} mapUvUnits="world" />
```

`mapUvUnits` controls the UV units:

- `'normalized'` (default) — azimuth `0..1` around × curve position `0..1` along, so the
  texture fits the whole well.
- `'world'` — circumference metres × measured-depth metres, so `map.repeat` sets a
  world-consistent texel density independent of tube length/radius.

## Depth markers

Opt-in bands drawn every `depthInterval` metres of **measured depth (MSL)** along the
tube — a lightweight depth reference:

| Prop | Default | Meaning |
|--|--|--|
| `depthMarkers` | `false` | Enable the bands. |
| `depthInterval` | `100` | Spacing between markers (metres). |
| `depthMarkerColorMode` | `ContourColorMode.darken` | How the band modulates the colour: `darken` / `lighten` / `mixed`. |
| `depthMarkerColorModeFactor` | `0.5` | Modulation strength (`0..1`). |
| `depthMarkerColor` | `#000000` | Target colour for the `mixed` mode. |
| `depthMarkerWidth` | `1` | Band thickness in metres. |
| `depthMarkerOffset` | `0` | Metre offset applied to the MSL datum (e.g. set to RT elevation or a kickoff depth). |

## Interval colouring

For data visualisation you often want every trajectory to share one diffuse `color` but
colour **intervals** of the path by data. Pass `colorIntervals` — an array of
`{ from, to, color }`, where `from`/`to` are **measured depth (MSL) in metres**:

```tsx
import { Trajectory, TrajectoryColorInterval } from '@equinor/videx-3d'

const intervals: TrajectoryColorInterval[] = [
  { from: 0, to: 1200, color: '#4e79a7' },
  { from: 1200, to: 2600, color: '#e15759' },
  { from: 2600, to: 4000, color: '#4e79a7' }, // colours may repeat
]

<Trajectory color="#888888" radius={1} colorIntervals={intervals} />
```

Where a point on the tube falls inside an interval, its colour is replaced by that
interval's colour; outside every interval the base `color` is used. Intervals are
expected to be non-overlapping (on overlap the first match wins). Colours are
de-duplicated into a small palette internally and uploaded as compact float textures, so
many intervals may share a colour cheaply. **Memoize the array** — passing a new
reference rebuilds the textures.

## Picking and highlighting

`Trajectory` supports GPU picking and the `Highlighter` out of the box — capabilities the
legacy `BasicTrajectory` / `TubeTrajectory` did not have. It exposes per-mesh
`userData.emitterMaterial` and `userData.highlightMaterial` (which the `PickingHelper`
and `Highlighter` prefer over their defaults), so you register pointer handlers on the
ancestor `Wellbore` (or another listener) as usual — no dedicated registration on the
trajectory itself:

```tsx
<Wellbore
  id={wellboreId}
  onPointerEnter={(e) => highlighter.highlight(e.target)}
  onPointerLeave={() => highlighter.removeAll()}
>
  <WellboreBounds id={wellboreId}>
    <Trajectory color="red" radius={1} />
  </WellboreBounds>
</Wellbore>
```

## Custom material

Pass `customMaterial` (with an optional `onMaterialPropertiesChange`) to fully control
the appearance, exactly as with the other wellbore components.

## See also

- [Trajectory migration guide](./trajectory-migration.md)
- [Generators](./generators.md)
- [Order-Independent Transparency (OIT) Guide](./oit-guide.md)
