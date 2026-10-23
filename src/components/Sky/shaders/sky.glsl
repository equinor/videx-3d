// Stylised sky radiance for a world-space view direction.
//
// Colours are display-referred linear values, so with no tone mapping the result
// stays in [0, 1] everywhere except at the sun. The sun colour and daylight factor
// are computed on the CPU (sky-model.ts) and shared with the directional light.

#include ./sky-gradient.glsl

uniform vec3 uSkyNorth; // normalised, perpendicular to uSkyUp
uniform vec3 uSkyEast;
uniform float uSkySunSize; // angular radius, radians
uniform float uSkySunRadiance; // disc multiplier; > 1 only when tone mapped
uniform float uSkySunDisc; // 0 in the environment / light-probe bakes: no discs, no stars
uniform vec3 uSkyMoonDirection; // world space, normalised
uniform vec3 uSkyMoonColor;
uniform float uSkyMoonSize; // angular radius, radians
uniform float uSkyMoonGlow;
uniform float uSkyMoonPhase; // share of its disc lit: 1 opposite the sun
uniform float uSkyMoonDay; // 1 while it can be up by day (an observer's moon)
uniform float uSkyNight; // 0 by day to 1 at night: how much the moon and the stars show
uniform vec2 uSkyStars; // brightness, and the share of the sky's cells holding one
uniform mat3 uSkyStarFrame; // world direction -> the turning star sphere's
uniform float uSkyObserved; // 1 with an observer: the catalogue's stars and the planets, over a faint procedural filler
uniform vec4 uSkyPlanets[5]; // world direction, and apparent magnitude
uniform sampler2D uSkyStarCells; // each cell of a cube-face grid over the star sphere: its first entry, and count
uniform sampler2D uSkyStarList; // each entry: the star's direction scaled by 2 + its B-V, and its magnitude
uniform float uSkyHorizonBlend; // width of the horizon -> ground transition, in dot(dir, up)
uniform float uSkyIntensity;
uniform float uSkyDebug; // 1: tint each part by what draws it (SkyDebug.tint)

// Debug tints (SkyDebug.tint): the sky's own sea, seabed and void; what it leaves to a
// stage; its surface layer.
#define SKY_DEBUG_SEA vec3(0.9, 0.15, 0.1)
#define SKY_DEBUG_STAGED vec3(0.55, 0.1, 0.8)
#define SKY_DEBUG_LAYER vec3(1.0, 0.55, 0.0)
// The moon's dark side in earthshine, as a share of its lit side, near new moon.
#define SKY_EARTHSHINE 0.05
// The moon's dark side shows the air in front of it, a shade darker than the sky around it.
#define SKY_MOON_DARK 0.75
// How bright the moon shows by day, over the sky behind it.
#define SKY_MOON_DAY 0.35
// The procedural stars as a filler under an observer's catalogue, relative to their own.
#define SKY_STAR_FILLER 0.35
// A star's light pulled into a crisp centre, this much brighter, at the same size.
#define SKY_STAR_CORE 1.5

// A star's profile `d` from its centre, out to `radius`.
float skyStarCore(float shine, float d, float radius) {
  float t = 1.0 - smoothstep(0.0, radius, d);
  return min(shine * SKY_STAR_CORE, 1.0) * t * t;
}

// `color` shifted halfway toward the debug `tint` of the part that drew it, while debugging.
vec3 skyDebugTint(vec3 color, vec3 tint) {
  return uSkyDebug > 0.5 ? mix(color, tint, 0.5) : color;
}

// A hash in [0, 1) of a point.
float skyHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// The sun's disc without tone mapping: near white, warming a little at sunrise and sunset.
#define SKY_SUN_DISC_WARM vec3(1.0, 0.86, 0.66)
// The glare once white, without tone mapping: over the bright halo it clips to a white blob twice the disc.
#define SKY_SUN_DAY_GLARE 0.25

// The sun's disc as drawn. Tone mapped, past white, so the mapping burns its core; without,
// its light's own orange would read as a flat orange disc, so it is drawn near white.
vec3 skySunDiscRadiance(SkyLight seen) {
  if(uSkySunRadiance > 1.0)
    return skySunDiscColor(seen) * uSkySunRadiance;
  return mix(vec3(1.0), SKY_SUN_DISC_WARM, min(uSkyTwilight.x * seen.twilight, 1.0));
}

uniform vec3 uSkySunGlare; // glare, rays, and the rays' shimmer phase in radians

// A ring of `count` rays about the sun: `around` the angle about it, `r` the distance from
// it in disc radii, `pixel` a pixel across the rays as a fraction of their spacing.
float skySunRayRing(float around, float r, float pixel, float count, float seed) {
  float s = around * count / 6.2831853;
  float i = floor(s + 0.5);
  float off = s - i;
  float id = mod(i, count);
  float strength = pow(skyHash(vec3(id, seed, 1.7)), 2.0);
  float reach = mix(3.0, 12.0, skyHash(vec3(id, seed, 4.3)));
  float twinkle = skyHash(vec3(id, seed, 8.9));
  strength *= 0.65 + 0.35 * sin(uSkySunGlare.z * (0.5 + twinkle) + twinkle * 6.2831853);
  // At least a pixel wide, with the same light, so the rays don't flicker near the disc.
  float width = 0.06;
  float w = max(width, pixel);
  return strength * (width / w) * exp(-off * off / (w * w)) * exp(-(r - 1.0) / reach);
}

// The glare hugging the sun's disc, and its rays, `angle` from its centre (`aa` that
// angle's change over a pixel).
float skySunGlare(vec3 dir, float angle, float aa) {
  float r = max(angle, uSkySunSize) / uSkySunSize;
  float glare = uSkySunGlare.x / (r * r);
  if(uSkySunGlare.y <= 0.0)
    return glare;
  // About the sun from its upper side, so the rays turn with neither the view nor the sun.
  vec3 side = normalize(cross(uSkySunDirection, abs(dot(uSkySunDirection, uSkyUp)) < 0.999 ? uSkyUp : uSkyNorth));
  vec3 lift = cross(side, uSkySunDirection);
  float around = atan(dot(dir, lift), dot(dir, side));
  float pixel = aa / max(angle, 1e-6) / 6.2831853;
  float rays = skySunRayRing(around, r, pixel * 16.0, 16.0, 0.0) +
    0.5 * skySunRayRing(around, r * 1.6, pixel * 40.0, 40.0, 1.0);
  return glare + uSkySunGlare.y * rays;
}

// Faint stars along `dir`, on the star sphere: at most one in each cell of a grid around
// it, kept only where it falls in its own cell so none is cut off. ⚠️ Derivatives.
float skyStars(vec3 dir) {
  const float cells = 150.0;
  vec3 p = dir * cells;
  float pixel = max(length(fwidth(p)), 1e-4);
  vec3 cell = floor(p);
  if(skyHash(cell) > uSkyStars.y)
    return 0.0;
  vec3 jitter = vec3(skyHash(cell + 1.7), skyHash(cell + 3.1), skyHash(cell + 5.3)) - 0.5;
  vec3 star = normalize(cell + 0.5 + jitter * 0.6) * cells;
  if(any(notEqual(floor(star), cell)))
    return 0.0;
  // As star counts go, N(brighter than L) ~ L^-1.5: mostly faint, a rare few at full.
  float shine = min(0.08 * pow(max(skyHash(cell + 9.2), 1e-4), -2.0 / 3.0), 1.0);
  return skyStarCore(shine, length(p - star), 1.2 * pixel);
}

// How bright a star of magnitude `m` is drawn: 0.08 at magnitude 5, and the square root
// of its light brighter, as the eye's response compresses it.
float skyStarShine(float m) {
  return 0.08 * exp2(0.6644 * (5.0 - m));
}

// How much a star of magnitude `m` shows, for the sun's elevation in degrees: Venus by
// sunset, the brightest stars a few degrees later, magnitude 5 once it is 11.5° down.
float skyStarSeen(float m, float sunElevation) {
  float onset = -4.0 - (m < 0.0 ? 1.0 : 1.5) * m;
  return 1.0 - smoothstep(onset - 2.0, onset, sunElevation);
}

// A star's colour from its B-V index: faintly blue to faintly red, as the eye sees them.
vec3 skyStarColor(float bv) {
  vec3 color = mix(vec3(0.7, 0.8, 1.0), vec3(0.9, 0.93, 1.0), smoothstep(-0.3, 0.0, bv));
  color = mix(color, vec3(1.0, 0.96, 0.88), smoothstep(0.0, 0.6, bv));
  return mix(color, vec3(1.0, 0.78, 0.58), smoothstep(0.6, 1.6, bv));
}

// A point of light `shine` bright at `star`, along `dir`, `pixel` the angle a pixel spans:
// the brighter, the wider too, so the bright ones stand out of the faint.
float skyPoint(vec3 dir, vec3 star, float shine, float pixel) {
  return skyStarCore(shine, length(dir - star), 1.2 * pixel * (1.0 + sqrt(shine)));
}

// The catalogue's stars along `s`, on the star sphere: those listed in its cell of a
// cube-face grid. ⚠️ The cell is `skyStarCell`'s (sky-star-catalogue.ts).
vec3 skyCatalogue(vec3 s, float pixel, float sunElevation) {
  int cells = textureSize(uSkyStarCells, 0).x;
  vec3 a = abs(s);
  int face;
  vec2 uv;
  if(a.x >= a.y && a.x >= a.z) {
    face = s.x > 0.0 ? 0 : 1;
    uv = s.yz / a.x;
  } else if(a.y >= a.z) {
    face = s.y > 0.0 ? 2 : 3;
    uv = s.xz / a.y;
  } else {
    face = s.z > 0.0 ? 4 : 5;
    uv = s.xy / a.z;
  }
  ivec2 cell = clamp(ivec2(floor((uv * 0.5 + 0.5) * float(cells))), ivec2(0), ivec2(cells - 1));
  vec2 entries = texelFetch(uSkyStarCells, ivec2(cell.x, face * cells + cell.y), 0).xy;
  int first = int(entries.x);
  int count = int(entries.y);
  int width = textureSize(uSkyStarList, 0).x;
  vec3 light = vec3(0.0);
  for(int i = 0; i < count; i++) {
    int k = first + i;
    vec4 star = texelFetch(uSkyStarList, ivec2(k % width, k / width), 0);
    float scale = length(star.xyz);
    float shine = skyStarShine(star.w) * skyStarSeen(star.w, sunElevation);
    light += skyStarColor(scale - 2.0) * skyPoint(s, star.xyz / scale, shine * uSkyStars.x, pixel);
  }
  return light;
}

// The naked-eye planets along `dir`, with their B-V: Mercury, Venus, Mars, Jupiter, Saturn.
vec3 skyPlanets(vec3 dir, float pixel, float sunElevation) {
  const float colorIndex[5] = float[5](0.93, 0.82, 1.36, 0.83, 1.04);
  vec3 light = vec3(0.0);
  for(int i = 0; i < 5; i++) {
    vec4 planet = uSkyPlanets[i];
    float shine = skyStarShine(planet.w) * skyStarSeen(planet.w, sunElevation);
    light += skyStarColor(colorIndex[i]) * skyPoint(dir, planet.xyz, shine * uSkyStars.x, pixel);
  }
  return light;
}

// The moon and the stars over `color`, as night falls, and by day where the sky is space;
// the moon by day too, while it can be up. ⚠️ Derivatives.
vec3 skyNight(vec3 color, vec3 dir, float blend) {
  float height = dot(cameraPosition, uSkyUp) - uSkyAir.x;
  if(uSkyNight <= 0.0 && uSkyMoonDay <= 0.0 && !skyNearSpace(height))
    return color;
  // By day too where the sky has gone all but black, under a twentieth of its light.
  float black = smoothstep(0.95, 1.0, skySpace(dir, height));
  // From high up, by the sun over the lowered horizon, where it can still be up.
  float share = skyLightShare(dir, height);
  float night = max(mix(uSkyNight, 1.0 - uSkyAirLight.x, share), black);
  float y = skyOverHorizon(dot(dir, uSkyUp), skyHorizon(dir));
  float above = smoothstep(-blend, blend, y);
  float cosMoon = dot(dir, uSkyMoonDirection);
  float angle = atan(length(cross(dir, uSkyMoonDirection)), cosMoon);
  float aa = max(fwidth(angle), 1e-5);
  float disc = 1.0 - smoothstep(uSkyMoonSize - aa, uSkyMoonSize + aa, angle);
  // The disc as a sphere lit from the sun: the phase, and which way the crescent faces.
  vec3 across = dir - uSkyMoonDirection * cosMoon;
  float r = min(angle / max(uSkyMoonSize, 1e-6), 1.0);
  vec3 normal = -uSkyMoonDirection * sqrt(1.0 - r * r) + across * (r / max(length(across), 1e-8));
  float edge = aa / max(uSkyMoonSize, 1e-6);
  float lit = smoothstep(-edge, edge, dot(normal, uSkySunDirection));
  // The dark side faintly lit by the Earth, most near new moon.
  float face = lit + SKY_EARTHSHINE * (1.0 - uSkyMoonPhase) * (1.0 - lit);
  float glow = uSkyMoonGlow * uSkyMoonPhase * pow(max(cosMoon, 0.0), 200.0);
  // The stars come out late, once it is dark, and fade low down through more air.
  float airmass = 1.0 / (max(y, 0.0) + 0.05);
  vec3 starDir = uSkyStarFrame * dir;
  float pixel = length(fwidth(dir));
  float procedural = skyStars(starDir);
  // In space as if the sun were well down.
  float sunElevation = mix(degrees(asin(skyLight(share).sunY)), -18.0, black);
  vec3 stars;
  if(uSkyObserved > 0.5 && uSkySunDisc > 0.0) {
    // The procedural ones stand in for those past the catalogue, to about magnitude 6.5.
    float filler = min(procedural * SKY_STAR_FILLER, skyStarShine(5.5)) * skyStarSeen(5.5, sunElevation);
    stars = skyCatalogue(starDir, pixel, sunElevation) + skyPlanets(dir, pixel, sunElevation) + filler * uSkyStars.x;
  } else {
    stars = vec3(uSkyStars.x * procedural * night * night * night);
  }
  stars *= exp(-0.25 * (airmass - 1.0));
  vec3 air = color + uSkyMoonColor * glow * night * above;
  color = air + stars * uSkySunDisc * above;
  float shown = disc * above * uSkySunDisc;
  // By night it hides the stars behind it, its dark side a shade darker than the air in
  // front of it once they are out (in twilight it is lost in the sky); by day it is a
  // pale disc over the sky.
  float darkSide = mix(1.0, SKY_MOON_DARK, skyStarSeen(2.0, sunElevation));
  vec3 dark = air * darkSide + uSkyMoonColor * SKY_EARTHSHINE * (1.0 - uSkyMoonPhase);
  color = mix(color, mix(dark, uSkyMoonColor, lit), shown * night);
  return color + uSkyMoonColor * face * shown * uSkyMoonDay * (1.0 - night) * SKY_MOON_DAY;
}

#if defined(SKY_ABYSS) || defined(SKY_OCEAN) || defined(SKY_CLOUDS)
#include ../../../sdk/materials/shaderLib/procedural-normal.glsl
#endif

#if defined(SKY_ABYSS) || defined(SKY_CLOUDS)
// Value noise in 3D, in [0, 1].
float skyNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(0.0, 1.0);
  return mix(
    mix(mix(skyHash(i), skyHash(i + e.yxx), u.x), mix(skyHash(i + e.xyx), skyHash(i + e.yyx), u.x), u.y),
    mix(mix(skyHash(i + e.xxy), skyHash(i + e.yxy), u.x), mix(skyHash(i + e.xyy), skyHash(i + e.yyy), u.x), u.y),
    u.z
  );
}
#endif

#ifdef SKY_CLOUDS
uniform vec4 uSkyClouds; // coverage, altitude of their base along up, feature size (world units), edge softness
uniform vec4 uSkyCloudsColor; // lit colour, and opacity
uniform vec2 uSkyCloudsSeed; // offset of the pattern
// Radius of the deck's sphere about the Earth's centre and their thickness (world units); the
// layers (0 deck, 1 band, 2 both); the band's distance (world units).
uniform vec4 uSkyCloudsShape;
// TEMPORARY, to compare: how much of the band's sink a curved horizon keeps (1 on a flat sea).
uniform float uSkyCloudsSink;
// Most a cloud's core shifts against its outline, in cloud sizes.
#define SKY_CLOUD_PARALLAX 0.3
// How much they hide the sun, moon and stars behind them, at opacity 0.5 and up.
#define SKY_CLOUD_OCCLUSION 0.9
// Sunlight on them when the output is tone mapped, as the sun's disc gets SKY_HDR_SUN_RADIANCE:
// else tone mapping squeezes them into the sky behind.
#define SKY_CLOUD_HDR_SUNLIGHT 2.0
// The band's clouds are this share as wide as clouds of `scale` look at its distance, and as
// tall as ones of `thickness`.
#define SKY_CLOUD_BAND_WIDTH 0.533
#define SKY_CLOUD_BAND_HEIGHT 0.83
// Climbing, the band sinks by up to this (radians, 1.5°) on a flat sea, and its clouds flatten by up to this share.
#define SKY_CLOUD_BAND_SINK 0.0262
#define SKY_CLOUD_BAND_FLATTEN 0.05
// Between these camera heights (world units) the band fades out: from far up it would rim the globe.
#define SKY_CLOUD_BAND_FADE vec2(100000.0, 250000.0)
// With the band, the deck dissolves where the view runs within this (a sine, about 9°) of
// parallel to it.
#define SKY_CLOUD_GRAZE 0.15

// skyNoise3 over five octaves, in [0, 1].
float skyNoise3Fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for(int o = 0; o < 5; o++) {
    sum += amp * skyNoise3(p);
    norm += amp;
    p = p * 2.03 + vec3(17.1, 3.7, 9.2);
    amp *= 0.5;
  }
  return sum / norm;
}

// The light where the clouds are, at their base.
SkyLight skyCloudLight() {
  return skyLight(skyLightShareAt(uSkyClouds.y - uSkyAir.x));
}

// The clouds' colour along `dir`, shared by the deck and the band: `n` their pattern there,
// `threshold` and `edge` its density's, `density` how much cloud, `lit` how much light reaches
// the side seen, `hazed` how far they melt into `haze`; `angle` the view's from the light, `aa`
// its footprint; `under` how much they are seen from below, 0 from over their tops.
vec3 skyCloudColor(vec3 dir, float n, float threshold, float edge, float density, float lit, vec3 haze, float hazed, float angle, float aa, float under) {
  SkyLight seen = skyCloudLight();
  bool day = seen.daylight > 0.0;
  vec3 light = day ? uSkySunDirection : uSkyMoonDirection;
  vec3 ambient = mix(uSkyHorizonColor, uSkyZenithColor, 0.5) * mix(SKY_NIGHT_LEVEL, 1.0, seen.daylight);
  // At sunset and sunrise their undersides catch the glow, most toward the sun.
  float twilight = min(uSkyTwilight.x * seen.twilight, 1.0);
  float facing = 0.5 + 0.5 * dot(dir, uSkySunDirection);
  ambient += SKY_TWILIGHT_ORANGE * twilight * 0.25 * facing * facing;
  // Toward the low sun they are seen from their shaded side: dark, with bright linings.
  float backlit = twilight * smoothstep(0.6, 0.95, facing) * under;
  float lining = 1.0 + 2.0 * backlit;
  // The moon takes over only once the sun's light is gone, so the hand-over shows nothing.
  vec3 direct = day ? skyTwilightLight(seen) * seen.daylight * (uSkySunRadiance > 1.0 ? SKY_CLOUD_HDR_SUNLIGHT : 1.0) : uSkyMoonColor * seen.moonlight * 0.25;
  vec3 cloud = uSkyCloudsColor.rgb * (ambient * 0.55 * (1.0 - 0.75 * backlit) + direct * lit * 0.75 * (1.0 - backlit));
  float cosLight = dot(dir, light);
  // A bright rim where they thin toward the light.
  cloud += direct * (1.0 - density) * pow(max(cosLight, 0.0), 8.0) * 0.6 * lining;
  // Optical depth: none where the edge begins, enough in the cores to hide the sun.
  float tau = max(n - threshold + edge, 0.0) * 30.0;
  float transmit = exp(-tau);
  // Forward scattering (Henyey-Greenstein, g 0.85, 1 at the light): the glow around it,
  // brightest where the cloud is about one optical depth thick.
  float phase = 0.003375 / pow(1.7225 - 1.7 * cosLight, 1.5);
  cloud += direct * phase * tau * transmit * 2.718 * uSkySunDisc * lining;
  cloud = mix(cloud, haze, hazed);

  // The light itself, far brighter than the sky it hides, shows through all but the cores,
  // softer the thicker the cloud.
  float size = day ? uSkySunSize : uSkyMoonSize;
  float soft = aa + size * min(tau * 0.5, 1.0);
  float disc = 1.0 - smoothstep(size - soft, size + soft, angle);
  float through = disc * min(100.0 * transmit, 1.0) * (day ? 1.0 : seen.moonlight) * uSkySunDisc;
  return mix(cloud, day ? skySunDiscRadiance(seen) : uSkyMoonColor, through);
}

// The threshold their pattern must pass at `coverage` 0 and 1: below 0.2 it rises out of reach,
// so 0 is none.
float skyCloudThreshold(float none, float full) {
  return mix(none, full, uSkyClouds.x) + (1.0 - smoothstep(0.0, 0.2, uSkyClouds.x)) * 0.3;
}

// `cloud` of `density` over `color`: its opacity blends it into the bare sky (`haze`), while it
// hides the sun, moon and stars in `color` as if opaque, from opacity 0.5 down less so.
vec3 skyCloudOver(vec3 color, vec3 haze, vec3 cloud, float density) {
  float opacity = uSkyCloudsColor.a;
  return mix(color, mix(haze, cloud, opacity), density * SKY_CLOUD_OCCLUSION * min(2.0 * opacity, 1.0));
}

// The band's nearest clouds over the horizon from sea level, in radians: their base, and the
// most their tops reach.
vec2 skyCloudBandSpan() {
  float far = uSkyCloudsShape.w;
  return vec2(atan(uSkyClouds.y / far), atan((uSkyClouds.y + uSkyCloudsShape.y) / far));
}

// How high over the horizon the band's tops would show from `height` as the Earth curves:
// as clouds bandDistance off, or from over them as their layer's own horizon (radians).
float skyCloudBandTop(float height) {
  float k = uSkyCurvature;
  float top = uSkyClouds.y + uSkyCloudsShape.y;
  float d = max(uSkyCloudsShape.w, sqrt(2.0 * max(height - top, 0.0) / k));
  return atan((top - height) / d - 0.5 * k * d) + sqrt(2.0 * k * max(height, 0.0));
}

// How far the band is squashed onto the horizon from `origin`, as its tops sink: 1 on a flat sea.
float skyCloudBandSquash(vec3 origin) {
  if(uSkyCurvature <= 0.0)
    return 1.0;
  return clamp(skyCloudBandTop(dot(origin, uSkyUp)) / skyCloudBandTop(0.0), 1e-3, 1.0);
}

// Distant clouds along the horizon, fixed to directions: so far off that the camera's moves
// barely shift them. Seen side-on: under the nearest ones' base, ever further ones overlap
// densely down to the horizon; above it, their tops vary. Climbing, they go down with the
// horizon as the Earth's curve lowers it (on a flat sea they sink a little instead), squash
// onto it as their tops sink, until from high above they are a thin strip along it, and
// flatten, quickly at first and then hardly at all. ⚠️ Derivatives, taken before it branches.
vec3 skyCloudBand(vec3 color, vec3 haze, vec3 dir, vec3 origin) {
  float shown = 1.0 - smoothstep(SKY_CLOUD_BAND_FADE.x, SKY_CLOUD_BAND_FADE.y, dot(origin, uSkyUp));
  if(uSkyCloudsShape.z < 0.5 || uSkyClouds.x <= 0.0 || uSkyCloudsColor.a <= 0.0 || shown <= 0.0)
    return color;
  vec3 light = skyCloudLight().daylight > 0.0 ? uSkySunDirection : uSkyMoonDirection;
  float angle = atan(length(cross(dir, light)), dot(dir, light));
  float aa = max(fwidth(angle), 1e-5);
  float y = dot(dir, uSkyUp);
  float over = asin(clamp(y, -1.0, 1.0)) - asin(skyHorizon(dir));
  vec2 span = skyCloudBandSpan();
  float climb = 1.0 - exp(-max(dot(origin, uSkyUp), 0.0) / (1.5 * uSkyClouds.y));
  float sink = uSkyCurvature > 0.0 ? uSkyCloudsSink : 1.0;
  float e = max(over + SKY_CLOUD_BAND_SINK * climb * sink, 0.0) / skyCloudBandSquash(origin);
  if(over <= -0.002 || e >= span.y)
    return color;
  float v = e / span.y;
  float far = uSkyCloudsShape.w;
  vec2 around = normalize(vec2(dot(dir, uSkyEast), dot(dir, uSkyNorth)) + 1e-6);
  float across = SKY_CLOUD_BAND_WIDTH * far / uSkyClouds.z;
  float up = far / (SKY_CLOUD_BAND_HEIGHT * max(uSkyCloudsShape.y, 100.0));
  vec3 q = vec3(around * across, e * up * (1.0 + SKY_CLOUD_BAND_FLATTEN * climb)) + vec3(uSkyCloudsSeed * 0.01, 0.0);
  float n = skyNoise3Fbm(q);
  float threshold = skyCloudThreshold(0.62, 0.38) + (v - 0.35) * 0.3 - 0.05;
  float edge = 0.02 + 0.2 * uSkyClouds.w;
  float density = smoothstep(threshold - edge, threshold + edge, n) * (1.0 - smoothstep(span.x / span.y, 1.0, v)) * shown;
  if(density <= 0.0)
    return color;
  // Brighter toward their tops, and the side seen lit as much as it faces the light; from over
  // their tops, a thickness up, the sunlit tops themselves.
  float lit = clamp(1.0 - (skyNoise3Fbm(q + vec3(0.0, 0.0, 0.25)) - n) * 4.0, 0.35, 1.0);
  vec3 level = dir - uSkyUp * y;
  float side = 0.5 - 0.5 * dot(level, light) / max(length(level), 1e-4);
  float tops = uSkyClouds.y + uSkyCloudsShape.y;
  float above = clamp((dot(origin, uSkyUp) - tops) / max(uSkyCloudsShape.y, 500.0), 0.0, 1.0);
  lit = clamp(0.5 * lit + 0.5 * mix(side, 1.0, above), 0.35, 1.0);
  float hazed = skyAirHaze(origin, dir, far);
  vec3 cloud = skyCloudColor(dir, n, threshold, edge, density, lit, haze, hazed, angle, aa, 1.0 - above);
  return skyCloudOver(color, haze, cloud, density);
}

// Still clouds on a deck over `color`, seen from `origin` below it along `dir`, lit by
// the sun, or the moon at night. Far off they melt into `haze`, the sky without its sun
// disc, moon and stars, which they hide. Close up they would show they are flat, so they
// fade out nearby: climbing to the deck clears it from overhead out toward the horizon.
// With the band, the deck is seen along the ray turned down so that its horizon sits at the
// band's base, and dissolves where the view runs nearly parallel to it. ⚠️ Derivatives.
vec3 skyClouds(vec3 color, vec3 haze, vec3 dir, vec3 origin) {
  float below = uSkyClouds.y - dot(origin, uSkyUp);
  bool bandOnly = uSkyCloudsShape.z > 0.5 && uSkyCloudsShape.z < 1.5;
  if(below <= 0.0 || bandOnly || uSkyClouds.x <= 0.0 || uSkyCloudsColor.a <= 0.0)
    return color;
  float elevationSine = dot(dir, uSkyUp);
  float horizon = skyHorizon(dir);
  bool hinged = uSkyCloudsShape.z > 1.5;
  vec3 ray = dir;
  if(hinged) {
    // Turned down by the hinge over the horizon, and not at all straight up.
    float hinge = skyCloudBandSpan().x * skyCloudBandSquash(origin) + asin(horizon);
    float elevation = asin(clamp(elevationSine, -1.0, 1.0));
    float turned = (elevation - hinge) * (1.5707963 / (1.5707963 - hinge));
    vec3 across = dir - uSkyUp * elevationSine;
    float l = length(across);
    ray = (l > 1e-6 ? across / l : uSkyNorth) * cos(turned) + uSkyUp * sin(turned);
  }
  float y = dot(ray, uSkyUp);
  // Rays that never reach the plane take the mirrored hit, so the derivatives stay continuous.
  float plane = below / max(abs(elevationSine), 1e-4);
  // On the sphere, centred under the camera, which needs no origin: at the Earth's radius,
  // within tens of metres of one centred under the world's origin across a field.
  float r = uSkyCloudsShape.x - below;
  float q = below * max(2.0 * uSkyCloudsShape.x - below, 0.0);
  float t = q / max(r * y + sqrt(r * r * y * y + q), 1e-3);
  vec3 hit = origin + ray * t;
  vec2 p = vec2(dot(hit, uSkyEast), dot(hit, uSkyNorth)) / uSkyClouds.z + uSkyCloudsSeed;
  if(uSkyCloudsShape.y > 0.0) {
    // A slab, not a sheet: thicker parts lie further along the ray, so they shift against
    // their outlines as the view moves.
    float height = clamp(pnFbmSigned2Filtered(p, 3) + 0.5, 0.0, 1.0);
    vec2 slope = vec2(dot(ray, uSkyEast), dot(ray, uSkyNorth)) / max(y, 0.02);
    vec2 shift = slope * (uSkyCloudsShape.y / uSkyClouds.z) * height;
    p += shift * min(1.0, SKY_CLOUD_PARALLAX / max(length(shift), 1e-6));
  }
  float n = pnFbmSigned2Filtered(p, 5) + 0.5;
  // The pattern breaks up the distance they fade by: wisps go before cores, and the fade
  // has no clean edge.
  float near = smoothstep(0.3, 0.7, t / uSkyClouds.y + (n - 0.5) * 0.6);
  // Likewise where they dissolve toward the band.
  float graze = hinged ? smoothstep(0.0, SKY_CLOUD_GRAZE, y + (n - 0.5) * 0.8 * SKY_CLOUD_GRAZE) : 1.0;

  // Denser toward the light, the darker the side seen from below.
  vec3 light = skyCloudLight().daylight > 0.0 ? uSkySunDirection : uSkyMoonDirection;
  vec2 toward = vec2(dot(light, uSkyEast), dot(light, uSkyNorth));
  float ahead = pnFbmSigned2Filtered(p + toward * 0.25, 3) + 0.5;
  float threshold = skyCloudThreshold(0.68, 0.32);
  float edge = 0.02 + 0.2 * uSkyClouds.w;
  float density = smoothstep(threshold - edge, threshold + edge, n);
  float lit = clamp(1.0 - (ahead - n) * 4.0, 0.35, 1.0);
  // Far off they melt into the haze at the horizon, by the plane's distance, as if flat.
  float far = 1.0 - exp(-plane / (uSkyClouds.z * 15.0));
  float angle = atan(length(cross(dir, light)), dot(dir, light));
  vec3 cloud = skyCloudColor(dir, n, threshold, edge, density, lit, haze, far * 0.8, angle, max(fwidth(angle), 1e-5), 1.0);

  // The hinge is in open sky, with no strip above it to hide as at the sea's horizon.
  float above = hinged ? smoothstep(0.0, 0.008, y) : smoothstep(0.0, 0.03, skyOverHorizon(y, horizon));
  return skyCloudOver(color, haze, cloud, density * near * above * graze);
}
#endif

#ifdef SKY_OCEAN
// Where a stage's real geometry draws the sea instead: xy min, zw max in the wave plane.
uniform vec4 uSkyOceanStage;
// How far from the camera the stage draws it: out to the far plane.
uniform float uSkyOceanStageReach;

// Coordinates in the wave plane the Ocean works in: world X/Z in the default frame.
vec2 skyOceanPlane(vec3 p) {
  return vec2(dot(p, uSkyEast), -dot(p, uSkyNorth));
}

// Whether the stage draws the sea at `p`, reached `dist` along the view ray, more than
// `inset` inside its edge.
bool skyOceanOnStage(vec2 p, float dist, float inset) {
  return all(greaterThan(p, uSkyOceanStage.xy + inset)) && all(lessThan(p, uSkyOceanStage.zw - inset)) &&
    dist < uSkyOceanStageReach - inset;
}
#endif

#ifdef SKY_ABYSS
uniform float uSkyAbyssLevel; // height of the lid along uSkyUp, world units
uniform vec3 uSkyAbyssCeilingColor;
uniform vec3 uSkyAbyssHorizonColor;
uniform vec3 uSkyAbyssDepthColor;
uniform float uSkyAbyssFadeDistance;
uniform float uSkyAbyssTransition;
uniform float uSkyAbyssDarkening; // depth over which the void dims; 0 = off
uniform float uSkyAbyssDetail;
uniform float uSkyAbyssDetailScale; // world units
uniform vec2 uSkyAbyssDepthDetail; // the rock in the depths: strength, and feature size
uniform float uSkyAbyssFalloff; // exponent of the depths' gradient below the horizon

// The lid seen at `hit`, `reach` away: it recedes into the horizon colour. ⚠️ Derivatives.
vec3 skyAbyssCeiling(vec3 hit, float reach) {
  float near = exp(-reach / uSkyAbyssFadeDistance);
  vec3 ceiling = mix(uSkyAbyssHorizonColor, uSkyAbyssCeilingColor, near);
  if(uSkyAbyssDetail > 0.0) {
    // Pinned to the lid, so it slides and scales as the camera moves; far hits fade out.
    vec2 cells = vec2(dot(hit, uSkyEast), dot(hit, uSkyNorth)) / uSkyAbyssDetailScale;
    ceiling *= 1.0 + pnFbmSigned2Filtered(cells, 5) * 2.0 * uSkyAbyssDetail * near;
  }
  return ceiling;
}

// Faint distant rock along `dir`, at infinity so it never moves: wavy strata broken by
// crags, strongest just below the horizon. A brightness factor around 1.
float skyAbyssRock(vec3 dir) {
  float depth = -dot(dir, uSkyUp);
  if(uSkyAbyssDepthDetail.x <= 0.0 || depth <= 0.0)
    return 1.0;
  float size = max(uSkyAbyssDepthDetail.y, 1e-3);
  // On the direction itself, so it has no seam around the horizon.
  vec3 p = dir * (6.0 / size);
  float warp = skyNoise3(p * 0.7) - 0.5;
  float strata = sin((depth + warp * 0.06) * 70.0 / size + warp * 3.0);
  float crag = 1.0 - abs(2.0 * skyNoise3(p * 3.0) - 1.0);
  crag *= 0.6 + 0.4 * (1.0 - abs(2.0 * skyNoise3(p * 8.0) - 1.0));
  float rock = 0.5 * strata + (crag * crag - 0.3);
  float band = smoothstep(0.0, 0.02, depth) * exp(-depth * 4.0);
  return 1.0 + uSkyAbyssDepthDetail.x * rock * band;
}

// The bottomless gradient below the horizon, for a view ray at height `y` along up.
vec3 skyAbyssGradient(float y) {
  return mix(uSkyAbyssHorizonColor, uSkyAbyssDepthColor, pow(max(-y, 0.0), uSkyAbyssFalloff));
}

// The same along `dir`, with its rock.
vec3 skyAbyssDepths(vec3 dir) {
  return skyAbyssGradient(dot(dir, uSkyUp)) * skyAbyssRock(dir);
}

// Below the level, an endless lid overhead hides the sky and a bottomless gradient fills
// the view below the horizon (`depths`, skyAbyssDepths). Background only, so it never
// hides data.
vec3 skyAbyss(vec3 color, vec3 dir, vec3 origin, vec3 depths) {
  float depth = uSkyAbyssLevel - dot(origin, uSkyUp);
  #ifdef SKY_OCEAN
    // The level is the seabed: going through it is going through rock.
  float under = step(0.0, depth);
  #else
  float under = smoothstep(0.0, uSkyAbyssTransition, depth);
  #endif
  if(under <= 0.0)
    return color;

  float y = dot(dir, uSkyUp);
  // Rays that never reach the lid take the mirrored hit, so the derivatives stay continuous.
  float reach = depth / max(abs(y), 1e-6);
  vec3 hit = origin + dir * reach;
  vec3 ceiling = skyAbyssCeiling(hit, reach);

  vec3 abyss = y > 0.0 ? ceiling : depths;
  if(uSkyAbyssDarkening > 0.0)
    abyss *= exp(-depth / uSkyAbyssDarkening);

  return mix(color, abyss, under);
}
#endif

#ifdef SKY_OCEAN
#include ./sky-ocean.glsl
#endif

vec3 skyRadiance(vec3 dir, vec3 origin) {
  #ifdef SKY_OCEAN
    // Inside an occupant's seabed the camera is in the ground: seen as from just below the sea's.
  if(uSkyOceanBuried > 0.5)
    origin -= uSkyUp * (dot(origin, uSkyUp) - uSkyOceanLevel + uSkyOceanDepth + 1.0);
  #endif
  float y = dot(dir, uSkyUp);
  float dy = fwidth(y);
  float blend = max(uSkyHorizonBlend, dy);
  float horizon = skyHorizon(dir);

  vec3 color = skySurface(dir, blend);
  #ifdef SKY_CLOUDS
  vec3 haze = color;
  #endif

  if(uSkySunDisc > 0.0) {
    float cosSun = dot(dir, uSkySunDirection);
    // atan2 keeps the angle precise for the small radii a disc uses.
    float angle = atan(length(cross(dir, uSkySunDirection)), cosSun);
    float aa = max(fwidth(angle), 1e-5);
    float disc = 1.0 - smoothstep(uSkySunSize - aa, uSkySunSize + aa, angle);
    SkyLight seen = skyLight(skyLightShare(uSkySunDirection, dot(cameraPosition, uSkyUp) - uSkyAir.x));
    color = mix(color, skySunDiscRadiance(seen), disc * uSkySunDisc);
    // Over the disc too, so it is never dimmer than its glare; above the horizon, while the sun is up.
    float sunOver = skyOverHorizon(dot(uSkySunDirection, uSkyUp), skyHorizon(uSkySunDirection));
    float up = smoothstep(-blend, 0.0, skyOverHorizon(y, horizon)) * smoothstep(-uSkySunSize, uSkySunSize, sunOver);
    vec3 light = skyTwilightLight(seen);
    // Full while warm (to ~15° up), a quarter once white (~20°).
    float white = min(light.r, min(light.g, light.b)) / max(max(light.r, max(light.g, light.b)), 1e-4);
    float glare = uSkySunRadiance > 1.0 ? 1.0 : mix(1.0, SKY_SUN_DAY_GLARE, smoothstep(0.3, 0.7, white));
    color += light * skySunGlare(dir, angle, aa) * glare * up * uSkySunDisc;
  }
  color = skyNight(color, dir, blend);
  #ifdef SKY_CLOUDS
  color = skyCloudBand(color, haze, dir, origin);
  color = skyClouds(color, haze, dir, origin);
  #endif

  // The void below the horizon, with its rock: taken once, as each call compiles a copy.
  #if defined(SKY_OCEAN)
  vec3 depths = skyOceanVoid(dir);
  #elif defined(SKY_ABYSS)
  vec3 depths = skyAbyssDepths(dir);
  #endif

  bool skip = false;
  #ifdef SKY_OCEAN
  vec3 open = color;
    // Kept a few pixels inside the stage's rim, so the rim still has the seabed behind it.
    // Without a seabed there is nothing to leave to the stage, nor from inside an occupant's.
  bool staged = skyOceanStaged(dir, origin, 4.0, false) && uSkyOceanSeabed > 0.5 && uSkyOceanBuried < 0.5;
    // Staged pixels are replaced below; their sea is skipped where the quad surely is.
  bool surelyStaged = skyOceanStaged(dir, origin, 8.0, true);
  skip = staged && surelyStaged;
  // One view in the water for both uses below: each call compiles a full copy of the waves.
  vec3 inWater = open;
  if(!skip && skyOceanNeedsWaterView(origin))
    inWater = skyOceanWaterView(dir, origin, blend, depths);
  if(!skip)
    color = skyOcean(color, dir, origin, inWater, depths);
  #endif

  #ifdef SKY_ABYSS
  // Not skipped: from the void the lid shows through a stage's gaps too, as through an
  // occupant's section or a see-through column. Above the void it returns at once.
  color = skyAbyss(color, dir, origin, depths);
  #endif

  #if defined(SKY_OCEAN) && defined(SKY_ABYSS)
  if(uSkyOceanSeabed < 0.5) {
    vec3 fromBelow = skyOceanFromBelow(dir, origin, open, inWater);
    if(y > 0.0 && dot(origin, uSkyUp) < uSkyAbyssLevel)
      color = fromBelow;
  }
  #endif

  #ifdef SKY_OCEAN
    // The stage draws the sea here; what shows through its gaps lies beyond its seabed.
    // It leaves the sky over the sea's curved horizon: from a little below, so none it leaves is void.
  if(staged) {
      #ifdef SKY_ABYSS
    float sea = uSkyCurvature > 0.0 ? horizon - 2.0 * dy : 0.0;
    color = y < sea ? skyOceanThroughCutaway(depths, dir, origin) : color;
      #else
    color = open;
      #endif
  }
  if(staged)
    color = skyDebugTint(color, SKY_DEBUG_STAGED);
  else if(any(notEqual(color, open)))
    color = skyDebugTint(color, SKY_DEBUG_SEA);
  #endif

  return color * uSkyIntensity;
}
