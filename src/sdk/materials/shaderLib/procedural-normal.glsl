// Procedural (texture-free) normal-detail helpers.
//
// Pure functions - no uniforms, no varyings - so any material can reuse them by
// supplying its own inputs and controls. Include this file in a FRAGMENT shader
// (it relies on screen-space derivatives, dFdx/dFdy).
//
// Dependencies the consuming material must provide when calling perturbNormalHeight:
//   - normal   : the shading normal to perturb, in VIEW space
//   - viewPos  : the surface position in VIEW space (e.g. -vViewPosition)
//   - height   : a scalar height field sampled at this fragment (see
//                proceduralNormalHeight); the caller scales it to taste (its
//                "strength"/bump amount) and may fade it by distance
// And when sampling a pattern height (pnGranular / pnGrain / pnScratches):
//   - uv         : a 2D coordinate ALREADY scaled by the caller's frequency. The
//                  caller owns the units (world distance, normalized, radius-based,
//                  ...) and which axis maps to uv.y (the grain/stretch axis).
//   - octaves    : fbm octaves (1..N)
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

// 2D value noise (smoothstep-interpolated).
float pnValueNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  // Wrap the integer lattice at PN_WRAP so the noise tiles seamlessly when a caller reduces
  // a huge coordinate into [0, PN_WRAP) (identity for the small coords normal use produces).
  vec2 i0 = mod(i, PN_WRAP);
  vec2 i1 = mod(i + 1.0, PN_WRAP);
  float a = pnHash2(i0);
  float b = pnHash2(vec2(i1.x, i0.y));
  float c = pnHash2(vec2(i0.x, i1.y));
  float d = pnHash2(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
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

// GRANULAR: isotropic value-noise bumps; `anisotropy` (0..1) stretches the cells along
// uv.y. Signed height. periodX > 0 tiles x (e.g. a circumference).
float pnGranular(vec2 uv, float anisotropy, int octaves, float periodX) {
  vec2 p = vec2(uv.x, uv.y * mix(1.0, 0.04, anisotropy));
  return pnFbm2Auto(p, octaves, periodX) - 0.5;
}

// BRUSHED: a directional fine grain - thin parallel ridges running at `angle` (radians;
// 0 = along uv.y). `sharpness` (0..1) thins the ridges (their "width"); `uniformity`
// (0..1) blends from an irregular grain to perfectly regular flutes. Positive height.
// Tiling is exact only for angle == 0; other angles degrade gracefully (a faint seam).
float pnGrain(vec2 uv, float angle, float sharpness, float uniformity, int octaves, float periodX) {
  float ca = cos(angle), sa = sin(angle);
  vec2 r = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);
  float tile = abs(angle) < 1e-3 ? periodX : 0.0;
  float n = pnFbm2Auto(vec2(r.x, r.y * 0.06), octaves, tile);
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
        h.x = mod(c.x, periodX); // seamless wrap around the circumference
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
