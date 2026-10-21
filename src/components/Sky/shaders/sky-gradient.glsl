// The sky's gradient and the sun's halo: what the sky is drawn from.

uniform vec3 uSkyUp; // normalised
uniform vec3 uSkyZenithColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uSkyGroundColor;
uniform vec3 uSkyNadirColor;
uniform vec3 uSkySunDirection; // world space, normalised
uniform vec3 uSkySunColor;
uniform float uSkySunGlow;
uniform float uSkyDaylight;
uniform vec2 uSkyTwilight; // strength, and how much the horizon glows for the sun's elevation (skyTwilight)
uniform vec3 uSkyAir; // its ground along up, the height it thins by e over (0 for none), and its visibility there (0 for no haze)

// The twilight sky on the sun's side, linear: gold about the sun, orange around it, deep
// orange high up; and the sun's disc, overexposed even when its light is red.
#define SKY_TWILIGHT_GOLD vec3(1.0, 0.45, 0.06)
#define SKY_TWILIGHT_ORANGE vec3(1.0, 0.22, 0.03)
#define SKY_TWILIGHT_EMBER vec3(0.5, 0.1, 0.012)
#define SKY_TWILIGHT_DISC vec3(1.0, 0.75, 0.4)
// Warmer than the gold: tone mapping turns a bright gold lemon.
#define SKY_TWILIGHT_LIGHT vec3(1.0, 0.36, 0.045)

// The sun's light on the sky and the clouds: golden about sunrise and sunset, where its
// red over the blue sky would read pink.
vec3 skyTwilightLight() {
  return mix(uSkySunColor, SKY_TWILIGHT_LIGHT, min(uSkyTwilight.x * uSkyTwilight.y, 1.0));
}

vec3 skySunDiscColor() {
  return mix(uSkySunColor, SKY_TWILIGHT_DISC, min(uSkyTwilight.x * uSkyTwilight.y, 1.0));
}

// How much of the air lies below the camera: 0 on its ground, toward 1 high above it.
float skyAirBelow() {
  if(uSkyAir.y <= 0.0)
    return 0.0;
  return 1.0 - exp(-max(dot(cameraPosition, uSkyUp) - uSkyAir.x, 0.0) / uSkyAir.y);
}

// How much the air hazes what lies `dist` along `dir` from `origin`: it thins with height,
// so a ray through high air hazes far less than one along the sea.
float skyAirHaze(vec3 origin, vec3 dir, float dist) {
  if(uSkyAir.z <= 0.0)
    return 0.0;
  float start = max(dot(origin, uSkyUp) - uSkyAir.x, 0.0);
  float mean = 1.0;
  if(uSkyAir.y > 0.0) {
    // The mean density between the heights the ray runs between.
    float climb = (max(start + dot(dir, uSkyUp) * dist, 0.0) - start) / uSkyAir.y;
    mean = exp(-start / uSkyAir.y) * (abs(climb) > 1e-4 ? (1.0 - exp(-climb)) / climb : 1.0);
  }
  return 1.0 - exp(-dist * mean / uSkyAir.z);
}

// Gradient, daylight, the sun's halo and the twilight glow; no disc.
vec3 skySurface(vec3 dir, float blend) {
  float y = dot(dir, uSkyUp);
  // Higher up, the sky deepens and its haze closes onto the horizon.
  float below = skyAirBelow();
  // Deeper, not darker: the weaker channels drop, so a blue grows saturated and a grey stays grey.
  vec3 deep = uSkyZenithColor * uSkyZenithColor / max(max(uSkyZenithColor.r, max(uSkyZenithColor.g, uSkyZenithColor.b)), 1e-4);
  vec3 zenith = mix(uSkyZenithColor, deep * 0.85, below * below);
  vec3 sky = mix(uSkyHorizonColor, zenith, pow(max(y, 0.0), mix(0.5, 0.3, below)));
  vec3 ground = mix(uSkyGroundColor, uSkyNadirColor, sqrt(max(-y, 0.0)));
  // The sky carries on a little below the horizon, reading as distant haze.
  vec3 color = mix(sky, ground, smoothstep(0.0, blend, -y));

  // Night keeps a little light so the scene never goes black.
  color *= mix(0.15, 1.0, uSkyDaylight);

  float toward = max(dot(dir, uSkySunDirection), 0.0);
  float overHorizon = smoothstep(-blend, 0.0, y);

  // Sunrise and sunset: the sun's side of the sky turns gold about it and orange around,
  // replacing the blue, which would turn it pink; a faint pink belt opposite.
  float twilight = uSkyTwilight.x * uSkyTwilight.y;
  if(twilight > 0.0) {
    vec3 across = dir - uSkyUp * y;
    float sunY = dot(uSkySunDirection, uSkyUp);
    vec3 sunAcross = uSkySunDirection - uSkyUp * sunY;
    float facing = 0.5 + 0.5 * dot(across, sunAcross) * inversesqrt(max(dot(across, across) * dot(sunAcross, sunAcross), 1e-8));
    float rise = max(y, 0.0);
    // Gold while the sun is up, orange about sunset, deep orange high up.
    float low = 1.0 - smoothstep(0.0, 0.2, sunY);
    vec3 band = mix(SKY_TWILIGHT_GOLD, mix(SKY_TWILIGHT_ORANGE, SKY_TWILIGHT_GOLD, pow(toward, 8.0)), low);
    band = mix(band, SKY_TWILIGHT_EMBER, smoothstep(0.1, 0.7, rise));
    // Full while the sun is about the horizon, dimming once it is 6 degrees down.
    float bright = mix(0.3, 1.0, smoothstep(-0.1, 0.0, sunY));
    // Broadest about sunset: closing about the sun above it, onto the horizon below.
    float spread = mix(8.0, 2.0, uSkyTwilight.y);
    float lift = mix(1.5, 12.0, smoothstep(0.0, -0.1, sunY));
    float wedge = pow(facing, spread) * exp(-rise * rise * lift);
    float weight = 0.95 * uSkyTwilight.x * smoothstep(0.0, 0.5, uSkyTwilight.y) * wedge;
    color = mix(color, band * bright, clamp(weight, 0.0, 1.0) * overHorizon);
    vec3 glow = SKY_TWILIGHT_LIGHT * (0.5 * pow(toward, 16.0) + 0.4 * pow(toward, 200.0));
    color += glow * twilight * bright * overHorizon;
    float away = 1.0 - facing;
    vec3 belt = vec3(0.8, 0.45, 0.55) * exp(-pow((rise - 0.07) * 14.0, 2.0)) * away * away;
    color += twilight * 0.2 * belt * overHorizon;
  }

  // Full down to about 3° below the horizon, gone with the twilight by 12°.
  float fade = smoothstep(-0.2, -0.05, dot(uSkySunDirection, uSkyUp));
  float halo = (0.6 * pow(toward, 6.0) + 0.4 * pow(toward, 48.0)) * fade;
  color += skyTwilightLight() * halo * uSkySunGlow * overHorizon;
  return color;
}
