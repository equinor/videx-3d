// Sampling a surface's depth grid, packed as RG float (see `buildSurfaceDepthMap`):
// R the scene Y, filled everywhere; G the validity, 1 where the grid holds real
// data. Shared by the chunk materials (fluid contact lines, the sea-bed tint) and
// the ocean surface (depth-driven shoaling).

// ⚠️ Bilinear by hand. The texture is NEAREST-filtered: linear filtering of a
// 32-bit float texture needs `OES_texture_float_linear`, and half float cannot
// hold a depth of a few thousand metres to better than a couple of metres. Doing
// it here also lets an unmapped neighbour REJECT a sample rather than bleed into
// it.
//
// ⚠⚠ Returns COVERAGE (0..1) rather than a bool, and always writes a `y`. An early
// return would put a caller's `fwidth` in NON-UNIFORM control flow at the edge of
// the mapped area — undefined, and it painted a vertical tick off the end of every
// contact line. R is filled on the CPU so it stays continuous across that edge; G
// alone decides what is visible.
float sampleDepthMap(sampler2D map, mat3 toUv, vec2 size, vec2 xz, out float y) {
  vec2 texel = (toUv * vec3(xz, 1.0)).xy * size - 0.5;
  vec2 base = floor(texel);
  // ⚠️ Hermite-smoothed weights, not the raw fraction. Plain bilinear is C0 but
  // not C1, so its gradient jumps at every texel boundary — which a steep
  // response curve (the shoal) turns into a visible lattice aligned with the
  // grid, and which a screen-space derivative (a contact line) reads directly.
  vec2 f = texel - base;
  f = f * f * (3.0 - 2.0 * f);
  float sum = 0.0;
  float weight = 0.0;
  float coverage = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 at = base + vec2(float(i), float(j));
      float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      if (at.x < 0.0 || at.y < 0.0 || at.x > size.x - 1.0 || at.y > size.y - 1.0) continue;
      vec2 s = texture2D(map, (at + 0.5) / size).rg;
      sum += s.r * w;
      weight += w;
      coverage += s.g * w;
    }
  }
  y = weight > 0.0 ? sum / weight : 0.0;
  return coverage;
}

// A single-channel field on the same packing, CLAMPED at the border rather than
// rejecting outside samples: a signed distance is meaningful past the edge of its
// grid (it just keeps its sign), whereas a depth grid's validity is not.
//
// ⚠️⚠️ PLAIN bilinear, deliberately NOT the Hermite weighting `sampleDepthMap`
// uses. Near its own curve a signed distance is LINEAR, and bilinear reproduces a
// linear function exactly, so a straight fence cuts a straight line. Smoothed
// weights are exact only AT the nodes and bow between them, which turns a
// straight cut into a wave with a one-cell period — and against a sloping
// surface that wave becomes a row of teeth along the top edge. The smoothing is
// right for a contact line, which thresholds the GRADIENT; a cut thresholds the
// VALUE and only wants it straight.
float sampleFieldMap(sampler2D map, mat3 toUv, vec2 size, vec2 xz) {
  vec2 texel = (toUv * vec3(xz, 1.0)).xy * size - 0.5;
  vec2 base = floor(texel);
  vec2 f = texel - base;
  float sum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 at = clamp(base + vec2(float(i), float(j)), vec2(0.0), size - 1.0);
      float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      sum += texture2D(map, (at + 0.5) / size).r * w;
    }
  }
  return sum;
}

// The same read, but returning R and G together: a fence packs its signed distance
// in R and the distance ALONG the curve in G, and a tapered cut needs both at once.
vec2 sampleFieldMap2(sampler2D map, mat3 toUv, vec2 size, vec2 xz) {
  vec2 texel = (toUv * vec3(xz, 1.0)).xy * size - 0.5;
  vec2 base = floor(texel);
  vec2 f = texel - base;
  vec2 sum = vec2(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 at = clamp(base + vec2(float(i), float(j)), vec2(0.0), size - 1.0);
      float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      sum += texture2D(map, (at + 0.5) / size).rg * w;
    }
  }
  return sum;
}

// Extra half width a fence's cut carries at `along` metres down the curve: the full
// `taper.x` up to `taper.y`, closed by `taper.z`.
//
// ⚠⚠ Must match `fenceWidthAt` in `wellbore-fence.ts` EXACTLY. The cut face is
// placed by root-finding on that one while the block is removed by this one, so any
// difference is a sliver of block standing proud of the face, or a gap behind it.
float fenceTaperWidth(vec3 taper, float along) {
  if (taper.x <= 0.0 || taper.z <= taper.y) return 0.0;
  return taper.x * (1.0 - smoothstep(taper.y, taper.z, along));
}
