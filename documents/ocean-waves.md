# The sea's waves (wave core)

The `Ocean` and the `Scenery`'s sea used to sum 16 sines per pixel, warp them with two noise
fields so their sum did not show its period, and add four more noise fields of ripples. That
was expensive, it repeated as striping toward the horizon, and the wind could only rewrite it:
a new wind rescaled and turned the whole pattern in one frame. Floating objects followed the
unwarped sum, so they were out of step with the waves drawn.

The wave core replaces that with a **sea state** on the CPU and a few **baked layers** on the
GPU. The `Ocean`, the `Scenery`'s sea and a `ChunkStack`'s water draw it
(`OceanMaterial.renderWaves` each frame, `shaders/sea-layers.glsl` and `ocean-surface.glsl`).

## The sea state (`sdk/weather/sea-state.ts`)

- **The spectrum** (`sea-spectrum.ts`): the wind sea fully developed for the wind (JONSWAP,
  γ 3.3, the `Ocean`'s Hs ≈ 0.21 U²/g), plus swells (height, period, direction), each spread
  about its direction (cos²ˢ; Mitsuyasu's s for the wind sea). Deep water. The variance and
  slope variance of any band of wavenumbers are worked out from it, which a global map of sea
  states will need (see "Across the globe").
- **The layers**: tiles of 2011, 307 and 47 m (`SEA_LAYERS_MEDIUM`), each turned by the golden
  angle, each holding the waves on its own grid, k = R·(2π/size)·(n, m), in its band of
  wavenumbers, up to 4 texels a wavelength of a 128² tile. A layer tiles exactly.
- **The pool**: each layer draws at most 256 waves, the strongest its spectrum asks for; each
  has a fixed random amplitude factor (Rayleigh) and phase. A wave leaves the pool only once it
  has eased out, and joins at no amplitude, so nothing pops. Each layer's targets are scaled so
  its band keeps the spectrum's height variance.
- **Over time**: a wave's length and direction never change, so neither does its speed. The
  wind only eases amplitudes toward the spectrum's, each over `response` of its own periods (3
  by default, a new wind sea in a minute or two; `SEA_RESPONSE_REALISTIC`, 900, hours). Phases
  follow the clock alone, φ = φ₀ − ω·t, so two seas on one clock and seed are the same sea.
- **Outputs**: per layer, a table of (kx, kz, a·cos φ, a·sin φ) for the GPU; `heightAt` for
  floating objects, summed exactly as the GPU sums them; statistics, with the slope variance no
  wave draws (Cox and Munk's, less what the layers draw).

## The bake and the surface

- `SeaWaveBake` (`components/Ocean/sea-wave-bake.ts`) sums each layer's table into a 128²
  half-float tile every frame, one pass a layer: slope, height, and |slope|², with mipmaps. Down
  the mips, |slope|² less the square of the slope is the slope variance a texel spans, which
  roughens the glint, so what a pixel cannot show still scatters the light.
- **Hex tiling** (`sdk/weather/sea-hex.ts`, `shaders/sea-hex.glsl`): a tile read as it is
  repeats visibly within its own scale (a repetition score of 0.5–0.6, against today's 0.1–0.4).
  Each layer is read as three copies of its tile, shifted (never turned, so the waves still run
  downwind) by a random offset per hexagonal cell smaller than the tile, blended
  variance-preservingly. CPU and GPU hash the cells in the same 32-bit integers, so
  `heightAt` blends the same copies.
- The surface reads each layer at one mip for the three copies; past its coarsest mip all of a
  layer lies below the pixel, and only its slope variance is added, with no fetch. Past the
  detail fade (`detailFadeDistance`) no layer is read at all. The mips come from the pixel's
  size, taken once, so the reads may sit under branches.
- **The detail octave** (`SeaState.detail`): the finest layer's texture read again,
  `SEA_DETAIL_SCALE` (6.4) times smaller, turned apart and on its own hex cells, for the
  ripples below the finest layer's band (1.5 m down to 0.23 m in `medium`, the band `high`
  bakes a fourth layer for) at no bake of its own. Its gain gives it the spectrum's slope
  variance in that band over what the finest layer draws, so it eases with that layer, and
  what it draws leaves the glint's residual. A scaled copy's waves run too slowly for their
  size, so it slides downwind at the band's phase speed, under cells that stay put (a whole
  tile's slide changes nothing, so it never pops).
- **Bake only what shows**: given the camera and its height over the sea, `renderWaves` skips
  the layers whose whole tile a pixel there spans (`SEA_BAKE_PIXEL_MARGIN`, 2): the surface reads
  none of them. A layer of tile `size` stops once the camera is higher than
  size · rows / (2 · margin · tan(fov / 2)): with 1080 rows and a 50° view, the 47 m layer from
  about 27 km up, the 307 m one from 180 km, the 2011 m one from 1160 km.
- **Whitecaps** (`oceanWindFoam`, `oceanFoam`): the share of the sea the wind's whitecaps
  cover (Monahan and O'Muircheartaigh 1980, 3.84·10⁻⁶·U^3.41; `foamAmount` 0.5 as measured),
  as a threshold on the wind sea's crests in standard deviations (all but the longest layer,
  broken up by the finest and the ripples); sub-pixel, the share itself. No noise of its own.

## Measured (2026-11-12, NVIDIA RTX A1000, 1920 × 1080 at 1)

The bar was today's wave core: the `Ocean`'s surface less the same surface with a flat wave
normal. Both seas drawn in the same frames, three interleaved rounds:

| pose | today's core | the new core: draw | bake | total |
|--|--|--|--|--|
| 30 m | 2.05 ms | 0.45 | 0.47 | 0.92 |
| 300 m | 1.84 | 0.46 | 0.47 | 0.93 |
| 2 km | 1.48 | 0.55 | 0.47 | 1.02 |
| 20 km | 0.83 | ≈ 0 (every layer past its mips) | 0.47 | ≈ 0.5 |
| down, 2 km | 1.58 | 0.56 | 0.45 | 1.01 |

- Timed alone in its own frames the bar read lower (1.2–1.4 ms near the sea, 0.51 at 20 km): a
  lighter frame runs at a lower clock. 20 km is about level with that.
- The bake is a fixed cost, 0.45–0.5 ms, whatever the sea covers; a timer query over a held
  render loop read 15 ms for it, the GPU idling for the CPU.
- Hex tiling cost 0.6–0.95 ms with two textures a layer and gradient fetches; one texture, one
  mip a layer and the skip past the mips brought it to the figures above.
- **Repetition** (top-down, the strongest autocorrelation beyond 6 correlation lengths, the
  lighting's gradient filtered out): 300 m 0.15 (today 0.10; plain tiles 0.48), 2 km 0.16
  (today 0.29; plain tiles 0.61). Today's 2 km shows long regular streaks; the core's none.
- **Floating objects**: the tiles read back against `heightAt`, correlation 1.0 (errors under
  1 mm); as drawn, hex blend and bilinear filtering included, 0.998 for the 2 km layer, 0.9999
  for the others. Today's: 0.065.
- **Wind**: 10 → 15 m/s and 90° → 120° continue the same waves; the sea grows (Hs 2.1 → 2.9 m
  a minute on, toward 4.8) and turns over two minutes.
- **The sea state on the CPU**: 0.05 ms a frame; 7 ms when the wind or swells change.

## Measured on the Iris Xe (2026-11-12, 1920 × 1080 at 1)

The medium preset's hardware, where the ratios differ from the A1000's: a filtered half-float
fetch is dear, arithmetic cheap.

| pose | today's core | the new core: draw | bake | total |
|--|--|--|--|--|
| 30 m | 1.00 ms | 0.78 | 0.60 | ≈ 1.4 |
| 300 m | 0.67 | 0.93 | 0.60 | ≈ 1.5 |
| 2 km | 0.38 | 1.23 | 0.60 | ≈ 1.8 |
| 20 km | 0.88 | 1.16 | 0.60 | ≈ 1.8 |
| down, 2 km | 0.64 | 1.32 | 0.60 | ≈ 1.9 |

- Today's core reads ±0.5 ms from round to round; the new core's are steady.
- **The bake** costs about the same as on the A1000, 0.60 ms; waves a layer barely matter
  (256 → 64 saves 0.12 ms), so most of it is per pass.
- **The surface's fetches**: the layers read plainly cost 0.77 ms over a flat normal (300 m),
  hex-tiled 1.43 ms, hex-tiled with a hash of no integer multiplies (which Intel's GPUs emulate)
  1.02 ms.
- **Today's surface** on the Iris Xe is 7.4–8 ms, of which its waves are 5–13 %: 6.5–7.3 ms is
  its tonal patches and foam noise.

So the wave core alone did not pass on the Iris Xe; it is judged by the whole sea's cost
instead, which the tonal patches and foam noise dominate (decided 2026-11-12).

## In the sea (2026-11-12, A1000)

With the core in the `Ocean`'s and the `Scenery`'s surface (the tonal patches and every noise
field but the shore's gone, the whitecaps and the ripples as above), the whole frame is
0.51–0.90 of the baseline's in the `Scenery` and 0.31–0.57 stand-alone, at every pose
(documents/ocean.md, "Measuring").

## Across the globe

A sea state stands for a region's weather. Only the waves near the camera are drawn as waves;
past a few tens of kilometres they are below the pixels, and the sea can be shaded from its
statistics (slope variance, foam cover, colour) read per pixel from a smooth map of sea states
built from the weather systems. Near the camera, where weather changes over hundreds of
kilometres and the waves drawn span tens, the layers are baked for the sea state under the
camera, and each layer can be scaled per pixel by the map's band variance against the bake's,
so a front shows as a gradient in the waves, not an edge. As the camera moves into other
weather the bake eases toward it as it does for the wind.

## Still to do

- **The whole sea on the Iris Xe**, against the baseline (documents/ocean.md, "Measuring"),
  and the presets tuned there: layers, texels, hex tiling per layer.
- **Ripples with the wind**: JONSWAP's tail holds a fixed Phillips constant, so the waves well
  below the peak, and the ripples, are the same at 3 m/s as at 10 (only the residual's Cox and
  Munk slopes follow the wind). A short-wave range that grows with the wind (Elfouhaily et
  al. 1997) would calm them.
- **Glitter**: the ripples no layer draws only widen the glint, so it is a smooth patch where
  the sea sparkles.
- **Into the sea**: `Weather` (`swell`, one sea state shared), the `Scenery`'s far charts for
  floating objects, gusts and slicks as roughness (where the tonal patches were), the whitecaps'
  life (streaks downwind, decay), the water's optics.
