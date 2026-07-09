# Migrating to the unified `Trajectory`

The new [`Trajectory`](./trajectory.md) component replaces the two-component approach for
drawing a wellbore path. This guide covers upgrading existing code.

## What changes

| Component | Status | Action |
|--|--|--|
| `TubeTrajectory` | **Deprecated** | Replace with `Trajectory`. |
| `BasicTrajectory` | **Kept** | Still useful for a constant ~1 px line and as a fallback (see below). Now defaults to fully opaque with an `opacity` prop. |
| `Trajectory` | **New** | The recommended trajectory component. |

`TubeTrajectory` bakes `radius` and `radialSegments` into the generated geometry (so
changing them regenerates it), draws a second geometry on top of `BasicTrajectory`, and
has no screen-space line floor, GPU picking or OIT support. `Trajectory` covers the same
use case with radius as a shader uniform, a ~1 px field-scale floor, one geometry, and
picking / highlighting / OIT built in.

## The common pattern

The old approach composed **two** components manually — a `BasicTrajectory` (always
drawn, ~1 px) plus a `TubeTrajectory` gated by `Distance` for the near field:

```tsx
// BEFORE
<WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
  <BasicTrajectory color={color} priority={9} />
  <Distance min={0} max={2000}>
    <TubeTrajectory radius={2} color={color} radialSegments={16} priority={8} />
  </Distance>
</WellboreBounds>
```

Collapse it into a **single** `Trajectory`. The screen-space `minPixelRadius` floor
replaces the always-on `BasicTrajectory` line, so no separate line or `Distance` gate is
needed:

```tsx
// AFTER
<WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
  <Trajectory radius={2} color={color} radialSegments={16} priority={8} />
</WellboreBounds>
```

Keep the `WellboreBounds` — `Trajectory` needs it for the distance-driven LOD.

### Prop mapping

| Old | New |
|--|--|
| `TubeTrajectory radius` | `Trajectory radius` (now a live uniform, not baked). |
| `TubeTrajectory radialSegments` | `Trajectory radialSegments` (high LOD) + `lowRadialSegments` (field scale). |
| `BasicTrajectory` (always-on 1 px line) | `Trajectory minPixelRadius` (default `1`). |
| two generators (`basicTrajectory` + `tubeTrajectory`) | one generator (`trajectory`). |

## It is not always a straight swap

The upgrade depends on how the two components were composed. Watch for these cases.

### 1. Overlap with casings / completion

When casings and completion strings are drawn in the near field, you usually do **not**
want the trajectory tube drawn inside them. Gate the trajectory with a `Distance` whose
`min` starts where the casings take over, and let it run to `Infinity` so the ~1 px floor
still shows the whole path at distance:

```tsx
<WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
  <Distance min={showCasingAndCompletion ? 10 : 0} max={Infinity}>
    <Trajectory color={color} radius={1 * sizeMultiplier} radialSegments={8} priority={8} />
  </Distance>
  {/* casings / completion in their own near-field Distance */}
</WellboreBounds>
```

### 2. Showing the path alongside casings / completion

Because the trajectory tube is gated out of the near field (`min` 10, above), draw a
`BasicTrajectory` **always** in the casings/completion block so the path stays visible as
a thin line among them:

```tsx
{showCasingAndCompletion && (
  <Distance min={0} max={10} onDemand>
    <BasicTrajectory color={color} priority={8} />
    <Casings ... />
    <CompletionTools ... />
  </Distance>
)}
```

Draw it **always** — do not rely on the `CompletionTools` `fallback`, which only renders
where completion data is missing (so the path would disappear wherever completion data
exists). This is exactly why `BasicTrajectory` is kept: it is the lightweight "just draw
the path" line for the near field.

### 3. Shared `Distance` blocks

If a single `Distance` wrapped both the tube and other near-field components (e.g.
`Shoes`), give the trajectory its own `Distance` (usually `max={Infinity}`) and keep the
others in their existing range:

```tsx
<Distance min={0} max={Infinity}>
  <Trajectory ... />
</Distance>
{showShoes && (
  <Distance min={0} max={2000}>
    <Shoes ... />
  </Distance>
)}
```

### 4. `BasicTrajectory` opacity

`BasicTrajectory` previously forced a slight transparency (`opacity: 0.95`). It now
defaults to **fully opaque** and exposes an `opacity` prop. If you relied on the old
translucency, set `opacity={0.95}` explicitly.

## See also

- [Trajectory guide](./trajectory.md)
- [Generators](./generators.md)
