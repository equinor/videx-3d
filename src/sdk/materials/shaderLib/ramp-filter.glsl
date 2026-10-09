// Colour scalar values through a palette, filtered in COLOUR space over the pixel's footprint.
//
// ⭐ Filtering the values and colouring after is right up close, where it interpolates the data,
// but not far away: a palette is non-linear (a seismic ramp is white at 0 and saturated at both
// extremes, which doubles the frequency), so the colour of a band-limited value is not
// band-limited and shimmers however well the values are filtered. Averaging the COLOURS of
// several samples spread over the footprint filters what is actually seen.
//
// ⚠️ GLSL 3.00 (`textureGrad`, `textureSize`, `textureLod`) — what three compiles every
// non-raw ShaderMaterial as.

#ifndef RAMP_FILTER_TAPS
#define RAMP_FILTER_TAPS 8
#endif

vec3 rampColor(float value, sampler2D palette, float paletteV, vec2 range) {
  float t = clamp((value - range.x) / (range.y - range.x), 0.0, 1.0);
  // Explicit LOD: called from loops and branches, where implicit derivatives are undefined.
  return textureLod(palette, vec2(t, paletteV), 0.0).rgb;
}

// `uvDx` and `uvDy` are `dFdx(uv)` and `dFdy(uv)`, taken by the caller in UNIFORM control flow;
// everything here reads with explicit gradients, so this may itself be called inside a branch.
// `range` is the values at the palette's ends — `(max, min)` reverses it.
vec3 rampSampleFiltered(
  sampler2D values,
  vec2 uv,
  vec2 uvDx,
  vec2 uvDy,
  sampler2D palette,
  float paletteV,
  vec2 range
) {
  vec2 size = vec2(textureSize(values, 0));
  float lx = length(uvDx * size);
  float ly = length(uvDy * size);
  vec2 major = lx >= ly ? uvDx : uvDy;
  vec2 minor = lx >= ly ? uvDy : uvDx;
  float lMajor = max(lx, ly);
  float lMinor = min(lx, ly);

  // Magnified: one sample, and the values are interpolated as they should be.
  if (lMajor <= 1.0) {
    return rampColor(textureGrad(values, uv, uvDx, uvDy).r, palette, paletteV, range);
  }

  // Split the budget so every sample covers about the same number of texels each way, and
  // never use more samples along an axis than it spans texels.
  float budget = float(RAMP_FILTER_TAPS);
  float nMajor = clamp(floor(sqrt(budget * lMajor / max(lMinor, 1e-6)) + 0.5), 1.0, min(budget, ceil(lMajor)));
  float nMinor = clamp(floor(budget / nMajor), 1.0, max(ceil(lMinor), 1.0));
  vec2 gMajor = major / nMajor;
  vec2 gMinor = minor / nMinor;
  int count = int(nMajor * nMinor);

  vec3 sum = vec3(0.0);
  for (int i = 0; i < RAMP_FILTER_TAPS; i++) {
    if (i >= count) break;
    float a = mod(float(i), nMajor);
    float b = floor(float(i) / nMajor);
    vec2 at = uv
      + major * ((a + 0.5) / nMajor - 0.5)
      + minor * ((b + 0.5) / nMinor - 0.5);
    sum += rampColor(textureGrad(values, at, gMajor, gMinor).r, palette, paletteV, range);
  }
  return sum / float(count);
}
