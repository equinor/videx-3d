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

- **The spectrum** (`sea-spectrum.ts`): the wind sea fully developed for the wind, Elfouhaily
  et al. 1997's unified spectrum: its long waves scaled to the `Ocean`'s Hs ≈ 0.21 U²/g and
  peak, its short waves (from about a metre down) set by the wind's friction velocity u*
  (Wu's drag), absolute, so they grow with the wind; the slopes of all of it follow Cox and
  Munk's mean square slope within about 15 %. Plus swells (height, period, direction), each
  spread about its direction (cos²ˢ; Mitsuyasu's s for the wind sea). Deep water, the short
  waves' speeds with capillarity. The variance and slope variance of any band of wavenumbers
  are worked out from it, which a global map of sea states will need (see "Across the
  globe").
- **The layers**: `medium` tiles of 2011, 307, 47 and 7.3 m (`SEA_LAYERS_MEDIUM`), each turned
  by the golden angle, each holding the waves on its own grid, k = R·(2π/size)·(n, m), in its
  band of wavenumbers, up to 4 texels a wavelength of a 128² tile. A layer tiles exactly.
  `SEA_QUALITY` (`SeaQualitySpec`): `low` the three long layers at 64², `high` `medium` and the
  detail octave, `ultra` `high` with 768 waves a layer (its 256² tiles with 384 waves until
  2026-11-18 widened each band fourfold for 1.5 times the waves: a missing octave between the
  layers, fewer and stronger waves, a smoother and more regular sea than `high`'s).
- **The pool**: each layer draws at most 256 waves (`ultra` 768), the steepest its spectrum
  asks for (amplitude × wavenumber, their slope); each has a fixed random amplitude factor
  (Rayleigh) and phase. Chosen by height until 2026-11-18, the strongest were each band's
  longest and its short end went undrawn: at 10 m/s nothing from 12.6 to 9.6 m, 2.5 to 1.5 m
  nor 0.36 to 0.23 m, and 55–70 % of the bands' slope variance drawn; by slope each band is
  drawn to its end, 61–74 %, at the same cost. A wave leaves the pool only once it has eased
  out, and joins at no amplitude, so nothing pops. Each layer's targets are scaled so its band
  keeps the spectrum's height variance.
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
- **The detail octave** (`SeaState.detail`, `high` and `ultra`): the finest layer's texture
  read again, `SEA_DETAIL_SCALE` (6.4) times smaller, turned apart and on its own hex cells,
  for the ripples below the finest layer's band (0.23 m down to about 4 cm) at no bake of its
  own. Its gain gives it the spectrum's slope variance in that band over what the finest layer
  draws, easing toward it as that band's waves would, and what it draws leaves the glint's
  residual. A scaled copy's waves run too slowly for their size, so it slides downwind at the
  band's phase speed, under cells that stay put (a whole tile's slide changes nothing, so it
  never pops). `medium` drew it in place of a 7.3 m layer until 2026-11-13; up close that read
  as a blurred, sliding overlay of the 47 m layer, the same at every wind.
- **Bake only what shows**: given the camera and its height over the sea, `renderWaves` skips
  the layers whose whole tile a pixel there spans (`SEA_BAKE_PIXEL_MARGIN`, 2): the surface reads
  none of them. A layer of tile `size` stops once the camera is higher than
  size · rows / (2 · margin · tan(fov / 2)): with 1080 rows and a 50° view, the 47 m layer from
  about 27 km up, the 307 m one from 180 km, the 2011 m one from 1160 km.
- **Whitecaps** (`oceanWindFoam`, `oceanFoam`): the share of the sea the wind's whitecaps
  cover (Monahan and O'Muircheartaigh 1980, 3.84·10⁻⁶·U^3.41; `foamAmount` 0.5 as measured),
  as a threshold on the wind sea's crests in standard deviations (all but the longest layer,
  broken up by the finest and the ripples). No noise of its own. Filtered, not switched: each
  pixel draws the share of it over the threshold, the crests' spread it cannot show
  (`oceanCrestUnresolved`, from the mips' slope variance through `seaHeightKept`, and once a
  pixel spans a whitecap's patch half the texture's spread for its breakup) taken as a normal
  about what it shows. Until 2026-11-16 the crest texture was cut where resolved and swapped for
  its mean below a pixel; seen tilted, the whitecaps went from strong to gone across one band.
  Cutting the filtered crests rescaled to their full spread instead gave pixel-sized specks that
  flickered as the view moved, and a pixel-noise sea from altitude in a gale.

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

With the wind-driven short waves and `medium`'s 7.3 m layer (2026-11-13, same method, three
rounds, the bake in the frame): the `Scenery` 0.68–0.89 of the baseline's frame (100 km 0.99),
stand-alone 0.41–0.55 up to 2 km (20 km 0.92, its rounds 0.59–1.02). The fourth layer's bake
and reads cost about a tenth to a quarter of the baseline's frame more than the three layers
did. A second sea drawn in another tab of the same Chrome ran alongside; the ratios are
interleaved, but noisier than usual.

| distribution of slope variance, `medium` (Hs, m) | 3 m/s (0.19) | 10 m/s (2.1) | 20 m/s (8.6) |
|--|--|--|--|
| 47 m layer | 0.0030 | 0.0042 | 0.0039 |
| 7.3 m layer | 0.0042 | 0.0041 | 0.0052 |
| left to the glint | 0.011 | 0.041 | 0.088 |
| Cox and Munk, all of it | 0.018 | 0.054 | 0.105 |

The waves down to a quarter of a metre still hold about as much slope at 3 m/s as at 20: the
spectrum's short waves grow with the wind mostly below that, in the band `high`'s octave and
the glint take.

### On the Iris Xe (2026-11-13, 1920 × 1080 at 1)

The baseline's build and the new in one tab of the VS Code browser, switched each round, three
rounds, each pose's ratio the median of the rounds' (the frame holds the bake; the sea is its
draws alone):

| pose | Scenery: frame | Scenery: sea | stand-alone: frame | stand-alone: sea |
|--|--|--|--|--|
| 2 m | 0.63 | 0.55 | 0.77 | 0.45 |
| 30 m | 0.64 | 0.57 | 0.42 | 0.46 |
| 300 m | 0.66 | 0.61 | 0.58 | 0.55 |
| 2 km | 0.82 | 0.78 | 0.81 | 0.68 |
| 20 km | 0.85 | 0.80 | 0.71 | 0.52 |
| 100 km | 0.87 | 0.92 | – | – |
| 1000 km | 0.95 | 0.93 | – | – |
| down, 2 km | 0.80 | 0.75 | 0.73 | 0.55 |

- The `Scenery`'s rounds agreed within a few per cent: at 300 m the baseline's frame 17.1 ms,
  the new 11.4; its sea 15.8 and 9.6.
- The stand-alone sea's light frames (5–8 ms) set the clock jumping: one round's baseline ran
  twice as slow; its ratios are the noisier.
- So the wave core passes on the Iris Xe as the whole sea: cheaper at every pose, most where
  the sea fills the view.

## Gusts and slicks

The wind over the sea is not the same everywhere, and its short waves show it: cat's paws, the
patches a gust roughens, darker against a sea mirroring the bright horizon; lulls and slicks,
glassy. The weather's `WeatherGusts` (`sdk/weather/wind-field.ts`, `weather-wind.glsl`) is that
field, and the sea reads it per pixel (`oceanWaves`):

- **The field.** Three octaves of value noise, 1, 1/5 and 1/25 of `scale` (3 km) across,
  stretched along the wind, each running downwind at its own share of the wind's speed (0.85,
  1, 1.15), so the field changes shape as it goes rather than sliding. Its spread about the
  mean wind is `strength` (one standard deviation; by default 0.38 in light air to 0.24 in a
  gale, `gustStrengthFor`). Slicks: one octave, `slickScale` (400 m) across and five times as
  long, drifting with a slow current, over about 23 % of the sea in light air and none from
  10 m/s (`slickShareFor`). Each octave gives way to its mean below two pixels, so far off the
  field is the mean, with no shimmer.
- **What it does to the waves.** A gust changes the wind's friction velocity, and with it only
  the short waves' strength α_m (Elfouhaily); the long waves stay as the mean wind raised them.
  `SeaState.shortWaveRatios` gives, from the spectrum, the slope variance of the waves finer
  than the finest layer's band at 0.25, 0.5, 1.5 and 2 times the wind over the mean's: at
  10 m/s 0.06, 0.32, 1.57 and 1.99, and below about 2.7 m/s none (α_m is nil there), so a
  lull goes glassy. The shader takes that curve: what no layer draws (the residual) and the
  ripples by all of it, the finest layer (7.3 m on `medium`) by half. A slick damps them by
  0.8 more. Normalised by the slicks' mean, so a sea too far off to show them is as rough as
  without.
- **What it does to the light.** Rougher water reflects higher up the sky, and its facets hide
  each other toward grazing (Smith's masking for a Beckmann surface); smoother water mirrors the
  horizon. Both are taken against the mean wind's roughness, so nothing changes where the wind
  is the mean (`oceanRoughReflect`, `oceanRoughFresnel`; ⚠️ tuning `roughReflect`). Only the
  colour: the water's opacity stays the mean's.
- Faded with the waves, far off and where two of the `Scenery`'s charts meet (their planes
  differ). From orbit, a field fixed to the globe would be needed.
- The cost: four value noises a pixel, arithmetic only. On the A1000 (2026-11-13, 1920 × 1080
  at 1, on against off interleaved in one tab, four rounds): the `Scenery`'s sea 3–9 % (2 m
  to 20 km 1.03–1.06, straight down 1.09, 100 km nothing, faded out there), the stand-alone
  sea 0–1 %. The frame's own ratios swing more than that between rounds.
- The bench's `wind` debug view shows the field: blue a lull, red a gust, green a slick.

## Shallow water (`sdk/weather/sea-shallow.ts`)

The waves answer the depth of the still water under them, by one rule on both sides of the
sea: the surface's shaders (`sea-layers.glsl`'s `seaShallowFactors`) and the heights floating
objects ride (`SeaState.heightAtDepth`, through `createOceanSampler`).

- **Shoaling**: each layer's height by linear theory's coefficient √(c_g,deep / c_g) at its
  waves' typical wavenumber, √(slope variance / height variance) of the layer as drawn (Fenton
  and McKee's explicit dispersion, 0.05 % off). A dip of some 9 % at middling depths, then up
  toward the shore. Long layers feel the bottom first; the ripples only in the surf.
- **Breaking**: all the layers by `1 / (1 + r⁴)^¼`, `r` the shoaled significant height times the
  break depth over the depth (`SEA_BREAK_DEPTH` 1.3, `shoreBreakDepth`): the waves held under
  some 0.78 of the depth, so they die out toward the shore, and the still waterline stays where
  the bed meets the level.
- The per-pixel slopes and heights are cut alike, the crests taken over their spread as cut
  (the foam's texture keeps its look), and the whitecaps' share by the breaking limit: in the
  surf zone the surf stands in for them. The displaced vertices (`displacement`) and a water
  body's wall top use the same factors, so the rim stays sealed.
- The surf (`oceanShoreFoam`) breaks at the same depth over the same height, so it stands where
  the waves are being cut, and its swash is carried by the waves' height as in deep water.
- **Where the depth comes from**: the `Ocean`'s and a `ChunkStack`'s bathymetry grid
  (`depthMapHeightAt` reads it on the CPU as `depth-map.glsl` does), else the scene's ground map
  under an endless sea, else the water's flat floor. The `Scenery`'s sea reads the ground map
  per pixel (already read for the water's colour); its floaters read the relief's tiles
  (`SceneryReliefHub.heightAt`), finer than the map, so near a coast their damping can differ a
  little from the drawn waves'.
- **Cost**: deeper than `seaDeepDepth` (every layer past k·h = 6, the limit over 0.999), the
  factors are all 1 and nothing is worked out. On the sea bench (A1000, 1920 × 1080 at 1, three
  rounds interleaved with HEAD, the sea over the sky's draw as the clock check) the `Scenery`'s
  sea is 0.95–0.99 of HEAD from 30 m to 20 km: the surf, its noise only in the band, and the
  shared depth read paid for by code moved out of the `Ocean`'s own surf.
- **Not drawn**: the waves keep their deep-water length and speed. They neither slow, bunch up
  nor turn to face the shore (refraction): a layer is a tile of fixed waves.

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

- **The presets on the Iris Xe**: `low`, `high` and `ultra` are not yet measured there.
- **Ripples with the wind, the rest**: Elfouhaily's short waves grow with the wind mostly
  below a quarter of a metre, so the waves `medium` draws are still much alike at 3 and 20 m/s
  (see the table above); the gusts and slicks now carry the local wind into them.
- **Refraction**: waves turning to the shore and slowing as they shoal (see Shallow water).
- **Glitter**: the ripples no layer draws only widen the glint, so it is a smooth patch where
  the sea sparkles.
- **Into the sea**: the whitecaps' life was built 2026-11-16 (`SeaFoamLife`, below 1 km;
  [ocean.md](./ocean.md)); the streaks a gale draws, seen from higher up, are not. The weather's
  swell and one sea state shared under a `Weather` were built 2026-11-15 (`WeatherSea`,
  [ocean.md](./ocean.md)).
- **The gusts elsewhere**: the clouds (gust fronts under showers), and a field fixed to the
  globe for the sea seen from orbit.
