# Procedural normal detail

`shaderLib/procedural-normal.glsl` provides texture-free surface detail for
materials: fine granular, brushed or scratched relief added by perturbing the
shading normal in the fragment shader. It needs no normal-map texture, no tangent
attributes and no CPU data — the pattern is generated procedurally from a UV the
material supplies, so it scales automatically with whatever coordinate space that
UV is in.

It is a set of **pure GLSL functions** (no uniforms, no varyings), matching the
rest of `shaderLib`. Any material can adopt it by including the file in its
fragment shader and wiring its own uniforms/controls.

## What it provides

```glsl
// value noise + fbm (dynamic octaves), and x-tiling variants for a seamless wrap
float pnValueNoise2(vec2 p);
float pnFbm2(vec2 p, int octaves);
float pnValueNoise2Tiled(vec2 p, float periodX);
float pnFbm2Tiled(vec2 p, float periodX, int octaves);

// composable pattern heights - sum several to combine them
float pnGranular (vec2 uv, float anisotropy, int octaves, float periodX);
float pnGrain    (vec2 uv, float angle, float sharpness, float uniformity, int octaves, float periodX);
float pnScratches(vec2 uv, float angle, float density, float lengthScale, float halfWidth, float wander, float periodX, float coarseWeight);

// footprint anti-aliasing: fades a layer out (1 near .. 0 sub-pixel) as its finest
// octave shrinks toward a pixel, so high-frequency detail never shimmers with distance
float pnFootprintFade(vec2 uv, int octaves);

// Perturb a view-space normal by a scalar height field, using the screen-space
// surface gradient (Mikkelsen) - no tangent/bitangent needed.
vec3 perturbNormalHeight(vec3 normal, vec3 viewPos, float height);
```

### Patterns

| Function | Look |
|--|--|
| `pnGranular` | isotropic pebble / bead-blasted metal; `anisotropy` (0–1) stretches the cells along `uv.y` |
| `pnGrain` | brushed-metal grain at `angle`; `sharpness` (0–1) thins the ridges, `uniformity` (0–1) blends from an irregular grain to regular flutes |
| `pnScratches` | sparse grooves crossing at varied angles/lengths (a cell/segment field, not parallel lanes); `density` = how many, `lengthScale` = groove length, `halfWidth` = groove width in uv units (pass world-width x frequency for a frequency-independent width), `angle` = orientation bias, `wander` (0–1) = spread of directions around it (0 = parallel, 1 = fully random). Sums a fine family plus a coarse (longer) family weighted by `coarseWeight` - the long grooves are the most repetition-prone AND double the cost, so pass `0` to skip that family entirely (its whole 3x3 loop is then guarded out; drive from a uniform to stay divergence-free). Analytically anti-aliased. |

They return scalar heights, so **combine** them by summing (optionally weighted)
and feeding the total to `perturbNormalHeight`.

### Seamless tiling (`periodX`)

`periodX > 0` makes the noise **tile every `periodX` cells in x**. Pass the number
of cells around a closed surface's circumference so a full (un-cut) cylinder has
no wrap seam; pass `0` to disable. Tiling is exact for `pnGranular` and for
`pnGrain`/`pnScratches` at `angle == 0`; non-zero angles reintroduce a faint seam.

## Using it in a material

Include the file in a **fragment** shader (it relies on `dFdx`/`dFdy`), then, at
the point where the shading normal is available, sample + combine heights and
perturb:

```glsl
#include ../path/to/sdk/materials/shaderLib/procedural-normal.glsl

// ... later, in main(), after the normal is established (uniform control flow):
float h = 0.0;
h += uGranular  * pnFootprintFade(uv, uOctaves) * pnGranular(uv, uAnisotropy, uOctaves, periodX);
h += uBrushed   * pnFootprintFade(uv, uOctaves) * pnGrain(uv, uAngle, uSharpness, uOctaves, periodX);
h += uScratches * pnFootprintFade(uv, uOctaves) * pnScratches(uv, uScratchAngle, uDensity, uLength, uHalfWidth, uWander, periodX, uCoarseWeight);
normal = perturbNormalHeight(normal, -vViewPosition, h * uStrength);
```

`pnFootprintFade` is the **anti-aliasing** term: it fades each layer out as its
finest octave shrinks toward a pixel (with distance or grazing angle), so the
high-frequency normal detail never shimmers. Always fold it in per layer.

The `#include` is resolved by the GLSL plugin at import time, so it also works
for shader strings that are later spliced into a stock material via
`onBeforeCompile` (this is how `CasingMaterial` uses it).

### What the material must provide

The lib imposes nothing on the CPU side; the calling material supplies:

- **`normal`** — the shading normal to perturb, in **view space**.
- **view-space position** — pass `-vViewPosition`; the screen-space gradient of
  the height field is taken from it.
- **a `vec2` uv** — already scaled by the material's frequency. The material owns
  the units (world distance, normalized, radius-based, …), the anchoring, and
  which axis maps to `uv.y` (the grain/stretch axis). This is what makes the
  detail "auto-scale".
- **`periodX`** — the x-tiling period, if a seamless wrap is wanted (pass the number of
  cells around a circumference; else `0`). Tiling is exact for `pnGranular` and for
  `pnGrain`/`pnScratches` at `angle == 0`.
- pattern params (`anisotropy`/`angle`/`sharpness`/`density`; plus `octaves` for the
  fbm-based `pnGranular`/`pnGrain`) and a
  caller-owned **height/strength** scalar (the bump amount; fade by distance).

So the feature's "width" is controlled by the frequency/anisotropy/angle the
caller folds into the UV, and its "height" is the strength scalar passed to
`perturbNormalHeight`. Each material declares its own uniforms and exposes its own
props/controls.

## Example: casings

`CasingMaterial` exposes it per-material (so the outer wall, inner bore and slice
faces can differ) as the `granular` / `brushed` / `scratches` layers of the grouped
`effects` option (type `CasingEffects`) on `CasingMaterialParameters`:

```ts
effects: {
  granular:  { strength, frequency, octaves, anisotropy },
  brushed:   { strength, frequency, octaves, angle, sharpness, uniformity },
  scratches: { strength, frequency, angle, density, length, wander, width },
  // ...alongside the non-surface effects: silhouette, edgeShading, weathering, sectionVariation
}
```

Each layer owns its `strength` (0 = off, and its blend weight) and `frequency` (cells
per world unit) — plus `octaves` for the fbm-based `granular`/`brushed` layers; the
layers simply sum. The material feeds the lib a world-scaled UV (`vWorldUv` =
object-distance arc length × trajectory distance), so the detail keeps a consistent size
across sections of different radius and runs unbroken along the whole string. (The noise
wraps at the lib's internal `PN_WRAP` lattice, which also keeps `fract()` precise at
oilfield scale; the casing shader passes `periodX = 0` because a per-fragment
circumference period stepped with the varying radius and produced concentric banding on
the caps/tapers.) Each layer's height is divided by its own frequency so `strength` stays
roughly frequency-independent. It also adds a subtle albedo groove and stacks on top of
any user `normalMap`. This procedural system **replaces the old `brushStrength`/
`brushWidth` rails**.

