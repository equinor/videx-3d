// Procedural (texture-free) normal-detail helpers.
//
// Pure functions - no uniforms, no varyings - so any material can reuse them by
// supplying its own inputs and controls. Include this file in a FRAGMENT shader
// (it relies on screen-space derivatives, dFdx/dFdy).
//
// Dependencies the consuming material must provide when calling perturbNormalHeight:
//   - normal   : the shading normal to perturb, in VIEW space
//   - viewPos  : the surface position in VIEW space (e.g. -vViewPosition)
//   - height   : a scalar height field sampled at this fragment (produced by the
//                pnGranular / pnGrain / pnScratches helpers below, summed); the caller
//                scales it to taste (its "strength"/bump amount) and may fade it by
//                distance
// And when sampling a pattern height (pnGranular / pnGrain / pnScratches):
//   - uv         : a 2D coordinate ALREADY scaled by the caller's frequency. The
//                  caller owns the units (world distance, normalized, radius-based,
//                  ...) and which axis maps to uv.y (the grain/stretch axis).
//   - octaves    : fbm octave count for pnGranular / pnGrain (1..N). pnScratches is
//                  segment-based and takes NO octave count.
//   - periodX    : if > 0, the noise tiles seamlessly every `periodX` cells in x (pass
//                  the number of cells around a circumference to remove the wrap seam
//                  on a closed cylinder; pass 0 to disable). Tiling is exact for
//                  granular and for grain/scratches at angle 0.
// The patterns return scalar heights; combine several by summing (optionally weighted)
// and feed the result to perturbNormalHeight.
//
// "width" of the features is controlled by the caller's frequency/anisotropy/angle
// folded into uv; "height" of the bump is the caller-owned scalar passed to
// perturbNormalHeight. No CPU data or vertex attributes are required beyond whatever
// the material already uses to build its uv.

// Lattice wrap period (cells). The value-noise lattice (and the scratch seed grid) repeat
// every PN_WRAP cells per axis, so a caller that reduces a very large sample coordinate
// into [0, PN_WRAP) - to keep floor()/fract() float-precise at oilfield scale, where
// metres-along-trajectory x frequency reaches ~1e5 and fract() quantises into visible
// banding - still tiles SEAMLESSLY at the wrap. Large enough (4096 cells) that the repeat
// is invisible for fine detail; a no-op (mod = identity) for the small coords normal use
// produces.
#define PN_WRAP 4096.0

// Precision-robust 2D->1D hash (Dave Hoskins). fract() is applied BEFORE any multiply/
// dot so the working values stay in [0,1) - this survives the large sample coordinates
// that occur at oilfield scale (a pattern sampled by metres-along-trajectory times a
// frequency reaches ~1e5+), where the older fract(p*c) + dot(p, p) form overflowed
// float32 precision so fract() returned near-constant values and the noise collapsed /
// stretched with distance down the well.
float pnHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D value noise (smoothstep-interpolated) WITH its analytic gradient:
// vec3(value, d/dp.x, d/dp.y). The gradient is exact for the same lattice + interpolant
// pnValueNoise2 uses, and costs no extra hashes - only a few multiplies - so a caller
// that needs a slope should always prefer it over screen-space derivatives, which make a
// bump pattern SWIM as the camera moves (the estimate is taken over the pixel footprint,
// which changes with distance and grazing angle).
vec3 pnValueNoise2Grad(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f); // d(smoothstep)/df
  // Wrap the integer lattice at PN_WRAP so the noise tiles seamlessly when a caller reduces
  // a huge coordinate into [0, PN_WRAP) (identity for the small coords normal use produces).
  vec2 i0 = mod(i, PN_WRAP);
  vec2 i1 = mod(i + 1.0, PN_WRAP);
  float a = pnHash2(i0);
  float b = pnHash2(vec2(i1.x, i0.y));
  float c = pnHash2(vec2(i0.x, i1.y));
  float d = pnHash2(i1);
  // Bilinear form: a + (b-a)u.x + (c-a)u.y + (a-b-c+d)u.x*u.y
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;
  float value = a + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  vec2 grad = vec2(du.x * (k1 + k3 * u.y), du.y * (k2 + k3 * u.x));
  return vec3(value, grad);
}

// 2D value noise (smoothstep-interpolated).
float pnValueNoise2(vec2 p) {
  return pnValueNoise2Grad(p).x; // the gradient is dead code here and compiles away
}

// Fractional Brownian motion with a dynamic (uniform-driven) octave count. The loop
// bound is a compile-time constant (GLSL requirement); `octaves` clamps it at runtime.
float pnFbm2(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for(int o = 0; o < 8; o++) {
    if(o >= octaves)
      break;
    sum += amp * pnValueNoise2(p);
    norm += amp;
    p *= 2.02;
    amp *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

// Tiling value noise: the integer lattice wraps at `periodX` cells in x, so a pattern
// sampled over exactly `periodX` units in x is seamless (used to wrap around a
// cylinder's circumference). y is not tiled.
float pnValueNoise2Tiled(vec2 p, float periodX) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, periodX);
  float x1 = mod(i.x + 1.0, periodX);
  float y0 = mod(i.y, PN_WRAP);
  float y1 = mod(i.y + 1.0, PN_WRAP);
  float a = pnHash2(vec2(x0, y0));
  float b = pnHash2(vec2(x1, y0));
  float c = pnHash2(vec2(x0, y1));
  float d = pnHash2(vec2(x1, y1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// fbm on the x-tiling noise; lacunarity 2.0 so every octave's period stays integer.
float pnFbm2Tiled(vec2 p, float periodX, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  float per = max(periodX, 1.0);
  for(int o = 0; o < 8; o++) {
    if(o >= octaves)
      break;
    sum += amp * pnValueNoise2Tiled(p, per);
    norm += amp;
    p *= 2.0;
    per *= 2.0;
    amp *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

// fbm that tiles in x when periodX > 0, else plain (non-tiling) fbm.
float pnFbm2Auto(vec2 p, int octaves, float periodX) {
  return periodX > 0.5 ? pnFbm2Tiled(p, periodX, octaves) : pnFbm2(p, octaves);
}

// SIGNED fbm (-0.5 .. 0.5) with PER-OCTAVE footprint AA: each octave fades out as ITS OWN
// cells approach a pixel, so the field degrades gracefully toward its coarse structure
// instead of vanishing all at once - and flattens to ZERO (not to a constant offset), so
// a caller can drive both a normal and an albedo term from it without a DC shift
// appearing at distance.
//
// ⭐ Prefer this over `pnFbm2 * pnFootprintFade` wherever the pattern is drawn on
// something LARGE: pnFootprintFade kills the WHOLE layer as soon as its FINEST octave is
// under-sampled, which is right for a close-up object and far too eager for a landscape,
// where the coarse octaves are still perfectly well sampled. Because an fbm octave's
// slope (amplitude x frequency) is roughly constant, dropping the fine octaves smooths
// the relief without flattening it.
//
// Must be called under uniform control flow (screen-space derivatives).
float pnFbmSigned2Filtered(vec2 p, int octaves) {
  vec2 d = fwidth(p);
  float cells = max(d.x, d.y);
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for(int o = 0; o < 8; o++) {
    if(o >= octaves)
      break;
    float aa = 1.0 - smoothstep(0.4, 1.0, cells);
    // An under-sampled octave still counts toward the normalisation - it just
    // contributes nothing, which is what makes the field SMOOTH with distance rather
    // than gain contrast as its fine detail drops out.
    if(aa > 0.0)
      sum += amp * aa * (pnValueNoise2(p) - 0.5);
    norm += amp;
    p *= 2.02;
    cells *= 2.02;
    amp *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

// As pnFbmSigned2Filtered, but also accumulating the ANALYTIC gradient:
// vec3(value, d/dp.x, d/dp.y). Only the fade still comes from the pixel footprint, and a
// fade is an amplitude, so the pattern SMOOTHS with distance rather than sliding around
// as a screen-space gradient would make it.
vec3 pnFbmSigned2FilteredGrad(vec2 p, int octaves) {
  vec2 d = fwidth(p);
  float cells = max(d.x, d.y);
  float sum = 0.0;
  vec2 grad = vec2(0.0);
  float amp = 0.5;
  float norm = 0.0;
  float freq = 1.0; // chain rule: octave o is sampled at p * freq
  for(int o = 0; o < 8; o++) {
    if(o >= octaves)
      break;
    float aa = 1.0 - smoothstep(0.4, 1.0, cells);
    if(aa > 0.0) {
      vec3 n = pnValueNoise2Grad(p);
      sum += amp * aa * (n.x - 0.5);
      grad += amp * aa * freq * n.yz;
    }
    norm += amp;
    p *= 2.02;
    cells *= 2.02;
    freq *= 2.02;
    amp *= 0.5;
  }
  return norm > 0.0 ? vec3(sum, grad) / norm : vec3(0.0);
}

// GRANULAR: isotropic value-noise bumps; `anisotropy` (0..1) stretches the cells along
// uv.y. Signed height. periodX > 0 tiles x (e.g. a circumference).
float pnGranular(vec2 uv, float anisotropy, int octaves, float periodX) {
  vec2 p = vec2(uv.x, uv.y * mix(1.0, 0.04, anisotropy));
  return pnFbm2Auto(p, octaves, periodX) - 0.5;
}

// GRANULAR for LARGE surfaces: same pattern, but built on pnFbmSigned2Filtered so it
// smooths with distance instead of being switched off by a whole-layer pnFootprintFade
// (do NOT apply one on top). No x-tiling. Signed height, and exactly zero once even the
// coarsest octave is under-sampled, so it can safely drive an albedo term too.
float pnGranularFiltered(vec2 uv, float anisotropy, int octaves) {
  vec2 p = vec2(uv.x, uv.y * mix(1.0, 0.04, anisotropy));
  return pnFbmSigned2Filtered(p, octaves);
}

// As pnGranularFiltered, but returning vec3(height, d/duv.x, d/duv.y) so the caller can
// tilt a normal from the EXACT slope instead of a screen-space estimate - the difference
// between detail that sits on the surface and detail that slides across it as the camera
// moves. Tilt a plane-aligned normal with `N - (g.y * U + g.z * V)` for the plane's unit
// axes U, V (the same construction pnDunes is used with).
vec3 pnGranularFilteredGrad(vec2 uv, float anisotropy, int octaves) {
  float squash = mix(1.0, 0.04, anisotropy);
  vec3 n = pnFbmSigned2FilteredGrad(vec2(uv.x, uv.y * squash), octaves);
  return vec3(n.x, n.y, n.z * squash); // chain rule for the squashed y axis
}

// BRUSHED: a directional fine grain - thin parallel ridges running at `angle` (radians;
// 0 = along uv.y). `sharpness` (0..1) thins the ridges (their "width"); `uniformity`
// (0..1) blends from an irregular grain to perfectly regular flutes. Positive height.
// Tiling is exact only for angle == 0; other angles degrade gracefully (a faint seam).

// The shape both grain variants share: `r` is the rotated sample coordinate and `n` the
// fbm value (0..1) they differ in how they obtained.
float pnGrainShape(vec2 r, float n, float sharpness, float uniformity) {
  // Irregular grain (fbm-smooth, so it has no cusp to alias); `sharpness` thins the ridges.
  float irregular = pow(1.0 - abs(2.0 * n - 1.0), mix(2.0, 8.0, clamp(sharpness, 0.0, 1.0)));
  // Regular flutes: footprint-anti-aliased evenly-spaced ridges (period 1 in r.x). A
  // smoothstep whose transition is never narrower than the pixel footprint (fwidth)
  // keeps the ridge crisp up close WITHOUT the sharp cusp of the old (1-|sin|)^pow form
  // - that cusp under-sampled the normal and shimmered even close up - and naturally
  // band-limits into a flat tone once a flute drops below a pixel far away. `sharpness`
  // sets the ridge width.
  float dCentre = abs(r.x - floor(r.x + 0.5)); // 0 at a flute centre .. 0.5 between
  float hw = mix(0.35, 0.05, clamp(sharpness, 0.0, 1.0));
  float aaw = max(fwidth(r.x), 1e-4);
  float regular = 1.0 - smoothstep(hw - aaw, hw + aaw, dCentre);
  // Once a flute period approaches the pixel footprint (fwidth ~ 0.5, i.e. the sine is
  // near screen-Nyquist at the grazing sides of the shell), flatten the flutes toward
  // their duty-cycle mean (~2*hw). Without this the ridge stays a smooth-but-undersampled
  // sine there and still shimmers even though the edges are footprint-AA'd.
  regular = mix(regular, 2.0 * hw, smoothstep(0.3, 0.5, aaw));
  return mix(irregular, regular, clamp(uniformity, 0.0, 1.0));
}

float pnGrain(vec2 uv, float angle, float sharpness, float uniformity, int octaves, float periodX) {
  float ca = cos(angle), sa = sin(angle);
  vec2 r = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);
  float tile = abs(angle) < 1e-3 ? periodX : 0.0;
  float n = pnFbm2Auto(vec2(r.x, r.y * 0.06), octaves, tile);
  return pnGrainShape(r, n, sharpness, uniformity);
}

// BRUSHED for LARGE surfaces: the irregular component is built on the per-octave-filtered
// fbm, so the grain smooths with distance rather than shimmering (the flute component was
// already band-limited). No x-tiling.
float pnGrainFiltered(vec2 uv, float angle, float sharpness, float uniformity, int octaves) {
  float ca = cos(angle), sa = sin(angle);
  vec2 r = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);
  float n = pnFbmSigned2Filtered(vec2(r.x, r.y * 0.06), octaves) + 0.5;
  return pnGrainShape(r, n, sharpness, uniformity);
}

// SCRATCHES: sparse, thin grooves crossing at varied angles/lengths - a cell/segment
// field rather than parallel lanes, so it reads like real scuffing. `density` (0..1) =
// fraction of seed cells that carry a scratch; `angle` = orientation bias and `wander`
// (0..1) widens the spread of directions around it (0 = all parallel, 1 = fully random);
// `lengthScale` (>0) scales each groove's length; `halfWidth` sets the groove width in
// sample (uv) units - pass (world-width x frequency) to get a FREQUENCY-INDEPENDENT width
// so lowering the frequency lengthens/thins-out the scratches without widening them. Two
// families are summed by pnScratches:
// a fine layer (short/medium scratches) plus a coarse layer (fewer, much longer ones).
// Each groove is analytically anti-aliased (edge widened to the pixel footprint).
// Negative height.

// One scratch "family": line segments seeded on an integer grid at the coordinate scale
// of `r`. Each present cell (gated by `density`) spawns a groove with a random midpoint,
// direction (biased toward `angle`, spread by `wander`), half-length, width and depth. A
// 3x3 neighbourhood is scanned so segments crossing in from adjacent cells are caught;
// half-length is capped below the search radius so grooves stay unbroken. `seed`
// decorrelates layers; x wraps at `periodX` cells (when angle ~ 0) for a seamless
// circumference seam.
float pnScratchLayer(vec2 r, float angle, float density, float lengthScale, float halfWidth, float wander, float periodX, float seed) {
  float aaw = max(length(fwidth(r)), 1e-4);
  vec2 cell = floor(r);
  float acc = 0.0;
  bool tile = periodX > 0.5 && abs(angle) < 1e-3;
  for(int j = -1; j <= 1; j++) {
    for(int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec2 h = mod(c, PN_WRAP); // keep hash coords small/precise + seamless at the axial wrap
      if(tile)
        // max() keeps the divisor provably non-zero: callers that disable tiling pass
        // periodX = 0.0, and some backends (ANGLE/D3D) constant-fold the mod() division
        // inside this branch BEFORE dead-code elimination and warn "X4008: floating
        // point division by zero". Only reached when tile (periodX > 0.5), so this is a
        // no-op at runtime.
        h.x = mod(c.x, max(periodX, 1.0)); // seamless wrap around the circumference
      h += seed;
      if(pnHash2(h + 3.1) > density)
        continue; // sparsity
      vec2 mid = c + vec2(pnHash2(h + 7.3), pnHash2(h + 13.7));
      float a = angle + (pnHash2(h + 21.1) - 0.5) * 3.14159265 * clamp(wander, 0.0, 1.0);
      vec2 d = vec2(cos(a), sin(a));
      vec2 perp = vec2(-d.y, d.x);
      float hl = clamp(mix(0.1, 0.55, pnHash2(h + 29.3)) * max(lengthScale, 0.05), 0.03, 0.92);
      float w = halfWidth * mix(0.7, 1.3, pnHash2(h + 41.7)); // world-scaled half-width (freq-independent)
      float rStr = mix(0.3, 1.0, pnHash2(h + 37.7));   // random depth/brightness
      float bend = (pnHash2(h + 51.9) - 0.5) * 0.7;    // shallow curvature so lines aren't dead straight
      vec2 pr = r - mid;
      float t = clamp(dot(pr, d), -hl, hl);            // nearest point on the straight axis
      float u = t / max(hl, 1e-3);
      vec2 foot = d * t + perp * (bend * u * u * hl);  // bow the centre-line across its length
      float dist = length(pr - foot);
      acc = max(acc, (1.0 - smoothstep(w - aaw, w + aaw, dist)) * rStr);
    }
  }
  return acc;
}

float pnScratches(vec2 uv, float angle, float density, float lengthScale, float halfWidth, float wander, float periodX, float coarseWeight) {
  float ca = cos(angle), sa = sin(angle);
  vec2 r = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);

  // Fine family: many short/medium scratches at the caller's frequency.
  float fine = pnScratchLayer(r, angle, density, lengthScale, halfWidth, wander, periodX, 0.0);

  // Coarse family: a few much longer grooves, seeded on a ~3x larger grid (bigger cells
  // => longer scratches within the same 3x3 search). x is rescaled to an INTEGER period
  // so the circumference seam stays seamless; y (never tiled) is just divided down. The
  // half-width is scaled by the same factor so the coarse grooves keep the SAME world
  // width as the fine ones (longer, not fatter). It is the most repetition-prone / "big"
  // family AND doubles the per-fragment cost, so `coarseWeight` lets the caller drop it
  // entirely (pass 0 - the whole 3x3 loop is then skipped): the branch is expected to be
  // driven by a uniform (e.g. a quality knob) so it stays divergence-free.
  float coarse = 0.0;
  if(coarseWeight > 0.0) {
    float coarsePeriod = max(floor(periodX / 3.0 + 0.5), 1.0);
    float scale = coarsePeriod / max(periodX, 1.0);
    vec2 rc = vec2(r.x * scale, r.y / 3.0);
    coarse = pnScratchLayer(rc, angle, density * 0.5, lengthScale, halfWidth * scale, wander, coarsePeriod, 7.0) * coarseWeight;
  }

  return -max(fine, coarse);
}

// DUNES: large meandering directional ridges (a wind-blown sand bed, a ripple field).
// Unlike the patterns above this returns the ANALYTIC slope of the height field in the
// sample plane, not a height, so the caller tilts a plane-aligned normal directly:
//   N = normalize(N + vec3(-g.x, 0.0, -g.y) * strength);   // for a world-XZ sample
// The exact gradient is what makes it usable at this scale: perturbNormalHeight estimates
// the gradient from SCREEN-SPACE derivatives, which degrades at grazing angles - precisely
// how a sea bed or a wide cap is seen once the ridges are big enough to read.
//
//   p          : the sample position in WORLD units (NOT pre-scaled by a frequency;
//                `wavelength` sets the size of the coarsest ridge)
//   direction  : ridge propagation direction in the sample plane
//   texel      : world units per pixel, `length(fwidth(p))` - each octave fades out as its
//                wavelength approaches a pixel, so the field flattens smoothly with distance
//                instead of shimmering
//   height     : out, the normalised crest height (-1..1), for a faint albedo banding
// The returned slope is normalised (divided by k and the amplitude sum), so it is ~unit
// order and independent of `wavelength`: the caller's strength reads as a direct tilt.
vec2 pnDunes(vec2 p, float wavelength, vec2 direction, float texel, out float height) {
  height = 0.0;
  vec2 slope = vec2(0.0);
  float lambda = max(wavelength, 1.0);

  // Low-frequency domain warp so the ridges meander and never read as one straight 1D
  // ripple (or an obviously tiled pattern far out). It is far below the ridge frequency,
  // so the local wavelength is essentially unchanged and the unwarped `texel` stays a
  // valid footprint estimate.
  vec2 wq = p / lambda * 0.7;
  vec2 warp = vec2(pnValueNoise2(wq), pnValueNoise2(wq + 19.3)) - 0.5;
  vec2 q = p + warp * lambda * 0.9;

  vec2 dir = normalize(direction + vec2(1e-4, 0.0));
  float k = 6.2831853 / lambda;
  float amp = 1.0;
  float ampSum = 0.0;
  float ca = cos(0.7);
  float sa = sin(0.7);

  for(int i = 0; i < 4; i++) {
    ampSum += amp;
    float aa = 1.0 - smoothstep(1.5, 3.0, k * texel);
    if(aa > 0.001) {
      vec2 perp = vec2(-dir.y, dir.x);
      float along = dot(q, dir);
      float across = dot(q, perp);
      // Meander the crest lines along the perpendicular axis so the ridges wave.
      float meander = sin(across * k * 0.35) * 1.3;
      float phase = along * k + meander;
      height += amp * sin(phase) * aa;
      // d(phase)/dq divided by k: the dir term is the ridge slope, the perp term the tilt
      // the meander adds.
      vec2 dphaseN = dir + perp * (1.3 * cos(across * k * 0.35) * 0.35);
      slope += amp * cos(phase) * dphaseN * aa;
    }
    k *= 1.9;
    amp *= 0.5;
    // Rotate the ridge direction each octave to decorrelate the layers.
    dir = vec2(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca);
  }

  height /= max(ampSum, 1e-3);
  return slope / max(ampSum, 1e-3);
}

// Footprint anti-aliasing factor (1 near .. 0 sub-pixel). Fades a pattern out as its
// finest octave shrinks toward a pixel - with distance or at grazing angles - so the
// high-frequency detail never becomes a shimmering/aliasing signal. `uv` is the
// (frequency-scaled) sample coordinate; `octaves` is the fbm octave count. Must be
// called under uniform control flow (uses screen-space derivatives).
float pnFootprintFade(vec2 uv, int octaves) {
  // cells per pixel of the sample coordinate (mildly boosted for finer octaves). Fade
  // BEFORE the Nyquist limit: a cell must stay >~2 px to sample cleanly, so start fading
  // around 2.5 px/cell and reach zero by ~1 px/cell. (A looser threshold left the pattern
  // near full strength at ~1 cell/pixel, so it stippled/aliased on thin, minified faces
  // such as the end caps and slice faces.)
  float cellsPerPixel = max(fwidth(uv.x), fwidth(uv.y)) * (1.0 + 0.5 * float(octaves - 1));
  return 1.0 - smoothstep(0.4, 1.0, cellsPerPixel);
}

// Perturb a view-space normal by a scalar height field using the screen-space surface
// gradient (Mikkelsen) - no tangent/bitangent attributes needed. `height` must be the
// value sampled at THIS fragment; its screen-space derivatives give the slope.
vec3 perturbNormalHeight(vec3 normal, vec3 viewPos, float height) {
  vec3 sx = dFdx(viewPos);
  vec3 sy = dFdy(viewPos);
  float hx = dFdx(height);
  float hy = dFdy(height);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * normal - grad);
}
