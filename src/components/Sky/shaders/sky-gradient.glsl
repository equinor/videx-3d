// The sky's gradient and the sun's halo: what the sky is drawn from, and all its stand-in
// draws while the sky compiles.

uniform vec3 uSkyUp; // normalised
uniform vec3 uSkyZenithColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uSkyGroundColor;
uniform vec3 uSkyNadirColor;
uniform vec3 uSkySunDirection; // world space, normalised
uniform vec3 uSkySunColor;
uniform float uSkySunGlow;
uniform float uSkyDaylight;

// Gradient, daylight and the sun's halo; no disc.
vec3 skySurface(vec3 dir, float blend) {
  float y = dot(dir, uSkyUp);
  vec3 sky = mix(uSkyHorizonColor, uSkyZenithColor, sqrt(max(y, 0.0)));
  vec3 ground = mix(uSkyGroundColor, uSkyNadirColor, sqrt(max(-y, 0.0)));
  // The sky carries on a little below the horizon, reading as distant haze.
  vec3 color = mix(sky, ground, smoothstep(0.0, blend, -y));

  // Night keeps a little light so the scene never goes black.
  color *= mix(0.15, 1.0, uSkyDaylight);

  float toward = max(dot(dir, uSkySunDirection), 0.0);
  float halo = 0.6 * pow(toward, 6.0) + 0.4 * pow(toward, 48.0);
  return color + uSkySunColor * halo * uSkySunGlow * smoothstep(-blend, 0.0, y);
}
