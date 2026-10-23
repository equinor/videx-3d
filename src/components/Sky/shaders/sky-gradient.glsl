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
uniform float uSkyMoonlight; // 0 until the daylight is gone, 1 by nautical twilight: how much the moon lights (skyMoonlight)
// uSkyDaylight, uSkyTwilight.y and uSkyMoonlight for the sun over the camera's lowered
// horizon, and how far it is lowered (radians); uSkySunColor for the same.
uniform vec4 uSkyAirLight;
uniform vec3 uSkyAirSunColor;
uniform vec3 uSkyAir; // its ground along up, the height it thins by e over (0 for none), and its visibility there (0 for no haze)
uniform vec2 uSkyHaze; // the low haze layer: the height it thins by e over, and its share of the haze at the ground
uniform float uSkyCurvature; // 1 over the Earth's radius; 0 for a flat sea
uniform vec4 uSkyFlat; // the disc about the scene the sea stays flat over: its centre (world) and radius

// The twilight sky on the sun's side, linear: gold about the sun, orange around it, deep
// orange high up; and the sun's disc, overexposed even when its light is red.
#define SKY_TWILIGHT_GOLD vec3(1.0, 0.45, 0.06)
#define SKY_TWILIGHT_ORANGE vec3(1.0, 0.22, 0.03)
#define SKY_TWILIGHT_EMBER vec3(0.5, 0.1, 0.012)
#define SKY_TWILIGHT_DISC vec3(1.0, 0.75, 0.4)
// Warmer than the gold: tone mapping turns a bright gold lemon.
#define SKY_TWILIGHT_LIGHT vec3(1.0, 0.36, 0.045)
// What night leaves of the sky's and the sea's light, so the scene, lit by the bakes, never goes black.
#define SKY_NIGHT_LEVEL 0.045
// Over the air's ground, where the sky starts to darken toward space, and where it is black:
// the tropopause, and the top of the stratosphere (world units).
#define SKY_SPACE_START 12000.0
#define SKY_SPACE 50000.0
// The ozone layer: the height it is densest at and how far either side it reaches (world
// units), and what a view through it keeps of the light: it takes out orange and red.
#define SKY_OZONE_LAYER vec2(25000.0, 10000.0)
#define SKY_OZONE vec3(0.45, 0.75, 1.0)
// How much more air a view along the level passes than one straight up, and how much of
// that the darkening toward space counts: 1 would be all, which darkens overhead too soon.
#define SKY_AIR_LEVEL_MASS 35.0
#define SKY_AIR_PATH 0.5
// From high up, a glow over the Earth's edge: it fades by e every this much the view passes
// over the ground (softer than the air itself), and shows between these camera heights.
#define SKY_RIM_HEIGHT 60000.0
#define SKY_RIM_SHOWN vec2(20000.0, 80000.0)

// How much of the air lies below the camera: 0 on its ground, toward 1 high above it.
float skyAirBelow() {
  if(uSkyAir.y <= 0.0)
    return 0.0;
  return 1.0 - exp(-max(dot(cameraPosition, uSkyUp) - uSkyAir.x, 0.0) / uSkyAir.y);
}

// The same of the haze, the low layer by its share: the camera soon rises out of most of it.
float skyHazeBelow() {
  if(uSkyAir.y <= 0.0 || uSkyHaze.x <= 0.0)
    return skyAirBelow();
  float layer = 1.0 - exp(-max(dot(cameraPosition, uSkyUp) - uSkyAir.x, 0.0) / uSkyHaze.x);
  return mix(skyAirBelow(), layer, uSkyHaze.y);
}

// The mean density, relative to its ground's, of air thinning by e every `scale` along a ray
// from `start` over its ground that climbs `rise`. ⚠️ From its lower end: from the top,
// exp(-start / scale) underflows high up while its partner overflows (0 * inf).
float skyAirMean(float start, float rise, float scale) {
  float a = start / scale;
  float b = max(start + rise, 0.0) / scale;
  float span = abs(b - a);
  return exp(-min(a, b)) * (span > 1e-4 ? (1.0 - exp(-span)) / span : 1.0);
}

// How much the air hazes what lies `dist` along `dir` from `origin`: the low haze layer and
// the clear air above it, each thinning with height, so a ray down from high up crosses the
// layer only at its end, and one along the sea hazes most.
float skyAirHaze(vec3 origin, vec3 dir, float dist) {
  if(uSkyAir.z <= 0.0)
    return 0.0;
  float start = max(dot(origin, uSkyUp) - uSkyAir.x, 0.0);
  float mean = 1.0;
  if(uSkyAir.y > 0.0) {
    float rise = dot(dir, uSkyUp) * dist;
    float clear = skyAirMean(start, rise, uSkyAir.y);
    float layer = uSkyHaze.x > 0.0 ? skyAirMean(start, rise, uSkyHaze.x) : clear;
    mean = mix(clear, layer, uSkyHaze.y);
  }
  return 1.0 - exp(-dist * mean / uSkyAir.z);
}

// Along the level way `level` (unit) from `origin`, how far it is to the edge of the disc
// the sea is flat over; negative once past it. Beyond the edge the sea falls away with the
// Earth's curve, as measured along that line.
float skyFlatRun(vec3 origin, vec3 level) {
  return uSkyFlat.w - dot(origin - uSkyFlat.xyz, level);
}

// The sine of the elevation of the sea's horizon along `dir`, seen from `origin` `height`
// above the sea: 0 on a flat sea, lower the higher up as the Earth curves it away.
float skyHorizonAt(vec3 dir, vec3 origin, float height) {
  if(uSkyCurvature <= 0.0 || height <= 0.0)
    return 0.0;
  vec3 level = dir - uSkyUp * dot(dir, uSkyUp);
  float n = length(level);
  float k = uSkyCurvature;
  float run = n > 1e-6 ? k * skyFlatRun(origin, level / n) : k * uSkyFlat.w;
  // Where the ray just grazes the sea: the slope of the tangent from the camera.
  float q = sqrt(run * run + 2.0 * k * height);
  float slope = run > 0.0 ? -2.0 * k * height / (run + q) : run - q;
  return slope * inversesqrt(1.0 + slope * slope);
}

// The same from the camera, over the air's ground.
float skyHorizon(vec3 dir) {
  return skyHorizonAt(dir, cameraPosition, dot(cameraPosition, uSkyUp) - uSkyAir.x);
}

// The lowest height over the air's ground a view along `dir` from `height` passes: the
// camera's own looking up; toward the horizon, as low as the Earth's curve brings it. On the
// sea's own curve (skyOceanReach), so the air meets the sea's edge: from high up a true
// sphere would put that edge in space.
float skyLowest(vec3 dir, float height) {
  float y = dot(dir, uSkyUp);
  if(y >= 0.0 || uSkyCurvature <= 0.0)
    return height;
  vec3 level = dir - uSkyUp * y;
  float c = max(length(level), 1e-3);
  float run = skyFlatRun(cameraPosition, level / c);
  // Past the camera only when the view falls less than the curve: else lowest overhead.
  if(run - y / (uSkyCurvature * c) <= 0.0)
    return height + 0.5 * uSkyCurvature * run * run;
  return height + y * run / c - y * y / (2.0 * uSkyCurvature * c * c);
}

// The sky's light where it is seen: by the sun over the horizon there, which the Earth's curve
// lowers higher up, so from high up the air stays lit after the sea's sunset.
struct SkyLight {
  float daylight;
  float twilight; // how much the horizon glows (skyTwilight)
  float moonlight;
  vec3 sun; // the sun's colour
  float sunY; // the sun's elevation, a sine
};

// The light at `share` of the way from the sea's (0) to the camera's (1).
SkyLight skyLight(float share) {
  SkyLight seen;
  seen.daylight = mix(uSkyDaylight, uSkyAirLight.x, share);
  seen.twilight = mix(uSkyTwilight.y, uSkyAirLight.y, share);
  seen.moonlight = mix(uSkyMoonlight, uSkyAirLight.z, share);
  seen.sun = mix(uSkySunColor, uSkyAirSunColor, share);
  seen.sunY = sin(asin(clamp(dot(uSkySunDirection, uSkyUp), -1.0, 1.0)) + uSkyAirLight.w * share);
  return seen;
}

// How far toward the camera's the light of the air at `height` over its ground is: as the
// horizon drops, by the root of its height over the camera's. 0 on a flat sea and in the bakes.
float skyLightShareAt(float height) {
  float camera = dot(cameraPosition, uSkyUp) - uSkyAir.x;
  if(uSkyCurvature <= 0.0 || uSkyAirLight.w <= 0.0 || camera <= 0.0)
    return 0.0;
  return sqrt(clamp(height / camera, 0.0, 1.0));
}

// The same for a view along `dir` from `height`: by the lowest it passes.
float skyLightShare(vec3 dir, float height) {
  return skyLightShareAt(skyLowest(dir, height));
}

// The sun's light on the sky and the clouds: golden about sunrise and sunset, where its
// red over the blue sky would read pink.
vec3 skyTwilightLight(SkyLight seen) {
  return mix(seen.sun, SKY_TWILIGHT_LIGHT, min(uSkyTwilight.x * seen.twilight, 1.0));
}

vec3 skySunDiscColor(SkyLight seen) {
  return mix(seen.sun, SKY_TWILIGHT_DISC, min(uSkyTwilight.x * seen.twilight, 1.0));
}

// How much of a view passing no lower than `lowest` over the air's ground is space: as the air
// above the tropopause thins, by e every scale height, scaled to black at SKY_SPACE. Air only.
float skySpaceAbove(float lowest) {
  float end = exp(-(SKY_SPACE - SKY_SPACE_START) / uSkyAir.y);
  float air = (exp(-max(lowest - SKY_SPACE_START, 0.0) / uSkyAir.y) - end) / (1.0 - end);
  return 1.0 - clamp(air, 0.0, 1.0);
}

// The blue overhead as the air below deepens it: the weaker channels drop, so a blue grows
// saturated and a grey stays grey.
vec3 skyDeepZenith() {
  return 0.85 * uSkyZenithColor * uSkyZenithColor / max(max(uSkyZenithColor.r, max(uSkyZenithColor.g, uSkyZenithColor.b)), 1e-4);
}

// The sine `y` of an elevation, measured from the horizon as seen (`horizon`, its sine)
// instead of from the level: the zenith and the nadir stay where they are.
float skyOverHorizon(float y, float horizon) {
  return (y - horizon) / (y >= horizon ? 1.0 - horizon : 1.0 + horizon);
}

// How much of the air lies below `height` over its ground: 0 on it, toward 1 high above it.
float skyAirBelowAt(float height) {
  return 1.0 - exp(-max(height, 0.0) / uSkyAir.y);
}

// How high a view along `dir` from `height` is, by the little air it passes: the lowest it
// reaches and, from high up, higher the more steeply it looks up, as it leaves the air sooner.
// Up from the horizon as seen, so it runs on smoothly across the level. Air only.
float skyAirHeight(vec3 dir, float height) {
  float up = max(skyOverHorizon(dot(dir, uSkyUp), skyHorizonAt(dir, cameraPosition, height)), 0.0);
  float steeper = SKY_AIR_PATH * uSkyAir.y * log(1.0 + SKY_AIR_LEVEL_MASS * up);
  return skyLowest(dir, height) + steeper * skyAirBelowAt(height);
}

// Whether a view from `height` can reach the air that darkens toward space.
bool skyNearSpace(float height) {
  if(uSkyAir.y <= 0.0)
    return false;
  float steepest = SKY_AIR_PATH * uSkyAir.y * log(1.0 + SKY_AIR_LEVEL_MASS);
  return height + steepest * skyAirBelowAt(height) > SKY_SPACE_START;
}

// How much of the sky along `dir`, seen from `height` over the air's ground, is space: by the
// air the view passes.
float skySpace(vec3 dir, float height) {
  return skyNearSpace(height) ? skySpaceAbove(skyAirHeight(dir, height)) : 0.0;
}

// Gradient, daylight, the sun's halo and the twilight glow; no disc. Seen from `height` over
// the air's ground, which lowers the horizon: the air's own light, without the dark of space.
vec3 skySurfaceAt(vec3 dir, float blend, float height) {
  float y = skyOverHorizon(dot(dir, uSkyUp), skyHorizonAt(dir, cameraPosition, height));
  SkyLight seen = skyLight(skyLightShare(dir, height));
  // Higher up, the sky deepens, and its haze closes onto the horizon as the camera rises out of it.
  float below = skyAirBelow();
  vec3 zenith = mix(uSkyZenithColor, skyDeepZenith(), below * below);
  vec3 sky = mix(uSkyHorizonColor, zenith, pow(max(y, 0.0), mix(0.5, 0.3, skyHazeBelow())));
  vec3 ground = mix(uSkyGroundColor, uSkyNadirColor, sqrt(max(-y, 0.0)));
  // The sky carries on a little below the horizon, reading as distant haze.
  vec3 color = mix(sky, ground, smoothstep(0.0, blend, -y));

  color *= mix(SKY_NIGHT_LEVEL, 1.0, seen.daylight);

  float toward = max(dot(dir, uSkySunDirection), 0.0);
  float overHorizon = smoothstep(-blend, 0.0, y);

  // Sunrise and sunset: the sun's side of the sky turns gold about it and orange around,
  // replacing the blue, which would turn it pink; a faint pink belt opposite.
  float twilight = uSkyTwilight.x * seen.twilight;
  if(twilight > 0.0) {
    vec3 across = dir - uSkyUp * dot(dir, uSkyUp);
    float sunY = seen.sunY;
    vec3 sunAcross = uSkySunDirection - uSkyUp * dot(uSkySunDirection, uSkyUp);
    float facing = 0.5 + 0.5 * dot(across, sunAcross) * inversesqrt(max(dot(across, across) * dot(sunAcross, sunAcross), 1e-8));
    float rise = max(y, 0.0);
    // Gold while the sun is up, orange about sunset, deep orange high up.
    float low = 1.0 - smoothstep(0.0, 0.2, sunY);
    vec3 band = mix(SKY_TWILIGHT_GOLD, mix(SKY_TWILIGHT_ORANGE, SKY_TWILIGHT_GOLD, pow(toward, 8.0)), low);
    band = mix(band, SKY_TWILIGHT_EMBER, smoothstep(0.1, 0.7, rise));
    // Full while the sun is about the horizon, dimming once it is 6 degrees down.
    float bright = mix(0.3, 1.0, smoothstep(-0.1, 0.0, sunY));
    // Broadest about sunset: closing about the sun above it, onto the horizon below.
    float spread = mix(8.0, 2.0, seen.twilight);
    float lift = mix(1.5, 12.0, smoothstep(0.0, -0.1, sunY));
    float wedge = pow(facing, spread) * exp(-rise * rise * lift);
    float weight = 0.95 * uSkyTwilight.x * smoothstep(0.0, 0.5, seen.twilight) * wedge;
    color = mix(color, band * bright, clamp(weight, 0.0, 1.0) * overHorizon);
    vec3 glow = SKY_TWILIGHT_LIGHT * (0.5 * pow(toward, 16.0) + 0.4 * pow(toward, 200.0));
    color += glow * twilight * bright * overHorizon;
    float away = 1.0 - facing;
    vec3 belt = vec3(0.8, 0.45, 0.55) * exp(-pow((rise - 0.07) * 14.0, 2.0)) * away * away;
    color += twilight * 0.2 * belt * overHorizon;
  }

  // Full down to about 3° below the horizon, gone with the twilight by 12°.
  float fade = smoothstep(-0.2, -0.05, seen.sunY);
  float halo = (0.6 * pow(toward, 6.0) + 0.4 * pow(toward, 48.0)) * fade;
  color += skyTwilightLight(seen) * halo * uSkySunGlow * overHorizon;
  return color;
}

// The same from the camera. Toward space, by the air the view passes, it deepens to the blue
// overhead, bluer still through the ozone layer, and goes black, but for a glow over the
// Earth's edge: pale low down, deep blue higher, brighter toward the sun.
vec3 skySurface(vec3 dir, float blend) {
  float height = dot(cameraPosition, uSkyUp) - uSkyAir.x;
  vec3 color = skySurfaceAt(dir, blend, height);
  if(!skyNearSpace(height))
    return color;
  float air = skyAirHeight(dir, height);
  float space = skySpaceAbove(air);
  SkyLight seen = skyLight(skyLightShare(dir, height));
  color = mix(color, skyDeepZenith() * mix(SKY_NIGHT_LEVEL, 1.0, seen.daylight), smoothstep(0.0, 0.5, space));
  float ozone = 1.0 - smoothstep(0.0, SKY_OZONE_LAYER.y, abs(air - SKY_OZONE_LAYER.x));
  color *= mix(vec3(1.0), SKY_OZONE, ozone) * (1.0 - space);
  float lowest = max(skyLowest(dir, height), 0.0);
  float rim = exp(-lowest / SKY_RIM_HEIGHT) * smoothstep(SKY_RIM_SHOWN.x, SKY_RIM_SHOWN.y, height);
  if(rim > 1e-3) {
    float toward = max(dot(dir, uSkySunDirection), 0.0);
    vec3 glow = mix(skyDeepZenith(), uSkyHorizonColor, exp(-lowest / (0.35 * SKY_RIM_HEIGHT)));
    color += glow * rim * seen.daylight * (0.55 + 0.45 * toward * toward);
  }
  return color;
}

// The horizon's colour along the bearing `way` (unit, level), where it is seen from the
// camera: the light of the air the far sea fades into.
vec3 skyHorizonColor(vec3 way, float blend) {
  float height = dot(cameraPosition, uSkyUp) - uSkyAir.x;
  float sine = skyHorizonAt(way, cameraPosition, height);
  return skySurfaceAt(way * sqrt(1.0 - sine * sine) + uSkyUp * sine, blend, height);
}
