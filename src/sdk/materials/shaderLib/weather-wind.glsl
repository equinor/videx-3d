// The weather's wind over the sea: gusts and slicks (the twin of sdk/weather/wind-field.ts,
// weatherWindAt, to single precision). Uniform-free: what draws by the weather's wind passes
// the field in.

// About the share of the sea slicks cover where the wind allows them all (WEATHER_SLICK_MEAN).
#define WEATHER_SLICK_MEAN 0.234

// Hoskins' hash12.
float weatherHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise in [0, 1], smoothed, on the integer lattice.
float weatherNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(weatherHash(i), weatherHash(i + vec2(1.0, 0.0)), u.x), mix(weatherHash(i + vec2(0.0, 1.0)), weatherHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The local wind at `p` of the plane (metres), as a factor on the mean wind, about 1 ± the
// gusts' strength; `slick` (0 to 1) where a slick lies. `toward` the way the wind blows
// (unit); `travel` x how far the mean wind has run (metres), y the seed; `gusts` x strength,
// y the largest gusts across (m), z the slicks the wind allows, w the slicks across (m).
// Features under about two `pixel`s (metres) give way to their mean.
float weatherWindAt(vec2 p, vec2 toward, vec2 travel, vec4 gusts, float pixel, out float slick) {
  vec2 q = vec2(dot(p, toward), dot(p, vec2(-toward.y, toward.x)));
  float seed = travel.y;
  // WEATHER_GUST_OCTAVES: size, stretch along the wind, speed (of the wind's), weight.
  float n = 0.0;
  float size = gusts.y;
  float fade = 1.0 - smoothstep(0.25, 0.5, pixel / size);
  if(fade > 0.0)
    n += 0.5 * fade * (2.0 * weatherNoise(vec2((q.x - 0.85 * travel.x) / (size * 1.6), q.y / size) + vec2(seed * 17.3, seed * 9.1)) - 1.0);
  size = gusts.y / 5.0;
  fade = 1.0 - smoothstep(0.25, 0.5, pixel / size);
  if(fade > 0.0)
    n += 0.33 * fade * (2.0 * weatherNoise(vec2((q.x - travel.x) / (size * 1.4), q.y / size) + vec2(seed * 17.3 + 31.7, seed * 9.1 + 53.3)) - 1.0);
  size = gusts.y / 25.0;
  fade = 1.0 - smoothstep(0.25, 0.5, pixel / size);
  if(fade > 0.0)
    n += 0.25 * fade * (2.0 * weatherNoise(vec2((q.x - 1.15 * travel.x) / (size * 1.2), q.y / size) + vec2(seed * 17.3 + 63.4, seed * 9.1 + 106.6)) - 1.0);
  // Over one standard deviation of the noise and the weights' norm: a spread of `strength`.
  float factor = max(1.0 + gusts.x * n / (0.4289 * 0.6491533), 0.05);
  // Slicks: streaks five times as long along the wind, drifting with a slow current; their
  // mean where under the pixel.
  float slickFade = 1.0 - smoothstep(0.25, 0.5, pixel / gusts.w);
  float value = weatherNoise(vec2((q.x - 0.03 * travel.x) / (gusts.w * 5.0) + seed * 5.7, q.y / gusts.w + seed * 3.1));
  slick = gusts.z * (WEATHER_SLICK_MEAN + slickFade * (smoothstep(0.6, 0.75, value) - WEATHER_SLICK_MEAN));
  return factor;
}
