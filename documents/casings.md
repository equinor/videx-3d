# Casings

The `Casings` component renders a wellbore's casing strings (the nested steel
shells lining the borehole) from depth/diameter/type data. It must be a child of a
`Wellbore` and pulls its section data from the `casings` generator.

Each section is drawn as a tube with three distinct faces, each with its own
material so they can be styled independently:

- **primary** — the outer (coated) wall
- **inner** — the bore-facing wall
- **slice** — the freshly-cut cross-section faces exposed when the casing is sliced

The material (`CasingMaterial`) is a `MeshStandardMaterial` at its core, so casings
pick up the scene `environment` (IBL) reflections and match neighbouring
`CompletionTools`. Casing-specific stylization is spliced into the stock PBR shader
via `onBeforeCompile`.

```tsx
<Wellbore id={wellbore.id}>
  <Casings sizeMultiplier={5} />
</Wellbore>
```

## Slicing

The casing can be cut open to reveal its internals:

| Prop | Meaning |
| -- | -- |
| `sliceAngle` | Size of the removed wedge in radians (`0` = full tube, `PI` = half-cut). |
| `sliceOffset` | Offset from the z-axis to the centre of the slice. Set to `0` when `autoSlicePosition` is on. |
| `autoSlicePosition` | Always rotate the slice opening to face the camera. |

The slice/side faces are only drawn when the casing is actually sliced (or in
[schematic mode](#schematic-mode)); an unsliced full tube hides them to avoid
z-fighting on the closed seam.

As an alternative to slicing, set `opacity < 1` to see through the shells.

## Material options

`materialOptions` maps each section to its per-face material parameters
(`primary`, optional `inner`, optional `slice`). It accepts the familiar
`MeshStandardMaterial` PBR knobs (`color`, `roughness`, `metalness`, `map`,
`normalMap`, `envMapIntensity`, …) plus the casing texture-UV units and the grouped
[`effects`](#effects). Each face's `effects` override the component-level `effects`
default for that face only.

> **Keep `materialOptions` a stable reference** (a module-level function or
> `useCallback`). A new function identity every render rebuilds every section's
> materials and forces a per-frame shader recompile — the main cause of sluggish
> casing updates.

The default is `defaultMaterialOptions` (exported from `casings-defs`): a coated
dark-slate exterior, a light-blue bore, darker cut faces, and matte dark shoes that
resist weathering.

## Effects

The grouped `CasingEffects` object (component-level `effects` prop, overridable
per-face via `materialOptions.*.effects`) bundles all the stylization. Every field
is optional and independent; the micro-normal layers (`granular`, `brushed`,
`scratches`) simply sum. Strengths default to `0` (off) unless a preset enables
them.

| Effect | What it does | Key fields (defaults) |
| -- | -- | -- |
| `silhouette` | View-space Fresnel rim darkening that outlines each shell so nested strings read apart (analytically anti-aliased). | `strength` (0), `power` (3 — higher = tighter to the edge) |
| `edgeShading` | Dark band at each section's own top/bottom edges, a fixed world distance from the edge regardless of section length. | `strength` (0), `width` (0.2 m) |
| `weathering` | Procedural, texture-free wear/rust/drips pinned in world space. | `strength` (0), `scale` (1.5 cells/m), `resistance` (1, per-material multiplier) |
| `sectionVariation` | Per-section jitter of the wear so adjacent strings look differently worn rather than following a value ramp. | `0` |
| `granular` | Isotropic value-noise bumps. | `strength` (0), `frequency` (2), `octaves` (3), `anisotropy` (0) |
| `brushed` | Directional fine grain (many thin parallel ridges). | `strength` (0), `frequency` (2), `octaves` (3), `angle` (0), `sharpness` (0.5), `uniformity` (0) |
| `scratches` | Sparse, hair-thin surface scuffs that glint under changing light (very shallow relief; visibility comes from a localized polish, not depth). | `strength` (0), `frequency` (10), `angle` (0), `density` (0.4), `length` (0.6), `wander` (1), `width` (0.15 — hair/needle-thin) |
| `detailQuality` | Fill-rate vs. quality knob — see [Performance](#performance). | `0.6` |

The `granular` / `brushed` / `scratches` layers are built on the shared
texture-free helpers documented in
[Procedural normal detail](./procedural-normal.md); see that page for how the
patterns are generated and anti-aliased.

The component default (`defaultCasingEffects`, exported from `casings-defs`) enables
a subtle silhouette, edge shading, weathering and section variation to help
telescoping strings read apart.

## Schematic mode

`schematic` (boolean, default `false`) switches the casing to an **unlit,
flat-shaded "cutaway diagram"** look rather than realism — for clean, high-contrast
schematics with minimal aliasing.

When enabled it:

- **Locks the slice** to a half-cut that always faces the camera
  (`sliceAngle = PI`, `autoSlicePosition = true`, `sliceOffset = 0`); the incoming
  slice props are ignored.
- Renders each face with **only its flat `color`** — all lighting, environment
  reflections, textures (`map`/`normalMap`) and realism detail (weathering,
  granular/brushed/scratches) are ignored. Per-face colours are preserved.
- Keeps the **`silhouette`** outline for contrast, and still honours `opacity`.

Dropping the specular lighting also removes the dominant source of casing aliasing.
Note that **geometric silhouette-edge** anti-aliasing (the outline against the
background) still relies on the host render pipeline (MSAA / FXAA / SMAA) — a
material can't anti-alias its own outline against the framebuffer.

## Performance

Casings are `MeshStandardMaterial`-based, so at high fill rates (zoomed in, or many
overlapping shells) the dominant per-fragment cost is the stock PBR lighting + IBL,
which is inherent to matching `CompletionTools`. The stylization is designed so that
**an effect that is off (`strength = 0`) costs nothing** — its shader block is a
skipped uniform branch.

For the effects that are on, `detailQuality` (0–1, default `0.6`) trades detail for
speed:

- **Weathering** uses fewer fbm octaves at lower quality (2 octaves at `0`, up to 4
  at `1`).
- The **coarse/long scratch family** only runs at `detailQuality >= 0.66` and is
  skipped entirely below that.
- `detailQuality = 1` reproduces the full-detail reference; drop it toward `0` for
  weak GPUs.

High-frequency detail also fades out with distance so it never becomes an aliasing
signal when zoomed out, and [schematic mode](#schematic-mode) is the cheapest option
of all (no lighting, no procedural detail).
