# The sea's waves (wave core, prototype)

The `Ocean` and the `Scenery`'s sea sum 16 sines per pixel, warp them with two noise fields so
their sum does not show its period, and add four more noise fields of ripples. That is
expensive, it repeats as striping toward the horizon, and the wind can only rewrite it: a new
wind rescales and turns the whole pattern in one frame. Floating objects follow the unwarped
sum, so they are out of step with the waves drawn.

The wave core replaces that with a **sea state** on the CPU and a few **baked layers** on the
GPU. It is a prototype: the `debug/Ocean/Sea Bench` story's `WaveCore` (and `waves: 'both'`,
which draws it and the `Ocean` in the same frames to time them). `Ocean` and `Scenery` do not
use it yet.

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
  layer lies below the pixel, and only its slope variance is added, with no fetch.

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

- **Iris Xe**: the bake is a fixed ~0.5 ms on the A1000, some 3 ms there; the presets (layers,
  texels, waves a layer, how often the long layer is baked) are to be sized on it.
- **Close up**: the finest layer stops at 1.5 m waves, so up close the sea is softer than today's
  ripple noise; a fourth layer (about 7 m) for the high presets.
- **Into the sea**: `Ocean` and `Scenery` (the charts), `Weather` (wind, `swell`, one sea state
  shared), buoyancy through `heightAt`, foam from the layers, the water's optics.
