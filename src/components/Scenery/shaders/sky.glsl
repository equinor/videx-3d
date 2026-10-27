// Stylised sky radiance for a world-space view direction.
//
// Colours are display-referred linear values, so with no tone mapping the result
// stays in [0, 1] everywhere except at the sun. The sun colour and daylight factor
// are computed on the CPU (sky-model.ts) and shared with the directional light.

#include ./sky-gradient.glsl
#include ./sky-void.glsl
#ifndef SKY_NO_GRATICULE
// Lines on the Earth over what is seen of it from the air (SceneryGraticule).
#include ../../../sdk/materials/shaderLib/graticule.glsl
#endif

uniform vec3 uSkyNorth; // normalised, perpendicular to uSkyUp
uniform vec3 uSkyEast;
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
// How many of them are set: 0 without an observer. A uniform also keeps the loop over
// them a loop in Direct3D.
uniform int uSkyPlanetCount;
uniform sampler2D uSkyStarCells; // each cell of a cube-face grid over the star sphere: its first entry, and count
uniform sampler2D uSkyStarList; // each entry: the star's direction scaled by 2 + its B-V, and its magnitude
uniform float uSkyHorizonBlend; // width of the horizon -> ground transition, in dot(dir, up)
uniform float uSkyIntensity;
uniform float uSkyDebug; // 1: tint each part by what draws it (SceneryDebug.tint)
// The sea's levels, and whether the camera is under a stage's ground above its seabed
// (SceneryMaterial.oceanBuried): every layer of the background starts its view from there
// (skyViewOrigin), with a sea or not.
uniform float uSkyOceanLevel; // along uSkyUp
uniform float uSkyOceanDepth;
uniform float uSkyOceanBuried;

// Debug tints (SceneryDebug.tint): the sky's own sea, seabed and void; what it leaves to a
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
// The procedural stars as a faint filler under an observer's catalogue, relative to their own,
// and the magnitude the brightest of them is held to: half the light of the catalogue's
// faintest (magnitude 5), so the real stars, the planets, the sun and the moon stand out.
#define SKY_STAR_FILLER 0.12
#define SKY_STAR_FILLER_BRIGHTEST 6.5
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

// The same of a layer (premultiplied), as much as it covers.
vec4 skyDebugTintOver(vec4 layer, vec3 tint) {
  return uSkyDebug > 0.5 ? vec4(0.5 * (layer.rgb + tint * layer.a), layer.a) : layer;
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
  for(int i = 0; i < uSkyPlanetCount; i++) {
    vec4 planet = uSkyPlanets[i];
    float shine = skyStarShine(planet.w) * skyStarSeen(planet.w, sunElevation);
    light += skyStarColor(colorIndex[i]) * skyPoint(dir, planet.xyz, shine * uSkyStars.x, pixel);
  }
  return light;
}

// The moon and the stars over `color`, as night falls, and by day where the sky is space;
// the moon by day too, while it can be up. ⚠️ Derivatives.
vec3 skyNight(vec3 color, vec3 dir, float blend) {
  float height = skyCameraHeight();
  if(uSkyNight <= 0.0 && uSkyMoonDay <= 0.0 && !skyNearSpace(height))
    return color;
  // By day too where the sky has gone all but black, under a twentieth of its light.
  float space = skySpace(dir, height);
  float black = smoothstep(0.95, 1.0, space);
  // From high up, by the sun over the lowered horizon, where it can still be up.
  float share = skyLightShare(dir, height);
  float night = max(mix(uSkyNight, 1.0 - uSkyAirLight.x, share), black);
  float y = skyOverSeaHorizon(dir);
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
  // The air's glow about it: none where the view crosses no air.
  float glow = uSkyMoonGlow * uSkyMoonPhase * pow(max(cosMoon, 0.0), 200.0) * (1.0 - space);
  // The stars come out late, once it is dark, and fade low down through more air.
  float airmass = 1.0 / (max(y, 0.0) + 0.05);
  vec3 starDir = uSkyStarFrame * dir;
  float pixel = length(fwidth(dir));
  float procedural = skyStars(starDir);
  // In space as if the sun were well down.
  float sunElevation = mix(degrees(asin(skyLight(share).sunY)), -18.0, black);
  vec3 stars;
  if(uSkyObserved > 0.5 && uSkySunDisc > 0.0) {
    // The procedural ones stand in, faintly, for those past the catalogue.
    float filler = min(procedural * SKY_STAR_FILLER, skyStarShine(SKY_STAR_FILLER_BRIGHTEST)) * skyStarSeen(SKY_STAR_FILLER_BRIGHTEST, sunElevation);
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
uniform int uSkyCloudBandOctaves; // octaves of the band's noise (skyNoise3Fbm)
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
// Climbing, the band's clouds flatten by up to this share.
#define SKY_CLOUD_BAND_FLATTEN 0.05
// Between these camera heights (world units) the band fades out: from far up it would rim the globe.
#define SKY_CLOUD_BAND_FADE vec2(100000.0, 250000.0)
// With the band, the deck dissolves where the view runs within this (a sine, about 9°) of
// parallel to it.
#define SKY_CLOUD_GRAZE 0.15

// skyNoise3 over `uSkyCloudBandOctaves` octaves (5), in [0, 1]. A uniform count keeps the
// loop a loop in Direct3D, rather than a copy per octave at each of its calls.
float skyNoise3Fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for(int o = 0; o < uSkyCloudBandOctaves; o++) {
    sum += amp * skyNoise3(p);
    norm += amp;
    p = p * 2.03 + vec3(17.1, 3.7, 9.2);
    amp *= 0.5;
  }
  return sum / max(norm, 1e-4);
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

// `cloud` of `density` over the sky, as a layer (premultiplied): its opacity blends it into the
// bare sky (`haze`), while it hides the sun, moon and stars as if opaque, from opacity 0.5
// down less so.
vec4 skyCloudOver(vec3 haze, vec3 cloud, float density) {
  float opacity = uSkyCloudsColor.a;
  float cover = density * SKY_CLOUD_OCCLUSION * min(2.0 * opacity, 1.0);
  return vec4(mix(haze, cloud, opacity) * cover, cover);
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
  return clamp(skyCloudBandTop(globeViewHeight(origin)) / skyCloudBandTop(0.0), 1e-3, 1.0);
}

// Distant clouds along the horizon, fixed to directions: so far off that the camera's moves
// barely shift them. Seen side-on: under the nearest ones' base, ever further ones overlap
// densely down to the horizon; above it, their tops vary. Climbing, they go down with the
// horizon as the Earth's curve lowers it (on a flat sea they stay on it), squash onto it as
// their tops sink, until from high above they are a thin strip along it, and flatten,
// quickly at first and then hardly at all. As a layer over the sky (premultiplied).
// ⚠️ Derivatives, taken before it branches.
vec4 skyCloudBand(vec3 haze, vec3 dir, vec3 origin) {
  float shown = 1.0 - smoothstep(SKY_CLOUD_BAND_FADE.x, SKY_CLOUD_BAND_FADE.y, globeViewHeight(origin));
  if(uSkyCloudsShape.z < 0.5 || uSkyClouds.x <= 0.0 || uSkyCloudsColor.a <= 0.0 || shown <= 0.0)
    return vec4(0.0);
  vec3 light = skyCloudLight().daylight > 0.0 ? uSkySunDirection : uSkyMoonDirection;
  float angle = atan(length(cross(dir, light)), dot(dir, light));
  float aa = max(fwidth(angle), 1e-5);
  vec3 look = globeCameraLook();
  float y = dot(dir, look);
  float over = asin(clamp(y, -1.0, 1.0)) - asin(skyHorizon(dir));
  vec2 span = skyCloudBandSpan();
  float climb = 1.0 - exp(-max(globeViewHeight(origin), 0.0) / (1.5 * uSkyClouds.y));
  float e = max(over, 0.0) / skyCloudBandSquash(origin);
  if(over <= -0.002 || e >= span.y)
    return vec4(0.0);
  float v = e / span.y;
  float far = uSkyCloudsShape.w;
  // Its bearing in the level the camera sees the sky by: the field's east and north turned
  // onto it.
  vec2 around = normalize(vec2(dot(dir, globeTurn(uSkyEast, look)), dot(dir, globeTurn(uSkyNorth, look))) + 1e-6);
  float across = SKY_CLOUD_BAND_WIDTH * far / uSkyClouds.z;
  float up = far / (SKY_CLOUD_BAND_HEIGHT * max(uSkyCloudsShape.y, 100.0));
  vec3 q = vec3(around * across, e * up * (1.0 + SKY_CLOUD_BAND_FLATTEN * climb)) + vec3(uSkyCloudsSeed * 0.01, 0.0);
  float n = skyNoise3Fbm(q);
  float threshold = skyCloudThreshold(0.62, 0.38) + (v - 0.35) * 0.3 - 0.05;
  float edge = 0.02 + 0.2 * uSkyClouds.w;
  float density = smoothstep(threshold - edge, threshold + edge, n) * (1.0 - smoothstep(span.x / span.y, 1.0, v)) * shown;
  if(density <= 0.0)
    return vec4(0.0);
  // Brighter toward their tops, and the side seen lit as much as it faces the light; from over
  // their tops, a thickness up, the sunlit tops themselves.
  float lit = clamp(1.0 - (skyNoise3Fbm(q + vec3(0.0, 0.0, 0.25)) - n) * 4.0, 0.35, 1.0);
  vec3 level = dir - look * y;
  float side = 0.5 - 0.5 * dot(level, light) / max(length(level), 1e-4);
  float tops = uSkyClouds.y + uSkyCloudsShape.y;
  float above = clamp((globeViewHeight(origin) - tops) / max(uSkyCloudsShape.y, 500.0), 0.0, 1.0);
  lit = clamp(0.5 * lit + 0.5 * mix(side, 1.0, above), 0.35, 1.0);
  float hazed = skyAirHaze(origin, dir, far);
  vec3 cloud = skyCloudColor(dir, n, threshold, edge, density, lit, haze, hazed, angle, aa, 1.0 - above);
  return skyCloudOver(haze, cloud, density);
}

// Still clouds on a deck, seen from `origin` below it along `dir`, lit by the sun, or the
// moon at night, as a layer over the sky (premultiplied). Far off they melt into `haze`, the
// sky without its sun disc, moon and stars, which they hide. Close up they would show they
// are flat, so they fade out nearby: climbing to the deck clears it from overhead out toward
// the horizon. With the band, the deck is seen along the ray turned down so that its horizon
// sits at the band's base, and dissolves where the view runs nearly parallel to it.
// ⚠️ Derivatives.
vec4 skyClouds(vec3 haze, vec3 dir, vec3 origin) {
  float below = uSkyClouds.y - globeViewHeight(origin);
  bool bandOnly = uSkyCloudsShape.z > 0.5 && uSkyCloudsShape.z < 1.5;
  if(below <= 0.0 || bandOnly || uSkyClouds.x <= 0.0 || uSkyCloudsColor.a <= 0.0)
    return vec4(0.0);
  vec3 look = globeCameraLook();
  float elevationSine = dot(dir, look);
  float horizon = skyHorizon(dir);
  bool hinged = uSkyCloudsShape.z > 1.5;
  vec3 ray = dir;
  if(hinged) {
    // Turned down by the hinge over the horizon, and not at all straight up.
    float hinge = skyCloudBandSpan().x * skyCloudBandSquash(origin) + asin(horizon);
    float elevation = asin(clamp(elevationSine, -1.0, 1.0));
    float turned = (elevation - hinge) * (1.5707963 / (1.5707963 - hinge));
    vec3 across = dir - look * elevationSine;
    float l = length(across);
    ray = (l > 1e-6 ? across / l : globeTurn(uSkyNorth, look)) * cos(turned) + look * sin(turned);
  }
  // From the camera's own up: the deck's sphere is about the globe's centre, which lies
  // straight under the camera along it, so it needs no origin. Over the field the scene's.
  float y = dot(ray, globeCameraUp());
  // Rays that never reach the plane take the mirrored hit, so the derivatives stay continuous.
  float plane = below / max(abs(elevationSine), 1e-4);
  // On the sphere about the globe's centre, at the Earth's radius and the deck's altitude.
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
  return skyCloudOver(haze, cloud, density * near * above * graze);
}
#endif

#ifdef SKY_OCEAN
// Where a stage's real geometry draws the sea instead: xy min, zw max in the wave plane.
uniform vec4 uSkyOceanStage;
// How far from the camera the stage draws it: out to the far plane, 0 while the camera is
// off its rectangle on the globe (SceneryMaterial.claimStage).
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
uniform float uSkyAbyssFadeDistance;
uniform float uSkyAbyssTransition;
uniform float uSkyAbyssDarkening; // depth over which the void dims; 0 = off
uniform float uSkyAbyssDetail;
uniform float uSkyAbyssDetailScale; // world units
uniform vec2 uSkyAbyssDepthDetail; // the rock in the depths: strength, and feature size
// Its colours and the depths' falloff: sky-void.glsl.

// The lid seen at `hit`, `reach` away: it recedes into the horizon colour over the fade
// distance, or never (0). ⚠️ Derivatives.
vec3 skyAbyssCeiling(vec3 hit, float reach) {
  float near = uSkyAbyssFadeDistance > 0.0 ? exp(-reach / uSkyAbyssFadeDistance) : 1.0;
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

// The gradient below the horizon (skyAbyssGradient, sky-void.glsl) along `dir`, with its
// rock; with walls, without: it lies at infinity, they do not.
vec3 skyAbyssDepths(vec3 dir) {
  #ifdef SKY_ABYSS_WALLS
  return skyAbyssGradient(dot(dir, uSkyUp));
  #else
  return skyAbyssGradient(dot(dir, uSkyUp)) * skyAbyssRock(dir);
  #endif
}

#ifdef SKY_ABYSS_WALLS
#include ./sky-abyss-wall-shape.glsl
uniform vec4 uSkyAbyssWallClip; // the plane they are cut away up to: what lies past w along its normal shows
uniform vec3 uSkyAbyssWallColor; // their rock's
uniform vec3 uSkyAbyssWallCutColor; // their rock's inside, where they are cut
// The cut's beds as a share of uSkyAbyssWalls.w, its joints' spacing likewise, and how much paler its edge is.
#define SKY_ABYSS_BED 0.06
#define SKY_ABYSS_JOINTS 0.25
#define SKY_ABYSS_CUT_EDGE 1.8
uniform vec2 uSkyAbyssWallMist; // how dense the mist clinging to them is, 0 to 1; how far it hangs off the rock (world units)
uniform vec3 uSkyAbyssWallLight; // toward the light raking them (world)
uniform vec3 uSkyAbyssWallLightColor;
uniform vec3 uSkyAbyssWallFillTop; // the subsurface's light map: its backdrop overhead,
uniform vec3 uSkyAbyssWallFillBottom; // underfoot,
uniform vec3 uSkyAbyssWallFillBelow; // and its panels below
// How much of the light map's backdrop fills in their shade, and of its panels below bounces up.
#define SKY_ABYSS_FILL 2.0
#define SKY_ABYSS_BOUNCE 0.05
// How bright their mist is against the void's horizon colour, and how thick it lies on rock seen face on.
#define SKY_ABYSS_MIST_LIGHT 1.3
#define SKY_ABYSS_MIST_VEIL 0.6
uniform vec3 uSkyAbyssWallSandColor; // the sand over their rock's
uniform vec3 uSkyAbyssWallGlowColor; // the dim light at the top of the stage's
uniform float uSkyAbyssWallHazeDepth; // depth below the lid over which the haze in the hollow darkens; 0 for never
// How bright the glow at the top of the stage is, at full `glow`, against its colour.
#define SKY_ABYSS_GLOW 4.0
// The sand's laminae where it is cut, as a share of uSkyAbyssWalls.w.
#define SKY_ABYSS_SAND_BED 0.02
uniform float uSkyAbyssWallFade; // the distance beyond their rim the hollow's light and haze fade out over (skyAbyssWallFar, skyAbyssWallFog); 0 for none
// How much of that light is left at the fade's far end, and over how many times its
// distance on from there the rest fades out.
#define SKY_ABYSS_FADED 0.2
#define SKY_ABYSS_FADED_OUT 2.0
// How many stretches of a view their haze is summed over (skyAbyssWallClear).
#define SKY_ABYSS_FOG_SAMPLES 6
// How near, as a share of the way there, a view rising from under their foot may pass their
// rock there and still go into it: about a pixel, so the rock overlaps the mesh's last edge.
#define SKY_ABYSS_FOOT_OVERLAP 0.003
// The rock tests skyAbyssWallStartUnder makes (2): a uniform, so they share one loop.
uniform int uSkyAbyssWallTests;
uniform float uSkyAbyssWallCover; // 1 while the seabed beyond the stage, which the background draws, hides what lies below it

// Where a view along `dir` from `origin` goes below the lid: 0 from under it; -1 for never.
float skyAbyssLidStart(vec3 origin, vec3 dir) {
  float h0 = dot(origin, uSkyUp);
  if(h0 <= uSkyAbyssLevel)
    return 0.0;
  float y = dot(dir, uSkyUp);
  return y < 0.0 ? (h0 - uSkyAbyssLevel) / -y : -1.0;
}

// The plane the walls are cut away up to cuts away all that lies short of it
// (skyAbyssWallClipPlane), whichever side of it the camera is on. A view from the side cut
// away starts where it is past the plane; one from the side kept ends there. At the plane
// the two agree, so a camera crossing it, or rounding either side of it, changes nothing.

// Where a view along `dir` from `origin` is past the plane the walls are cut away up to; 1e30 for never.
float skyAbyssWallCut(vec3 origin, vec3 dir) {
  float behind = uSkyAbyssWallClip.w - dot(uSkyAbyssWallClip.xyz, origin);
  if(behind <= 0.0)
    return 0.0;
  float toward = dot(dir, uSkyAbyssWallClip.xyz);
  return toward > 0.0 ? behind / toward : 1e30;
}

// Where a view along `dir` from `origin` on the side kept goes past the plane, into what is
// cut away; 1e30 for never, and from the side cut away.
float skyAbyssWallCutEnd(vec3 origin, vec3 dir) {
  float ahead = dot(uSkyAbyssWallClip.xyz, origin) - uSkyAbyssWallClip.w;
  float toward = dot(dir, uSkyAbyssWallClip.xyz);
  return ahead >= 0.0 && toward < 0.0 ? ahead / -toward : 1e30;
}

// How far into the walls' rock `p` (`h` high) is as their mesh lays it: past the plane of
// its triangle over p's way round and depth, along its normal; above 0 in it. Below the
// mesh, its last row's triangles run on down.
float skyAbyssWallInto(vec3 p, float h) {
  vec2 grid = uSkyAbyssWallGrid.xy;
  float depth = clamp(uSkyAbyssLevel - h, 0.0, uSkyAbyssWallGrid.z);
  vec2 around = skyAbyssWallAround(skyAbyssWallPlane(p), uSkyAbyssWalls.x);
  vec2 at = vec2(around.x / around.y * grid.x, sqrt(depth / uSkyAbyssWallGrid.z) * grid.y);
  vec2 cell = min(floor(at), grid - 1.0);
  float top = skyAbyssWallRowDepth(cell.y);
  vec2 f = vec2(at.x - cell.x, (depth - top) / (skyAbyssWallRowDepth(cell.y + 1.0) - top));
  // A cell's triangles meet along its diagonal from (i + 1, j) to (i, j + 1).
  float first = f.x + f.y < 1.0 ? 1.0 : -1.0;
  vec3 a = skyAbyssWallVertex(first > 0.0 ? cell : cell + 1.0).xyz;
  vec3 b = skyAbyssWallVertex(cell + vec2(1.0, 0.0)).xyz;
  vec3 c = skyAbyssWallVertex(cell + vec2(0.0, 1.0)).xyz;
  // Round x down points out of the hollow, as east = north x up (compassBasis).
  return dot(p - a, normalize(cross(b - a, c - a))) * first;
}

// How far into the walls' rock `p` (`h` high) is, above 0 in it: surely short of it by the
// cheap test, else as their mesh lays it (skyAbyssWallInto), a column's width to spare for
// its triangles' chords at the corners.
float skyAbyssWallInRock(vec3 p, float h) {
  float r = -skyAbyssWallGap(p, h);
  return r > -skyAbyssWallLap() / uSkyAbyssWallGrid.x ? skyAbyssWallInto(p, h) : r;
}

// Where along `dir` from `origin` the walls can show (xyz), and where a view rising from
// under their foot goes into their rock (w). xyz: below the lid and past the plane they
// are cut away up to (x, 1e30 for never); how far into their rock the view starts there,
// above 0 where the fill shows and hides all beyond (y); 1 if it starts at the lid, from
// above (z). Below their foot the camera is never in their rock, which is black there
// anyway: a view from it rises to the hollow's opening or into that rock. w: the rock
// under the foot runs on down without a mesh, and is solid from where the view meets it;
// 1e30 for never, or if the view passes into what the cut takes away first. Within about
// a pixel of that rock counts as in it (SKY_ABYSS_FOOT_OVERLAP), so no crack shows between
// it and the mesh's last edge.
// The two rock tests take turns in one loop, its count a uniform (uSkyAbyssWallTests, 2):
// Direct3D then compiles the walls' shape once, not once for each.
vec4 skyAbyssWallStartUnder(vec3 origin, vec3 dir) {
  float lid = skyAbyssLidStart(origin, dir);
  float cut = skyAbyssWallCut(origin, dir);
  float t = max(lid, cut);
  vec3 p = origin + dir * t;
  float h = dot(p, uSkyUp);
  bool starts = lid >= 0.0 && cut < 1e29 && h <= uSkyAbyssLevel + 1.0;
  float foot = uSkyAbyssLevel - uSkyAbyssWallGrid.z;
  bool atStart = starts && !(t <= 0.0 && h < foot);
  float y = dot(dir, uSkyUp);
  float under = starts ? foot - h : 0.0;
  float at = t + under / max(y, 1e-6);
  bool atFoot = y > 0.0 && under > 0.0 && at < skyAbyssWallCutEnd(origin, dir);
  vec2 rock = vec2(-1.0, -1e30);
  for(int i = 0; i < uSkyAbyssWallTests; i++) {
    bool first = i == 0;
    if(first ? atStart : atFoot) {
      float r = skyAbyssWallInRock(first ? p : origin + dir * at, first ? h : foot);
      if(first)
        rock.x = r;
      else
        rock.y = r;
    }
  }
  vec3 start = starts ? vec3(t, rock.x, lid > 0.0 && lid >= cut ? 1.0 : 0.0) : vec3(1e30, -1.0, 0.0);
  return vec4(start, atFoot && rock.y > -SKY_ABYSS_FOOT_OVERLAP * at ? at : 1e30);
}

// Whether the walls' face `t` along `dir` from `origin` is hidden: cut away, behind their
// fill, or past where the view went into their rock under the foot.
bool skyAbyssWallHidden(vec3 origin, vec3 dir, float t) {
  vec4 start = skyAbyssWallStartUnder(origin, dir);
  return t < start.x || start.y > 0.0 || t > skyAbyssWallCutEnd(origin, dir) || t > start.w;
}

#ifndef SKY_OCEAN
// The sea's cutaway, as sky-ocean.glsl reads it, for where it takes the seabed (skyAbyssWallCovered).
#include ../../../sdk/materials/shaderLib/water-fog.glsl
uniform vec3 uSkyOceanCutawayAnchor;
uniform vec3 uSkyOceanCutawayHeading;
uniform vec3 uSkyOceanCutawayShape;
uniform vec3 uSkyOceanCutawayWaveA;
uniform vec3 uSkyOceanCutawayWaveB;
uniform vec2 uSkyOceanCutawayCuts;

// Whether a view along `dir` from `origin` above the lid goes down through it beyond the
// stage where the seabed there, which the background draws, hides what lies below it
// (uSkyAbyssWallCover), and a cutaway does not take it. Over the stage its own seabed
// hides them by depth, but where cut. Only the walls' own shaders ask, without the sea.
bool skyAbyssWallCovered(vec3 origin, vec3 dir) {
  float lid = skyAbyssLidStart(origin, dir);
  bool covered = false;
  if(uSkyAbyssWallCover > 0.5 && lid > 0.0) {
    vec2 q = abs(skyAbyssWallPlane(origin + dir * lid));
    WaterFogCutaway cutaway = WaterFogCutaway(uSkyOceanCutawayAnchor, uSkyOceanCutawayHeading, uSkyOceanCutawayShape, uSkyOceanCutawayWaveA, uSkyOceanCutawayWaveB);
    float cut = waterFogCutawayAlong(cutaway, origin, origin + dir, uSkyUp) * uSkyOceanCutawayCuts.y;
    covered = (q.x > uSkyStageBox.z || q.y > uSkyStageBox.w) && cut < 0.5;
  }
  return covered;
}
#endif

// Of the light in the hollow, how much is left `h` high: it dims with depth below the lid,
// to nearly black by uSkyAbyssWallShape.z (`lightDepth`). On the rock, the sand and the glow.
float skyAbyssDim(float h) {
  return exp(3.0 * min(h - uSkyAbyssLevel, 0.0) / uSkyAbyssWallShape.z);
}

// The haze in the hollow `h` high: the void's horizon colour, darkening with depth below the
// lid to nearly black by uSkyAbyssWallHazeDepth (`hazeDepth`), or never.
vec3 skyAbyssHazeColor(float h) {
  float dim = uSkyAbyssWallHazeDepth > 0.0 ? exp(3.0 * min(h - uSkyAbyssLevel, 0.0) / uSkyAbyssWallHazeDepth) : 1.0;
  return uSkyAbyssHorizonColor * dim;
}

// The light on the walls' rock facing `surface`, `h` high: raked by uSkyAbyssWallLight as
// strongly as uSkyAbyssWalls.y, filled in by the subsurface's light map (its backdrop, and
// its panels below bouncing up), dimming with depth.
vec3 skyAbyssWallLit(vec3 surface, float h) {
  float up = dot(surface, uSkyUp);
  vec3 fill = SKY_ABYSS_FILL * mix(uSkyAbyssWallFillBottom, uSkyAbyssWallFillTop, 0.5 + 0.5 * up) +
    SKY_ABYSS_BOUNCE * uSkyAbyssWallFillBelow * max(-up, 0.0);
  vec3 key = uSkyAbyssWallLightColor * (uSkyAbyssWalls.y * max(dot(surface, uSkyAbyssWallLight), 0.0));
  return (key + fill) * skyAbyssDim(h);
}

// The walls' rock lit, facing `surface` `h` high, its creases shadowed (`open`, low in them).
vec3 skyAbyssWallShade(vec3 surface, float open, float h) {
  return uSkyAbyssWallColor * skyAbyssWallLit(surface, h) * mix(0.45, 1.0, open);
}

// The dim light at the top of the stage, at `p`, in its own colour: over the stage, fading
// out beyond it over the walls' distance, and dimming with depth as the rock's light does.
vec3 skyAbyssWallGlow(vec3 p) {
  float beyond = max(sdfBox(skyAbyssWallPlane(p), uSkyStageBox.zw), 0.0);
  float glow = SKY_ABYSS_GLOW * uSkyAbyssWallSand.y * exp(-beyond / uSkyAbyssWalls.x);
  return uSkyAbyssWallGlowColor * (glow * skyAbyssDim(dot(p, uSkyUp)));
}

// The sand over their rock at `p`, facing `surface`: dull and matte, lit as the rock is
// and by the glow at the top of the stage, faintly mottled.
vec3 skyAbyssWallSandShade(vec3 surface, vec3 p) {
  float mottle = 0.9 + 0.2 * pnValueNoise2(skyAbyssWallPlane(p) / (0.2 * uSkyAbyssWalls.w));
  return uSkyAbyssWallSandColor * (skyAbyssWallLit(surface, dot(p, uSkyUp)) + skyAbyssWallGlow(p)) * mottle;
}

// The sand's bedding where the walls are cut, `depth` below the lid and `across` along the
// cut, a pixel `footprint` wide there: thin laminae of varying tone, warped, about 1, gone
// where a pixel spans them.
float skyAbyssWallSandLaminae(float depth, float across, float footprint) {
  float size = SKY_ABYSS_SAND_BED * uSkyAbyssWalls.w;
  float warp = (pnValueNoise2(vec2(across / (2.0 * uSkyAbyssWalls.w), depth / uSkyAbyssWalls.w)) - 0.5) * 2.0 * size;
  float l = (depth + warp) / size;
  float tone = mix(skyHash(vec3(floor(l), 9.0, 2.0)), skyHash(vec3(floor(l) + 1.0, 9.0, 2.0)), smoothstep(0.7, 1.0, fract(l)));
  return 1.0 + 0.3 * (tone - 0.5) * (1.0 - smoothstep(0.3, 1.0, footprint / size));
}

// The rock's bedding where the walls are cut, `depth` below the lid and `across` along the
// cut (world units), a pixel `footprint` wide there: its tone about 1 (x), and a joint
// crossing it, 0 to 1 (y). Beds of varying tone, warped so they lean and pinch out, finer
// laminae in them; joints straight down, here and there, each within its bed.
vec2 skyAbyssWallStrata(float depth, float across, float footprint) {
  float size = uSkyAbyssWalls.w;
  float warp = (pnValueNoise2(vec2(across / (3.0 * size), depth / (2.0 * size))) - 0.5) * 0.3 * size;
  float d = (depth + warp) / (SKY_ABYSS_BED * size);
  float bed = floor(d);
  float tone = mix(skyHash(vec3(bed, 3.0, 7.0)), skyHash(vec3(bed + 1.0, 3.0, 7.0)), smoothstep(0.9, 1.0, fract(d)));
  // Laminae, a fifth of a bed, gone where a pixel spans them.
  float l = 5.0 * d;
  float lamina = mix(skyHash(vec3(floor(l), 5.0, 1.0)), skyHash(vec3(floor(l) + 1.0, 5.0, 1.0)), smoothstep(0.8, 1.0, fract(l)));
  lamina = (lamina - 0.5) * (1.0 - smoothstep(0.1, 0.4, footprint / (0.2 * SKY_ABYSS_BED * size)));
  float cell = SKY_ABYSS_JOINTS * size;
  float j = across / cell;
  float width = max(0.003 * cell, footprint);
  float joint = step(0.7, skyHash(vec3(floor(j), bed, 11.0))) * (1.0 - smoothstep(width, 2.0 * width, abs(fract(j) - 0.5) * cell));
  return vec2(0.6 + 0.6 * tone + 0.2 * lamina, joint);
}

// The fill where the plane they are cut away up to, or from above the lid, cuts the walls'
// rock, where a view along `dir` from `origin` starts in it (`start`, skyAbyssWallStart):
// the rock's inside, bedded and jointed, in its own colour, lit flat and matte; in the sand
// over it, the sand's thin laminae; with a thin, paler edge where it meets their own face.
vec3 skyAbyssWallFill(vec3 origin, vec3 dir, vec3 start, float pixel) {
  float t = start.x;
  vec3 p = origin + dir * t;
  float h = dot(p, uSkyUp);
  float depth = uSkyAbyssLevel - h;
  bool lid = start.z > 0.5;
  vec3 normal = lid ? uSkyUp : -uSkyAbyssWallClip.xyz;
  vec3 across = lid ? uSkyEast : normalize(cross(uSkyUp, normal));
  float footprint = t * pixel;
  float slant = footprint / max(abs(dot(normal, dir)), 0.2);
  vec2 strata = skyAbyssWallStrata(depth, dot(p, across), slant);
  vec3 color = uSkyAbyssWallCutColor * skyAbyssWallLit(normal, h) * strata.x * (1.0 - 0.6 * strata.y);
  if(uSkyAbyssWallSand.x > 0.0) {
    vec2 around = skyAbyssWallAround(skyAbyssWallPlane(p), uSkyAbyssWalls.x);
    float rock = skyAbyssWallRockShare(depth, around.x / around.y);
    if(rock < 1.0)
      color = mix(skyAbyssWallSandShade(normal, p) * skyAbyssWallSandLaminae(depth, dot(p, across), slant), color, rock);
  }
  // Its edge, where the rock it cuts is thinnest: a pixel or two wide.
  return mix(color, color * SKY_ABYSS_CUT_EDGE, 1.0 - smoothstep(footprint, 3.0 * footprint, start.y));
}

// How much mist clings to the walls about `p`, 0 to 1: patches fixed in the world, a few
// times as wide as it hangs off the rock.
float skyAbyssWallMistAt(vec3 p) {
  vec3 q = p / (3.0 * uSkyAbyssWallMist.y);
  return smoothstep(0.45, 0.75, 0.65 * skyNoise3(q) + 0.35 * skyNoise3(q * 2.3 + 7.1));
}

// The mist's light `h` high: paler than the haze it is of, darkening with depth as it does.
vec3 skyAbyssWallMistLight(float h) {
  return SKY_ABYSS_MIST_LIGHT * skyAbyssHazeColor(h);
}

// How much of the hollow's light is left at `p`, beyond the walls' rim: all of it inside,
// down to SKY_ABYSS_FADED uSkyAbyssWallFade beyond, and to none SKY_ABYSS_FADED_OUT times
// that again further on, the two easing into each other. The rim is their middle at p's
// depth, wandering and leaning out as they do, so the dark follows the hollow's own outline.
float skyAbyssWallFar(vec3 p) {
  float far = 1.0;
  if(uSkyAbyssWallFade > 0.0) {
    vec2 q = skyAbyssWallPlane(p);
    float depth = max(uSkyAbyssLevel - dot(p, uSkyUp), 0.0);
    float beyond = sdfBox(q, uSkyStageBox.zw) - uSkyAbyssWalls.x - uSkyAbyssWallShape.y * depth;
    // Inside the rim however far it wanders in, the way round is not needed.
    if(beyond > -uSkyAbyssWallShape.w) {
      vec2 around = skyAbyssWallAround(q, uSkyAbyssWalls.x);
      beyond -= uSkyAbyssWallShape.w * skyAbyssWallWander(around.x / around.y, depth);
      float fade = uSkyAbyssWallFade;
      far = mix(1.0, SKY_ABYSS_FADED, smoothstep(0.0, fade, beyond)) *
        (1.0 - smoothstep(fade, (1.0 + SKY_ABYSS_FADED_OUT) * fade, beyond));
    }
  }
  return far;
}

// How thick the walls' haze is `depth` below the lid at `q` (skyAbyssWallPlane), 0 to 1: all
// of it inside their rim, thinning to none uSkyAbyssWallFade beyond. Their rim without its
// wander, a box distance alone: the haze is smooth, and summed along the view.
float skyAbyssWallFog(vec2 q, float depth) {
  float beyond = sdfBox(q, uSkyStageBox.zw) - uSkyAbyssWalls.x - uSkyAbyssWallShape.y * depth;
  return 1.0 - smoothstep(0.0, uSkyAbyssWallFade, beyond);
}

// How much of what lies `t` along `dir` from `origin` shows through a haze `haze` long where
// it is thickest (skyAbyssWallFog): its thickness summed along the view, at the middles of
// SKY_ABYSS_FOG_SAMPLES stretches of the part of it over the rectangle the haze can lie
// over. Without the fade, as thick everywhere; all of it with no haze (`haze` 0).
float skyAbyssWallClear(vec3 origin, vec3 dir, float t, float haze) {
  float thick = t;
  if(uSkyAbyssWallFade > 0.0 && haze > 0.0) {
    float deepest = max(uSkyAbyssLevel - min(dot(origin, uSkyUp), dot(origin + dir * t, uSkyUp)), 0.0);
    vec2 reach = uSkyStageBox.zw + uSkyAbyssWalls.x + uSkyAbyssWallShape.y * deepest + uSkyAbyssWallFade;
    vec2 q = skyAbyssWallPlane(origin);
    vec2 along = vec2(dot(dir, uSkyEast), -dot(dir, uSkyNorth));
    vec2 toward = vec2(along.x < 0.0 ? -1.0 : 1.0, along.y < 0.0 ? -1.0 : 1.0) / max(abs(along), vec2(1e-9));
    vec2 a = (-reach - q) * toward;
    vec2 b = (reach - q) * toward;
    float from = max(max(min(a.x, b.x), min(a.y, b.y)), 0.0);
    float to = min(min(max(a.x, b.x), max(a.y, b.y)), t);
    thick = 0.0;
    if(to > from) {
      float stretch = (to - from) / float(SKY_ABYSS_FOG_SAMPLES);
      for(int i = 0; i < SKY_ABYSS_FOG_SAMPLES; i++) {
        vec3 x = origin + dir * (from + (float(i) + 0.5) * stretch);
        thick += skyAbyssWallFog(skyAbyssWallPlane(x), max(uSkyAbyssLevel - dot(x, uSkyUp), 0.0));
      }
      thick *= stretch;
    }
  }
  return haze > 0.0 ? exp(-thick / haze) : 1.0;
}

// `color` `t` along `dir` from `origin`, in the walls' own haze (skyAbyssHazeColor where it
// ends), thick in the hollow and thinning out beyond its rim (skyAbyssWallClear). `color`
// is darkened by the hollow's light left where it is (`far`, skyAbyssWallFar; 1 on their
// rim), so far from the hollow all fades to black. Solid: hazed into what lies behind,
// its horizon would show through them.
vec3 skyAbyssWallHaze(vec3 color, float far, vec3 origin, vec3 dir, float t) {
  vec3 haze = skyAbyssHazeColor(dot(origin + dir * t, uSkyUp));
  return mix(haze, color * far, skyAbyssWallClear(origin, dir, t, uSkyAbyssWalls.z));
}

// The lid's ripples' cells (uSkyAbyssDetailScale) at `hit` on the lid.
vec2 skyAbyssLidCells(vec3 hit) {
  return vec2(dot(hit, uSkyEast), dot(hit, uSkyNorth)) / uSkyAbyssDetailScale;
}

// How many of the ripples' cells a pixel spans at `hit` on the lid, for skyAbyssLid.
// ⚠️ Derivatives: taken before any pixel discards or branches its own way.
float skyAbyssLidFootprint(vec3 hit) {
  vec2 d = fwidth(skyAbyssLidCells(hit));
  return max(d.x, d.y);
}

// The lid seen from below `reach` along `dir` from `origin`, in the walls' haze: with sand
// over the walls' rock, the sand's underside, lit as the sand in the walls is (the glow at
// the top of the stage over it); without, the void's own lid colour. Faintly rippled as
// the void's lid is (uSkyAbyssDetail), the ripples fading as the haze thickens and
// smoothed over the `footprint` a pixel spans there (skyAbyssLidFootprint), and darkened
// far from the hollow (skyAbyssWallFar). It takes no derivatives, so a pixel may discard
// before it.
vec3 skyAbyssLid(vec3 origin, vec3 dir, float reach, float footprint) {
  vec3 hit = origin + dir * reach;
  float clear = skyAbyssWallClear(origin, dir, reach, uSkyAbyssWalls.z);
  vec3 lid = uSkyAbyssWallSand.x > 0.0 ? skyAbyssWallSandShade(-uSkyUp, hit) : uSkyAbyssCeilingColor;
  if(uSkyAbyssDetail > 0.0)
    lid *= 1.0 + pnFbmSigned2FilteredOver(skyAbyssLidCells(hit), 5, footprint) * 2.0 * uSkyAbyssDetail * clear;
  return mix(skyAbyssHazeColor(dot(hit, uSkyUp)), lid * skyAbyssWallFar(hit), clear);
}

// What the background draws of the walls along `dir` from `origin`, below the lid, laid
// over what lies behind (premultiplied): their fill where the view starts in their rock,
// hiding the rest. Their faces are their mesh's, down to its foot; their rock runs on down
// without one. Below the horizon a view that meets none of the mesh passes under its
// foot, and is drawn as a wall would be there, past the foot and at least a haze length
// into the hollow: as dark as their haze is that deep. Rising from under the foot, one that
// is out of the hollow by the time it is up to it went into that rock: the same.
// ⚠️ One return: with early ones, Direct3D's compiler (ANGLE on Windows) warns X4000.
vec4 skyAbyssWalls(vec3 dir, vec3 origin, float pixel) {
  vec4 startUnder = skyAbyssWallStartUnder(origin, dir);
  vec3 start = startUnder.xyz;
  float y = dot(dir, uSkyUp);
  float foot = uSkyAbyssLevel - uSkyAbyssWallGrid.z;
  vec4 walls = vec4(0.0);
  if(start.y > 0.0) {
    vec3 color = skyAbyssWallFill(origin, dir, start, pixel);
    walls = vec4(skyAbyssWallHaze(color, skyAbyssWallFar(origin + dir * start.x), origin, dir, start.x), 1.0);
  } else if(y < 0.0) {
    float h = min(dot(origin, uSkyUp), uSkyAbyssLevel);
    float t = skyAbyssLidStart(origin, dir) + max(uSkyAbyssWalls.z, (h - foot) / -y);
    walls = vec4(skyAbyssWallHaze(vec3(0.0), 1.0, origin, dir, t), 1.0);
  } else {
    float t = startUnder.w;
    if(t < 1e29)
      walls = vec4(skyAbyssWallHaze(vec3(0.0), 1.0, origin, dir, t), 1.0);
  }
  return walls;
}
#endif

// How far the void covers the view of a camera at `origin` below its level: fading in over
// uSkyAbyssTransition, or under a sea at once at its seabed. The same for every pixel.
float skyAbyssUnder(vec3 origin) {
  float depth = uSkyAbyssLevel - globeViewHeight(origin);
  #ifdef SKY_OCEAN
    // The level is the seabed: going through it is going through rock.
  return step(0.0, depth);
  #else
  return smoothstep(0.0, uSkyAbyssTransition, depth);
  #endif
}

// Below the level, an endless lid overhead hides the sky and a bottomless gradient fills
// the view below the horizon (`depths`, skyAbyssDepths), as a layer over everything else
// (premultiplied), as much as it has faded in (skyAbyssUnder). `walls` (skyAbyssWalls) is
// laid over the lid; the depths have theirs already. Background only, so it never hides data.
vec4 skyAbyss(vec3 dir, vec3 origin, vec3 depths, vec4 walls) {
  float depth = uSkyAbyssLevel - globeViewHeight(origin);
  float under = skyAbyssUnder(origin);
  if(under <= 0.0)
    return vec4(0.0);

  float y = dot(dir, uSkyUp);
  // Rays that never reach the lid take the mirrored hit, so the derivatives stay continuous.
  float reach = depth / max(abs(y), 1e-6);
  vec3 hit = origin + dir * reach;
  #ifdef SKY_ABYSS_WALLS
  vec3 ceiling = skyAbyssLid(origin, dir, reach, skyAbyssLidFootprint(hit));
  #else
  vec3 ceiling = skyAbyssCeiling(hit, reach);
  #endif

  vec3 abyss = y > 0.0 ? ceiling * (1.0 - walls.a) + walls.rgb : depths;
  if(uSkyAbyssDarkening > 0.0)
    abyss *= exp(-depth / uSkyAbyssDarkening);

  return vec4(abyss * under, under);
}
#endif

#ifdef SKY_OCEAN
#include ./sky-ocean.glsl
#endif

// The background is drawn in layers, each blended over those before it (scenery-layers.ts):
// the sky itself (skyAir), its clouds (skyCloudsLayer), the void (skyAbyssLayer), the sea from
// the air (skySeaLayer) or the view in the water (skyWaterLayer), and the sea's surface
// (skyOceanSurfaceLayer). Each but the sky is premultiplied: its alpha is how much it hides of
// those before it. Each is a program of its own, so each compiles on its own, and switching
// one recompiles only its own.

// Where every layer's view starts: the camera. Under a stage's ground it is in the rock:
// seen as from just below the sea's seabed, by its height over the globe, which far off lies
// well below the scene's level.
vec3 skyViewOrigin() {
  if(uSkyOceanBuried > 0.5)
    return cameraPosition - uSkyUp * (globeCameraHeight() - uSkyOceanLevel + uSkyOceanDepth + 1.0);
  return cameraPosition;
}

// The width of the horizon's blend along `dir`, at least a pixel, by the camera's look up
// (the sky as the camera sees it; what lies under the field, by the scene's).
float skyBlendAt(vec3 dir) {
  return max(uSkyHorizonBlend, fwidth(dot(dir, globeCameraLook())));
}

// The sky itself, under every other layer: the air with the sun, the moon and the stars; with
// no sky (`background: 'void'`) the void's gradient all round, as the stand-in draws it, from
// the horizon the Earth's curve lowers, so it meets the far lid's haze without a seam.
// ⚠️ Derivatives.
vec3 skyAir(vec3 dir, float blend) {
  float y = dot(dir, globeCameraLook());
  float horizon = skyHorizon(dir);
  #ifdef SKY_VOID
  return skyVoidGradient(skyOverHorizon(y, horizon));
  #else
  vec3 color = skySurface(dir, blend);
  if(uSkySunDisc > 0.0) {
    float cosSun = dot(dir, uSkySunDirection);
    // atan2 keeps the angle precise for the small radii a disc uses.
    float angle = atan(length(cross(dir, uSkySunDirection)), cosSun);
    float aa = max(fwidth(angle), 1e-5);
    float disc = 1.0 - smoothstep(uSkySunSize - aa, uSkySunSize + aa, angle);
    SkyLight seen = skyLight(skyLightShare(uSkySunDirection, skyCameraHeight()));
    // Reddened only by the air the view toward it crosses: from space, white, but through
    // the air along the Earth's edge still red.
    float bare = skySpace(uSkySunDirection, skyCameraHeight());
    seen.sun = mix(seen.sun, SKY_SUN_HIGH, bare);
    seen.twilight *= 1.0 - bare;
    color = mix(color, skySunDiscRadiance(seen), disc * uSkySunDisc);
    // Over the disc too, so it is never dimmer than its glare; above the horizon, while the sun is up.
    float sunOver = skyOverHorizon(dot(uSkySunDirection, globeCameraLook()), skyHorizon(uSkySunDirection));
    float up = smoothstep(-blend, 0.0, skyOverHorizon(y, horizon)) * smoothstep(-uSkySunSize, uSkySunSize, sunOver);
    vec3 light = skyTwilightLight(seen);
    // Full while warm (to ~15° up), a quarter once white (~20°).
    float white = min(light.r, min(light.g, light.b)) / max(max(light.r, max(light.g, light.b)), 1e-4);
    float glare = uSkySunRadiance > 1.0 ? 1.0 : mix(1.0, SKY_SUN_DAY_GLARE, smoothstep(0.3, 0.7, white));
    color += light * skySunGlare(dir, angle, aa) * glare * up * uSkySunDisc;
  }
  return skyNight(color, dir, blend);
  #endif
}

#ifdef SKY_CLOUDS
// The clouds over the sky: the band, and the deck over it, melting into the bare sky
// (`haze`, without its sun disc, moon and stars). ⚠️ Derivatives.
vec4 skyCloudsLayer(vec3 dir, vec3 origin, float blend) {
  vec3 haze = skySurface(dir, blend);
  vec4 band = skyCloudBand(haze, dir, origin);
  vec4 deck = skyClouds(haze, dir, origin);
  return deck + band * (1.0 - deck.a);
}
#endif

#ifdef SKY_ABYSS
// The void: for a camera below its level, the lid overhead and the depths below the horizon,
// over everything, as much as it has faded in (skyAbyss). From above it, with a sea, the
// depths where the sea's layers leave them showing (skyOceanShowsVoid), under those layers:
// nothing elsewhere. The walls (skyAbyssWalls) are taken once, for the depths and the lid,
// and only where the void shows. ⚠️ Derivatives.
vec4 skyAbyssLayer(vec3 dir, vec3 origin) {
  float y = dot(dir, globeCameraLook());
  #ifdef SKY_OCEAN
  SkyOceanStagedView staged = skyOceanStagedView(dir, origin);
  #endif
  #ifdef SKY_ABYSS_WALLS
  float pixel = length(fwidth(dir));
  #endif
  float under = skyAbyssUnder(origin);
  bool shown = under > 0.0;
  #ifdef SKY_OCEAN
  if(!shown)
    shown = skyOceanShowsVoid(dir, origin, staged);
  #endif

  // The void below the horizon, with its rock: taken once, as each call compiles a copy.
  vec3 depths = vec3(0.0);
  vec4 walls = vec4(0.0);
  if(shown) {
    #ifdef SKY_OCEAN
    depths = skyOceanVoid(dir);
    #else
    depths = skyAbyssDepths(dir);
    #endif
    #ifdef SKY_ABYSS_WALLS
    // From above the lid only looking down, where the void can show.
    if(y < 0.0 || globeViewHeight(origin) < uSkyAbyssLevel)
      walls = skyAbyssWalls(dir, origin, pixel);
    depths = depths * (1.0 - walls.a) + walls.rgb;
    #endif
  }

  vec4 layer = vec4(0.0);
  // The same for every pixel: the lid's derivatives stay sound.
  if(under > 0.0)
    layer = skyAbyss(dir, origin, depths, walls);
  else if(shown)
    layer = vec4(depths, 1.0);
  return skyDebugTintOver(layer, SKY_DEBUG_SEA);
}
#endif

#ifdef SKY_OCEAN
// Where a stage draws the sea, the sea's layer leaves what shows through its gaps: beyond
// its seabed, below the horizon, the water the cutaway left over the void (skyAbyssLayer);
// without a void, the sky. `layer` is the sea's own elsewhere.
vec4 skyOceanStagedOver(vec4 layer, SkyOceanStagedView staged, vec3 dir, vec3 origin) {
  if(!staged.staged)
    return skyDebugTintOver(layer, SKY_DEBUG_SEA);
  #ifdef SKY_ABYSS
  if(staged.below)
    layer = skyOceanThroughCutawayOver(dir, origin);
  #else
  layer = vec4(0.0);
  #endif
  return skyDebugTintOver(layer, SKY_DEBUG_STAGED);
}

// The sea seen from the air, or a dry sea's bed from below its level: the seabed through the
// water, over the void (skyOceanFromAir). Nothing from in the water (skyWaterLayer), nor from
// below the seabed. ⚠️ Derivatives.
vec4 skySeaLayer(vec3 dir, vec3 origin, float blend) {
  SkyOceanStagedView staged = skyOceanStagedView(dir, origin);
  bool water = skyOceanNeedsWaterView(origin);
  #ifndef SKY_NO_GRATICULE
  // Dry, the seabed is what is seen of the Earth from the air: where it lies, for the lines
  // over it, before anything branches (the branch is the same for every pixel).
  bool lined = uSkyOceanWater < 0.5;
  GraticuleAt graticule;
  if(lined)
    graticule = graticuleAt(origin + dir * skyOceanBedReach(origin, dir, false).x);
  #endif
  vec4 sea = vec4(0.0);
  // Staged pixels are left to the stage; their sea is skipped where the quad surely is.
  if(!staged.skip && !water && skyOceanSeesBed(origin)) {
    vec3 reach = skyOceanBedReach(origin, dir, false);
    vec3 bedPoint = origin + dir * reach.x;
    vec3 bed = skyOceanBed(bedPoint, globeUpAt(bedPoint), uSkyOceanDepth);
    bool reached;
    sea = skyOceanFromAir(dir, origin, blend, reach, bed, reached);
    #ifndef SKY_NO_GRATICULE
    // Premultiplied.
    if(lined && sea.a > 0.0)
      sea.rgb = graticuleOver(sea.rgb / sea.a, graticule) * sea.a;
    #endif
    #ifndef SKY_ABYSS
    if(reached)
      sea = skyOceanOverVoid(sea, dir);
    #endif
  }
  return water ? vec4(0.0) : skyOceanStagedOver(sea, staged, dir, origin);
}

// The view from in the water: the surface's underside above, the seabed below, water all
// round, over the void (skyOceanInWaterOver). Up through the cutaway's cut, which takes the
// surface over it too, the sky before it shows. Nothing from anywhere else. ⚠️ Derivatives.
vec4 skyWaterLayer(vec3 dir, vec3 origin, float blend) {
  SkyOceanStagedView staged = skyOceanStagedView(dir, origin);
  bool water = skyOceanNeedsWaterView(origin);
  vec4 view = vec4(0.0);
  if(!staged.skip && water) {
    vec3 reach = skyOceanBedReach(origin, dir, true);
    vec3 bedPoint = origin + dir * reach.x;
    vec3 bed = skyOceanBed(bedPoint, globeUpAt(bedPoint), uSkyOceanDepth);
    view = skyOceanInWaterOver(origin, dir, blend, reach.x, bed);
    #ifndef SKY_ABYSS
    view = skyOceanOverVoid(view, dir);
    #endif
    float rise = dot(dir, globeCameraUp());
    bool through = rise > 0.0 && skyOceanCutawayWall(origin, dir) * rise > -skyOceanViewAltitude(origin);
    if(through)
      view *= 1.0 - uSkyOceanCutawayCuts.x;
  }
  return water ? skyOceanStagedOver(view, staged, dir, origin) : vec4(0.0);
}
#endif