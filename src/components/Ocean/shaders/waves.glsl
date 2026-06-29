// Shared ocean wave model.
//
// The wave field is a discrete set of directional wave components sampled (on
// the CPU, in ocean-material.ts) from a JONSWAP spectrum tuned for the North
// Sea (Joint North Sea Wave Project, 1973; peak-enhancement gamma = 3.3) with
// its Pierson-Moskowitz fully-developed limit for the peak frequency and
// significant wave height. All physical units are METERS / m/s.
//
// Per component i (deep-water dispersion omega^2 = g*k is baked in on the CPU):
//   uWaveA[i] = vec4(dirX, dirZ, k, omega)   // unit direction, wavenumber, ang. freq.
//   uWaveB[i] = vec4(amplitude, phase0, 0, 0)
//
// Everything is evaluated in WORLD X/Z so the surface is continuous and
// seamless across tiled/patched geometry (any two patches sharing a world
// position compute the identical surface).

uniform vec4 uWaveA[OCEAN_WAVE_COUNT];
uniform vec4 uWaveB[OCEAN_WAVE_COUNT];

// Sum height + horizontal (Gerstner) displacement from the lowest-frequency
// `count` components (the array is ordered low->high frequency, so these are
// the longest, largest swells). Used only by the optional vertex displacement
// path (floating-object support); at oilfield scale the displacement is
// imperceptible unless the camera is very close to the surface.
void oceanDisplace(
  vec2 p,
  float t,
  float choppiness,
  int count,
  out vec3 disp
) {
  disp = vec3(0.0);
  for(int i = 0; i < OCEAN_WAVE_COUNT; i++) {
    if(i >= count)
      break;
    vec4 a = uWaveA[i];
    vec2 d = a.xy;
    float k = a.z;
    float omega = a.w;
    float amp = uWaveB[i].x;
    float ph = k * dot(d, p) - omega * t + uWaveB[i].y;
    float c = cos(ph);
    disp.y += amp * sin(ph);
    // Horizontal (Gerstner) orbital motion, proportional to THIS component's own
    // amplitude so it stays in proportion with the height — a near-circular
    // deep-water orbit flattened by `choppiness` (0 = pure vertical sine, 1 =
    // circular orbit / sharp crests). The previous 1/k normalisation made the
    // horizontal swing scale with wavelength and ignore the amplitude, so the
    // long swells slid the surface many metres sideways for only ~1 m of rise.
    // Because each component's horizontal swing is <= choppiness * amp, the
    // summed field can never fold.
    disp.x += choppiness * amp * d.x * c;
    disp.z += choppiness * amp * d.y * c;
  }
}

// Final, scaled vertex displacement shared by the ocean surface and the water-
// body wall top so the rim stays perfectly sealed (the wall top and surface
// edge resolve to the IDENTICAL world position). The horizontal orbital motion
// is already bounded by `choppiness` inside oceanDisplace (it can never fold),
// so the whole displacement simply scales uniformly with `displacement`.
// Both shaders MUST call this rather than scaling `oceanDisplace` themselves, or
// the surface edge and wall top drift apart when displaced.
vec3 oceanDisplacement(
  vec2 p,
  float t,
  float choppiness,
  float displacement,
  int count
) {
  vec3 disp;
  oceanDisplace(p, t, choppiness, count, disp);
  return disp * displacement;
}

// Sum surface slope (d height / d world XZ) and height from ALL components,
// with per-component footprint anti-aliasing: a component fades out smoothly
// once its wavelength approaches the on-screen pixel size (`texel` = world
// units per pixel). This both removes shimmer/aliasing at the horizon and,
// because the fade is a smooth function of each wave's projected size rather
// than a fixed world-distance radius, eliminates any visible LOD ring.
void oceanSurface(
  vec2 p,
  float t,
  float texel,
  out vec2 slope,
  out float height
) {
  slope = vec2(0.0);
  height = 0.0;
  for(int i = 0; i < OCEAN_WAVE_COUNT; i++) {
    vec4 a = uWaveA[i];
    vec2 d = a.xy;
    float k = a.z;
    float omega = a.w;
    float amp = uWaveB[i].x;
    // k * texel = radians of phase per pixel; fade as it approaches Nyquist.
    float aa = 1.0 - smoothstep(1.5, 3.0, k * texel);
    if(aa <= 0.001)
      continue;
    float ph = k * dot(d, p) - omega * t + uWaveB[i].y;
    height += amp * sin(ph) * aa;
    slope += d * (amp * k * cos(ph)) * aa;
  }
}
