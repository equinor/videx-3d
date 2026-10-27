// The sky's gradient and the sun's halo: what the sky is drawn from.

#include ../../../sdk/materials/shaderLib/globe.glsl

uniform vec3 uSkyUp; // normalised
uniform vec3 uSkyZenithColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uSkyGroundColor;
uniform vec3 uSkyNadirColor;
uniform vec3 uSkySunDirection; // world space, normalised
uniform vec3 uSkySunColor;
uniform float uSkySunSize; // angular radius, radians
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
uniform vec4 uSkyStageFlat; // the disc about the scene the sea stays flat over: its centre (world) and radius, as the globe's

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
// From high up the view takes in the night side as well as the day: between these camera
// heights over the air's ground the ground, the sea and the rim come to be lit by the sun
// over their own horizon (skyDayAt). Below, the sky's light, the camera's sun's, holds.
#define SKY_FROM_SPACE vec2(100000.0, 1000000.0)
// From space: the sea's colour, as a share of the blue overhead deepened once more, and the
// share of the sky it reflects looking straight down (Fresnel's, toward 1 along the level);
// the sun's glint off its waves: how tight (a power of the angle off the mirror, lower is
// broader) and how strong, strengthened toward grazing.
#define SKY_SPACE_SEA 0.35
#define SKY_SPACE_SEA_REFLECT 0.02
#define SKY_SPACE_GLINT vec2(60.0, 0.12)
// From space, the air over the ground: how much more it hazes than its visibility says (that
// is the low air's, and leaves out the blue it scatters overhead), and how far its light pales
// from the blue overhead toward the horizon's colour as the view crosses more of it. Seen
// from space the air adds blue, not grey: pale, it greyed the sea from navy to slate.
#define SKY_SPACE_HAZE 2.0
#define SKY_SPACE_AIR_PALE 0.5
// From space, the ground as lit by the sun where it lies: the sun's irradiance at full day
// and the ambient's, as the scene's sun (`sun.intensity`) and light probe give over the field.
#define SKY_SPACE_GROUND_SUN 1.5
#define SKY_SPACE_GROUND_AMBIENT 0.6
// The sun's colour by its elevation (skySunColor, linear): on the horizon, a few degrees up,
// and high.
#define SKY_SUN_HORIZON vec3(1.0, 0.1559, 0.0331)
#define SKY_SUN_LOW vec3(1.0, 0.3763, 0.0844)
#define SKY_SUN_HIGH vec3(1.0, 0.9216, 0.8070)

// The camera's height over the air's ground, over the globe (globeCameraHeight).
float skyCameraHeight() {
  return globeCameraHeight() - uSkyAir.x;
}

// How far the view is seen from space (SKY_FROM_SPACE): 0 in the air, 1 well above it.
// The sky's light, its gradient and the sea's shading are the camera's (globeCameraLook);
// from space the view takes in places round the Earth from it, lit otherwise, so what lies
// below is shaded by where it lies instead (skyFromSpaceOver).
float skyFromSpace() {
  return smoothstep(SKY_FROM_SPACE.x, SKY_FROM_SPACE.y, skyCameraHeight());
}

// How sunlit the ground is under `up` (its up there): 0 by night, 1 by day.
float skySunlit(vec3 up) {
  return smoothstep(-0.1, 0.05, dot(uSkySunDirection, up));
}

// How much of the sun's disc stands over the horizon where its elevation's sine is `sine`.
float skySunDiscUp(float sine) {
  float r = max(uSkySunSize, 1e-3);
  return smoothstep(-r, r, sine);
}

// How much of the light it is shaded by holds for what lies under `up`, when that light is
// the one under `ref` (the field's up for the scene's lights; globeCameraLook for the sky
// the camera sees): the day there as a share of the day under `ref`, down to the night's
// level where the sun has set there. Never more than 1: a share of a near shading cannot
// brighten it. 1 under `ref`, so over the field nothing changes.
float skyDayFrom(vec3 ref, vec3 up) {
  float from = mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(ref));
  return min(mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(up)) / from, 1.0);
}

// How much of a light along `light` (unit), as it shines under `ref` (the field's up for the
// scene's lights), still reaches what lies under `up`: all while it stands over the horizon
// there, or as high as under `ref`; none once it lies a sun's breadth lower. For a glint,
// which a light below the horizon cannot give: over the field the scene's light shines on
// from a little below it.
float skyLightFrom(vec3 light, vec3 ref, vec3 up) {
  float r = max(uSkySunSize, 1e-3);
  return smoothstep(-2.0 * r, 0.0, dot(light, up) - min(dot(light, ref), 0.0));
}

// The sun's colour seen through the air at an elevation whose sine is `sine`: the GLSL twin
// of skySunColor, for where the sky's own light is not the place's (from space).
vec3 skySunColorAt(float sine) {
  float elevation = degrees(asin(clamp(sine, -1.0, 1.0)));
  if(elevation < 6.0)
    return mix(SKY_SUN_HORIZON, SKY_SUN_LOW, smoothstep(-2.0, 6.0, elevation));
  return mix(SKY_SUN_LOW, SKY_SUN_HIGH, smoothstep(6.0, 25.0, elevation));
}

// How lit what lies at `p` is, seen from high up: by the sun over its own horizon there,
// down to the night's level, so the night side of the Earth is dark; 1 from lower down
// (SKY_FROM_SPACE). The same for every pixel but by `p`, from the camera's uniforms.
float skyDayAt(vec3 p) {
  float space = skyFromSpace();
  if(space <= 0.0)
    return 1.0;
  return mix(1.0, mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(globeUpAt(p))), space);
}

// How much of the air lies below the camera: 0 on its ground, toward 1 high above it.
float skyAirBelow() {
  if(uSkyAir.y <= 0.0)
    return 0.0;
  return 1.0 - exp(-max(skyCameraHeight(), 0.0) / uSkyAir.y);
}

// The same of the haze, the low layer by its share: the camera soon rises out of most of it.
// One return: the D3D compiler took the early one for an uninitialised value.
float skyHazeBelow() {
  float below = skyAirBelow();
  if(uSkyAir.y > 0.0 && uSkyHaze.x > 0.0)
    below = mix(below, 1.0 - exp(-max(skyCameraHeight(), 0.0) / uSkyHaze.x), uSkyHaze.y);
  return below;
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

// How much the air hazes what lies `dist` along `dir` from a view's `origin` (the camera, or
// a point straight along up from it: globeViewHeight): the low haze layer and the clear air
// above it, each thinning with height, so a ray down from high up crosses the layer only at
// its end, and one along the sea hazes most. Heights over the globe, so a long view rises
// over it as the Earth curves away (globeCameraRise).
float skyAirHaze(vec3 origin, vec3 dir, float dist) {
  if(uSkyAir.z <= 0.0)
    return 0.0;
  float start = max(globeViewHeight(origin) - uSkyAir.x, 0.0);
  float mean = 1.0;
  if(uSkyAir.y > 0.0) {
    float rise = globeCameraRise(dir, dist);
    float clear = skyAirMean(start, rise, uSkyAir.y);
    float layer = uSkyHaze.x > 0.0 ? skyAirMean(start, rise, uSkyHaze.x) : clear;
    mean = mix(clear, layer, uSkyHaze.y);
  }
  return 1.0 - exp(-dist * mean / uSkyAir.z);
}

// The sine of the elevation of the sea's horizon along `dir`, seen from the camera `height`
// above the air's ground: 0 on a flat sea, lower the higher up as the Earth curves it away.
// From the globe (globeCameraHorizon): where the view grazes it, about the camera's own up,
// from the level the camera sees the sky by (globeCameraLook).
float skyHorizonAt(vec3 dir, float height) {
  if(uSkyCurvature <= 0.0 || height <= 0.0)
    return 0.0;
  return globeCameraHorizon(dir);
}

// The same from the camera, over the air's ground.
float skyHorizon(vec3 dir) {
  return skyHorizonAt(dir, skyCameraHeight());
}

// The lowest height over the air's ground a view along `dir` from `height` passes: the
// camera's own looking up; toward the horizon, as low as the Earth's curve brings it — below
// the sea where the view meets it, so the air meets the sea's edge.
float skyLowest(vec3 dir, float height) {
  if(uSkyCurvature <= 0.0)
    return height;
  return height - globeCameraDescent(dir);
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
  seen.sunY = sin(asin(clamp(dot(uSkySunDirection, globeCameraLook()), -1.0, 1.0)) + uSkyAirLight.w * share);
  return seen;
}

// How far toward the camera's the light of the air at `height` over its ground is: as the
// horizon drops, by the root of its height over the camera's. 0 on a flat sea and in the bakes.
float skyLightShareAt(float height) {
  float camera = skyCameraHeight();
  if(uSkyCurvature <= 0.0 || uSkyAirLight.w <= 0.0 || camera <= 0.0)
    return 0.0;
  return sqrt(clamp(height / camera, 0.0, 1.0));
}

// The same for a view along `dir` from `height`: by the lowest it passes. 0 from the air's
// ground or below it. ⚠️ No early return for that: through the D3D compiler it cost the
// stage's shader 1.6 ms a frame (40 m over the field), all the descent it skipped and more.
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

// How much of what lies at `p`, where its up is `up`, the air over it hides from the camera
// seen from space: by the air's mass the view crosses there, as the Chapman function gives it
// for a round Earth — 1 / cos of the view's angle from up, but no more than
// SKY_AIR_LEVEL_MASS along the level — so the haze thickens toward the Earth's edge. The
// column is the clear air's and the low haze layer's, by its share.
float skySpaceHaze(vec3 p, vec3 up) {
  if(uSkyAir.z <= 0.0)
    return 0.0;
  float facing = max(dot(normalize(cameraPosition - p), up), 0.0);
  float mass = (1.0 + 1.0 / SKY_AIR_LEVEL_MASS) / (facing + 1.0 / SKY_AIR_LEVEL_MASS);
  float scale = uSkyAir.y > 0.0 ? uSkyAir.y : SKY_SPACE_START;
  float column = mix(scale, uSkyHaze.x > 0.0 ? uSkyHaze.x : scale, uSkyHaze.y);
  return 1.0 - exp(-SKY_SPACE_HAZE * column * mass / uSkyAir.z);
}

// The air's light over ground seen from space through `haze` of it (skySpaceHaze), where the
// sun's elevation's sine is `sine`: the blue overhead, paler the more of the air the view
// crosses, warmer where the sun is low there — a little: the high air the view grazes at the
// Earth's edge is lit by the sun before the low air reddens it.
vec3 skySpaceAir(float haze, float sine) {
  vec3 warm = mix(vec3(1.0), min(skySunColorAt(sine) / SKY_SUN_HIGH, vec3(1.0)), 0.3);
  return mix(uSkyZenithColor, uSkyHorizonColor, SKY_SPACE_AIR_PALE * haze) * warm;
}

// The open sea seen from space along `dir`, where its up is `up`: deep blue as the sun lights
// it there, reflecting more of the sky the more it is seen edge on, and the sun's glint off
// its waves, broad, in the sun's colour there, only while the sun is up there. Unhazed
// (skyFromSpaceOver).
vec3 skySpaceSea(vec3 dir, vec3 up) {
  float sine = dot(uSkySunDirection, up);
  float sun = max(sine, 0.0);
  float edgeOn = pow(1.0 - clamp(-dot(dir, up), 0.0, 1.0), 5.0);
  float reflected = SKY_SPACE_SEA_REFLECT + (1.0 - SKY_SPACE_SEA_REFLECT) * edgeOn;
  vec3 deep = skyDeepZenith();
  deep *= deep / max(max(deep.r, max(deep.g, deep.b)), 1e-4);
  vec3 body = SKY_SPACE_SEA * deep * (0.2 + 0.8 * sun);
  vec3 sky = uSkyZenithColor * skySunlit(up);
  float glint = pow(max(dot(reflect(dir, up), uSkySunDirection), 0.0), SKY_SPACE_GLINT.x) * skySunDiscUp(sine);
  return mix(body, sky, reflected) + skySunColorAt(sine) * glint * SKY_SPACE_GLINT.y * (1.0 + 4.0 * edgeOn);
}

// Ground of colour `albedo` facing `normal` (world), at `p`, seen from space: lit by the
// sun where it lies, in its colour there, and an even ambient; not by the scene's light,
// which is the field's (skyFromSpaceOver takes the night side down).
vec3 skySpaceGround(vec3 albedo, vec3 normal, vec3 p) {
  float sine = dot(uSkySunDirection, globeUpAt(p));
  float direct = max(dot(normal, uSkySunDirection), 0.0) * SKY_SPACE_GROUND_SUN;
  return albedo * RECIPROCAL_PI * (skySunColorAt(sine) * direct + SKY_SPACE_GROUND_AMBIENT);
}

// `near`, as the sky shades it in the air, toward what it is from space: `lit`, its colour
// as lit where it lies at `p` (unhazed), dark where the sun is down there, under the air the
// view crosses over it (skySpaceHaze), lit there (skySpaceAir).
vec3 skyFromSpaceOver(vec3 near, vec3 lit, vec3 p) {
  float space = skyFromSpace();
  if(space <= 0.0)
    return near;
  vec3 up = globeUpAt(p);
  float day = mix(SKY_NIGHT_LEVEL, 1.0, skySunlit(up));
  float haze = skySpaceHaze(p, up);
  vec3 air = skySpaceAir(haze, dot(uSkySunDirection, up));
  return mix(near, mix(lit, air, haze) * day, space);
}

// The sine `y` of an elevation, measured from the horizon as seen (`horizon`, its sine)
// instead of from the level: the zenith and the nadir stay where they are.
float skyOverHorizon(float y, float horizon) {
  return (y - horizon) / (y >= horizon ? 1.0 - horizon : 1.0 + horizon);
}

// How far over the sea's horizon `dir` looks (skyOverHorizon's), from the level the camera
// sees the sky by (globeCameraLook): the scene's over the field, its own far off.
float skyOverSeaHorizon(vec3 dir) {
  return skyOverHorizon(dot(dir, globeCameraLook()), skyHorizon(dir));
}

// How much of the air lies below `height` over its ground: 0 on it, toward 1 high above it.
float skyAirBelowAt(float height) {
  return 1.0 - exp(-max(height, 0.0) / uSkyAir.y);
}

// How high a view along `dir` from `height` is, by the little air it passes: the lowest it
// reaches and, from high up, higher the more steeply it looks up, as it leaves the air sooner.
// Up from the horizon as seen, so it runs on smoothly across the level. Air only. From the
// horizon's sine along it and the lowest it passes, where those are known.
float skyAirHeightFrom(vec3 dir, float height, float horizon, float lowest) {
  float up = max(skyOverHorizon(dot(dir, globeCameraLook()), horizon), 0.0);
  float steeper = SKY_AIR_PATH * uSkyAir.y * log(1.0 + SKY_AIR_LEVEL_MASS * up);
  return lowest + steeper * skyAirBelowAt(height);
}

float skyAirHeight(vec3 dir, float height) {
  return skyAirHeightFrom(dir, height, skyHorizonAt(dir, height), skyLowest(dir, height));
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

// Gradient, daylight, the sun's halo and the twilight glow; no disc. Seen along `dir` with
// the horizon's sine along its bearing `horizon` (skyHorizonAt), in the light `seen`: the
// air's own light, without the dark of space.
vec3 skySurfaceSeen(vec3 dir, float blend, float horizon, SkyLight seen) {
  vec3 look = globeCameraLook();
  float y = skyOverHorizon(dot(dir, look), horizon);
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
    vec3 across = dir - look * dot(dir, look);
    float sunY = seen.sunY;
    vec3 sunAcross = uSkySunDirection - look * dot(uSkySunDirection, look);
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

// The same seen from `height` over the air's ground, which lowers the horizon.
vec3 skySurfaceAt(vec3 dir, float blend, float height) {
  return skySurfaceSeen(dir, blend, skyHorizonAt(dir, height), skyLight(skyLightShare(dir, height)));
}

// The same from the camera. Toward space, by the air the view passes, it deepens to the blue
// overhead, bluer still through the ozone layer, and goes black, but for a glow over the
// Earth's edge: pale low down, deep blue higher, brighter toward the sun. From space only
// the glow is left: the air's own gradient, lit by the field's light, would show its pale
// horizon as a line a pixel or two thin, and over the night side too. The horizon and the
// lowest the view passes taken once, for all of it.
vec3 skySurface(vec3 dir, float blend) {
  float height = skyCameraHeight();
  float horizon = skyHorizonAt(dir, height);
  float lowest = skyLowest(dir, height);
  // skyLightShare, from the lowest already found.
  SkyLight seen = skyLight(skyLightShareAt(lowest));
  vec3 color = skySurfaceSeen(dir, blend, horizon, seen);
  if(!skyNearSpace(height))
    return color;
  float air = skyAirHeightFrom(dir, height, horizon, lowest);
  float space = skySpaceAbove(air);
  color = mix(color, skyDeepZenith() * mix(SKY_NIGHT_LEVEL, 1.0, seen.daylight), smoothstep(0.0, 0.5, space));
  float ozone = 1.0 - smoothstep(0.0, SKY_OZONE_LAYER.y, abs(air - SKY_OZONE_LAYER.x));
  float fromSpace = skyFromSpace();
  color *= mix(vec3(1.0), SKY_OZONE, ozone) * (1.0 - space) * (1.0 - fromSpace);
  float above = max(lowest, 0.0);
  // From far off the glow is wider than the air, so it never thins below a few pixels: the
  // metres a pixel spans at the Earth's edge, as far off as the view grazes it.
  float R = uSkyCurvature > 0.0 ? 1.0 / uSkyCurvature : 0.0;
  float edgeMetres = sqrt(max(height, 0.0) * (2.0 * R + height)) * length(fwidth(dir));
  float rimHeight = max(SKY_RIM_HEIGHT, 3.0 * edgeMetres);
  float rim = exp(-above / rimHeight) * smoothstep(SKY_RIM_SHOWN.x, SKY_RIM_SHOWN.y, height);
  if(rim > 1e-3) {
    float toward = max(dot(dir, uSkySunDirection), 0.0);
    // From high up, lit where the view passes closest to the Earth: dark over its night side.
    vec3 centre = uGlobeDisc.xyz - uGlobeUp * uGlobe.y;
    vec3 closest = cameraPosition + dir * max(dot(centre - cameraPosition, dir), 0.0);
    // Low down, the horizon's colour, brighter toward the sun; from space, the air's over the
    // ground at the edge (skySpaceAir) in its light there, so the two sides of the edge meet
    // in one colour.
    vec3 edge = mix(uSkyHorizonColor, skySpaceAir(1.0, dot(uSkySunDirection, globeUpAt(closest))), fromSpace);
    vec3 glow = mix(skyDeepZenith(), edge, exp(-above / max(0.35 * SKY_RIM_HEIGHT, 1.5 * edgeMetres)));
    float light = mix(seen.daylight * (0.55 + 0.45 * toward * toward), 1.0, fromSpace);
    color += glow * rim * light * skyDayAt(closest);
  }
  return color;
}

// The horizon's colour along the bearing `way` (unit, level), where it is seen from the
// camera: the light of the air the far sea fades into. Shaded with the horizon just found.
vec3 skyHorizonColor(vec3 way, float blend) {
  float height = skyCameraHeight();
  float sine = skyHorizonAt(way, height);
  vec3 dir = way * sqrt(1.0 - sine * sine) + globeCameraLook() * sine;
  return skySurfaceSeen(dir, blend, sine, skyLight(skyLightShare(dir, height)));
}
