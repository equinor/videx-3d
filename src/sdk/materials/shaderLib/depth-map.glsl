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
